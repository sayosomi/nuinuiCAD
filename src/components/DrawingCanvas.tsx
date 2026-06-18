import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import { useCadStore } from "../state/useCadStore";
import type { ComputedLine, ComputedPoint, EvaluationResult } from "../types/geometry";

type DrawingCanvasProps = {
  evaluation: EvaluationResult;
  canvasFocusRef: RefObject<HTMLDivElement | null>;
};

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 700;
const GRID_STEP = 10;
const MAJOR_GRID_STEP = 50;

const isPoint = (geometry: unknown): geometry is ComputedPoint =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "point";

const isLine = (geometry: unknown): geometry is ComputedLine =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "line";

const drawGrid = (ctx: CanvasRenderingContext2D) => {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = "#fbfbfa";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  for (let x = 0; x <= CANVAS_WIDTH; x += GRID_STEP) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_HEIGHT);
    ctx.strokeStyle = x % MAJOR_GRID_STEP === 0 ? "#d6d8d2" : "#eceee8";
    ctx.lineWidth = x % MAJOR_GRID_STEP === 0 ? 1 : 0.5;
    ctx.stroke();
  }

  for (let y = 0; y <= CANVAS_HEIGHT; y += GRID_STEP) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_WIDTH, y);
    ctx.strokeStyle = y % MAJOR_GRID_STEP === 0 ? "#d6d8d2" : "#eceee8";
    ctx.lineWidth = y % MAJOR_GRID_STEP === 0 ? 1 : 0.5;
    ctx.stroke();
  }
};

export const DrawingCanvas = ({ evaluation, canvasFocusRef }: DrawingCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const visibleElementIds = useMemo(
    () => new Set(elements.filter((element) => element.visible).map((element) => element.id)),
    [elements]
  );
  const geometries = useMemo(
    () => Array.from(evaluation.computedGeometry.values()),
    [evaluation.computedGeometry]
  );
  const lines = geometries.filter(isLine);
  const points = geometries.filter(isPoint);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = CANVAS_WIDTH * ratio;
    canvas.height = CANVAS_HEIGHT * ratio;
    canvas.style.width = `${CANVAS_WIDTH}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    drawGrid(ctx);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const line of lines) {
      if (!visibleElementIds.has(line.elementId)) continue;
      ctx.beginPath();
      ctx.moveTo(line.start.x, line.start.y);
      ctx.lineTo(line.end.x, line.end.y);
      ctx.strokeStyle = line.elementId === selectedElementId ? "#0f766e" : "#31322f";
      ctx.lineWidth = line.elementId === selectedElementId ? 3 : 2;
      ctx.stroke();
    }

    for (const point of points) {
      if (!visibleElementIds.has(point.elementId)) continue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.elementId === selectedElementId ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = point.elementId === selectedElementId ? "#0f766e" : "#ffffff";
      ctx.strokeStyle = "#31322f";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
  }, [lines, points, selectedElementId, visibleElementIds]);

  return (
    <section className="canvas-panel">
      <div className="canvas-toolbar">
        <div>
          <h2>作図キャンバス</h2>
          <p>1px = 1mm / Canvas描画 + SVGオーバーレイ</p>
        </div>
        <span>{CANVAS_WIDTH}mm x {CANVAS_HEIGHT}mm</span>
      </div>
      <div className="canvas-viewport" ref={canvasFocusRef} tabIndex={-1}>
        <canvas ref={canvasRef} aria-label="CAD drawing canvas" />
        <svg
          className="drawing-overlay"
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          aria-hidden="true"
        >
          {lines
            .filter((line) => visibleElementIds.has(line.elementId))
            .map((line) => (
              <line
                key={line.elementId}
                x1={line.start.x}
                y1={line.start.y}
                x2={line.end.x}
                y2={line.end.y}
                className={line.elementId === selectedElementId ? "overlay-selected-line" : ""}
              />
            ))}
          {points
            .filter((point) => visibleElementIds.has(point.elementId))
            .map((point) => (
              <g key={point.elementId}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={point.elementId === selectedElementId ? 8 : 6}
                  className={point.elementId === selectedElementId ? "overlay-selected-point" : ""}
                />
                <text x={point.x + 8} y={point.y - 8}>
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
      </div>
    </section>
  );
};
