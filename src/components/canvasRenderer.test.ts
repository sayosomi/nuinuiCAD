import { describe, expect, it, vi } from "vitest";
import type {
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPolyline,
  ComputedPoint,
  DrawingModifierStroke
} from "../types/geometry";
import { LEGACY_CANVAS_THEME, type CanvasTheme } from "./canvasTheme";
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

const polyline = (elementId: string, start: ComputedPoint, corner: ComputedPoint, end: ComputedPoint): ComputedPolyline => ({
  kind: "polyline",
  elementId,
  name: elementId,
  segments: [
    { kind: "line", start, end: corner, length: Math.hypot(corner.x - start.x, corner.y - start.y) },
    { kind: "line", start: corner, end, length: Math.hypot(end.x - corner.x, end.y - corner.y) }
  ],
  closed: false,
  start,
  end,
  length: Math.hypot(corner.x - start.x, corner.y - start.y) + Math.hypot(end.x - corner.x, end.y - corner.y),
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 90
});

const strokeContext = () => {
  let currentLineWidth = 0;
  let currentStrokeStyle = "";
  let currentLineDash: number[] = [];
  const snapshots: Array<{ lineWidth: number; strokeStyle: string; lineDash: number[] }> = [];
  const ctx = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    bezierCurveTo: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    setLineDash: vi.fn((dash: number[]) => {
      currentLineDash = [...dash];
    }),
    stroke: vi.fn(() => {
      snapshots.push({ lineWidth: currentLineWidth, strokeStyle: currentStrokeStyle, lineDash: [...currentLineDash] });
    }),
    set fillStyle(_value: string) {},
    set lineCap(_value: CanvasLineCap) {},
    set lineJoin(_value: CanvasLineJoin) {},
    set lineWidth(value: number) {
      currentLineWidth = value;
    },
    set strokeStyle(value: string) {
      currentStrokeStyle = value;
    }
  } as unknown as CanvasRenderingContext2D;
  return { ctx, snapshots };
};

const renderWithStroke = ({
  stroke,
  lines = [],
  arcs = [],
  curves = [],
  offsetLines = [],
  polylines = [],
  points = [],
  zoom = 1,
  selectedElementIds = [],
  selectedElementId = null,
  isLinePickActive = false,
  canvasTheme = LEGACY_CANVAS_THEME
}: {
  stroke: DrawingModifierStroke;
  lines?: ComputedLine[];
  arcs?: ComputedArcLine[];
  curves?: ComputedBezierCurve[];
  offsetLines?: ComputedOffsetLine[];
  polylines?: ComputedPolyline[];
  points?: ComputedPoint[];
  zoom?: number;
  selectedElementIds?: string[];
  selectedElementId?: string | null;
  isLinePickActive?: boolean;
  canvasTheme?: CanvasTheme;
}) => {
  const { ctx, snapshots } = strokeContext();
  const geometryIds = [...lines, ...arcs, ...curves, ...offsetLines, ...polylines, ...points].map((item) => item.elementId);
  renderCanvasGeometry({
    ctx,
    size: { width: 500, height: 400 },
    viewport: { panX: 0, panY: 0, zoom },
    lines,
    arcs,
    curves,
    offsetLines,
    polylines,
    points,
    visibleElementIds: new Set(geometryIds),
    selectedElementIdSet: new Set(selectedElementIds),
    selectedElementId,
    effectiveDrawingModifierStrokes: new Map(geometryIds.map((id) => [id, stroke])),
    canvasTheme,
    showCanvasPoints: true,
    isPointPickActive: false,
    isNumericReferencePickActive: false,
    isLinePickActive
  });
  return snapshots.at(-1);
};

const renderLineAndReturnLastStrokeWidth = ({
  zoom,
  selectedElementIds = [],
  selectedElementId = null,
  canvasTheme = LEGACY_CANVAS_THEME
}: {
  zoom: number;
  selectedElementIds?: string[];
  selectedElementId?: string | null;
  canvasTheme?: CanvasTheme;
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
    setLineDash: vi.fn(),
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
    canvasTheme,
    showCanvasPoints: true,
    isPointPickActive: false,
    isNumericReferencePickActive: false,
    isLinePickActive: false
  });

  return strokeLineWidths.at(-1);
};

const renderLineAndReturnLastStrokeStyle = ({
  selectedElementIds = [],
  selectedElementId = null,
  isLinePickActive = false,
  canvasTheme = LEGACY_CANVAS_THEME
}: {
  selectedElementIds?: string[];
  selectedElementId?: string | null;
  isLinePickActive?: boolean;
  canvasTheme?: CanvasTheme;
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
    setLineDash: vi.fn(),
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
    canvasTheme,
    showCanvasPoints: true,
    isPointPickActive: false,
    isNumericReferencePickActive: false,
    isLinePickActive
  });

  return strokeStyles.at(-1);
};

const renderPointAndReturnLastPaintStyles = ({
  selectedElementIds = [],
  selectedElementId = null,
  isLinePickActive = false
}: {
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
    setLineDash: vi.fn(),
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
  const reverseEquivalentArcs = () => {
    const center = point("center", 0, 0);
    const positive: ComputedArcLine = {
      kind: "arcLine", elementId: "positive", name: "positive", centerPointId: null, center,
      start: point("positive-start", 10, 0), end: point("positive-end", 0, 10), radius: 10,
      startAngleDeg: 0, endAngleDeg: 90, startTangentAngleDeg: 90, endTangentAngleDeg: 180,
      sweepAngleDeg: 90, length: 5 * Math.PI
    };
    const negative: ComputedArcLine = {
      kind: "arcLine", elementId: "negative", name: "negative", centerPointId: null, center,
      start: point("negative-start", 0, 10), end: point("negative-end", 10, 0), radius: 10,
      startAngleDeg: 90, endAngleDeg: 0, startTangentAngleDeg: 180, endTangentAngleDeg: 90,
      sweepAngleDeg: -90, length: 5 * Math.PI
    };
    return { positive, negative };
  };

  const renderArc = (arc: ComputedArcLine) => {
    const { ctx } = strokeContext();
    renderCanvasGeometry({
      ctx,
      size: { width: 500, height: 400 },
      viewport: { panX: 0, panY: 0, zoom: 1 },
      lines: [],
      arcs: [arc],
      curves: [],
      offsetLines: [],
      points: [],
      visibleElementIds: new Set([arc.elementId]),
      selectedElementIdSet: new Set(),
      selectedElementId: null,
      showCanvasPoints: true,
      isPointPickActive: false,
      isNumericReferencePickActive: false,
      isLinePickActive: false
    });
    return ctx;
  };

  it("renders a top-level positive arc sweep counterclockwise", () => {
    const { positive } = reverseEquivalentArcs();
    const ctx = renderArc(positive);

    expect(ctx.arc).toHaveBeenCalledWith(250, 200, 10, -0, -Math.PI / 2, true);
  });

  it("renders a reverse-equivalent top-level negative arc sweep clockwise", () => {
    const { positive, negative } = reverseEquivalentArcs();
    expect(positive.start).toMatchObject({ x: negative.end.x, y: negative.end.y });
    expect(positive.end).toMatchObject({ x: negative.start.x, y: negative.start.y });

    const ctx = renderArc(negative);

    expect(ctx.arc).toHaveBeenCalledWith(250, 200, 10, -Math.PI / 2, -0, false);
  });

  it("applies fixed and temporary theme-role modifier strokes to supported geometry", () => {
    const start = point("start", 0, 0);
    const end = point("end", 100, 0);
    const fixed = renderWithStroke({
      stroke: { widthPx: 2.5, style: "dashed", color: { kind: "fixed", hex: "#123456" } },
      lines: [line("line", start, end)]
    });
    const role = renderWithStroke({
      stroke: { widthPx: 1.5, style: "solid", color: { kind: "themeRole", role: "warning" } },
      lines: [line("line", start, end)]
    });

    expect(fixed).toEqual({ lineWidth: 2.5, strokeStyle: "#123456", lineDash: [6, 4] });
    expect(role).toEqual({ lineWidth: 1.5, strokeStyle: "#73320d", lineDash: [] });
  });

  it("resolves semantic modifier roles from CanvasTheme while preserving fixed colors", () => {
    const start = point("start", 0, 0);
    const end = point("end", 100, 0);
    const theme = { ...LEGACY_CANVAS_THEME, warning: "#custom-warning", foreground: "#custom-foreground" };

    expect(renderWithStroke({
      stroke: { widthPx: 1, style: "solid", color: { kind: "themeRole", role: "warning" } },
      lines: [line("line", start, end)],
      canvasTheme: theme
    })).toMatchObject({ strokeStyle: "#custom-warning" });
    expect(renderWithStroke({
      stroke: { widthPx: 1, style: "solid", color: { kind: "fixed", hex: "#123456" } },
      lines: [line("line", start, end)],
      canvasTheme: theme
    })).toMatchObject({ strokeStyle: "#123456" });
    expect(renderLineAndReturnLastStrokeStyle({ canvasTheme: theme })).toBe("#custom-foreground");
  });

  it("uses CanvasTheme values for the background, grid, and axis", () => {
    let currentFillStyle = "";
    let currentStrokeStyle = "";
    const fillStyles: string[] = [];
    const strokeStyles: string[] = [];
    const theme = {
      ...LEGACY_CANVAS_THEME,
      background: "#background",
      minorGrid: "#minor",
      majorGrid: "#major",
      axis: "#axis"
    };
    const ctx = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(() => fillStyles.push(currentFillStyle)),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      setLineDash: vi.fn(),
      stroke: vi.fn(() => strokeStyles.push(currentStrokeStyle)),
      set fillStyle(value: string) { currentFillStyle = value; },
      set lineCap(_value: CanvasLineCap) {},
      set lineJoin(_value: CanvasLineJoin) {},
      set lineWidth(_value: number) {},
      set strokeStyle(value: string) { currentStrokeStyle = value; }
    } as unknown as CanvasRenderingContext2D;

    renderCanvasGeometry({
      ctx,
      size: { width: 500, height: 400 },
      viewport: { panX: 0, panY: 0, zoom: 1 },
      lines: [],
      arcs: [],
      curves: [],
      offsetLines: [],
      points: [],
      visibleElementIds: new Set(),
      selectedElementIdSet: new Set(),
      selectedElementId: null,
      canvasTheme: theme,
      showCanvasPoints: true,
      isPointPickActive: false,
      isNumericReferencePickActive: false,
      isLinePickActive: false
    });

    expect(fillStyles).toEqual(["#background"]);
    expect(strokeStyles).toContain("#minor");
    expect(strokeStyles).toContain("#major");
    expect(strokeStyles).toContain("#axis");
  });

  it("uses solid, dashed, and dotted document dash styles without zoom scaling", () => {
    const start = point("start", 0, 0);
    const end = point("end", 100, 0);
    for (const [style, dash] of [["solid", []], ["dashed", [6, 4]], ["dotted", [1, 3]]] as const) {
      expect(renderWithStroke({
        stroke: { widthPx: 2, style, color: { kind: "fixed", hex: "#123456" } },
        lines: [line("line", start, end)],
        zoom: 4
      })).toMatchObject({ lineWidth: 2, lineDash: dash });
    }
  });

  it("applies modifier strokes to line, arc, Bezier, offset line, and normal point outline", () => {
    const start = point("start", 0, 0);
    const end = point("end", 10, 0);
    const center = point("center", 0, 0);
    const arc: ComputedArcLine = {
      kind: "arcLine", elementId: "arc", name: "arc", centerPointId: null, center,
      start: point("arc-start", 10, 0), end: point("arc-end", 0, 10), radius: 10,
      startAngleDeg: 0, endAngleDeg: 90, startTangentAngleDeg: 90, endTangentAngleDeg: 180,
      sweepAngleDeg: 90, length: 15
    };
    const curve: ComputedBezierCurve = {
      kind: "bezierCurve", elementId: "curve", name: "curve", startPointId: "start", endPointId: "end",
      intermediatePointIds: [], segments: [{
        startPointId: "start", endPointId: "end", start, control1: { x: 2, y: 3 },
        control2: { x: 8, y: 3 }, end
      }], length: 10, startTangentAngleDeg: 0, endTangentAngleDeg: 0,
      startHandleAngleDeg: 0, startHandleLength: 1, endHandleAngleDeg: 0, endHandleLength: 1
    };
    const offsetLine: ComputedOffsetLine = {
      kind: "offsetLine", elementId: "offset", name: "offset", baseLineIds: [], start, end,
      segments: [{ kind: "line", start, end, length: 10 }], closed: false, length: 10,
      startTangentAngleDeg: 0, endTangentAngleDeg: 0
    };
    const stroke = { widthPx: 2, style: "dotted" as const, color: { kind: "fixed" as const, hex: "#abcdef" } };

    for (const geometry of [
      { lines: [line("line", start, end)] },
      { arcs: [arc] },
      { curves: [curve] },
      { offsetLines: [offsetLine] },
      { polylines: [polyline("polyline", start, point("corner", 10, 0), end)] },
      { points: [point("point", 0, 0)] }
    ]) {
      expect(renderWithStroke({ stroke, ...geometry })).toEqual({
        lineWidth: 2,
        strokeStyle: "#abcdef",
        lineDash: [1, 3]
      });
    }
  });

  it("keeps interaction emphasis above, but never below, modifier width and preserves dash", () => {
    const start = point("start", 0, 0);
    const end = point("end", 100, 0);
    expect(renderWithStroke({
      stroke: { widthPx: 0.5, style: "dashed", color: { kind: "fixed", hex: "#123456" } },
      lines: [line("line", start, end)],
      selectedElementIds: ["line"],
      selectedElementId: "line"
    })).toEqual({ lineWidth: 1.2, strokeStyle: "#123456", lineDash: [6, 4] });
    expect(renderWithStroke({
      stroke: { widthPx: 3, style: "dotted", color: { kind: "fixed", hex: "#123456" } },
      lines: [line("line", start, end)],
      isLinePickActive: true
    })).toEqual({ lineWidth: 3, strokeStyle: "#0f766e", lineDash: [1, 3] });
  });

  it("draws origin axes as background guide dashes without leaking dashes to geometry", () => {
    let currentLineDash: number[] = [];
    const strokeLineDashes: number[][] = [];
    const ctx = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      setLineDash: vi.fn((dash: number[]) => {
        currentLineDash = dash;
      }),
      stroke: vi.fn(() => {
        strokeLineDashes.push([...currentLineDash]);
      }),
      set fillStyle(_value: string) {},
      set lineCap(_value: CanvasLineCap) {},
      set lineJoin(_value: CanvasLineJoin) {},
      set lineWidth(_value: number) {},
      set strokeStyle(_value: string) {}
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
      selectedElementIdSet: new Set(),
      selectedElementId: null,
      showCanvasPoints: true,
      isPointPickActive: false,
      isNumericReferencePickActive: false,
      isLinePickActive: false
    });

    expect(strokeLineDashes).toContainEqual([6, 4]);
    expect(strokeLineDashes.at(-1)).toEqual([]);
  });

  it("resets the grid dash when reusing a context after dashed geometry", () => {
    let currentLineDash: number[] = [];
    const strokeLineDashes: number[][] = [];
    const ctx = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      setLineDash: vi.fn((dash: number[]) => {
        currentLineDash = [...dash];
      }),
      stroke: vi.fn(() => {
        strokeLineDashes.push([...currentLineDash]);
      }),
      set fillStyle(_value: string) {},
      set lineCap(_value: CanvasLineCap) {},
      set lineJoin(_value: CanvasLineJoin) {},
      set lineWidth(_value: number) {},
      set strokeStyle(_value: string) {}
    } as unknown as CanvasRenderingContext2D;
    const start = point("start", 0, 0);
    const end = point("end", 100, 0);
    const elementId = "line";
    const renderArgs = {
      ctx,
      size: { width: 500, height: 400 },
      viewport: { panX: 1_000, panY: -1_000, zoom: 1 },
      lines: [line(elementId, start, end)],
      arcs: [],
      curves: [],
      offsetLines: [],
      points: [],
      visibleElementIds: new Set([elementId]),
      selectedElementIdSet: new Set<string>(),
      selectedElementId: null,
      effectiveDrawingModifierStrokes: new Map([
        [elementId, { widthPx: 2, style: "dashed" as const, color: { kind: "fixed" as const, hex: "#123456" } }]
      ]),
      showCanvasPoints: true,
      isPointPickActive: false,
      isNumericReferencePickActive: false,
      isLinePickActive: false
    };

    renderCanvasGeometry(renderArgs);
    const secondRenderStart = strokeLineDashes.length;
    renderCanvasGeometry({ ...renderArgs, lines: [], effectiveDrawingModifierStrokes: new Map() });
    const secondRenderGridStrokes = strokeLineDashes.slice(secondRenderStart);

    expect(strokeLineDashes.slice(0, secondRenderStart)).toContainEqual([6, 4]);
    expect(secondRenderGridStrokes.length).toBeGreaterThan(0);
    expect(secondRenderGridStrokes).toEqual(
      secondRenderGridStrokes.map(() => [])
    );
  });

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

  it("defaults built-in geometry to the semantic Canvas foreground", () => {
    expect(renderLineAndReturnLastStrokeStyle({})).toBe("#31322f");
  });

  it("keeps selected built-in geometry on the semantic Canvas foreground", () => {
    expect(
      renderLineAndReturnLastStrokeStyle({
        selectedElementIds: ["line"],
        selectedElementId: "line"
      })
    ).toBe("#31322f");
  });

  it("uses the semantic pick candidate color for line picking", () => {
    expect(
      renderLineAndReturnLastStrokeStyle({
        isLinePickActive: true
      })
    ).toBe("#0f766e");
  });

  it("uses the semantic Canvas foreground for selected point markers", () => {
    expect(
      renderPointAndReturnLastPaintStyles({
        selectedElementIds: ["point"],
        selectedElementId: "point"
      })
    ).toEqual({
      fillStyle: "transparent",
      radius: 3.5,
      strokeStyle: "#31322f"
    });
  });

  it("uses the semantic pick candidate color for point picking", () => {
    expect(
      renderPointAndReturnLastPaintStyles({
        selectedElementIds: ["point"],
        selectedElementId: "point",
        isLinePickActive: true
      })
    ).toEqual({
      fillStyle: "#fbfbfa",
      radius: 3.5,
      strokeStyle: "#0f766e"
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
      setLineDash: vi.fn(),
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
      setLineDash: vi.fn(),
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
