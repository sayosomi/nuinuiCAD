import { describe, expect, it } from "vitest";
import { reconcileStatements } from "../document/statementReconciler";
import { effectiveElementActivityById } from "../model/elementActivity";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

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

describe("module materialization", () => {
  it("keeps a module definition inert without an instance", () => {
    const compiled = runtimeNames([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}"
    ].join("\n"));

    expect(compiled.document!.elements).toEqual([]);
    expect(compiled.moduleMaterialization?.executionStatements).toEqual([]);
  });

  it("emits a container and body in source execution order with private name resolution", () => {
    const compiled = runtimeNames([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "  point Q = offset(from: P, dx: 1, dy: 2)",
      "}",
      "point Before = coordinate(x: 0, y: 0)",
      "module A = M()",
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
      "nui 3",
      "module Inner() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "module Outer() {",
      "  module Nested = Inner()",
      "  point Q = coordinate(x: 3, y: 4)",
      "}",
      "module First = Outer()",
      "module Second = Outer()"
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
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}",
      "module A = M()"
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

  it("treats a module call as one @stop atomic unit", () => {
    const callBeforeStop = runtimeNames([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "module A = M()",
      "@stop",
      "point After = coordinate(x: 3, y: 4)"
    ].join("\n"));
    expect(callBeforeStop.document!.evaluationLimitIndex).toBe(2);

    const callAfterStop = runtimeNames([
      "nui 3",
      "module M() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "@stop",
      "module A = M()",
      "point After = coordinate(x: 3, y: 4)"
    ].join("\n"));
    expect(callAfterStop.document!.evaluationLimitIndex).toBe(0);
  });

  it("maps outer and inner source containers to runtime parents without changing group semantics", () => {
    const compiled = runtimeNames([
      "nui 3",
      "module M() {",
      "  group Inner {",
      "    point P = coordinate(x: 1, y: 2)",
      "  }",
      "}",
      "group Outer {",
      "  module A = M()",
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
      "nui 3",
      "module M(state: boolean = true) {",
      "  point P = coordinate(x: 1, y: 2)",
      "}",
      "module Hidden(state: hidden) = M()",
      "module Disabled(state: disabled) = M()"
    ].join("\n"));
    const elements = compiled.document!.elements;
    const hidden = elements.find((element) => element.name === "Hidden")!;
    const hiddenPoint = elements.find((element) => element.name === "P" && element.parentGroupId === hidden.id)!;
    const disabled = elements.find((element) => element.name === "Disabled")!;
    const disabledPoint = elements.find((element) => element.name === "P" && element.parentGroupId === disabled.id)!;
    const activities = effectiveElementActivityById(elements);

    expect(hidden.activity).toBe("hidden");
    expect(activities.get(hiddenPoint.id)?.activity).toBe("hidden");
    expect(disabled.activity).toBe("disabled");
    expect(activities.get(disabledPoint.id)?.activity).toBe("disabled");
  });

  it("preserves ordinary source order and @stop behavior when no module is present", () => {
    const compiled = runtimeNames([
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 1)",
      "@stop",
      "point C = coordinate(x: 2, y: 2)"
    ].join("\n"));

    expect(compiled.document!.elements.map((element) => element.name)).toEqual(["A", "B", "C"]);
    expect(compiled.document!.evaluationLimitIndex).toBe(2);
    expect(compiled.moduleMaterialization).toBeUndefined();
  });
});
