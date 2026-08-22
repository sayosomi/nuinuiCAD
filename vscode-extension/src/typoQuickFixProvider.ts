import * as vscode from "vscode";
import {
  isDslTypoSuggestionDiagnosticCode,
  queryDslTypoSuggestions,
  type DslTypoSuggestionCandidate,
  type DslTypoSuggestionDiagnosticCode
} from "../../src/dsl/dslTypoSuggestionQuery";
import type { DslCompletionSemanticSnapshot, DslCompletionRange } from "../../src/dsl/dslCompletionQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { DslDiagnostic } from "../../src/dsl/dslTypes";
import {
  toCompilerDiagnostic,
  type CompilerDiagnostic,
  type CompilerDiagnosticRange
} from "./compilerDiagnostics";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import { createTranslator, resolveLocale } from "./localization";
import { normalizedSourceFor, vscodeRangeForNormalized } from "./sourceOffsetAdapter";
import { typoSuggestionTranslationCatalog } from "./typoSuggestionLocalization";

export const nuiTypoQuickFixSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export const NUI_TYPO_QUICK_FIX_APPLY_COMMAND = "nuinuiCAD.applyTypoQuickFix";

type TypoDiagnosticFingerprint = {
  source: "nuinuiCAD";
  code: DslTypoSuggestionDiagnosticCode;
  range: CompilerDiagnosticRange;
};

type TypoCandidateFingerprint = Pick<DslTypoSuggestionCandidate, "kind" | "label" | "identity">;

type TypoQuickFixPayload = {
  uri: string;
  documentVersion: number;
  rawSource: string;
  sourceRevision: number;
  targetDiagnostic: TypoDiagnosticFingerprint;
  replacementRange: DslCompletionRange;
  expectedTypedText: string;
  candidate: TypoCandidateFingerprint;
};

export type NuiTypoQuickFixSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;

const isSupportedDocument = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.fileName.endsWith(".nui");

const samePosition = (
  left: { line: number; character: number },
  right: { line: number; character: number }
): boolean => left.line === right.line && left.character === right.character;

const sameRange = (
  left: CompilerDiagnosticRange,
  right: { start: { line: number; character: number }; end: { line: number; character: number } }
): boolean => samePosition(left.start, right.start) && samePosition(left.end, right.end);

const sameDiagnostic = (
  fingerprint: TypoDiagnosticFingerprint,
  diagnostic: {
    source?: string;
    code?: unknown;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  }
): boolean =>
  diagnostic.source === fingerprint.source &&
  diagnostic.code === fingerprint.code &&
  sameRange(fingerprint.range, diagnostic.range);

const fingerprintFor = (diagnostic: CompilerDiagnostic): TypoDiagnosticFingerprint | undefined => {
  if (
    diagnostic.source !== "nuinuiCAD" ||
    !isDslTypoSuggestionDiagnosticCode(diagnostic.code)
  ) return undefined;
  return {
    source: diagnostic.source,
    code: diagnostic.code,
    range: diagnostic.range
  };
};

const contextDiagnosticFor = (
  fingerprint: TypoDiagnosticFingerprint,
  diagnostics: readonly vscode.Diagnostic[]
): vscode.Diagnostic | undefined => diagnostics.find((diagnostic) => sameDiagnostic(fingerprint, diagnostic));

const dslDiagnosticsFor = (semantic: DslCompletionSemanticSnapshot): readonly DslDiagnostic[] =>
  semantic.compiled
    ? [
        ...semantic.compiled.diagnostics,
        ...(semantic.compiled.bindingIssueDiagnostics ?? [])
      ]
    : [];

const candidateFingerprint = (candidate: DslTypoSuggestionCandidate): TypoCandidateFingerprint => ({
  kind: candidate.kind,
  label: candidate.label,
  ...(candidate.identity ? { identity: candidate.identity } : {})
});

const sameCandidate = (
  expected: TypoCandidateFingerprint,
  actual: DslTypoSuggestionCandidate
): boolean =>
  expected.kind === actual.kind &&
  expected.label === actual.label &&
  expected.identity === actual.identity;

const sameReplacementRange = (left: DslCompletionRange, right: DslCompletionRange): boolean =>
  left.from === right.from && left.to === right.to;

const sourceSnapshotFor = (
  rawSource: string,
  session: NuiLanguageAnalysisSession
): SourceSnapshot => ({
  normalizedSource: normalizedSourceFor(rawSource),
  sourceRevision: session.getSourceRevision()
});

const payloadFor = (
  document: vscode.TextDocument,
  source: SourceSnapshot,
  diagnostic: TypoDiagnosticFingerprint,
  replacementRange: DslCompletionRange,
  expectedTypedText: string,
  candidate: DslTypoSuggestionCandidate
): TypoQuickFixPayload => ({
  uri: document.uri.toString(),
  documentVersion: document.version,
  rawSource: document.getText(),
  sourceRevision: source.sourceRevision,
  targetDiagnostic: diagnostic,
  replacementRange: { ...replacementRange },
  expectedTypedText,
  candidate: candidateFingerprint(candidate)
});

export const createNuiTypoQuickFixProvider = (
  sessionFor: NuiTypoQuickFixSessionFor,
  displayLanguageFor: () => string = () => vscode.env?.language ?? "en"
): vscode.CodeActionProvider => ({
  provideCodeActions: (document, _range, context) => {
    if (!isSupportedDocument(document)) return [];

    const documentUri = document.uri.toString();
    const documentVersion = document.version;
    const rawSource = document.getText();
    const session = sessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);
    const source = sourceSnapshotFor(rawSource, session);
    const semantic = session.completionSemanticSnapshot(source);
    if (!semantic?.compiled) return [];
    if (
      document.uri.toString() !== documentUri ||
      document.version !== documentVersion ||
      document.getText() !== rawSource
    ) return [];

    const translate = createTranslator(
      typoSuggestionTranslationCatalog,
      resolveLocale(displayLanguageFor())
    );
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of dslDiagnosticsFor(semantic)) {
      if (!isDslTypoSuggestionDiagnosticCode(diagnostic.code)) continue;
      const projected = toCompilerDiagnostic(semantic.sourceText ?? source.normalizedSource, diagnostic);
      const fingerprint = projected && fingerprintFor(projected);
      if (!fingerprint) continue;
      const target = contextDiagnosticFor(fingerprint, context.diagnostics);
      if (!target) continue;

      const result = queryDslTypoSuggestions({ source, diagnostic, semantic });
      if (!result || result.candidates.length === 0) continue;

      for (const candidate of result.candidates) {
        const title = translate("typoSuggestion.quickFixTitle", { candidate: candidate.label });
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [target];
        if (result.candidates.length === 1) action.isPreferred = true;
        action.command = {
          command: NUI_TYPO_QUICK_FIX_APPLY_COMMAND,
          title,
          arguments: [payloadFor(
            document,
            source,
            fingerprint,
            result.replacementRange,
            result.typedText,
            candidate
          )]
        };
        actions.push(action);
      }
    }

    return actions;
  }
});

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const isCompilerRange = (value: unknown): value is CompilerDiagnosticRange => {
  if (!value || typeof value !== "object") return false;
  const range = value as { start?: unknown; end?: unknown };
  const isPosition = (position: unknown): position is { line: number; character: number } => {
    if (!position || typeof position !== "object") return false;
    const candidate = position as { line?: unknown; character?: unknown };
    return isInteger(candidate.line) && isInteger(candidate.character);
  };
  return isPosition(range.start) && isPosition(range.end);
};

const isReplacementRange = (value: unknown): value is DslCompletionRange => {
  if (!value || typeof value !== "object") return false;
  const range = value as { from?: unknown; to?: unknown };
  return isInteger(range.from) && isInteger(range.to) && range.from >= 0 && range.to > range.from;
};

const isDiagnosticFingerprint = (value: unknown): value is TypoDiagnosticFingerprint => {
  if (!value || typeof value !== "object") return false;
  const diagnostic = value as { source?: unknown; code?: unknown; range?: unknown };
  return diagnostic.source === "nuinuiCAD" &&
    typeof diagnostic.code === "string" &&
    isDslTypoSuggestionDiagnosticCode(diagnostic.code) &&
    isCompilerRange(diagnostic.range);
};

const isCandidateFingerprint = (value: unknown): value is TypoCandidateFingerprint => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { kind?: unknown; label?: unknown; identity?: unknown };
  return typeof candidate.kind === "string" &&
    typeof candidate.label === "string" &&
    (candidate.identity === undefined || typeof candidate.identity === "string");
};

const isPayload = (value: unknown): value is TypoQuickFixPayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<TypoQuickFixPayload>;
  return typeof payload.uri === "string" &&
    isInteger(payload.documentVersion) &&
    typeof payload.rawSource === "string" &&
    isInteger(payload.sourceRevision) &&
    isDiagnosticFingerprint(payload.targetDiagnostic) &&
    isReplacementRange(payload.replacementRange) &&
    typeof payload.expectedTypedText === "string" &&
    payload.expectedTypedText.length > 0 &&
    isCandidateFingerprint(payload.candidate);
};

const currentOpenDocumentFor = (uri: string): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri);

const currentTypoResultFor = (
  payload: TypoQuickFixPayload,
  source: SourceSnapshot,
  semantic: DslCompletionSemanticSnapshot
) => {
  for (const diagnostic of dslDiagnosticsFor(semantic)) {
    if (diagnostic.code !== payload.targetDiagnostic.code) continue;
    const projected = toCompilerDiagnostic(semantic.sourceText ?? source.normalizedSource, diagnostic);
    if (!projected || !sameDiagnostic(payload.targetDiagnostic, {
      source: projected.source,
      code: projected.code,
      range: projected.range
    })) continue;
    const result = queryDslTypoSuggestions({ source, diagnostic, semantic });
    if (result) return result;
  }
  return undefined;
};

export const createNuiTypoQuickFixApplyHandler = (
  sessionFor: NuiTypoQuickFixSessionFor
): (payload: unknown) => Promise<void> => async (rawPayload) => {
  if (!isPayload(rawPayload)) return;
  const payload = rawPayload;
  const document = currentOpenDocumentFor(payload.uri);
  if (!document || !isSupportedDocument(document)) return;
  if (
    currentOpenDocumentFor(payload.uri) !== document ||
    document.version !== payload.documentVersion ||
    document.getText() !== payload.rawSource
  ) return;

  const session = sessionFor(document);
  const currentRawSource = document.getText();
  if (session.getSource() !== currentRawSource) session.replaceSource(currentRawSource);
  if (session.getSourceRevision() !== payload.sourceRevision) return;

  const source = sourceSnapshotFor(currentRawSource, session);
  const semantic = session.completionSemanticSnapshot(source);
  if (!semantic?.compiled) return;
  const result = currentTypoResultFor(payload, source, semantic);
  if (!result) return;
  if (!sameReplacementRange(payload.replacementRange, result.replacementRange)) return;
  if (result.typedText !== payload.expectedTypedText) return;
  if (
    source.normalizedSource.slice(result.replacementRange.from, result.replacementRange.to) !==
    payload.expectedTypedText
  ) return;
  if (!result.candidates.some((candidate) => sameCandidate(payload.candidate, candidate))) return;

  if (
    currentOpenDocumentFor(payload.uri) !== document ||
    document.version !== payload.documentVersion ||
    document.getText() !== payload.rawSource
  ) return;

  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(
    document.uri,
    vscodeRangeForNormalized(document, payload.rawSource, result.replacementRange),
    payload.candidate.label
  );
  await vscode.workspace.applyEdit(workspaceEdit);
};
