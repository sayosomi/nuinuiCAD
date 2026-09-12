import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { buildPropertyBindingRuntimeEntries } from "./propertyBindingRuntime";
import { evaluateElements } from "./evaluate";

const compileWithIds = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `say292:${index}`]))
  });
};

describe("SAY-292 computation/presentation separation", () => {
  it("skips disabled construction inputs while retaining hidden geometry", () => {
    const result = evaluateElements([
      {
        id: "disabled",
        name: "Disabled",
        type: "line",
        activity: "disabled",
        enabled: false,
        visible: true,
        startPoint: { mode: "reference", pointId: "missing-start" },
        endPoint: { mode: "reference", pointId: "missing-end" }
      },
      {
        id: "hidden",
        name: "Hidden",
        type: "freePoint",
        activity: "hidden",
        enabled: true,
        visible: false,
        x: 2,
        y: 3
      }
    ]);

    expect(result.computedGeometry.has("disabled")).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("hidden")).toMatchObject({ kind: "point", x: 2, y: 3 });
    expect(result.effectiveEnabledElementIds).toContain("hidden");
    expect(result.effectiveVisibleElementIds).not.toContain("hidden");
  });

  it("applies ancestor enabled/visible hard gates before Style contributions", () => {
    const result = evaluateElements([
      {
        id: "group",
        name: "Group",
        type: "group",
        activity: "visible",
        enabled: true,
        visible: false,
        modifierNames: ["show"]
      },
      {
        id: "child",
        name: "Child",
        type: "freePoint",
        activity: "visible",
        enabled: true,
        visible: true,
        parentGroupId: "group",
        x: 1,
        y: 1,
        modifierNames: ["hide"]
      }
    ], {
      drawingModifiers: [
        { name: "show", visible: true },
        { name: "hide", visible: false }
      ]
    });

    expect(result.computedGeometry.has("child")).toBe(true);
    expect(result.effectiveEnabledElementIds).toContain("child");
    expect(result.effectiveVisibleElementIds).not.toContain("child");
    expect(result.effectiveDrawingModifierResolutions?.get("child")?.visible.value).toBe(false);
  });

  it("gate-first skips disabled if, for, and Module container inputs", () => {
    const result = evaluateElements([
      { id: "if", name: "If", type: "conditionalGroup", activity: "visible", enabled: false, visible: true, condition: Number.NaN },
      { id: "if-child", name: "If child", type: "freePoint", activity: "visible", parentGroupId: "if", x: 1, y: 1, conditionalBranch: "then" },
      { id: "for", name: "For", type: "forGroup", activity: "visible", enabled: false, visible: true, variableName: "i", min: Number.NaN, max: Number.NaN, step: 0, showGenerated: true },
      { id: "for-child", name: "For child", type: "freePoint", activity: "visible", parentGroupId: "for", x: 1, y: 1 },
      { id: "instance", name: "Instance", type: "moduleInstance", activity: "visible", enabled: false, visible: true },
      { id: "instance-child", name: "Instance child", type: "freePoint", activity: "visible", parentGroupId: "instance", x: 1, y: 1 }
    ]);

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry).toEqual(new Map());
    expect(result.effectiveEnabledElementIds).toEqual(new Set());
  });

  it("resolves shared boolean enabled/visible bindings before ordinary inputs", () => {
    const compiled = compileWithIds([
      "nui 1",
      "let heavy: boolean = false",
      "point A = coordinate(x: 1, y: 2, enabled: @heavy)",
      "point B = coordinate(x: 3, y: 4, visible: @heavy)"
    ].join("\n"));
    expect(compiled.diagnostics).toEqual([]);
    const entries = buildPropertyBindingRuntimeEntries({
      propertyBindings: compiled.propertyBindings ?? new Map(),
      elementIdByStatementIndex: compiled.statementMap!.elementIdByStatementIndex
    }, compiled.document!.elements);
    const result = evaluateElements(compiled.document!.elements, {
      scalarProgram: compiled.scalarProgram,
      propertyBindingEntries: entries
    });

    expect(result.computedGeometry.has("say292:2")).toBe(false);
    expect(result.computedGeometry.has("say292:3")).toBe(true);
    expect(result.effectiveEnabledElementIds).toEqual(new Set(["say292:3"]));
    expect(result.effectiveVisibleElementIds).toEqual(new Set());
  });

  it("keeps Style cascade order and profile deltas presentation-only", () => {
    const result = evaluateElements([
      {
        id: "outer",
        name: "Outer",
        type: "group",
        activity: "visible",
        enabled: true,
        visible: true,
        modifierNames: ["outer"]
      },
      {
        id: "inner",
        name: "Inner",
        type: "group",
        activity: "visible",
        enabled: true,
        visible: true,
        parentGroupId: "outer",
        modifierNames: ["inner"]
      },
      {
        id: "point",
        name: "Point",
        type: "freePoint",
        activity: "visible",
        enabled: true,
        visible: true,
        parentGroupId: "inner",
        modifierNames: ["local"],
        x: 0,
        y: 0
      }
    ], {
      drawingModifiers: [
        { name: "outer", widthPx: 2, lineType: "solid" },
        { name: "inner", widthPx: 3, lineType: "dashed" },
        { name: "local", visible: false, lineType: "dotted", profileDeltas: [{ profileId: "print", profileName: "Print", visible: true, lineType: "solid" }] }
      ],
      selectedDrawingProfileId: "print"
    });

    expect(result.computedGeometry.has("point")).toBe(true);
    expect(result.effectiveVisibleElementIds).toContain("point");
    expect(result.effectiveDrawingModifierStrokes?.get("point")).toMatchObject({ widthPx: 3, style: "solid" });
    expect(result.effectiveDrawingModifierResolutions?.get("point")?.visible.value).toBe(true);
  });
});
