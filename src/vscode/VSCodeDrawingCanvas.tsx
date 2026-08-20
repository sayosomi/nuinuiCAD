import type { RefObject } from "react";
import { forwardRef, useCallback, useEffect, useMemo } from "react";
import { dispatchCommand } from "../commands/commands";
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
import { VscodeDragPreviewScheduler } from "./vscodeDragPreviewScheduler";
import type { VscodeCanvasRibbon } from "./vscodeCanvasRibbonConfig";
import { vscodeCanvasRibbonCommandFor } from "./vscodeCanvasRibbonCatalog";
import { resolveVscodeLucideIcon } from "./vscodeCanvasRibbonIcons";
import { CommandRibbonFloatingOverlay } from "../components/CommandRibbonFloatingOverlay";
import type { RibbonPosition } from "../components/commandRibbonFloatingGeometry";
import type {
  CommandRibbonPresentation,
  CommandRibbonPresentationCommandItem
} from "../components/CommandRibbonView";
import { LEGACY_CANVAS_THEME, type CanvasTheme } from "../components/canvasTheme";

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

    const ribbonCommandContext = useMemo(() => ({
      hasSelection: selectedElementIds.length > 0,
      showCanvasElementNames,
      showCanvasPoints
    }), [selectedElementIds.length, showCanvasElementNames, showCanvasPoints]);

    const ribbonPresentations = useMemo<CommandRibbonPresentation[]>(() =>
      canvasRibbonRibbons.map((ribbon) => ({
        id: ribbon.id,
        label: ribbon.label,
        x: ribbon.x,
        y: ribbon.y,
        orientation: ribbon.orientation,
        iconSize: ribbon.iconSize,
        verticalHandlePlacement: ribbon.orientation === "vertical" ? "side" : undefined,
        items: ribbon.items.map((item) => {
          if (item.type === "value") {
            return {
              id: item.id,
              type: "value" as const,
              label: item.label ?? "Canvas Zoom",
              description: "Current Canvas zoom.",
              value: `${canvasViewport.zoom.toFixed(2)} px/mm`
            };
          }
          const definition = vscodeCanvasRibbonCommandFor(item.commandId);
          return {
            id: item.id,
            type: "command" as const,
            commandId: item.commandId,
            icon: item.icon || definition?.icon || "circle",
            label: item.label ?? definition?.label ?? item.commandId,
            description: definition?.description ?? "This command is unavailable.",
            showLabel: item.showLabel,
            available: definition?.isAvailable(ribbonCommandContext) ?? false,
            ...(definition?.isPressed
              ? { pressed: definition.isPressed(ribbonCommandContext) }
              : {})
          } satisfies CommandRibbonPresentationCommandItem;
        })
      })),
      [canvasRibbonRibbons, canvasViewport.zoom, ribbonCommandContext]
    );

    const executeRibbonCommand = useCallback((item: CommandRibbonPresentationCommandItem) => {
      const definition = vscodeCanvasRibbonCommandFor(item.commandId);
      if (!definition || !definition.isAvailable({
        hasSelection: useCadUiStore.getState().selectedElementIds.length > 0,
        showCanvasElementNames: useCadUiStore.getState().showCanvasElementNames,
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
      selectElement: (elementId, selectionMode) => {
        return dispatchCommand("selectElement", {
          elementId,
          selectionMode,
          recordSelectionHistory: true
        });
      },
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
      resolveImageSourceUrl: (sourcePath) => sourcePath,
      renderHostOverlay: (viewportSize) => (
        <CommandRibbonFloatingOverlay
          ribbons={ribbonPresentations}
          viewportSize={viewportSize}
          iconResolver={resolveVscodeLucideIcon}
          onCommand={executeRibbonCommand}
          onPositionCommit={onCanvasRibbonPositionCommit}
        />
      )
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
      visibilityProfiles,
      executeRibbonCommand,
      onCanvasRibbonPositionCommit,
      ribbonPresentations
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
