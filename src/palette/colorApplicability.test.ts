import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { elementSupportsDisplayColor } from "./colorApplicability";

describe("elementSupportsDisplayColor", () => {
  it("allows display colors for drawing elements and groups", () => {
    const point: CadElement = {
      id: "point",
      name: "点",
      type: "freePoint",
      activity: "visible",
      x: 0,
      y: 0
    };
    const line: CadElement = {
      id: "line",
      name: "線",
      type: "line",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    };
    const group: CadElement = {
      id: "group",
      name: "グループ",
      type: "group",
      activity: "visible",
    };

    expect(elementSupportsDisplayColor(point)).toBe(true);
    expect(elementSupportsDisplayColor(line)).toBe(true);
    expect(elementSupportsDisplayColor(group)).toBe(true);
  });

  it("excludes modification elements that do not draw their own color", () => {
    const move: CadElement = {
      id: "move",
      name: "移動",
      type: "move",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      baseLineIds: ["line-a"]
    };

    expect(elementSupportsDisplayColor(move)).toBe(false);
  });
});
