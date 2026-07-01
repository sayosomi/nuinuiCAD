import { describe, expect, it, vi } from "vitest";
import type { ComputedLine, ComputedPoint } from "../types/geometry";
import { renderCanvasGeometry } from "./canvasRenderer";

const point = (elementId: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId,
  name: elementId,
  x,
  y
});

const line = (
  elementId: string,
  start: ComputedPoint,
  end: ComputedPoint
): ComputedLine => ({
  kind: "line",
  elementId,
  name: elementId,
  startPointId: start.elementId,
  endPointId: end.elementId,
  start,
  end,
  length: Math.hypot(end.x - start.x, end.y - start.y),
  startAngleDeg: 0,
  endAngleDeg: 180,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180
});

const renderLineAndReturnLastStrokeWidth = ({
  zoom,
  selectedElementIds = [],
  selectedElementId = null
}: {
  zoom: number;
  selectedElementIds?: string[];
  selectedElementId?: string | null;
}) => {
  let currentLineWidth = 0;
  const strokeLineWidths: number[] = [];
  const ctx = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    stroke: vi.fn(() => {
      strokeLineWidths.push(currentLineWidth);
    }),
    set fillStyle(_value: string) {},
    set lineCap(_value: CanvasLineCap) {},
    set lineJoin(_value: CanvasLineJoin) {},
    set lineWidth(value: number) {
      currentLineWidth = value;
    },
    set strokeStyle(_value: string) {}
  } as unknown as CanvasRenderingContext2D;
  const start = point("start", 0, 0);
  const end = point("end", 100, 0);
  const elementId = "line";

  renderCanvasGeometry({
    ctx,
    size: { width: 500, height: 400 },
    viewport: { panX: 0, panY: 0, zoom },
    lines: [line(elementId, start, end)],
    arcs: [],
    curves: [],
    offsetLines: [],
    points: [],
    visibleElementIds: new Set([elementId]),
    selectedElementIdSet: new Set(selectedElementIds),
    selectedElementId,
    showCanvasPoints: true,
    isPointPickActive: false,
    isNumericReferencePickActive: false,
    isLinePickActive: false
  });

  return strokeLineWidths.at(-1);
};

describe("renderCanvasGeometry", () => {
  it("draws normal geometry with a thin screen-space line width", () => {
    expect(renderLineAndReturnLastStrokeWidth({ zoom: 1 })).toBe(1);
  });

  it("keeps selected geometry subtle while still emphasized", () => {
    expect(
      renderLineAndReturnLastStrokeWidth({
        zoom: 1,
        selectedElementIds: ["line"],
        selectedElementId: "line"
      })
    ).toBe(1.2);
  });

  it("does not scale geometry line width with canvas zoom", () => {
    const normalWidth = renderLineAndReturnLastStrokeWidth({ zoom: 1 });
    const zoomedWidth = renderLineAndReturnLastStrokeWidth({ zoom: 4 });

    expect(zoomedWidth).toBe(normalWidth);
  });

  it("omits point markers when point display is off", () => {
    const ctx = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
      set fillStyle(_value: string) {},
      set lineCap(_value: CanvasLineCap) {},
      set lineJoin(_value: CanvasLineJoin) {},
      set lineWidth(_value: number) {},
      set strokeStyle(_value: string) {}
    } as unknown as CanvasRenderingContext2D;
    const elementId = "point";

    renderCanvasGeometry({
      ctx,
      size: { width: 500, height: 400 },
      viewport: { panX: 0, panY: 0, zoom: 1 },
      lines: [],
      arcs: [],
      curves: [],
      offsetLines: [],
      points: [point(elementId, 0, 0)],
      visibleElementIds: new Set([elementId]),
      selectedElementIdSet: new Set(),
      selectedElementId: null,
      showCanvasPoints: false,
      isPointPickActive: false,
      isNumericReferencePickActive: false,
      isLinePickActive: false
    });

    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it("keeps selected points visible when point display is off", () => {
    const ctx = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
      set fillStyle(_value: string) {},
      set lineCap(_value: CanvasLineCap) {},
      set lineJoin(_value: CanvasLineJoin) {},
      set lineWidth(_value: number) {},
      set strokeStyle(_value: string) {}
    } as unknown as CanvasRenderingContext2D;
    const elementId = "point";

    renderCanvasGeometry({
      ctx,
      size: { width: 500, height: 400 },
      viewport: { panX: 0, panY: 0, zoom: 1 },
      lines: [],
      arcs: [],
      curves: [],
      offsetLines: [],
      points: [point(elementId, 0, 0)],
      visibleElementIds: new Set([elementId]),
      selectedElementIdSet: new Set([elementId]),
      selectedElementId: elementId,
      showCanvasPoints: false,
      isPointPickActive: false,
      isNumericReferencePickActive: false,
      isLinePickActive: false
    });

    expect(ctx.arc).toHaveBeenCalled();
  });
});
