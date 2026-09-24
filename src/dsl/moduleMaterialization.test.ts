import { describe, expect, it } from "vitest";
import { reconcileStatements } from "@nuinuicad/nui-language/document";
import { evaluateElements } from "../geometry/evaluate";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { parseDsl } from "@nuinuicad/nui-language";

const stableIdsFor = (source: string, prefix = "statement") =>
  new Map(parseDsl(source).statements.map((_, index) => [index, `${prefix}:${index}`] as const));

const compileWithStableIds = (source: string, prefix = "statement") =>
  compileDslDocument(source, { assignedStatementIds: stableIdsFor(source, prefix) });

const runtimeNames = (source: string) => {
  const compiled = compileWithStableIds(source);
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(compiled.document).not.toBeNull();
  return compiled;
};

const evaluateCompiled = (compiled: ReturnType<typeof runtimeNames>) =>
  evaluateElements(compiled.document!.elements, {
    evaluationLimitIndex: compiled.document!.evaluationLimitIndex,
    evaluationOrder: compiled.typedDependencyGraph?.evaluationOrder,
    transformationDependencyPlans: compiled.typedDependencyGraph?.transformationPlans,
    transformationRecipes: compiled.runtimeTransformationRecipes ?? compiled.document!.transformationRecipes,
    drawingModifiers: compiled.document!.modifiers ?? [],
    scalarProgram: compiled.scalarProgram,
    bindingVersions: compiled.bindingVersions,
    statementInfoByElementId: compiled.statementMap?.byElementId,
    statementIdByStatementIndex: compiled.statementMap?.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
    moduleMaterialization: compiled.moduleMaterialization,
  });

describe("module materialization", () => {
  it("keeps a module definition inert without an instance", () => {
    const compiled = runtimeNames([
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}"
    ].join("\n"));

    expect(compiled.document!.elements).toEqual([]);
    expect(compiled.moduleMaterialization?.executionStatements).toEqual([]);
  });

  it("warns when a materialized source block child supplies parent and keeps block ownership", () => {
    const compiled = runtimeNames([
      "nui 1",
      "module M() {",
      "  if (true) {",
      "    point P = coordinate(x: 10, y: 20, parent: @IgnoredParent)",
      "  }",
      "}",
      "instance A = M()"
    ].join("\n"));
    const instance = compiled.document!.elements.find((element) => element.name === "A")!;
    const conditional = compiled.document!.elements.find((element) => element.type === "conditionalGroup" && element.parentGroupId === instance.id)!;
    const child = compiled.document!.elements.find((element) => element.name === "P")!;
    const diagnostic = compiled.diagnostics.find((item) => item.code === "ignored-parent-in-block");

    expect(diagnostic).toMatchObject({
      severity: "warning",
      code: "ignored-parent-in-block",
      presentation: { key: "diagnostic.ignored-parent-in-block" },
      message: "ブロック内の parent= 属性は無視されます。"
    });
    expect(conditional.parentGroupId).toBe(instance.id);
    expect(child).toMatchObject({ parentGroupId: conditional.id, conditionalBranch: "then" });
    expect(child.parentGroupId).not.toBe("IgnoredParent");
  });

  it("emits a container and body in source execution order with private name resolution", () => {
    const compiled = runtimeNames([
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "  point Q = offset(from: @P, dx: 1, dy: 2)",
      "}",
      "point Before = coordinate(x: 0, y: 0)",
      "instance A = M()",
      "point After = coordinate(x: 30, y: 40)"
    ].join("\n"));

    const elements = compiled.document!.elements;
    expect(elements.map((element) => element.name)).toEqual(["Before", "A", "P", "Q", "After"]);
    const container = elements[1];
    expect(container.type).toBe("moduleInstance");
    expect(elements[2].parentGroupId).toBe(container.id);
    expect(elements[3].parentGroupId).toBe(container.id);
    expect(elements[3]).toMatchObject({
      type: "offsetPoint",
      fromPoint: { mode: "reference", pointId: elements[2].id }
    });
  });

  it("derives non-colliding IDs and origin mappings for repeated and nested instances", () => {
    const source = [
      "nui 1",
      "module Inner() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "module Outer() {",
      "  instance Nested = Inner()",
      "  point Q = coordinate(x: 3, y: 4)",
      "}",
      "instance First = Outer()",
      "instance Second = Outer()"
    ].join("\n");
    const compiled = runtimeNames(source);
    const elements = compiled.document!.elements;
    const first = elements.find((element) => element.name === "First")!;
    const second = elements.find((element) => element.name === "Second")!;
    const firstNested = elements.find((element) => element.name === "Nested" && element.parentGroupId === first.id)!;
    const secondNested = elements.find((element) => element.name === "Nested" && element.parentGroupId === second.id)!;

    expect(new Set(elements.map((element) => element.id)).size).toBe(elements.length);
    expect(first.id).not.toBe(second.id);
    expect(firstNested.id).not.toBe(secondNested.id);
    expect(firstNested.parentGroupId).toBe(first.id);
    expect(compiled.moduleMaterialization?.originByRuntimeElementId.get(first.id)).toMatchObject({
      kind: "moduleInstance",
      sourceStatementIndex: 8
    });
    const firstBody = elements.find((element) => element.name === "Q" && element.parentGroupId === first.id)!;
    expect(compiled.moduleMaterialization?.originByRuntimeElementId.get(firstBody.id)).toMatchObject({
      kind: "moduleBody",
      sourceStatementIndex: 6
    });
    const materialization = compiled.moduleMaterialization!;
    for (const element of elements) {
      expect(
        compiled.statementMap!.byElementId.has(element.id) ||
          materialization.sourceExecutionPositionByRuntimeElementId.has(element.id)
      ).toBe(true);
    }
    expect(materialization.sourceExecutionPositionByRuntimeElementId.get(firstNested.id)).toBe(8);
    expect(materialization.sourceExecutionPositionByRuntimeElementId.get(firstBody.id)).toBe(8);
    expect(materialization.sourceExecutionPositionByRuntimeElementId.get(secondNested.id)).toBe(9);
  });

  it("preserves a materialized subtree when reconciliation carries statement identities", () => {
    const beforeSource = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}",
      "instance A = M()"
    ].join("\n");
    const afterSource = beforeSource.replace("x: 10", "x: 11");
    const beforeParsed = parseDsl(beforeSource);
    const before = compileDslDocument(beforeSource, {
      preparsed: beforeParsed,
      assignedStatementIds: stableIdsFor(beforeSource, "reconciled")
    });
    const afterParsed = parseDsl(afterSource);
    const reconciled = reconcileStatements({
      oldStatements: before.statements,
      oldLines: before.sourceLines,
      oldElementIds: before.statementMap!.elementIdByStatementIndex,
      oldStatementIds: before.statementMap!.statementIdByStatementIndex,
      newStatements: afterParsed.statements,
      newLines: afterSource.split("\n")
    });
    const after = compileDslDocument(afterSource, {
      preparsed: afterParsed,
      assignedStatementIds: reconciled.assignedIds
    });

    expect(after.document!.elements.map((element) => element.id)).toEqual(
      before.document!.elements.map((element) => element.id)
    );
  });

  it("materializes module calls regardless of unrelated declaration position", () => {
    const callBefore = runtimeNames([
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "instance A = M()",
      "point After = coordinate(x: 3, y: 4)"
    ].join("\n"));
    expect(callBefore.document!.evaluationLimitIndex).toBeUndefined();
    expect(callBefore.document!.elements.map((element) => element.name)).toEqual(["A", "P", "After"]);

    const callAfter = runtimeNames([
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "instance A = M()",
      "point After = coordinate(x: 3, y: 4)"
    ].join("\n"));
    expect(callAfter.document!.evaluationLimitIndex).toBeUndefined();
    expect(callAfter.document!.elements.map((element) => element.name)).toEqual(["A", "P", "After"]);
  });

  it("maps outer and inner source containers to runtime parents without changing group semantics", () => {
    const compiled = runtimeNames([
      "nui 1",
      "module M() {",
      "  group Inner {",
      "    point P = coordinate(x: 1, y: 2)",
      "  }",
      "}",
      "group Outer {",
      "  instance A = M()",
      "}"
    ].join("\n"));
    const elements = compiled.document!.elements;
    const outer = elements.find((element) => element.name === "Outer")!;
    const instance = elements.find((element) => element.name === "A")!;
    const inner = elements.find((element) => element.name === "Inner")!;
    const point = elements.find((element) => element.name === "P")!;

    expect(instance.parentGroupId).toBe(outer.id);
    expect(inner.parentGroupId).toBe(instance.id);
    expect(point.parentGroupId).toBe(inner.id);
    expect(outer.type).toBe("group");
    expect(instance.type).toBe("moduleInstance");
  });

  it("inherits hidden and disabled module instance activity through the generic container path", () => {
    const compiled = runtimeNames([
      "nui 1",
      "module M(state: boolean = true) {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "instance Hidden(visible: false) = M()",
      "instance Disabled(enabled: false) = M()"
    ].join("\n"));
    const elements = compiled.document!.elements;
    const hidden = elements.find((element) => element.name === "Hidden")!;
    const hiddenPoint = elements.find((element) => element.name === "P" && element.parentGroupId === hidden.id)!;
    const disabled = elements.find((element) => element.name === "Disabled")!;
    const disabledPoint = elements.find((element) => element.name === "P" && element.parentGroupId === disabled.id)!;
    expect(hidden.visible).toBe(false);
    expect(disabled.enabled).toBe(false);
    const result = evaluateCompiled(compiled);
    expect(result.computedGeometry.has(hiddenPoint.id)).toBe(true);
    expect(result.effectiveVisibleElementIds).not.toContain(hiddenPoint.id);
    expect(result.effectiveEnabledElementIds).toContain(hiddenPoint.id);
    expect(result.computedGeometry.has(disabledPoint.id)).toBe(false);
    expect(result.effectiveEnabledElementIds).not.toContain(disabledPoint.id);
  });

  it("captures a dependency-reordered Module Base after terminal descendants", () => {
    const compiled = runtimeNames([
      "nui 1",
      "module M() {",
      "  line Later = segment(start: @First.start, end: (20, 0))",
      "  line First = segment(start: (0, 0), end: (10, 0))",
      "  line Disabled = segment(start: (0, 0), end: (5, 0), enabled: false)",
      "}",
      "instance A = M()"
    ].join("\n"));
    const result = evaluateCompiled(compiled);
    const instance = compiled.document!.elements.find((element) => element.name === "A")!;
    const snapshot = result.instanceBaseGeometry?.get(instance.id);
    expect(result.errors).toEqual([]);
    expect(snapshot).toHaveLength(2);
    expect(snapshot?.map((geometry) => geometry.name).sort()).toEqual(["First", "Later"]);
    expect(snapshot?.find((geometry) => geometry.name === "Later")).toMatchObject({
      kind: "line",
      start: { x: 0, y: 0 },
      end: { x: 20, y: 0 }
    });
  });

  it("completes disabled, inactive, and errored descendants before capturing Module Base", () => {
    const compiled = runtimeNames([
      "nui 1",
      "module M() {",
      "  if (false) {",
      "    line Inactive = segment(start: (0, 0), end: (1, 0))",
      "  }",
      "  arc Error = arc(center: (0, 0), radius: 0, start: 0, end: 90)",
      "  line Disabled = segment(start: (0, 0), end: (5, 0), enabled: false)",
      "  line Good = segment(start: (0, 0), end: (10, 0))",
      "}",
      "instance A = M()"
    ].join("\n"));
    const result = evaluateCompiled(compiled);
    const instance = compiled.document!.elements.find((element) => element.name === "A")!;
    const snapshot = result.instanceBaseGeometry?.get(instance.id);
    expect(snapshot?.map((geometry) => geometry.name)).toEqual(["Good"]);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ elementName: "Error" })
    ]));
  });

  it("preserves ordinary declaration order when no module is present", () => {
    const compiled = runtimeNames([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 1)",
      "point C = coordinate(x: 2, y: 2)"
    ].join("\n"));

    expect(compiled.document!.elements.map((element) => element.name)).toEqual(["A", "B", "C"]);
    expect(compiled.document!.evaluationLimitIndex).toBeUndefined();
    expect(compiled.moduleMaterialization).toBeUndefined();
  });
});
