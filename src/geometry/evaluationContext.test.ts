import { describe, expect, it } from "vitest";
import type { CadElement, FreePointElement, GroupElement, VariableElement } from "../types/geometry";
import { evaluateElements } from "./evaluate";
import { evaluateLocalVariables } from "./evaluationContext";

const point = (
  id: string,
  x: FreePointElement["x"],
  parentGroupId?: string
): FreePointElement => ({
  id,
  name: id,
  type: "freePoint",
  visible: true,
  enabled: true,
  ...(parentGroupId ? { parentGroupId } : {}),
  x,
  y: 0
});

const group = (id: string, parentGroupId?: string): GroupElement => ({
  id,
  name: id,
  type: "group",
  visible: true,
  enabled: true,
  ...(parentGroupId ? { parentGroupId } : {})
});

const variable = (
  id: string,
  name: string,
  expression: number,
  overrides: Partial<VariableElement> = {}
): VariableElement => ({
  id,
  name,
  type: "variable",
  visible: true,
  enabled: true,
  scope: "global",
  valueMode: "expression",
  expression,
  point1: { mode: "reference", pointId: "" },
  point2: { mode: "reference", pointId: "" },
  point: { mode: "reference", pointId: "" },
  lineId: "",
  ...overrides
});

describe("evaluateLocalVariables legacy fast path", () => {
  it("does not inspect a runtime element array when the document has no legacy var", () => {
    const consumer = point("consumer", 0);
    const inaccessibleElements = new Proxy([] as CadElement[], {
      get(_target, property) {
        if (property === "findIndex") throw new Error("legacy lookup must not run");
        return Reflect.get(_target, property);
      }
    });

    expect(evaluateLocalVariables(
      consumer,
      new Map(),
      new Map([[consumer.id, consumer]]),
      [],
      new Map(),
      inaccessibleElements,
      false
    )).toEqual({ localVariableValues: new Map(), localVariableNames: new Map() });
  });

  it("keeps a no-legacy-var document's local numeric evaluation unchanged", () => {
    const result = evaluateElements([
      point("consumer", { kind: "expression", expression: "@local + 2" })
    ].map((element) => element.id === "consumer"
      ? { ...element, numericVariables: [{ id: "local-id", name: "local", value: 8 }] }
      : element));

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("consumer")).toMatchObject({ kind: "point", x: 10, y: 0 });
  });

  it("keeps nearest-preceding legacy resolution by both name and id", () => {
    const result = evaluateElements([
      variable("width-first", "Width", 10),
      variable("width-second", "Width", 30),
      point("by-name", { kind: "expression", expression: "@Width" }),
      point("by-id", { kind: "expression", expression: "@width-first" })
    ]);

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("by-name")).toMatchObject({ kind: "point", x: 30 });
    expect(result.computedGeometry.get("by-id")).toMatchObject({ kind: "point", x: 10 });
  });

  it("continues to reject a forward legacy reference", () => {
    const result = evaluateElements([
      point("before", { kind: "expression", expression: "@later" }),
      variable("later", "Later", 12)
    ]);

    expect(result.computedGeometry.has("before")).toBe(false);
    expect(result.computedVariables.get("later")?.value).toBe(12);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ elementId: "before", missingDependencyId: "later" });
  });

  it("preserves global, group, nested, and sibling legacy visibility", () => {
    const result = evaluateElements([
      variable("global", "Global", 5),
      group("outer"),
      variable("group-width", "GroupWidth", 20, { scope: "group", parentGroupId: "outer" }),
      group("nested", "outer"),
      point("nested-by-name", { kind: "expression", expression: "@GroupWidth + @Global" }, "nested"),
      point("nested-by-id", { kind: "expression", expression: "@group-width" }, "nested"),
      group("sibling"),
      point("sibling-consumer", { kind: "expression", expression: "@group-width" }, "sibling")
    ]);

    expect(result.computedGeometry.get("nested-by-name")).toMatchObject({ kind: "point", x: 25 });
    expect(result.computedGeometry.get("nested-by-id")).toMatchObject({ kind: "point", x: 20 });
    expect(result.computedGeometry.has("sibling-consumer")).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ elementId: "sibling-consumer", missingDependencyId: "group-width" });
  });
});
