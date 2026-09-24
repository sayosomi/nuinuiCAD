import * as vscode from "vscode";
import {
  applyLineSplices,
  planModulePreviewInstance,
  type LineSplice
} from "@nuinuicad/nui-language/document";
import type { StatementIdentity } from "@nuinuicad/nui-language/document";
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
  VscodeModulePreviewValueSnapshot,
  VscodeModulePreviewValueUnavailable,
  VscodeModulePreviewValueSiteProof,
  VscodeModulePreviewValueSiteEditRequest,
  VscodeModulePreviewValueReferencePickStart,
  VscodeModulePreviewValueEdit,
  VscodeModulePreviewModelPatchRequest,
  VscodeModulePreviewModelPatchResult,
  VscodeModulePreviewReferencePickResult,
  VscodeModulePreviewReferencePickStartRequest,
  VscodeCanvasCommandId,
  VscodeBakeSettings,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";
import type { VscodeCanvasRibbon } from "../../src/vscode/vscodeCanvasRibbonConfig";
import {
  CANVAS_GRID_SETTING_KEYS,
  DEFAULT_CANVAS_GRID_SETTINGS,
  normalizeCanvasGridSettings,
  type CanvasGridSettings
} from "../../src/components/canvasGrid";
import {
  currentCompiledSemanticSnapshotFor,
  type NuiLanguageAnalysisSession
} from "./languageAnalysisSession";
import { modulePreviewTranslatorFor } from "./modulePreviewLocalization";
import { normalizedOffsetFromRaw, normalizedSourceFor, vscodeRangeForNormalized } from "./sourceOffsetAdapter";
import {
  handoffOutputPreviewHistory,
  type OutputPreviewHistoryDirection
} from "./outputPreviewHistory";
import { applySourceLineSplices, textEditForLineSplice } from "./textDocumentLineSplices";
import { webviewPresentationFor } from "./webviewPresentationLocalization";
import { nativeShowInputBox, nativeShowQuickPick } from "./nativeQuickInput";

export const NUI_MODULE_PREVIEW_VIEW_TYPE = "nuinuiCAD.modulePreview";
export const NUI_MODULE_PREVIEW_SOURCE_TARGET_CONTEXT = "nuinuiCAD.modulePreviewSourceTarget";
export const NUI_MODULE_PREVIEW_INSERT_CONTEXT = "nuinuiCAD.modulePreviewInsertAvailable";
export const MODULE_PREVIEW_INSERT_INSTANCE_COMMAND = "nuinuiCAD.insertModulePreviewInstance";

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
  | {
      kind: "target";
      sessionId: string;
      sessionGeneration: number;
      documentUri: string;
      documentVersion: number;
      normalizedSourceOffset: number;
    }
  | {
      kind: "unavailable";
      sessionId: string;
      sessionGeneration: number;
      documentUri: string;
      documentVersion: number;
    };

type ModulePreviewSession = {
  documentUri: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  sessionId: string;
  sessionGeneration: number;
  targetDefinitionStatementId: StatementIdentity;
  webviewReady: boolean;
  bootstrapAcknowledgement: {
    sessionId: string;
    sessionGeneration: number;
    documentUri: string;
    documentVersion: number;
  } | null;
  pendingTarget: ModulePreviewPendingTarget | null;
  retainedValueMessage: VscodeModulePreviewValueSnapshot | VscodeModulePreviewValueUnavailable | null;
  valueSnapshotWaiters: Set<() => void>;
  activeReferencePick: {
    request: VscodeModulePreviewReferencePickStartRequest;
    candidateReferenceKeys: Set<string> | null;
  } | null;
  disposables: vscode.Disposable[];
};

type ModulePreviewValueMessage =
  | VscodeModulePreviewValueSnapshot
  | VscodeModulePreviewValueUnavailable;

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
  canvasGridSettings?: () => CanvasGridSettings;
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

const isValueSiteProof = (candidate: Partial<VscodeModulePreviewValueSiteProof>): boolean =>
  typeof candidate.sessionId === "string" &&
  typeof candidate.documentUri === "string" &&
  Number.isInteger(candidate.documentVersion) &&
  typeof candidate.normalizedSource === "string" &&
  Number.isInteger(candidate.sourceRevision) &&
  Number.isInteger(candidate.sessionRevision) &&
  Number.isInteger(candidate.targetDefinitionStatementIndex) &&
  typeof candidate.targetName === "string" &&
  (candidate.blockKind === "ancestor" || candidate.blockKind === "target") &&
  Number.isInteger(candidate.definitionStatementIndex) &&
  typeof candidate.definitionName === "string" &&
  Number.isInteger(candidate.parameterIndex) &&
  typeof candidate.parameterName === "string";

const isModulePreviewValueReferencePickStart = (
  message: unknown
): message is VscodeModulePreviewValueReferencePickStart => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewValueReferencePickStart>;
  return candidate.type === "modulePreviewValueReferencePickStart" &&
    (candidate.expectedGeometryInterface === undefined ||
      candidate.expectedGeometryInterface === "point" ||
      candidate.expectedGeometryInterface === "line" ||
      candidate.expectedGeometryInterface === "path") &&
    isValueSiteProof(candidate);
};

const isModulePreviewValueSiteEditRequest = (
  message: unknown
): message is VscodeModulePreviewValueSiteEditRequest => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewValueSiteEditRequest>;
  return candidate.type === "modulePreviewValueSiteEdit" && isValueSiteProof(candidate);
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
    typeof candidate.normalizedSource !== "string" ||
    !Number.isInteger(candidate.sourceRevision) ||
    !Number.isInteger(candidate.sessionRevision) ||
    !Number.isInteger(candidate.targetDefinitionStatementIndex) ||
    typeof candidate.targetName !== "string" ||
    (candidate.blockKind !== "ancestor" && candidate.blockKind !== "target") ||
    !Number.isInteger(candidate.definitionStatementIndex) ||
    typeof candidate.definitionName !== "string" ||
    !Number.isInteger(candidate.parameterIndex) ||
    typeof candidate.parameterName !== "string" ||
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

const isModulePreviewValueSnapshot = (
  message: unknown
): message is VscodeModulePreviewValueSnapshot => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewValueSnapshot>;
  const target = candidate.target;
  return candidate.type === "modulePreviewValueSnapshot" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.documentVersion) &&
    typeof candidate.normalizedSource === "string" &&
    Number.isInteger(candidate.sourceRevision) &&
    Number.isInteger(candidate.sessionRevision) &&
    typeof target === "object" && target !== null &&
    Number.isInteger(target.definitionStatementIndex) &&
    typeof target.name === "string" &&
    Array.isArray(candidate.groups) &&
    Array.isArray(candidate.inputDiagnostics) &&
    (candidate.previewStatus === "current" ||
      candidate.previewStatus === "lastGood" ||
      candidate.previewStatus === "noValidPreview");
};

const isModulePreviewValueUnavailable = (
  message: unknown
): message is VscodeModulePreviewValueUnavailable => {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as Partial<VscodeModulePreviewValueUnavailable>;
  return candidate.type === "modulePreviewValueUnavailable" &&
    (candidate.sessionId === null || typeof candidate.sessionId === "string") &&
    (candidate.documentUri === null || typeof candidate.documentUri === "string") &&
    (candidate.documentVersion === null || Number.isInteger(candidate.documentVersion)) &&
    (candidate.sourceRevision === null || Number.isInteger(candidate.sourceRevision)) &&
    Number.isInteger(candidate.sessionRevision) &&
    (candidate.target === null || typeof candidate.target === "object") &&
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

const currentSourceEditorFor = (document: vscode.TextDocument): vscode.TextEditor | undefined => {
  const active = vscode.window.activeTextEditor;
  if (active && sameDocument(active.document, document) && typeof active.edit === "function") return active;
  return visibleEditorFor(document);
};

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
  canvasGridSettings = () => DEFAULT_CANVAS_GRID_SETTINGS,
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
  let boundValueSession: ModulePreviewSession | null = null;

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

  const nextSessionIdentity = (): { sessionId: string; sessionGeneration: number } => {
    const sessionGeneration = nextSessionGeneration;
    nextSessionGeneration += 1;
    return {
      sessionId: `module-preview-session:${sessionGeneration}`,
      sessionGeneration
    };
  };

  const currentBootstrapIdentityFor = (session: Pick<ModulePreviewSession, "sessionId" | "sessionGeneration" | "documentUri" | "document">) => ({
    sessionId: session.sessionId,
    sessionGeneration: session.sessionGeneration,
    documentUri: session.documentUri,
    documentVersion: session.document.version
  });

  const bootstrapIsAuthoritative = (session: ModulePreviewSession): boolean => {
    const acknowledgement = session.bootstrapAcknowledgement;
    const current = currentBootstrapIdentityFor(session);
    return Boolean(
      session.webviewReady &&
      acknowledgement &&
      acknowledgement.sessionId === current.sessionId &&
      acknowledgement.sessionGeneration === current.sessionGeneration &&
      acknowledgement.documentUri === current.documentUri &&
      acknowledgement.documentVersion === current.documentVersion
    );
  };

  const pendingTargetFor = (
    session: Pick<ModulePreviewSession, "sessionId" | "sessionGeneration" | "documentUri" | "document">,
    pending: Omit<ModulePreviewPendingTarget, "sessionId" | "sessionGeneration" | "documentUri" | "documentVersion">
  ): ModulePreviewPendingTarget => ({
    ...pending,
    ...currentBootstrapIdentityFor(session)
  });

  const setContext = (key: string, enabled: boolean): void => {
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => vscode.commands.executeCommand("setContext", key, enabled))
      .then(() => undefined);
  };

  const retainValueMessage = (
    session: ModulePreviewSession,
    message: ModulePreviewValueMessage
  ): void => {
    if (
      session.activeReferencePick &&
      (message.type !== "modulePreviewValueSnapshot" ||
        message.sessionRevision !== session.activeReferencePick.request.sessionRevision)
    ) cancelActiveReferencePick(session);
    session.retainedValueMessage = message;
    if (message.type === "modulePreviewValueUnavailable" &&
      message.reason !== "target-unavailable" && message.reason !== "disposed") return;
    for (const resolve of session.valueSnapshotWaiters) resolve();
    session.valueSnapshotWaiters.clear();
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
      !bootstrapIsAuthoritative(session)
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
        (nativeHistoryStarted || bootstrapIsAuthoritative(session) && session.document.version === expectedDocumentVersion),
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

  const valueUnavailableFor = (
    session: ModulePreviewSession,
    reason: VscodeModulePreviewValueUnavailable["reason"]
  ): VscodeModulePreviewValueUnavailable => ({
    type: "modulePreviewValueUnavailable",
    sessionId: session.sessionId,
    documentUri: session.documentUri,
    documentVersion: session.document.version,
    sourceRevision: currentTargetFor(session).sourceRevision,
    sessionRevision: session.retainedValueMessage?.sessionId === session.sessionId
      ? session.retainedValueMessage.sessionRevision
      : 0,
    target: currentTargetFor(session).target
      ? {
          definitionStatementIndex: currentTargetFor(session).target!.definitionStatementIndex,
          name: currentTargetFor(session).target!.name
        }
      : null,
    reason
  });

  const valueUnavailableReasonFor = (
    session: ModulePreviewSession
  ): Exclude<VscodeModulePreviewValueUnavailable["reason"], "no-session"> => {
    if (!session.webviewReady) return "not-ready";
    if (!bootstrapIsAuthoritative(session)) return "source-stale";
    if (!currentTargetFor(session).target) return "target-unavailable";
    return "not-ready";
  };

  const publishValueUnavailable = (
    session: ModulePreviewSession,
    reason: Exclude<VscodeModulePreviewValueUnavailable["reason"], "no-session">
  ): void => {
    retainValueMessage(session, valueUnavailableFor(session, reason));
  };

  const clearValueBinding = (): void => {
    boundValueSession = null;
    for (const session of sessions.values()) cancelActiveReferencePick(session);
  };

  const postValueUnavailable = (
    session: ModulePreviewSession,
    reason: Exclude<VscodeModulePreviewValueUnavailable["reason"], "no-session">
  ): void => {
    const message = valueUnavailableFor(session, reason);
    if (!currentValueAuthorityFor(session)) retainValueMessage(session, message);
    if (session.webviewReady) void session.panel.webview.postMessage(message satisfies ExtensionToVscodeMessage);
  };

  const bindValueSession = (session: ModulePreviewSession): void => {
    boundValueSession = session;
    const retained = session.retainedValueMessage;
    if (retained && isCurrentValueMessage(session, retained)) {
      return;
    }
    const current = currentTargetFor(session);
    const reason = !current.target
      ? "target-unavailable"
      : !bootstrapIsAuthoritative(session)
        ? "source-stale"
        : "not-ready";
    publishValueUnavailable(session, reason);
  };

  const valueGroupFor = (
    snapshot: VscodeModulePreviewValueSnapshot,
    proof: Pick<VscodeModulePreviewValueSiteProof, "blockKind" | "definitionStatementIndex" | "definitionName">
  ) => snapshot.groups.find((group) =>
    group.kind === proof.blockKind &&
    group.definitionStatementIndex === proof.definitionStatementIndex &&
    group.name === proof.definitionName
  ) ?? null;

  const currentValueSnapshot = (session: ModulePreviewSession): VscodeModulePreviewValueSnapshot | null =>
    session.retainedValueMessage?.type === "modulePreviewValueSnapshot"
      ? session.retainedValueMessage
      : null;

  const currentValueSnapshotIsCurrent = (
    session: ModulePreviewSession,
    snapshot: VscodeModulePreviewValueSnapshot
  ): boolean => {
    if (
      snapshot.sessionId !== session.sessionId ||
      snapshot.documentUri !== session.documentUri ||
      snapshot.documentVersion !== session.document.version ||
      snapshot.normalizedSource !== normalizedSourceFor(session.document.getText()) ||
      sessions.get(session.documentUri) !== session ||
      !isOpenDocument(session.document) ||
      !session.webviewReady ||
      !bootstrapIsAuthoritative(session)
    ) return false;
    const current = currentTargetFor(session);
    return Boolean(current.target &&
      current.target.definitionStatementIndex === snapshot.target.definitionStatementIndex &&
      current.target.name === snapshot.target.name);
  };

  const currentValueSiteFor = (
    session: ModulePreviewSession,
    proof: VscodeModulePreviewValueSiteProof
  ) => {
    const snapshot = currentValueSnapshot(session);
    if (!snapshot || boundValueSession !== session || !currentValueSnapshotIsCurrent(session, snapshot) ||
      proof.sessionId !== session.sessionId || proof.documentUri !== session.documentUri ||
      proof.documentVersion !== session.document.version || proof.normalizedSource !== snapshot.normalizedSource ||
      proof.sourceRevision !== snapshot.sourceRevision || proof.sessionRevision !== snapshot.sessionRevision ||
      proof.targetDefinitionStatementIndex !== snapshot.target.definitionStatementIndex ||
      proof.targetName !== snapshot.target.name)
      return null;
    const group = valueGroupFor(snapshot, proof);
    const parameter = group?.parameters.find((candidate) =>
      candidate.parameterIndex === proof.parameterIndex && candidate.name === proof.parameterName
    );
    if (!group || !parameter)
      return null;
    return { snapshot, group, parameter };
  };

  const isCurrentValueMessage = (
    session: ModulePreviewSession,
    message: ModulePreviewValueMessage
  ): boolean => {
    if (message.sessionId !== session.sessionId || message.documentUri !== session.documentUri ||
      message.documentVersion !== session.document.version) return false;
    if (message.type === "modulePreviewValueUnavailable") {
      const current = currentTargetFor(session);
      return message.target === null || !current.target ||
        (message.target.definitionStatementIndex === current.target.definitionStatementIndex &&
          message.target.name === current.target.name);
    }
    return currentValueSnapshotIsCurrent(session, message);
  };

  const acceptsValueSnapshot = (
    session: ModulePreviewSession,
    message: VscodeModulePreviewValueSnapshot
  ): boolean => {
    if (!session || !bootstrapIsAuthoritative(session)) return false;
    if (!Number.isInteger(message.sessionRevision) || !isCurrentValueMessage(session, message)) return false;
    const latest = session.retainedValueMessage;
    if (latest && message.sessionRevision <= latest.sessionRevision) return false;
    return true;
  };

  const acceptsValueUnavailable = (
    session: ModulePreviewSession,
    message: VscodeModulePreviewValueUnavailable
  ): boolean => {
    if (!session || !isCurrentValueMessage(session, message)) return false;
    const latest = session.retainedValueMessage;
    if (latest && message.sessionRevision <= latest.sessionRevision) return false;
    retainValueMessage(session, message);
    return true;
  };

  const currentValueAuthorityFor = (session: ModulePreviewSession): VscodeModulePreviewValueSnapshot | null => {
    const snapshot = currentValueSnapshot(session);
    return snapshot && currentValueSnapshotIsCurrent(session, snapshot) ? snapshot : null;
  };

  const waitForValueAuthority = async (
    session: ModulePreviewSession
  ): Promise<VscodeModulePreviewValueSnapshot | null> => {
    const current = currentValueAuthorityFor(session);
    if (current) return current;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        session.valueSnapshotWaiters.delete(wake);
        resolve(null);
      }, 5000);
      const wake = () => {
        clearTimeout(timer);
        session.valueSnapshotWaiters.delete(wake);
        resolve(currentValueAuthorityFor(session));
      };
      session.valueSnapshotWaiters.add(wake);
    });
  };

  const currentModulePreviewSessionForCommand = (): ModulePreviewSession | null => {
    const activePanelSession = [...sessions.values()].find((candidate) => candidate.panel.active);
    if (activePanelSession) return activePanelSession;
    const editor = vscode.window.activeTextEditor;
    return editor ? sessions.get(documentKey(editor.document)) ?? null : null;
  };

  const refreshInsertContext = (): void => {
    const session = currentModulePreviewSessionForCommand();
    const editor = session ? currentSourceEditorFor(session.document) : undefined;
    setContext(
      NUI_MODULE_PREVIEW_INSERT_CONTEXT,
      Boolean(session && editor && sameDocument(editor.document, session.document) && isOpenDocument(session.document))
    );
  };

  const valueDescriptionFor = (parameter: VscodeModulePreviewValueSnapshot["groups"][number]["parameters"][number]): string => {
    switch (parameter.valueState) {
      case "explicit": return `Explicit: ${parameter.value}`;
      case "omitted-defaulted": return `Omitted; default: ${parameter.defaultSourceText ?? ""}`;
      case "omitted-optional": return "Omitted; optional";
      case "required-missing": return "Required value missing";
      case "invalid": return `Invalid: ${parameter.value}`;
    }
  };

  const valueProofFor = (
    snapshot: VscodeModulePreviewValueSnapshot,
    group: VscodeModulePreviewValueSnapshot["groups"][number],
    parameter: VscodeModulePreviewValueSnapshot["groups"][number]["parameters"][number]
  ): VscodeModulePreviewValueSiteProof => ({
    sessionId: snapshot.sessionId,
    documentUri: snapshot.documentUri,
    documentVersion: snapshot.documentVersion,
    normalizedSource: snapshot.normalizedSource,
    sourceRevision: snapshot.sourceRevision,
    sessionRevision: snapshot.sessionRevision,
    targetDefinitionStatementIndex: snapshot.target.definitionStatementIndex,
    targetName: snapshot.target.name,
    definitionStatementIndex: group.definitionStatementIndex,
    definitionName: group.name,
    blockKind: group.kind,
    parameterIndex: parameter.parameterIndex,
    parameterName: parameter.name
  });

  const editModulePreviewValueSite = async (
    session: ModulePreviewSession,
    site: VscodeModulePreviewValueSiteProof
  ): Promise<void> => {
    const currentSite = currentValueSiteFor(session, site);
    if (!currentSite) {
      postValueUnavailable(session, valueUnavailableReasonFor(session));
      return;
    }
    const geometryInterface = moduleGeometryInterfaceTypeOf(currentSite.parameter.type);
    if (geometryInterface) {
      const geometryChoice = await nativeShowQuickPick([
        { label: "Pick from Canvas", kind: "pick" as const },
        { label: "Enter expression...", kind: "expression" as const }
      ], {
        placeHolder: `Choose how to edit ${site.definitionName}.${site.parameterName}`
      });
      if (!geometryChoice) return;
      if (geometryChoice.kind === "pick") {
        startValueReferencePick({
          type: "modulePreviewValueReferencePickStart",
          ...site,
          expectedGeometryInterface: geometryInterface
        });
        return;
      }
    }
    const expression = await nativeShowInputBox({
      prompt: `${site.blockKind === "ancestor" ? "Context" : "Target"} ${site.definitionName}.${site.parameterName}`,
      value: currentSite.parameter.valueState === "explicit" ? currentSite.parameter.value : ""
    });
    if (expression === undefined) return;
    const message: VscodeModulePreviewValueEdit = {
      ...site,
      type: "modulePreviewValueEdit",
      expression: expression.trim().length === 0 ? null : expression
    };
    if (!currentValueSiteFor(session, message)) return;
    void session.panel.webview.postMessage(message satisfies ExtensionToVscodeMessage);
  };

  const editModulePreviewValues = async (sessionOverride?: ModulePreviewSession): Promise<void> => {
    let session = sessionOverride;
    if (!session) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isSupportedNuiDocument(editor.document)) {
        void vscode.window.showErrorMessage(modulePreviewTranslatorFor(displayLanguageFor())("modulePreview.requiresSourceEditor"));
        return;
      }
      const target = exactTargetAtEditor(editor, languageAnalysisSessionFor);
      if (!target) {
        void vscode.window.showErrorMessage(modulePreviewTranslatorFor(displayLanguageFor())("modulePreview.placeCaret"));
        return;
      }
      const existing = sessions.get(documentKey(editor.document));
      const existingTarget = existing ? currentTargetFor(existing).target : null;
      if (existing && existingTarget &&
        existingTarget.definitionStatementId === target.target.definitionStatementId &&
        existingTarget.definitionStatementIndex === target.target.definitionStatementIndex &&
        existingTarget.name === target.target.name) {
        existing.panel.reveal(undefined, false);
        session = existing;
      } else {
        session = createOrRetargetPanel(editor, target);
      }
    }
    const snapshot = await waitForValueAuthority(session);
    if (!snapshot) {
      void vscode.window.showErrorMessage(
        modulePreviewTranslatorFor(displayLanguageFor())("modulePreview.valuesUnavailable")
      );
      postValueUnavailable(session, valueUnavailableReasonFor(session));
      return;
    }
    const items = snapshot.groups.flatMap((group) => group.parameters.map((parameter) => ({
      label: `${group.kind === "ancestor" ? "Context" : "Target"}: ${group.name}.${parameter.name}`,
      description: valueDescriptionFor(parameter),
      detail: parameter.type ? `${parameter.type.kind} parameter` : "parameter",
      site: valueProofFor(snapshot, group, parameter),
      parameter
    })));
    const selected = await nativeShowQuickPick(items, {
      placeHolder: "Select a Module Preview value to edit",
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!selected) return;
    await editModulePreviewValueSite(session, selected.site);
  };

  const currentReferencePickSiteFor = (
    session: ModulePreviewSession,
    proof: VscodeModulePreviewValueSiteProof
  ) => {
    const match = currentValueSiteFor(session, proof);
    if (!match) return null;
    const expectedGeometryInterface = moduleGeometryInterfaceTypeOf(match.parameter.type);
    return expectedGeometryInterface ? { ...match, expectedGeometryInterface } : null;
  };

  const startValueReferencePick = (
    message: VscodeModulePreviewValueReferencePickStart
  ): boolean => {
    const session = boundValueSession;
    const match = session ? currentReferencePickSiteFor(session, message) : null;
    if (!session || !match) return false;
    cancelActiveReferencePick(session);
    const request: VscodeModulePreviewReferencePickStartRequest = {
      type: "modulePreviewReferencePickStartRequest",
      requestId: nextReferencePickRequestId,
      sessionId: message.sessionId,
      documentUri: message.documentUri,
      documentVersion: message.documentVersion,
      normalizedSource: message.normalizedSource,
      sourceRevision: message.sourceRevision,
      sessionRevision: message.sessionRevision,
      targetDefinitionStatementIndex: message.targetDefinitionStatementIndex,
      targetName: message.targetName,
      definitionStatementIndex: message.definitionStatementIndex,
      definitionName: message.definitionName,
      blockKind: message.blockKind,
      parameterIndex: message.parameterIndex,
      parameterName: message.parameterName,
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
      result.normalizedSource !== request.normalizedSource ||
      result.sourceRevision !== request.sourceRevision ||
      result.sessionRevision !== request.sessionRevision ||
      result.targetDefinitionStatementIndex !== request.targetDefinitionStatementIndex ||
      result.targetName !== request.targetName ||
      result.blockKind !== request.blockKind ||
      result.definitionStatementIndex !== request.definitionStatementIndex ||
      result.definitionName !== request.definitionName ||
      result.parameterIndex !== request.parameterIndex ||
      result.parameterName !== request.parameterName ||
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
    void session.panel.webview.postMessage({
      type: "modulePreviewValueEdit",
      sessionId: request.sessionId,
      documentUri: request.documentUri,
      documentVersion: request.documentVersion,
      normalizedSource: request.normalizedSource,
      sourceRevision: request.sourceRevision,
      sessionRevision: request.sessionRevision,
      targetDefinitionStatementIndex: request.targetDefinitionStatementIndex,
      targetName: request.targetName,
      definitionStatementIndex: request.definitionStatementIndex,
      definitionName: request.definitionName,
      blockKind: request.blockKind,
      parameterIndex: request.parameterIndex,
      parameterName: request.parameterName,
      expression
    } satisfies ExtensionToVscodeMessage);
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
      !bootstrapIsAuthoritative(session) ||
      pending.sessionId !== session.sessionId ||
      pending.sessionGeneration !== session.sessionGeneration ||
      pending.documentUri !== session.documentUri ||
      pending.documentVersion !== session.document.version
    ) return;
    session.pendingTarget = null;
    const message: ExtensionToVscodeMessage = pending.kind === "target"
      ? {
          type: "modulePreviewTarget",
          sessionId: pending.sessionId,
          sessionGeneration: pending.sessionGeneration,
          documentUri: pending.documentUri,
          documentVersion: pending.documentVersion,
          normalizedSourceOffset: pending.normalizedSourceOffset
        }
      : {
          type: "modulePreviewTargetUnavailable",
          sessionId: pending.sessionId,
          sessionGeneration: pending.sessionGeneration,
          documentUri: pending.documentUri,
          documentVersion: pending.documentVersion
        };
    void session.panel.webview.postMessage(message);
    if (pending.kind === "unavailable") publishValueUnavailable(session, "target-unavailable");
  };

  const postBootstrap = (session: ModulePreviewSession): void => {
    session.bootstrapAcknowledgement = null;
    void session.panel.webview.postMessage({
      type: "modulePreviewBootstrap",
      sessionId: session.sessionId,
      sessionGeneration: session.sessionGeneration,
      documentUri: session.documentUri,
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
    session.pendingTarget = pendingTargetFor(session, refreshed
      ? { kind: "target", normalizedSourceOffset: refreshed.normalizedSourceOffset }
      : { kind: "unavailable" });
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
    postBootstrap(session);
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
      !bootstrapIsAuthoritative(session)
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

  const insertModulePreviewInstance = async (session: ModulePreviewSession): Promise<void> => {
    const stale = (reason: string): void => {
      resyncModulePreview(session);
      void vscode.window.showErrorMessage(reason);
    };
    const rejected = (reason: string): void => {
      void vscode.window.showErrorMessage(reason);
    };

    if (
      sessions.get(session.documentUri) !== session ||
      !session.webviewReady ||
      !isOpenDocument(session.document) ||
      !bootstrapIsAuthoritative(session)
    ) {
      stale("Module Preview session is no longer authoritative.");
      return;
    }
    const snapshot = currentValueAuthorityFor(session);
    if (!snapshot || snapshot.previewStatus !== "current") {
      stale("The current Module Preview values are not exact-current.");
      return;
    }
    const current = currentTargetFor(session);
    if (
      !current.target ||
      current.target.definitionStatementIndex !== snapshot.target.definitionStatementIndex ||
      current.target.name !== snapshot.target.name
    ) {
      stale("The Module Preview target is stale.");
      return;
    }
    const targetGroup = snapshot.groups.find((group) =>
      group.kind === "target" &&
      group.definitionStatementIndex === snapshot.target.definitionStatementIndex &&
      group.name === snapshot.target.name
    );
    if (!targetGroup) {
      rejected("The current Module Preview has no exact target value group.");
      return;
    }
    if (targetGroup.parameters.some((parameter) => parameter.valueState === "required-missing" || parameter.valueState === "invalid")) {
      rejected("Complete the required target values before inserting an instance.");
      return;
    }
    const explicitArguments = targetGroup.parameters
      .filter((parameter) => parameter.valueState === "explicit")
      .map((parameter) => ({ name: parameter.name, expression: parameter.value }));
    if (explicitArguments.some((argument) => argument.expression.length === 0)) {
      rejected("The current Module Preview contains an empty explicit argument.");
      return;
    }

    const editor = currentSourceEditorFor(session.document);
    if (!editor || !sameDocument(editor.document, session.document)) {
      rejected("The current same-document Source editor is not available.");
      return;
    }
    const rawSource = editor.document.getText();
    const source = sourceContextFor(session);
    if (
      editor.document.version !== snapshot.documentVersion ||
      normalizedSourceFor(rawSource) !== snapshot.normalizedSource ||
      !source.semantic?.compiled
    ) {
      stale("The source document changed after the current Module Preview values were published.");
      return;
    }
    const insertionOffset = normalizedOffsetFromRaw(rawSource, editor.document.offsetAt(editor.selection.active));
    const plan = planModulePreviewInstance({
      source: source.source,
      compiled: source.semantic.compiled,
      insertionOffset,
      target: {
        statementId: session.targetDefinitionStatementId,
        statementIndex: current.target.definitionStatementIndex,
        name: current.target.name
      },
      explicitArguments
    });
    if (plan.status === "rejected") {
      rejected(plan.message);
      return;
    }
    if (
      currentSourceEditorFor(session.document) !== editor ||
      editor.document.version !== snapshot.documentVersion ||
      editor.document.getText() !== rawSource ||
      currentValueAuthorityFor(session) !== snapshot
    ) {
      stale("The Source editor or Module Preview values changed before insertion.");
      return;
    }
    const edit = textEditForLineSplice(editor.document, rawSource, plan.splice);
    let applied: boolean;
    try {
      applied = await editor.edit(
        (editBuilder) => editBuilder.replace(edit.range, edit.replacement),
        { undoStopBefore: true, undoStopAfter: true }
      );
    } catch (error) {
      rejected(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!applied) {
      const changedDuringApply = editor.document.version !== snapshot.documentVersion || editor.document.getText() !== rawSource;
      if (changedDuringApply) stale("The source document changed while inserting the Module instance.");
      else rejected("VS Code rejected the Module instance source edit.");
      return;
    }
    let focusedEditor = editor;
    try {
      const shown = await vscode.window.showTextDocument(session.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false
      });
      if (sameDocument(shown.document, session.document)) focusedEditor = shown;
    } catch {
      // The source edit is already applied; retain the exact selection on the existing editor.
    }
    const insertedRange = vscodeRangeForNormalized(
      focusedEditor.document,
      focusedEditor.document.getText(),
      plan.insertedNameRange
    );
    focusedEditor.selection = new vscode.Selection(insertedRange.start, insertedRange.end);
    focusedEditor.revealRange?.(insertedRange);
  };

  const disposeSession = (session: ModulePreviewSession): void => {
    if (sessions.get(session.documentUri) !== session) return;
    cancelActiveReferencePick(session);
    if (boundValueSession === session) clearValueBinding();
    session.retainedValueMessage = null;
    for (const resolve of session.valueSnapshotWaiters) resolve();
    session.valueSnapshotWaiters.clear();
    session.webviewReady = false;
    session.bootstrapAcknowledgement = null;
    session.pendingTarget = null;
    sessions.delete(session.documentUri);
    for (const disposable of session.disposables.splice(0)) disposable.dispose();
    refreshInsertContext();
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
      if (boundValueSession === existing) clearValueBinding();
      const identity = nextSessionIdentity();
      existing.sessionId = identity.sessionId;
      existing.sessionGeneration = identity.sessionGeneration;
      existing.targetDefinitionStatementId = target.target.definitionStatementId;
      existing.bootstrapAcknowledgement = null;
      existing.retainedValueMessage = null;
      existing.pendingTarget = pendingTargetFor(existing, {
        kind: "target",
        normalizedSourceOffset: target.normalizedSourceOffset
      });
      bindValueSession(existing);
      existing.panel.reveal(vscode.ViewColumn.Beside);
      if (existing.webviewReady) postBootstrap(existing);
      deliverPendingTarget(existing);
      refreshInsertContext();
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      NUI_MODULE_PREVIEW_VIEW_TYPE,
      modulePreviewTranslatorFor(displayLanguageFor())("modulePreview.panelTitle"),
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    const identity = nextSessionIdentity();
    const session: ModulePreviewSession = {
      documentUri: key,
      document,
      panel,
      sessionId: identity.sessionId,
      sessionGeneration: identity.sessionGeneration,
      targetDefinitionStatementId: target.target.definitionStatementId,
      webviewReady: false,
      bootstrapAcknowledgement: null,
      pendingTarget: pendingTargetFor({
        documentUri: key,
        document,
        sessionId: identity.sessionId,
        sessionGeneration: identity.sessionGeneration
      }, {
        kind: "target",
        normalizedSourceOffset: target.normalizedSourceOffset
      }),
      retainedValueMessage: null,
      valueSnapshotWaiters: new Set(),
      activeReferencePick: null,
      disposables: []
    };
    sessions.set(key, session);
    bindValueSession(session);
    refreshInsertContext();

    session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (!sameDocument(event.document, session.document) || event.contentChanges.length === 0) return;
      cancelActiveReferencePick(session);
      refreshExistingTarget(session);
      session.bootstrapAcknowledgement = null;
      publishValueUnavailable(session, "source-stale");
      if (session.webviewReady) postBootstrap(session);
    }));

    session.disposables.push(panel.webview.onDidReceiveMessage(async (message: VscodeToExtensionMessage) => {
      if (sessions.get(session.documentUri) !== session) return;
      if (message.type === "bakeOperationResult") {
        await presentBakeOperationResult?.(message);
        return;
      }
      if (isModulePreviewModelPatchRequest(message)) {
        await applyModulePreviewModelPatch(session, message);
        return;
      }
      if (message.type === "modulePreviewInsertInstance") {
        await vscode.commands.executeCommand(MODULE_PREVIEW_INSERT_INSTANCE_COMMAND);
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
      if (isModulePreviewValueSiteEditRequest(message)) {
        void editModulePreviewValueSite(session, message);
        return;
      }
      if (isModulePreviewValueReferencePickStart(message)) {
        startValueReferencePick(message);
        return;
      }
      if (message.type === "modulePreviewEditValues") {
        void editModulePreviewValues(session);
        return;
      }
      if (message.type === "webviewReady") {
        session.webviewReady = true;
        refreshExistingTarget(session);
        void panel.webview.postMessage({
          type: "webviewPresentation",
          presentation: webviewPresentationFor(displayLanguageFor())
        } satisfies ExtensionToVscodeMessage);
        postBootstrap(session);
        void panel.webview.postMessage({
          type: "canvasRibbonConfiguration",
          ribbons: canvasRibbons()
        } satisfies ExtensionToVscodeMessage);
        void panel.webview.postMessage({
          type: "canvasGridConfiguration",
          settings: normalizeCanvasGridSettings(canvasGridSettings())
        } satisfies ExtensionToVscodeMessage);
        refreshInsertContext();
        return;
      }
      if (message.type === "modulePreviewBootstrapAcknowledged") {
        if (
          !session.webviewReady ||
          message.sessionId !== session.sessionId ||
          message.sessionGeneration !== session.sessionGeneration ||
          message.documentUri !== session.documentUri ||
          message.documentVersion !== session.document.version
        ) return;
        session.bootstrapAcknowledgement = message;
        deliverPendingTarget(session);
        return;
      }
      if (message.type === "modulePreviewValueSnapshot" && isModulePreviewValueSnapshot(message)) {
        if (acceptsValueSnapshot(session, message)) retainValueMessage(session, message);
        return;
      }
      if (message.type === "modulePreviewValueUnavailable" && isModulePreviewValueUnavailable(message)) {
        acceptsValueUnavailable(session, message);
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
      bindValueSession(session);
      refreshInsertContext();
    }));
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

  disposables.push(vscode.commands.registerCommand("nuinuiCAD.editModulePreviewValues", () => {
    const activeSession = [...sessions.values()].find((session) => session.panel.active);
    void editModulePreviewValues(activeSession);
  }));

  disposables.push(vscode.commands.registerCommand(MODULE_PREVIEW_INSERT_INSTANCE_COMMAND, () => {
    const session = currentModulePreviewSessionForCommand();
    if (!session) {
      void vscode.window.showErrorMessage(
        modulePreviewTranslatorFor(displayLanguageFor())("modulePreview.valuesUnavailable")
      );
      return;
    }
    void insertModulePreviewInstance(session);
  }));

  disposables.push(vscode.window.onDidChangeActiveTextEditor(() => {
    refreshSourceTargetContext();
    refreshInsertContext();
  }));
  disposables.push(vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === vscode.window.activeTextEditor) {
      refreshSourceTargetContext();
      refreshInsertContext();
    }
  }));
  disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
    if (vscode.window.activeTextEditor && sameDocument(event.document, vscode.window.activeTextEditor.document)) {
      refreshSourceTargetContext();
      refreshInsertContext();
    }
  }));
  disposables.push(vscode.workspace.onDidCloseTextDocument((document) => {
    const session = sessions.get(documentKey(document));
    if (session) {
      session.panel.dispose();
      disposeSession(session);
    }
    refreshSourceTargetContext();
    refreshInsertContext();
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
    if (event.affectsConfiguration("nuinuiCAD.canvasRibbon.ribbons")) {
      const ribbons = canvasRibbons();
      for (const session of sessions.values()) {
        void session.panel.webview.postMessage({
          type: "canvasRibbonConfiguration",
          ribbons
        } satisfies ExtensionToVscodeMessage);
      }
    }
    if (CANVAS_GRID_SETTING_KEYS.some((key) => event.affectsConfiguration(key))) {
      const settings = normalizeCanvasGridSettings(canvasGridSettings());
      for (const session of sessions.values()) {
        void session.panel.webview.postMessage({
          type: "canvasGridConfiguration",
          settings
        } satisfies ExtensionToVscodeMessage);
      }
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
      setContext(NUI_MODULE_PREVIEW_INSERT_CONTEXT, false);
      clearValueBinding();
      for (const session of [...sessions.values()]) session.panel.dispose();
      if (boundValueSession) clearValueBinding();
      for (const disposable of disposables.splice(0)) disposable.dispose();
      sessions.clear();
    }
  };
};
