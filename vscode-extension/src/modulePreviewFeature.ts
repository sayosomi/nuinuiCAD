import * as vscode from "vscode";
import { applyLineSplices, type LineSplice } from "@nuinuicad/nui-language/document";
import type { StatementIdentity } from "@nuinuicad/nui-language/document";
import { resolveModulePreviewValueStep } from "../../src/dsl/modulePreviewValueStep";
import { queryModulePreviewTarget } from "../../src/dsl/modulePreviewTarget";
import {
  moduleGeometryInterfaceTypeOf
} from "@nuinuicad/nui-language";
import { currentModulePreviewTargetByIdentity } from "../../src/vscode/modulePreviewLifecycle";
import {
  isCanonicalReferencePickReference,
  referencePickReferenceKey,
  referencePickSourceForReference
} from "../../src/vscode/referencePickProtocol";
import type {
  ExtensionToVscodeMessage,
  VscodeModulePreviewInvocationSnapshot,
  VscodeModulePreviewInvocationUnavailable,
  VscodeModulePreviewInvocationSiteBlur,
  VscodeModulePreviewInvocationSiteFocus,
  VscodeModulePreviewInvocationSiteProof,
  VscodeModulePreviewInvocationReferencePickStart,
  VscodeModulePreviewInvocationValueEdit,
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
import {
  currentCompiledSemanticSnapshotFor,
  type NuiLanguageAnalysisSession
} from "./languageAnalysisSession";
import { modulePreviewTranslatorFor } from "./modulePreviewLocalization";
import { normalizedOffsetFromRaw, normalizedSourceFor } from "./sourceOffsetAdapter";
import {
  handoffOutputPreviewHistory,
  type OutputPreviewHistoryDirection
} from "./outputPreviewHistory";
import { applySourceLineSplices } from "./textDocumentLineSplices";
import { webviewPresentationFor } from "./webviewPresentationLocalization";
import type {
  WebviewEditableFocusAttachment,
  WebviewEditableFocusWebview
} from "./webviewEditableFocusContext";

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
  retainedInvocationMessage: VscodeModulePreviewInvocationSnapshot | VscodeModulePreviewInvocationUnavailable | null;
  editableFocusAttachment: WebviewEditableFocusAttachment | null;
  activeReferencePick: {
    request: VscodeModulePreviewReferencePickStartRequest;
    candidateReferenceKeys: Set<string> | null;
  } | null;
  disposables: vscode.Disposable[];
};

type ModulePreviewInvocationMessage =
  | VscodeModulePreviewInvocationSnapshot
  | VscodeModulePreviewInvocationUnavailable;

export type ModulePreviewFeature = vscode.Disposable & {
  postCanvasCommandIfActive: (commandId: VscodeCanvasCommandId) => boolean;
  postBakeCommandIfActive: (commandId: VscodeCanvasCommandId, settings: VscodeBakeSettings) => boolean;
  handoffNativeHistoryIfActive: (direction: OutputPreviewHistoryDirection) => boolean;
};

export type RegisterModulePreviewFeatureOptions = {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  canvasThemeGeneration: () => number;
  webviewHtml: (panel: vscode.WebviewPanel) => string;
  canvasRibbons: () => VscodeCanvasRibbon[];
  updateCanvasRibbonPosition: (ribbonId: string, x: number, y: number) => Promise<void> | void;
  editCanvasRibbon: () => void;
  evaluateWithRust: (input: unknown) => Promise<unknown>;
  attachWebviewEditableFocus?: (webview: WebviewEditableFocusWebview) => WebviewEditableFocusAttachment;
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

const isInvocationSiteProof = (candidate: Partial<VscodeModulePreviewInvocationSiteFocus>): boolean =>
  typeof candidate.sessionId === "string" &&
  typeof candidate.documentUri === "string" &&
  Number.isInteger(candidate.documentVersion) &&
  Number.isInteger(candidate.sourceRevision) &&
  Number.isInteger(candidate.sessionRevision) &&
  typeof candidate.targetDefinitionStatementId === "string" &&
  typeof candidate.definitionStatementId === "string" &&
  Number.isInteger(candidate.parameterIndex) &&
  typeof candidate.invocationText === "string" &&
  Number.isInteger(candidate.selectionStart) &&
  Number.isInteger(candidate.selectionEnd) &&
  candidate.selectionStart >= 0 &&
  candidate.selectionEnd >= candidate.selectionStart &&
  candidate.selectionEnd <= candidate.invocationText.length;

const isModulePreviewInvocationSiteFocus = (
  message: unknown
): message is VscodeModulePreviewInvocationSiteFocus => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewInvocationSiteFocus>;
  return candidate.type === "modulePreviewInvocationSiteFocus" &&
    Number.isInteger(candidate.focusGeneration) && candidate.focusGeneration > 0 &&
    isInvocationSiteProof(candidate);
};

const isModulePreviewInvocationSiteBlur = (
  message: unknown
): message is VscodeModulePreviewInvocationSiteBlur => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewInvocationSiteBlur>;
  return candidate.type === "modulePreviewInvocationSiteBlur" &&
    Number.isInteger(candidate.focusGeneration) && candidate.focusGeneration > 0 &&
    isInvocationSiteProof(candidate);
};

const isModulePreviewInvocationReferencePickStart = (
  message: unknown
): message is VscodeModulePreviewInvocationReferencePickStart => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewInvocationReferencePickStart>;
  return candidate.type === "modulePreviewInvocationReferencePickStart" &&
    (candidate.expectedGeometryInterface === undefined ||
      candidate.expectedGeometryInterface === "point" ||
      candidate.expectedGeometryInterface === "line" ||
      candidate.expectedGeometryInterface === "path") &&
    isInvocationSiteProof(candidate);
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
    typeof candidate.invocationText !== "string" ||
    !Number.isInteger(candidate.selectionStart) ||
    !Number.isInteger(candidate.selectionEnd) ||
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

const isModulePreviewInvocationSnapshot = (
  message: unknown
): message is VscodeModulePreviewInvocationSnapshot => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewInvocationSnapshot>;
  const target = candidate.target;
  return candidate.type === "modulePreviewInvocationSnapshot" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof target === "object" && target !== null &&
    typeof target.definitionStatementId === "string" &&
    Number.isInteger(target.definitionStatementIndex) &&
    typeof target.name === "string" &&
    Array.isArray(candidate.blocks) &&
    Array.isArray(candidate.inputDiagnostics) &&
    (candidate.previewStatus === "current" ||
      candidate.previewStatus === "lastGood" ||
      candidate.previewStatus === "noValidPreview");
};

const isModulePreviewInvocationUnavailable = (
  message: unknown
): message is VscodeModulePreviewInvocationUnavailable => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewInvocationUnavailable>;
  return candidate.type === "modulePreviewInvocationUnavailable" &&
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
  const semantic = currentCompiledSemanticSnapshotFor(analysis, source);
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
  attachWebviewEditableFocus,
  presentBakeOperationResult,
  displayLanguageFor = vscodeDisplayLanguage
}: RegisterModulePreviewFeatureOptions): ModulePreviewFeature => {
  const sessions = new Map<string, ModulePreviewSession>();
  const disposables: vscode.Disposable[] = [];
  let contextUpdate: Promise<void> = Promise.resolve();
  let nextSessionGeneration = 1;
  let nextReferencePickRequestId = 1;
  let boundInvocationSession: ModulePreviewSession | null = null;
  let focusedInvocationSite: VscodeModulePreviewInvocationSiteFocus | null = null;
  let invocationContextOwned = false;

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

  const clearFocusedInvocationSite = (): void => {
    const wasOwned = focusedInvocationSite !== null || invocationContextOwned;
    focusedInvocationSite = null;
    invocationContextOwned = false;
    if (wasOwned) setContext(NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT, false);
    boundInvocationSession?.editableFocusAttachment?.setHostFocused(false);
  };

  const retainInvocationMessage = (
    session: ModulePreviewSession,
    message: ModulePreviewInvocationMessage
  ): void => {
    if (
      session.activeReferencePick &&
      (message.type !== "modulePreviewInvocationSnapshot" ||
        message.sessionRevision !== session.activeReferencePick.request.sessionRevision)
    ) cancelActiveReferencePick(session);
    if (message.type === "modulePreviewInvocationUnavailable") clearFocusedInvocationSite();
    session.retainedInvocationMessage = message;
    if (
      message.type === "modulePreviewInvocationSnapshot" &&
      focusedInvocationSite &&
      (focusedInvocationSite.sessionId !== message.sessionId ||
        focusedInvocationSite.documentUri !== message.documentUri ||
        focusedInvocationSite.documentVersion !== message.documentVersion ||
        focusedInvocationSite.sourceRevision !== message.sourceRevision ||
        focusedInvocationSite.targetDefinitionStatementId !== message.target.definitionStatementId)
    ) {
      invocationContextOwned = false;
      setContext(NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT, false);
    }
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
      semantic: currentCompiledSemanticSnapshotFor(analysis, source)
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

  const invocationUnavailableFor = (
    session: ModulePreviewSession,
    reason: VscodeModulePreviewInvocationUnavailable["reason"]
  ): VscodeModulePreviewInvocationUnavailable => ({
    type: "modulePreviewInvocationUnavailable",
    sessionId: session.sessionId,
    documentUri: session.documentUri,
    documentVersion: session.document.version,
    sourceRevision: currentTargetFor(session).sourceRevision,
    sessionRevision: session.retainedInvocationMessage?.sessionId === session.sessionId
      ? session.retainedInvocationMessage.sessionRevision
      : 0,
    targetDefinitionStatementId: session.targetDefinitionStatementId,
    reason
  });

  const publishInvocationUnavailable = (
    session: ModulePreviewSession,
    reason: Exclude<VscodeModulePreviewInvocationUnavailable["reason"], "no-session">
  ): void => {
    retainInvocationMessage(session, invocationUnavailableFor(session, reason));
  };

  const clearInvocationBinding = (): void => {
    boundInvocationSession = null;
    clearFocusedInvocationSite();
    for (const session of sessions.values()) cancelActiveReferencePick(session);
  };

  const bindInvocationSession = (session: ModulePreviewSession): void => {
    if (boundInvocationSession !== session) clearFocusedInvocationSite();
    boundInvocationSession = session;
    const retained = session.retainedInvocationMessage;
    if (retained && isCurrentInvocationMessage(session, retained)) {
      return;
    }
    const current = currentTargetFor(session);
    const reason = !current.target
      ? "target-unavailable"
      : session.authoritativeDocumentVersion !== session.document.version
        ? "source-stale"
        : "not-ready";
    publishInvocationUnavailable(session, reason);
  };

  const postSessionIdentity = (session: ModulePreviewSession): void => {
    void session.panel.webview.postMessage({
      type: "modulePreviewSession",
      sessionId: session.sessionId,
      documentUri: session.documentUri
    } satisfies ExtensionToVscodeMessage);
  };

  const invocationBlockFor = (
    snapshot: VscodeModulePreviewInvocationSnapshot,
    definitionStatementId: StatementIdentity
  ) => snapshot.blocks.find((block) => block.definitionStatementId === definitionStatementId) ?? null;

  const currentInvocationSnapshot = (session: ModulePreviewSession): VscodeModulePreviewInvocationSnapshot | null =>
    session.retainedInvocationMessage?.type === "modulePreviewInvocationSnapshot"
      ? session.retainedInvocationMessage
      : null;

  const currentInvocationSnapshotIsCurrent = (
    session: ModulePreviewSession,
    snapshot: VscodeModulePreviewInvocationSnapshot
  ): boolean => {
    if (
      snapshot.sessionId !== session.sessionId ||
      snapshot.documentUri !== session.documentUri ||
      snapshot.documentVersion !== session.document.version ||
      sessions.get(session.documentUri) !== session ||
      !isOpenDocument(session.document) ||
      !session.webviewReady ||
      session.authoritativeDocumentVersion !== session.document.version
    ) return false;
    const current = currentTargetFor(session);
    return Boolean(current.target &&
      current.target.definitionStatementId === snapshot.target.definitionStatementId &&
      current.target.definitionStatementIndex === snapshot.target.definitionStatementIndex &&
      current.target.name === snapshot.target.name);
  };

  const currentInvocationSiteFor = (
    session: ModulePreviewSession,
    proof: VscodeModulePreviewInvocationSiteProof
  ) => {
    const snapshot = currentInvocationSnapshot(session);
    if (!snapshot || boundInvocationSession !== session || !currentInvocationSnapshotIsCurrent(session, snapshot) ||
      proof.sessionId !== session.sessionId || proof.documentUri !== session.documentUri ||
      proof.documentVersion !== session.document.version || proof.sourceRevision !== snapshot.sourceRevision ||
      proof.sessionRevision !== snapshot.sessionRevision || proof.targetDefinitionStatementId !== snapshot.target.definitionStatementId)
      return null;
    const block = invocationBlockFor(snapshot, proof.definitionStatementId);
    const parameter = block?.parameters.find((candidate) => candidate.parameterIndex === proof.parameterIndex);
    if (!block || !parameter || block.text !== proof.invocationText ||
      proof.selectionStart < parameter.lineRange.from || proof.selectionEnd > parameter.lineRange.to)
      return null;
    return { snapshot, block, parameter };
  };

  const acceptInvocationSiteFocus = (message: VscodeModulePreviewInvocationSiteFocus): boolean => {
    const session = boundInvocationSession;
    const snapshot = session ? currentInvocationSnapshot(session) : null;
    if (!session || !snapshot || !currentInvocationSiteFor(session, message)) return false;
    if (focusedInvocationSite && message.focusGeneration < focusedInvocationSite.focusGeneration) return false;
    focusedInvocationSite = message;
    invocationContextOwned = true;
    setContext(NUI_MODULE_PREVIEW_VALUE_INPUT_FOCUS_CONTEXT, true);
    session.editableFocusAttachment?.setHostFocused(true);
    return true;
  };

  const acceptInvocationSiteBlur = (message: VscodeModulePreviewInvocationSiteBlur): boolean => {
    const session = boundInvocationSession;
    if (
      !session ||
      !focusedInvocationSite ||
      message.focusGeneration !== focusedInvocationSite.focusGeneration ||
      !currentInvocationSiteFor(session, message)
    ) return false;
    clearFocusedInvocationSite();
    return true;
  };

  const isCurrentInvocationMessage = (
    session: ModulePreviewSession,
    message: ModulePreviewInvocationMessage
  ): boolean => {
    if (message.sessionId !== session.sessionId || message.documentUri !== session.documentUri ||
      message.documentVersion !== session.document.version) return false;
    if (message.type === "modulePreviewInvocationUnavailable") {
      const retained = currentInvocationSnapshot(session);
      return message.targetDefinitionStatementId === null || !retained ||
        message.targetDefinitionStatementId === retained.target.definitionStatementId;
    }
    return currentInvocationSnapshotIsCurrent(session, message);
  };

  const acceptsInvocationSnapshot = (
    session: ModulePreviewSession,
    message: VscodeModulePreviewInvocationSnapshot
  ): boolean => {
    if (!session || !session.webviewReady || session.authoritativeDocumentVersion !== session.document.version) return false;
    if (!Number.isInteger(message.sessionRevision) || !isCurrentInvocationMessage(session, message)) return false;
    const latest = session.retainedInvocationMessage;
    if (latest && message.sessionRevision <= latest.sessionRevision) return false;
    return true;
  };

  const acceptsInvocationUnavailable = (
    session: ModulePreviewSession,
    message: VscodeModulePreviewInvocationUnavailable
  ): boolean => {
    if (!session || !isCurrentInvocationMessage(session, message)) return false;
    const latest = session.retainedInvocationMessage;
    if (latest && message.sessionRevision <= latest.sessionRevision) return false;
    retainInvocationMessage(session, message);
    return true;
  };

  const currentReferencePickSiteFor = (
    session: ModulePreviewSession,
    proof: VscodeModulePreviewInvocationSiteProof
  ) => {
    const match = currentInvocationSiteFor(session, proof);
    if (!match) return null;
    const expectedGeometryInterface = moduleGeometryInterfaceTypeOf(match.parameter.type);
    return expectedGeometryInterface ? { ...match, expectedGeometryInterface } : null;
  };

  const startInvocationReferencePick = (
    message: VscodeModulePreviewInvocationReferencePickStart
  ): boolean => {
    const session = boundInvocationSession;
    const match = session ? currentReferencePickSiteFor(session, message) : null;
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
      invocationText: message.invocationText,
      selectionStart: message.selectionStart,
      selectionEnd: message.selectionEnd,
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
    const match = currentReferencePickSiteFor(session, request);
    if (!match) return false;
    const expression = referencePickSourceForReference(reference);
    const selection = match.parameter.valueRange.from + expression.length;
    void session.panel.webview.postMessage({
      type: "modulePreviewInvocationValueEdit",
      sessionId: request.sessionId,
      documentUri: request.documentUri,
      documentVersion: request.documentVersion,
      sourceRevision: request.sourceRevision,
      sessionRevision: request.sessionRevision,
      targetDefinitionStatementId: request.targetDefinitionStatementId,
      definitionStatementId: request.definitionStatementId,
      parameterIndex: request.parameterIndex,
      invocationText: request.invocationText,
      selectionStart: request.selectionStart,
      selectionEnd: request.selectionEnd,
      expression,
      resultSelectionStart: selection,
      resultSelectionEnd: selection
    } satisfies ExtensionToVscodeMessage);
    return true;
  };

  const dispatchPreviewValueStep = (direction: 1 | -1): boolean => {
    const session = boundInvocationSession;
    const focus = focusedInvocationSite;
    if (!session || !focus) return true;
    const match = currentInvocationSiteFor(session, focus);
    if (!match) {
      clearFocusedInvocationSite();
      return true;
    }
    if (!match.parameter.active || focus.selectionStart < match.parameter.valueRange.from ||
      focus.selectionEnd > match.parameter.valueRange.to) return true;
    const value = focus.invocationText.slice(match.parameter.valueRange.from, match.parameter.valueRange.to);
    const relativeSelection = {
      start: focus.selectionStart - match.parameter.valueRange.from,
      end: focus.selectionEnd - match.parameter.valueRange.from
    };
    const result = resolveModulePreviewValueStep(
      value,
      match.parameter.type,
      match.parameter.numericTypeOptions,
      relativeSelection,
      direction
    );
    if (!result) return true;
    const valueStart = match.parameter.valueRange.from;
    const forwarded: VscodeModulePreviewInvocationValueEdit = {
      type: "modulePreviewInvocationValueEdit",
      sessionId: focus.sessionId,
      documentUri: focus.documentUri,
      documentVersion: focus.documentVersion,
      sourceRevision: focus.sourceRevision,
      sessionRevision: match.snapshot.sessionRevision,
      targetDefinitionStatementId: focus.targetDefinitionStatementId,
      definitionStatementId: focus.definitionStatementId,
      parameterIndex: focus.parameterIndex,
      invocationText: focus.invocationText,
      selectionStart: focus.selectionStart,
      selectionEnd: focus.selectionEnd,
      expression: result.expression,
      resultSelectionStart: valueStart + result.selection.start,
      resultSelectionEnd: valueStart + result.selection.end
    };
    void session.panel.webview.postMessage(forwarded satisfies ExtensionToVscodeMessage);
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
    if (pending.kind === "unavailable") publishInvocationUnavailable(session, "target-unavailable");
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
    const semantic = currentCompiledSemanticSnapshotFor(analysis, source);
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
    if (boundInvocationSession === session) clearInvocationBinding();
    else if (focusedInvocationSite?.sessionId === session.sessionId) clearFocusedInvocationSite();
    session.retainedInvocationMessage = null;
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
      if (boundInvocationSession === existing) clearFocusedInvocationSite();
      existing.sessionId = nextSessionId();
      existing.targetDefinitionStatementId = target.target.definitionStatementId;
      existing.retainedInvocationMessage = null;
      existing.pendingTarget = {
        kind: "target",
        documentVersion: document.version,
        normalizedSourceOffset: target.normalizedSourceOffset
      };
      bindInvocationSession(existing);
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
      retainedInvocationMessage: null,
      editableFocusAttachment: null,
      activeReferencePick: null,
      disposables: []
    };
    sessions.set(key, session);
    bindInvocationSession(session);

    session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (!sameDocument(event.document, session.document) || event.contentChanges.length === 0) return;
      cancelActiveReferencePick(session);
      refreshExistingTarget(session);
      session.authoritativeDocumentVersion = null;
      publishInvocationUnavailable(session, "source-stale");
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
      if (isModulePreviewInvocationReferencePickStart(message)) {
        startInvocationReferencePick(message);
        return;
      }
      if (isModulePreviewInvocationSiteFocus(message)) {
        acceptInvocationSiteFocus(message);
        return;
      }
      if (isModulePreviewInvocationSiteBlur(message)) {
        acceptInvocationSiteBlur(message);
        return;
      }
      if (message.type === "webviewReady") {
        session.webviewReady = true;
        refreshExistingTarget(session);
        postSessionIdentity(session);
        void panel.webview.postMessage({
          type: "webviewPresentation",
          presentation: webviewPresentationFor(displayLanguageFor())
        } satisfies ExtensionToVscodeMessage);
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
      if (message.type === "modulePreviewInvocationSnapshot" && isModulePreviewInvocationSnapshot(message)) {
        if (acceptsInvocationSnapshot(session, message)) retainInvocationMessage(session, message);
        return;
      }
      if (message.type === "modulePreviewInvocationUnavailable" && isModulePreviewInvocationUnavailable(message)) {
        acceptsInvocationUnavailable(session, message);
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
      bindInvocationSession(session);
    }));
    const editableFocusAttachment = attachWebviewEditableFocus?.(panel.webview);
    session.editableFocusAttachment = editableFocusAttachment ?? null;
    if (editableFocusAttachment) session.disposables.push(editableFocusAttachment);
    session.disposables.push(panel.onDidDispose(() => disposeSession(session)));
    panel.webview.html = webviewHtml(panel);
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
    dispose: () => {
      setSourceTargetContext(false);
      clearFocusedInvocationSite();
      for (const session of [...sessions.values()]) session.panel.dispose();
      if (boundInvocationSession) clearInvocationBinding();
      for (const disposable of disposables.splice(0)) disposable.dispose();
      sessions.clear();
    }
  };
};
