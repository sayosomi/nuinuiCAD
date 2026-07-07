import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent
} from "react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import type { CommandContext } from "../commands/commands";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { generatedElementIdForTargetForGroup } from "../model/forGroupGeneratedReferences";
import { numericReferenceGeometrySupportsProperty } from "../geometry/numericReferenceProperties";
import { getParameterValue } from "../parameters/parameterAccess";
import { resolvedElementColorMap } from "../palette/elementColors";
import type { BezierHandleRole as CommandBezierHandleRole } from "../commands/commands";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadDocumentSnapshot } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type {
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

type DrawingCanvasProps = {
  evaluation: EvaluationResult;
  evaluationState?: EvaluationEngineState;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  commandContext?: CommandContext;
  leftPanelDockRef: RefObject<HTMLDivElement | null>;
};

type PointDragState = {
  pointerId: number;
  elementId: ElementId;
  startClientX: number;
  startClientY: number;
  zoom: number;
  snapshot: CadDocumentSnapshot;
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
  snapshot: CadDocumentSnapshot;
  baseEvaluation?: EvaluationResult;
};

type PolarLockKeys = {
  angle: boolean;
  distance: boolean;
};

const WHEEL_ZOOM_BASE = 1.1;
const BEZIER_HANDLE_HIT_RADIUS_PX = 9;
const POINT_PICK_CANDIDATE_RADIUS_PX = 10;

export const DrawingCanvas = ({
  evaluation,
  evaluationState,
  canvasFocusRef,
  commandContext = {},
  leftPanelDockRef
}: DrawingCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panDragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const pointDragRef = useRef<PointDragState | null>(null);
  const bezierHandleDragRef = useRef<BezierHandleDragState | null>(null);
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
  const elements = useCadDocumentStore((state) => state.elements);
  const palette = useCadDocumentStore((state) => state.palette);
  const selectedElementId = useCadDocumentStore((state) => state.selectedElementId);
  const selectedElementIds = useCadDocumentStore((state) => state.selectedElementIds);
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
  const selectedElementIdSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
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
    selectedBezierHandles,
    isLineEndpointPointPick
  } = useCanvasOverlayData({
    evaluation,
    elements,
    selectedElementId,
    activePointPickTarget,
    viewportSize,
    canvasViewport,
    documentPath: currentFilePath
  });
  const reusableDragEvaluation = (snapshotElements: typeof elements) => {
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
  };
  const currentDocumentDragSnapshot = () => {
    const state = useCadDocumentStore.getState();
    return {
      snapshot: {
        elements: state.elements,
        palette: state.palette,
        visibilityRoles: state.visibilityRoles,
        visibilityProfiles: state.visibilityProfiles,
        activeVisibilityProfileId: state.activeVisibilityProfileId,
        printLayouts: state.printLayouts,
        activePrintLayoutId: state.activePrintLayoutId,
        printLayout: state.printLayout,
        evaluationLimitIndex: state.evaluationLimitIndex,
        selectedElementId: state.selectedElementId,
        selectedElementIds: state.selectedElementIds,
        selectionAnchorElementId: state.selectionAnchorElementId,
        selectedParameterKey: state.selectedParameterKey
      },
      baseEvaluation: reusableDragEvaluation(state.elements)
    };
  };

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

  const applyMeasurementCandidate = (candidate: LineMeasurementCandidate) => {
    const property = activeNumericReferencePickTarget?.property ?? candidate.property;
    const expression = `${candidate.line.elementId}.${property}`;
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
  };
  const applyLinePickCandidate = (candidate: LinePickCandidate) => {
    dispatchCommand("applyPickedLine", {
      pickedLineId: candidate.line.elementId
    });
    setLinePickCandidateMenu(null);
  };
  const applyPointPickCandidate = (candidate: PointPickCandidate) => {
    dispatchCommand("applyPickedPoint", {
      pickedPointAnchor: candidate.anchor
    });
    setPointPickCandidateMenu(null);
  };
  const linePickCandidatesAt = (screen: ScreenPoint) => {
    const activeTarget = activeLinePickTarget;
    if (!activeTarget) return [];

    const targetElement = elements.find((element) => element.id === activeTarget.elementId);
    const parameterValue = targetElement
      ? getParameterValue(targetElement, activeTarget.parameterKey)
      : null;
    const pickedBaseLineIds = new Set<ElementId>(
      Array.isArray(parameterValue)
        ? (parameterValue as unknown[]).filter((id): id is ElementId => typeof id === "string")
        : []
    );
    const uniqueCandidates = new Map<ElementId, LinePickCandidate>();
    for (const candidate of hitTestLineMeasurementCandidates({
      screen,
      lines: overlayNumericReferenceCandidates
    })) {
      const normalizedLineId = generatedElementIdForTargetForGroup({
        elements,
        targetElementId: activeTarget.elementId,
        pickedElementId: candidate.line.elementId
      });
      if (!normalizedLineId || normalizedLineId === activeTarget.elementId) continue;
      if (pickedBaseLineIds.has(normalizedLineId)) continue;
      uniqueCandidates.set(normalizedLineId, { line: candidate.line });
    }
    return Array.from(uniqueCandidates.values());
  };
  const numericReferenceCandidatesAt = (screen: ScreenPoint) => {
    const activeTarget = activeNumericReferencePickTarget;
    if (!activeTarget) return [];

    const uniqueCandidates = new Map<ElementId, LinePickCandidate>();
    for (const line of hitTestLineCandidates({ screen, lines: overlayNumericReferenceCandidates })) {
      if (line.elementId === activeTarget.elementId) continue;
      if (!numericReferenceGeometrySupportsProperty(line, activeTarget.property)) continue;
      uniqueCandidates.set(line.elementId, { line });
    }
    return Array.from(uniqueCandidates.values());
  };

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

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

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
      baseElements: drag.snapshot.elements,
      baseEvaluation: drag.baseEvaluation,
      historySnapshot: drag.snapshot
    });

    pointDragRef.current = null;
    setIsPointDragging(false);
  };

  const stopBezierHandleDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = bezierHandleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dispatchCommand("moveBezierHandleByDelta", {
      elementId: drag.elementId,
      bezierHandleRole: drag.role,
      intermediatePointId: drag.intermediatePointId,
      dx: (event.clientX - drag.startClientX) / drag.zoom,
      dy: -(event.clientY - drag.startClientY) / drag.zoom,
      angleLocked: polarLockKeysRef.current.angle,
      distanceLocked: polarLockKeysRef.current.distance,
      commitMode: "commit",
      baseElements: drag.snapshot.elements,
      baseEvaluation: drag.baseEvaluation,
      historySnapshot: drag.snapshot
    });

    bezierHandleDragRef.current = null;
    setIsBezierHandleDragging(false);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 0) {
      if (viewportSize.width <= 0 || viewportSize.height <= 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const screen = {
        x: event.clientX - rect.left - event.currentTarget.clientLeft,
        y: event.clientY - rect.top - event.currentTarget.clientTop
      };
      const handle = hitTestBezierHandle(
        screen,
        selectedBezierHandles,
        BEZIER_HANDLE_HIT_RADIUS_PX
      );
      if (activeLinePickTarget) {
        const candidates = linePickCandidatesAt(screen);
        event.preventDefault();
        event.currentTarget.focus();
        if (candidates.length === 1) {
          applyLinePickCandidate(candidates[0]);
          setMeasurementCandidateMenu(null);
          setPointPickCandidateMenu(null);
          return;
        }
        if (candidates.length > 1) {
          setLinePickCandidateMenu({ screen, candidates });
          setMeasurementCandidateMenu(null);
          setPointPickCandidateMenu(null);
          return;
        }
        setLinePickCandidateMenu(null);
        setMeasurementCandidateMenu(null);
        setPointPickCandidateMenu(null);
        return;
      }
      if (activePointPickTarget) {
        const candidates = hitTestPointPickCandidates(
          screen,
          overlayPointPickCandidates,
          POINT_PICK_CANDIDATE_RADIUS_PX
        );
        event.preventDefault();
        event.currentTarget.focus();
        if (candidates.length === 1) {
          dispatchCommand("applyPickedPoint", { pickedPointAnchor: candidates[0].anchor });
          setPointPickCandidateMenu(null);
          return;
        }
        if (candidates.length > 1) {
          setPointPickCandidateMenu({ screen, candidates });
          return;
        }
        setPointPickCandidateMenu(null);
        return;
      }
      setPointPickCandidateMenu(null);
      setLinePickCandidateMenu(null);
      if (activeNumericReferencePickTarget) {
        const candidates = numericReferenceCandidatesAt(screen);
        event.preventDefault();
        event.currentTarget.focus();
        if (candidates.length === 1) {
          applyMeasurementCandidate({
            line: candidates[0].line,
            property: activeNumericReferencePickTarget.property
          });
          return;
        }
        if (candidates.length > 1) {
          setMeasurementCandidateMenu({
            screen,
            candidates: candidates.map((candidate) => ({
              line: candidate.line,
              property: activeNumericReferencePickTarget.property
            })),
            targetElementId: activeNumericReferencePickTarget.elementId,
            targetParameterKey: activeNumericReferencePickTarget.parameterKey
          });
        } else {
          setMeasurementCandidateMenu(null);
        }
        return;
      }
      if (handle) {
        event.preventDefault();
        event.currentTarget.focus();
        setMeasurementCandidateMenu(null);
        dispatchCommand("selectElement", { elementId: handle.curveId, selectionMode: "replace" });

        event.currentTarget.setPointerCapture(event.pointerId);
        const dragSnapshot = currentDocumentDragSnapshot();
        bezierHandleDragRef.current = {
          pointerId: event.pointerId,
          elementId: handle.curveId,
          role: handle.role,
          intermediatePointId: handle.intermediatePointId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          zoom: canvasViewport.zoom,
          ...dragSnapshot
        };
        setIsBezierHandleDragging(true);
        return;
      }
      setMeasurementCandidateMenu(null);
      setLinePickCandidateMenu(null);
      const elementId = hitTestCanvasGeometry({
        screen,
        lines: overlayLines,
        arcs: overlayArcs,
        curves: overlayCurves,
        offsetLines: overlayOffsetLines,
        images: overlayImages,
        texts: overlayTexts,
        points: overlayPoints
      });
      if (!elementId) return;

      event.preventDefault();
      event.currentTarget.focus();
      dispatchCommand("selectElement", { elementId, selectionMode: "replace" });
      if (!overlayPoints.some(({ point }) => point.elementId === elementId)) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      const dragSnapshot = currentDocumentDragSnapshot();
      pointDragRef.current = {
        pointerId: event.pointerId,
        elementId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        zoom: canvasViewport.zoom,
        ...dragSnapshot
      };
      setIsPointDragging(true);
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
    const bezierHandleDrag = bezierHandleDragRef.current;
    if (bezierHandleDrag?.pointerId === event.pointerId) {
      if ((event.buttons & 1) === 0) {
        stopBezierHandleDragging(event);
        return;
      }

      event.preventDefault();
      dispatchCommand("moveBezierHandleByDelta", {
        elementId: bezierHandleDrag.elementId,
        bezierHandleRole: bezierHandleDrag.role,
        intermediatePointId: bezierHandleDrag.intermediatePointId,
        dx: (event.clientX - bezierHandleDrag.startClientX) / bezierHandleDrag.zoom,
        dy: -(event.clientY - bezierHandleDrag.startClientY) / bezierHandleDrag.zoom,
        angleLocked: polarLockKeysRef.current.angle,
        distanceLocked: polarLockKeysRef.current.distance,
        commitMode: "preview",
        baseElements: bezierHandleDrag.snapshot.elements,
        baseEvaluation: bezierHandleDrag.baseEvaluation
      });
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

      dispatchCommand("movePointElementByDelta", {
        elementId: pointDrag.elementId,
        dx: worldDelta.dx,
        dy: worldDelta.dy,
        angleLocked: polarLockKeysRef.current.angle,
        distanceLocked: polarLockKeysRef.current.distance,
        commitMode: "preview",
        baseElements: pointDrag.snapshot.elements,
        baseEvaluation: pointDrag.baseEvaluation
      });
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
          stopBezierHandleDragging(event);
          stopPointDragging(event);
          stopPanning(event);
        }}
        onPointerCancel={(event) => {
          stopBezierHandleDragging(event);
          stopPointDragging(event);
          stopPanning(event);
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
        {activePointPickTarget ? (
          <div className="point-pick-canvas-banner">
            {isLineEndpointPointPick
              ? "端点選択中: canvas または構成リストの線端点を選択"
              : `${activePointPickTarget.parameterKey === "startPoint" ? "始点" : activePointPickTarget.parameterKey === "endPoint" ? "終点" : "点"}選択中: canvas または構成リストの点を選択`}
          </div>
        ) : null}
        {activeNumericReferencePickTarget ? (
          <div className="numeric-reference-canvas-banner">
            数値選択中: 線または曲線を選択
          </div>
        ) : null}
        {activeLinePickTarget ? (
          <div className="line-pick-canvas-banner">
            線選択中: canvas または構成リストの線を選択
          </div>
        ) : null}
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
};
