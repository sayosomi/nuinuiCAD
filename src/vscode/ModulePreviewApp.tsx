import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutomationDocument } from "../document/automationDocument";
import { canvasSelectionForElement, canvasSelectionSnapshot } from "../commands/selectionCommands";
import { dispatchCommand } from "../commands/commands";
import { DrawingCanvas, type DrawingCanvasHandle } from "../components/DrawingCanvas";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import { createCanvasTextWidthMeasurer } from "../components/canvasTextMeasurement";
import { compileModulePreviewRoot, type ModulePreviewRootResult } from "../dsl/modulePreviewRoot";
import { queryModulePreviewTarget } from "../dsl/modulePreviewTarget";
import { useEvaluationEngine } from "../geometry/useEvaluationEngine";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";
import { buildModulePreviewEvaluationOptions } from "./modulePreviewEvaluation";
import type { ExtensionToVscodeMessage, VscodeCanvasCommandId, VscodeWebviewApi } from "./protocol";
import { vscodeCanvasContextDataFor } from "./protocol";
import { readVSCodeCanvasTheme } from "./vscodeCanvasTheme";
import { VSCodeCanvasRibbonOverlay } from "./VSCodeCanvasRibbonOverlay";
import { vscodeCanvasRibbonCommandFor } from "./vscodeCanvasRibbonCatalog";
import type { VscodeCanvasRibbon } from "./vscodeCanvasRibbonConfig";
import { VscodeRustTransport, isExtensionToVscodeMessage } from "./vscodeRustTransport";

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const nonWritingCanvasCommands = new Set<VscodeCanvasCommandId>([
  "clearCanvasSelection",
  "resetCanvasView",
  "fitDrawing",
  "toggleCanvasPointNames",
  "toggleCanvasGeometryNames",
  "toggleCanvasElementNames",
  "toggleCanvasPoints"
]);

type ValidModulePreview = {
  root: ModulePreviewRootResult;
  evaluationOptions: ReturnType<typeof buildModulePreviewEvaluationOptions>;
  revision: number;
};

const diagnosticMessagesFor = (document: AutomationDocument): string[] => {
  const state = document.getState();
  return [...state.currentCompiled.diagnostics, ...(state.currentCompiled.bindingIssueDiagnostics ?? [])]
    .slice(0, 4)
    .map((diagnostic) => diagnostic.message);
};

export const ModulePreviewApp = ({ api }: { api: VscodeWebviewApi }) => {
  const automationDocumentRef = useRef<AutomationDocument | null>(null);
  const documentVersionRef = useRef<number | null>(null);
  const nextPreviewRevisionRef = useRef(1);
  const canvasFocusRef = useRef<HTMLDivElement>(null);
  const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
  const evaluationRef = useRef<EvaluationResult | null>(null);
  const previewRef = useRef<ValidModulePreview | null>(null);
  const [preview, setPreview] = useState<ValidModulePreview | null>(null);
  const [statusMessages, setStatusMessages] = useState<string[]>([
    "Open Module Preview from a Module definition in the Source Editor."
  ]);
  const [canvasTheme, setCanvasTheme] = useState(LEGACY_CANVAS_THEME);
  const [canvasRibbonRibbons, setCanvasRibbonRibbons] = useState<VscodeCanvasRibbon[]>([]);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const selectedElementIds = useCadUiStore((state) => state.selectedElementIds);
  const selectionAnchorElementId = useCadUiStore((state) => state.selectionAnchorElementId);
  const canvasViewport = useCadUiStore((state) => state.canvasViewport);
  const showCanvasPointNames = useCadUiStore((state) => state.showCanvasPointNames);
  const showCanvasGeometryNames = useCadUiStore((state) => state.showCanvasGeometryNames);
  const showCanvasPoints = useCadUiStore((state) => state.showCanvasPoints);
  const measureCanvasTextWidth = useMemo(
    () => createCanvasTextWidthMeasurer(() =>
      document.querySelector<HTMLElement>('[data-canvas-viewport="true"]')
    ),
    []
  );
  const rustTransport = useMemo(() => new VscodeRustTransport(api.postMessage), [api]);

  const evaluationElements = preview?.root.compileResult.elements ?? [];
  const evaluationOptions = preview?.evaluationOptions ?? {};
  const evaluationState = useEvaluationEngine(
    evaluationElements,
    evaluationOptions,
    preview?.revision ?? 0,
    rustTransport.transport
  );
  evaluationRef.current = evaluationState.evaluation;

  const renderElements = useMemo(() => {
    if (!preview) return [];
    const targetIds = new Set(preview.root.targetRuntimeElementIds);
    return preview.root.compileResult.elements.filter((element) => targetIds.has(element.id));
  }, [preview]);

  const applyValidPreview = useCallback((root: ModulePreviewRootResult) => {
    let evaluationOptions: ReturnType<typeof buildModulePreviewEvaluationOptions>;
    try {
      evaluationOptions = buildModulePreviewEvaluationOptions(root);
    } catch {
      const document = automationDocumentRef.current;
      setStatusMessages(document ? [
        "Module Preview could not build the current evaluation context.",
        ...diagnosticMessagesFor(document)
      ] : ["Module Preview could not build the current evaluation context."]);
      return;
    }
    const revision = nextPreviewRevisionRef.current++;
    const targetIds = new Set(root.targetRuntimeElementIds);
    const nextRenderElements = root.compileResult.elements.filter((element) => targetIds.has(element.id));
    useCadDocumentStore.setState({
      elements: nextRenderElements,
      modifiers: root.compileResult.modifiers ?? [],
      visibilityRoles: root.compileResult.visibilityRoles ?? [],
      visibilityProfiles: root.compileResult.visibilityProfiles ?? [],
      activeVisibilityProfileId: root.compileResult.activeVisibilityProfileId ?? "",
      evaluationLimitIndex: undefined,
      previewElements: null,
      previewCompiledDocument: null,
      previewEvaluationLimitIndex: null,
      compiledDocumentRevision: revision
    });
    useCadUiStore.getState().reconcileSelectionWithElements(nextRenderElements);
    const nextPreview = { root, evaluationOptions, revision };
    previewRef.current = nextPreview;
    setPreview(nextPreview);
    setStatusMessages(root.diagnostics.map((diagnostic) => diagnostic.message));
  }, []);

  const compileTargetAt = useCallback((normalizedSourceOffset: number) => {
    const document = automationDocumentRef.current;
    if (!document) return;
    const state = document.getState();
    const normalizedSource = normalizedSourceFor(document.getSource());
    const source = {
      normalizedSource,
      sourceRevision: state.currentCompiled.spans.sourceMap.sourceRevision
    };
    const semantic = {
      sourceRevision: source.sourceRevision,
      sourceText: normalizedSource,
      compiled: state.currentCompiled
    };
    const target = queryModulePreviewTarget({ source, position: normalizedSourceOffset, semantic });
    const root = target
      ? compileModulePreviewRoot({ source, semantic, target, arguments: [] })
      : null;
    if (!root) {
      const diagnostics = diagnosticMessagesFor(document);
      setStatusMessages([
        "Module Preview cannot evaluate the exact current target with the current inputs.",
        ...diagnostics
      ]);
      return;
    }
    applyValidPreview(root);
  }, [applyValidPreview]);

  const executeSharedCanvasCommand = useCallback((commandId: VscodeCanvasCommandId) => {
    if (!nonWritingCanvasCommands.has(commandId)) return;
    drawingCanvasRef.current?.finalizeCanvasInteraction();
    dispatchCommand(commandId, {
      evaluation: evaluationRef.current ?? undefined,
      getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
      measureCanvasTextWidth,
      recordSelectionHistory: false,
      finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction(),
      focusCanvas: () => canvasFocusRef.current?.focus()
    });
    canvasFocusRef.current?.focus();
  }, [measureCanvasTextWidth]);

  useEffect(() => {
    const refreshCanvasTheme = () => setCanvasTheme(readVSCodeCanvasTheme());
    refreshCanvasTheme();
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isExtensionToVscodeMessage(event.data)) return;
      const message: ExtensionToVscodeMessage = event.data;
      if (rustTransport.handleMessage(message)) return;
      if (message.type === "replaceTextDocument") {
        if (documentVersionRef.current !== null && message.documentVersion < documentVersionRef.current) return;
        automationDocumentRef.current = AutomationDocument.fromSource(message.sourceText);
        documentVersionRef.current = message.documentVersion;
        setStatusMessages(previewRef.current
          ? ["Module Preview is waiting for the exact current target."]
          : ["No valid Module Preview is available yet."]);
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
        return;
      }
      if (message.type === "commitText") {
        if (documentVersionRef.current !== null && message.documentVersion < documentVersionRef.current) return;
        const document = automationDocumentRef.current ?? AutomationDocument.fromSource(message.sourceText);
        if (document.getSource() !== message.sourceText) document.replaceSource(message.sourceText);
        automationDocumentRef.current = document;
        documentVersionRef.current = message.documentVersion;
        setStatusMessages(previewRef.current
          ? ["Module Preview is waiting for the exact current target."]
          : ["No valid Module Preview is available yet."]);
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
        return;
      }
      if (message.type === "modulePreviewTarget") {
        if (documentVersionRef.current !== message.documentVersion) return;
        compileTargetAt(message.normalizedSourceOffset);
        return;
      }
      if (message.type === "modulePreviewTargetUnavailable") {
        if (documentVersionRef.current !== message.documentVersion) return;
        const document = automationDocumentRef.current;
        setStatusMessages([
          "Module Preview target is not exact-current and was not rebound.",
          ...(document ? diagnosticMessagesFor(document) : [])
        ]);
        return;
      }
      if (message.type === "canvasThemeChanged") {
        refreshCanvasTheme();
        return;
      }
      if (message.type === "canvasRibbonConfiguration") {
        setCanvasRibbonRibbons(message.ribbons);
        return;
      }
      if (message.type === "canvasCommand") executeSharedCanvasCommand(message.commandId);
    };
    window.addEventListener("message", onMessage);
    api.postMessage({ type: "webviewReady" });
    return () => {
      window.removeEventListener("message", onMessage);
      rustTransport.dispose();
    };
  }, [api, compileTargetAt, executeSharedCanvasCommand, rustTransport]);

  const moduleSemanticContext = useMemo(() => ({
    moduleMaterialization: preview?.root.moduleMaterialization,
    moduleSemanticAnalysis: preview?.root.moduleSemanticAnalysis,
    sourceLexicalNamespace: automationDocumentRef.current?.getState().currentCompiled.sourceLexicalNamespace,
    statementInfoByElementId: automationDocumentRef.current?.getState().currentCompiled.statementMap?.byElementId
  }), [preview]);

  const selectElement = useCallback<CanvasHostAdapter["selectElement"]>((elementId, selectionMode) => {
    const before = canvasSelectionSnapshot();
    const selection = canvasSelectionForElement(renderElements, before, elementId, selectionMode);
    if (!selection) return;
    useCadUiStore.getState().applySelection(renderElements, selection);
  }, [renderElements]);

  const previewCanvasSelection = useCallback<CanvasHostAdapter["previewCanvasSelection"]>((before, elementId, selectionMode) => {
    const selection = canvasSelectionForElement(renderElements, before, elementId, selectionMode);
    if (!selection) return;
    useCadUiStore.getState().applySelection(renderElements, selection);
  }, [renderElements]);

  const ribbonCommandContext = useMemo(() => ({
    hasSelection: selectedElementIds.length > 0,
    showCanvasPointNames,
    showCanvasGeometryNames,
    showCanvasPoints
  }), [selectedElementIds.length, showCanvasGeometryNames, showCanvasPointNames, showCanvasPoints]);

  const hostAdapter = useMemo<CanvasHostAdapter>(() => ({
    elements: renderElements,
    canonicalElements: renderElements,
    evaluationLimitIndex: undefined,
    compiledDocumentRevision: preview?.revision ?? 0,
    canvasTheme,
    visibilityProfiles: preview?.root.compileResult.visibilityProfiles ?? [],
    activeVisibilityProfileId: preview?.root.compileResult.activeVisibilityProfileId ?? null,
    moduleSemanticContext,
    measureCanvasTextWidth,
    selectedElementId,
    selectedElementIds,
    selectionAnchorElementId,
    canvasViewport,
    showCanvasPointNames,
    showCanvasGeometryNames,
    showCanvasPoints,
    renderFixedCanvasChrome: false,
    canvasContextMenuData: vscodeCanvasContextDataFor("blank", selectedElementIds.length > 0),
    publishCanvasContextMenu: ({ kind }) => {
      const viewport = canvasFocusRef.current;
      if (!viewport) return;
      viewport.dataset.vscodeContext = vscodeCanvasContextDataFor(
        kind,
        useCadUiStore.getState().selectedElementIds.length > 0
      );
    },
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    commandLineSession: null,
    flushSourceEditorOnCanvasPointerDown: () => "clean",
    setCommandErrorMessage: (message) => useCadUiStore.getState().setCommandErrorMessage(message),
    focusSourceEditor: () => undefined,
    getCurrentCanonicalDocument: () => ({
      elements: renderElements,
      sourceRevision: automationDocumentRef.current?.getState().currentCompiled.spans.sourceMap.sourceRevision ?? 0,
      compiledDocumentRevision: preview?.revision ?? 0,
      sourceText: automationDocumentRef.current?.getSource() ?? "",
      docText: automationDocumentRef.current?.getSource() ?? ""
    }),
    panCanvasViewport: (dx, dy) => useCadUiStore.getState().panCanvasViewport(dx, dy),
    zoomCanvasViewportAt: (zoomFactor, anchor) => useCadUiStore.getState().zoomCanvasViewportAt(zoomFactor, anchor),
    selectElement,
    getCanvasSelectionSnapshot: canvasSelectionSnapshot,
    previewCanvasSelection,
    finalizeCanvasSelectionSession: () => undefined,
    clearCanvasSelection: () => useCadUiStore.getState().clearElementSelection(),
    movePointElementByDelta: () => undefined,
    moveBezierHandleByDelta: () => undefined,
    applyPickedNumericReference: () => undefined,
    applyNumericExpressionReference: () => undefined,
    applyPickedLine: () => undefined,
    applyPickedPoint: () => undefined,
    toggleCanvasPointNames: () => executeSharedCanvasCommand("toggleCanvasPointNames"),
    toggleCanvasGeometryNames: () => executeSharedCanvasCommand("toggleCanvasGeometryNames"),
    toggleCanvasPoints: () => executeSharedCanvasCommand("toggleCanvasPoints"),
    resolveImageSourceUrl: (sourcePath) => sourcePath,
    renderHostOverlay: (viewportSize) => (
      <VSCodeCanvasRibbonOverlay
        canvasFocusRef={canvasFocusRef}
        canvasViewport={canvasViewport}
        canvasRibbonRibbons={canvasRibbonRibbons}
        viewportSize={viewportSize}
        ribbonCommandContext={ribbonCommandContext}
        onCommand={(item) => {
          const definition = vscodeCanvasRibbonCommandFor(item.commandId);
          if (!definition || !definition.isAvailable(ribbonCommandContext)) return;
          if (definition.hostAction === "editCanvasRibbon") {
            api.postMessage({ type: "editCanvasRibbon" });
            return;
          }
          if (definition.sharedCommandId) executeSharedCanvasCommand(definition.sharedCommandId);
        }}
        onPositionCommit={(ribbonId, position) => api.postMessage({
          type: "canvasRibbonPositionCommit",
          ribbonId,
          x: position.x,
          y: position.y
        })}
      />
    )
  }), [
    api,
    canvasRibbonRibbons,
    canvasTheme,
    canvasViewport,
    executeSharedCanvasCommand,
    measureCanvasTextWidth,
    moduleSemanticContext,
    preview,
    previewCanvasSelection,
    renderElements,
    ribbonCommandContext,
    selectElement,
    selectedElementId,
    selectedElementIds,
    selectionAnchorElementId,
    showCanvasGeometryNames,
    showCanvasPointNames,
    showCanvasPoints
  ]);

  return (
    <main className="canvas-workspace" style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {preview ? (
        <DrawingCanvas
          ref={drawingCanvasRef}
          evaluation={evaluationState.evaluation}
          evaluationState={evaluationState}
          canvasFocusRef={canvasFocusRef}
          hostAdapter={hostAdapter}
        />
      ) : null}
      {statusMessages.length > 0 ? (
        <div
          role="status"
          data-module-preview-status="true"
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            maxWidth: "min(560px, calc(100vw - 24px))",
            padding: "8px 10px",
            border: "1px solid var(--vscode-panel-border)",
            borderRadius: 4,
            background: "var(--vscode-editorWidget-background)",
            color: "var(--vscode-editorWidget-foreground)",
            fontSize: 12,
            pointerEvents: "none"
          }}
        >
          {statusMessages.map((message, index) => <div key={`${index}:${message}`}>{message}</div>)}
        </div>
      ) : null}
      {!preview ? (
        <div
          data-module-preview-empty="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "var(--vscode-descriptionForeground)"
          }}
        >
          No valid Module Preview
        </div>
      ) : null}
    </main>
  );
};
