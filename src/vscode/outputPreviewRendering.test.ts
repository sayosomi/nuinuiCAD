import { describe, expect, it } from "vitest";
import type { OutputPlan } from "../output/outputCore";
import {
  outputPreviewGuideLinesFor,
  outputPreviewPageRectsFor,
  outputPreviewPathDataFor
} from "./outputPreviewRendering";

const plan = {
  kind: "print",
  drawables: [{
    kind: "line",
    elementId: "line-1",
    name: "AB",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 10 },
    stroke: { widthMm: 1, style: "solid", colorHex: "#123456" }
  }],
  print: {
    paper: "a4",
    orientation: "portrait",
    paperWidthMm: 210,
    paperHeightMm: 297,
    overlapMm: 10,
    strideXmm: 190,
    strideYmm: 277,
    columns: 1,
    rows: 1,
    pages: [{
      index: 0,
      column: 0,
      row: 0,
      origin: { x: 100, y: 200 },
      guides: [
        { axis: "vertical", positionMm: 10 },
        { axis: "vertical", positionMm: 200 },
        { axis: "horizontal", positionMm: 10 },
        { axis: "horizontal", positionMm: 287 }
      ]
    }]
  }
} as unknown as OutputPlan;

describe("Output Preview rendering projection", () => {
  const size = { width: 500, height: 400 };
  const viewport = { panX: 0, panY: 0, zoom: 1 };

  it("projects physical page rectangles and page-local guides", () => {
    expect(outputPreviewPageRectsFor(plan, size, viewport)[0]).toEqual({
      x: 350,
      y: -297,
      width: 210,
      height: 297
    });
    const guides = outputPreviewGuideLinesFor(plan, size, viewport);
    expect(guides).toHaveLength(4);
    expect(guides[0]).toEqual({
      x1: 360,
      y1: 0,
      x2: 360,
      y2: -297
    });
  });

  it("keeps model coordinates Y-up at the SVG path boundary", () => {
    expect(outputPreviewPathDataFor(plan.drawables[0], size, viewport)).toBe("M 250 200 L 260 190");
  });
});
