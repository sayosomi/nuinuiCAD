import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { elementSupportsDisplayColor } from "./colorApplicability";

describe("elementSupportsDisplayColor", () => {
  it("allows display colors for drawing elements and groups", () => {
    const point: CadElement = {
      id: "point",
      name: "点",
      type: "freePoint",
      visible: true,
      enabled: true,
      x: 0,
      y: 0
    };
    const line: CadElement = {
      id: "line",
      name: "線",
      type: "line",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    };
    const group: CadElement = {
      id: "group",
      name: "グループ",
      type: "group",
      visible: true,
      enabled: true,
      expanded: true
    };

    expect(elementSupportsDisplayColor(point)).toBe(true);
    expect(elementSupportsDisplayColor(line)).toBe(true);
    expect(elementSupportsDisplayColor(group)).toBe(true);
  });

  it("excludes variables and modification elements that do not draw their own color", () => {
    const variable: CadElement = {
      id: "variable",
      name: "変数",
      type: "variable",
      visible: true,
      enabled: true,
      scope: "global",
      valueMode: "expression",
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point: { mode: "reference", pointId: "point-a" },
      lineId: "line-a",
      expression: 10
    };
    const move: CadElement = {
      id: "move",
      name: "移動",
      type: "move",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      baseLineIds: ["line-a"]
    };

    expect(elementSupportsDisplayColor(variable)).toBe(false);
    expect(elementSupportsDisplayColor(move)).toBe(false);
  });
});
