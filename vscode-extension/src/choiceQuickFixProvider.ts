import * as vscode from "vscode";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import { MISSING_DECLARED_TYPE_CODE } from "../../src/dsl/dslDeclarationParser";
import type {
  TypedVariableQuickFixDescriptor,
  TypedVariableQuickFixSplice
} from "../../src/scalars/typedVariableQuickFixes";
import { typedVariableQuickFixes } from "../../src/scalars/typedVariableQuickFixes";
import {
  toCompilerDiagnostic,
  type CompilerDiagnostic,
  type CompilerDiagnosticRange
} from "./compilerDiagnostics";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import { configureNuiTypoDiagnosticPresentation } from "./typoDiagnosticPresentation";
import {
  createNuiTypoQuickFixApplyHandler,
  createNuiTypoQuickFixProvider,
  NUI_TYPO_QUICK_FIX_APPLY_COMMAND
} from "./typoQuickFixProvider";

export const nuiChoiceQuickFixSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export const NUI_CHOICE_QUICK_FIX_APPLY_COMMAND = "nuinuiCAD.applyChoiceQuickFix";

const INVALID_CHOICE_LITERAL_CODE = "invalid-choice-literal";

type ChoiceDiagnosticFingerprint = {
  source: "nuinuiCAD";
  code: typeof INVALID_CHOICE_LITERAL_CODE;
  range: CompilerDiagnosticRange;
};

type MissingDeclaredTypeDiagnosticFingerprint = {
  source: "nuinuiCAD";
  code: typeof MISSING_DECLARED_TYPE_CODE;
  range: CompilerDiagnosticRange;
};

type NativeDiagnosticFingerprint =
  | ChoiceDiagnosticFingerprint
  | MissingDeclaredTypeDiagnosticFingerprint;

type ChoiceQuickFixPayload = {
  uri: string;
  documentVersion: number;
  rawSource: string;
  sourceRevision: number;
  targetDiagnostic: NativeDiagnosticFingerprint;
  descriptor: TypedVariableQuickFixDescriptor;
};

export type NuiChoiceQuickFixSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const isSupportedDocument = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.fileName.endsWith(".nui");

const fingerprintFor = (diagnostic: CompilerDiagnostic): ChoiceDiagnosticFingerprint | undefined => {
  if (diagnostic.source !== "nuinuiCAD" || diagnostic.code !== INVALID_CHOICE_LITERAL_CODE) return undefined;
  return {
    source: diagnostic.source,
    code: INVALID_CHOICE_LITERAL_CODE,
    range: diagnostic.range
  };
};

const missingDeclaredTypeFingerprintFor = (
  diagnostic: CompilerDiagnostic
): MissingDeclaredTypeDiagnosticFingerprint | undefined => {
  if (diagnostic.source !== "nuinuiCAD" || diagnostic.code !== MISSING_DECLARED_TYPE_CODE) return undefined;
  return {
    source: diagnostic.source,
    code: MISSING_DECLARED_TYPE_CODE,
    range: diagnostic.range
  };
};

const samePosition = (
  left: { line: number; character: number },
  right: { line: number; character: number }
): boolean => left.line === right.line && left.character === right.character;

const sameRange = (
  left: CompilerDiagnosticRange,
  right: { start: { line: number; character: number }; end: { line: number; character: number } }
): boolean =>
  samePosition(left.start, right.start) && samePosition(left.end, right.end);

const sameDiagnostic = (
  fingerprint: NativeDiagnosticFingerprint,
  diagnostic: {
    source?: string;
    code?: unknown;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  }
): boolean =>
  diagnostic.source === fingerprint.source &&
  diagnostic.code === fingerprint.code &&
  sameRange(fingerprint.range, diagnostic.range);

const contextDiagnosticFor = (
  fingerprint: NativeDiagnosticFingerprint,
  diagnostics: readonly vscode.Diagnostic[]
): vscode.Diagnostic | undefined => diagnostics.find((diagnostic) => sameDiagnostic(fingerprint, diagnostic));

const nativeDescriptorsFor = (
  code: NativeDiagnosticFingerprint["code"],
  descriptors: readonly TypedVariableQuickFixDescriptor[]
): TypedVariableQuickFixDescriptor[] => {
  if (code === INVALID_CHOICE_LITERAL_CODE) {
    return descriptors.filter((descriptor) => descriptor.id.startsWith("choice-replace:"));
  }
  if (code === MISSING_DECLARED_TYPE_CODE) {
    return descriptors.filter((descriptor) => descriptor.id.startsWith("missing-declared-type:"));
  }
  return [];
};

const payloadFor = (
  document: vscode.TextDocument,
  source: SourceSnapshot,
  diagnostic: NativeDiagnosticFingerprint,
  descriptor: TypedVariableQuickFixDescriptor
): ChoiceQuickFixPayload => ({
  uri: document.uri.toString(),
  documentVersion: document.version,
  rawSource: document.getText(),
  sourceRevision: source.sourceRevision,
  targetDiagnostic: diagnostic,
  descriptor: {
    ...descriptor,
    action: { ...descriptor.action }
  }
});

const createNuiChoiceOnlyQuickFixProvider = (
  sessionFor: NuiChoiceQuickFixSessionFor
): vscode.CodeActionProvider => ({
  provideCodeActions: (document, _range, context) => {
    if (!isSupportedDocument(document)) return [];

    const documentUri = document.uri.toString();
    const documentVersion = document.version;
    const rawSource = document.getText();
    const session = sessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);

    const source: SourceSnapshot = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: session.getSourceRevision()
    };
    const semantic = session.choiceQuickFixSemanticSnapshot(source);
    if (!semantic) return [];
    if (
      document.uri.toString() !== documentUri ||
      document.version !== documentVersion ||
      document.getText() !== rawSource
    ) return [];

    const descriptorsByDiagnostic = typedVariableQuickFixes(
      semantic.sourceText,
      semantic.currentCompiled.statements,
      semantic.currentCompiled.diagnostics
    );
    const actions: vscode.CodeAction[] = [];

    semantic.currentCompiled.diagnostics.forEach((diagnostic, index) => {
      const projected = toCompilerDiagnostic(semantic.sourceText, diagnostic);
      const fingerprint = projected && (
        fingerprintFor(projected) ?? missingDeclaredTypeFingerprintFor(projected)
      );
      if (!fingerprint) return;
      const target = contextDiagnosticFor(fingerprint, context.diagnostics);
      if (!target) return;

      const descriptors = nativeDescriptorsFor(fingerprint.code, descriptorsByDiagnostic[index] ?? []);
      for (const descriptor of descriptors) {
        const action = new vscode.CodeAction(descriptor.label, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [target];
        if (fingerprint.code === INVALID_CHOICE_LITERAL_CODE && descriptors.length === 1) {
          action.isPreferred = true;
        }
        action.command = {
          command: NUI_CHOICE_QUICK_FIX_APPLY_COMMAND,
          title: descriptor.label,
          arguments: [{
            ...payloadFor(document, source, fingerprint, descriptor),
            uri: documentUri,
            documentVersion,
            rawSource
          } satisfies ChoiceQuickFixPayload]
        };
        actions.push(action);
      }
    });

    return actions;
  }
});

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const isRange = (value: unknown): value is CompilerDiagnosticRange => {
  if (!value || typeof value !== "object") return false;
  const range = value as { start?: unknown; end?: unknown };
  const validPosition = (position: unknown): position is { line: number; character: number } => {
    if (!position || typeof position !== "object") return false;
    const candidate = position as { line?: unknown; character?: unknown };
    return isInteger(candidate.line) && isInteger(candidate.character);
  };
  return validPosition(range.start) && validPosition(range.end);
};

const isDescriptor = (value: unknown): value is TypedVariableQuickFixDescriptor => {
  if (!value || typeof value !== "object") return false;
  const descriptor = value as Partial<TypedVariableQuickFixDescriptor>;
  const action = descriptor.action as Partial<TypedVariableQuickFixSplice> | undefined;
  return typeof descriptor.id === "string" &&
    (descriptor.id.startsWith("choice-replace:") ||
      descriptor.id.startsWith("missing-declared-type:")) &&
    typeof descriptor.label === "string" &&
    typeof descriptor.sourceSnapshot === "string" &&
    action?.kind === "splice" &&
    isInteger(action.from) &&
    isInteger(action.to) &&
    typeof action.insert === "string" &&
    typeof action.expectedOldText === "string" &&
    isInteger(action.selection);
};

const isChoiceDiagnosticFingerprint = (value: unknown): value is ChoiceDiagnosticFingerprint => {
  if (!value || typeof value !== "object") return false;
  const diagnostic = value as Partial<ChoiceDiagnosticFingerprint>;
  return diagnostic.source === "nuinuiCAD" &&
    diagnostic.code === INVALID_CHOICE_LITERAL_CODE &&
    isRange(diagnostic.range);
};

const isMissingDeclaredTypeDiagnosticFingerprint = (
  value: unknown
): value is MissingDeclaredTypeDiagnosticFingerprint => {
  if (!value || typeof value !== "object") return false;
  const diagnostic = value as Partial<MissingDeclaredTypeDiagnosticFingerprint>;
  return diagnostic.source === "nuinuiCAD" &&
    diagnostic.code === MISSING_DECLARED_TYPE_CODE &&
    isRange(diagnostic.range);
};

const isPayload = (value: unknown): value is ChoiceQuickFixPayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ChoiceQuickFixPayload>;
  return typeof payload.uri === "string" &&
    isInteger(payload.documentVersion) &&
    typeof payload.rawSource === "string" &&
    isInteger(payload.sourceRevision) &&
    (isChoiceDiagnosticFingerprint(payload.targetDiagnostic) ||
      isMissingDeclaredTypeDiagnosticFingerprint(payload.targetDiagnostic)) &&
    isDescriptor(payload.descriptor);
};

const currentOpenDocumentFor = (uri: string): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri);

const descriptorMatches = (
  expected: TypedVariableQuickFixDescriptor,
  actual: TypedVariableQuickFixDescriptor
): boolean =>
  expected.id === actual.id &&
  expected.label === actual.label &&
  expected.sourceSnapshot === actual.sourceSnapshot &&
  expected.action.kind === actual.action.kind &&
  expected.action.from === actual.action.from &&
  expected.action.to === actual.action.to &&
  expected.action.insert === actual.action.insert &&
  expected.action.expectedOldText === actual.action.expectedOldText &&
  expected.action.selection === actual.action.selection;

const rawOffsetFromNormalized = (rawSource: string, normalizedOffset: number): number => {
  let rawOffset = 0;
  let normalizedPosition = 0;
  while (rawOffset < rawSource.length && normalizedPosition < normalizedOffset) {
    if (rawSource[rawOffset] === "\r" && rawSource[rawOffset + 1] === "\n") rawOffset += 1;
    rawOffset += 1;
    normalizedPosition += 1;
  }
  return rawOffset;
};

const descriptorForPayload = (
  payload: ChoiceQuickFixPayload,
  sourceText: string,
  session: NuiLanguageAnalysisSession
): TypedVariableQuickFixDescriptor | undefined => {
  const source: SourceSnapshot = {
    normalizedSource: normalizedSourceFor(sourceText),
    sourceRevision: payload.sourceRevision
  };
  const semantic = session.choiceQuickFixSemanticSnapshot(source);
  if (!semantic) return undefined;

  const descriptorsByDiagnostic = typedVariableQuickFixes(
    semantic.sourceText,
    semantic.currentCompiled.statements,
    semantic.currentCompiled.diagnostics
  );
  for (const [index, diagnostic] of semantic.currentCompiled.diagnostics.entries()) {
    const projected = toCompilerDiagnostic(semantic.sourceText, diagnostic);
    if (!projected || !sameDiagnostic(payload.targetDiagnostic, {
      source: projected.source,
      code: projected.code,
      range: projected.range
    })) continue;
    const descriptor = nativeDescriptorsFor(payload.targetDiagnostic.code, descriptorsByDiagnostic[index] ?? [])
      .find((candidate) => descriptorMatches(payload.descriptor, candidate));
    if (descriptor) return descriptor;
  }
  return undefined;
};

const createNuiChoiceOnlyQuickFixApplyHandler = (
  sessionFor: NuiChoiceQuickFixSessionFor
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
  const descriptor = descriptorForPayload(payload, currentRawSource, session);
  if (!descriptor) return;

  const normalizedSource = normalizedSourceFor(currentRawSource);
  if (descriptor.sourceSnapshot !== normalizedSource) return;
  const { from, to } = descriptor.action;
  if (
    !isInteger(from) ||
    !isInteger(to) ||
    from < 0 ||
    to < from ||
    to > normalizedSource.length ||
    normalizedSource.slice(from, to) !== descriptor.action.expectedOldText
  ) return;

  if (document.version !== payload.documentVersion || document.getText() !== payload.rawSource) return;

  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(
    document.uri,
    new vscode.Range(
      document.positionAt(rawOffsetFromNormalized(payload.rawSource, from)),
      document.positionAt(rawOffsetFromNormalized(payload.rawSource, to))
    ),
    descriptor.action.insert
  );
  await vscode.workspace.applyEdit(workspaceEdit);
};

export const createNuiChoiceQuickFixProvider = (
  sessionFor: NuiChoiceQuickFixSessionFor
): vscode.CodeActionProvider => {
  configureNuiTypoDiagnosticPresentation(() => vscode.env?.language ?? "en");
  const choiceProvider = createNuiChoiceOnlyQuickFixProvider(sessionFor);
  const typoProvider = createNuiTypoQuickFixProvider(sessionFor);

  return {
    provideCodeActions: (document, range, context, token) => {
      const choiceActions = choiceProvider.provideCodeActions(
        document,
        range,
        context,
        token
      ) as vscode.CodeAction[] | undefined;
      const typoActions = typoProvider.provideCodeActions(
        document,
        range,
        context,
        token
      ) as vscode.CodeAction[] | undefined;

      for (const action of typoActions ?? []) {
        if (action.command?.command !== NUI_TYPO_QUICK_FIX_APPLY_COMMAND) continue;
        action.command = { ...action.command, command: NUI_CHOICE_QUICK_FIX_APPLY_COMMAND };
      }
      return [...(choiceActions ?? []), ...(typoActions ?? [])];
    }
  };
};

export const createNuiChoiceQuickFixApplyHandler = (
  sessionFor: NuiChoiceQuickFixSessionFor
): (payload: unknown) => Promise<void> => {
  const choiceApply = createNuiChoiceOnlyQuickFixApplyHandler(sessionFor);
  const typoApply = createNuiTypoQuickFixApplyHandler(sessionFor);
  return async (payload) => {
    if (isPayload(payload)) {
      await choiceApply(payload);
      return;
    }
    await typoApply(payload);
  };
};
