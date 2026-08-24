import type { CanvasViewport } from "../state/cadUiStore";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedJoinedPath,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  DrawingModifierStroke,
  ElementId
} from "../types/geometry";
import {
  canvasThemeColorForRole,
  LEGACY_CANVAS_THEME,
  type CanvasTheme
} from "./canvasTheme";
import type { CanvasOverlayImage } from "./DrawingCanvasTypes";
import { CANVAS_BASE_DRAW_ORDER } from "./canvasDrawOrder";
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
  viewport: CanvasViewport,
  canvasTheme: CanvasTheme
) => {
  ctx.setLineDash([]);
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.fillStyle = canvasTheme.background;
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
    ctx.strokeStyle = isAxis ? canvasTheme.axis : isMajor ? canvasTheme.majorGrid : canvasTheme.minorGrid;
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
    ctx.strokeStyle = isAxis ? canvasTheme.axis : isMajor ? canvasTheme.majorGrid : canvasTheme.minorGrid;
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
  joinedPaths?: ComputedJoinedPath[];
  images?: CanvasOverlayImage[];
  points: ComputedPoint[];
  visibleElementIds: Set<ElementId>;
  selectedElementIdSet: Set<ElementId>;
  selectedElementId: ElementId | null;
  effectiveDrawingModifierStrokes?: ReadonlyMap<ElementId, DrawingModifierStroke>;
  canvasTheme?: CanvasTheme;
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
  defaultColor,
  canvasTheme
}: {
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
  defaultColor: string;
  canvasTheme: CanvasTheme;
}) =>
  isPointPickActive
    ? canvasTheme.pickCandidate
    : isNumericReferencePickActive || isLinePickActive
      ? canvasTheme.pickCandidate
      : defaultColor;

const DEFAULT_GEOMETRY_LINE_WIDTH = 1;
const EMPHASIZED_GEOMETRY_LINE_WIDTH = 1.2;

const drawingModifierColor = (stroke: DrawingModifierStroke, canvasTheme: CanvasTheme) =>
  stroke.color.kind === "fixed"
    ? stroke.color.hex
    : canvasThemeColorForRole(canvasTheme, stroke.color.role);

const drawingModifierDash = (style: DrawingModifierStroke["style"]) =>
  style === "solid" ? [] : style === "dashed" ? [6, 4] : [1, 3];

const lineWidthForGeometry = ({
  isSelected,
  isPrimarySelected,
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive,
  modifierWidth
}: {
  isSelected: boolean;
  isPrimarySelected: boolean;
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
  modifierWidth?: number;
}) => {
  const legacyWidth = isPointPickActive
    ? DEFAULT_GEOMETRY_LINE_WIDTH
    : isNumericReferencePickActive || isLinePickActive
      ? EMPHASIZED_GEOMETRY_LINE_WIDTH
      : isPrimarySelected
        ? EMPHASIZED_GEOMETRY_LINE_WIDTH
        : isSelected
          ? EMPHASIZED_GEOMETRY_LINE_WIDTH
          : DEFAULT_GEOMETRY_LINE_WIDTH;
  const hasInteractionEmphasis = isPointPickActive || isNumericReferencePickActive ||
    isLinePickActive || isPrimarySelected || isSelected;
  return modifierWidth === undefined
    ? legacyWidth
    : hasInteractionEmphasis
      ? Math.max(modifierWidth, legacyWidth)
      : modifierWidth;
};

const applyGeometryStroke = ({
  ctx,
  elementId,
  effectiveDrawingModifierStrokes,
  defaultColor,
  isSelected,
  isPrimarySelected,
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive,
  canvasTheme
}: {
  ctx: CanvasRenderingContext2D;
  elementId: ElementId;
  effectiveDrawingModifierStrokes?: ReadonlyMap<ElementId, DrawingModifierStroke>;
  defaultColor: string;
  isSelected: boolean;
  isPrimarySelected: boolean;
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
  canvasTheme: CanvasTheme;
}) => {
  const modifierStroke = effectiveDrawingModifierStrokes?.get(elementId);
  const documentColor = modifierStroke
    ? drawingModifierColor(modifierStroke, canvasTheme)
    : defaultColor;
  ctx.strokeStyle = strokeStyleForGeometry({
    isPointPickActive,
    isNumericReferencePickActive,
    isLinePickActive,
    defaultColor: documentColor,
    canvasTheme
  });
  ctx.lineWidth = lineWidthForGeometry({
    isSelected,
    isPrimarySelected,
    isPointPickActive,
    isNumericReferencePickActive,
    isLinePickActive,
    modifierWidth: modifierStroke?.widthPx
  });
  // Every geometry establishes its own dash state. Interaction emphasis may
  // change color/width, but never replaces the document's explicit dash style.
  ctx.setLineDash(modifierStroke ? drawingModifierDash(modifierStroke.style) : []);
};

export const renderCanvasGeometry = ({
  ctx,
  size,
  viewport,
  lines,
  arcs,
  curves,
  offsetLines,
  joinedPaths = [],
  images = [],
  points,
  visibleElementIds,
  selectedElementIdSet,
  selectedElementId,
  effectiveDrawingModifierStrokes,
  canvasTheme = LEGACY_CANVAS_THEME,
  showCanvasPoints,
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive,
  onImageAssetSettled
}: RenderCanvasGeometryArgs) => {
  drawGrid(ctx, size, viewport, canvasTheme);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const drawImages = () => { for (const item of images) {
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
      ctx.fillStyle = canvasTheme.background;
      ctx.strokeStyle = asset.status === "error" ? canvasTheme.error : canvasTheme.muted;
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
      ctx.strokeStyle = canvasTheme.selection;
      ctx.lineWidth = isPrimarySelected ? 1.5 : 1;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }};

  const drawLines = () => { for (const line of lines) {
    if (!visibleElementIds.has(line.elementId)) continue;
    const isSelected = selectedElementIdSet.has(line.elementId);
    const isPrimarySelected = line.elementId === selectedElementId;
    const start = worldToScreen(line.start, size, viewport);
    const end = worldToScreen(line.end, size, viewport);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    applyGeometryStroke({
      ctx,
      elementId: line.elementId,
      effectiveDrawingModifierStrokes,
      defaultColor: canvasTheme.foreground,
      isSelected,
      isPrimarySelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      canvasTheme
    });
    ctx.stroke();
  }};

  const drawArcs = () => { for (const arc of arcs) {
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
      arc.sweepAngleDeg >= 0
    );
    applyGeometryStroke({
      ctx,
      elementId: arc.elementId,
      effectiveDrawingModifierStrokes,
      defaultColor: canvasTheme.foreground,
      isSelected,
      isPrimarySelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      canvasTheme
    });
    ctx.stroke();
  }};

  const drawCurves = () => { for (const curve of curves) {
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
    applyGeometryStroke({
      ctx,
      elementId: curve.elementId,
      effectiveDrawingModifierStrokes,
      defaultColor: canvasTheme.foreground,
      isSelected,
      isPrimarySelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      canvasTheme
    });
    ctx.stroke();
  }};

  const drawSegmentedPaths = (paths: Array<ComputedOffsetLine | ComputedJoinedPath>) => { for (const line of paths) {
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
    applyGeometryStroke({
      ctx,
      elementId: line.elementId,
      effectiveDrawingModifierStrokes,
      defaultColor: canvasTheme.foreground,
      isSelected,
      isPrimarySelected,
      isPointPickActive,
      isNumericReferencePickActive,
      isLinePickActive,
      canvasTheme
    });
    ctx.stroke();
  }};
  const drawOffsetLines = () => drawSegmentedPaths(offsetLines);
  const drawJoinedPaths = () => drawSegmentedPaths(joinedPaths);

  const drawPoints = () => { for (const point of points) {
    if (!visibleElementIds.has(point.elementId)) continue;
    const isSelected = selectedElementIdSet.has(point.elementId);
    const isPrimarySelected = point.elementId === selectedElementId;
    if (!showCanvasPoints && !isSelected && !isPointPickActive) continue;
    const screen = worldToScreen(point, size, viewport);
    const pointStroke = effectiveDrawingModifierStrokes?.get(point.elementId);
    const pointColor = pointStroke
      ? drawingModifierColor(pointStroke, canvasTheme)
      : canvasTheme.foreground;
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
      ? canvasTheme.background
      : isNumericReferencePickActive || isLinePickActive
        ? canvasTheme.background
        : isSelected
          ? "transparent"
          : canvasTheme.background;
    ctx.strokeStyle = isPointPickActive
      ? canvasTheme.pickCandidate
      : isNumericReferencePickActive || isLinePickActive
        ? canvasTheme.pickCandidate
        : pointColor;
    const legacyPointWidth = isPointPickActive
      ? 2.5
      : isNumericReferencePickActive || isLinePickActive
        ? 1.25
        : isSelected
          ? 1.25
        : 2;
    const pointInteraction = isPointPickActive || isNumericReferencePickActive || isLinePickActive || isSelected || isPrimarySelected;
    ctx.lineWidth = pointStroke && pointInteraction
      ? Math.max(pointStroke.widthPx, legacyPointWidth)
      : pointStroke?.widthPx ?? legacyPointWidth;
    ctx.setLineDash(pointStroke ? drawingModifierDash(pointStroke.style) : []);
    ctx.fill();
    ctx.stroke();
  }};

  for (const kind of CANVAS_BASE_DRAW_ORDER) {
    if (kind === "image") drawImages();
    else if (kind === "line") drawLines();
    else if (kind === "arcLine") drawArcs();
    else if (kind === "bezierCurve") drawCurves();
    else if (kind === "offsetLine") drawOffsetLines();
    else if (kind === "joinedPath") drawJoinedPaths();
    else if (kind === "text") continue;
    else drawPoints();
  }
};
