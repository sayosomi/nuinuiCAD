import { describe, expect, it } from "vitest";
import {
  hitTestCanvasGeometry,
  hitTestCanvasGeometryAll,
  screenSpaceCumulativeLengthMidpoint,
  textHitBounds
} from "./DrawingCanvasHitTest";
import type { ComputedLine, ComputedPoint } from "../types/geometry";

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
  });

  it("shares text hit bounds for the label representative center", () => {
    const bounds = textHitBounds({ text: "abc\ndef", screen: { x: 10, y: 20 }, fontSizePx: 10 });
    expect({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }).toEqual({ x: 19.3, y: 32 });
  });
});
