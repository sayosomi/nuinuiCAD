import type { CanvasViewport } from "../state/cadUiStore";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  ElementId
} from "../types/geometry";
import type { ViewportSize } from "./canvasViewport";
import {
  visibleGridStep,
  visibleWorldBounds,
  worldToScreen
} from "./canvasViewport";

const GRID_STEP = 10;
const MAJOR_GRID_MULTIPLIER = 5;
const MIN_GRID_SPACING_PX = 8;
const GRID_ENABLED = true;

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

type RenderCanvasGeometryArgs = {
  ctx: CanvasRenderingContext2D;
  size: ViewportSize;
  viewport: CanvasViewport;
  lines: ComputedLine[];
  arcs: ComputedArcLine[];
  curves: ComputedBezierCurve[];
  offsetLines: ComputedOffsetLine[];
  points: ComputedPoint[];
  visibleElementIds: Set<ElementId>;
  selectedElementIdSet: Set<ElementId>;
  selectedElementId: ElementId | null;
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
};

const strokeStyleForGeometry = ({
  isSelected,
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive,
  defaultColor
}: {
  isSelected: boolean;
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
  defaultColor: string;
}) =>
  isPointPickActive
    ? "#c5cac0"
    : isNumericReferencePickActive || isLinePickActive
      ? "#0f766e"
      : isSelected
        ? "#0f766e"
        : defaultColor;

const lineWidthForGeometry = ({
  isSelected,
  isPrimarySelected,
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive
}: {
  isSelected: boolean;
  isPrimarySelected: boolean;
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
}) =>
  isPointPickActive
    ? 1.25
    : isNumericReferencePickActive || isLinePickActive
      ? 3
      : isPrimarySelected
        ? 3.5
        : isSelected
          ? 3
          : 2;

export const renderCanvasGeometry = ({
  ctx,
  size,
  viewport,
  lines,
  arcs,
  curves,
  offsetLines,
  points,
  visibleElementIds,
  selectedElementIdSet,
  selectedElementId,
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive
}: RenderCanvasGeometryArgs) => {
  drawGrid(ctx, size, viewport);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const line of lines) {
    if (!visibleElementIds.has(line.elementId)) continue;
    const isSelected = selectedElementIdSet.has(line.elementId);
    const isPrimarySelected = line.elementId === selectedElementId;
    const start = worldToScreen(line.start, size, viewport);
    const end = worldToScreen(line.end, size, viewport);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = strokeStyleForGeometry({
      isSelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      defaultColor: "#31322f"
    });
    ctx.lineWidth = lineWidthForGeometry({
      isSelected,
      isPrimarySelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive
    });
    ctx.stroke();
  }

  for (const arc of arcs) {
    if (!visibleElementIds.has(arc.elementId)) continue;
    const isSelected = selectedElementIdSet.has(arc.elementId);
    const isPrimarySelected = arc.elementId === selectedElementId;
    const center = worldToScreen(arc.center, size, viewport);
    const radius = Math.max(arc.radius, 0) * viewport.zoom;
    ctx.beginPath();
    ctx.arc(
      center.x,
      center.y,
      radius,
      -((arc.startAngleDeg * Math.PI) / 180),
      -(((arc.startAngleDeg + arc.sweepAngleDeg) * Math.PI) / 180),
      true
    );
    ctx.strokeStyle = strokeStyleForGeometry({
      isSelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      defaultColor: "#31322f"
    });
    ctx.lineWidth = lineWidthForGeometry({
      isSelected,
      isPrimarySelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive
    });
    ctx.stroke();
  }

  for (const curve of curves) {
    if (!visibleElementIds.has(curve.elementId)) continue;
    const isSelected = selectedElementIdSet.has(curve.elementId);
    const isPrimarySelected = curve.elementId === selectedElementId;
    ctx.beginPath();
    curve.segments.forEach((segment, index) => {
      const start = worldToScreen(segment.start, size, viewport);
      const control1 = worldToScreen(segment.control1, size, viewport);
      const control2 = worldToScreen(segment.control2, size, viewport);
      const end = worldToScreen(segment.end, size, viewport);
      if (index === 0) ctx.moveTo(start.x, start.y);
      ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
    });
    ctx.strokeStyle = strokeStyleForGeometry({
      isSelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      defaultColor: "#31322f"
    });
    ctx.lineWidth = lineWidthForGeometry({
      isSelected,
      isPrimarySelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive
    });
    ctx.stroke();
  }

  for (const line of offsetLines) {
    if (!visibleElementIds.has(line.elementId)) continue;
    const isSelected = selectedElementIdSet.has(line.elementId);
    const isPrimarySelected = line.elementId === selectedElementId;
    ctx.beginPath();
    line.segments.forEach((segment, index) => {
      const start = worldToScreen(segment.start, size, viewport);
      if (index === 0) ctx.moveTo(start.x, start.y);
      if (segment.kind === "line") {
        const end = worldToScreen(segment.end, size, viewport);
        ctx.lineTo(end.x, end.y);
        return;
      }
      if (segment.kind === "bezier") {
        const control1 = worldToScreen(segment.control1, size, viewport);
        const control2 = worldToScreen(segment.control2, size, viewport);
        const end = worldToScreen(segment.end, size, viewport);
        ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
        return;
      }
      const center = worldToScreen(segment.center, size, viewport);
      ctx.arc(
        center.x,
        center.y,
        Math.max(segment.radius, 0) * viewport.zoom,
        -((segment.startAngleDeg * Math.PI) / 180),
        -(((segment.startAngleDeg + segment.sweepAngleDeg) * Math.PI) / 180),
        segment.sweepAngleDeg >= 0
      );
    });
    ctx.strokeStyle = strokeStyleForGeometry({
      isSelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      defaultColor: "#475569"
    });
    ctx.lineWidth = lineWidthForGeometry({
      isSelected,
      isPrimarySelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive
    });
    ctx.stroke();
  }

  for (const point of points) {
    if (!visibleElementIds.has(point.elementId)) continue;
    const isSelected = selectedElementIdSet.has(point.elementId);
    const isPrimarySelected = point.elementId === selectedElementId;
    const screen = worldToScreen(point, size, viewport);
    ctx.beginPath();
    ctx.arc(
      screen.x,
      screen.y,
      isPointPickActive
        ? 5.75
        : isNumericReferencePickActive
          ? 3.5
          : isLinePickActive
            ? 3.5
            : isPrimarySelected
              ? 5.5
              : isSelected
                ? 5
                : 4,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = isPointPickActive
      ? "#e7f4ef"
      : isNumericReferencePickActive || isLinePickActive
        ? "#f6f7f3"
        : isSelected
          ? "#0f766e"
          : "#ffffff";
    ctx.strokeStyle = isPointPickActive
      ? "#0f766e"
      : isNumericReferencePickActive || isLinePickActive
        ? "#b7bbb0"
        : "#31322f";
    ctx.lineWidth = isPointPickActive
      ? 2.5
      : isNumericReferencePickActive || isLinePickActive
        ? 1.25
        : 2;
    ctx.fill();
    ctx.stroke();
  }
};
