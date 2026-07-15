import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent
} from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import type { CommandContext } from "../commands/commands";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { generatedElementIdForTargetForGroup } from "../model/forGroupGeneratedReferences";
import { creationPlacementForEvaluationLimit } from "../model/elementCreationPlacement";
import { numericReferencePropertiesForGeometry } from "../geometry/numericReferenceProperties";
import { pickSourcePrecedesTarget } from "../model/pickCandidates";
import {
  commandLinePickNormalizationTargetId
} from "../commands/commandLinePickRouting";
import { resolvedElementColorMap } from "../palette/elementColors";
import type { BezierHandleRole as CommandBezierHandleRole } from "../commands/commands";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { sourceEditSession } from "../editor/sourceEditSession";
import { useCadUiStore } from "../state/cadUiStore";
import type {
  CadElement,
  ElementId,
  EvaluationResult
} from "../types/geometry";
import { CanvasCandidateMenus } from "./CanvasCandidateMenus";
import { CanvasOverlay } from "./CanvasOverlay";
import { CommandRibbonOverlay } from "./CommandRibbonOverlay";
import {
  hitTestCanvasGeometry,
  hitTestLineCandidates,
  hitTestLineMeasurementCandidates
} from "./DrawingCanvasHitTest";
import type { LineMeasurementCandidate } from "./DrawingCanvasHitTest";
import type { ScreenPoint } from "./DrawingCanvasHitTest";
import {
  hitTestBezierHandle,
  hitTestPointPickCandidates
} from "./canvasInteractionHitTest";
import {
  type AxisLockKeys,
  type ViewportSize,
  constrainedWorldDelta
} from "./canvasViewport";
import { renderCanvasGeometry } from "./canvasRenderer";
import { useCanvasOverlayData } from "./useCanvasOverlayData";
import type {
  LinePickCandidate,
  LinePickCandidateMenu,
  MeasurementCandidateMenu,
  PointPickCandidate,
  PointPickCandidateMenu
} from "./DrawingCanvasTypes";
import {
  beginPendingCanvasPointer,
  cancelPendingCanvasPointer,
  createCanvasPointerCaptureLedger,
  initialPendingCanvasPointerState,
  movePendingCanvasPointer,
  pendingCanvasPointerDistance,
  releasePendingCanvasPointer,
  resolvePendingCanvasPointer,
  retargetPendingCanvasPointer,
  type PendingCanvasPointerIntent,
  type PendingCanvasPointerTransition
} from "./pendingCanvasPointer";
import { evaluationStateIsCurrentFor } from "../geometry/useEvaluationEngine";

type DrawingCanvasProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  commandContext?: CommandContext;
  leftPanelDockRef: RefObject<HTMLDivElement | null>;
};

/** Narrow command-facing boundary for Canvas state that must not survive creation-session re-entry. */
export type DrawingCanvasHandle = {
  clearPendingCanvasPointerIntent: () => void;
  clearEditorFocusReservation: () => void;
};

type PointDragState = {
  pointerId: number;
  elementId: ElementId;
  startClientX: number;
  startClientY: number;
  zoom: number;
  baseElements: CadElement[];
  baseEvaluation?: EvaluationResult;
};

type BezierHandleDragState = {
  pointerId: number;
  elementId: ElementId;
  role: CommandBezierHandleRole;
  intermediatePointId?: string;
  startClientX: number;
  startClientY: number;
  zoom: number;
  baseElements: CadElement[];
  baseEvaluation?: EvaluationResult;
};

type PolarLockKeys = {
  angle: boolean;
  distance: boolean;
};

const WHEEL_ZOOM_BASE = 1.1;
const BEZIER_HANDLE_HIT_RADIUS_PX = 9;
const POINT_PICK_CANDIDATE_RADIUS_PX = 10;
const DEFERRED_DRAG_THRESHOLD_PX = 3;
const DEFERRED_POINTER_TIMEOUT_MS = 5000;

const isRejectedDocumentMutation = (result: unknown) =>
  typeof result === "object" && result !== null && "status" in result && result.status === "rejected";

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas({
  evaluation,
  evaluationState,
  canvasFocusRef,
  commandContext = {},
  leftPanelDockRef
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panDragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const pointDragRef = useRef<PointDragState | null>(null);
  const bezierHandleDragRef = useRef<BezierHandleDragState | null>(null);
  const pendingEditorFocusRef = useRef<{ pointerId: number } | null>(null);
  const pendingPointerStateRef = useRef(initialPendingCanvasPointerState());
  const [captureLedger] = useState(createCanvasPointerCaptureLedger);
  const [pendingPointerState, setPendingPointerState] = useState(initialPendingCanvasPointerState);
  const axisLockKeysRef = useRef<AxisLockKeys>({ x: false, y: false });
  const polarLockKeysRef = useRef<PolarLockKeys>({ angle: false, distance: false });
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isPointDragging, setIsPointDragging] = useState(false);
  const [isBezierHandleDragging, setIsBezierHandleDragging] = useState(false);
  const [measurementCandidateMenu, setMeasurementCandidateMenu] =
    useState<MeasurementCandidateMenu | null>(null);
  const [pointPickCandidateMenu, setPointPickCandidateMenu] =
    useState<PointPickCandidateMenu | null>(null);
  const [linePickCandidateMenu, setLinePickCandidateMenu] =
    useState<LinePickCandidateMenu | null>(null);
  const elements = useCadDocumentStore(effectiveElements);
  const documentElements = useCadDocumentStore((state) => state.elements);
  const palette = useCadDocumentStore((state) => state.palette);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const selectedElementIds = useCadUiStore((state) => state.selectedElementIds);
  const currentFilePath = useCadDocumentStore((state) => state.currentFilePath);
  const canvasViewport = useCadUiStore((state) => state.canvasViewport);
  const panCanvasViewport = useCadUiStore((state) => state.panCanvasViewport);
  const zoomCanvasViewportAt = useCadUiStore((state) => state.zoomCanvasViewportAt);
  const showCanvasElementNames = useCadUiStore((state) => state.showCanvasElementNames);
  const showCanvasPoints = useCadUiStore((state) => state.showCanvasPoints);
  const showPrintPreviewWindow = useCadUiStore((state) => state.showPrintPreviewWindow);
  const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
  const activeNumericReferencePickTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const commandLineSession = useCadUiStore((state) => state.commandLineSession);
  const previewElementIds = useMemo(() => {
    const documentElementIds = new Set(documentElements.map((element) => element.id));
    return new Set(elements.filter((element) => !documentElementIds.has(element.id)).map((element) => element.id));
  }, [documentElements, elements]);
  const hasCommandLineGhost = Boolean(commandLineSession && previewElementIds.size > 0);
  const groupFoldById = useCadUiStore((state) => state.groupFoldById);
  const commandLinePickParentGroupId = useMemo(
    () => commandLineSession
      ? creationPlacementForEvaluationLimit(elements, commandLineSession.insertionIndex, groupFoldById).parentGroupId
      : undefined,
    [commandLineSession, elements, groupFoldById]
  );
  const selectedElementIdSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
  const draftLinePickElementIds = useMemo(
    () => new Set(activeLinePickTarget?.draftLineIds ?? []),
    [activeLinePickTarget?.draftLineIds]
  );
  const [imageRenderVersion, scheduleImageRender] = useReducer((version: number) => version + 1, 0);
  const elementColors = useMemo(
    () => resolvedElementColorMap(elements, palette),
    [elements, palette]
  );
  const {
    lines,
    arcs,
    curves,
    offsetLines,
    points,
    visibleElementIds,
    overlayLines,
    overlayPoints,
    overlayArcs,
    overlayCurves,
    overlayOffsetLines,
    overlayImages,
    overlayTexts,
    overlayPointPickCandidates,
    overlayNumericReferenceCandidates,
    selectedBezierHandles
  } = useCanvasOverlayData({
    evaluation,
    elements,
    selectedElementId,
    activePointPickTarget,
    commandLineSession,
    commandLinePickParentGroupId,
    excludedInteractionElementIds: previewElementIds,
    viewportSize,
    canvasViewport,
    documentPath: currentFilePath
  });
  const interactiveOverlayLines = useMemo(
    () => overlayLines.filter(({ line }) => !previewElementIds.has(line.elementId)),
    [overlayLines, previewElementIds]
  );
  const interactiveOverlayPoints = useMemo(
    () => overlayPoints.filter(({ point }) => !previewElementIds.has(point.elementId)),
    [overlayPoints, previewElementIds]
  );
  const interactiveOverlayArcs = useMemo(
    () => overlayArcs.filter(({ arc }) => !previewElementIds.has(arc.elementId)),
    [overlayArcs, previewElementIds]
  );
  const interactiveOverlayCurves = useMemo(
    () => overlayCurves.filter(({ curve }) => !previewElementIds.has(curve.elementId)),
    [overlayCurves, previewElementIds]
  );
  const interactiveOverlayOffsetLines = useMemo(
    () => overlayOffsetLines.filter(({ line }) => !previewElementIds.has(line.elementId)),
    [overlayOffsetLines, previewElementIds]
  );
  const interactiveOverlayImages = useMemo(
    () => overlayImages.filter(({ image }) => !previewElementIds.has(image.elementId)),
    [overlayImages, previewElementIds]
  );
  const interactiveOverlayTexts = useMemo(
    () => overlayTexts.filter(({ text }) => !previewElementIds.has(text.elementId)),
    [overlayTexts, previewElementIds]
  );
  const reusableDragEvaluation = useCallback((snapshotElements: typeof elements) => {
    if (evaluationState?.isStale) return undefined;
    if ((evaluation.evaluationLimitIndex ?? snapshotElements.length) !== snapshotElements.length) {
      return undefined;
    }
    if (
      evaluation.evaluatedElementIds &&
      snapshotElements.some((element) => !evaluation.evaluatedElementIds?.has(element.id))
    ) {
      return undefined;
    }
    return evaluation;
  }, [evaluation, evaluationState?.isStale]);
  const currentDocumentDragBase = useCallback(() => {
    const state = useCadDocumentStore.getState();
    return {
      baseElements: state.elements,
      baseEvaluation: reusableDragEvaluation(state.elements)
    };
  }, [reusableDragEvaluation]);

  useEffect(() => {
    const viewport = canvasFocusRef.current;
    if (!viewport) return;

    const updateSize = () => {
      setViewportSize({
        width: Math.max(viewport.clientWidth, 0),
        height: Math.max(viewport.clientHeight, 0)
      });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [canvasFocusRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || viewportSize.width <= 0 || viewportSize.height <= 0) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewportSize.width * ratio);
    canvas.height = Math.round(viewportSize.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    renderCanvasGeometry({
      ctx,
      size: viewportSize,
      viewport: canvasViewport,
      lines,
      arcs,
      curves,
      offsetLines,
      images: overlayImages,
      points,
      visibleElementIds,
      selectedElementIdSet,
      selectedElementId,
      elementColors,
      showCanvasPoints,
      isPointPickActive: Boolean(activePointPickTarget),
      isNumericReferencePickActive: Boolean(activeNumericReferencePickTarget),
      isLinePickActive: Boolean(activeLinePickTarget),
      onImageAssetSettled: scheduleImageRender
    });
  }, [
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget,
    arcs,
    canvasViewport,
    curves,
    elementColors,
    imageRenderVersion,
    offsetLines,
    overlayImages,
    lines,
    points,
    selectedElementId,
    selectedElementIdSet,
    showCanvasPoints,
    viewportSize,
    visibleElementIds
  ]);

  useEffect(() => {
    const setDragLockKey = (event: KeyboardEvent, isPressed: boolean) => {
      const key = event.key.toLowerCase();
      if (key !== "x" && key !== "y" && key !== "r" && key !== "f") return;
      if (pointDragRef.current || bezierHandleDragRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (key === "x" || key === "y") {
        axisLockKeysRef.current = {
          ...axisLockKeysRef.current,
          [key]: isPressed
        };
      }
      if (key === "r") {
        polarLockKeysRef.current = {
          ...polarLockKeysRef.current,
          angle: isPressed
        };
      }
      if (key === "f") {
        polarLockKeysRef.current = {
          ...polarLockKeysRef.current,
          distance: isPressed
        };
      }
    };

    const clearDragLockKeys = () => {
      axisLockKeysRef.current = { x: false, y: false };
      polarLockKeysRef.current = { angle: false, distance: false };
    };

    const onKeyDown = (event: KeyboardEvent) => setDragLockKey(event, true);
    const onKeyUp = (event: KeyboardEvent) => setDragLockKey(event, false);

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", clearDragLockKeys);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", clearDragLockKeys);
    };
  }, []);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return;
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = {
      x: event.clientX - rect.left - event.currentTarget.clientLeft,
      y: event.clientY - rect.top - event.currentTarget.clientTop,
      width: event.currentTarget.clientWidth,
      height: event.currentTarget.clientHeight
    };
    zoomCanvasViewportAt(Math.pow(WHEEL_ZOOM_BASE, -event.deltaY / 100), anchor);
  };

  const applyMeasurementCandidate = useCallback((candidate: LineMeasurementCandidate) => {
    const expression = `${candidate.line.elementId}.${candidate.property}`;
    if (activeNumericReferencePickTarget) {
      dispatchCommand("applyPickedNumericReference", {
        numericReferenceExpression: expression
      });
    } else {
      if (!measurementCandidateMenu) return;
      dispatchCommand("applyNumericExpressionReference", {
        elementId: measurementCandidateMenu.targetElementId,
        parameterKey: measurementCandidateMenu.targetParameterKey,
        numericExpression: expression
      });
    }
    setMeasurementCandidateMenu(null);
  }, [activeNumericReferencePickTarget, measurementCandidateMenu]);
  const applyLinePickCandidate = useCallback((candidate: LinePickCandidate) => {
    dispatchCommand("applyPickedLine", {
      pickedLineId: candidate.line.elementId
    });
    setLinePickCandidateMenu(null);
  }, []);
  const applyPointPickCandidate = useCallback((candidate: PointPickCandidate) => {
    dispatchCommand("applyPickedPoint", {
      pickedPointAnchor: candidate.anchor
    });
    setPointPickCandidateMenu(null);
  }, []);
  /** Resolves a drawn overlay line to the id a line pick would apply, or null when
   * the line is not pickable for the active line-pick target. */
  const pickableLineIdForLinePick = useCallback((lineElementId: ElementId) => {
    const activeTarget = activeLinePickTarget;
    if (!activeTarget) return null;
    const normalizedLineId = generatedElementIdForTargetForGroup({
      elements,
      targetElementId: commandLinePickNormalizationTargetId(
        activeTarget,
        commandLineSession,
        commandLinePickParentGroupId,
        elements
      ),
      pickedElementId: lineElementId
    });
    if (!normalizedLineId || normalizedLineId === activeTarget.elementId) return null;
    if (!pickSourcePrecedesTarget(elements, activeTarget.elementId, normalizedLineId, activeTarget.insertionIndex)) return null;
    return normalizedLineId;
  }, [activeLinePickTarget, commandLinePickParentGroupId, commandLineSession, elements]);
  const isPickableForNumericReference = useCallback((lineElementId: ElementId) => {
    const activeTarget = activeNumericReferencePickTarget;
    if (!activeTarget) return false;
    return (
      lineElementId !== activeTarget.elementId &&
      pickSourcePrecedesTarget(elements, activeTarget.elementId, lineElementId, activeTarget.insertionIndex)
    );
  }, [activeNumericReferencePickTarget, elements]);
  const pickCandidateLineIds = useMemo(() => {
    const ids = new Set<ElementId>();
    if (!activeLinePickTarget && !activeNumericReferencePickTarget) return ids;
    for (const { line } of overlayNumericReferenceCandidates) {
      if (previewElementIds.has(line.elementId)) continue;
      if (activeNumericReferencePickTarget
        ? isPickableForNumericReference(line.elementId)
        : pickableLineIdForLinePick(line.elementId) !== null) {
        ids.add(line.elementId);
      }
    }
    return ids;
  }, [
    activeLinePickTarget,
    activeNumericReferencePickTarget,
    isPickableForNumericReference,
    overlayNumericReferenceCandidates,
    previewElementIds,
    pickableLineIdForLinePick
  ]);
  const linePickCandidatesAt = useCallback((screen: ScreenPoint) => {
    if (!activeLinePickTarget) return [];

    const uniqueCandidates = new Map<ElementId, LinePickCandidate>();
    for (const candidate of hitTestLineMeasurementCandidates({
      screen,
      lines: overlayNumericReferenceCandidates.filter(({ line }) => !previewElementIds.has(line.elementId))
    })) {
      const normalizedLineId = pickableLineIdForLinePick(candidate.line.elementId);
      if (!normalizedLineId) continue;
      uniqueCandidates.set(normalizedLineId, { line: candidate.line });
    }
    return Array.from(uniqueCandidates.values());
  }, [activeLinePickTarget, overlayNumericReferenceCandidates, pickableLineIdForLinePick, previewElementIds]);
  const numericReferenceCandidatesAt = useCallback((screen: ScreenPoint) => {
    if (!activeNumericReferencePickTarget) return [];

    const uniqueCandidates = new Map<string, LineMeasurementCandidate>();
    for (const line of hitTestLineCandidates({
      screen,
      lines: overlayNumericReferenceCandidates.filter(({ line: candidate }) => !previewElementIds.has(candidate.elementId))
    })) {
      if (!isPickableForNumericReference(line.elementId)) continue;
      for (const property of numericReferencePropertiesForGeometry(line)) {
        uniqueCandidates.set(`${line.elementId}:${property}`, { line, property });
      }
    }
    return Array.from(uniqueCandidates.values());
  }, [activeNumericReferencePickTarget, isPickableForNumericReference, overlayNumericReferenceCandidates, previewElementIds]);

  const applyPendingPointerTransition = useCallback((transition: PendingCanvasPointerTransition) => {
    pendingPointerStateRef.current = transition.state;
    setPendingPointerState(transition.state);
    if (transition.releasePointerId !== undefined) captureLedger.release(transition.releasePointerId);
    return transition.resolve;
  }, [captureLedger]);

  const selectionModeFor = (intent: PendingCanvasPointerIntent) =>
    intent.modifiers.metaKey || intent.modifiers.ctrlKey
      ? "toggle" as const
      : intent.modifiers.shiftKey
        ? "range" as const
        : "replace" as const;

  // Normal Canvas selection reserves a Source Editor focus handoff for once the
  // gesture settles. Reference picking, blank clicks, and panning never call this,
  // so they never move focus off the canvas.
  const scheduleEditorFocus = useCallback((pointerId: number, pointerReleased: boolean) => {
    if (pointerReleased) {
      pendingEditorFocusRef.current = null;
      commandContext.focusElementList?.();
      return;
    }
    pendingEditorFocusRef.current = { pointerId };
  }, [commandContext]);

  const resolveEditorFocusReservation = useCallback((pointerId: number) => {
    if (pendingEditorFocusRef.current?.pointerId !== pointerId) return;
    pendingEditorFocusRef.current = null;
    commandContext.focusElementList?.();
  }, [commandContext]);

  const discardEditorFocusReservation = useCallback((pointerId: number) => {
    if (pendingEditorFocusRef.current?.pointerId === pointerId) {
      pendingEditorFocusRef.current = null;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    clearPendingCanvasPointerIntent: () => {
      applyPendingPointerTransition(cancelPendingCanvasPointer(pendingPointerStateRef.current));
    },
    clearEditorFocusReservation: () => {
      pendingEditorFocusRef.current = null;
    }
  }), [applyPendingPointerTransition]);

  /**
   * Resolves an intent only against the current render.  The original pointer
   * carries coordinates and modifiers, never an old hit-test result.  The
   * gesture target is always identified at the pointerdown position
   * (intent.start); intent.latest contributes only the drag delta, so a drag
   * moves the element grabbed at the press position even when the drop
   * position is blank or covers a different element.
   */
  const resolvePrimaryPointerIntent = useCallback((intent: PendingCanvasPointerIntent, viewport: HTMLDivElement) => {
    if (intent.button !== 0 || viewportSize.width <= 0 || viewportSize.height <= 0) return;
    const rect = viewport.getBoundingClientRect();
    const screen = {
      x: intent.start.clientX - rect.left - viewport.clientLeft,
      y: intent.start.clientY - rect.top - viewport.clientTop
    };
    const movement = pendingCanvasPointerDistance(intent);
    const beginCapture = () => {
      if (intent.pointerReleased) return;
      captureLedger.capture(viewport, intent.pointerId);
    };
    const focusCanvas = () => viewport.focus();
    const handle = hitTestBezierHandle(screen, selectedBezierHandles, BEZIER_HANDLE_HIT_RADIUS_PX);

    if (activeLinePickTarget) {
      const candidates = linePickCandidatesAt(screen);
      focusCanvas();
      if (candidates.length === 1) applyLinePickCandidate(candidates[0]);
      else if (candidates.length > 1) setLinePickCandidateMenu({ screen, candidates });
      else setLinePickCandidateMenu(null);
      setMeasurementCandidateMenu(null);
      setPointPickCandidateMenu(null);
      return;
    }
    if (activePointPickTarget) {
      const candidates = hitTestPointPickCandidates(screen, overlayPointPickCandidates, POINT_PICK_CANDIDATE_RADIUS_PX);
      focusCanvas();
      if (candidates.length === 1) applyPointPickCandidate(candidates[0]);
      else if (candidates.length > 1) setPointPickCandidateMenu({ screen, candidates });
      else setPointPickCandidateMenu(null);
      return;
    }
    if (activeNumericReferencePickTarget) {
      const candidates = numericReferenceCandidatesAt(screen);
      focusCanvas();
      if (candidates.length > 0) {
        setMeasurementCandidateMenu({
          screen,
          candidates,
          targetElementId: activeNumericReferencePickTarget.elementId,
          targetParameterKey: activeNumericReferencePickTarget.parameterKey
        });
      } else {
        setMeasurementCandidateMenu(null);
      }
      setPointPickCandidateMenu(null);
      setLinePickCandidateMenu(null);
      return;
    }

    setPointPickCandidateMenu(null);
    setLinePickCandidateMenu(null);
    setMeasurementCandidateMenu(null);
    if (hasCommandLineGhost) {
      focusCanvas();
      return;
    }
    if (handle) {
      focusCanvas();
      dispatchCommand("selectElement", { elementId: handle.curveId, selectionMode: selectionModeFor(intent) });
      const dragBase = currentDocumentDragBase();
      if (intent.pointerReleased) {
        if (movement >= DEFERRED_DRAG_THRESHOLD_PX) {
          dispatchCommand("moveBezierHandleByDelta", {
            elementId: handle.curveId,
            bezierHandleRole: handle.role,
            intermediatePointId: handle.intermediatePointId,
            dx: (intent.latest.clientX - intent.start.clientX) / canvasViewport.zoom,
            dy: -(intent.latest.clientY - intent.start.clientY) / canvasViewport.zoom,
            angleLocked: polarLockKeysRef.current.angle,
            distanceLocked: polarLockKeysRef.current.distance,
            commitMode: "commit",
            baseElements: dragBase.baseElements,
            baseEvaluation: dragBase.baseEvaluation
          });
        }
        scheduleEditorFocus(intent.pointerId, true);
        return;
      }
      scheduleEditorFocus(intent.pointerId, false);
      beginCapture();
      bezierHandleDragRef.current = {
        pointerId: intent.pointerId,
        elementId: handle.curveId,
        role: handle.role,
        intermediatePointId: handle.intermediatePointId,
        startClientX: intent.start.clientX,
        startClientY: intent.start.clientY,
        zoom: canvasViewport.zoom,
        ...dragBase
      };
      setIsBezierHandleDragging(true);
      return;
    }

    const elementId = hitTestCanvasGeometry({
      screen,
      lines: interactiveOverlayLines,
      arcs: interactiveOverlayArcs,
      curves: interactiveOverlayCurves,
      offsetLines: interactiveOverlayOffsetLines,
      images: interactiveOverlayImages,
      texts: interactiveOverlayTexts,
      points: interactiveOverlayPoints
    });
    if (!elementId) {
      focusCanvas();
      return;
    }

    focusCanvas();
    dispatchCommand("selectElement", { elementId, selectionMode: selectionModeFor(intent) });
    if (!interactiveOverlayPoints.some(({ point }) => point.elementId === elementId)) {
      scheduleEditorFocus(intent.pointerId, intent.pointerReleased);
      return;
    }
    const dragBase = currentDocumentDragBase();
    if (intent.pointerReleased) {
      if (movement >= DEFERRED_DRAG_THRESHOLD_PX) {
        const worldDelta = constrainedWorldDelta({
          screenDx: intent.latest.clientX - intent.start.clientX,
          screenDy: intent.latest.clientY - intent.start.clientY,
          zoom: canvasViewport.zoom,
          axisLockKeys: axisLockKeysRef.current
        });
        dispatchCommand("movePointElementByDelta", {
          elementId,
          dx: worldDelta.dx,
          dy: worldDelta.dy,
          angleLocked: polarLockKeysRef.current.angle,
          distanceLocked: polarLockKeysRef.current.distance,
          commitMode: "commit",
          baseElements: dragBase.baseElements,
          baseEvaluation: dragBase.baseEvaluation
        });
      }
      scheduleEditorFocus(intent.pointerId, true);
      return;
    }
    scheduleEditorFocus(intent.pointerId, false);
    beginCapture();
    pointDragRef.current = {
      pointerId: intent.pointerId,
      elementId,
      startClientX: intent.start.clientX,
      startClientY: intent.start.clientY,
      zoom: canvasViewport.zoom,
      ...dragBase
    };
    setIsPointDragging(true);
  }, [
    activeLinePickTarget,
    activeNumericReferencePickTarget,
    activePointPickTarget,
    applyLinePickCandidate,
    applyPointPickCandidate,
    canvasViewport.zoom,
    captureLedger,
    currentDocumentDragBase,
    hasCommandLineGhost,
    linePickCandidatesAt,
    numericReferenceCandidatesAt,
    interactiveOverlayArcs,
    interactiveOverlayCurves,
    interactiveOverlayImages,
    interactiveOverlayLines,
    interactiveOverlayOffsetLines,
    overlayPointPickCandidates,
    interactiveOverlayPoints,
    interactiveOverlayTexts,
    scheduleEditorFocus,
    selectedBezierHandles,
    viewportSize.height,
    viewportSize.width
  ]);

  const staleTargetHintAt = (event: ReactPointerEvent<HTMLDivElement>): ElementId | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const screen = {
      x: event.clientX - rect.left - event.currentTarget.clientLeft,
      y: event.clientY - rect.top - event.currentTarget.clientTop
    };
    const handle = hitTestBezierHandle(screen, selectedBezierHandles, BEZIER_HANDLE_HIT_RADIUS_PX);
    if (handle) return handle.curveId;
    return hitTestCanvasGeometry({
      screen,
      lines: interactiveOverlayLines,
      arcs: interactiveOverlayArcs,
      curves: interactiveOverlayCurves,
      offsetLines: interactiveOverlayOffsetLines,
      images: interactiveOverlayImages,
      texts: interactiveOverlayTexts,
      points: interactiveOverlayPoints
    });
  };

  const terminalPendingPointer = useCallback((message: string) => {
    const transition = cancelPendingCanvasPointer(pendingPointerStateRef.current);
    applyPendingPointerTransition(transition);
    useCadUiStore.getState().setCommandErrorMessage(message);
  }, [applyPendingPointerTransition]);

  useEffect(() => {
    if (pendingPointerState.kind !== "waiting") return;
    const intent = pendingPointerState.intent;
    const documentState = useCadDocumentStore.getState();
    if (documentState.docText !== documentState.sourceText) {
      terminalPendingPointer("DSLの構文エラーを修復してからキャンバス操作を実行してください。");
      return;
    }
    if (
      documentState.sourceRevision !== intent.sourceRevision ||
      documentState.compiledDocumentRevision !== intent.compiledDocumentRevision
    ) {
      applyPendingPointerTransition(retargetPendingCanvasPointer(
        pendingPointerStateRef.current,
        documentState.sourceRevision,
        documentState.compiledDocumentRevision
      ));
      return;
    }
    if (
      evaluationState?.evaluationRevision === documentState.compiledDocumentRevision &&
      evaluationState.status === "failed"
    ) {
      terminalPendingPointer("評価に失敗したためキャンバス操作を続行できませんでした。");
      return;
    }
    if (!evaluationStateIsCurrentFor(evaluationState, documentState.compiledDocumentRevision)) return;
    if (intent.staleTargetHint && !documentState.elements.some((element) => element.id === intent.staleTargetHint)) {
      terminalPendingPointer("操作対象が更新中に削除されたためキャンバス操作を取り消しました。");
      return;
    }
    const resolved = applyPendingPointerTransition(resolvePendingCanvasPointer(pendingPointerStateRef.current));
    const viewport = canvasFocusRef.current;
    if (resolved && viewport) resolvePrimaryPointerIntent(resolved, viewport);
  }, [
    applyPendingPointerTransition,
    canvasFocusRef,
    evaluationState,
    pendingPointerState,
    resolvePrimaryPointerIntent,
    terminalPendingPointer
  ]);

  useEffect(() => {
    if (pendingPointerState.kind !== "waiting") return;
    const pointerId = pendingPointerState.intent.pointerId;
    const timeout = window.setTimeout(() => {
      if (pendingPointerStateRef.current.kind !== "waiting" || pendingPointerStateRef.current.intent.pointerId !== pointerId) return;
      terminalPendingPointer("評価の待機がタイムアウトしたためキャンバス操作を取り消しました。");
    }, Math.max(0, pendingPointerState.intent.deadlineAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [pendingPointerState, terminalPendingPointer]);

  useEffect(() => () => {
    const transition = cancelPendingCanvasPointer(pendingPointerStateRef.current);
    if (transition.releasePointerId !== undefined) captureLedger.release(transition.releasePointerId);
    pendingPointerStateRef.current = transition.state;
  }, [captureLedger]);

  const stopPanning = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panDragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      panDragRef.current = null;
      setIsPanning(false);
    }
  };

  const stopPointDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pointDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    captureLedger.release(event.pointerId);

    const screenDx = event.clientX - drag.startClientX;
    const screenDy = event.clientY - drag.startClientY;
    const worldDelta = constrainedWorldDelta({
      screenDx,
      screenDy,
      zoom: drag.zoom,
      axisLockKeys: axisLockKeysRef.current
    });

    dispatchCommand("movePointElementByDelta", {
      elementId: drag.elementId,
      dx: worldDelta.dx,
      dy: worldDelta.dy,
      angleLocked: polarLockKeysRef.current.angle,
      distanceLocked: polarLockKeysRef.current.distance,
      commitMode: "commit",
      baseElements: drag.baseElements,
      baseEvaluation: drag.baseEvaluation
    });

    pointDragRef.current = null;
    setIsPointDragging(false);
  };

  const stopBezierHandleDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = bezierHandleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    captureLedger.release(event.pointerId);

    dispatchCommand("moveBezierHandleByDelta", {
      elementId: drag.elementId,
      bezierHandleRole: drag.role,
      intermediatePointId: drag.intermediatePointId,
      dx: (event.clientX - drag.startClientX) / drag.zoom,
      dy: -(event.clientY - drag.startClientY) / drag.zoom,
      angleLocked: polarLockKeysRef.current.angle,
      distanceLocked: polarLockKeysRef.current.distance,
      commitMode: "commit",
      baseElements: drag.baseElements,
      baseEvaluation: drag.baseEvaluation
    });

    bezierHandleDragRef.current = null;
    setIsBezierHandleDragging(false);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const flushResult = sourceEditSession.flush("canvas-pointerdown");
    if (flushResult === "blocked-composition") {
      useCadUiStore.getState().setCommandErrorMessage(
        "日本語入力の確定中はキャンバス操作を開始できません。入力を確定してから再操作してください。"
      );
      return;
    }
    if (event.button === 0) {
      const documentState = useCadDocumentStore.getState();
      // Immediate hit testing is only allowed against a render that reflects
      // the current document. A pointerdown flush, a stale or in-flight
      // evaluation (e.g. the editor's own debounced commit already flushed),
      // or an earlier intent still waiting all defer this gesture to the
      // resolution effect; a new gesture replaces any waiting intent so the
      // older intent can never resolve after it.
      const deferToFreshEvaluation =
        flushResult === "flushed" ||
        pendingPointerStateRef.current.kind === "waiting" ||
        !evaluationStateIsCurrentFor(evaluationState, documentState.compiledDocumentRevision);
      const intent = {
        pointerId: event.pointerId,
        button: event.button,
        start: { clientX: event.clientX, clientY: event.clientY },
        latest: { clientX: event.clientX, clientY: event.clientY },
        modifiers: { metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey },
        sourceRevision: documentState.sourceRevision,
        compiledDocumentRevision: documentState.compiledDocumentRevision,
        deadlineAt: Date.now() + DEFERRED_POINTER_TIMEOUT_MS,
        // This hint is only an invalidation guard. Resolution below always reruns hit testing.
        staleTargetHint: deferToFreshEvaluation ? staleTargetHintAt(event) : null
      };
      if (deferToFreshEvaluation) {
        event.preventDefault();
        // Transition first so a replaced intent releases its own capture
        // before this gesture acquires one; the ledger entry then belongs to
        // the new gesture even when the pointer id is reused.
        applyPendingPointerTransition(beginPendingCanvasPointer(pendingPointerStateRef.current, intent));
        captureLedger.capture(event.currentTarget, event.pointerId);
        return;
      }
      resolvePrimaryPointerIntent({ ...intent, pointerReleased: false }, event.currentTarget);
      return;
    }

    if (event.button !== 1) return;
    setMeasurementCandidateMenu(null);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panDragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY
    };
    setIsPanning(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pendingPointerStateRef.current.kind === "waiting") {
      applyPendingPointerTransition(movePendingCanvasPointer(
        pendingPointerStateRef.current,
        event.pointerId,
        { clientX: event.clientX, clientY: event.clientY }
      ));
      return;
    }
    const bezierHandleDrag = bezierHandleDragRef.current;
    if (bezierHandleDrag?.pointerId === event.pointerId) {
      if ((event.buttons & 1) === 0) {
        stopBezierHandleDragging(event);
        return;
      }

      event.preventDefault();
      const result = dispatchCommand("moveBezierHandleByDelta", {
        elementId: bezierHandleDrag.elementId,
        bezierHandleRole: bezierHandleDrag.role,
        intermediatePointId: bezierHandleDrag.intermediatePointId,
        dx: (event.clientX - bezierHandleDrag.startClientX) / bezierHandleDrag.zoom,
        dy: -(event.clientY - bezierHandleDrag.startClientY) / bezierHandleDrag.zoom,
        angleLocked: polarLockKeysRef.current.angle,
        distanceLocked: polarLockKeysRef.current.distance,
        commitMode: "preview",
        baseElements: bezierHandleDrag.baseElements,
        baseEvaluation: bezierHandleDrag.baseEvaluation
      });
      if (isRejectedDocumentMutation(result)) {
        captureLedger.release(event.pointerId);
        bezierHandleDragRef.current = null;
        setIsBezierHandleDragging(false);
      }
      return;
    }

    const pointDrag = pointDragRef.current;
    if (pointDrag?.pointerId === event.pointerId) {
      if ((event.buttons & 1) === 0) {
        stopPointDragging(event);
        return;
      }

      event.preventDefault();
      const screenDx = event.clientX - pointDrag.startClientX;
      const screenDy = event.clientY - pointDrag.startClientY;
      const worldDelta = constrainedWorldDelta({
        screenDx,
        screenDy,
        zoom: pointDrag.zoom,
        axisLockKeys: axisLockKeysRef.current
      });

      const result = dispatchCommand("movePointElementByDelta", {
        elementId: pointDrag.elementId,
        dx: worldDelta.dx,
        dy: worldDelta.dy,
        angleLocked: polarLockKeysRef.current.angle,
        distanceLocked: polarLockKeysRef.current.distance,
        commitMode: "preview",
        baseElements: pointDrag.baseElements,
        baseEvaluation: pointDrag.baseEvaluation
      });
      if (isRejectedDocumentMutation(result)) {
        captureLedger.release(event.pointerId);
        pointDragRef.current = null;
        setIsPointDragging(false);
      }
      return;
    }

    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if ((event.buttons & 4) === 0) {
      stopPanning(event);
      return;
    }

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    panCanvasViewport(dx, dy);
    panDragRef.current = {
      ...drag,
      lastX: event.clientX,
      lastY: event.clientY
    };
  };

  return (
    <section className="canvas-panel">
      <div
        className={[
          "canvas-viewport",
          isPanning ? "is-panning" : "",
          isPointDragging ? "is-point-dragging" : "",
          isBezierHandleDragging ? "is-bezier-handle-dragging" : "",
          activePointPickTarget ? "is-point-picking" : "",
          activeNumericReferencePickTarget ? "is-numeric-reference-picking" : "",
          activeLinePickTarget ? "is-line-picking" : ""
        ].filter(Boolean).join(" ")}
        ref={canvasFocusRef}
        tabIndex={-1}
        data-canvas-viewport="true"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => {
          if (pendingPointerStateRef.current.kind === "waiting") {
            applyPendingPointerTransition(releasePendingCanvasPointer(
              pendingPointerStateRef.current,
              event.pointerId,
              { clientX: event.clientX, clientY: event.clientY }
            ));
            return;
          }
          stopBezierHandleDragging(event);
          stopPointDragging(event);
          stopPanning(event);
          resolveEditorFocusReservation(event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (pendingPointerStateRef.current.kind === "waiting") {
            applyPendingPointerTransition(cancelPendingCanvasPointer(pendingPointerStateRef.current, event.pointerId));
            discardEditorFocusReservation(event.pointerId);
            return;
          }
          stopBezierHandleDragging(event);
          stopPointDragging(event);
          stopPanning(event);
          discardEditorFocusReservation(event.pointerId);
        }}
        onAuxClick={(event) => event.preventDefault()}
      >
        <canvas ref={canvasRef} aria-label="CAD drawing canvas" />
        <CanvasOverlay
          viewportSize={viewportSize}
          overlayLines={overlayLines}
          overlayArcs={overlayArcs}
          overlayCurves={overlayCurves}
          overlayOffsetLines={overlayOffsetLines}
          overlayPoints={overlayPoints}
          overlayTexts={overlayTexts}
          selectedBezierHandles={selectedBezierHandles}
          overlayPointPickCandidates={overlayPointPickCandidates}
          selectedElementIdSet={selectedElementIdSet}
          draftLinePickElementIds={draftLinePickElementIds}
          pickCandidateLineIds={pickCandidateLineIds}
          selectedElementId={selectedElementId}
          elementColors={elementColors}
          showCanvasElementNames={showCanvasElementNames}
          showCanvasPoints={showCanvasPoints}
          isPointPickActive={Boolean(activePointPickTarget)}
          isNumericReferencePickActive={Boolean(activeNumericReferencePickTarget)}
          isLinePickActive={Boolean(activeLinePickTarget)}
        />
        <CommandRibbonOverlay
          commandContext={commandContext}
          leftPanelDockRef={leftPanelDockRef}
          viewportSize={viewportSize}
        />
        <div className="canvas-display-controls" aria-label="キャンバス表示設定">
          <button
            type="button"
            className={showCanvasElementNames ? "active-toggle" : ""}
            aria-pressed={showCanvasElementNames}
            onClick={() => dispatchCommand("toggleCanvasElementNames")}
          >
            要素名
          </button>
          <button
            type="button"
            className={showCanvasPoints ? "active-toggle" : ""}
            aria-pressed={showCanvasPoints}
            onClick={() => dispatchCommand("toggleCanvasPoints")}
          >
            点
          </button>
          <button
            type="button"
            className={showPrintPreviewWindow ? "active-toggle" : ""}
            aria-pressed={showPrintPreviewWindow}
            onClick={() => dispatchCommand("togglePrintPreviewWindow")}
          >
            印刷
          </button>
        </div>
        <CanvasCandidateMenus
          measurementCandidateMenu={measurementCandidateMenu}
          pointPickCandidateMenu={pointPickCandidateMenu}
          linePickCandidateMenu={linePickCandidateMenu}
          onApplyMeasurementCandidate={applyMeasurementCandidate}
          onApplyPointPickCandidate={applyPointPickCandidate}
          onApplyLinePickCandidate={applyLinePickCandidate}
        />
        {evaluation.errors.length + evaluation.warnings.length > 0 ? (
          <div className="canvas-warning">
            ⚠ {evaluation.errors.length + evaluation.warnings.length} 件のエラー/警告があります
          </div>
        ) : null}
        <div className="canvas-scale-overlay">縮尺 {canvasViewport.zoom.toFixed(2)}px/mm</div>
      </div>
    </section>
  );
});
