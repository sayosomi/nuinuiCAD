import type { RefObject } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { dispatchCommand } from "../commands/commands";
import {
  canvasSelectionSnapshot,
  finalizeCanvasSelectionSession,
  previewCanvasSelection
} from "../commands/selectionCommands";
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import {
  effectiveElements,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";
import { DrawingCanvas } from "../components/DrawingCanvas";
import type { DrawingCanvasHandle } from "../components/DrawingCanvas";
import type {
  CanvasHostAdapter,
  CanvasPointDragAction,
  CanvasBezierHandleDragAction
} from "../components/canvasHostAdapter";
import { useModuleInstanceSelectionReconciliation } from "../components/useModuleInstanceSelectionReconciliation";
import { useRevisionCoherentCanvasPresentation } from "../components/canvasRevisionPresentation";
import { VscodeDragPreviewScheduler } from "./vscodeDragPreviewScheduler";
import {
  type VscodeCanvasRibbon
} from "./vscodeCanvasRibbonConfig";
import { vscodeCanvasRibbonCommandFor } from "./vscodeCanvasRibbonCatalog";
import { VSCodeCanvasRibbonOverlay } from "./VSCodeCanvasRibbonOverlay";
import type { RibbonPosition } from "../components/commandRibbonFloatingGeometry";
import type { CommandRibbonPresentationCommandItem } from "../components/CommandRibbonView";
import { LEGACY_CANVAS_THEME, type CanvasTheme } from "../components/canvasTheme";
import { vscodeCanvasContextDataFor } from "./protocol";

type VSCodeDrawingCanvasProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  postCanonicalSourceText: (sourceText: string) => void;
  canvasTheme?: CanvasTheme;
  canvasRibbonRibbons?: VscodeCanvasRibbon[];
  onCanvasRibbonPositionCommit?: (ribbonId: string, position: RibbonPosition) => void;
  onEditCanvasRibbon?: () => void;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
};

const mutationWasApplied = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "status" in value && value.status === "applied";

export const VSCodeDrawingCanvas = forwardRef<DrawingCanvasHandle, VSCodeDrawingCanvasProps>(
  function VSCodeDrawingCanvas({
    evaluation,
    evaluationState,
    canvasFocusRef,
    postCanonicalSourceText,
    canvasTheme = LEGACY_CANVAS_THEME,
    canvasRibbonRibbons = [],
    onCanvasRibbonPositionCommit,
    onEditCanvasRibbon,
    measureCanvasTextWidth
  }, ref) {
    const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
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
    const holdLastStableCanvasPresentation = useCadDocumentStore((state) =>
      state.sourceUpdate.kind === "editor" && (
        state.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
        state.bindingIssueDiagnostics.some((diagnostic) => diagnostic.severity === "error")
      )
    );
    const selectedElementId = useCadUiStore((state) => state.selectedElementId);
    const selectedElementIds = useCadUiStore((state) => state.selectedElementIds);
    const selectionAnchorElementId = useCadUiStore((state) => state.selectionAnchorElementId);
    const canvasViewport = useCadUiStore((state) => state.canvasViewport);
    const showCanvasPointNames = useCadUiStore((state) => state.showCanvasPointNames);
    const showCanvasGeometryNames = useCadUiStore((state) => state.showCanvasGeometryNames);
    const showCanvasPoints = useCadUiStore((state) => state.showCanvasPoints);
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
    const currentCanvasPresentation = useMemo(() => ({
      elements,
      canonicalElements,
      evaluationLimitIndex,
      palette,
      visibilityProfiles,
      activeVisibilityProfileId,
      moduleSemanticContext
    }), [
      activeVisibilityProfileId,
      canonicalElements,
      elements,
      evaluationLimitIndex,
      moduleSemanticContext,
      palette,
      visibilityProfiles
    ]);
    const canvasPresentation = useRevisionCoherentCanvasPresentation({
      current: currentCanvasPresentation,
      evaluation,
      compiledDocumentRevision,
      evaluationState,
      holdLastStable: holdLastStableCanvasPresentation
    });
    useModuleInstanceSelectionReconciliation({
      evaluation: canvasPresentation.renderEvaluation,
      evaluationState: canvasPresentation.renderEvaluationState,
      measureCanvasTextWidth
    });

    const ribbonCommandContext = useMemo(() => ({
      hasSelection: selectedElementIds.length > 0,
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints
    }), [selectedElementIds.length, showCanvasGeometryNames, showCanvasPointNames, showCanvasPoints]);

    const executeRibbonCommand = useCallback((item: CommandRibbonPresentationCommandItem) => {
      drawingCanvasRef.current?.finalizeCanvasInteraction();
      const definition = vscodeCanvasRibbonCommandFor(item.commandId);
      if (!definition || !definition.isAvailable({
        hasSelection: useCadUiStore.getState().selectedElementIds.length > 0,
        showCanvasPointNames: useCadUiStore.getState().showCanvasPointNames,
        showCanvasGeometryNames: useCadUiStore.getState().showCanvasGeometryNames,
        showCanvasPoints: useCadUiStore.getState().showCanvasPoints
      })) return;
      if (definition.hostAction === "editCanvasRibbon") {
        onEditCanvasRibbon?.();
        return;
      }
      if (!definition.sharedCommandId) return;
      dispatchCommand(definition.sharedCommandId, {
        evaluation,
        getCanvasViewportRect: () => canvasFocusRef.current?.getBoundingClientRect() ?? null,
        measureCanvasTextWidth,
        recordSelectionHistory: true,
        finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction(),
        focusCanvas: () => canvasFocusRef.current?.focus()
      });
      canvasFocusRef.current?.focus();
    }, [canvasFocusRef, evaluation, measureCanvasTextWidth, onEditCanvasRibbon]);

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
        if (mutationWasApplied(result)) {
          const sourceText = useCadDocumentStore.getState().sourceText;
          postCanonicalSourceText(sourceText);
        }
        return result;
      },
      moveBezierHandleByDelta: (action: Parameters<NonNullable<CanvasHostAdapter["moveBezierHandleByDelta"]>>[0]) => {
        const result = dragPreviewScheduler.dispatchCommit(action);
        if (mutationWasApplied(result)) {
          const sourceText = useCadDocumentStore.getState().sourceText;
          postCanonicalSourceText(sourceText);
        }
        return result;
      }
    }), [dragPreviewScheduler, postCanonicalSourceText]);

    const hostAdapter = useMemo<CanvasHostAdapter>(() => ({
      elements: canvasPresentation.elements,
      canonicalElements: canvasPresentation.canonicalElements,
      evaluationLimitIndex: canvasPresentation.evaluationLimitIndex,
      compiledDocumentRevision,
      canvasTheme,
      palette: canvasPresentation.palette,
      visibilityProfiles: canvasPresentation.visibilityProfiles,
      activeVisibilityProfileId: canvasPresentation.activeVisibilityProfileId,
      moduleSemanticContext: canvasPresentation.moduleSemanticContext,
      measureCanvasTextWidth,
      selectedElementId,
      selectedElementIds,
      selectionAnchorElementId,
      canvasViewport,
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints,
      renderFixedCanvasChrome: false,
      activePointPickTarget,
      activeNumericReferencePickTarget,
      activeLinePickTarget,
      commandLineSession,
      canvasContextMenuData: vscodeCanvasContextDataFor("blank", selectedElementIds.length > 0),
      publishCanvasContextMenu: ({ kind }) => {
        const viewport = canvasFocusRef.current;
        if (!viewport) return;
        viewport.dataset.vscodeContext = vscodeCanvasContextDataFor(
          kind,
          useCadUiStore.getState().selectedElementIds.length > 0
        );
      },
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
      selectElement: (elementId, selectionMode, recordHistory) => {
        return dispatchCommand("selectElement", {
          elementId,
          selectionMode,
          recordSelectionHistory: recordHistory ?? true
        });
      },
      getCanvasSelectionSnapshot: () => canvasSelectionSnapshot(),
      previewCanvasSelection: (previousSelection, elementId, selectionMode) =>
        previewCanvasSelection(previousSelection, elementId, selectionMode),
      finalizeCanvasSelectionSession: (previousSelection) =>
        finalizeCanvasSelectionSession(previousSelection),
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
      toggleCanvasPointNames: () => dispatchCommand("toggleCanvasPointNames"),
      toggleCanvasGeometryNames: () => dispatchCommand("toggleCanvasGeometryNames"),
      toggleCanvasPoints: () => dispatchCommand("toggleCanvasPoints"),
      resolveImageSourceUrl: (sourcePath) => sourcePath,
      renderHostOverlay: (viewportSize) => (
        <VSCodeCanvasRibbonOverlay
          canvasFocusRef={canvasFocusRef}
          canvasViewport={canvasViewport}
          canvasRibbonRibbons={canvasRibbonRibbons}
          viewportSize={viewportSize}
          ribbonCommandContext={ribbonCommandContext}
          onCommand={executeRibbonCommand}
          onPositionCommit={onCanvasRibbonPositionCommit}
        />
      )
    }), [
      activeLinePickTarget,
      activeNumericReferencePickTarget,
      activePointPickTarget,
      canvasPresentation,
      canvasViewport,
      commandLineSession,
      commitGeometryCommand,
      compiledDocumentRevision,
      canvasTheme,
      dragPreviewScheduler,
      evaluationState,
      measureCanvasTextWidth,
      selectedElementId,
      selectedElementIds,
      selectionAnchorElementId,
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints,
      executeRibbonCommand,
      onCanvasRibbonPositionCommit,
      canvasRibbonRibbons,
      ribbonCommandContext,
      canvasFocusRef
    ]);

    useImperativeHandle(ref, () => ({
      clearPendingCanvasPointerIntent: () => drawingCanvasRef.current?.clearPendingCanvasPointerIntent(),
      clearEditorFocusReservation: () => drawingCanvasRef.current?.clearEditorFocusReservation(),
      finalizeCanvasInteraction: () => drawingCanvasRef.current?.finalizeCanvasInteraction()
    }), []);

    return (
      <DrawingCanvas
        ref={drawingCanvasRef}
        evaluation={canvasPresentation.renderEvaluation}
        evaluationState={canvasPresentation.renderEvaluationState}
        canvasFocusRef={canvasFocusRef}
        hostAdapter={hostAdapter}
      />
    );
  }
);
