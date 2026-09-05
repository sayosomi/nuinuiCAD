import * as vscode from "vscode";
import {
  type DslDocumentSymbol,
  type DslDocumentSymbolKind
} from "../../src/dsl/dslDocumentSymbolQuery";
import type { NuiLanguageSession } from "@nuinuicad/nui-language";
import {
  vscodeRangeForNormalized
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
  document: vscode.TextDocument,
  rawSource: string,
  symbol: DslDocumentSymbol
): vscode.DocumentSymbol => {
  const result = new vscode.DocumentSymbol(
    symbol.name,
    symbol.detail,
    vscodeSymbolKindFor[symbol.kind],
    vscodeRangeForNormalized(document, rawSource, symbol.range),
    vscodeRangeForNormalized(document, rawSource, symbol.selectionRange)
  );
  result.children = symbol.children.map((child) => toVscodeDocumentSymbol(document, rawSource, child));
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

export const createNuiDocumentSymbolProvider = (
  sessionFor: NuiDocumentSymbolSessionFor
): vscode.DocumentSymbolProvider => ({
  provideDocumentSymbols: (document) => {
    const snapshot = currentNuiDocumentSymbolSnapshot(document, sessionFor);
    if (!snapshot) return [];
    return snapshot.symbols.map((symbol) => toVscodeDocumentSymbol(document, snapshot.rawSource, symbol));
  }
});
