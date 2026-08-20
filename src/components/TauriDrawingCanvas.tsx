import type { RefObject } from "react";
import { forwardRef, useMemo } from "react";
import { dispatchCommand } from "../commands/commands";
import type { CommandContext } from "../commands/commands";
import {
  canvasSelectionSnapshot,
  finalizeCanvasSelectionSession,
  previewCanvasSelection
} from "../commands/selectionCommands";
import { sourceEditSession } from "../editor/sourceEditSession";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";
import { imageSourceUrl } from "./imageSourceUrls";
import { CommandRibbonOverlay } from "./CommandRibbonOverlay";
import { DrawingCanvas } from "./DrawingCanvas";
import type { DrawingCanvasHandle } from "./DrawingCanvas";
import type { CanvasHostAdapter } from "./canvasHostAdapter";
import { LEGACY_CANVAS_THEME } from "./canvasTheme";

type TauriDrawingCanvasProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  commandContext?: CommandContext;
  leftPanelDockRef: RefObject<HTMLDivElement | null>;
};

export const TauriDrawingCanvas = forwardRef<DrawingCanvasHandle, TauriDrawingCanvasProps>(
  function TauriDrawingCanvas({
    evaluation,
    evaluationState,
    canvasFocusRef,
    commandContext = {},
    leftPanelDockRef
  }, ref) {
    const elements = useCadDocumentStore(effectiveElements);
    const canonicalElements = useCadDocumentStore((state) => state.elements);
    const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
    const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
    const palette = useCadDocumentStore((state) => state.palette);
    const visibilityProfiles = useCadDocumentStore((state) => state.visibilityProfiles);
    const activeVisibilityProfileId = useCadDocumentStore((state) => state.activeVisibilityProfileId);
    const moduleMaterialization = useCadDocumentStore((state) => state.doc.moduleMaterialization);
    const moduleSemanticAnalysis = useCadDocumentStore((state) => state.doc.moduleSemanticAnalysis);
    const sourceLexicalNamespace = useCadDocumentStore((state) => state.doc.sourceLexicalNamespace);
    const statementInfoByElementId = useCadDocumentStore((state) => state.doc.statementMap?.byElementId);
    const currentFilePath = useCadDocumentStore((state) => state.currentFilePath);
    const selectedElementId = useCadUiStore((state) => state.selectedElementId);
    const selectedElementIds = useCadUiStore((state) => state.selectedElementIds);
    const selectionAnchorElementId = useCadUiStore((state) => state.selectionAnchorElementId);
    const canvasViewport = useCadUiStore((state) => state.canvasViewport);
    const showCanvasPointNames = useCadUiStore((state) => state.showCanvasPointNames);
    const showCanvasGeometryNames = useCadUiStore((state) => state.showCanvasGeometryNames);
    const showCanvasPoints = useCadUiStore((state) => state.showCanvasPoints);
    const showPrintPreviewWindow = useCadUiStore((state) => state.showPrintPreviewWindow);
    const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
    const activeNumericReferencePickTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
    const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
    const commandLineSession = useCadUiStore((state) => state.commandLineSession);
    const moduleSemanticContext = useMemo(() => ({
      moduleMaterialization,
      moduleSemanticAnalysis,
      sourceLexicalNamespace,
      statementInfoByElementId
    }), [moduleMaterialization, moduleSemanticAnalysis, sourceLexicalNamespace, statementInfoByElementId]);
    const hostAdapter = useMemo<CanvasHostAdapter>(() => ({
      elements,
      canonicalElements,
      evaluationLimitIndex,
      compiledDocumentRevision,
      canvasTheme: LEGACY_CANVAS_THEME,
      palette,
      visibilityProfiles,
      activeVisibilityProfileId,
      moduleSemanticContext,
      selectedElementId,
      selectedElementIds,
      selectionAnchorElementId,
      canvasViewport,
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints,
      showPrintPreviewWindow,
      renderFixedCanvasChrome: true,
      activePointPickTarget,
      activeNumericReferencePickTarget,
      activeLinePickTarget,
      commandLineSession,
      flushSourceEditorOnCanvasPointerDown: () => sourceEditSession.flush("canvas-pointerdown"),
      setCommandErrorMessage: (message) => useCadUiStore.getState().setCommandErrorMessage(message),
      focusSourceEditor: () => commandContext.focusSourceEditor?.(),
      getCurrentCanonicalDocument: () => {
        const state = useCadDocumentStore.getState();
        return {
          elements: state.elements,
          sourceRevision: state.sourceRevision,
          compiledDocumentRevision: state.compiledDocumentRevision,
          sourceText: state.sourceText,
          docText: state.docText
        };
      },
      panCanvasViewport: (dx, dy) => useCadUiStore.getState().panCanvasViewport(dx, dy),
      zoomCanvasViewportAt: (zoomFactor, anchor) => useCadUiStore.getState().zoomCanvasViewportAt(zoomFactor, anchor),
      selectElement: (elementId, selectionMode, recordHistory) => dispatchCommand("selectElement", {
        elementId,
        selectionMode,
        ...(recordHistory === undefined ? {} : { recordSelectionHistory: recordHistory })
      }),
      getCanvasSelectionSnapshot: () => canvasSelectionSnapshot(),
      previewCanvasSelection: (previousSelection, elementId, selectionMode) =>
        previewCanvasSelection(previousSelection, elementId, selectionMode),
      finalizeCanvasSelectionSession: (previousSelection) =>
        finalizeCanvasSelectionSession(previousSelection),
      clearCanvasSelection: () => dispatchCommand("clearCanvasSelection"),
      movePointElementByDelta: (action) => dispatchCommand("movePointElementByDelta", action),
      moveBezierHandleByDelta: (action) => dispatchCommand("moveBezierHandleByDelta", action),
      applyPickedNumericReference: (numericReferenceExpression) => dispatchCommand("applyPickedNumericReference", {
        numericReferenceExpression
      }),
      applyNumericExpressionReference: (action) => dispatchCommand("applyNumericExpressionReference", action),
      applyPickedLine: (action) => dispatchCommand("applyPickedLine", action),
      applyPickedPoint: (action) => dispatchCommand("applyPickedPoint", action),
      toggleCanvasPointNames: () => dispatchCommand("toggleCanvasPointNames"),
      toggleCanvasGeometryNames: () => dispatchCommand("toggleCanvasGeometryNames"),
      toggleCanvasElementNames: () => dispatchCommand("toggleCanvasElementNames"),
      toggleCanvasPoints: () => dispatchCommand("toggleCanvasPoints"),
      togglePrintPreviewWindow: () => dispatchCommand("togglePrintPreviewWindow"),
      resolveImageSourceUrl: (sourcePath) => imageSourceUrl(sourcePath, currentFilePath),
      renderHostOverlay: (viewportSize) => (
        <CommandRibbonOverlay
          commandContext={commandContext}
          leftPanelDockRef={leftPanelDockRef}
          viewportSize={viewportSize}
        />
      )
    }), [
      activeLinePickTarget,
      activeNumericReferencePickTarget,
      activePointPickTarget,
      activeVisibilityProfileId,
      canvasViewport,
      canonicalElements,
      commandContext,
      commandLineSession,
      compiledDocumentRevision,
      currentFilePath,
      elements,
      evaluationLimitIndex,
      leftPanelDockRef,
      moduleSemanticContext,
      palette,
      selectedElementId,
      selectedElementIds,
      selectionAnchorElementId,
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints,
      showPrintPreviewWindow,
      visibilityProfiles
    ]);

    return (
      <DrawingCanvas
        ref={ref}
        evaluation={evaluation}
        evaluationState={evaluationState}
        canvasFocusRef={canvasFocusRef}
        hostAdapter={hostAdapter}
      />
    );
  }
);
