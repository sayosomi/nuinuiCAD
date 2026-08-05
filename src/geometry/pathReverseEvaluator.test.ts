import { describe, expect, it } from "vitest";
import type {
  CadElement,
  ConditionalGroupElement,
  FreePointElement,
  GroupElement,
  LineElement,
  PathReverseElement
} from "../types/geometry";
import { evaluateElements } from "./evaluate";

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
  // ran before that gate and so ignored group/conditional state entirely.
  // This is an intentional behavior change: a reversal inside a disabled
  // group or an inactive conditional branch no longer applies.
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
  });
});
