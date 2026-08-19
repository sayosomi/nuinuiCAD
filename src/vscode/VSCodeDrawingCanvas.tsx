import type { RefObject } from "react";
import { forwardRef, useEffect, useMemo } from "react";
import { dispatchCommand } from "../commands/commands";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";
import { DrawingCanvas } from "../components/DrawingCanvas";
import type { DrawingCanvasHandle } from "../components/DrawingCanvas";
import type {
  CanvasHostAdapter,
  CanvasPointDragAction,
  CanvasBezierHandleDragAction
} from "../components/canvasHostAdapter";
import { VscodeDragPreviewScheduler } from "./vscodeDragPreviewScheduler";
import { LEGACY_CANVAS_THEME, type CanvasTheme } from "../components/canvasTheme";

type VSCodeDrawingCanvasProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  postCanonicalSourceText: (sourceText: string) => void;
  canvasTheme?: CanvasTheme;
};

const mutationWasApplied = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "status" in value && value.status === "applied";

export const VSCodeDrawingCanvas = forwardRef<DrawingCanvasHandle, VSCodeDrawingCanvasProps>(
  function VSCodeDrawingCanvas({
    evaluation,
    evaluationState,
    canvasFocusRef,
    postCanonicalSourceText,
    canvasTheme = LEGACY_CANVAS_THEME
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
    const selectedElementId = useCadUiStore((state) => state.selectedElementId);
    const selectedElementIds = useCadUiStore((state) => state.selectedElementIds);
    const canvasViewport = useCadUiStore((state) => state.canvasViewport);
    const showCanvasElementNames = useCadUiStore((state) => state.showCanvasElementNames);
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

    const dispatchGeometryAction = useMemo(
      () => (action: CanvasPointDragAction | CanvasBezierHandleDragAction) => {
        if ("bezierHandleRole" in action) {
          return dispatchCommand("moveBezierHandleByDelta", action);
        }
        return dispatchCommand("movePointElementByDelta", action);
      },
      []
    );
    const dragPreviewScheduler = useMemo(
      () => new VscodeDragPreviewScheduler(dispatchGeometryAction),
      [dispatchGeometryAction]
    );

    useEffect(() => () => dragPreviewScheduler.dispose(), [dragPreviewScheduler]);
    useEffect(() => {
      if (!evaluationState) return;
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) dragPreviewScheduler.observeEvaluationState(evaluationState);
      });
      return () => {
        cancelled = true;
      };
    }, [dragPreviewScheduler, evaluationState]);

    const commitGeometryCommand = useMemo(() => ({
      movePointElementByDelta: (action: Parameters<NonNullable<CanvasHostAdapter["movePointElementByDelta"]>>[0]) => {
        const result = dragPreviewScheduler.dispatchCommit(action);
        if (mutationWasApplied(result)) postCanonicalSourceText(useCadDocumentStore.getState().sourceText);
        return result;
      },
      moveBezierHandleByDelta: (action: Parameters<NonNullable<CanvasHostAdapter["moveBezierHandleByDelta"]>>[0]) => {
        const result = dragPreviewScheduler.dispatchCommit(action);
        if (mutationWasApplied(result)) postCanonicalSourceText(useCadDocumentStore.getState().sourceText);
        return result;
      }
    }), [dragPreviewScheduler, postCanonicalSourceText]);

    const hostAdapter = useMemo<CanvasHostAdapter>(() => ({
      elements,
      canonicalElements,
      evaluationLimitIndex,
      compiledDocumentRevision,
      canvasTheme,
      palette,
      visibilityProfiles,
      activeVisibilityProfileId,
      moduleSemanticContext,
      selectedElementId,
      selectedElementIds,
      canvasViewport,
      showCanvasElementNames,
      showCanvasPoints,
      showPrintPreviewWindow,
      renderFixedCanvasChrome: false,
      activePointPickTarget,
      activeNumericReferencePickTarget,
      activeLinePickTarget,
      commandLineSession,
      flushSourceEditorOnCanvasPointerDown: () => "clean",
      setCommandErrorMessage: (message) => useCadUiStore.getState().setCommandErrorMessage(message),
      focusSourceEditor: () => undefined,
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
      selectElement: (elementId, selectionMode) => dispatchCommand("selectElement", {
        elementId,
        selectionMode,
        recordSelectionHistory: true
      }),
      clearCanvasSelection: () => dispatchCommand("clearCanvasSelection", { recordSelectionHistory: true }),
      movePointElementByDelta: (action) => action.commitMode === "preview"
        ? dragPreviewScheduler.dispatchPreview(action, evaluationState)
        : commitGeometryCommand.movePointElementByDelta(action),
      moveBezierHandleByDelta: (action) => action.commitMode === "preview"
        ? dragPreviewScheduler.dispatchPreview(action, evaluationState)
        : commitGeometryCommand.moveBezierHandleByDelta(action),
      applyPickedNumericReference: (numericReferenceExpression) => dispatchCommand("applyPickedNumericReference", {
        numericReferenceExpression
      }),
      applyNumericExpressionReference: (action) => dispatchCommand("applyNumericExpressionReference", action),
      applyPickedLine: (action) => dispatchCommand("applyPickedLine", action),
      applyPickedPoint: (action) => dispatchCommand("applyPickedPoint", action),
      toggleCanvasElementNames: () => dispatchCommand("toggleCanvasElementNames"),
      toggleCanvasPoints: () => dispatchCommand("toggleCanvasPoints"),
      togglePrintPreviewWindow: () => dispatchCommand("togglePrintPreviewWindow"),
      resolveImageSourceUrl: (sourcePath) => sourcePath
    }), [
      activeLinePickTarget,
      activeNumericReferencePickTarget,
      activePointPickTarget,
      activeVisibilityProfileId,
      canvasViewport,
      canonicalElements,
      commandLineSession,
      commitGeometryCommand,
      compiledDocumentRevision,
      canvasTheme,
      dragPreviewScheduler,
      elements,
      evaluationLimitIndex,
      evaluationState,
      moduleSemanticContext,
      palette,
      selectedElementId,
      selectedElementIds,
      showCanvasElementNames,
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
