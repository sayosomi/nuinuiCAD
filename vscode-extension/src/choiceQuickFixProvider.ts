import * as vscode from "vscode";
import { CONSTRUCTION_CATEGORY_MISMATCH_CODE } from "@nuinuicad/nui-language";
import type { SourceSnapshot } from "@nuinuicad/nui-language";
import { MISSING_DECLARED_TYPE_CODE } from "@nuinuicad/nui-language";
import type {
  TypedVariableQuickFixDescriptor,
  TypedVariableQuickFixSplice
} from "@nuinuicad/nui-language";
import {
  type CompilerDiagnostic,
  type CompilerDiagnosticRange
} from "./compilerDiagnostics";
import type {
  NuiLanguageSession,
  NuiQuickFixPlan,
  NuiQuickFixInput
} from "@nuinuicad/nui-language";
import { choiceQuickFixTranslatorFor } from "./choiceQuickFixLocalization";
import { configureNuiTypoDiagnosticPresentation } from "./typoDiagnosticPresentation";
import {
  createNuiTypoQuickFixApplyHandler,
  createNuiTypoQuickFixProvider,
  NUI_TYPO_QUICK_FIX_APPLY_COMMAND
} from "./typoQuickFixProvider";
import { normalizedSourceFor, vscodeRangeForNormalized } from "./sourceOffsetAdapter";

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

type ConstructionCategoryMismatchDiagnosticFingerprint = {
  source: "nuinuiCAD";
  code: typeof CONSTRUCTION_CATEGORY_MISMATCH_CODE;
  range: CompilerDiagnosticRange;
};

type NativeDiagnosticFingerprint =
  | ChoiceDiagnosticFingerprint
  | MissingDeclaredTypeDiagnosticFingerprint
  | ConstructionCategoryMismatchDiagnosticFingerprint;

type ChoiceQuickFixPayload = {
  uri: string;
  documentVersion: number;
  rawSource: string;
  sourceRevision: number;
  targetDiagnostic: NativeDiagnosticFingerprint;
  descriptor: TypedVariableQuickFixDescriptor;
};

type ConstructionCategoryQuickFixPayload = {
  uri: string;
  documentVersion: number;
  rawSource: string;
  sourceRevision: number;
  targetDiagnostic: ConstructionCategoryMismatchDiagnosticFingerprint;
  targetCategory: string;
};

export type NuiChoiceQuickFixSessionFor = (document: vscode.TextDocument) => NuiLanguageSession;

const vscodeDisplayLanguage = (): string => {
  try {
    return vscode.env?.language ?? "en";
  } catch {
    // Focused host mocks may omit vscode.env.
    return "en";
  }
};

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

const constructionCategoryMismatchFingerprintFor = (
  diagnostic: CompilerDiagnostic
): ConstructionCategoryMismatchDiagnosticFingerprint | undefined => {
  if (diagnostic.source !== "nuinuiCAD" || diagnostic.code !== CONSTRUCTION_CATEGORY_MISMATCH_CODE) return undefined;
  return {
    source: diagnostic.source,
    code: CONSTRUCTION_CATEGORY_MISMATCH_CODE,
    range: diagnostic.range
  };
};

const nativeFingerprintFor = (diagnostic: CompilerDiagnostic): NativeDiagnosticFingerprint | undefined =>
  fingerprintFor(diagnostic) ??
  missingDeclaredTypeFingerprintFor(diagnostic) ??
  constructionCategoryMismatchFingerprintFor(diagnostic);

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

const constructionCategoryPayloadFor = (
  document: vscode.TextDocument,
  source: SourceSnapshot,
  diagnostic: ConstructionCategoryMismatchDiagnosticFingerprint,
  targetCategory: string
): ConstructionCategoryQuickFixPayload => ({
  uri: document.uri.toString(),
  documentVersion: document.version,
  rawSource: document.getText(),
  sourceRevision: source.sourceRevision,
  targetDiagnostic: diagnostic,
  targetCategory
});

const createNuiChoiceOnlyQuickFixProvider = (
  sessionFor: NuiChoiceQuickFixSessionFor,
  displayLanguageFor: () => string
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
    if (
      document.uri.toString() !== documentUri ||
      document.version !== documentVersion ||
      document.getText() !== rawSource
    ) return [];

    const translate = choiceQuickFixTranslatorFor(displayLanguageFor());
    const actions: vscode.CodeAction[] = [];

    session.diagnostics().forEach((diagnostic) => {
      const fingerprint = nativeFingerprintFor(diagnostic);
      if (!fingerprint) return;
      const target = contextDiagnosticFor(fingerprint, context.diagnostics);
      if (!target) return;
      const plans = session.quickFixes(fingerprint as NuiQuickFixInput);

      if (fingerprint.code === CONSTRUCTION_CATEGORY_MISMATCH_CODE) {
        for (const plan of plans) {
          if (plan.kind !== "construction-category") continue;
          const title = translate("choiceQuickFix.changeCategory", { category: plan.targetCategory });
          const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
          action.diagnostics = [target];
          action.command = {
            command: NUI_CHOICE_QUICK_FIX_APPLY_COMMAND,
            title,
            arguments: [constructionCategoryPayloadFor(document, source, fingerprint, plan.targetCategory)]
          };
          actions.push(action);
        }
        return;
      }

      const typedPlans = plans.filter((plan): plan is Extract<NuiQuickFixPlan, { kind: "typed-variable" }> =>
        plan.kind === "typed-variable"
      );
      const descriptors = nativeDescriptorsFor(fingerprint.code, typedPlans.map((plan) => plan.descriptor));
      for (const descriptor of descriptors) {
        const title = fingerprint.code === INVALID_CHOICE_LITERAL_CODE
          ? translate("choiceQuickFix.replace", { candidate: descriptor.action.insert })
          : translate("choiceQuickFix.addDeclaredType");
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [target];
        if (fingerprint.code === INVALID_CHOICE_LITERAL_CODE && descriptors.length === 1) {
          action.isPreferred = true;
        }
        action.command = {
          command: NUI_CHOICE_QUICK_FIX_APPLY_COMMAND,
          title,
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

const isConstructionCategoryMismatchDiagnosticFingerprint = (
  value: unknown
): value is ConstructionCategoryMismatchDiagnosticFingerprint => {
  if (!value || typeof value !== "object") return false;
  const diagnostic = value as Partial<ConstructionCategoryMismatchDiagnosticFingerprint>;
  return diagnostic.source === "nuinuiCAD" &&
    diagnostic.code === CONSTRUCTION_CATEGORY_MISMATCH_CODE &&
    isRange(diagnostic.range);
};

const isChoiceQuickFixPayload = (value: unknown): value is ChoiceQuickFixPayload => {
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

const isConstructionCategoryQuickFixPayload = (
  value: unknown
): value is ConstructionCategoryQuickFixPayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ConstructionCategoryQuickFixPayload>;
  return typeof payload.uri === "string" &&
    isInteger(payload.documentVersion) &&
    typeof payload.rawSource === "string" &&
    isInteger(payload.sourceRevision) &&
    isConstructionCategoryMismatchDiagnosticFingerprint(payload.targetDiagnostic) &&
    typeof payload.targetCategory === "string" &&
    payload.targetCategory.length > 0;
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

const descriptorForPayload = (
  payload: ChoiceQuickFixPayload,
  sourceText: string,
  session: NuiLanguageSession
): TypedVariableQuickFixDescriptor | undefined => {
  if (session.getSource() !== sourceText || session.getSourceRevision() !== payload.sourceRevision) return undefined;
  const plans = session.quickFixes(payload.targetDiagnostic as NuiQuickFixInput);
  return plans
    .filter((plan): plan is Extract<NuiQuickFixPlan, { kind: "typed-variable" }> => plan.kind === "typed-variable")
    .map((plan) => plan.descriptor)
    .find((candidate) => descriptorMatches(payload.descriptor, candidate));
};

const categoryPlanForPayload = (
  payload: ConstructionCategoryQuickFixPayload,
  sourceText: string,
  session: NuiLanguageSession
): Extract<NuiQuickFixPlan, { kind: "construction-category" }> | undefined => {
  if (session.getSource() !== sourceText || session.getSourceRevision() !== payload.sourceRevision) return undefined;
  return session.quickFixes(payload.targetDiagnostic as NuiQuickFixInput)
    .filter((plan): plan is Extract<NuiQuickFixPlan, { kind: "construction-category" }> =>
      plan.kind === "construction-category"
    )
    .find((plan) => plan.targetCategory === payload.targetCategory);
};

const createNuiConstructionCategoryQuickFixApplyHandler = (
  sessionFor: NuiChoiceQuickFixSessionFor
): (payload: unknown) => Promise<void> => async (rawPayload) => {
  if (!isConstructionCategoryQuickFixPayload(rawPayload)) return;
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
  const source = {
    normalizedSource: normalizedSourceFor(currentRawSource),
    sourceRevision: payload.sourceRevision
  } satisfies SourceSnapshot;
  const plan = categoryPlanForPayload(payload, currentRawSource, session);
  if (!plan || plan.targetCategory !== payload.targetCategory) return;

  const { edit } = plan;
  if (
    edit.newText !== payload.targetCategory ||
    !isInteger(edit.from) ||
    !isInteger(edit.to) ||
    edit.from < 0 ||
    edit.to <= edit.from ||
    edit.to > source.normalizedSource.length ||
    source.normalizedSource.slice(edit.from, edit.to) !== edit.expectedText
  ) return;

  if (document.version !== payload.documentVersion || document.getText() !== payload.rawSource) return;

  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(
    document.uri,
    vscodeRangeForNormalized(document, payload.rawSource, { from: edit.from, to: edit.to }),
    payload.targetCategory
  );
  await vscode.workspace.applyEdit(workspaceEdit);
};

const createNuiChoiceOnlyQuickFixApplyHandler = (
  sessionFor: NuiChoiceQuickFixSessionFor
): (payload: unknown) => Promise<void> => async (rawPayload) => {
  if (!isChoiceQuickFixPayload(rawPayload)) return;
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
    vscodeRangeForNormalized(document, payload.rawSource, { from, to }),
    descriptor.action.insert
  );
  await vscode.workspace.applyEdit(workspaceEdit);
};

export const createNuiChoiceQuickFixProvider = (
  sessionFor: NuiChoiceQuickFixSessionFor,
  displayLanguageFor: () => string = vscodeDisplayLanguage
): vscode.CodeActionProvider => {
  configureNuiTypoDiagnosticPresentation(displayLanguageFor);
  const choiceProvider = createNuiChoiceOnlyQuickFixProvider(sessionFor, displayLanguageFor);
  const typoProvider = createNuiTypoQuickFixProvider(sessionFor, displayLanguageFor);

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
  const categoryApply = createNuiConstructionCategoryQuickFixApplyHandler(sessionFor);
  const typoApply = createNuiTypoQuickFixApplyHandler(sessionFor);
  return async (payload) => {
    if (isConstructionCategoryQuickFixPayload(payload)) {
      await categoryApply(payload);
      return;
    }
    if (isChoiceQuickFixPayload(payload)) {
      await choiceApply(payload);
      return;
    }
    await typoApply(payload);
  };
};
