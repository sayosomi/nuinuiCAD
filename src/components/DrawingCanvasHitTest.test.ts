import { describe, expect, it } from "vitest";
import {
  hitTestCanvasGeometry,
  hitTestCanvasGeometryAll,
  screenSpaceCumulativeLengthMidpoint,
  textHitBounds
} from "./DrawingCanvasHitTest";
import type { ComputedLine, ComputedPoint, ComputedPolyline } from "../types/geometry";

const point = (elementId: string, name: string): ComputedPoint => ({
  kind: "point",
  elementId,
  name,
  x: 0,
  y: 0
});

const line = (elementId: string, name: string): ComputedLine => ({
  kind: "line",
  elementId,
  name,
  startPointId: null,
  endPointId: null,
  start: point(`${elementId}-start`, "start"),
  end: point(`${elementId}-end`, "end"),
  length: 100,
  startAngleDeg: 0,
  endAngleDeg: 0,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 0
});

const polyline = (): ComputedPolyline => {
  const start = { kind: "point" as const, elementId: "polyline-start", name: "start", x: 0, y: 0 };
  const corner = { kind: "point" as const, elementId: "polyline-corner", name: "corner", x: 50, y: 0 };
  const end = { kind: "point" as const, elementId: "polyline-end", name: "end", x: 50, y: 50 };
  return {
    kind: "polyline",
    elementId: "polyline",
    name: "Outline",
    segments: [
      { kind: "line", start, end: corner, length: 50 },
      { kind: "line", start: corner, end, length: 50 }
    ],
    closed: false,
    start,
    end,
    length: 100,
    startTangentAngleDeg: 0,
    endTangentAngleDeg: 90
  };
};

const textHitTest = (fontSizePx: number) => hitTestCanvasGeometry({
  screen: { x: 20, y: 10 },
  lines: [],
  texts: [{
    text: { elementId: "label", text: "text" },
    screen: { x: 0, y: 0 },
    fontSizePx
  }],
  points: []
});

describe("text Canvas hit testing", () => {
  it("uses the rendered font size for text bounds", () => {
    expect(textHitTest(3)).toBeNull();
    expect(textHitTest(30)).toBe("label");
  });
});

describe("Canvas identity hit candidates", () => {
  it("selects the whole polyline when any non-zero segment is hit", () => {
    expect(hitTestCanvasGeometry({
      screen: { x: 50, y: 25 },
      lines: [],
      polylines: [{ polyline: polyline(), points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }] }],
      points: []
    })).toBe("polyline");
  });

  it("returns frontmost categories first, later items first, and deduplicates by element id", () => {
    const hits = hitTestCanvasGeometryAll({
      screen: { x: 50, y: 50 },
      lines: [
        { line: line("line-a", "A"), start: { x: 0, y: 50 }, end: { x: 100, y: 50 } },
        { line: line("line-b", "B"), start: { x: 0, y: 50 }, end: { x: 100, y: 50 } }
      ],
      points: [
        { point: point("line-b", "B point"), screen: { x: 50, y: 50 } },
        { point: point("point-c", "C"), screen: { x: 50, y: 50 } }
      ]
    });

    expect(hits).toEqual([
      { elementId: "point-c", kind: "point", name: "C" },
      { elementId: "line-b", kind: "point", name: "B point" },
      { elementId: "line-a", kind: "line", name: "A" }
    ]);
    expect(hitTestCanvasGeometry({
      screen: { x: 50, y: 50 },
      lines: [],
      points: [{ point: point("point-c", "C"), screen: { x: 50, y: 50 } }]
    })).toBe("point-c");
  });

  it("orders every base category from front to back and deduplicates after ordering", () => {
    const hits = hitTestCanvasGeometryAll({
      screen: { x: 20, y: 20 },
      images: [{ image: { elementId: "image", name: "Image" }, corners: [
        { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }
      ] }],
      lines: [{ line: line("line", "Line"), start: { x: 0, y: 20 }, end: { x: 40, y: 20 } }],
      texts: [{
        text: { elementId: "text", name: "Text", text: "Text" },
        screen: { x: 0, y: 0 },
        fontSizePx: 20
      }],
      points: [
        { point: point("point", "Point"), screen: { x: 20, y: 20 } },
        { point: point("line", "Line point"), screen: { x: 20, y: 20 } }
      ]
    });

    expect(hits.map(({ elementId }) => elementId)).toEqual(["line", "point", "text", "image"]);
    expect(hits[0]).toEqual({ elementId: "line", kind: "point", name: "Line point" });
  });
});

describe("screen-space identity representative helpers", () => {
  it("uses cumulative screen length and safe zero-length fallbacks", () => {
    expect(screenSpaceCumulativeLengthMidpoint([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 101, y: 0 }
    ])).toEqual({ x: 50.5, y: 0 });
    expect(screenSpaceCumulativeLengthMidpoint([])).toEqual({ x: 0, y: 0 });
    expect(screenSpaceCumulativeLengthMidpoint([
      { x: 4, y: 5 },
      { x: 4, y: 5 }
    ])).toEqual({ x: 4, y: 5 });
    expect(screenSpaceCumulativeLengthMidpoint([
      { x: 8, y: 9 },
      { x: 8, y: 9 },
      { x: 8, y: 9 },
      { x: 8, y: 9 }
    ])).toEqual({ x: 8, y: 9 });
    expect(screenSpaceCumulativeLengthMidpoint([], { x: 7, y: 8 })).toEqual({ x: 7, y: 8 });
  });

  it("shares text hit bounds for the label representative center", () => {
    const bounds = textHitBounds({ text: "abc\ndef", screen: { x: 10, y: 20 }, fontSizePx: 10 });
    expect({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }).toEqual({ x: 19.3, y: 32 });
  });
});
