import * as vscode from "vscode";
import { applyLineSplices, type LineSplice } from "../../src/document/textPatch";
import type { StatementIdentity } from "../../src/document/statementIdentity";
import { resolveModulePreviewValueStep } from "../../src/dsl/modulePreviewValueStep";
import { queryModulePreviewTarget } from "../../src/dsl/modulePreviewTarget";
import { moduleGeometryInterfaceTypeOf } from "../../src/dsl/moduleGeometryInterfaces";
import { currentModulePreviewTargetByIdentity } from "../../src/vscode/modulePreviewLifecycle";
import {
  isCanonicalReferencePickReference,
  referencePickReferenceKey,
  referencePickSourceForReference
} from "../../src/vscode/referencePickProtocol";
import type {
  ExtensionToVscodeMessage,
  VscodeModulePreviewParameterSnapshot,
  VscodeModulePreviewParametersUnavailable,
  VscodeModulePreviewParameterSetValue,
  VscodeModulePreviewParameterSetValueRequest,
  VscodeModulePreviewParameterUseDefault,
  VscodeModulePreviewParameterUseDefaultRequest,
  VscodeModulePreviewParameterValueBlur,
  VscodeModulePreviewParameterValueFocus,
  VscodeModulePreviewParameterReferencePickStartRequest,
  VscodeModulePreviewModelPatchRequest,
  VscodeModulePreviewModelPatchResult,
  VscodeModulePreviewReferencePickResult,
  VscodeModulePreviewReferencePickStartRequest,
  VscodeCanvasCommandId,
  VscodeBakeSettings,
  VscodeDocumentChangeReason,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";
import type { VscodeCanvasRibbon } from "../../src/vscode/vscodeCanvasRibbonConfig";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import { modulePreviewTranslatorFor } from "./modulePreviewLocalization";
import { normalizedOffsetFromRaw, normalizedSourceFor } from "./sourceOffsetAdapter";
import {
  handoffOutputPreviewHistory,
  type OutputPreviewHistoryDirection
} from "./outputPreviewHistory";
import { applySourceLineSplices } from "./textDocumentLineSplices";

export const NUI_MODULE_PREVIEW_VIEW_TYPE = "nuinuiCAD.modulePreview";
export const NUI_MODULE_PREVIEW_SOURCE_TARGET_CONTEXT = "nuinuiCAD.modulePreviewSourceTarget";
export const NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT = "nuinuiCAD.modulePreviewValueInputFocus";
export const NUI_MODULE_PREVIEW_VALUE_STEP_FORWARD_COMMAND_ID = "nuinuiCAD.modulePreviewValueStepForward.keybinding";
export const NUI_MODULE_PREVIEW_VALUE_STEP_BACKWARD_COMMAND_ID = "nuinuiCAD.modulePreviewValueStepBackward.keybinding";

const nonWritingCanvasCommands = new Set<VscodeCanvasCommandId>([
  "clearCanvasSelection",
  "resetCanvasView",
  "fitDrawing",
  "toggleCanvasPointNames",
  "toggleCanvasGeometryNames",
  "toggleCanvasElementNames",
  "toggleCanvasPoints"
]);

const bakeCanvasCommands = new Set<VscodeCanvasCommandId>([
  "bakeCurrentShape",
  "bakeBaseShape"
]);

type ModulePreviewPendingTarget =
  | { kind: "target"; documentVersion: number; normalizedSourceOffset: number }
  | { kind: "unavailable"; documentVersion: number };

type ModulePreviewSession = {
  documentUri: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  sessionId: string;
  targetDefinitionStatementId: StatementIdentity;
  webviewReady: boolean;
  authoritativeDocumentVersion: number | null;
  pendingTarget: ModulePreviewPendingTarget | null;
  retainedParameterMessage: VscodeModulePreviewParameterSnapshot | VscodeModulePreviewParametersUnavailable | null;
  activeReferencePick: {
    request: VscodeModulePreviewReferencePickStartRequest;
    candidateReferenceKeys: Set<string> | null;
  } | null;
  disposables: vscode.Disposable[];
};

type ModulePreviewParameterMessage =
  | VscodeModulePreviewParameterSnapshot
  | VscodeModulePreviewParametersUnavailable;

export type ModulePreviewFeature = vscode.Disposable & {
  postCanvasCommandIfActive: (commandId: VscodeCanvasCommandId) => boolean;
  postBakeCommandIfActive: (commandId: VscodeCanvasCommandId, settings: VscodeBakeSettings) => boolean;
  handoffNativeHistoryIfActive: (direction: OutputPreviewHistoryDirection) => boolean;
  attachParameterView: (webview: vscode.Webview) => vscode.Disposable;
};

export type RegisterModulePreviewFeatureOptions = {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  canvasThemeGeneration: () => number;
  webviewHtml: (panel: vscode.WebviewPanel) => string;
  canvasRibbons: () => VscodeCanvasRibbon[];
  updateCanvasRibbonPosition: (ribbonId: string, x: number, y: number) => Promise<void> | void;
  editCanvasRibbon: () => void;
  evaluateWithRust: (input: unknown) => Promise<unknown>;
  presentBakeOperationResult?: (
    message: Extract<VscodeToExtensionMessage, { type: "bakeOperationResult" }>
  ) => Promise<void> | void;
  displayLanguageFor?: () => string;
};

const vscodeDisplayLanguage = (): string => {
  try {
    return vscode.env?.language ?? "en";
  } catch {
    return "en";
  }
};

const isSupportedNuiDocument = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.fileName.endsWith(".nui");

const documentKey = (document: vscode.TextDocument): string => document.uri.toString();

const isModulePreviewParameterSetValueRequest = (
  message: unknown
): message is VscodeModulePreviewParameterSetValueRequest => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParameterSetValueRequest>;
  return candidate.type === "modulePreviewParameterSetValue" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof candidate.targetDefinitionStatementId === "string" &&
    typeof candidate.definitionStatementId === "string" &&
    Number.isInteger(candidate.parameterIndex) &&
    typeof candidate.expression === "string";
};

const isModulePreviewParameterUseDefaultRequest = (
  message: unknown
): message is VscodeModulePreviewParameterUseDefaultRequest => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParameterUseDefaultRequest>;
  return candidate.type === "modulePreviewParameterUseDefault" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof candidate.targetDefinitionStatementId === "string" &&
    typeof candidate.definitionStatementId === "string" &&
    Number.isInteger(candidate.parameterIndex);
};

const isModulePreviewParameterValueFocus = (
  message: unknown
): message is VscodeModulePreviewParameterValueFocus => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParameterValueFocus>;
  return candidate.type === "modulePreviewParameterValueFocus" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof candidate.targetDefinitionStatementId === "string" &&
    typeof candidate.definitionStatementId === "string" &&
    Number.isInteger(candidate.parameterIndex) &&
    typeof candidate.value === "string" &&
    Number.isInteger(candidate.selectionStart) &&
    Number.isInteger(candidate.selectionEnd) &&
    Number.isInteger(candidate.focusGeneration) &&
    candidate.focusGeneration > 0;
};

const isModulePreviewParameterValueBlur = (
  message: unknown
): message is VscodeModulePreviewParameterValueBlur => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParameterValueBlur>;
  return candidate.type === "modulePreviewParameterValueBlur" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof candidate.targetDefinitionStatementId === "string" &&
    typeof candidate.definitionStatementId === "string" &&
    Number.isInteger(candidate.parameterIndex) &&
    Number.isInteger(candidate.focusGeneration) &&
    candidate.focusGeneration > 0;
};

const isModulePreviewParameterReferencePickStart = (
  message: unknown
): message is VscodeModulePreviewParameterReferencePickStartRequest => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParameterReferencePickStartRequest>;
  return candidate.type === "modulePreviewParameterReferencePickStart" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof candidate.targetDefinitionStatementId === "string" &&
    typeof candidate.definitionStatementId === "string" &&
    Number.isInteger(candidate.parameterIndex);
};

const isModulePreviewReferencePickResult = (
  message: unknown
): message is VscodeModulePreviewReferencePickResult => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewReferencePickResult>;
  if (
    candidate.type !== "modulePreviewReferencePickResult" ||
    !Number.isInteger(candidate.requestId) ||
    typeof candidate.sessionId !== "string" ||
    typeof candidate.documentUri !== "string" ||
    !Number.isInteger(candidate.documentVersion) ||
    !Number.isInteger(candidate.sourceRevision) ||
    !Number.isInteger(candidate.sessionRevision) ||
    typeof candidate.targetDefinitionStatementId !== "string" ||
    typeof candidate.definitionStatementId !== "string" ||
    !Number.isInteger(candidate.parameterIndex) ||
    (candidate.expectedGeometryInterface !== "point" &&
      candidate.expectedGeometryInterface !== "line" &&
      candidate.expectedGeometryInterface !== "path") ||
    candidate.role !== "geometry" ||
    candidate.multiplicity !== "single"
  ) return false;
  if (candidate.status === "started") {
    return Array.isArray(candidate.candidateReferences) &&
      candidate.candidateReferences.every(isCanonicalReferencePickReference);
  }
  if (candidate.status === "confirmed") {
    return candidate.resultKind === "geometry" &&
      Array.isArray(candidate.references) &&
      candidate.references.length === 1 &&
      candidate.references.every(isCanonicalReferencePickReference);
  }
  return candidate.status === "canceled" || candidate.status === "stale" || candidate.status === "rejected";
};

const isModulePreviewParameterViewReady = (message: unknown): boolean =>
  typeof message === "object" && message !== null &&
  (message as { type?: unknown }).type === "modulePreviewParametersViewReady";

const isModulePreviewParameterSnapshot = (
  message: unknown
): message is VscodeModulePreviewParameterSnapshot => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParameterSnapshot>;
  const target = candidate.target;
  return candidate.type === "modulePreviewParameterSnapshot" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof target === "object" && target !== null &&
    typeof target.definitionStatementId === "string" &&
    Number.isInteger(target.definitionStatementIndex) &&
    typeof target.name === "string" &&
    Array.isArray(candidate.ancestorContexts) &&
    typeof candidate.parameters === "object" && candidate.parameters !== null &&
    Array.isArray(candidate.parameters.parameters) &&
    Array.isArray(candidate.inputDiagnostics) &&
    (candidate.previewStatus === "current" ||
      candidate.previewStatus === "lastGood" ||
      candidate.previewStatus === "noValidPreview");
};

const isModulePreviewParametersUnavailable = (
  message: unknown
): message is VscodeModulePreviewParametersUnavailable => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewParametersUnavailable>;
  return candidate.type === "modulePreviewParametersUnavailable" &&
    (candidate.sessionId === null || typeof candidate.sessionId === "string") &&
    (candidate.documentUri === null || typeof candidate.documentUri === "string") &&
    (candidate.documentVersion === null || Number.isInteger(candidate.documentVersion)) &&
    (candidate.sourceRevision === null || Number.isInteger(candidate.sourceRevision)) &&
    Number.isInteger(candidate.sessionRevision) &&
    (candidate.targetDefinitionStatementId === null || typeof candidate.targetDefinitionStatementId === "string") &&
    (candidate.reason === "no-session" || candidate.reason === "not-ready" ||
      candidate.reason === "source-stale" || candidate.reason === "target-unavailable" ||
      candidate.reason === "disposed");
};

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || documentKey(left) === documentKey(right);

const isOpenDocument = (document: vscode.TextDocument): boolean => {
  const openDocuments = vscode.workspace.textDocuments;
  return !openDocuments || openDocuments.some((candidate) => sameDocument(candidate, document));
};

const visibleEditorFor = (document: vscode.TextDocument): vscode.TextEditor | undefined =>
  (vscode.window.visibleTextEditors ?? []).find((editor) => sameDocument(editor.document, document));

const isLineSplice = (value: unknown): value is LineSplice => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LineSplice>;
  return Number.isInteger(candidate.startLine) &&
    Number.isInteger(candidate.endLine) &&
    candidate.startLine > 0 &&
    candidate.endLine >= candidate.startLine - 1 &&
    Array.isArray(candidate.replacementLines) &&
    candidate.replacementLines.every((line) => typeof line === "string");
};

const isModulePreviewModelPatchRequest = (
  message: unknown
): message is VscodeModulePreviewModelPatchRequest => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewModelPatchRequest>;
  return candidate.type === "modulePreviewModelPatch" &&
    Number.isInteger(candidate.operationId) &&
    candidate.operationId > 0 &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.expectedDocumentVersion) &&
    candidate.expectedDocumentVersion >= 0 &&
    Number.isInteger(candidate.sourceRevision) &&
    candidate.sourceRevision >= 0 &&
    Number.isInteger(candidate.previewRevision) &&
    candidate.previewRevision > 0 &&
    typeof candidate.targetDefinitionStatementId === "string" &&
    Array.isArray(candidate.sourceOwners) &&
    candidate.sourceOwners.length > 0 &&
    candidate.sourceOwners.every((owner) =>
      typeof owner === "object" && owner !== null &&
      typeof owner.runtimeElementId === "string" && owner.runtimeElementId.length > 0 &&
      typeof owner.sourceStatementId === "string" && owner.sourceStatementId.length > 0
    ) &&
    new Set(candidate.sourceOwners.map((owner) => owner.runtimeElementId)).size === candidate.sourceOwners.length &&
    typeof candidate.normalizedSource === "string" &&
    typeof candidate.expectedPatchedSource === "string" &&
    Array.isArray(candidate.splices) &&
    candidate.splices.length > 0 &&
    candidate.splices.every(isLineSplice);
};

const documentChangeReasonFor = (
  reason: vscode.TextDocumentChangeReason | undefined
): VscodeDocumentChangeReason => reason === vscode.TextDocumentChangeReason.Undo
  ? "undo"
  : reason === vscode.TextDocumentChangeReason.Redo
    ? "redo"
    : "edit";

const exactTargetAtEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSessionFor: RegisterModulePreviewFeatureOptions["languageAnalysisSessionFor"]
) => {
  if (!isSupportedNuiDocument(editor.document)) return null;
  const document = editor.document;
  const rawSource = document.getText();
  const analysis = languageAnalysisSessionFor(document);
  if (analysis.getSource() !== rawSource) analysis.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: analysis.getSourceRevision()
  };
  const semantic = analysis.definitionSemanticSnapshot(source);
  if (!semantic?.compiled) return null;
  const caretOffset = normalizedOffsetFromRaw(
    rawSource,
    document.offsetAt(editor.selection.active)
  );
  const target = queryModulePreviewTarget({ source, position: caretOffset, semantic });
  if (!target) return null;
  const targetStatement = semantic.compiled.statements[target.definitionStatementIndex];
  if (!targetStatement || targetStatement.kind !== "moduleDefinition") return null;
  return { target, normalizedSourceOffset: targetStatement.documentRange.from };
};

export const registerModulePreviewFeature = ({
  languageAnalysisSessionFor,
  canvasThemeGeneration,
  webviewHtml,
  canvasRibbons,
  updateCanvasRibbonPosition,
  editCanvasRibbon,
  evaluateWithRust,
  presentBakeOperationResult,
  displayLanguageFor = vscodeDisplayLanguage
}: RegisterModulePreviewFeatureOptions): ModulePreviewFeature => {
  const sessions = new Map<string, ModulePreviewSession>();
  const disposables: vscode.Disposable[] = [];
  let contextUpdate: Promise<void> = Promise.resolve();
  let nextSessionGeneration = 1;
  let nextReferencePickRequestId = 1;
  let parameterWebview: vscode.Webview | null = null;
  let parameterWebviewDisposable: vscode.Disposable | null = null;
  let boundParameterSession: ModulePreviewSession | null = null;
  let focusedPreviewValue: VscodeModulePreviewParameterValueFocus | null = null;
  let pendingSelectionRestoration: {
    sessionId: string;
    documentUri: string;
    documentVersion: number;
    sourceRevision: number;
    targetDefinitionStatementId: StatementIdentity;
    definitionStatementId: StatementIdentity;
    parameterIndex: number;
    focusGeneration: number;
    previousValue: string;
    expectedValue: string;
    selectionStart: number;
    selectionEnd: number;
  } | null = null;

  const cancelActiveReferencePick = (session: ModulePreviewSession): void => {
    const active = session.activeReferencePick;
    if (!active) return;
    session.activeReferencePick = null;
    if (!session.webviewReady) return;
    void session.panel.webview.postMessage({
      type: "modulePreviewReferencePickCancelRequest",
      requestId: active.request.requestId,
      sessionId: active.request.sessionId,
      documentUri: active.request.documentUri,
      documentVersion: active.request.documentVersion
    } satisfies ExtensionToVscodeMessage);
  };

  const nextSessionId = (): string => {
    const sessionId = `module-preview-session:${nextSessionGeneration}`;
    nextSessionGeneration += 1;
    return sessionId;
  };

  const setContext = (key: string, enabled: boolean): void => {
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => vscode.commands.executeCommand("setContext", key, enabled))
      .then(() => undefined);
  };

  const clearFocusedPreviewValue = (): void => {
    const wasOwned = focusedPreviewValue !== null;
    focusedPreviewValue = null;
    pendingSelectionRestoration = null;
    if (wasOwned) setContext(NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT, false);
  };

  const postParameterMessage = (
    message: ModulePreviewParameterMessage
  ): void => {
    if (parameterWebview) void parameterWebview.postMessage(message);
  };

  const retainParameterMessage = (
    session: ModulePreviewSession,
    message: ModulePreviewParameterMessage
  ): void => {
    if (
      session.activeReferencePick &&
      (message.type !== "modulePreviewParameterSnapshot" ||
        message.sessionRevision !== session.activeReferencePick.request.sessionRevision)
    ) cancelActiveReferencePick(session);
    if (message.type === "modulePreviewParametersUnavailable") clearFocusedPreviewValue();
    session.retainedParameterMessage = message;
    if (
      message.type === "modulePreviewParameterSnapshot" &&
      focusedPreviewValue &&
      (focusedPreviewValue.sessionId !== message.sessionId ||
        focusedPreviewValue.documentUri !== message.documentUri ||
        focusedPreviewValue.documentVersion !== message.documentVersion ||
        focusedPreviewValue.sourceRevision !== message.sourceRevision ||
        focusedPreviewValue.targetDefinitionStatementId !== message.target.definitionStatementId)
    ) setContext(NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT, false);
    if (boundParameterSession === session) postParameterMessage(message);
    maybeRestorePendingSelection(session, message);
  };

  const sourceContextFor = (session: ModulePreviewSession) => {
    const rawSource = session.document.getText();
    const analysis = languageAnalysisSessionFor(session.document);
    if (analysis.getSource() !== rawSource) analysis.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: analysis.getSourceRevision()
    };
    return {
      source,
      semantic: analysis.definitionSemanticSnapshot(source)
    };
  };

  const currentTargetFor = (session: ModulePreviewSession) => {
    const { source, semantic } = sourceContextFor(session);
    return {
      sourceRevision: source.sourceRevision,
      target: currentModulePreviewTargetByIdentity({
        source,
        semantic,
        definitionStatementId: session.targetDefinitionStatementId
      })?.target ?? null
    };
  };

  const historySessionIsCurrent = (session: ModulePreviewSession): boolean => {
    if (
      sessions.get(session.documentUri) !== session ||
      !session.webviewReady ||
      !isOpenDocument(session.document)
    ) return false;
    return true;
  };

  const historySessionIsAuthoritative = (session: ModulePreviewSession): boolean => {
    if (
      !historySessionIsCurrent(session) ||
      session.authoritativeDocumentVersion !== session.document.version
    ) return false;
    const current = currentTargetFor(session);
    return current.target?.definitionStatementId === session.targetDefinitionStatementId;
  };

  const handoffNativeHistoryIfActive = (direction: OutputPreviewHistoryDirection): boolean => {
    const session = [...sessions.values()].find((candidate) => candidate.panel.active);
    if (!session || !historySessionIsAuthoritative(session)) return false;
    const expectedDocumentVersion = session.document.version;
    let nativeHistoryStarted = false;

    void handoffOutputPreviewHistory(direction, {
      isSessionCurrent: () => historySessionIsCurrent(session) &&
        (nativeHistoryStarted || session.authoritativeDocumentVersion === expectedDocumentVersion),
      isPanelActive: () => session.panel.active,
      isDocumentOpen: () => isOpenDocument(session.document),
      documentVersion: () => session.document.version,
      activateMatchingSource: async () => {
        const editor = visibleEditorFor(session.document);
        if (!editor) return false;
        try {
          const activatedEditor = await vscode.window.showTextDocument(session.document, {
            viewColumn: editor.viewColumn,
            preserveFocus: false,
            preview: false
          });
          return sameDocument(activatedEditor.document, session.document);
        } catch {
          return false;
        }
      },
      executeNativeHistory: async (nativeDirection) => {
        nativeHistoryStarted = true;
        await vscode.commands.executeCommand(nativeDirection);
      },
      restorePreviewFocus: () => session.panel.reveal(undefined, false)
    });
    return true;
  };

  const parameterUnavailableFor = (
    session: ModulePreviewSession,
    reason: VscodeModulePreviewParametersUnavailable["reason"]
  ): VscodeModulePreviewParametersUnavailable => ({
    type: "modulePreviewParametersUnavailable",
    sessionId: session.sessionId,
    documentUri: session.documentUri,
    documentVersion: session.document.version,
    sourceRevision: currentTargetFor(session).sourceRevision,
    sessionRevision: session.retainedParameterMessage?.sessionId === session.sessionId
      ? session.retainedParameterMessage.sessionRevision
      : 0,
    targetDefinitionStatementId: session.targetDefinitionStatementId,
    reason
  });

  const publishParameterUnavailable = (
    session: ModulePreviewSession,
    reason: Exclude<VscodeModulePreviewParametersUnavailable["reason"], "no-session">
  ): void => {
    retainParameterMessage(session, parameterUnavailableFor(session, reason));
  };

  const clearParameterBinding = (): void => {
    boundParameterSession = null;
    clearFocusedPreviewValue();
    for (const session of sessions.values()) cancelActiveReferencePick(session);
    postParameterMessage({
      type: "modulePreviewParametersUnavailable",
      sessionId: null,
      documentUri: null,
      documentVersion: null,
      sourceRevision: null,
      sessionRevision: 0,
      targetDefinitionStatementId: null,
      reason: "no-session"
    });
  };

  const bindParameterSession = (session: ModulePreviewSession): void => {
    if (boundParameterSession !== session) clearFocusedPreviewValue();
    boundParameterSession = session;
    const retained = session.retainedParameterMessage;
    if (retained && isCurrentParameterMessage(session, retained)) {
      postParameterMessage(retained);
      return;
    }
    const current = currentTargetFor(session);
    const reason = !current.target
      ? "target-unavailable"
      : session.authoritativeDocumentVersion !== session.document.version
        ? "source-stale"
        : "not-ready";
    publishParameterUnavailable(session, reason);
  };

  const postSessionIdentity = (session: ModulePreviewSession): void => {
    void session.panel.webview.postMessage({
      type: "modulePreviewSession",
      sessionId: session.sessionId,
      documentUri: session.documentUri
    } satisfies ExtensionToVscodeMessage);
  };

  const parameterRowFor = (
    snapshot: VscodeModulePreviewParameterSnapshot,
    definitionStatementId: StatementIdentity,
    parameterIndex: number
  ) => [
    ...snapshot.ancestorContexts.flatMap((group) => group.parameters),
    ...snapshot.parameters.parameters
  ].find((parameter) =>
    parameter.definitionStatementId === definitionStatementId &&
    parameter.parameterIndex === parameterIndex
  );

  const currentParameterSnapshot = (session: ModulePreviewSession): VscodeModulePreviewParameterSnapshot | null =>
    session.retainedParameterMessage?.type === "modulePreviewParameterSnapshot"
      ? session.retainedParameterMessage
      : null;

  const focusedPreviewValueMatches = (
    session: ModulePreviewSession,
    snapshot: VscodeModulePreviewParameterSnapshot,
    focus: VscodeModulePreviewParameterValueFocus,
    allowOlderSessionRevision: boolean
  ) => {
    if (
      boundParameterSession !== session ||
      !session.webviewReady ||
      session.authoritativeDocumentVersion !== session.document.version ||
      focus.sessionId !== session.sessionId ||
      focus.documentUri !== session.documentUri ||
      focus.documentVersion !== session.document.version ||
      focus.sourceRevision !== snapshot.sourceRevision ||
      (!allowOlderSessionRevision && focus.sessionRevision !== snapshot.sessionRevision) ||
      (allowOlderSessionRevision && focus.sessionRevision > snapshot.sessionRevision) ||
      focus.targetDefinitionStatementId !== snapshot.target.definitionStatementId ||
      focus.focusGeneration < 1 ||
      focus.selectionStart < 0 ||
      focus.selectionEnd < focus.selectionStart ||
      focus.selectionEnd > focus.value.length
    ) return null;
    const current = currentTargetFor(session);
    if (
      !current.target ||
      current.sourceRevision !== snapshot.sourceRevision ||
      current.target.definitionStatementId !== snapshot.target.definitionStatementId ||
      current.target.definitionStatementIndex !== snapshot.target.definitionStatementIndex ||
      current.target.name !== snapshot.target.name
    ) return null;
    const row = parameterRowFor(snapshot, focus.definitionStatementId, focus.parameterIndex);
    return row ? { row } : null;
  };

  const sameFocusedPreviewIdentity = (
    left: VscodeModulePreviewParameterValueFocus,
    right: VscodeModulePreviewParameterValueFocus
  ): boolean => left.sessionId === right.sessionId &&
    left.documentUri === right.documentUri &&
    left.documentVersion === right.documentVersion &&
    left.sourceRevision === right.sourceRevision &&
    left.targetDefinitionStatementId === right.targetDefinitionStatementId &&
    left.definitionStatementId === right.definitionStatementId &&
    left.parameterIndex === right.parameterIndex &&
    left.focusGeneration === right.focusGeneration;

  const sameFocusedPreviewBinding = (
    left: VscodeModulePreviewParameterValueFocus,
    right: Pick<VscodeModulePreviewParameterValueFocus, "sessionId" | "documentUri" | "documentVersion" | "sourceRevision" | "targetDefinitionStatementId" | "definitionStatementId" | "parameterIndex">
  ): boolean => left.sessionId === right.sessionId &&
    left.documentUri === right.documentUri &&
    left.documentVersion === right.documentVersion &&
    left.sourceRevision === right.sourceRevision &&
    left.targetDefinitionStatementId === right.targetDefinitionStatementId &&
    left.definitionStatementId === right.definitionStatementId &&
    left.parameterIndex === right.parameterIndex;

  const sameFocusedPreviewProof = (
    focus: VscodeModulePreviewParameterValueFocus,
    blur: VscodeModulePreviewParameterValueBlur
  ): boolean => focus.sessionId === blur.sessionId &&
    focus.documentUri === blur.documentUri &&
    focus.documentVersion === blur.documentVersion &&
    focus.sourceRevision === blur.sourceRevision &&
    focus.sessionRevision === blur.sessionRevision &&
    focus.targetDefinitionStatementId === blur.targetDefinitionStatementId &&
    focus.definitionStatementId === blur.definitionStatementId &&
    focus.parameterIndex === blur.parameterIndex &&
    focus.focusGeneration === blur.focusGeneration;

  const maybeRestorePendingSelection = (
    session: ModulePreviewSession,
    message: ModulePreviewParameterMessage
  ): void => {
    const pending = pendingSelectionRestoration;
    if (!pending || message.type !== "modulePreviewParameterSnapshot" || boundParameterSession !== session) return;
    const focus = focusedPreviewValue;
    const row = parameterRowFor(message, pending.definitionStatementId, pending.parameterIndex);
    if (
      !focus ||
      !row ||
      !sameFocusedPreviewBinding(focus, pending) ||
      (focus.value !== pending.previousValue && focus.value !== pending.expectedValue) ||
      row.value !== pending.expectedValue
    ) {
      pendingSelectionRestoration = null;
      return;
    }
    if (
      !focusedPreviewValueMatches(session, message, focus, false) ||
      focus.focusGeneration <= pending.focusGeneration ||
      focus.value !== row.value ||
      focus.selectionStart < 0 ||
      focus.selectionEnd < focus.selectionStart ||
      focus.selectionEnd > row.value.length
    ) return;
    pendingSelectionRestoration = null;
    postParameterMessage({
      type: "modulePreviewRestoreParameterValueSelection",
      sessionId: message.sessionId,
      documentUri: message.documentUri,
      documentVersion: message.documentVersion,
      sourceRevision: message.sourceRevision,
      sessionRevision: message.sessionRevision,
      targetDefinitionStatementId: message.target.definitionStatementId,
      definitionStatementId: pending.definitionStatementId,
      parameterIndex: pending.parameterIndex,
      value: pending.expectedValue,
      selectionStart: pending.selectionStart,
      selectionEnd: pending.selectionEnd,
      focusGeneration: focus.focusGeneration
    });
  };

  const isCurrentParameterMessage = (
    session: ModulePreviewSession,
    message: ModulePreviewParameterMessage
  ): boolean => {
    if (
      message.sessionId !== session.sessionId ||
      message.documentUri !== session.documentUri ||
      message.documentVersion !== session.document.version
    ) return false;
    const current = currentTargetFor(session);
    if (message.type === "modulePreviewParametersUnavailable") {
      return message.sourceRevision === current.sourceRevision &&
        (message.targetDefinitionStatementId === null ||
          message.targetDefinitionStatementId === session.targetDefinitionStatementId);
    }
    return Boolean(
      current.target &&
      message.sourceRevision === current.sourceRevision &&
      message.target.definitionStatementId === session.targetDefinitionStatementId &&
      message.target.definitionStatementId === current.target.definitionStatementId &&
      message.target.definitionStatementIndex === current.target.definitionStatementIndex &&
      message.target.name === current.target.name
    );
  };

  const acceptParameterValueFocus = (
    message: VscodeModulePreviewParameterValueFocus
  ): boolean => {
    const session = boundParameterSession;
    const snapshot = session ? currentParameterSnapshot(session) : null;
    if (!session || !snapshot || !focusedPreviewValueMatches(session, snapshot, message, false)) return false;
    const previous = focusedPreviewValue;
    if (previous) {
      if (message.focusGeneration < previous.focusGeneration) return false;
      if (
        message.focusGeneration === previous.focusGeneration &&
        (!sameFocusedPreviewIdentity(previous, message) ||
          message.sessionRevision !== previous.sessionRevision ||
          message.value !== previous.value ||
          message.selectionStart !== previous.selectionStart ||
          message.selectionEnd !== previous.selectionEnd)
      ) return false;
    }
    if (
      pendingSelectionRestoration &&
      (!sameFocusedPreviewBinding(message, pendingSelectionRestoration) ||
      (message.value !== pendingSelectionRestoration.previousValue && message.value !== pendingSelectionRestoration.expectedValue))
    ) pendingSelectionRestoration = null;
    focusedPreviewValue = message;
    setContext(NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT, true);
    maybeRestorePendingSelection(session, snapshot);
    return true;
  };

  const acceptParameterValueBlur = (
    message: VscodeModulePreviewParameterValueBlur
  ): boolean => {
    if (!focusedPreviewValue || !sameFocusedPreviewProof(focusedPreviewValue, message)) return false;
    clearFocusedPreviewValue();
    return true;
  };

  const acceptsParameterSnapshot = (
    session: ModulePreviewSession,
    message: VscodeModulePreviewParameterSnapshot
  ): boolean => {
    if (!session || !session.webviewReady || session.authoritativeDocumentVersion !== session.document.version) return false;
    if (!Number.isInteger(message.sessionRevision) || !isCurrentParameterMessage(session, message)) return false;
    const latest = session.retainedParameterMessage;
    if (latest && message.sessionRevision <= latest.sessionRevision) return false;
    return true;
  };

  const acceptsParameterUnavailable = (
    session: ModulePreviewSession,
    message: VscodeModulePreviewParametersUnavailable
  ): boolean => {
    if (!session || !isCurrentParameterMessage(session, message)) return false;
    const latest = session.retainedParameterMessage;
    if (latest && message.sessionRevision <= latest.sessionRevision) return false;
    retainParameterMessage(session, message);
    return true;
  };

  const forwardParameterSetValue = (
    message: VscodeModulePreviewParameterSetValueRequest | VscodeModulePreviewParameterSetValue
  ): boolean => {
    const session = boundParameterSession;
    const snapshot = session ? currentParameterSnapshot(session) : null;
    if (!session || !snapshot) return false;
    if (
      message.sessionId !== session.sessionId ||
      message.documentUri !== session.documentUri ||
      message.documentVersion !== session.document.version ||
      message.sourceRevision !== snapshot.sourceRevision ||
      !Number.isInteger(message.sessionRevision) ||
      message.sessionRevision < 1 ||
      message.sessionRevision > snapshot.sessionRevision ||
      message.targetDefinitionStatementId !== snapshot.target.definitionStatementId ||
      session.authoritativeDocumentVersion !== session.document.version
    ) return false;
    const current = currentTargetFor(session);
    if (
      !current.target ||
      current.sourceRevision !== message.sourceRevision ||
      current.target.definitionStatementId !== message.targetDefinitionStatementId ||
      current.target.definitionStatementIndex !== snapshot.target.definitionStatementIndex ||
      current.target.name !== snapshot.target.name
    ) return false;
    if (!parameterRowFor(snapshot, message.definitionStatementId, message.parameterIndex)) return false;
    void session.panel.webview.postMessage({
      type: "modulePreviewSetValue",
      sessionId: message.sessionId,
      documentUri: message.documentUri,
      documentVersion: message.documentVersion,
      sourceRevision: message.sourceRevision,
      sessionRevision: message.sessionRevision,
      targetDefinitionStatementId: message.targetDefinitionStatementId,
      definitionStatementId: message.definitionStatementId,
      parameterIndex: message.parameterIndex,
      expression: message.expression
    } satisfies ExtensionToVscodeMessage);
    return true;
  };

  const forwardParameterAction = (
    message: VscodeModulePreviewParameterSetValueRequest | VscodeModulePreviewParameterUseDefaultRequest
  ): boolean => {
    if (message.type === "modulePreviewParameterSetValue") return forwardParameterSetValue(message);
    const session = boundParameterSession;
    const snapshot = session ? currentParameterSnapshot(session) : null;
    if (!session || !snapshot) return false;
    if (
      message.sessionId !== session.sessionId ||
      message.documentUri !== session.documentUri ||
      message.documentVersion !== session.document.version ||
      message.sourceRevision !== snapshot.sourceRevision ||
      !Number.isInteger(message.sessionRevision) ||
      message.sessionRevision < 1 ||
      message.sessionRevision > snapshot.sessionRevision ||
      message.targetDefinitionStatementId !== snapshot.target.definitionStatementId ||
      session.authoritativeDocumentVersion !== session.document.version
    ) return false;
    const current = currentTargetFor(session);
    if (
      !current.target ||
      current.sourceRevision !== message.sourceRevision ||
      current.target.definitionStatementId !== message.targetDefinitionStatementId ||
      current.target.definitionStatementIndex !== snapshot.target.definitionStatementIndex ||
      current.target.name !== snapshot.target.name
    ) return false;
    const row = parameterRowFor(snapshot, message.definitionStatementId, message.parameterIndex);
    if (!row || (message.type === "modulePreviewParameterUseDefault" && row.defaultSourceText === null)) return false;
    const forwarded: VscodeModulePreviewParameterSetValue | VscodeModulePreviewParameterUseDefault = message.type === "modulePreviewParameterSetValue"
      ? {
          type: "modulePreviewSetValue",
          sessionId: message.sessionId,
          documentUri: message.documentUri,
          documentVersion: message.documentVersion,
          sourceRevision: message.sourceRevision,
          sessionRevision: message.sessionRevision,
          targetDefinitionStatementId: message.targetDefinitionStatementId,
          definitionStatementId: message.definitionStatementId,
          parameterIndex: message.parameterIndex,
          expression: message.expression
        }
      : {
          type: "modulePreviewUseDefault",
          sessionId: message.sessionId,
          documentUri: message.documentUri,
          documentVersion: message.documentVersion,
          sourceRevision: message.sourceRevision,
          sessionRevision: message.sessionRevision,
          targetDefinitionStatementId: message.targetDefinitionStatementId,
          definitionStatementId: message.definitionStatementId,
          parameterIndex: message.parameterIndex
        };
    void session.panel.webview.postMessage(forwarded satisfies ExtensionToVscodeMessage);
    return true;
  };

  const currentReferencePickRowFor = (
    session: ModulePreviewSession,
    proof: Pick<
      VscodeModulePreviewReferencePickStartRequest,
      "sessionId" | "documentUri" | "documentVersion" | "sourceRevision" |
        "sessionRevision" | "targetDefinitionStatementId" | "definitionStatementId" | "parameterIndex"
    >
  ) => {
    const snapshot = currentParameterSnapshot(session);
    if (
      !snapshot ||
      boundParameterSession !== session ||
      !session.webviewReady ||
      session.authoritativeDocumentVersion !== session.document.version ||
      proof.sessionId !== session.sessionId ||
      proof.documentUri !== session.documentUri ||
      proof.documentVersion !== session.document.version ||
      proof.sourceRevision !== snapshot.sourceRevision ||
      proof.sessionRevision !== snapshot.sessionRevision ||
      proof.targetDefinitionStatementId !== snapshot.target.definitionStatementId
    ) return null;
    const current = currentTargetFor(session);
    if (
      !current.target ||
      current.sourceRevision !== proof.sourceRevision ||
      current.target.definitionStatementId !== snapshot.target.definitionStatementId ||
      current.target.definitionStatementIndex !== snapshot.target.definitionStatementIndex ||
      current.target.name !== snapshot.target.name
    ) return null;
    const row = parameterRowFor(snapshot, proof.definitionStatementId, proof.parameterIndex);
    const expectedGeometryInterface = moduleGeometryInterfaceTypeOf(row?.type);
    return row && expectedGeometryInterface
      ? { row, expectedGeometryInterface }
      : null;
  };

  const startParameterReferencePick = (
    message: VscodeModulePreviewParameterReferencePickStartRequest
  ): boolean => {
    const session = boundParameterSession;
    const match = session ? currentReferencePickRowFor(session, message) : null;
    if (!session || !match) return false;
    cancelActiveReferencePick(session);
    const request: VscodeModulePreviewReferencePickStartRequest = {
      type: "modulePreviewReferencePickStartRequest",
      requestId: nextReferencePickRequestId,
      sessionId: message.sessionId,
      documentUri: message.documentUri,
      documentVersion: message.documentVersion,
      sourceRevision: message.sourceRevision,
      sessionRevision: message.sessionRevision,
      targetDefinitionStatementId: message.targetDefinitionStatementId,
      definitionStatementId: message.definitionStatementId,
      parameterIndex: message.parameterIndex,
      expectedGeometryInterface: match.expectedGeometryInterface,
      role: "geometry",
      multiplicity: "single"
    };
    nextReferencePickRequestId += 1;
    session.activeReferencePick = { request, candidateReferenceKeys: null };
    void session.panel.webview.postMessage(request satisfies ExtensionToVscodeMessage);
    return true;
  };

  const handleReferencePickResult = (
    session: ModulePreviewSession,
    result: VscodeModulePreviewReferencePickResult
  ): boolean => {
    const active = session.activeReferencePick;
    if (!active) return false;
    const request = active.request;
    if (
      result.requestId !== request.requestId ||
      result.sessionId !== request.sessionId ||
      result.documentUri !== request.documentUri ||
      result.documentVersion !== request.documentVersion ||
      result.sourceRevision !== request.sourceRevision ||
      result.sessionRevision !== request.sessionRevision ||
      result.targetDefinitionStatementId !== request.targetDefinitionStatementId ||
      result.definitionStatementId !== request.definitionStatementId ||
      result.parameterIndex !== request.parameterIndex ||
      result.expectedGeometryInterface !== request.expectedGeometryInterface ||
      result.role !== request.role ||
      result.multiplicity !== request.multiplicity
    ) return false;
    if (result.status === "started") {
      const keys = result.candidateReferences.map(referencePickReferenceKey);
      if (new Set(keys).size !== keys.length) {
        session.activeReferencePick = null;
        return false;
      }
      active.candidateReferenceKeys = new Set(keys);
      return true;
    }
    session.activeReferencePick = null;
    if (result.status !== "confirmed") return true;
    if (!active.candidateReferenceKeys || result.references.length !== 1) return false;
    const reference = result.references[0];
    if (!isCanonicalReferencePickReference(reference) ||
      !active.candidateReferenceKeys.has(referencePickReferenceKey(reference))) return false;
    const match = currentReferencePickRowFor(session, request);
    if (!match) return false;
    void session.panel.webview.postMessage({
      type: "modulePreviewSetValue",
      sessionId: request.sessionId,
      documentUri: request.documentUri,
      documentVersion: request.documentVersion,
      sourceRevision: request.sourceRevision,
      sessionRevision: request.sessionRevision,
      targetDefinitionStatementId: request.targetDefinitionStatementId,
      definitionStatementId: request.definitionStatementId,
      parameterIndex: request.parameterIndex,
      expression: referencePickSourceForReference(reference)
    } satisfies ExtensionToVscodeMessage);
    return true;
  };

  const dispatchPreviewValueStep = (direction: 1 | -1): boolean => {
    const session = boundParameterSession;
    const snapshot = session ? currentParameterSnapshot(session) : null;
    const focus = focusedPreviewValue;
    if (!session || !snapshot || !focus) return true;
    const match = focusedPreviewValueMatches(session, snapshot, focus, true);
    if (!match) {
      clearFocusedPreviewValue();
      return true;
    }
    if (
      focus.sessionRevision !== snapshot.sessionRevision ||
      focus.value !== match.row.value ||
      focus.selectionStart < 0 ||
      focus.selectionEnd < focus.selectionStart ||
      focus.selectionEnd > match.row.value.length
    ) return true;
    const result = resolveModulePreviewValueStep(
      match.row.value,
      match.row.type,
      match.row.numericTypeOptions,
      { start: focus.selectionStart, end: focus.selectionEnd },
      direction
    );
    if (!result) return true;

    pendingSelectionRestoration = {
      sessionId: focus.sessionId,
      documentUri: focus.documentUri,
      documentVersion: focus.documentVersion,
      sourceRevision: focus.sourceRevision,
      targetDefinitionStatementId: focus.targetDefinitionStatementId,
      definitionStatementId: focus.definitionStatementId,
      parameterIndex: focus.parameterIndex,
      focusGeneration: focus.focusGeneration,
      previousValue: focus.value,
      expectedValue: result.expression,
      selectionStart: result.selection.start,
      selectionEnd: result.selection.end
    };
    const forwarded: VscodeModulePreviewParameterSetValue = {
      type: "modulePreviewSetValue",
      sessionId: focus.sessionId,
      documentUri: focus.documentUri,
      documentVersion: focus.documentVersion,
      sourceRevision: focus.sourceRevision,
      sessionRevision: snapshot.sessionRevision,
      targetDefinitionStatementId: focus.targetDefinitionStatementId,
      definitionStatementId: focus.definitionStatementId,
      parameterIndex: focus.parameterIndex,
      expression: result.expression
    };
    if (!forwardParameterSetValue(forwarded)) pendingSelectionRestoration = null;
    return true;
  };

  const setSourceTargetContext = (enabled: boolean): void => {
    setContext(NUI_MODULE_PREVIEW_SOURCE_TARGET_CONTEXT, enabled);
  };

  const refreshSourceTargetContext = (): void => {
    const editor = vscode.window.activeTextEditor;
    setSourceTargetContext(Boolean(editor && exactTargetAtEditor(editor, languageAnalysisSessionFor)));
  };

  const deliverPendingTarget = (session: ModulePreviewSession): void => {
    const pending = session.pendingTarget;
    if (
      !pending ||
      !session.webviewReady ||
      session.authoritativeDocumentVersion !== session.document.version ||
      pending.documentVersion !== session.document.version
    ) return;
    session.pendingTarget = null;
    const message: ExtensionToVscodeMessage = pending.kind === "target"
      ? {
          type: "modulePreviewTarget",
          documentVersion: pending.documentVersion,
          normalizedSourceOffset: pending.normalizedSourceOffset
        }
      : {
          type: "modulePreviewTargetUnavailable",
          documentVersion: pending.documentVersion
        };
    void session.panel.webview.postMessage(message);
    if (pending.kind === "unavailable") publishParameterUnavailable(session, "target-unavailable");
  };

  const postAuthoritativeDocument = (session: ModulePreviewSession): void => {
    session.authoritativeDocumentVersion = null;
    void session.panel.webview.postMessage({
      type: "replaceTextDocument",
      sourceText: session.document.getText(),
      documentVersion: session.document.version
    } satisfies ExtensionToVscodeMessage);
  };

  const refreshExistingTarget = (session: ModulePreviewSession): void => {
    const rawSource = session.document.getText();
    const analysis = languageAnalysisSessionFor(session.document);
    if (analysis.getSource() !== rawSource) analysis.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: analysis.getSourceRevision()
    };
    const semantic = analysis.definitionSemanticSnapshot(source);
    const refreshed = currentModulePreviewTargetByIdentity({
      source,
      semantic,
      definitionStatementId: session.targetDefinitionStatementId
    });
    session.pendingTarget = refreshed
      ? {
          kind: "target",
          documentVersion: session.document.version,
          normalizedSourceOffset: refreshed.normalizedSourceOffset
        }
      : { kind: "unavailable", documentVersion: session.document.version };
  };

  const postModelPatchResult = (
    session: ModulePreviewSession,
    request: VscodeModulePreviewModelPatchRequest,
    status: VscodeModulePreviewModelPatchResult["status"],
    reason?: string
  ): void => {
    void session.panel.webview.postMessage({
      type: "modulePreviewModelPatchResult",
      operationId: request.operationId,
      sessionId: request.sessionId,
      documentUri: request.documentUri,
      documentVersion: session.document.version,
      status,
      ...(reason ? { reason } : {})
    } satisfies ExtensionToVscodeMessage);
  };

  const resyncModulePreview = (session: ModulePreviewSession): void => {
    cancelActiveReferencePick(session);
    refreshExistingTarget(session);
    postAuthoritativeDocument(session);
  };

  const applyModulePreviewModelPatch = async (
    session: ModulePreviewSession,
    request: VscodeModulePreviewModelPatchRequest
  ): Promise<void> => {
    const stale = (reason: string) => {
      resyncModulePreview(session);
      postModelPatchResult(session, request, "stale", reason);
    };
    const rejected = (reason: string) => {
      resyncModulePreview(session);
      postModelPatchResult(session, request, "rejected", reason);
    };

    if (
      request.sessionId !== session.sessionId ||
      request.documentUri !== session.documentUri ||
      sessions.get(session.documentUri) !== session ||
      !isOpenDocument(session.document) ||
      session.authoritativeDocumentVersion !== session.document.version
    ) {
      stale("Module Preview session is no longer authoritative.");
      return;
    }
    if (session.document.version !== request.expectedDocumentVersion) {
      stale("The source document changed during the Module Preview drag.");
      return;
    }

    const current = currentTargetFor(session);
    if (
      current.sourceRevision !== request.sourceRevision ||
      !current.target ||
      current.target.definitionStatementId !== request.targetDefinitionStatementId
    ) {
      stale("The Module Preview target or source revision is stale.");
      return;
    }
    const currentSource = session.document.getText();
    if (normalizedSourceFor(currentSource) !== request.normalizedSource) {
      stale("The authored source changed during the Module Preview drag.");
      return;
    }
    const editor = visibleEditorFor(session.document);
    if (!editor || !sameDocument(editor.document, session.document)) {
      rejected("The authoritative source editor is not available.");
      return;
    }

    let expectedSource: string;
    try {
      expectedSource = applyLineSplices(currentSource, request.splices);
    } catch (error) {
      rejected(error instanceof Error ? error.message : String(error));
      return;
    }
    if (expectedSource !== request.expectedPatchedSource) {
      rejected("The proposed Module Preview source patch does not match the expected source.");
      return;
    }
    let applied: boolean;
    try {
      applied = await applySourceLineSplices(
        editor,
        request.expectedDocumentVersion,
        currentSource,
        request.splices,
        request.expectedPatchedSource
      );
    } catch (error) {
      rejected(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!applied) {
      const changedDuringApply =
        editor.document.version !== request.expectedDocumentVersion ||
        editor.document.getText() !== currentSource;
      if (changedDuringApply) stale("The source document changed while applying the Module Preview edit.");
      else rejected("VS Code rejected the Module Preview source edit.");
      return;
    }
    postModelPatchResult(session, request, "applied");
  };

  const disposeSession = (session: ModulePreviewSession): void => {
    if (sessions.get(session.documentUri) !== session) return;
    cancelActiveReferencePick(session);
    if (boundParameterSession === session) clearParameterBinding();
    else if (focusedPreviewValue?.sessionId === session.sessionId) clearFocusedPreviewValue();
    session.retainedParameterMessage = null;
    sessions.delete(session.documentUri);
    for (const disposable of session.disposables.splice(0)) disposable.dispose();
  };

  const createOrRetargetPanel = (
    editor: vscode.TextEditor,
    target: NonNullable<ReturnType<typeof exactTargetAtEditor>>
  ): ModulePreviewSession => {
    const document = editor.document;
    const key = documentKey(document);
    const existing = sessions.get(key);
    if (existing) {
      cancelActiveReferencePick(existing);
      if (boundParameterSession === existing) clearFocusedPreviewValue();
      existing.sessionId = nextSessionId();
      existing.targetDefinitionStatementId = target.target.definitionStatementId;
      existing.retainedParameterMessage = null;
      existing.pendingTarget = {
        kind: "target",
        documentVersion: document.version,
        normalizedSourceOffset: target.normalizedSourceOffset
      };
      bindParameterSession(existing);
      existing.panel.reveal(vscode.ViewColumn.Beside);
      if (existing.webviewReady) postSessionIdentity(existing);
      deliverPendingTarget(existing);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      NUI_MODULE_PREVIEW_VIEW_TYPE,
      modulePreviewTranslatorFor(displayLanguageFor())("modulePreview.panelTitle"),
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    panel.webview.html = webviewHtml(panel);
    const session: ModulePreviewSession = {
      documentUri: key,
      document,
      panel,
      sessionId: nextSessionId(),
      targetDefinitionStatementId: target.target.definitionStatementId,
      webviewReady: false,
      authoritativeDocumentVersion: null,
      pendingTarget: {
        kind: "target",
        documentVersion: document.version,
        normalizedSourceOffset: target.normalizedSourceOffset
      },
      retainedParameterMessage: null,
      activeReferencePick: null,
      disposables: []
    };
    sessions.set(key, session);
    bindParameterSession(session);

    session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (!sameDocument(event.document, session.document) || event.contentChanges.length === 0) return;
      cancelActiveReferencePick(session);
      refreshExistingTarget(session);
      session.authoritativeDocumentVersion = null;
      publishParameterUnavailable(session, "source-stale");
      void panel.webview.postMessage({
        type: "commitText",
        sourceText: event.document.getText(),
        documentVersion: event.document.version,
        reason: documentChangeReasonFor(event.reason)
      } satisfies ExtensionToVscodeMessage);
    }));

    session.disposables.push(panel.webview.onDidReceiveMessage(async (message: VscodeToExtensionMessage) => {
      if (message.type === "bakeOperationResult") {
        await presentBakeOperationResult?.(message);
        return;
      }
      if (isModulePreviewModelPatchRequest(message)) {
        await applyModulePreviewModelPatch(session, message);
        return;
      }
      if (typeof message === "object" && message !== null &&
        (message as { type?: unknown }).type === "modulePreviewModelPatch") {
        resyncModulePreview(session);
        return;
      }
      if (isModulePreviewReferencePickResult(message)) {
        handleReferencePickResult(session, message);
        return;
      }
      if (message.type === "webviewReady") {
        session.webviewReady = true;
        postSessionIdentity(session);
        postAuthoritativeDocument(session);
        void panel.webview.postMessage({
          type: "canvasRibbonConfiguration",
          ribbons: canvasRibbons()
        } satisfies ExtensionToVscodeMessage);
        return;
      }
      if (message.type === "webviewAuthoritativeDocumentReady") {
        if (message.documentVersion !== session.document.version) return;
        session.authoritativeDocumentVersion = message.documentVersion;
        deliverPendingTarget(session);
        return;
      }
      if (message.type === "modulePreviewParameterSnapshot" && isModulePreviewParameterSnapshot(message)) {
        if (acceptsParameterSnapshot(session, message)) retainParameterMessage(session, message);
        return;
      }
      if (message.type === "modulePreviewParametersUnavailable" && isModulePreviewParametersUnavailable(message)) {
        acceptsParameterUnavailable(session, message);
        return;
      }
      if (message.type === "canvasRibbonPositionCommit") {
        if (!message.ribbonId || !Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
        await updateCanvasRibbonPosition(message.ribbonId, message.x, message.y);
        return;
      }
      if (message.type === "editCanvasRibbon") {
        editCanvasRibbon();
        return;
      }
      if (message.type === "rustEvaluationRequest") {
        try {
          const payload = await evaluateWithRust(message.input);
          void panel.webview.postMessage({
            type: "rustEvaluationResponse",
            id: message.id,
            payload
          } satisfies ExtensionToVscodeMessage);
        } catch (error) {
          void panel.webview.postMessage({
            type: "rustEvaluationError",
            id: message.id,
            error: error instanceof Error ? error.message : String(error)
          } satisfies ExtensionToVscodeMessage);
        }
      }
    }));
    session.disposables.push(panel.onDidChangeViewState(({ webviewPanel }) => {
      if (webviewPanel !== panel || (!webviewPanel.active && !webviewPanel.visible)) return;
      bindParameterSession(session);
    }));
    session.disposables.push(panel.onDidDispose(() => disposeSession(session)));
    return session;
  };

  disposables.push(vscode.commands.registerCommand("nuinuiCAD.openModulePreview", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isSupportedNuiDocument(editor.document)) {
      void vscode.window.showErrorMessage(
        modulePreviewTranslatorFor(displayLanguageFor())("modulePreview.requiresSourceEditor")
      );
      return;
    }
    const target = exactTargetAtEditor(editor, languageAnalysisSessionFor);
    if (!target) {
      void vscode.window.showErrorMessage(
        modulePreviewTranslatorFor(displayLanguageFor())("modulePreview.placeCaret")
      );
      return;
    }
    createOrRetargetPanel(editor, target);
  }));
  disposables.push(vscode.commands.registerCommand(
    NUI_MODULE_PREVIEW_VALUE_STEP_FORWARD_COMMAND_ID,
    () => dispatchPreviewValueStep(1)
  ));
  disposables.push(vscode.commands.registerCommand(
    NUI_MODULE_PREVIEW_VALUE_STEP_BACKWARD_COMMAND_ID,
    () => dispatchPreviewValueStep(-1)
  ));

  disposables.push(vscode.window.onDidChangeActiveTextEditor(() => refreshSourceTargetContext()));
  disposables.push(vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === vscode.window.activeTextEditor) refreshSourceTargetContext();
  }));
  disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
    if (vscode.window.activeTextEditor && sameDocument(event.document, vscode.window.activeTextEditor.document)) {
      refreshSourceTargetContext();
    }
  }));
  disposables.push(vscode.workspace.onDidCloseTextDocument((document) => {
    const session = sessions.get(documentKey(document));
    if (session) {
      session.panel.dispose();
      disposeSession(session);
    }
    refreshSourceTargetContext();
  }));
  disposables.push(vscode.window.onDidChangeActiveColorTheme(() => {
    for (const session of sessions.values()) {
      void session.panel.webview.postMessage({
        type: "canvasThemeChanged",
        generation: canvasThemeGeneration()
      } satisfies ExtensionToVscodeMessage);
    }
  }));
  const configurationListener = vscode.workspace.onDidChangeConfiguration?.((event) => {
    if (!event.affectsConfiguration("nuinuiCAD.canvasRibbon.ribbons")) return;
    const ribbons = canvasRibbons();
    for (const session of sessions.values()) {
      void session.panel.webview.postMessage({
        type: "canvasRibbonConfiguration",
        ribbons
      } satisfies ExtensionToVscodeMessage);
    }
  });
  if (configurationListener) disposables.push(configurationListener);
  refreshSourceTargetContext();

  return {
    postCanvasCommandIfActive: (commandId) => {
      if (!nonWritingCanvasCommands.has(commandId)) return false;
      const session = [...sessions.values()].find((candidate) => candidate.panel.active);
      if (!session) return false;
      void session.panel.webview.postMessage({ type: "canvasCommand", commandId } satisfies ExtensionToVscodeMessage);
      return true;
    },
    postBakeCommandIfActive: (commandId, settings) => {
      if (!bakeCanvasCommands.has(commandId)) return false;
      const session = [...sessions.values()].find((candidate) => candidate.panel.active);
      if (!session) return false;
      void session.panel.webview.postMessage({
        type: "canvasCommand",
        commandId,
        ...settings
      } satisfies ExtensionToVscodeMessage);
      return true;
    },
    handoffNativeHistoryIfActive,
    attachParameterView: (webview) => {
      parameterWebviewDisposable?.dispose();
      parameterWebview = webview;
      if (boundParameterSession) {
        const retained = boundParameterSession.retainedParameterMessage;
        if (retained && isCurrentParameterMessage(boundParameterSession, retained)) {
          void webview.postMessage(retained);
        } else {
          bindParameterSession(boundParameterSession);
        }
      } else {
        clearParameterBinding();
      }
      const messageDisposable = webview.onDidReceiveMessage((message: unknown) => {
        if (isModulePreviewParameterViewReady(message)) {
          if (boundParameterSession) {
            const retained = boundParameterSession.retainedParameterMessage;
            if (retained && isCurrentParameterMessage(boundParameterSession, retained)) {
              void webview.postMessage(retained);
            } else {
              bindParameterSession(boundParameterSession);
            }
          } else {
            clearParameterBinding();
          }
          return;
        }
        if (isModulePreviewParameterSetValueRequest(message) || isModulePreviewParameterUseDefaultRequest(message)) {
          forwardParameterAction(message);
          return;
        }
        if (isModulePreviewParameterReferencePickStart(message)) {
          startParameterReferencePick(message);
          return;
        }
        if (isModulePreviewParameterValueFocus(message)) {
          acceptParameterValueFocus(message);
          return;
        }
        if (isModulePreviewParameterValueBlur(message)) {
          acceptParameterValueBlur(message);
        }
      });
      const attached = {
        dispose: () => {
          messageDisposable.dispose();
          if (boundParameterSession) cancelActiveReferencePick(boundParameterSession);
          clearFocusedPreviewValue();
          if (parameterWebview === webview) parameterWebview = null;
          if (parameterWebviewDisposable === attached) parameterWebviewDisposable = null;
        }
      } satisfies vscode.Disposable;
      parameterWebviewDisposable = attached;
      return attached;
    },
    dispose: () => {
      setSourceTargetContext(false);
      clearFocusedPreviewValue();
      for (const session of [...sessions.values()]) session.panel.dispose();
      if (boundParameterSession) clearParameterBinding();
      parameterWebviewDisposable?.dispose();
      for (const disposable of disposables.splice(0)) disposable.dispose();
      sessions.clear();
    }
  };
};
