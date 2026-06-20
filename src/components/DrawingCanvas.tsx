import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dispatchCommand } from "../commands/commands";
import type { BezierHandleRole as CommandBezierHandleRole } from "../commands/commands";
import { lineMeasurementLabel } from "../geometry/numericExpressions";
import { selectablePointsForGeometry } from "../model/pointAnchors";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadStore } from "../state/useCadStore";
import type { CadHistorySnapshot, CanvasViewport } from "../state/useCadStore";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  ElementId,
  EvaluationResult,
  PointAnchor
} from "../types/geometry";
import {
  hitTestCanvasGeometry,
  hitTestLineMeasurementCandidates,
  sampleArcLineScreenPoints,
  sampleBezierCurveScreenPoints,
  sampleOffsetLineScreenPoints
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
  constrainedWorldDelta,
  visibleGridStep,
  visibleWorldBounds,
  worldToScreen
} from "./canvasViewport";
import { numericReferenceValue } from "./geometryDisplay";

type DrawingCanvasProps = {
  evaluation: EvaluationResult;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
};

type PointDragState = {
  pointerId: number;
  elementId: ElementId;
  startClientX: number;
  startClientY: number;
  zoom: number;
  snapshot: CadHistorySnapshot;
};

type BezierHandleDragState = {
  pointerId: number;
  elementId: ElementId;
  role: CommandBezierHandleRole;
  intermediatePointId?: string;
  startClientX: number;
  startClientY: number;
  zoom: number;
  snapshot: CadHistorySnapshot;
};

type PolarLockKeys = {
  angle: boolean;
  distance: boolean;
};

type MeasurementCandidateMenu = {
  screen: ScreenPoint;
  candidates: LineMeasurementCandidate[];
  targetElementId: ElementId;
  targetParameterKey: ParameterKey;
};

type PointPickCandidate = {
  anchor: PointAnchor;
  label: string;
  screen: ScreenPoint;
};

type PointPickCandidateMenu = {
  screen: ScreenPoint;
  candidates: PointPickCandidate[];
};

type LinePickCandidate = {
  line: ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;
};

type LinePickCandidateMenu = {
  screen: ScreenPoint;
  candidates: LinePickCandidate[];
};

type BezierHandleOverlay = {
  id: string;
  curveId: ElementId;
  role: CommandBezierHandleRole;
  intermediatePointId?: string;
  anchor: ScreenPoint;
  control: ScreenPoint;
};

const GRID_STEP = 10;
const MAJOR_GRID_MULTIPLIER = 5;
const MIN_GRID_SPACING_PX = 8;
const WHEEL_ZOOM_BASE = 1.1;
const GRID_ENABLED = true;
const BEZIER_HANDLE_HIT_RADIUS_PX = 9;
const POINT_PICK_CANDIDATE_RADIUS_PX = 10;

const isPoint = (geometry: unknown): geometry is ComputedPoint =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "point";

const isLine = (geometry: unknown): geometry is ComputedLine =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "line";

const isArcLine = (geometry: unknown): geometry is ComputedArcLine =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "arcLine";

const isBezierCurve = (geometry: unknown): geometry is ComputedBezierCurve =>
  typeof geometry === "object" &&
  geometry !== null &&
  "kind" in geometry &&
  geometry.kind === "bezierCurve";

const isOffsetLine = (geometry: unknown): geometry is ComputedOffsetLine =>
  typeof geometry === "object" &&
  geometry !== null &&
  "kind" in geometry &&
  geometry.kind === "offsetLine";

const drawGrid = (
  ctx: CanvasRenderingContext2D,
  size: ViewportSize,
  viewport: CanvasViewport
) => {
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.fillStyle = "#fbfbfa";
  ctx.fillRect(0, 0, size.width, size.height);

  if (!GRID_ENABLED) return;

  const step = visibleGridStep(viewport.zoom, {
    gridStep: GRID_STEP,
    majorGridMultiplier: MAJOR_GRID_MULTIPLIER,
    minGridSpacingPx: MIN_GRID_SPACING_PX
  });
  const majorStep = step * MAJOR_GRID_MULTIPLIER;
  const bounds = visibleWorldBounds(size, viewport);
  const startX = Math.floor(bounds.minX / step) * step;
  const endX = Math.ceil(bounds.maxX / step) * step;
  const startY = Math.floor(bounds.minY / step) * step;
  const endY = Math.ceil(bounds.maxY / step) * step;

  for (let x = startX; x <= endX; x += step) {
    const screenX = worldToScreen({ x, y: 0 }, size, viewport).x;
    const isAxis = Math.abs(x) < Number.EPSILON;
    const isMajor = Math.abs(x % majorStep) < Number.EPSILON;
    ctx.beginPath();
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, size.height);
    ctx.strokeStyle = isAxis ? "#9ca39a" : isMajor ? "#d6d8d2" : "#eceee8";
    ctx.lineWidth = isAxis ? 1.5 : isMajor ? 1 : 0.5;
    ctx.stroke();
  }

  for (let y = startY; y <= endY; y += step) {
    const screenY = worldToScreen({ x: 0, y }, size, viewport).y;
    const isAxis = Math.abs(y) < Number.EPSILON;
    const isMajor = Math.abs(y % majorStep) < Number.EPSILON;
    ctx.beginPath();
    ctx.moveTo(0, screenY);
    ctx.lineTo(size.width, screenY);
    ctx.strokeStyle = isAxis ? "#9ca39a" : isMajor ? "#d6d8d2" : "#eceee8";
    ctx.lineWidth = isAxis ? 1.5 : isMajor ? 1 : 0.5;
    ctx.stroke();
  }
};

export const DrawingCanvas = ({ evaluation, canvasFocusRef }: DrawingCanvasProps) => {
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
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const selectedElementIds = useCadStore((state) => state.selectedElementIds);
  const canvasViewport = useCadStore((state) => state.canvasViewport);
  const panCanvasViewport = useCadStore((state) => state.panCanvasViewport);
  const zoomCanvasViewportAt = useCadStore((state) => state.zoomCanvasViewportAt);
  const activePointPickTarget = useCadStore((state) => state.activePointPickTarget);
  const activeNumericReferencePickTarget = useCadStore((state) => state.activeNumericReferencePickTarget);
  const activeLinePickTarget = useCadStore((state) => state.activeLinePickTarget);
  const visibleElementIds = useMemo(
    () => new Set(elements.filter((element) => element.visible).map((element) => element.id)),
    [elements]
  );
  const selectedElementIdSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
  const geometries = useMemo(
    () => Array.from(evaluation.computedGeometry.values()),
    [evaluation.computedGeometry]
  );
  const lines = useMemo(() => geometries.filter(isLine), [geometries]);
  const arcs = useMemo(() => geometries.filter(isArcLine), [geometries]);
  const curves = useMemo(() => geometries.filter(isBezierCurve), [geometries]);
  const offsetLines = useMemo(() => geometries.filter(isOffsetLine), [geometries]);
  const points = useMemo(() => geometries.filter(isPoint), [geometries]);
  const overlayLines = useMemo(
    () =>
      lines
        .filter((line) => visibleElementIds.has(line.elementId))
        .map((line) => ({
          line,
          start: worldToScreen(line.start, viewportSize, canvasViewport),
          end: worldToScreen(line.end, viewportSize, canvasViewport)
        })),
    [canvasViewport, lines, viewportSize, visibleElementIds]
  );
  const overlayPoints = useMemo(
    () =>
      points
        .filter((point) => visibleElementIds.has(point.elementId))
        .map((point) => ({
          point,
          screen: worldToScreen(point, viewportSize, canvasViewport)
        })),
    [canvasViewport, points, viewportSize, visibleElementIds]
  );
  const overlayArcs = useMemo(
    () =>
      arcs
        .filter((arc) => visibleElementIds.has(arc.elementId))
        .map((arc) => ({
          arc,
          start: worldToScreen(arc.start, viewportSize, canvasViewport),
          end: worldToScreen(arc.end, viewportSize, canvasViewport),
          points: sampleArcLineScreenPoints(arc, (point) =>
            worldToScreen(point, viewportSize, canvasViewport)
          )
        })),
    [arcs, canvasViewport, viewportSize, visibleElementIds]
  );
  const overlayCurves = useMemo(
    () =>
      curves
        .filter((curve) => visibleElementIds.has(curve.elementId))
        .map((curve) => ({
          curve,
          points: sampleBezierCurveScreenPoints(curve, (point) =>
            worldToScreen(point, viewportSize, canvasViewport)
          )
        })),
    [canvasViewport, curves, viewportSize, visibleElementIds]
  );
  const overlayOffsetLines = useMemo(
    () =>
      offsetLines
        .filter((line) => visibleElementIds.has(line.elementId))
        .map((line) => ({
          line,
          points: sampleOffsetLineScreenPoints(line, (point) =>
            worldToScreen(point, viewportSize, canvasViewport)
          )
        })),
    [canvasViewport, offsetLines, viewportSize, visibleElementIds]
  );
  const overlayPointPickCandidates = useMemo(() => {
    const elementsById = new Map(elements.map((element) => [element.id, element]));
    return geometries
      .filter((geometry) => visibleElementIds.has(geometry.elementId))
      .flatMap((geometry) =>
        selectablePointsForGeometry(geometry, elementsById).map((candidate) => ({
          anchor: candidate.anchor,
          label: candidate.label,
          screen: worldToScreen(candidate.point, viewportSize, canvasViewport)
        }))
      );
  }, [canvasViewport, elements, geometries, viewportSize, visibleElementIds]);
  const overlayNumericReferenceCandidates = useMemo(
    () => [
      ...overlayLines.map(({ line, start, end }) => ({ line, start, end })),
      ...overlayArcs.map(({ arc, start, end, points }) => ({ line: arc, start, end, points })),
      ...overlayCurves.map(({ curve, points }) => ({ line: curve, points })),
      ...overlayOffsetLines.map(({ line, points }) => ({ line, points }))
    ],
    [overlayArcs, overlayCurves, overlayLines, overlayOffsetLines]
  );
  const selectedBezierHandles = useMemo(() => {
    const curveElement = elements.find((element) => element.id === selectedElementId);
    if (!curveElement || curveElement.type !== "bezierCurve" || !visibleElementIds.has(curveElement.id)) {
      return [];
    }

    const curve = curves.find((item) => item.elementId === curveElement.id);
    if (!curve || curve.segments.length === 0) return [];

    const handles: BezierHandleOverlay[] = [];
    const firstSegment = curve.segments[0];
    handles.push({
      id: `${curve.elementId}:start`,
      curveId: curve.elementId,
      role: "start",
      anchor: worldToScreen(firstSegment.start, viewportSize, canvasViewport),
      control: worldToScreen(firstSegment.control1, viewportSize, canvasViewport)
    });

    curveElement.intermediatePoints.forEach((point, index) => {
      const incomingSegment = curve.segments[index];
      const outgoingSegment = curve.segments[index + 1];
      if (incomingSegment) {
        handles.push({
          id: `${curve.elementId}:${point.id}:incoming`,
          curveId: curve.elementId,
          role: "intermediateIncoming",
          intermediatePointId: point.id,
          anchor: worldToScreen(incomingSegment.end, viewportSize, canvasViewport),
          control: worldToScreen(incomingSegment.control2, viewportSize, canvasViewport)
        });
      }
      if (outgoingSegment) {
        handles.push({
          id: `${curve.elementId}:${point.id}:outgoing`,
          curveId: curve.elementId,
          role: "intermediateOutgoing",
          intermediatePointId: point.id,
          anchor: worldToScreen(outgoingSegment.start, viewportSize, canvasViewport),
          control: worldToScreen(outgoingSegment.control1, viewportSize, canvasViewport)
        });
      }
    });

    const lastSegment = curve.segments.at(-1);
    if (lastSegment) {
      handles.push({
        id: `${curve.elementId}:end`,
        curveId: curve.elementId,
        role: "end",
        anchor: worldToScreen(lastSegment.end, viewportSize, canvasViewport),
        control: worldToScreen(lastSegment.control2, viewportSize, canvasViewport)
      });
    }

    return handles;
  }, [canvasViewport, curves, elements, selectedElementId, viewportSize, visibleElementIds]);

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

    drawGrid(ctx, viewportSize, canvasViewport);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const line of lines) {
      if (!visibleElementIds.has(line.elementId)) continue;
      const isSelected = selectedElementIdSet.has(line.elementId);
      const isPrimarySelected = line.elementId === selectedElementId;
      const start = worldToScreen(line.start, viewportSize, canvasViewport);
      const end = worldToScreen(line.end, viewportSize, canvasViewport);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle =
        activePointPickTarget
          ? "#c5cac0"
          : activeNumericReferencePickTarget || activeLinePickTarget
            ? "#0f766e"
            : isSelected
              ? "#0f766e"
              : "#31322f";
      ctx.lineWidth = activePointPickTarget
        ? 1.25
        : activeNumericReferencePickTarget || activeLinePickTarget
          ? 3
          : isPrimarySelected
            ? 3.5
            : isSelected
              ? 3
              : 2;
      ctx.stroke();
    }

    for (const arc of arcs) {
      if (!visibleElementIds.has(arc.elementId)) continue;
      const isSelected = selectedElementIdSet.has(arc.elementId);
      const isPrimarySelected = arc.elementId === selectedElementId;
      const center = worldToScreen(arc.center, viewportSize, canvasViewport);
      const radius = Math.max(arc.radius, 0) * canvasViewport.zoom;
      ctx.beginPath();
      ctx.arc(
        center.x,
        center.y,
        radius,
        -((arc.startAngleDeg * Math.PI) / 180),
        -(((arc.startAngleDeg + arc.sweepAngleDeg) * Math.PI) / 180),
        true
      );
      ctx.strokeStyle =
        activePointPickTarget
          ? "#c5cac0"
          : activeNumericReferencePickTarget || activeLinePickTarget
            ? "#0f766e"
            : isSelected
              ? "#0f766e"
              : "#31322f";
      ctx.lineWidth = activePointPickTarget
        ? 1.25
        : activeNumericReferencePickTarget || activeLinePickTarget
          ? 3
          : isPrimarySelected
            ? 3.5
            : isSelected
              ? 3
              : 2;
      ctx.stroke();
    }

    for (const curve of curves) {
      if (!visibleElementIds.has(curve.elementId)) continue;
      const isSelected = selectedElementIdSet.has(curve.elementId);
      const isPrimarySelected = curve.elementId === selectedElementId;
      ctx.beginPath();
      curve.segments.forEach((segment, index) => {
        const start = worldToScreen(segment.start, viewportSize, canvasViewport);
        const control1 = worldToScreen(segment.control1, viewportSize, canvasViewport);
        const control2 = worldToScreen(segment.control2, viewportSize, canvasViewport);
        const end = worldToScreen(segment.end, viewportSize, canvasViewport);
        if (index === 0) ctx.moveTo(start.x, start.y);
        ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
      });
      ctx.strokeStyle =
        activePointPickTarget
          ? "#c5cac0"
          : activeNumericReferencePickTarget || activeLinePickTarget
            ? "#0f766e"
            : isSelected
              ? "#0f766e"
              : "#31322f";
      ctx.lineWidth = activePointPickTarget
        ? 1.25
        : activeNumericReferencePickTarget || activeLinePickTarget
          ? 3
          : isPrimarySelected
            ? 3.5
            : isSelected
              ? 3
              : 2;
      ctx.stroke();
    }

    for (const line of offsetLines) {
      if (!visibleElementIds.has(line.elementId)) continue;
      const isSelected = selectedElementIdSet.has(line.elementId);
      const isPrimarySelected = line.elementId === selectedElementId;
      ctx.beginPath();
      line.segments.forEach((segment, index) => {
        const start = worldToScreen(segment.start, viewportSize, canvasViewport);
        if (index === 0) ctx.moveTo(start.x, start.y);
        if (segment.kind === "line") {
          const end = worldToScreen(segment.end, viewportSize, canvasViewport);
          ctx.lineTo(end.x, end.y);
          return;
        }
        const center = worldToScreen(segment.center, viewportSize, canvasViewport);
        ctx.arc(
          center.x,
          center.y,
          Math.max(segment.radius, 0) * canvasViewport.zoom,
          -((segment.startAngleDeg * Math.PI) / 180),
          -(((segment.startAngleDeg + segment.sweepAngleDeg) * Math.PI) / 180),
          segment.sweepAngleDeg >= 0
        );
      });
      ctx.strokeStyle =
        activePointPickTarget
          ? "#c5cac0"
          : activeNumericReferencePickTarget || activeLinePickTarget
            ? "#0f766e"
            : isSelected
              ? "#0f766e"
              : "#475569";
      ctx.lineWidth = activePointPickTarget
        ? 1.25
        : activeNumericReferencePickTarget || activeLinePickTarget
          ? 3
          : isPrimarySelected
            ? 3.5
            : isSelected
              ? 3
              : 2;
      ctx.stroke();
    }

    for (const point of points) {
      if (!visibleElementIds.has(point.elementId)) continue;
      const isSelected = selectedElementIdSet.has(point.elementId);
      const isPrimarySelected = point.elementId === selectedElementId;
      const screen = worldToScreen(point, viewportSize, canvasViewport);
      ctx.beginPath();
      ctx.arc(
        screen.x,
        screen.y,
        activePointPickTarget
          ? 5.75
          : activeNumericReferencePickTarget
            ? 3.5
            : activeLinePickTarget
            ? 3.5
            : isPrimarySelected
              ? 5.5
              : isSelected
                ? 5
                : 4,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = activePointPickTarget
        ? "#e7f4ef"
        : activeNumericReferencePickTarget || activeLinePickTarget
          ? "#f6f7f3"
          : isSelected
            ? "#0f766e"
            : "#ffffff";
      ctx.strokeStyle = activePointPickTarget
        ? "#0f766e"
        : activeNumericReferencePickTarget || activeLinePickTarget
          ? "#b7bbb0"
          : "#31322f";
      ctx.lineWidth = activePointPickTarget ? 2.5 : activeNumericReferencePickTarget || activeLinePickTarget ? 1.25 : 2;
      ctx.fill();
      ctx.stroke();
    }
  }, [
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget,
    arcs,
    canvasViewport,
    curves,
    offsetLines,
    lines,
    points,
    selectedElementId,
    selectedElementIdSet,
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
    if (!measurementCandidateMenu) return;
    const expression = `${candidate.line.elementId}.${candidate.property}`;
    if (activeNumericReferencePickTarget) {
      dispatchCommand("applyPickedNumericReference", {
        numericReferenceExpression: expression
      });
    } else {
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
  const linePickCandidatesAt = (screen: ScreenPoint) => {
    const activeTarget = activeLinePickTarget;
    if (!activeTarget) return [];

    const targetElement = elements.find((element) => element.id === activeTarget.elementId);
    const pickedBaseLineIds =
      targetElement?.type === "offsetLine" ? new Set(targetElement.baseLineIds) : new Set<ElementId>();
    const uniqueCandidates = new Map<ElementId, LinePickCandidate>();
    for (const candidate of hitTestLineMeasurementCandidates({
      screen,
      lines: overlayNumericReferenceCandidates
    })) {
      if (candidate.line.elementId === activeTarget.elementId) continue;
      if (pickedBaseLineIds.has(candidate.line.elementId)) continue;
      uniqueCandidates.set(candidate.line.elementId, { line: candidate.line });
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
      dy: (event.clientY - drag.startClientY) / drag.zoom,
      angleLocked: polarLockKeysRef.current.angle,
      distanceLocked: polarLockKeysRef.current.distance,
      commitMode: "commit",
      baseElements: drag.snapshot.elements,
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
        const candidates = hitTestLineMeasurementCandidates({
          screen,
          lines: overlayNumericReferenceCandidates
        }).filter(
          (candidate) =>
            candidate.property === "length" ||
            ((candidate.line.kind === "line" || candidate.line.kind === "arcLine") &&
              candidate.line[candidate.property] !== null)
        );
        event.preventDefault();
        event.currentTarget.focus();
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
        return;
      }
      if (handle) {
        event.preventDefault();
        event.currentTarget.focus();
        setMeasurementCandidateMenu(null);
        dispatchCommand("selectElement", { elementId: handle.curveId, selectionMode: "replace" });

        event.currentTarget.setPointerCapture(event.pointerId);
        const state = useCadStore.getState();
        bezierHandleDragRef.current = {
          pointerId: event.pointerId,
          elementId: handle.curveId,
          role: handle.role,
          intermediatePointId: handle.intermediatePointId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          zoom: canvasViewport.zoom,
          snapshot: {
            elements: state.elements,
            selectedElementId: state.selectedElementId,
            selectedElementIds: state.selectedElementIds,
            selectionAnchorElementId: state.selectionAnchorElementId,
            isParameterEditMode: state.isParameterEditMode,
            selectedParameterKey: state.selectedParameterKey
          }
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
        points: overlayPoints
      });
      if (!elementId) return;

      event.preventDefault();
      event.currentTarget.focus();
      dispatchCommand("selectElement", { elementId, selectionMode: "replace" });
      if (!overlayPoints.some(({ point }) => point.elementId === elementId)) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      const state = useCadStore.getState();
      pointDragRef.current = {
        pointerId: event.pointerId,
        elementId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        zoom: canvasViewport.zoom,
        snapshot: {
          elements: state.elements,
          selectedElementId: state.selectedElementId,
          selectedElementIds: state.selectedElementIds,
          selectionAnchorElementId: state.selectionAnchorElementId,
          isParameterEditMode: state.isParameterEditMode,
          selectedParameterKey: state.selectedParameterKey
        }
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
        dy: (event.clientY - bezierHandleDrag.startClientY) / bezierHandleDrag.zoom,
        angleLocked: polarLockKeysRef.current.angle,
        distanceLocked: polarLockKeysRef.current.distance,
        commitMode: "preview",
        baseElements: bezierHandleDrag.snapshot.elements
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
        baseElements: pointDrag.snapshot.elements
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
        <svg
          className="drawing-overlay"
          viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
          aria-hidden="true"
        >
          {overlayLines.map(({ line, start, end }) => (
            <line
              key={line.elementId}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className={selectedElementIdSet.has(line.elementId) ? "overlay-selected-line" : ""}
              data-numeric-reference-candidate={activeNumericReferencePickTarget ? "true" : undefined}
              data-line-pick-candidate={activeLinePickTarget ? "true" : undefined}
            />
          ))}
          {overlayCurves.map(({ curve, points }) => (
            <polyline
              key={curve.elementId}
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
              className={selectedElementIdSet.has(curve.elementId) ? "overlay-selected-line" : ""}
              data-numeric-reference-candidate={activeNumericReferencePickTarget ? "true" : undefined}
              data-line-pick-candidate={activeLinePickTarget ? "true" : undefined}
            />
          ))}
          {overlayArcs.map(({ arc, points }) => (
            <polyline
              key={arc.elementId}
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
              className={selectedElementIdSet.has(arc.elementId) ? "overlay-selected-line" : ""}
              data-numeric-reference-candidate={activeNumericReferencePickTarget ? "true" : undefined}
              data-line-pick-candidate={activeLinePickTarget ? "true" : undefined}
            />
          ))}
          {selectedBezierHandles.map((handle) => (
            <g key={handle.id} className="overlay-bezier-handle">
              <line
                x1={handle.anchor.x}
                y1={handle.anchor.y}
                x2={handle.control.x}
                y2={handle.control.y}
                className="overlay-bezier-handle-line"
              />
              <circle
                cx={handle.control.x}
                cy={handle.control.y}
                r={5}
                className="overlay-bezier-handle-point"
              />
            </g>
          ))}
          {overlayPoints.map(({ point, screen }) => (
            <g key={point.elementId}>
              <circle
                cx={screen.x}
                cy={screen.y}
                r={point.elementId === selectedElementId ? 8 : selectedElementIdSet.has(point.elementId) ? 7 : 6}
                className={`overlay-draggable-point ${
                  selectedElementIdSet.has(point.elementId) ? "overlay-selected-point" : ""
                } ${activePointPickTarget ? "overlay-point-pick-candidate" : ""}`}
              />
              <text x={screen.x + 8} y={screen.y - 8}>
                {point.name}
              </text>
            </g>
          ))}
          {activePointPickTarget
            ? overlayPointPickCandidates.map((candidate, index) => (
                <circle
                  key={`${candidate.label}-${index}`}
                  cx={candidate.screen.x}
                  cy={candidate.screen.y}
                  r={7}
                  className="overlay-derived-point-pick-candidate"
                />
              ))
            : null}
        </svg>
        {activePointPickTarget ? (
          <div className="point-pick-canvas-banner">
            点選択中: canvas または構成リストの点を選択
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
        {measurementCandidateMenu ? (
          <div
            className="numeric-reference-candidate-menu"
            style={{
              left: measurementCandidateMenu.screen.x,
              top: measurementCandidateMenu.screen.y
            }}
            role="menu"
            aria-label="数値参照候補"
          >
            {measurementCandidateMenu.candidates.map((candidate) => (
              <button
                key={`${candidate.line.elementId}-${candidate.property}`}
                type="button"
                role="menuitem"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => applyMeasurementCandidate(candidate)}
              >
                <span className="numeric-reference-candidate-main">
                  <strong>{candidate.line.name}</strong>
                  <span>{lineMeasurementLabel(candidate.property)}</span>
                </span>
                <small>{numericReferenceValue(candidate.line, candidate.property)}</small>
              </button>
            ))}
          </div>
        ) : null}
        {pointPickCandidateMenu ? (
          <div
            className="measurement-candidate-menu"
            style={{
              left: pointPickCandidateMenu.screen.x,
              top: pointPickCandidateMenu.screen.y
            }}
            role="menu"
            aria-label="点選択候補"
          >
            {pointPickCandidateMenu.candidates.map((candidate) => (
              <button
                key={candidate.label}
                type="button"
                role="menuitem"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  dispatchCommand("applyPickedPoint", {
                    pickedPointAnchor: candidate.anchor
                  });
                  setPointPickCandidateMenu(null);
                }}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        ) : null}
        {linePickCandidateMenu ? (
          <div
            className="line-pick-candidate-menu"
            style={{
              left: linePickCandidateMenu.screen.x,
              top: linePickCandidateMenu.screen.y
            }}
            role="menu"
            aria-label="線選択候補"
          >
            {linePickCandidateMenu.candidates.map((candidate) => (
              <button
                key={candidate.line.elementId}
                type="button"
                role="menuitem"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => applyLinePickCandidate(candidate)}
              >
                {candidate.line.name}
              </button>
            ))}
          </div>
        ) : null}
        {evaluation.errors.length > 0 ? (
          <div className="canvas-warning">
            ⚠ {evaluation.errors.length} 件の依存エラーがあります
          </div>
        ) : null}
        <div className="canvas-scale-overlay">縮尺 {canvasViewport.zoom.toFixed(2)}px/mm</div>
      </div>
    </section>
  );
};
