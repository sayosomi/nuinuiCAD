import * as vscode from "vscode";
import {
  queryDslCompletion,
  type DslCompletionCandidate,
  type DslCompletionCandidateKind,
  type DslCompletionQueryResult
} from "../../src/dsl/dslCompletionQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";

export const nuiCompletionSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export const nuiCompletionTriggerCharacters = ["@", ".", ":", "=", "(", ",", "[", "{"] as const;

const completionItemKindFor: Record<DslCompletionCandidateKind, vscode.CompletionItemKind> = {
  keyword: vscode.CompletionItemKind.Keyword,
  type: vscode.CompletionItemKind.Keyword,
  construction: vscode.CompletionItemKind.Function,
  argumentName: vscode.CompletionItemKind.Property,
  binding: vscode.CompletionItemKind.Variable,
  geometry: vscode.CompletionItemKind.Reference,
  module: vscode.CompletionItemKind.Module,
  property: vscode.CompletionItemKind.Property,
  builtin: vscode.CompletionItemKind.Function,
  literal: vscode.CompletionItemKind.Value,
  operator: vscode.CompletionItemKind.Operator
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const lineStartsFor = (sourceText: string): number[] => {
  const starts = [0];
  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

export const normalizedOffsetAt = (normalizedSource: string, position: vscode.Position): number => {
  const starts = lineStartsFor(normalizedSource);
  const line = Math.min(Math.max(position.line, 0), starts.length - 1);
  const lineStart = starts[line]!;
  const lineEnd = line + 1 < starts.length ? starts[line + 1]! - 1 : normalizedSource.length;
  const character = Math.min(Math.max(position.character, 0), lineEnd - lineStart);
  return lineStart + character;
};

export const normalizedPositionAt = (normalizedSource: string, offset: number): vscode.Position => {
  const starts = lineStartsFor(normalizedSource);
  const clampedOffset = Math.min(Math.max(offset, 0), normalizedSource.length);
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= clampedOffset) low = middle + 1;
    else high = middle - 1;
  }
  const line = Math.max(0, high);
  return new vscode.Position(line, clampedOffset - starts[line]!);
};

const hasReferencePrefix = (source: string, offset: number): boolean =>
  source.slice(0, offset).endsWith("@") ||
  source.slice(0, offset).endsWith("::") ||
  source.slice(0, offset).endsWith(".");

const insertionFor = (
  candidate: DslCompletionCandidate,
  result: DslCompletionQueryResult,
  normalizedSource: string
): string | vscode.SnippetString => {
  if (candidate.kind === "type" && candidate.label === "choice") return new vscode.SnippetString("choice($0)");
  if (candidate.kind === "argumentName") return `${candidate.label}: `;
  if (
    (candidate.kind === "binding" || candidate.kind === "geometry") &&
    result.category !== "setTarget" &&
    !hasReferencePrefix(normalizedSource, result.replacementRange.from)
  ) return `@${candidate.label}`;
  return candidate.label;
};

const completionItemFor = (
  candidate: DslCompletionCandidate,
  result: DslCompletionQueryResult,
  normalizedSource: string,
  range: vscode.Range
): vscode.CompletionItem => {
  const item = new vscode.CompletionItem(candidate.label, completionItemKindFor[candidate.kind]);
  item.range = range;
  if (candidate.detail !== undefined) item.detail = candidate.detail;
  item.insertText = insertionFor(candidate, result, normalizedSource);
  return item;
};

export const projectDslCompletionItems = (
  normalizedSource: string,
  result: DslCompletionQueryResult
): vscode.CompletionItem[] => {
  const range = new vscode.Range(
    normalizedPositionAt(normalizedSource, result.replacementRange.from),
    normalizedPositionAt(normalizedSource, result.replacementRange.to)
  );
  return result.candidates.map((candidate) => completionItemFor(candidate, result, normalizedSource, range));
};

export type NuiCompletionSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;

export const createNuiCompletionProvider = (
  sessionFor: NuiCompletionSessionFor
): vscode.CompletionItemProvider => ({
  provideCompletionItems: (document, position) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return [];

    const rawSource = document.getText();
    const normalizedSource = normalizedSourceFor(rawSource);
    const session = sessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);

    const source: SourceSnapshot = {
      normalizedSource,
      sourceRevision: session.getSourceRevision()
    };
    const semantic = session.completionSemanticSnapshot(source);
    const recovery = session.completionRecoverySnapshot(source);
    const result = queryDslCompletion({
      source,
      position: normalizedOffsetAt(normalizedSource, position),
      ...(semantic ? { semantic } : {}),
      ...(recovery ? { recovery } : {})
    });
    if (!result) return [];

    return projectDslCompletionItems(normalizedSource, result);
  }
});
