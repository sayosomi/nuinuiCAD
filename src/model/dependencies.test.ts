import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import {
  getDependencyJumpTargets,
  getDependencySummary,
  getDirectChildren,
  getDirectParentIds
} from "./dependencies";

const elements: CadElement[] = [
  {
    id: "a",
    name: "点A",
    type: "freePoint",
    visible: true,
    enabled: true,
    x: 0,
    y: 0
  },
  {
    id: "b",
    name: "点B",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPointId: "a",
    dx: 10,
    dy: 0
  },
  {
    id: "c",
    name: "点C",
    type: "polarOffsetPoint",
    visible: true,
    enabled: true,
    fromPointId: "b",
    angleDeg: 0,
    distance: 10
  },
  {
    id: "ab",
    name: "線AB",
    type: "line",
    visible: true,
    enabled: true,
    startPoint: { mode: "reference", pointId: "a" },
    endPoint: { mode: "reference", pointId: "b" }
  },
  {
    id: "bc",
    name: "線BC",
    type: "line",
    visible: true,
    enabled: true,
    startPoint: { mode: "reference", pointId: "b" },
    endPoint: { mode: "reference", pointId: "c" }
  }
];

describe("dependencies", () => {
  it("returns direct parent ids by element type", () => {
    expect(getDirectParentIds(elements[0])).toEqual([]);
    expect(getDirectParentIds(elements[1])).toEqual(["a"]);
    expect(getDirectParentIds(elements[3])).toEqual(["a", "b"]);
  });

  it("returns Bezier curve point references as direct parent ids", () => {
    const curve: CadElement = {
      id: "curve",
      name: "曲線",
      type: "bezierCurve",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "a" },
      startHandleAngleDeg: 0,
      startHandleLength: 20,
      intermediatePoints: [
        {
          id: "mid-1",
          point: { mode: "reference", pointId: "b" },
          handleAngleDeg: 0,
          incomingHandleLength: 10,
          outgoingHandleLength: 10
        }
      ],
      endPoint: { mode: "reference", pointId: "c" },
      endHandleAngleDeg: 0,
      endHandleLength: 20
    };

    expect(getDirectParentIds(curve)).toEqual(["a", "b", "c"]);
  });

  it("returns arc line center and numeric expression references as direct parent ids", () => {
    const arc: CadElement = {
      id: "arc",
      name: "円弧",
      type: "arcLine",
      visible: true,
      enabled: true,
      centerPoint: { mode: "reference", pointId: "a" },
      radius: { kind: "expression", expression: "bc.length" },
      startAngleDeg: 0,
      endAngleDeg: { kind: "expression", expression: "ab.startAngleDeg + 90" }
    };

    expect(getDirectParentIds(arc)).toEqual(["a", "bc", "ab"]);
  });

  it("returns three-point arc point and numeric expression references as direct parent ids", () => {
    const arc: CadElement = {
      id: "three-point-arc",
      name: "三点円弧",
      type: "threePointArcLine",
      visible: true,
      enabled: true,
      point1: { mode: "reference", pointId: "a" },
      point2: { mode: "reference", pointId: "b" },
      point3: { mode: "reference", pointId: "c" },
      startAngleDeg: { kind: "expression", expression: "ab.startAngleDeg" },
      endAngleDeg: { kind: "expression", expression: "bc.endAngleDeg" }
    };

    expect(getDirectParentIds(arc)).toEqual(["a", "b", "c", "ab", "bc"]);
  });

  it("returns division point endpoints and active numeric expression references as direct parent ids", () => {
    const point: CadElement = {
      id: "division",
      name: "分点",
      type: "divisionPoint",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "a" },
      endPoint: { mode: "reference", pointId: "b" },
      placementMode: "ratio",
      distance: { kind: "expression", expression: "bc.length" },
      ratio: { kind: "expression", expression: "ab.length / 100" }
    };

    expect(getDirectParentIds(point)).toEqual(["a", "b", "ab"]);
  });

  it("returns direct coordinate expression references as parent ids", () => {
    const directLine: CadElement = {
      id: "direct",
      name: "直接線",
      type: "line",
      visible: true,
      enabled: true,
      startPoint: { mode: "coordinate", x: { kind: "expression", expression: "bc.length" }, y: 0 },
      endPoint: { mode: "coordinate", x: 10, y: 0 }
    };

    expect(getDirectParentIds(directLine)).toEqual(["bc"]);
  });

  it("returns derived point references as direct parent ids", () => {
    const derivedLine: CadElement = {
      id: "derived",
      name: "派生線",
      type: "line",
      visible: true,
      enabled: true,
      startPoint: { mode: "derived", elementId: "ab", pointKey: "start" },
      endPoint: { mode: "derived", elementId: "bc", pointKey: "end" }
    };

    expect(getDirectParentIds(derivedLine)).toEqual(["ab", "bc"]);
  });

  it("returns derived base point references for offset points", () => {
    const derivedOffset: CadElement = {
      id: "derived-offset",
      name: "派生オフセット",
      type: "offsetPoint",
      visible: true,
      enabled: true,
      fromPoint: { mode: "derived", elementId: "ab", pointKey: "end" },
      dx: 10,
      dy: 0
    };

    expect(getDirectParentIds(derivedOffset)).toEqual(["ab"]);
  });

  it("returns direct children", () => {
    expect(getDirectChildren("b", elements).map((element) => element.id)).toEqual([
      "c",
      "ab",
      "bc"
    ]);
  });

  it("summarizes direct relationships and recursive counts without duplicates", () => {
    const summary = getDependencySummary(elements[4], elements);

    expect(summary.parents.map((parent) => parent.element?.id)).toEqual(["b", "c"]);
    expect(summary.parents.map((parent) => parent.ancestorCount)).toEqual([1, 2]);
    expect(summary.children).toEqual([]);
    expect(summary.ancestorCount).toBe(3);
    expect(summary.descendantCount).toBe(0);
  });

  it("summarizes child descendant counts per direct child without duplicates", () => {
    const summary = getDependencySummary(elements[1], elements);

    expect(summary.children.map((child) => child.element.id)).toEqual(["c", "ab", "bc"]);
    expect(summary.children.map((child) => child.descendantCount)).toEqual([1, 0, 0]);
    expect(summary.descendantCount).toBe(3);
  });

  it("keeps missing direct references visible but out of jump targets", () => {
    const broken: CadElement = {
      id: "broken",
      name: "壊れた点",
      type: "offsetPoint",
      visible: true,
      enabled: true,
      fromPointId: "missing",
      dx: 0,
      dy: 0
    };
    const summary = getDependencySummary(broken, [...elements, broken]);

    expect(summary.parents).toEqual([{ id: "missing", element: null, ancestorCount: 0 }]);
    expect(getDependencyJumpTargets(broken, [...elements, broken])).toEqual([]);
  });

  it("orders jump targets as direct parents then direct children", () => {
    expect(getDependencyJumpTargets(elements[1], elements).map((element) => element.id)).toEqual([
      "a",
      "c",
      "ab",
      "bc"
    ]);
  });
});
