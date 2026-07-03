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

const renderLineAndReturnLastStrokeStyle = ({
  elementColors = new Map(),
  selectedElementIds = [],
  selectedElementId = null,
  isLinePickActive = false
}: {
  elementColors?: Map<string, string>;
  selectedElementIds?: string[];
  selectedElementId?: string | null;
  isLinePickActive?: boolean;
}) => {
  let currentStrokeStyle = "";
  const strokeStyles: string[] = [];
  const ctx = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    stroke: vi.fn(() => {
      strokeStyles.push(currentStrokeStyle);
    }),
    set fillStyle(_value: string) {},
    set lineCap(_value: CanvasLineCap) {},
    set lineJoin(_value: CanvasLineJoin) {},
    set lineWidth(_value: number) {},
    set strokeStyle(value: string) {
      currentStrokeStyle = value;
    }
  } as unknown as CanvasRenderingContext2D;
  const start = point("start", 0, 0);
  const end = point("end", 100, 0);
  const elementId = "line";

  renderCanvasGeometry({
    ctx,
    size: { width: 500, height: 400 },
    viewport: { panX: 0, panY: 0, zoom: 1 },
    lines: [line(elementId, start, end)],
    arcs: [],
    curves: [],
    offsetLines: [],
    points: [],
    visibleElementIds: new Set([elementId]),
    selectedElementIdSet: new Set(selectedElementIds),
    selectedElementId,
    elementColors,
    showCanvasPoints: true,
    isPointPickActive: false,
    isNumericReferencePickActive: false,
    isLinePickActive
  });

  return strokeStyles.at(-1);
};

const renderPointAndReturnLastPaintStyles = ({
  elementColors = new Map(),
  selectedElementIds = [],
  selectedElementId = null,
  isLinePickActive = false
}: {
  elementColors?: Map<string, string>;
  selectedElementIds?: string[];
  selectedElementId?: string | null;
  isLinePickActive?: boolean;
}) => {
  let currentFillStyle = "";
  let currentStrokeStyle = "";
  const radii: number[] = [];
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const ctx = {
    arc: vi.fn((_x: number, _y: number, radius: number) => {
      radii.push(radius);
    }),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(() => {
      fillStyles.push(currentFillStyle);
    }),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    stroke: vi.fn(() => {
      strokeStyles.push(currentStrokeStyle);
    }),
    set fillStyle(value: string) {
      currentFillStyle = value;
    },
    set lineCap(_value: CanvasLineCap) {},
    set lineJoin(_value: CanvasLineJoin) {},
    set lineWidth(_value: number) {},
    set strokeStyle(value: string) {
      currentStrokeStyle = value;
    }
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
    selectedElementIdSet: new Set(selectedElementIds),
    selectedElementId,
    elementColors,
    showCanvasPoints: true,
    isPointPickActive: false,
    isNumericReferencePickActive: false,
    isLinePickActive
  });

  return {
    fillStyle: fillStyles.at(-1),
    radius: radii.at(-1),
    strokeStyle: strokeStyles.at(-1)
  };
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

  it("uses resolved element colors for normal geometry", () => {
    expect(
      renderLineAndReturnLastStrokeStyle({
        elementColors: new Map([["line", "#aa0000"]])
      })
    ).toBe("#aa0000");
  });

  it("uses resolved element colors for selected geometry", () => {
    expect(
      renderLineAndReturnLastStrokeStyle({
        elementColors: new Map([["line", "#aa0000"]]),
        selectedElementIds: ["line"],
        selectedElementId: "line"
      })
    ).toBe("#aa0000");
  });

  it("keeps pick emphasis above resolved element colors", () => {
    expect(
      renderLineAndReturnLastStrokeStyle({
        elementColors: new Map([["line", "#aa0000"]]),
        isLinePickActive: true
      })
    ).toBe("#0f766e");
  });

  it("uses resolved element colors for selected point markers", () => {
    expect(
      renderPointAndReturnLastPaintStyles({
        elementColors: new Map([["point", "#aa0000"]]),
        selectedElementIds: ["point"],
        selectedElementId: "point"
      })
    ).toEqual({
      fillStyle: "transparent",
      radius: 4,
      strokeStyle: "#aa0000"
    });
  });

  it("keeps point pick emphasis above resolved element colors", () => {
    expect(
      renderPointAndReturnLastPaintStyles({
        elementColors: new Map([["point", "#aa0000"]]),
        selectedElementIds: ["point"],
        selectedElementId: "point",
        isLinePickActive: true
      })
    ).toEqual({
      fillStyle: "#f6f7f3",
      radius: 3.5,
      strokeStyle: "#b7bbb0"
    });
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
