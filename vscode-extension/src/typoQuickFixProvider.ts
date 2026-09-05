import * as vscode from "vscode";
import {
  isDslTypoSuggestionDiagnosticCode,
  type DslTypoSuggestionCandidate,
  type DslTypoSuggestionDiagnosticCode
} from "../../src/dsl/dslTypoSuggestionQuery";
import type { DslCompletionRange } from "../../src/dsl/dslCompletionQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import {
  type CompilerDiagnostic,
  type CompilerDiagnosticRange
} from "./compilerDiagnostics";
import type { NuiLanguageSession, NuiQuickFixInput, NuiQuickFixPlan } from "@nuinuicad/nui-language";
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

export type NuiTypoQuickFixSessionFor = (document: vscode.TextDocument) => NuiLanguageSession;

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

const sourceSnapshotFor = (
  rawSource: string,
  session: NuiLanguageSession
): SourceSnapshot => ({
  normalizedSource: normalizedSourceFor(rawSource),
  sourceRevision: session.getSourceRevision()
});

const vscodeDisplayLanguage = (): string => {
  try {
    return vscode.env?.language ?? "en";
  } catch {
    // Some focused host mocks intentionally omit vscode.env.
    return "en";
  }
};

/** @internal Focused-test adapter; production diagnostic presentation is owned by typoDiagnosticPresentation.ts. */
export const compilerDiagnosticsWithTypoSuggestions = (
  rawSource: string,
  session: NuiLanguageSession,
  displayLanguage: string = vscodeDisplayLanguage()
): CompilerDiagnostic[] => {
  void rawSource;
  void displayLanguage;
  return [...session.diagnostics()];
};

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
  displayLanguageFor: () => string = vscodeDisplayLanguage
): vscode.CodeActionProvider => ({
  provideCodeActions: (document, _range, context) => {
    if (!isSupportedDocument(document)) return [];

    const documentUri = document.uri.toString();
    const documentVersion = document.version;
    const rawSource = document.getText();
    const session = sessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);
    const source = sourceSnapshotFor(rawSource, session);
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

    for (const diagnostic of session.diagnostics()) {
      const fingerprint = fingerprintFor(diagnostic);
      if (!fingerprint) continue;
      const target = contextDiagnosticFor(fingerprint, context.diagnostics);
      if (!target) continue;

      const plans = session.quickFixes(fingerprint as NuiQuickFixInput)
        .filter((plan): plan is Extract<NuiQuickFixPlan, { kind: "typo-suggestion" }> =>
          plan.kind === "typo-suggestion"
        );
      if (plans.length === 0) continue;

      for (const plan of plans) {
        const title = translate("typoSuggestion.quickFixTitle", { candidate: plan.candidate.label });
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [target];
        if (plans.length === 1) action.isPreferred = true;
        action.command = {
          command: NUI_TYPO_QUICK_FIX_APPLY_COMMAND,
          title,
          arguments: [payloadFor(
            document,
            source,
            fingerprint,
            { from: plan.edit.from, to: plan.edit.to },
            plan.edit.expectedText,
            plan.candidate
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
  session: NuiLanguageSession
): Extract<NuiQuickFixPlan, { kind: "typo-suggestion" }> | undefined => {
  if (session.getSourceRevision() !== payload.sourceRevision) return undefined;
  return session.quickFixes(payload.targetDiagnostic as NuiQuickFixInput)
    .filter((plan): plan is Extract<NuiQuickFixPlan, { kind: "typo-suggestion" }> =>
      plan.kind === "typo-suggestion"
    )
    .find((plan) =>
      plan.edit.from === payload.replacementRange.from &&
      plan.edit.to === payload.replacementRange.to &&
      plan.edit.expectedText === payload.expectedTypedText &&
      sameCandidate(payload.candidate, plan.candidate) &&
      source.normalizedSource.slice(plan.edit.from, plan.edit.to) === plan.edit.expectedText
    );
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
  const plan = currentTypoResultFor(payload, source, session);
  if (!plan) return;

  if (
    currentOpenDocumentFor(payload.uri) !== document ||
    document.version !== payload.documentVersion ||
    document.getText() !== payload.rawSource
  ) return;

  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(
    document.uri,
    vscodeRangeForNormalized(document, payload.rawSource, plan.edit),
    plan.candidate.label
  );
  await vscode.workspace.applyEdit(workspaceEdit);
};
