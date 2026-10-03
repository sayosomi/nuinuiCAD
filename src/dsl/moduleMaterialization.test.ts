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

  it("lowers Module-local move anchors through body materialization identities", () => {
    const sourceFor = ({
      targetName,
      anchorName,
      padded,
      anchorAfterMove
    }: {
      targetName: string;
      anchorName: string;
      padded: boolean;
      anchorAfterMove: boolean;
    }) => [
      "nui 1",
      "module M() {",
      `  line ${targetName} = segment(start: (11, 23), end: (20, 35))`,
      ...(padded ? ["  // unrelated local source padding", "  const Padding: number = 17", ""] : []),
      ...(anchorAfterMove
        ? [
            `  move ${targetName} (from: @${anchorName}.start, to: @${anchorName}.end)`,
            `  line ${anchorName} = segment(start: (-31, 47), end: (-26, 59))`
          ]
        : [
            `  line ${anchorName} = segment(start: (-31, 47), end: (-26, 59))`,
            `  move ${targetName} (from: @${anchorName}.start, to: @${anchorName}.end)`
          ]),
      "}",
      "instance I = M()"
    ].join("\n");

    for (const variant of [
      { targetName: "L", anchorName: "P", padded: false, anchorAfterMove: false },
      { targetName: "Target", anchorName: "Anchor", padded: true, anchorAfterMove: true }
    ]) {
      const source = sourceFor(variant);
      const parsedStatements = parseDsl(source).statements;
      const targetStatementIndex = parsedStatements.findIndex((statement) =>
        statement.kind === "element" && statement.name === variant.targetName
      );
      const anchorStatementIndex = parsedStatements.findIndex((statement) =>
        statement.kind === "element" && statement.name === variant.anchorName
      );
      const moveStatementIndex = parsedStatements.findIndex((statement) =>
        statement.kind === "transformation" && statement.construction === "move"
      );
      const compiled = runtimeNames(source);
      const sourceTargetId = stableIdsFor(source).get(targetStatementIndex)!;
      const sourceAnchorId = stableIdsFor(source).get(anchorStatementIndex)!;
      const sourceRecipe = compiled.transformationRecipes!.find((recipe) =>
        recipe.sourceStatementIndex === moveStatementIndex
      )!;
      const runtimeRecipe = compiled.runtimeTransformationRecipes!.find((recipe) =>
        recipe.sourceStatementIndex === moveStatementIndex
      )!;
      const target = compiled.document!.elements.find((element) => element.name === variant.targetName)!;
      const anchor = compiled.document!.elements.find((element) => element.name === variant.anchorName)!;
      const anchorRuntimeId = compiled.moduleMaterialization!.executionStatements.find((entry) =>
        entry.origin?.kind === "moduleBody" && entry.sourceStatementIndex === anchorStatementIndex
      )!.runtimeElementId;

      expect(sourceRecipe.targets[0]?.ownerId).toBe(sourceTargetId);
      expect(sourceRecipe.operation).toMatchObject({
        kind: "move",
        startPoint: { mode: "derived", elementId: sourceAnchorId, pointKey: "start", stagePath: ["final"] },
        endPoint: { mode: "derived", elementId: sourceAnchorId, pointKey: "end", stagePath: ["final"] }
      });
      expect(runtimeRecipe.targets[0]?.ownerId).toBe(target.id);
      expect(anchorRuntimeId).toBe(anchor.id);
      expect(runtimeRecipe.operation).toMatchObject({
        kind: "move",
        startPoint: { mode: "derived", elementId: anchorRuntimeId, pointKey: "start", stagePath: ["final"] },
        endPoint: { mode: "derived", elementId: anchorRuntimeId, pointKey: "end", stagePath: ["final"] }
      });
      if (runtimeRecipe.operation.kind !== "move") throw new Error("expected a runtime move recipe");
      const runtimeAnchorIdentities = [runtimeRecipe.operation.startPoint, runtimeRecipe.operation.endPoint].map((anchor) =>
        anchor.mode === "reference" ? anchor.pointId : anchor.mode === "derived" ? anchor.elementId : "coordinate"
      );
      expect(runtimeAnchorIdentities).not.toContain(`@${variant.anchorName}`);
      expect(runtimeAnchorIdentities.every((identity) => !identity.startsWith("@"))).toBe(true);

      const result = evaluateCompiled(compiled);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(target.id)).toMatchObject({
        kind: "line",
        start: { x: 16, y: 35 },
        end: { x: 25, y: 47 }
      });
    }
  });

  it("preserves Module-local point-anchor stages while lowering their geometry identities", () => {
    const source = [
      "nui 1",
      "module M() {",
      "  line P = segment(start: (-31, 47), end: (-26, 59))",
      "  line L = segment(start: (11, 23), end: (20, 35))",
      "  move P as shifted (from: (0, 0), to: (3, 4))",
      "  move L (from: @P.base.start, to: @P.shifted.start)",
      "}",
      "instance I = M()"
    ].join("\n");
    const parsedStatements = parseDsl(source).statements;
    const pStatementIndex = parsedStatements.findIndex((statement) => statement.kind === "element" && statement.name === "P");
    const targetStatementIndex = parsedStatements.findIndex((statement) => statement.kind === "element" && statement.name === "L");
    const stageMoveStatementIndex = parsedStatements.findIndex((statement) =>
      statement.kind === "transformation" && statement.construction === "move" && statement.stageName === null
    );
    const compiled = runtimeNames(source);
    const sourcePId = stableIdsFor(source).get(pStatementIndex)!;
    const sourceRecipe = compiled.transformationRecipes!.find((recipe) =>
      recipe.sourceStatementIndex === stageMoveStatementIndex
    )!;
    const runtimeRecipe = compiled.runtimeTransformationRecipes!.find((recipe) =>
      recipe.sourceStatementIndex === stageMoveStatementIndex
    )!;
    const target = compiled.document!.elements.find((element) => element.name === "L")!;
    const anchor = compiled.document!.elements.find((element) => element.name === "P")!;

    expect(sourceRecipe.targets[0]?.ownerId).toBe(stableIdsFor(source).get(targetStatementIndex));
    expect(sourceRecipe.operation).toMatchObject({
      kind: "move",
      startPoint: { mode: "derived", elementId: sourcePId, pointKey: "start", stagePath: ["base"] },
      endPoint: { mode: "derived", elementId: sourcePId, pointKey: "start", stagePath: ["shifted"] }
    });
    expect(runtimeRecipe.targets[0]?.ownerId).toBe(target.id);
    expect(runtimeRecipe.operation).toMatchObject({
      kind: "move",
      startPoint: { mode: "derived", elementId: anchor.id, pointKey: "start", stagePath: ["base"] },
      endPoint: { mode: "derived", elementId: anchor.id, pointKey: "start", stagePath: ["shifted"] }
    });
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(target.id)).toMatchObject({
      kind: "line",
      start: { x: 14, y: 27 },
      end: { x: 23, y: 39 }
    });
  });

  it("lowers extend and mirrorMove point anchors without changing other recipe fields", () => {
    const source = [
      "nui 1",
      "module M() {",
      "  line P = segment(start: (-31, 47), end: (-26, 59))",
      "  line L = segment(start: (11, 23), end: (20, 35))",
      "  extend L.end as extended (to: @P.end)",
      "  mirrorMove [L] (axis1: @P.start, axis2: @P.end)",
      "}",
      "instance I = M()"
    ].join("\n");
    const parsedStatements = parseDsl(source).statements;
    const anchorStatementIndex = parsedStatements.findIndex((statement) => statement.kind === "element" && statement.name === "P");
    const compiled = runtimeNames(source);
    const anchor = compiled.document!.elements.find((element) => element.name === "P")!;
    const recipesByConstruction = (recipes: typeof compiled.transformationRecipes) => new Map(
      recipes!.map((recipe) => [recipe.construction, recipe])
    );
    const sourceRecipes = recipesByConstruction(compiled.transformationRecipes);
    const runtimeRecipes = recipesByConstruction(compiled.runtimeTransformationRecipes);
    const sourceAnchorId = stableIdsFor(source).get(anchorStatementIndex)!;

    expect(sourceRecipes.get("extend")?.operation).toMatchObject({
      kind: "extend",
      point: { mode: "derived", elementId: sourceAnchorId, pointKey: "end", stagePath: ["final"] }
    });
    expect(runtimeRecipes.get("extend")?.operation).toMatchObject({
      kind: "extend",
      point: { mode: "derived", elementId: anchor.id, pointKey: "end", stagePath: ["final"] }
    });
    expect(sourceRecipes.get("mirrorMove")?.operation).toMatchObject({
      kind: "mirrorMove",
      axisPoint1: { mode: "derived", elementId: sourceAnchorId, pointKey: "start", stagePath: ["final"] },
      axisPoint2: { mode: "derived", elementId: sourceAnchorId, pointKey: "end", stagePath: ["final"] }
    });
    expect(runtimeRecipes.get("mirrorMove")?.operation).toMatchObject({
      kind: "mirrorMove",
      axisPoint1: { mode: "derived", elementId: anchor.id, pointKey: "start", stagePath: ["final"] },
      axisPoint2: { mode: "derived", elementId: anchor.id, pointKey: "end", stagePath: ["final"] }
    });
  });

  it("preserves literal Module and root-scope transformation arguments", () => {
    const source = [
      "nui 1",
      "module M() {",
      "  line Local = segment(start: (1, 2), end: (4, 6))",
      "  move Local (from: (10, 20), to: (15, 26))",
      "}",
      "instance I = M()",
      "line Root = segment(start: (0, 0), end: (1, 2))",
      "move Root (from: (1, 2), to: (7, 9))"
    ].join("\n");
    const compiled = runtimeNames(source);
    const moveStatementIndexes = parseDsl(source).statements.flatMap((statement, statementIndex) =>
      statement.kind === "transformation" && statement.construction === "move"
        ? [statementIndex]
        : []
    );
    const localMoveStatementIndex = moveStatementIndexes[0]!;
    const rootMoveStatementIndex = moveStatementIndexes[1]!;
    const localSource = compiled.transformationRecipes!.find((recipe) =>
      recipe.sourceStatementIndex === localMoveStatementIndex
    )!;
    const localRuntime = compiled.runtimeTransformationRecipes!.find((recipe) =>
      recipe.sourceStatementIndex === localMoveStatementIndex
    )!;
    const rootSource = compiled.transformationRecipes!.find((recipe) =>
      recipe.sourceStatementIndex === rootMoveStatementIndex
    )!;
    const rootRuntime = compiled.runtimeTransformationRecipes!.find((recipe) =>
      recipe.sourceStatementIndex === rootSource.sourceStatementIndex
    )!;
    const local = compiled.document!.elements.find((element) => element.name === "Local")!;
    const root = compiled.document!.elements.find((element) => element.name === "Root")!;

    if (localSource.operation.kind !== "move" || localRuntime.operation.kind !== "move" ||
      rootSource.operation.kind !== "move" || rootRuntime.operation.kind !== "move") {
      throw new Error("expected move recipes for literal and root-scope controls");
    }
    expect(localRuntime.targets[0]?.ownerId).toBe(local.id);
    expect(localRuntime.operation.startPoint).toEqual(localSource.operation.startPoint);
    expect(localRuntime.operation.endPoint).toEqual(localSource.operation.endPoint);
    expect(rootRuntime.targets[0]?.ownerId).toBe(root.id);
    expect(rootRuntime.operation).toEqual(rootSource.operation);

    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(local.id)).toMatchObject({
      kind: "line",
      start: { x: 6, y: 8 },
      end: { x: 9, y: 12 }
    });
    expect(result.computedGeometry.get(root.id)).toMatchObject({
      kind: "line",
      start: { x: 6, y: 7 },
      end: { x: 7, y: 9 }
    });
  });

  it("keeps invalid Module transformation anchors as compiler diagnostics", () => {
    const compiled = compileWithStableIds([
      "nui 1",
      "module M() {",
      "  line L = segment(start: (11, 23), end: (20, 35))",
      "  move L (from: @Missing.start, to: @Missing.end)",
      "}",
      "instance I = M()"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "undefined-geometry-reference",
        message: expect.stringContaining("Missing")
      })
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
