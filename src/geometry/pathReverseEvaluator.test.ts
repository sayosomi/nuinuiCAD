import { describe, expect, it } from "vitest";
import type {
  BezierCurveElement,
  CadElement,
  ConditionalGroupElement,
  FreePointElement,
  GroupElement,
  LineElement,
  OffsetPointElement,
  PathReverseElement
} from "../types/geometry";
import { derivedAnchor } from "../model/pointAnchors";
import { evaluateElements } from "./evaluate";
import { computedReferencePathValue } from "./numericExpressions";

const point = (id: string, name: string, x: number, y: number): FreePointElement => ({
  id,
  name,
  type: "freePoint",
  activity: "visible",
  x,
  y
});

const line = (id: string, name: string, startId: string, endId: string): LineElement => ({
  id,
  name,
  type: "line",
  activity: "visible",
  startPoint: { mode: "reference", pointId: startId },
  endPoint: { mode: "reference", pointId: endId }
});

const pathReverse = (id: string, targetLineId: string): PathReverseElement => ({
  id,
  name: "",
  type: "pathReverse",
  activity: "visible",
  targetLineId
});

const bezier = (): BezierCurveElement => ({
  id: "curve",
  name: "曲線ABCD",
  type: "bezierCurve",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  startHandleAngleDeg: 0,
  startHandleLength: 3,
  intermediatePoints: [
    {
      id: "slot-b",
      point: { mode: "reference", pointId: "b" },
      handleAngleDeg: 0,
      incomingHandleLength: 3,
      outgoingHandleLength: 3
    },
    {
      id: "slot-c",
      point: { mode: "reference", pointId: "c" },
      handleAngleDeg: 0,
      incomingHandleLength: 3,
      outgoingHandleLength: 3
    }
  ],
  endPoint: { mode: "reference", pointId: "d" },
  endHandleAngleDeg: 0,
  endHandleLength: 3
});

const pointFrom = (id: string, pointKey: string): OffsetPointElement => ({
  id,
  name: id,
  type: "offsetPoint",
  activity: "visible",
  fromPoint: derivedAnchor("curve", pointKey),
  dx: 1,
  dy: 2
});

const bezierPoints: FreePointElement[] = [
  point("a", "A", 0, 0),
  point("b", "B", 10, 0),
  point("c", "C", 20, 0),
  point("d", "D", 30, 0)
];

describe("evaluatePathReverseElement", () => {
  it("flips the target line's traversal in place and produces no geometry of its own", () => {
    const elements: CadElement[] = [
      point("a", "A", 0, 0),
      point("b", "B", 100, 0),
      line("ab", "AB", "a", "b"),
      pathReverse("rev", "ab")
    ];
    const result = evaluateElements(elements);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.has("rev")).toBe(false);
    const geometry = result.computedGeometry.get("ab");
    expect(geometry).toMatchObject({
      kind: "line",
      start: { x: 100, y: 0 },
      end: { x: 0, y: 0 }
    });
  });

  it("reports a dependency error for a target with no computed geometry yet", () => {
    const elements: CadElement[] = [pathReverse("rev", "missing")];
    const result = evaluateElements(elements);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].missingDependencyId).toBe("missing");
    // The bare `reverse(...)` statement never carries a name; the display
    // fallback must show the type label, never an empty string.
    expect(result.errors[0].elementName).toBe("反転");
  });

  it("reports a geometry error when the target is not line-like", () => {
    const elements: CadElement[] = [point("a", "A", 0, 0), pathReverse("rev", "a")];
    const result = evaluateElements(elements);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("線または曲線ではないため反転できません");
  });

  it("only affects statements after it in document order", () => {
    const elements: CadElement[] = [
      point("a", "A", 0, 0),
      point("b", "B", 100, 0),
      line("ab", "AB", "a", "b"),
      pathReverse("rev", "ab"),
      line("copy", "コピー", "a", "b")
    ];
    const result = evaluateElements(elements);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("ab")).toMatchObject({ start: { x: 100, y: 0 } });
    expect(result.computedGeometry.get("copy")).toMatchObject({ start: { x: 0, y: 0 } });
  });

  // As a normal CadElement, pathReverse now follows the standard activity
  // gate (effectiveElementActivityById / inactiveConditionalGroupId in
  // evaluate.ts) instead of the old dedicated path-mutation resolver, which
  // ran before that gate && so ignored group/conditional state entirely.
  // This is an intentional behavior change: a reversal inside a disabled
  // group || an inactive conditional branch no longer applies.
  describe("activity gating (intentional behavior change from the old resolver)", () => {
    it("does not apply inside a disabled group", () => {
      const group: GroupElement = { id: "g", name: "G", type: "group", activity: "disabled" };
      const elements: CadElement[] = [
        point("a", "A", 0, 0),
        point("b", "B", 100, 0),
        line("ab", "AB", "a", "b"),
        group,
        { ...pathReverse("rev", "ab"), parentGroupId: "g" }
      ];
      const result = evaluateElements(elements);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get("ab")).toMatchObject({ start: { x: 0, y: 0 } });
    });

    it("does not apply in an inactive conditional branch", () => {
      const conditional: ConditionalGroupElement = {
        id: "cond", name: "COND", type: "conditionalGroup", activity: "visible", condition: 1
      };
      const elements: CadElement[] = [
        point("a", "A", 0, 0),
        point("b", "B", 100, 0),
        line("ab", "AB", "a", "b"),
        conditional,
        { ...pathReverse("rev", "ab"), parentGroupId: "cond", conditionalBranch: "else" }
      ];
      const result = evaluateElements(elements);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get("ab")).toMatchObject({ start: { x: 0, y: 0 } });
    });

    it("applies in the active conditional branch", () => {
      const conditional: ConditionalGroupElement = {
        id: "cond", name: "COND", type: "conditionalGroup", activity: "visible", condition: 1
      };
      const elements: CadElement[] = [
        point("a", "A", 0, 0),
        point("b", "B", 100, 0),
        line("ab", "AB", "a", "b"),
        conditional,
        { ...pathReverse("rev", "ab"), parentGroupId: "cond", conditionalBranch: "then" }
      ];
      const result = evaluateElements(elements);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get("ab")).toMatchObject({ start: { x: 100, y: 0 } });
    });

    it("reverses Bezier joins by slot id while stable anchors keep their physical points", () => {
      const baseline = evaluateElements([
        ...bezierPoints,
        bezier(),
        pointFrom("before-b", "intermediate:slot-b"),
        pointFrom("before-c", "intermediate:slot-c")
      ]);
      expect(baseline.errors).toEqual([]);
      expect(baseline.computedGeometry.get("before-b")).toMatchObject({ x: 11, y: 2 });
      expect(baseline.computedGeometry.get("before-c")).toMatchObject({ x: 21, y: 2 });

      const reversed = evaluateElements([
        ...bezierPoints,
        bezier(),
        pathReverse("reverse", "curve"),
        pointFrom("after-b", "intermediate:slot-b"),
        pointFrom("after-c", "intermediate:slot-c")
      ]);
      expect(reversed.errors).toEqual([]);
      const reversedCurve = reversed.computedGeometry.get("curve");
      expect(reversedCurve).toMatchObject({
        kind: "bezierCurve",
        intermediatePointIds: ["b", "c"],
        intermediateSlotIds: ["slot-c", "slot-b"]
      });
      if (reversedCurve?.kind !== "bezierCurve") throw new Error("Expected a Bezier curve");
      expect(reversedCurve.segments.map((segment) => segment.end.elementId)).toEqual(["c", "b", "a"]);
      expect(computedReferencePathValue(reversedCurve, "intermediatePoints[1].x")).toBe(20);
      expect(computedReferencePathValue(reversedCurve, "intermediatePoints[2].x")).toBe(10);
      expect(reversed.computedGeometry.get("after-b")).toMatchObject({ x: 11, y: 2 });
      expect(reversed.computedGeometry.get("after-c")).toMatchObject({ x: 21, y: 2 });

      const restored = evaluateElements([
        ...bezierPoints,
        bezier(),
        pathReverse("reverse-1", "curve"),
        pathReverse("reverse-2", "curve"),
        pointFrom("restored-b", "intermediate:slot-b"),
        pointFrom("restored-c", "intermediate:slot-c")
      ]);
      expect(restored.errors).toEqual([]);
      const restoredCurve = restored.computedGeometry.get("curve");
      expect(restoredCurve).toMatchObject({
        kind: "bezierCurve",
        intermediateSlotIds: ["slot-b", "slot-c"]
      });
      if (restoredCurve?.kind !== "bezierCurve") throw new Error("Expected a Bezier curve");
      expect(restoredCurve.segments.map((segment) => segment.end.elementId)).toEqual(["b", "c", "d"]);
      expect(restored.computedGeometry.get("restored-b")).toMatchObject({ x: 11, y: 2 });
      expect(restored.computedGeometry.get("restored-c")).toMatchObject({ x: 21, y: 2 });
    });
  });
});
