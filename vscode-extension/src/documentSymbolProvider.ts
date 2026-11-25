import * as vscode from "vscode";
import {
  type DslDocumentSymbol,
  type DslDocumentSymbolKind
} from "@nuinuicad/nui-language";
import type { NuiLanguageSession } from "@nuinuicad/nui-language";
import {
  createVscodeRangeForNormalized,
  type NormalizedSourceRange
} from "./sourceOffsetAdapter";

export const nuiDocumentSymbolSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export type NuiDocumentSymbolSessionFor = (document: vscode.TextDocument) => NuiLanguageSession;

export type NuiDocumentSymbolSnapshot = {
  rawSource: string;
  symbols: DslDocumentSymbol[];
};

export type NuiDocumentSymbolProvider = vscode.DocumentSymbolProvider & {
  invalidateDocument: (document: vscode.TextDocument) => void;
};

const maximumCachedDocuments = 8;

const vscodeSymbolKindFor: Record<DslDocumentSymbolKind, vscode.SymbolKind> = {
  module: vscode.SymbolKind.Module,
  object: vscode.SymbolKind.Object,
  namespace: vscode.SymbolKind.Namespace,
  constant: vscode.SymbolKind.Constant,
  variable: vscode.SymbolKind.Variable,
  enum: vscode.SymbolKind.Enum,
  struct: vscode.SymbolKind.Struct,
  property: vscode.SymbolKind.Property,
  field: vscode.SymbolKind.Field,
  string: vscode.SymbolKind.String,
  file: vscode.SymbolKind.File
};

const toVscodeDocumentSymbol = (
  rangeFor: (range: NormalizedSourceRange) => vscode.Range,
  symbol: DslDocumentSymbol
): vscode.DocumentSymbol => {
  const result = new vscode.DocumentSymbol(
    symbol.name,
    symbol.detail,
    vscodeSymbolKindFor[symbol.kind],
    rangeFor(symbol.range),
    rangeFor(symbol.selectionRange)
  );
  result.children = symbol.children.map((child) => toVscodeDocumentSymbol(rangeFor, child));
  return result;
};

export const currentNuiDocumentSymbolSnapshot = (
  document: vscode.TextDocument,
  sessionFor: NuiDocumentSymbolSessionFor
): NuiDocumentSymbolSnapshot | null => {
  if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return null;

  const rawSource = document.getText();
  const session = sessionFor(document);
  if (session.getSource() !== rawSource) session.replaceSource(rawSource);

  return {
    rawSource,
    symbols: [...session.documentSymbols()]
  };
};

type CurrentNuiDocumentSymbolSource = {
  rawSource: string;
  documentVersion: number;
  session: NuiLanguageSession;
  sourceRevision: number;
  symbolQuery: NuiLanguageSession["documentSymbols"];
};

const currentNuiDocumentSymbolSource = (
  document: vscode.TextDocument,
  sessionFor: NuiDocumentSymbolSessionFor
): CurrentNuiDocumentSymbolSource | null => {
  if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return null;

  const documentVersion = document.version;
  const rawSource = document.getText();
  const session = sessionFor(document);
  if (session.getSource() !== rawSource) session.replaceSource(rawSource);

  return {
    rawSource,
    documentVersion,
    session,
    sourceRevision: session.getSourceRevision(),
    symbolQuery: session.documentSymbols
  };
};

type CachedNuiDocumentSymbols = {
  document: vscode.TextDocument;
  documentVersion: number;
  rawSource: string;
  session: NuiLanguageSession;
  sourceRevision: number;
  symbolQuery: NuiLanguageSession["documentSymbols"];
  symbols: vscode.DocumentSymbol[];
};

const cacheStillMatches = (
  cached: CachedNuiDocumentSymbols,
  document: vscode.TextDocument,
  current: CurrentNuiDocumentSymbolSource
): boolean => cached.document === document &&
  cached.documentVersion === current.documentVersion &&
  cached.rawSource === current.rawSource &&
  cached.session === current.session &&
  cached.sourceRevision === current.sourceRevision &&
  cached.symbolQuery === current.symbolQuery;

export const createNuiDocumentSymbolProvider = (
  sessionFor: NuiDocumentSymbolSessionFor
): NuiDocumentSymbolProvider => {
  const cachedByUri = new Map<string, CachedNuiDocumentSymbols>();
  const invalidateDocument = (document: vscode.TextDocument): void => {
    for (const [cachedUri, cached] of cachedByUri) {
      if (cached.document === document) cachedByUri.delete(cachedUri);
    }
  };

  return {
    invalidateDocument,
    provideDocumentSymbols: (document, token) => {
      if (token?.isCancellationRequested) return undefined;

      const current = currentNuiDocumentSymbolSource(document, sessionFor);
      if (!current) return [];
      if (token?.isCancellationRequested) return undefined;
      const uri = document.uri.toString();

      for (const [cachedUri, cached] of cachedByUri) {
        if (cached.document === document && cachedUri !== uri) cachedByUri.delete(cachedUri);
      }

      const cached = cachedByUri.get(uri);
      if (cached && !cacheStillMatches(cached, document, current)) cachedByUri.delete(uri);
      else if (cached) {
        cachedByUri.delete(uri);
        cachedByUri.set(uri, cached);
        return token?.isCancellationRequested ? undefined : cached.symbols;
      }

      const symbols = [...current.session.documentSymbols()];
      if (token?.isCancellationRequested) return undefined;
      if (
        document.version !== current.documentVersion ||
        document.getText() !== current.rawSource ||
        current.session.getSource() !== current.rawSource ||
        current.session.getSourceRevision() !== current.sourceRevision
      ) return undefined;

      let convertedSymbols: vscode.DocumentSymbol[] = [];
      if (symbols.length > 0) {
        const rangeFor = createVscodeRangeForNormalized(document, current.rawSource);
        convertedSymbols = symbols.map((symbol) => toVscodeDocumentSymbol(rangeFor, symbol));
      }

      if (
        token?.isCancellationRequested ||
        document.version !== current.documentVersion ||
        current.session.getSourceRevision() !== current.sourceRevision
      ) return undefined;

      cachedByUri.set(uri, {
        document,
        documentVersion: current.documentVersion,
        rawSource: current.rawSource,
        session: current.session,
        sourceRevision: current.sourceRevision,
        symbolQuery: current.symbolQuery,
        symbols: convertedSymbols
      });
      while (cachedByUri.size > maximumCachedDocuments) {
        const oldestUri = cachedByUri.keys().next().value as string | undefined;
        if (oldestUri === undefined) break;
        cachedByUri.delete(oldestUri);
      }
      return convertedSymbols;
    }
  };
};
