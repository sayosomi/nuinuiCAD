import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
  KeyboardEvent as ReactKeyboardEvent,
  WheelEvent as ReactWheelEvent
} from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState } from "react";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { creationPlacementForTarget } from "../model/elementCreationPlacement";
import { numericReferencePropertiesForGeometry } from "../geometry/numericReferenceProperties";
import { pickCandidates, pickSourcePrecedesTarget } from "../model/pickCandidates";
import { isSemanticGeometryCandidateAllowed } from "../model/moduleSemanticCandidateBoundary";
import { pickRefForOption, pickRefKey } from "../model/pickReferences";
import { resolvedElementColorMap } from "../palette/elementColors";
import type { BezierHandleRole as CommandBezierHandleRole } from "../model/elementDragTransforms";
import type {
  CadElement,
  ElementId,
  EvaluationResult
} from "../types/geometry";
import { CanvasCandidateMenus } from "./CanvasCandidateMenus";
import { CanvasOverlay } from "./CanvasOverlay";
import {
  PointDragAxisLockFeedback,
  type PointDragAxisLockFeedbackState
} from "./PointDragAxisLockFeedback";
import {
  hitTestCanvasGeometry,
  hitTestCanvasGeometryAll,
  hitTestLineCandidates,
  hitTestLineMeasurementCandidates
} from "./DrawingCanvasHitTest";
import type { LineMeasurementCandidate } from "./DrawingCanvasHitTest";
import type { ScreenPoint } from "./DrawingCanvasHitTest";
import type { CanvasViewport } from "../state/cadUiStore";
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
import type { CanvasHostAdapter, CanvasSelectionMode } from "./canvasHostAdapter";
import { canvasThemeCssVariables } from "./canvasTheme";
import type {
  CanvasOverlapCandidateSession,
  CanvasHoverIdentityState,
  CanvasIdentityCandidate,
  LinePickCandidate,
  LinePickCandidateMenu,
  MeasurementCandidateMenu,
  PointPickCandidate,
  PointPickCandidateMenu
} from "./DrawingCanvasTypes";
import type { SelectionSnapshot } from "../state/cadDocumentStore";
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
import {
  capturePointerMoveEntry,
  claimPointerMoveEntry,
  measureCanvasDraw
} from "../performance/benchmarkInstrumentation";
import { notifyProductionDrawCompleted } from "../performance/benchmarkFrameObserver";

type DrawingCanvasProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  hostAdapter: CanvasHostAdapter;
};

/** Narrow command-facing boundary for Canvas state that must not survive creation-session re-entry. */
export type DrawingCanvasHandle = {
  clearPendingCanvasPointerIntent: () => void;
  clearEditorFocusReservation: () => void;
  finalizeCanvasInteraction: () => void;
};

type PointDragState = {
  pointerId: number;
  elementId: ElementId;
  startClientX: number;
  startClientY: number;
  zoom: number;
  baseElements: CadElement[];
  baseEvaluation?: EvaluationResult;
  overlapCandidates?: CanvasIdentityCandidate[];
  overlapSelectionBefore?: SelectionSnapshot;
  overlapSelectionMode?: CanvasSelectionMode;
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

type CanvasOverlapSessionState = CanvasOverlapCandidateSession;

const WHEEL_ZOOM_BASE = 1.1;
const BEZIER_HANDLE_HIT_RADIUS_PX = 9;
const POINT_PICK_CANDIDATE_RADIUS_PX = 10;
const DEFERRED_DRAG_THRESHOLD_PX = 3;
const DEFERRED_POINTER_TIMEOUT_MS = 5000;
const OVERLAP_WHEEL_THRESHOLD_PX = 24;

const isRejectedDocumentMutation = (result: unknown) =>
  typeof result === "object" && result !== null && "status" in result && result.status === "rejected";

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas({
  evaluation,
  evaluationState,
  canvasFocusRef,
  hostAdapter
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panDragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const pointDragRef = useRef<PointDragState | null>(null);
  const bezierHandleDragRef = useRef<BezierHandleDragState | null>(null);
  const pendingEditorFocusRef = useRef<{ pointerId: number } | null>(null);
  const pendingPointerStateRef = useRef(initialPendingCanvasPointerState());
  const [captureLedger] = useState(createCanvasPointerCaptureLedger);
  const syntheticPointerEventRef = useRef(false);
  const [pendingPointerState, setPendingPointerState] = useState(initialPendingCanvasPointerState);
  const axisLockKeysRef = useRef<AxisLockKeys>({ x: false, y: false });
  const polarLockKeysRef = useRef<PolarLockKeys>({ angle: false, distance: false });
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isPointDragging, setIsPointDragging] = useState(false);
  const [pointDragFeedback, setPointDragFeedback] = useState<PointDragAxisLockFeedbackState | null>(null);
  const [isBezierHandleDragging, setIsBezierHandleDragging] = useState(false);
  const [measurementCandidateMenu, setMeasurementCandidateMenu] =
    useState<MeasurementCandidateMenu | null>(null);
  const [pointPickCandidateMenu, setPointPickCandidateMenu] =
    useState<PointPickCandidateMenu | null>(null);
  const [linePickCandidateMenu, setLinePickCandidateMenu] =
    useState<LinePickCandidateMenu | null>(null);
  const [overlapCandidateSession, setOverlapCandidateSession] =
    useState<CanvasOverlapSessionState | null>(null);
  const [hoverIdentityState, setHoverIdentityState] = useState<CanvasHoverIdentityState>(null);
  const overlapCandidateSessionRef = useRef<CanvasOverlapSessionState | null>(null);
  const canvasInvalidationInputsRef = useRef<{
    evaluation: EvaluationResult | null;
    visibleElementIds: ReadonlySet<ElementId> | null;
    canvasViewport: CanvasViewport | null;
    viewportSize: ViewportSize | null;
  }>({
    evaluation: null,
    visibleElementIds: null,
    canvasViewport: null,
    viewportSize: null
  });
  const finalizeOverlapSessionRef = useRef<() => boolean>(() => false);
  const hoverFrameRef = useRef<number | null>(null);
  const hoverPointerRef = useRef<ScreenPoint | null>(null);
  const overlapWheelDeltaRef = useRef(0);
  const {
    elements,
    canonicalElements: documentElements,
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
    showCanvasPointNames: hostShowCanvasPointNames,
    showCanvasGeometryNames: hostShowCanvasGeometryNames,
    showCanvasElementNames: legacyShowCanvasElementNames,
    showCanvasPoints,
    showPrintPreviewWindow,
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget,
    commandLineSession
  } = hostAdapter;
  const showCanvasPointNames = hostShowCanvasPointNames ?? legacyShowCanvasElementNames ?? false;
  const showCanvasGeometryNames = hostShowCanvasGeometryNames ?? false;
  const renderFixedCanvasChrome = hostAdapter.renderFixedCanvasChrome ?? true;
  const previewElementIds = useMemo(() => {
    const documentElementIds = new Set(documentElements.map((element) => element.id));
    return new Set(elements.filter((element) => !documentElementIds.has(element.id)).map((element) => element.id));
  }, [documentElements, elements]);
  const hasCommandLineGhost = Boolean(commandLineSession && previewElementIds.size > 0);
  const commandLinePlacement = useMemo(
    () => commandLineSession
      ? creationPlacementForTarget(
          documentElements,
          commandLineSession.insertionTarget,
          evaluationLimitIndex
        )
      : null,
    [commandLineSession, documentElements, evaluationLimitIndex]
  );
  const commandLinePickParentGroupId = commandLinePlacement?.parentGroupId;
  const sharedPickCandidates = useMemo(() => pickCandidates(documentElements, evaluation, {
    activePointPickTarget,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget,
    commandLineSession,
    commandLinePickParentGroupId,
    referenceElements: commandLinePlacement?.referenceElements,
    moduleSemanticContext
  }), [
    activeLinePickTarget,
    activePointPickTarget,
    commandLinePickParentGroupId,
    commandLinePlacement?.referenceElements,
    commandLineSession,
    documentElements,
    evaluation,
    moduleSemanticContext
  ]);
  const sharedLinePickRefKeys = useMemo(() => new Set(sharedPickCandidates.flatMap((candidate) =>
    candidate.options.flatMap((option) => option.kind === "line"
      ? [pickRefKey(pickRefForOption(candidate.elementId, option))]
      : [])
  )), [sharedPickCandidates]);
  const sharedLineSourceReferences = useMemo(() => new Map(sharedPickCandidates.flatMap((candidate) =>
    candidate.options.flatMap((option) => option.kind === "line" && option.sourceReference
      ? [[option.lineId, option.sourceReference] as const]
      : [])
  )), [sharedPickCandidates]);
  const selectedElementIdSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
  const draftLinePickElementIds = useMemo(() => {
    const draftLineIds = new Set(activeLinePickTarget?.draftLineIds ?? []);
    return new Set(sharedPickCandidates.flatMap((candidate) =>
      candidate.options.flatMap((option) => option.kind === "line" &&
        draftLineIds.has(candidate.referenceElementId ?? option.lineId)
        ? [option.lineId]
        : [])
    ));
  }, [activeLinePickTarget?.draftLineIds, sharedPickCandidates]);
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
    overlayIdentityCandidates,
    overlayPointPickCandidates,
    overlayNumericReferenceCandidates,
    selectedBezierEditingHelper,
    selectedBezierHandles
  } = useCanvasOverlayData({
    evaluation,
    elements,
    selectedElementId,
    pointPickCandidates: activePointPickTarget ? sharedPickCandidates : [],
    excludedInteractionElementIds: previewElementIds,
    viewportSize,
    canvasViewport,
    visibilityProfiles,
    activeVisibilityProfileId,
    resolveImageSourceUrl: hostAdapter.resolveImageSourceUrl
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
  const interactiveOverlayIdentityCandidates = useMemo(
    () => overlayIdentityCandidates.filter(({ elementId }) => !previewElementIds.has(elementId)),
    [overlayIdentityCandidates, previewElementIds]
  );
  const interactiveOverlayIdentityCandidatesById = useMemo(
    () => new Map(interactiveOverlayIdentityCandidates.map((candidate) => [candidate.elementId, candidate])),
    [interactiveOverlayIdentityCandidates]
  );
  const hoveredElementIds = useMemo(
    () => new Set(hoverIdentityState?.candidates.map((candidate) => candidate.elementId) ?? []),
    [hoverIdentityState]
  );
  const hoverRepresentativeElementId = hoverIdentityState?.candidates.length === 1
    ? hoverIdentityState.candidates[0]?.elementId ?? null
    : null;
  const hoverIdentityCandidatePopup = useMemo(() => {
    if (!hoverIdentityState || hoverIdentityState.candidates.length < 2) return null;
    const popupCandidates = hoverIdentityState.candidates.filter((candidate) => {
      const persistent = candidate.kind === "point" ? showCanvasPointNames : showCanvasGeometryNames;
      return !persistent && candidate.elementId !== selectedElementId;
    });
    return popupCandidates.length > 0
      ? { pointer: hoverIdentityState.pointer, candidates: popupCandidates }
      : null;
  }, [hoverIdentityState, selectedElementId, showCanvasGeometryNames, showCanvasPointNames]);
  const hitCandidatesAt = useCallback((screen: ScreenPoint) => hitTestCanvasGeometryAll({
    screen,
    lines: interactiveOverlayLines,
    arcs: interactiveOverlayArcs,
    curves: interactiveOverlayCurves,
    offsetLines: interactiveOverlayOffsetLines,
    images: interactiveOverlayImages,
    texts: interactiveOverlayTexts,
    points: interactiveOverlayPoints
  }), [
    interactiveOverlayArcs,
    interactiveOverlayCurves,
    interactiveOverlayImages,
    interactiveOverlayLines,
    interactiveOverlayOffsetLines,
    interactiveOverlayPoints,
    interactiveOverlayTexts
  ]);
  const identityCandidatesForHits = useCallback(
    (hits: readonly { elementId: ElementId }[]) => hits.flatMap((hit) => {
      const candidate = interactiveOverlayIdentityCandidatesById.get(hit.elementId);
      return candidate ? [candidate] : [];
    }),
    [interactiveOverlayIdentityCandidatesById]
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
    const state = hostAdapter.getCurrentCanonicalDocument();
    return {
      baseElements: state.elements,
      baseEvaluation: reusableDragEvaluation(state.elements)
    };
  }, [hostAdapter, reusableDragEvaluation]);
  const currentBezierHandleDragBase = useCallback((elementId: ElementId) => {
    const documentState = hostAdapter.getCurrentCanonicalDocument();
    if (!evaluationStateIsCurrentFor(evaluationState, documentState.compiledDocumentRevision)) return null;
    if (evaluationState && evaluationState.evaluation !== evaluation) return null;
    if (evaluation.preMutationGeometry?.get(elementId)?.kind !== "bezierCurve") return null;
    return {
      baseElements: documentState.elements,
      baseEvaluation: evaluation
    };
  }, [evaluation, evaluationState, hostAdapter]);

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

    const isCurrent = evaluationStateIsCurrentFor(evaluationState, compiledDocumentRevision);
    measureCanvasDraw(
      evaluation,
      isCurrent,
      () => {
        const result = renderCanvasGeometry({
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
          effectiveDrawingModifierStrokes: evaluation.effectiveDrawingModifierStrokes,
          canvasTheme,
          showCanvasPoints,
          isPointPickActive: Boolean(activePointPickTarget),
          isNumericReferencePickActive: Boolean(activeNumericReferencePickTarget),
          isLinePickActive: Boolean(activeLinePickTarget),
          onImageAssetSettled: scheduleImageRender
        });
        if (isCurrent) {
          notifyProductionDrawCompleted(compiledDocumentRevision, true);
        }
        return result;
      }
    );
  }, [
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget,
    arcs,
    canvasViewport,
    compiledDocumentRevision,
    canvasTheme,
    curves,
    elementColors,
    evaluation.effectiveDrawingModifierStrokes,
    evaluation,
    evaluationState,
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
        const nextAxisLockKeys = {
          ...axisLockKeysRef.current,
          [key]: isPressed
        };
        axisLockKeysRef.current = nextAxisLockKeys;
        setPointDragFeedback((feedback) => feedback
          ? { ...feedback, axisLockKeys: nextAxisLockKeys }
          : feedback);
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
      setPointDragFeedback((feedback) => feedback
        ? { ...feedback, axisLockKeys: { x: false, y: false } }
        : feedback);
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

    if (overlapCandidateSessionRef.current) {
      const pixelsPerUnit = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? Math.max(viewportSize.height, 1)
          : 1;
      const normalizedDelta = event.deltaY * pixelsPerUnit;
      if (
        overlapWheelDeltaRef.current !== 0 &&
        normalizedDelta !== 0 &&
        Math.sign(overlapWheelDeltaRef.current) !== Math.sign(normalizedDelta)
      ) {
        overlapWheelDeltaRef.current = 0;
      }
      overlapWheelDeltaRef.current += normalizedDelta;
      const cycles = Math.trunc(Math.abs(overlapWheelDeltaRef.current) / OVERLAP_WHEEL_THRESHOLD_PX);
      if (cycles > 0) {
        const direction = overlapWheelDeltaRef.current > 0 ? 1 : -1;
        overlapWheelDeltaRef.current -= direction * cycles * OVERLAP_WHEEL_THRESHOLD_PX;
        cycleOverlapCandidate(direction * cycles);
      }
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = {
      x: event.clientX - rect.left - event.currentTarget.clientLeft,
      y: event.clientY - rect.top - event.currentTarget.clientTop,
      width: event.currentTarget.clientWidth,
      height: event.currentTarget.clientHeight
    };
    hostAdapter.zoomCanvasViewportAt(Math.pow(WHEEL_ZOOM_BASE, -event.deltaY / 100), anchor);
  };

  const applyMeasurementCandidate = useCallback((candidate: LineMeasurementCandidate) => {
    const expression = `${candidate.line.elementId}.${candidate.property}`;
    if (activeNumericReferencePickTarget) {
      hostAdapter.applyPickedNumericReference(expression);
    } else {
      if (!measurementCandidateMenu) return;
      hostAdapter.applyNumericExpressionReference({
        elementId: measurementCandidateMenu.targetElementId,
        parameterKey: measurementCandidateMenu.targetParameterKey,
        numericExpression: expression
      });
    }
    setMeasurementCandidateMenu(null);
  }, [activeNumericReferencePickTarget, hostAdapter, measurementCandidateMenu]);
  const applyLinePickCandidate = useCallback((candidate: LinePickCandidate) => {
    hostAdapter.applyPickedLine({
      pickedLineId: candidate.line.elementId,
      ...(candidate.sourceReference ? { pickedLineSourceReference: candidate.sourceReference } : {})
    });
    setLinePickCandidateMenu(null);
  }, [hostAdapter]);
  const applyPointPickCandidate = useCallback((candidate: PointPickCandidate) => {
    hostAdapter.applyPickedPoint({
      pickedPointAnchor: candidate.anchor,
      ...(candidate.sourceReference ? { pickedPointSourceReference: candidate.sourceReference } : {})
    });
    setPointPickCandidateMenu(null);
  }, [hostAdapter]);
  /** Resolves a drawn overlay line to the id a line pick would apply, || null when
   * the line is not pickable for the active line-pick target. */
  const pickableLineIdForLinePick = useCallback((lineElementId: ElementId) => {
    const activeTarget = activeLinePickTarget;
    if (!activeTarget) return null;
    const refKey = pickRefKey(pickRefForOption(lineElementId, {
      kind: "line",
      label: "",
      lineId: lineElementId
    }));
    return sharedLinePickRefKeys.has(refKey) ? lineElementId : null;
  }, [activeLinePickTarget, sharedLinePickRefKeys]);
  const isPickableForNumericReference = useCallback((lineElementId: ElementId) => {
    const activeTarget = activeNumericReferencePickTarget;
    if (!activeTarget) return false;
    if (!isSemanticGeometryCandidateAllowed({
      candidateElementId: lineElementId,
      targetElementId: activeTarget.elementId,
      context: moduleSemanticContext
    })) return false;
    return (
      lineElementId !== activeTarget.elementId &&
      pickSourcePrecedesTarget(elements, activeTarget.elementId, lineElementId, activeTarget.insertionIndex)
    );
  }, [activeNumericReferencePickTarget, elements, moduleSemanticContext]);
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
      const lineId = pickableLineIdForLinePick(candidate.line.elementId);
      if (!lineId) continue;
      uniqueCandidates.set(lineId, {
        line: candidate.line,
        ...(sharedLineSourceReferences.get(lineId) ? {
          sourceReference: sharedLineSourceReferences.get(lineId)
        } : {})
      });
    }
    return Array.from(uniqueCandidates.values());
  }, [activeLinePickTarget, overlayNumericReferenceCandidates, pickableLineIdForLinePick, previewElementIds, sharedLineSourceReferences]);
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

  const clearHoveredElement = useCallback(() => {
    hoverPointerRef.current = null;
    setHoverIdentityState(null);
  }, []);

  const setOverlapSession = useCallback((session: CanvasOverlapSessionState | null) => {
    overlapCandidateSessionRef.current = session;
    setOverlapCandidateSession(session);
  }, []);

  const previewOverlapSelection = useCallback((
    previousSelection: SelectionSnapshot,
    elementId: ElementId,
    selectionMode: CanvasSelectionMode
  ) => {
    hostAdapter.previewCanvasSelection(previousSelection, elementId, selectionMode);
  }, [hostAdapter]);

  const finalizeOverlapSelection = useCallback((previousSelection: SelectionSnapshot) => {
    hostAdapter.finalizeCanvasSelectionSession(previousSelection);
  }, [hostAdapter]);

  const finalizeOverlapSession = useCallback(() => {
    const session = overlapCandidateSessionRef.current;
    if (!session) return false;
    overlapCandidateSessionRef.current = null;
    finalizeOverlapSelection(session.selectionBefore);
    setOverlapCandidateSession(null);
    overlapWheelDeltaRef.current = 0;
    clearHoveredElement();
    return true;
  }, [clearHoveredElement, finalizeOverlapSelection]);
  useEffect(() => {
    finalizeOverlapSessionRef.current = finalizeOverlapSession;
  }, [finalizeOverlapSession]);

  const activateOverlapCandidate = useCallback((index: number) => {
    const session = overlapCandidateSessionRef.current;
    if (!session || session.candidates.length === 0) return;
    const wrappedIndex = ((index % session.candidates.length) + session.candidates.length) % session.candidates.length;
    const candidate = session.candidates[wrappedIndex];
    if (!candidate) return;
    previewOverlapSelection(session.selectionBefore, candidate.elementId, session.selectionMode);
    const next = { ...session, activeIndex: wrappedIndex };
    overlapCandidateSessionRef.current = next;
    setOverlapCandidateSession(next);
  }, [previewOverlapSelection]);

  const cycleOverlapCandidate = useCallback((offset: number) => {
    const session = overlapCandidateSessionRef.current;
    if (!session) return;
    activateOverlapCandidate(session.activeIndex + offset);
  }, [activateOverlapCandidate]);

  const openOverlapSession = useCallback((
    anchor: ScreenPoint,
    candidates: CanvasIdentityCandidate[],
    selectionMode: CanvasSelectionMode,
    selectionBefore?: SelectionSnapshot
  ) => {
    if (candidates.length < 2) return false;
    const first = candidates[0];
    if (!first) return false;
    const before = selectionBefore ?? hostAdapter.getCanvasSelectionSnapshot();
    previewOverlapSelection(before, first.elementId, selectionMode);
    setOverlapSession({
      anchor,
      candidates: [...candidates],
      activeIndex: 0,
      selectionMode,
      selectionBefore: before
    });
    clearHoveredElement();
    return true;
  }, [
    clearHoveredElement,
    hostAdapter,
    previewOverlapSelection,
    setOverlapSession
  ]);

  const hoverSuppressed = Boolean(
    isPanning ||
    isPointDragging ||
    isBezierHandleDragging ||
    pendingPointerState.kind === "waiting" ||
    activePointPickTarget ||
    activeNumericReferencePickTarget ||
    activeLinePickTarget ||
    hasCommandLineGhost ||
    overlapCandidateSession ||
    !evaluationStateIsCurrentFor(evaluationState, compiledDocumentRevision)
  );

  const scheduleHoverAt = useCallback((screen: ScreenPoint) => {
    if (hoverSuppressed) {
      clearHoveredElement();
      return;
    }
    hoverPointerRef.current = screen;
    if (hoverFrameRef.current !== null) return;
    const frame = (callback: FrameRequestCallback) =>
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(callback)
        : window.setTimeout(() => callback(Date.now()), 0);
    hoverFrameRef.current = frame(() => {
      hoverFrameRef.current = null;
      if (hoverSuppressed) {
        clearHoveredElement();
        return;
      }
      const pointer = hoverPointerRef.current;
      if (!pointer) return;
      const namedCandidates: CanvasIdentityCandidate[] = [];
      const seen = new Set<ElementId>();
      for (const hit of hitCandidatesAt(pointer)) {
        if (seen.has(hit.elementId)) continue;
        const candidate = interactiveOverlayIdentityCandidatesById.get(hit.elementId);
        if (!candidate?.name) continue;
        seen.add(hit.elementId);
        namedCandidates.push(candidate);
      }
      setHoverIdentityState(namedCandidates.length > 0
        ? { pointer, candidates: namedCandidates }
        : null);
    });
  }, [clearHoveredElement, hitCandidatesAt, hoverSuppressed, interactiveOverlayIdentityCandidatesById]);

  useEffect(() => {
    if (!hoverSuppressed) return;
    if (hoverFrameRef.current !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
    clearHoveredElement();
  }, [clearHoveredElement, hoverSuppressed]);

  useEffect(() => {
    const previous = canvasInvalidationInputsRef.current;
    const hasChanged = previous.evaluation !== null && (
      previous.evaluation !== evaluation ||
      previous.visibleElementIds !== visibleElementIds ||
      previous.canvasViewport?.panX !== canvasViewport.panX ||
      previous.canvasViewport?.panY !== canvasViewport.panY ||
      previous.canvasViewport?.zoom !== canvasViewport.zoom ||
      previous.viewportSize?.width !== viewportSize.width ||
      previous.viewportSize?.height !== viewportSize.height
    );
    canvasInvalidationInputsRef.current = {
      evaluation,
      visibleElementIds,
      canvasViewport: { ...canvasViewport },
      viewportSize: { ...viewportSize }
    };
    if (!overlapCandidateSessionRef.current || !hasChanged) return;
    finalizeOverlapSession();
  }, [canvasViewport, evaluation, finalizeOverlapSession, visibleElementIds, viewportSize]);

  useEffect(() => {
    if (overlapCandidateSession && (activePointPickTarget || activeNumericReferencePickTarget || activeLinePickTarget || commandLineSession)) {
      finalizeOverlapSession();
    }
  }, [
    activeLinePickTarget,
    activeNumericReferencePickTarget,
    activePointPickTarget,
    commandLineSession,
    finalizeOverlapSession,
    hasCommandLineGhost,
    overlapCandidateSession
  ]);

  const capturePointer = useCallback((viewport: HTMLDivElement, pointerId: number) => {
    try {
      captureLedger.capture(viewport, pointerId);
    } catch (error) {
      // WebViews reject setPointerCapture for an untrusted synthetic pointer
      // id. Keep the DOM event on the production canvas path while preserving
      // the normal error behavior for trusted user input.
      if (
        !syntheticPointerEventRef.current ||
        !(error instanceof DOMException) ||
        error.name !== "NotFoundError"
      ) {
        throw error;
      }
    }
  }, [captureLedger]);

  // Normal Canvas selection reserves a Source Editor focus handoff for once the
  // gesture settles. Reference picking, blank clicks, && panning never call this,
  // so they never move focus off the canvas.
  const scheduleEditorFocus = useCallback((pointerId: number, pointerReleased: boolean) => {
    if (pointerReleased) {
      pendingEditorFocusRef.current = null;
      finalizeOverlapSession();
      hostAdapter.focusSourceEditor();
      return;
    }
    pendingEditorFocusRef.current = { pointerId };
  }, [finalizeOverlapSession, hostAdapter]);

  const resolveEditorFocusReservation = useCallback((pointerId: number) => {
    if (pendingEditorFocusRef.current?.pointerId !== pointerId) return;
    pendingEditorFocusRef.current = null;
    finalizeOverlapSessionRef.current();
    hostAdapter.focusSourceEditor();
  }, [hostAdapter]);

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
    },
    finalizeCanvasInteraction: () => {
      finalizeOverlapSession();
      clearHoveredElement();
    }
  }), [applyPendingPointerTransition, clearHoveredElement, finalizeOverlapSession]);

  /**
   * Resolves an intent only against the current render.  The original pointer
   * carries coordinates && modifiers, never an old hit-test result.  The
   * gesture target is always identified at the pointerdown position
   * (intent.start); intent.latest contributes only the drag delta, so a drag
   * moves the element grabbed at the press position even when the drop
   * position is blank || covers a different element.
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
      capturePointer(viewport, intent.pointerId);
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
      hostAdapter.selectElement(handle.curveId, selectionModeFor(intent));
      const dragBase = currentBezierHandleDragBase(handle.curveId);
      if (!dragBase) {
        scheduleEditorFocus(intent.pointerId, intent.pointerReleased);
        return;
      }
      if (intent.pointerReleased) {
        if (movement >= DEFERRED_DRAG_THRESHOLD_PX) {
          hostAdapter.moveBezierHandleByDelta({
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

    const hitCandidates = hitCandidatesAt(screen);
    const identityCandidates = identityCandidatesForHits(hitCandidates);
    const frontmostCandidate = hitCandidates[0];
    if (!frontmostCandidate) {
      focusCanvas();
      return;
    }

    const selectionMode = selectionModeFor(intent);
    const isPointCandidate = frontmostCandidate.kind === "point";
    if (identityCandidates.length > 1 && (!isPointCandidate || (intent.pointerReleased && movement < DEFERRED_DRAG_THRESHOLD_PX))) {
      focusCanvas();
      openOverlapSession(screen, identityCandidates, selectionMode);
      return;
    }

    const elementId = frontmostCandidate.elementId;

    focusCanvas();
    const overlapSelectionBefore = identityCandidates.length > 1
      ? hostAdapter.getCanvasSelectionSnapshot()
      : undefined;
    if (identityCandidates.length > 1 && isPointCandidate && !intent.pointerReleased && overlapSelectionBefore) {
      previewOverlapSelection(overlapSelectionBefore, elementId, selectionMode);
    } else {
      hostAdapter.selectElement(elementId, selectionMode);
    }
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
        hostAdapter.movePointElementByDelta({
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
      ...dragBase,
      ...(identityCandidates.length > 1 && isPointCandidate && overlapSelectionBefore ? {
        overlapCandidates: identityCandidates,
        overlapSelectionBefore,
        overlapSelectionMode: selectionMode
      } : {})
    };
    setPointDragFeedback({
      origin: screen,
      axisLockKeys: { ...axisLockKeysRef.current }
    });
    setIsPointDragging(true);
  }, [
    activeLinePickTarget,
    activeNumericReferencePickTarget,
    activePointPickTarget,
    applyLinePickCandidate,
    applyPointPickCandidate,
    canvasViewport.zoom,
    capturePointer,
    currentBezierHandleDragBase,
    currentDocumentDragBase,
    hasCommandLineGhost,
    linePickCandidatesAt,
    numericReferenceCandidatesAt,
    hitCandidatesAt,
    identityCandidatesForHits,
    overlayPointPickCandidates,
    interactiveOverlayPoints,
    scheduleEditorFocus,
    selectedBezierHandles,
    hostAdapter,
    openOverlapSession,
    previewOverlapSelection,
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
    hostAdapter.setCommandErrorMessage(message);
  }, [applyPendingPointerTransition, hostAdapter]);

  useEffect(() => {
    if (pendingPointerState.kind !== "waiting") return;
    const intent = pendingPointerState.intent;
    const documentState = hostAdapter.getCurrentCanonicalDocument();
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
    hostAdapter,
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
    finalizeOverlapSessionRef.current();
    if (hoverFrameRef.current !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(hoverFrameRef.current);
    }
    hoverFrameRef.current = null;
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
    const movement = Math.hypot(screenDx, screenDy);
    if (drag.overlapCandidates && drag.overlapSelectionBefore && movement < DEFERRED_DRAG_THRESHOLD_PX) {
      const rect = event.currentTarget.getBoundingClientRect();
      const screen = {
        x: drag.startClientX - rect.left - event.currentTarget.clientLeft,
        y: drag.startClientY - rect.top - event.currentTarget.clientTop
      };
      captureLedger.release(event.pointerId);
      pointDragRef.current = null;
      setPointDragFeedback(null);
      setIsPointDragging(false);
      discardEditorFocusReservation(event.pointerId);
      openOverlapSession(
        screen,
        drag.overlapCandidates,
        drag.overlapSelectionMode ?? "replace",
        drag.overlapSelectionBefore
      );
      return;
    }
    if (drag.overlapSelectionBefore) {
      finalizeOverlapSelection(drag.overlapSelectionBefore);
    }
    const worldDelta = constrainedWorldDelta({
      screenDx,
      screenDy,
      zoom: drag.zoom,
      axisLockKeys: axisLockKeysRef.current
    });

    hostAdapter.movePointElementByDelta({
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
    setPointDragFeedback(null);
    setIsPointDragging(false);
  };

  const stopBezierHandleDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = bezierHandleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    captureLedger.release(event.pointerId);

    hostAdapter.moveBezierHandleByDelta({
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
    const flushResult = hostAdapter.flushSourceEditorOnCanvasPointerDown();
    if (flushResult === "blocked-composition") {
      hostAdapter.setCommandErrorMessage(
        "日本語入力の確定中はキャンバス操作を開始できません。入力を確定してから再操作してください。"
      );
      return;
    }
    if (overlapCandidateSessionRef.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      const screen = {
        x: event.clientX - rect.left - event.currentTarget.clientLeft,
        y: event.clientY - rect.top - event.currentTarget.clientTop
      };
      const isBlank = event.button === 0 && hitCandidatesAt(screen).length === 0;
      finalizeOverlapSession();
      if (isBlank) {
        event.preventDefault();
        event.currentTarget.focus();
        return;
      }
    }
    if (event.button === 0) {
      syntheticPointerEventRef.current = event.isTrusted === false;
      const documentState = hostAdapter.getCurrentCanonicalDocument();
      // Immediate hit testing is only allowed against a render that reflects
      // the current document. A pointerdown flush, a stale || in-flight
      // evaluation (e.g. the editor's own debounced commit already flushed),
      // || an earlier intent still waiting all defer this gesture to the
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
        staleTargetHint: deferToFreshEvaluation ? staleTargetHintAt(event) : null
      };
      if (deferToFreshEvaluation) {
        event.preventDefault();
        // Transition first so a replaced intent releases its own capture
        // before this gesture acquires one; the ledger entry then belongs to
        // the new gesture even when the pointer id is reused.
        applyPendingPointerTransition(beginPendingCanvasPointer(pendingPointerStateRef.current, intent));
        capturePointer(event.currentTarget, event.pointerId);
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

  const handleCanvasKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const overlapSession = overlapCandidateSessionRef.current;
    if (overlapSession && event.currentTarget === document.activeElement) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        cycleOverlapCandidate(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finalizeOverlapSession();
        event.currentTarget.focus();
        return;
      }
    }
    if (event.key !== "Escape" || event.currentTarget !== document.activeElement) return;
    if (commandLineSession || activePointPickTarget || activeNumericReferencePickTarget || activeLinePickTarget) return;
    event.preventDefault();
    hostAdapter.clearCanvasSelection();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerMoveEntry = capturePointerMoveEntry();
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

      claimPointerMoveEntry(pointerMoveEntry, "bezier-handle");
      event.preventDefault();
      const result = hostAdapter.moveBezierHandleByDelta({
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

      claimPointerMoveEntry(pointerMoveEntry, "point");
      event.preventDefault();
      const screenDx = event.clientX - pointDrag.startClientX;
      const screenDy = event.clientY - pointDrag.startClientY;
      if (
        pointDrag.overlapSelectionBefore &&
        Math.hypot(screenDx, screenDy) >= DEFERRED_DRAG_THRESHOLD_PX
      ) {
        finalizeOverlapSelection(pointDrag.overlapSelectionBefore);
        pointDragRef.current = {
          ...pointDrag,
          overlapSelectionBefore: undefined
        };
      }
      const worldDelta = constrainedWorldDelta({
        screenDx,
        screenDy,
        zoom: pointDrag.zoom,
        axisLockKeys: axisLockKeysRef.current
      });

      const result = hostAdapter.movePointElementByDelta({
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
        setPointDragFeedback(null);
        setIsPointDragging(false);
      }
      return;
    }

    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      if (event.buttons === 0) {
        const rect = event.currentTarget.getBoundingClientRect();
        scheduleHoverAt({
          x: event.clientX - rect.left - event.currentTarget.clientLeft,
          y: event.clientY - rect.top - event.currentTarget.clientTop
        });
      } else {
        clearHoveredElement();
      }
      return;
    }
    if ((event.buttons & 4) === 0) {
      stopPanning(event);
      return;
    }

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    hostAdapter.panCanvasViewport(dx, dy);
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
        style={canvasThemeCssVariables(canvasTheme)}
        ref={canvasFocusRef}
        tabIndex={-1}
        data-canvas-viewport="true"
        onKeyDown={handleCanvasKeyDown}
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
        onPointerLeave={clearHoveredElement}
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
          selectedBezierEditingHelper={selectedBezierEditingHelper}
          overlayPointPickCandidates={overlayPointPickCandidates}
          selectedElementIdSet={selectedElementIdSet}
          draftLinePickElementIds={draftLinePickElementIds}
          pickCandidateLineIds={pickCandidateLineIds}
          selectedElementId={selectedElementId}
          canvasTheme={canvasTheme}
          elementColors={elementColors}
          overlayIdentityCandidates={interactiveOverlayIdentityCandidates}
          showCanvasPointNames={showCanvasPointNames}
          showCanvasGeometryNames={showCanvasGeometryNames}
          hoveredElementIds={hoveredElementIds}
          hoverRepresentativeElementId={hoverRepresentativeElementId}
          showCanvasPoints={showCanvasPoints}
          isPointPickActive={Boolean(activePointPickTarget)}
          isNumericReferencePickActive={Boolean(activeNumericReferencePickTarget)}
          isLinePickActive={Boolean(activeLinePickTarget)}
        />
        {pointDragFeedback ? (
          <PointDragAxisLockFeedback
            feedback={pointDragFeedback}
            viewportSize={viewportSize}
            canvasTheme={canvasTheme}
          />
        ) : null}
        {hostAdapter.renderHostOverlay?.(viewportSize)}
        {renderFixedCanvasChrome ? (
          <div className="canvas-display-controls" aria-label="キャンバス表示設定">
            <button
              type="button"
              className={showCanvasPointNames ? "active-toggle" : ""}
              aria-pressed={showCanvasPointNames}
              onClick={() => (hostAdapter.toggleCanvasPointNames ?? hostAdapter.toggleCanvasElementNames)()}
            >
              点名
            </button>
            <button
              type="button"
              className={showCanvasGeometryNames ? "active-toggle" : ""}
              aria-pressed={showCanvasGeometryNames}
              onClick={() => hostAdapter.toggleCanvasGeometryNames?.()}
            >
              図形名
            </button>
            <button
              type="button"
              className={showCanvasPoints ? "active-toggle" : ""}
              aria-pressed={showCanvasPoints}
              onClick={() => hostAdapter.toggleCanvasPoints()}
            >
              点
            </button>
            <button
              type="button"
              className={showPrintPreviewWindow ? "active-toggle" : ""}
              aria-pressed={showPrintPreviewWindow}
              onClick={() => hostAdapter.togglePrintPreviewWindow()}
            >
              印刷
            </button>
          </div>
        ) : null}
        <CanvasCandidateMenus
          measurementCandidateMenu={measurementCandidateMenu}
          pointPickCandidateMenu={pointPickCandidateMenu}
          linePickCandidateMenu={linePickCandidateMenu}
          overlapCandidateSession={overlapCandidateSession}
          hoverIdentityCandidatePopup={hoverIdentityCandidatePopup}
          viewportSize={viewportSize}
          onApplyMeasurementCandidate={applyMeasurementCandidate}
          onApplyPointPickCandidate={applyPointPickCandidate}
          onApplyLinePickCandidate={applyLinePickCandidate}
          onActivateOverlapCandidate={activateOverlapCandidate}
          onFocusCanvas={() => canvasFocusRef.current?.focus()}
        />
        {renderFixedCanvasChrome && evaluation.errors.length + evaluation.warnings.length > 0 ? (
          <div className="canvas-warning">
            ⚠ {evaluation.errors.length + evaluation.warnings.length} 件のエラー/警告があります
          </div>
        ) : null}
        {renderFixedCanvasChrome ? (
          <div className="canvas-scale-overlay">縮尺 {canvasViewport.zoom.toFixed(2)}px/mm</div>
        ) : null}
      </div>
    </section>
  );
});
