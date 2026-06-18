import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCadStore } from "../state/useCadStore";
import type { CanvasViewport } from "../state/useCadStore";
import type { ComputedLine, ComputedPoint, EvaluationResult } from "../types/geometry";

type DrawingCanvasProps = {
  evaluation: EvaluationResult;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
};

type ViewportSize = {
  width: number;
  height: number;
};

type ScreenPoint = {
  x: number;
  y: number;
};

const GRID_STEP = 10;
const MAJOR_GRID_MULTIPLIER = 5;
const MIN_GRID_SPACING_PX = 8;
const WHEEL_ZOOM_BASE = 1.1;
const GRID_ENABLED = true;

const isPoint = (geometry: unknown): geometry is ComputedPoint =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "point";

const isLine = (geometry: unknown): geometry is ComputedLine =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "line";

const worldToScreen = (
  point: { x: number; y: number },
  size: ViewportSize,
  viewport: CanvasViewport
): ScreenPoint => ({
  x: size.width / 2 + viewport.panX + point.x * viewport.zoom,
  y: size.height / 2 + viewport.panY + point.y * viewport.zoom
});

const visibleWorldBounds = (size: ViewportSize, viewport: CanvasViewport) => ({
  minX: (0 - size.width / 2 - viewport.panX) / viewport.zoom,
  maxX: (size.width - size.width / 2 - viewport.panX) / viewport.zoom,
  minY: (0 - size.height / 2 - viewport.panY) / viewport.zoom,
  maxY: (size.height - size.height / 2 - viewport.panY) / viewport.zoom
});

const visibleGridStep = (zoom: number) => {
  let step = GRID_STEP;
  while (step * zoom < MIN_GRID_SPACING_PX) {
    step *= MAJOR_GRID_MULTIPLIER;
  }
  return step;
};

const drawGrid = (
  ctx: CanvasRenderingContext2D,
  size: ViewportSize,
  viewport: CanvasViewport
) => {
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.fillStyle = "#fbfbfa";
  ctx.fillRect(0, 0, size.width, size.height);

  if (!GRID_ENABLED) return;

  const step = visibleGridStep(viewport.zoom);
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
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const selectedElementIds = useCadStore((state) => state.selectedElementIds);
  const canvasViewport = useCadStore((state) => state.canvasViewport);
  const panCanvasViewport = useCadStore((state) => state.panCanvasViewport);
  const zoomCanvasViewportAt = useCadStore((state) => state.zoomCanvasViewportAt);
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
      ctx.strokeStyle = isSelected ? "#0f766e" : "#31322f";
      ctx.lineWidth = isPrimarySelected ? 3.5 : isSelected ? 3 : 2;
      ctx.stroke();
    }

    for (const point of points) {
      if (!visibleElementIds.has(point.elementId)) continue;
      const isSelected = selectedElementIdSet.has(point.elementId);
      const isPrimarySelected = point.elementId === selectedElementId;
      const screen = worldToScreen(point, viewportSize, canvasViewport);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, isPrimarySelected ? 5.5 : isSelected ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? "#0f766e" : "#ffffff";
      ctx.strokeStyle = "#31322f";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
  }, [canvasViewport, lines, points, selectedElementId, selectedElementIdSet, viewportSize, visibleElementIds]);

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

  const stopPanning = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panDragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      panDragRef.current = null;
      setIsPanning(false);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
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
        className={`canvas-viewport ${isPanning ? "is-panning" : ""}`}
        ref={canvasFocusRef}
        tabIndex={-1}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
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
            />
          ))}
          {overlayPoints.map(({ point, screen }) => (
            <g key={point.elementId}>
              <circle
                cx={screen.x}
                cy={screen.y}
                r={point.elementId === selectedElementId ? 8 : selectedElementIdSet.has(point.elementId) ? 7 : 6}
                className={selectedElementIdSet.has(point.elementId) ? "overlay-selected-point" : ""}
              />
              <text x={screen.x + 8} y={screen.y - 8}>
                {point.name}
              </text>
            </g>
          ))}
        </svg>
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
