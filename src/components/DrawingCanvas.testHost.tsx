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
import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";
import { DrawingCanvas } from "./DrawingCanvas";
import type { DrawingCanvasHandle } from "./DrawingCanvas";
import type { CanvasHostAdapter } from "./canvasHostAdapter";
import { LEGACY_CANVAS_THEME } from "./canvasTheme";
import { useRevisionCoherentCanvasPresentation } from "./canvasRevisionPresentation";
import { useModuleInstanceSelectionReconciliation } from "./useModuleInstanceSelectionReconciliation";

type DrawingCanvasTestHostProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  measureCanvasTextWidth?: CanvasTextWidthMeasurer;
  commandContext?: CommandContext;
  /** Retained only so existing integration-test call sites do not need host-specific plumbing. */
  leftPanelDockRef?: RefObject<HTMLDivElement | null>;
};

/**
 * Store-backed host used by shared DrawingCanvas integration tests.
 *
 * Production hosts own their adapters independently. This helper deliberately
 * contains no platform runtime API and keeps the tests focused on the shared
 * document/UI-store interaction boundary that used to be exercised through the
 * removed desktop host wrapper.
 */
export const DrawingCanvasTestHost = forwardRef<DrawingCanvasHandle, DrawingCanvasTestHostProps>(
  function DrawingCanvasTestHost({
    evaluation,
    evaluationState,
    canvasFocusRef,
    measureCanvasTextWidth,
    commandContext = {}
  }, ref) {
    const elements = useCadDocumentStore(effectiveElements);
    const canonicalElements = useCadDocumentStore((state) => state.elements);
    const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
    const compiledDocumentRevision = useCadDocumentStore((state) => state.compiledDocumentRevision);
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
      visibilityProfiles,
      activeVisibilityProfileId,
      moduleSemanticContext
    }), [
      activeVisibilityProfileId,
      canonicalElements,
      elements,
      evaluationLimitIndex,
      moduleSemanticContext,
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
      evaluationState: canvasPresentation.renderEvaluationState
    });

    const hostAdapter = useMemo<CanvasHostAdapter>(() => ({
      elements: canvasPresentation.elements,
      canonicalElements: canvasPresentation.canonicalElements,
      evaluationLimitIndex: canvasPresentation.evaluationLimitIndex,
      compiledDocumentRevision,
      canvasTheme: LEGACY_CANVAS_THEME,
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
      commitCanvasRectangleSelection: () => undefined,
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
      toggleCanvasPoints: () => dispatchCommand("toggleCanvasPoints"),
      resolveImageSourceUrl: (sourcePath) => sourcePath
    }), [
      activeLinePickTarget,
      activeNumericReferencePickTarget,
      activePointPickTarget,
      canvasPresentation,
      canvasViewport,
      commandContext,
      commandLineSession,
      compiledDocumentRevision,
      measureCanvasTextWidth,
      selectedElementId,
      selectedElementIds,
      selectionAnchorElementId,
      showCanvasPointNames,
      showCanvasGeometryNames,
      showCanvasPoints
    ]);

    return (
      <DrawingCanvas
        ref={ref}
        evaluation={canvasPresentation.renderEvaluation}
        evaluationState={canvasPresentation.renderEvaluationState}
        canvasFocusRef={canvasFocusRef}
        hostAdapter={hostAdapter}
      />
    );
  }
);
