import * as vscode from "vscode";
import {
  projectDslRevealRuntimeStatementOwner,
  queryDslCanvasSourceTarget,
  queryDslCanvasRevealSourceTarget,
  type DslRevealRuntimeStatementOwnerProjection
} from "@nuinuicad/nui-language";
import {
  isDslOutputPreviewRevealSourceTargetStructurallyAvailable,
  queryDslOutputPreviewRevealSourceTarget,
  type DslOutputPreviewRevealSourceQueryResult,
  type DslOutputPreviewRevealSourceTarget
} from "@nuinuicad/nui-language";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import type { CanonicalGeometrySourceReference } from "../../src/model/moduleSemanticCandidateBoundary";
import type {
  VscodeReferencePickResult,
  VscodeReferencePickNumericPropertyDraft,
  VscodeReferencePickTargetProof
} from "../../src/vscode/referencePickProtocol";
import {
  currentCompiledSemanticSnapshotFor,
  type NuiLanguageAnalysisSession
} from "./languageAnalysisSession";
import {
  activeVscodeMultiDocumentHost,
  type VscodeMultiDocumentLanguageSemanticSnapshot
} from "./multiDocumentHost";
import { referencePickTranslatorFor } from "./referencePickLocalization";
import {
  createVscodeReferencePickSourceBridge,
  type VscodeReferencePickAppliedHandoff,
  type VscodeReferencePickSourceBridge
} from "./referencePickSourceBridge";
import { normalizedOffsetFromRaw, normalizedSourceFor } from "./sourceOffsetAdapter";

export const VSCODE_REFERENCE_PICK_COMMAND_ID = "nuinuiCAD.pickReferenceFromCanvas";
export const VSCODE_REFERENCE_PICK_CONTEXT_KEY = "nuinuiCAD.referencePickSourceTarget";
export const VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY = "nuinuiCAD.revealInCanvasSourceTarget";
export const VSCODE_REVEAL_IN_OUTPUT_PREVIEW_SOURCE_TARGET_CONTEXT_KEY = "nuinuiCAD.revealInOutputPreviewSourceTarget";
export const VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY = "nuinuiCAD.bakeSourceTarget";

const vscodeDisplayLanguage = (): string => {
  try {
    return vscode.env?.language ?? "en";
  } catch {
    return "en";
  }
};

export type VscodeReferencePickCanvasEndpoint = {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  isAuthoritativeReady: () => boolean;
};

type ActiveReferencePick = {
  editor: vscode.TextEditor;
  normalizedSourceOffset: number;
  documentVersion: number;
  requestId: number;
  endpoint: VscodeReferencePickCanvasEndpoint;
  bridge: VscodeReferencePickSourceBridge | null;
  initialDraftReferences?: readonly CanonicalGeometrySourceReference[];
  initialNumericPropertyDraft?: VscodeReferencePickNumericPropertyDraft;
  expectedTargetProof?: VscodeReferencePickTargetProof;
  webviewDisposable: vscode.Disposable;
  panelDisposable: vscode.Disposable;
};

type ReferencePickHistoryHandoff = VscodeReferencePickAppliedHandoff & {
  editor: vscode.TextEditor;
  endpoint: VscodeReferencePickCanvasEndpoint;
  state: "confirmed" | "restored";
};

export type VscodeSourceTargetAvailability = {
  referencePickSourceOffset: number | null;
  revealInCanvas: boolean;
  revealInOutputPreview: boolean;
  bake: boolean;
};

export type VscodeCanvasRevealSourceTarget = {
  target: import("@nuinuicad/nui-language").DslCanvasRevealSourceTarget;
  documentVersion: number;
  normalizedSourceOffset: number;
  sourceRevision: number;
  graphRevision: number | null;
  runtimeProjection?: DslRevealRuntimeStatementOwnerProjection;
};

export type VscodeCanvasRevealSourceTargetResult =
  | { status: "resolved"; value: VscodeCanvasRevealSourceTarget }
  | {
      status: "failed";
      reason: import("@nuinuicad/nui-language").DslCanvasRevealFailureReason | "analysis-unavailable";
    };

const unavailableSourceTargets = (): VscodeSourceTargetAvailability => ({
  referencePickSourceOffset: null,
  revealInCanvas: false,
  revealInOutputPreview: false,
  bake: false
});

const isSupportedSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor =>
  Boolean(editor) &&
  editor!.document.uri.scheme === "file" &&
  editor!.document.fileName.endsWith(".nui");

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const targetSourceStatementIndex = (
  target: import("@nuinuicad/nui-language").DslCanvasRevealSourceTarget
): number => target.kind === "semantic"
  ? target.semantic.sourceStatementIndex
  : target.sourceStatementIndex;

/**
 * Imported Module callers are the only Reveal targets that require the
 * graph-published runtime universe. Ordinary root elements and same-document
 * local Module callers continue through the local Canvas path.
 */
const requiresMultiDocumentRuntime = (
  compiled: NonNullable<ReturnType<typeof currentCompiledSemanticSnapshotFor>>["compiled"],
  target: import("@nuinuicad/nui-language").DslCanvasRevealSourceTarget,
  rootDocumentId: string
): boolean => [...(compiled.moduleMaterialization?.executionStatements ?? [])].some((entry) => {
  if (entry.sourceStatementIndex !== targetSourceStatementIndex(target)) return false;
  const origin = entry.origin;
  return Boolean(
    (origin?.sourceDocumentId !== undefined && String(origin.sourceDocumentId) !== rootDocumentId) ||
    (origin?.moduleDefinitionDocumentId !== undefined && String(origin.moduleDefinitionDocumentId) !== rootDocumentId)
  );
});

type EditorRevealQueryState = {
  rawSource: string;
  source: { normalizedSource: string; sourceRevision: number };
  normalizedSourceOffset: number;
  semantic: ReturnType<typeof currentCompiledSemanticSnapshotFor>;
};

const editorRevealQueryStateFor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): EditorRevealQueryState | null => {
  if (!isSupportedSourceEditor(editor)) return null;
  const rawSource = editor.document.getText();
  if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: languageAnalysisSession.getSourceRevision()
  };
  return {
    rawSource,
    source,
    normalizedSourceOffset: normalizedOffsetFromRaw(
      rawSource,
      editor.document.offsetAt(editor.selection.active)
    ),
    semantic: currentCompiledSemanticSnapshotFor(languageAnalysisSession, source)
  };
};

export const localRevealSourceTargetForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): VscodeCanvasRevealSourceTargetResult => {
  const state = editorRevealQueryStateFor(editor, languageAnalysisSession);
  if (!state || !state.semantic?.compiled?.statementMap) {
    return { status: "failed", reason: "analysis-unavailable" };
  }
  const result = queryDslCanvasRevealSourceTarget({
    source: state.source,
    compiled: state.semantic.compiled,
    position: state.normalizedSourceOffset
  });
  return result.status === "resolved"
    ? {
        status: "resolved",
        value: {
          target: result.target,
          documentVersion: editor.document.version,
          normalizedSourceOffset: state.normalizedSourceOffset,
          sourceRevision: state.source.sourceRevision,
          graphRevision: null
        }
      }
    : result;
};

const localRevealRequiresMultiDocumentRuntime = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession,
  result: VscodeCanvasRevealSourceTargetResult
): boolean => {
  if (result.status !== "resolved") return false;
  const state = editorRevealQueryStateFor(editor, languageAnalysisSession);
  return Boolean(
    state?.semantic?.compiled &&
    requiresMultiDocumentRuntime(
      state.semantic.compiled,
      result.value.target,
      editor.document.uri.toString()
    )
  );
};

const graphSemanticSnapshotFor = async (
  document: vscode.TextDocument
): Promise<VscodeMultiDocumentLanguageSemanticSnapshot | null> => {
  const host = activeVscodeMultiDocumentHost();
  if (!host || typeof host.languageSemanticSnapshotFor !== "function") return null;
  return host.languageSemanticSnapshotFor(document);
};

/** Resolve Reveal once from the exact graph snapshot when the target is an
 * imported Module caller, while retaining the established local path for all
 * other targets. */
export const revealInCanvasSourceTargetForEditor = async (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): Promise<VscodeCanvasRevealSourceTargetResult> => {
  const local = localRevealSourceTargetForEditor(editor, languageAnalysisSession);
  const state = editorRevealQueryStateFor(editor, languageAnalysisSession);
  if (!state) return local;
  const capturedVersion = editor.document.version;
  const capturedRawSource = state.rawSource;
  const capturedOffset = state.normalizedSourceOffset;
  const localRequiresGraph = localRevealRequiresMultiDocumentRuntime(
    editor,
    languageAnalysisSession,
    local
  );
  const graphSemantic = await graphSemanticSnapshotFor(editor.document);
  if (
    editor.document.version !== capturedVersion ||
    editor.document.getText() !== capturedRawSource ||
    normalizedOffsetFromRaw(
      editor.document.getText(),
      editor.document.offsetAt(editor.selection.active)
    ) !== capturedOffset
  ) return { status: "failed", reason: "source-mismatch" };

  if (
    graphSemantic &&
    graphSemantic.documentVersion === capturedVersion &&
    graphSemantic.sourceText === state.source.normalizedSource &&
    graphSemantic.compiled.spans.sourceMap.source === graphSemantic.sourceText &&
    graphSemantic.compiled.spans.sourceMap.sourceRevision === graphSemantic.sourceRevision &&
    graphSemantic.compiled.statementMap
  ) {
    const graphTarget = queryDslCanvasRevealSourceTarget({
      source: {
        normalizedSource: graphSemantic.sourceText,
        sourceRevision: graphSemantic.sourceRevision
      },
      compiled: graphSemantic.compiled,
      position: capturedOffset
    });
    if (
      graphTarget.status === "resolved" &&
      requiresMultiDocumentRuntime(
        graphSemantic.compiled,
        graphTarget.target,
        graphSemantic.rootDocumentId
      )
    ) {
      return {
        status: "resolved",
        value: {
          target: graphTarget.target,
          documentVersion: capturedVersion,
          normalizedSourceOffset: capturedOffset,
          sourceRevision: graphSemantic.sourceRevision,
          graphRevision: graphSemantic.graphRevision,
          ...(graphTarget.target.kind === "statement-owner"
            ? {
                runtimeProjection: projectDslRevealRuntimeStatementOwner(
                  graphSemantic.compiled,
                  graphTarget.target.sourceStatementIndex,
                  graphSemantic.rootDocumentId
                )
              }
            : {})
        }
      };
    }
  }
  return localRequiresGraph
    ? { status: "failed", reason: graphSemantic ? "source-mismatch" : "analysis-unavailable" }
    : local;
};

export type VscodeOutputPreviewRevealSourceTargetFailureReason =
  | "analysis-unavailable"
  | "source-mismatch"
  | "invalid-position"
  | "no-target";

export type VscodeOutputPreviewRevealSourceTargetResult =
  | {
      status: "resolved";
      normalizedSourceOffset: number;
      target: DslOutputPreviewRevealSourceTarget;
    }
  | {
      status: "failed";
      reason: VscodeOutputPreviewRevealSourceTargetFailureReason;
    };

const outputPreviewRevealSourceTargetFromSnapshot = ({
  source,
  semantic,
  normalizedSourceOffset
}: {
  source: { normalizedSource: string; sourceRevision: number };
  semantic: ReturnType<typeof currentCompiledSemanticSnapshotFor>;
  normalizedSourceOffset: number;
}): VscodeOutputPreviewRevealSourceTargetResult => {
  if (!semantic?.compiled) return { status: "failed", reason: "analysis-unavailable" };
  if (!Number.isInteger(normalizedSourceOffset) || normalizedSourceOffset < 0 || normalizedSourceOffset > source.normalizedSource.length) {
    return { status: "failed", reason: "invalid-position" };
  }
  const result: DslOutputPreviewRevealSourceQueryResult = queryDslOutputPreviewRevealSourceTarget({
    source,
    compiled: semantic.compiled,
    position: normalizedSourceOffset
  });
  return result.status === "resolved"
    ? { status: "resolved", normalizedSourceOffset, target: result.target }
    : { status: "failed", reason: result.reason };
};

/**
 * Resolves the exact current Source target for Output Preview Reveal. The
 * caller supplies the existing document analysis session so this command
 * never creates a second parser, resolver, or semantic snapshot owner.
 */
export const outputPreviewRevealSourceTargetForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): VscodeOutputPreviewRevealSourceTargetResult => {
  if (!isSupportedSourceEditor(editor)) return { status: "failed", reason: "no-target" };
  const rawSource = editor.document.getText();
  if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: languageAnalysisSession.getSourceRevision()
  };
  const semantic = currentCompiledSemanticSnapshotFor(languageAnalysisSession, source);
  const normalizedSourceOffset = normalizedOffsetFromRaw(
    rawSource,
    editor.document.offsetAt(editor.selection.active)
  );
  return outputPreviewRevealSourceTargetFromSnapshot({ source, semantic, normalizedSourceOffset });
};

export const sourceTargetAvailabilityForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): VscodeSourceTargetAvailability => {
  if (!isSupportedSourceEditor(editor)) return unavailableSourceTargets();
  const rawSource = editor.document.getText();
  if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: languageAnalysisSession.getSourceRevision()
  };
  const semantic = currentCompiledSemanticSnapshotFor(languageAnalysisSession, source);
  if (!semantic?.compiled) return unavailableSourceTargets();
  const normalizedSourceOffset = normalizedOffsetFromRaw(
    rawSource,
    editor.document.offsetAt(editor.selection.active)
  );
  const referencePickSourceOffset = queryDslReferencePickTarget({
    source,
    position: normalizedSourceOffset,
    semantic
  }) ? normalizedSourceOffset : null;
  const revealInCanvas = Boolean(semantic.compiled.statementMap) &&
    queryDslCanvasRevealSourceTarget({
      source,
      compiled: semantic.compiled,
      position: normalizedSourceOffset
    }).status === "resolved";
  const bake = queryDslCanvasSourceTarget({
    source,
    compiled: semantic.compiled,
    position: normalizedSourceOffset
  }) !== null;
  const outputPreviewRevealTarget = outputPreviewRevealSourceTargetFromSnapshot({
    source,
    semantic,
    normalizedSourceOffset
  });
  const revealInOutputPreview = outputPreviewRevealTarget.status === "resolved" &&
    isDslOutputPreviewRevealSourceTargetStructurallyAvailable({
      target: outputPreviewRevealTarget.target,
      compiled: semantic.compiled
    });
  return { referencePickSourceOffset, revealInCanvas, revealInOutputPreview, bake };
};

export const sourceTargetAvailabilityForEditorAsync = async (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): Promise<VscodeSourceTargetAvailability> => {
  const local = sourceTargetAvailabilityForEditor(editor, languageAnalysisSession);
  const localRevealTarget = localRevealSourceTargetForEditor(editor, languageAnalysisSession);
  const localRequiresGraph = localRevealRequiresMultiDocumentRuntime(
    editor,
    languageAnalysisSession,
    localRevealTarget
  );
  const resolved = await revealInCanvasSourceTargetForEditor(editor, languageAnalysisSession);
  if (localRequiresGraph) {
    return {
      ...local,
      revealInCanvas: resolved.status === "resolved" && resolved.value.graphRevision !== null
    };
  }
  if (resolved.status !== "resolved" || resolved.value.graphRevision === null) return local;
  return { ...local, revealInCanvas: true };
};

export const referencePickSourceOffsetForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): number | null => {
  if (!isSupportedSourceEditor(editor)) return null;
  const rawSource = editor.document.getText();
  if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: languageAnalysisSession.getSourceRevision()
  };
  const semantic = currentCompiledSemanticSnapshotFor(languageAnalysisSession, source);
  if (!semantic?.compiled) return null;
  const normalizedSourceOffset = normalizedOffsetFromRaw(
    rawSource,
    editor.document.offsetAt(editor.selection.active)
  );
  return queryDslReferencePickTarget({
    source,
    position: normalizedSourceOffset,
    semantic
  }) ? normalizedSourceOffset : null;
};

export const registerVscodeReferencePickFeature = ({
  languageAnalysisSessionFor,
  ensureCanvas,
  displayLanguageFor = vscodeDisplayLanguage
}: {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  ensureCanvas: (
    document: vscode.TextDocument
  ) => VscodeReferencePickCanvasEndpoint | null | Promise<VscodeReferencePickCanvasEndpoint | null>;
  displayLanguageFor?: () => string;
}): vscode.Disposable => {
  let nextRequestId = 1;
  let active: ActiveReferencePick | null = null;
  let historyHandoff: ReferencePickHistoryHandoff | null = null;
  let contextUpdate: Promise<void> = Promise.resolve();
  let contextRefreshRevision = 0;

  const setSourceTargetContexts = (availability: VscodeSourceTargetAvailability): void => {
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => Promise.all([
        vscode.commands.executeCommand(
          "setContext",
          VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY,
          availability.revealInCanvas
        ),
        vscode.commands.executeCommand(
          "setContext",
          VSCODE_REVEAL_IN_OUTPUT_PREVIEW_SOURCE_TARGET_CONTEXT_KEY,
          availability.revealInOutputPreview
        ),
        vscode.commands.executeCommand(
          "setContext",
          VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY,
          availability.bake
        ),
        vscode.commands.executeCommand(
          "setContext",
          VSCODE_REFERENCE_PICK_CONTEXT_KEY,
          availability.referencePickSourceOffset !== null
        )
      ]))
      .then(() => undefined);
  };

  const refreshContext = (editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): void => {
    const refreshRevision = ++contextRefreshRevision;
    if (!isSupportedSourceEditor(editor)) {
      setSourceTargetContexts(unavailableSourceTargets());
      return;
    }
    const languageAnalysisSession = languageAnalysisSessionFor(editor.document);
    const localAvailability = sourceTargetAvailabilityForEditor(editor, languageAnalysisSession);
    const host = activeVscodeMultiDocumentHost();
    const initialAvailability = host && localRevealRequiresMultiDocumentRuntime(
      editor,
      languageAnalysisSession,
      localRevealSourceTargetForEditor(editor, languageAnalysisSession)
    )
      ? { ...localAvailability, revealInCanvas: false }
      : localAvailability;
    setSourceTargetContexts(initialAvailability);
    if (!host) return;
    const expectedDocument = editor.document;
    const expectedVersion = expectedDocument.version;
    const expectedSource = expectedDocument.getText();
    const expectedOffset = normalizedOffsetFromRaw(
      expectedSource,
      expectedDocument.offsetAt(editor.selection.active)
    );
    const contextIsCurrent = (): boolean =>
      refreshRevision === contextRefreshRevision &&
      vscode.window.activeTextEditor === editor &&
      editor.document.version === expectedVersion &&
      editor.document.getText() === expectedSource &&
      normalizedOffsetFromRaw(
        editor.document.getText(),
        editor.document.offsetAt(editor.selection.active)
      ) === expectedOffset;
    void sourceTargetAvailabilityForEditorAsync(editor, languageAnalysisSession).then((availability) => {
      if (!contextIsCurrent()) return;
      setSourceTargetContexts(availability);
    }).catch(() => {
      if (contextIsCurrent()) setSourceTargetContexts(initialAvailability);
    });
  };

  const clearActive = (disposeBridge: boolean): void => {
    const current = active;
    if (!current) return;
    active = null;
    current.webviewDisposable.dispose();
    current.panelDisposable.dispose();
    if (disposeBridge) current.bridge?.dispose();
  };

  const clearHistoryHandoff = (): void => {
    historyHandoff = null;
  };

  const cancelActive = (): void => {
    const current = active;
    if (!current) return;
    current.bridge?.cancel();
    clearActive(false);
  };

  const tryStartActive = (): void => {
    const current = active;
    if (!current || current.bridge || !current.endpoint.isAuthoritativeReady()) return;
    if (
      current.editor.document.version !== current.documentVersion ||
      !sameDocument(current.editor.document, current.endpoint.document)
    ) {
      clearActive(false);
      return;
    }
    const freshOffset = referencePickSourceOffsetForEditor(
      current.editor,
      languageAnalysisSessionFor(current.editor.document)
    );
    if (freshOffset !== current.normalizedSourceOffset) {
      clearActive(false);
      refreshContext(current.editor);
      return;
    }

    const bridge = createVscodeReferencePickSourceBridge({
      editor: current.editor,
      languageAnalysisSession: languageAnalysisSessionFor(current.editor.document),
      requestId: current.requestId,
      normalizedSourceOffset: current.normalizedSourceOffset,
      ...(current.initialDraftReferences !== undefined
        ? { initialDraftReferences: current.initialDraftReferences }
        : {}),
      ...(current.initialNumericPropertyDraft
        ? { initialNumericPropertyDraft: current.initialNumericPropertyDraft }
        : {}),
      ...(current.expectedTargetProof ? { expectedTargetProof: current.expectedTargetProof } : {}),
      postMessage: (message) => current.endpoint.panel.webview.postMessage(message)
    });
    current.bridge = bridge;
    if (!bridge.start()) {
      clearActive(true);
      clearHistoryHandoff();
      refreshContext(current.editor);
    }
  };

  const attachActive = (current: ActiveReferencePick): void => {
    active = current;
    current.webviewDisposable = current.endpoint.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (active !== current || typeof message !== "object" || message === null || !("type" in message)) return;
      const typed = message as { type: string };
      if (typed.type === "webviewAuthoritativeDocumentReady") {
        tryStartActive();
        return;
      }
      if (typed.type === "referencePickResult") {
        void handleReferencePickResult(message as VscodeReferencePickResult);
      }
    });
    current.panelDisposable = current.endpoint.panel.onDidDispose(() => {
      if (active === current) {
        clearActive(true);
        clearHistoryHandoff();
      }
    });
    tryStartActive();
  };

  const handleReferencePickResult = async (result: VscodeReferencePickResult): Promise<void> => {
    const current = active;
    const bridge = current?.bridge;
    if (!current || !bridge) return;
    const outcome = await bridge.handleResult(result);
    if (active !== current) return;
    if (outcome === "started") {
      current.endpoint.panel.reveal(vscode.ViewColumn.Beside, false);
      return;
    }
    if (outcome === "ignored") return;
    if (outcome === "applied") {
      const applied = bridge.appliedHandoff();
      clearActive(false);
      if (applied) {
        historyHandoff = {
          ...applied,
          editor: current.editor,
          endpoint: current.endpoint,
          state: "confirmed"
        };
      } else {
        clearHistoryHandoff();
      }
      refreshContext(vscode.window.activeTextEditor);
      return;
    }
    clearActive(false);
    clearHistoryHandoff();
    refreshContext(vscode.window.activeTextEditor);
  };

  const startRestoredReferencePick = (handoff: ReferencePickHistoryHandoff): void => {
    if (historyHandoff !== handoff || active) return;
    if (
      !isSupportedSourceEditor(handoff.editor) ||
      !sameDocument(handoff.editor.document, handoff.endpoint.document) ||
      handoff.editor.document.getText() !== handoff.preConfirmSource
    ) {
      clearHistoryHandoff();
      return;
    }

    const documentVersion = handoff.editor.document.version;
    const current: ActiveReferencePick = {
      editor: handoff.editor,
      normalizedSourceOffset: handoff.normalizedSourceOffset,
      documentVersion,
      requestId: nextRequestId++,
      endpoint: handoff.endpoint,
      bridge: null,
      ...(handoff.numericProperty ? {} : { initialDraftReferences: handoff.references }),
      ...(handoff.numericProperty ? { initialNumericPropertyDraft: handoff.numericProperty } : {}),
      expectedTargetProof: handoff.targetProof,
      webviewDisposable: { dispose: () => undefined },
      panelDisposable: { dispose: () => undefined }
    };
    handoff.endpoint.panel.reveal(vscode.ViewColumn.Beside, true);
    attachActive(current);
  };

  const command = vscode.commands.registerCommand(VSCODE_REFERENCE_PICK_COMMAND_ID, async () => {
    const editor = vscode.window.activeTextEditor;
    if (!isSupportedSourceEditor(editor)) return;
    const normalizedSourceOffset = referencePickSourceOffsetForEditor(
      editor,
      languageAnalysisSessionFor(editor.document)
    );
    if (normalizedSourceOffset === null) {
      refreshContext(editor);
      void vscode.window.showErrorMessage(
        referencePickTranslatorFor(displayLanguageFor())("referencePick.noTarget")
      );
      return;
    }

    cancelActive();
    clearHistoryHandoff();
    const documentVersion = editor.document.version;
    const sourceSelection = editor.selection;
    const endpoint = await ensureCanvas(editor.document);
    if (
      !endpoint ||
      editor.document.version !== documentVersion ||
      !sameDocument(editor.document, endpoint.document)
    ) return;

    try {
      await vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false,
        selection: sourceSelection
      });
    } catch {
      return;
    }
    endpoint.panel.reveal(vscode.ViewColumn.Beside, true);

    const current: ActiveReferencePick = {
      editor,
      normalizedSourceOffset,
      documentVersion,
      requestId: nextRequestId++,
      endpoint,
      bridge: null,
      webviewDisposable: { dispose: () => undefined },
      panelDisposable: { dispose: () => undefined }
    };
    attachActive(current);
  });

  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => refreshContext(editor));
  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === vscode.window.activeTextEditor) refreshContext(event.textEditor);
  });
  const documentChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.contentChanges.length > 0) {
      const current = active;
      const handoff = historyHandoff;
      const sameActiveDocument = current && sameDocument(event.document, current.editor.document);
      const sameHandoffDocument = handoff && sameDocument(event.document, handoff.editor.document);

      if (sameActiveDocument && typeof current.bridge?.isApplying === "function" && current.bridge.isApplying()) {
        // The bridge owns exactly this one edit. Its freshness listener is
        // likewise suppressed while the native editor transaction is in flight.
      } else if (sameHandoffDocument && handoff) {
        const sourceText = event.document.getText();
        const isOwnConfirmChange = event.document.version === handoff.documentVersion &&
          sourceText === handoff.postConfirmSource;
        const isMatchingUndo = handoff.state === "confirmed" &&
          event.reason === vscode.TextDocumentChangeReason.Undo &&
          event.document.version > handoff.documentVersion &&
          sourceText === handoff.preConfirmSource;
        const isMatchingRedo = handoff.state === "restored" &&
          event.reason === vscode.TextDocumentChangeReason.Redo &&
          event.document.version > handoff.documentVersion &&
          sourceText === handoff.postConfirmSource;

        if (isOwnConfirmChange) {
          // The successful bridge edit may be observed after the bridge result
          // is delivered. Keep the one-step handoff eligible in that case.
        } else if (isMatchingUndo) {
          historyHandoff = { ...handoff, state: "restored" };
          startRestoredReferencePick(historyHandoff);
        } else if (isMatchingRedo) {
          cancelActive();
          clearHistoryHandoff();
        } else {
          cancelActive();
          clearHistoryHandoff();
        }
      } else if (sameActiveDocument) {
        cancelActive();
        clearHistoryHandoff();
      } else if (handoff) {
        clearHistoryHandoff();
      }
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && sameDocument(editor.document, event.document)) refreshContext(editor);
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    if (active && sameDocument(document, active.editor.document)) cancelActive();
    if (historyHandoff && sameDocument(document, historyHandoff.editor.document)) clearHistoryHandoff();
    refreshContext(vscode.window.activeTextEditor);
  });

  refreshContext();

  return vscode.Disposable.from(
    command,
    activeEditorListener,
    selectionListener,
    documentChangeListener,
    closeListener,
    {
      dispose: () => {
        contextRefreshRevision += 1;
        cancelActive();
        clearHistoryHandoff();
        setSourceTargetContexts(unavailableSourceTargets());
      }
    }
  );
};
