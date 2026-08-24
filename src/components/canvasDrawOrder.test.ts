import { describe, expect, it } from "vitest";
import {
  CANVAS_BASE_DRAW_ORDER,
  canvasBaseDrawRank,
  compareCanvasBaseDrawOrder
} from "./canvasDrawOrder";

describe("Canvas base draw order", () => {
  it("keeps the shared base category order and ranks later categories in front", () => {
    expect(CANVAS_BASE_DRAW_ORDER).toEqual([
      "image",
      "line",
      "polyline",
      "arcLine",
      "bezierCurve",
      "offsetLine",
      "text",
      "point"
    ]);
    expect(canvasBaseDrawRank("point")).toBeGreaterThan(canvasBaseDrawRank("line"));
    expect(canvasBaseDrawRank("line")).toBeGreaterThan(canvasBaseDrawRank("image"));
  });

  it("sorts front-to-back by category, then by later array item", () => {
    expect([
      { kind: "line" as const, arrayIndex: 0 },
      { kind: "point" as const, arrayIndex: 0 },
      { kind: "point" as const, arrayIndex: 1 },
      { kind: "image" as const, arrayIndex: 4 }
    ].sort(compareCanvasBaseDrawOrder)).toEqual([
      { kind: "point", arrayIndex: 1 },
      { kind: "point", arrayIndex: 0 },
      { kind: "line", arrayIndex: 0 },
      { kind: "image", arrayIndex: 4 }
    ]);
  });
});
