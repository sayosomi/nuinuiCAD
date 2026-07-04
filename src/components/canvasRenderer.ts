import type { CanvasViewport } from "../state/cadUiStore";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  ElementId
} from "../types/geometry";
import type { CanvasOverlayImage } from "./DrawingCanvasTypes";
import { imageAssetForSource } from "./imageAssetCache";
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
const AXIS_GRID_LINE_DASH = [6, 4];

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
    ctx.strokeStyle = isAxis ? "#c4c9bf" : isMajor ? "#d6d8d2" : "#eceee8";
    ctx.lineWidth = isAxis ? 1 : isMajor ? 1 : 0.5;
    if (isAxis) ctx.setLineDash(AXIS_GRID_LINE_DASH);
    ctx.stroke();
    if (isAxis) ctx.setLineDash([]);
  }

  for (let y = startY; y <= endY; y += step) {
    const screenY = worldToScreen({ x: 0, y }, size, viewport).y;
    const isAxis = Math.abs(y) < Number.EPSILON;
    const isMajor = Math.abs(y % majorStep) < Number.EPSILON;
    ctx.beginPath();
    ctx.moveTo(0, screenY);
    ctx.lineTo(size.width, screenY);
    ctx.strokeStyle = isAxis ? "#c4c9bf" : isMajor ? "#d6d8d2" : "#eceee8";
    ctx.lineWidth = isAxis ? 1 : isMajor ? 1 : 0.5;
    if (isAxis) ctx.setLineDash(AXIS_GRID_LINE_DASH);
    ctx.stroke();
    if (isAxis) ctx.setLineDash([]);
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
  images?: CanvasOverlayImage[];
  points: ComputedPoint[];
  visibleElementIds: Set<ElementId>;
  selectedElementIdSet: Set<ElementId>;
  selectedElementId: ElementId | null;
  elementColors?: Map<ElementId, string>;
  showCanvasPoints: boolean;
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
  onImageAssetSettled?: () => void;
};

const strokeStyleForGeometry = ({
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive,
  defaultColor
}: {
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
  defaultColor: string;
}) =>
  isPointPickActive
    ? "#c5cac0"
    : isNumericReferencePickActive || isLinePickActive
      ? "#0f766e"
      : defaultColor;

const DEFAULT_GEOMETRY_LINE_WIDTH = 1;
const EMPHASIZED_GEOMETRY_LINE_WIDTH = 1.2;

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
    ? DEFAULT_GEOMETRY_LINE_WIDTH
    : isNumericReferencePickActive || isLinePickActive
      ? EMPHASIZED_GEOMETRY_LINE_WIDTH
      : isPrimarySelected
        ? EMPHASIZED_GEOMETRY_LINE_WIDTH
        : isSelected
          ? EMPHASIZED_GEOMETRY_LINE_WIDTH
          : DEFAULT_GEOMETRY_LINE_WIDTH;

export const renderCanvasGeometry = ({
  ctx,
  size,
  viewport,
  lines,
  arcs,
  curves,
  offsetLines,
  images = [],
  points,
  visibleElementIds,
  selectedElementIdSet,
  selectedElementId,
  elementColors = new Map(),
  showCanvasPoints,
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive,
  onImageAssetSettled
}: RenderCanvasGeometryArgs) => {
  drawGrid(ctx, size, viewport);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const item of images) {
    if (!visibleElementIds.has(item.image.elementId)) continue;
    const isSelected = selectedElementIdSet.has(item.image.elementId);
    const isPrimarySelected = item.image.elementId === selectedElementId;
    const origin = worldToScreen(item.image.origin, size, viewport);
    const asset = imageAssetForSource(item.sourceUrl, onImageAssetSettled);
    const width = item.image.widthMm * viewport.zoom;
    const height = item.image.heightMm * viewport.zoom;

    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.rotate(-((item.image.angleDeg * Math.PI) / 180));
    ctx.scale(item.image.mirrorX ? -1 : 1, 1);
    if (asset.status === "loaded") {
      ctx.drawImage(asset.image, 0, 0, width, height);
    } else {
      ctx.fillStyle = asset.status === "error" ? "rgba(254, 226, 226, 0.8)" : "rgba(241, 245, 249, 0.8)";
      ctx.strokeStyle = asset.status === "error" ? "#b91c1c" : "#94a3b8";
      ctx.lineWidth = 1;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeRect(0, 0, width, height);
    }
    ctx.restore();

    if (isSelected || isPrimarySelected) {
      ctx.beginPath();
      item.corners.forEach((corner, index) => {
        if (index === 0) ctx.moveTo(corner.x, corner.y);
        else ctx.lineTo(corner.x, corner.y);
      });
      ctx.closePath();
      ctx.strokeStyle = elementColors.get(item.image.elementId) ?? "#0f766e";
      ctx.lineWidth = isPrimarySelected ? 1.5 : 1;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

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
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      defaultColor: elementColors.get(line.elementId) ?? "#31322f"
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
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      defaultColor: elementColors.get(arc.elementId) ?? "#31322f"
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
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      defaultColor: elementColors.get(curve.elementId) ?? "#31322f"
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
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      defaultColor: elementColors.get(line.elementId) ?? "#475569"
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
    if (!showCanvasPoints && !isSelected && !isPointPickActive) continue;
    const screen = worldToScreen(point, size, viewport);
    const pointColor = elementColors.get(point.elementId) ?? "#31322f";
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
              ? 3.5
              : isSelected
                ? 3.25
                : 4,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = isPointPickActive
      ? "#e7f4ef"
      : isNumericReferencePickActive || isLinePickActive
        ? "#f6f7f3"
        : isSelected
          ? "transparent"
          : "#ffffff";
    ctx.strokeStyle = isPointPickActive
      ? "#0f766e"
      : isNumericReferencePickActive || isLinePickActive
        ? "#b7bbb0"
        : isSelected
          ? pointColor
          : pointColor;
    ctx.lineWidth = isPointPickActive
      ? 2.5
      : isNumericReferencePickActive || isLinePickActive
        ? 1.25
        : isSelected
          ? 1.25
        : 2;
    ctx.fill();
    ctx.stroke();
  }
};
