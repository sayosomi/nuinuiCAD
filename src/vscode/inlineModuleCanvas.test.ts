import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import type { CadElement } from "../types/geometry";
import { inlineModuleCanvasTargetProofsFor } from "./inlineModuleCanvas";

const sourceRevision = 19;

const compileCurrent = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  const ids = new Map(parsed.statements.map((_, index) => [index, `canvas-inline:${index}`]));
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedElementIds: ids,
    assignedStatementIds: ids
  });
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(compiled.statementMap).not.toBeNull();
  expect(compiled.moduleMaterialization).toBeDefined();
  return compiled;
};

const runtimeElementsFor = (compiled: CompiledDslDocument): CadElement[] =>
  [...(compiled.moduleMaterialization?.executionStatements ?? [])].map((entry) => ({
    id: entry.runtimeElementId,
    name: entry.statement.name,
    type: entry.type,
    activity: "visible"
  } as CadElement));

describe("Inline Module Canvas authored-owner projection", () => {
  it("accepts concrete module instances, ignores ordinary/module-body selection, and deduplicates authored owners", () => {
    const source = [
      "nui 1",
      "module Leaf() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "module Outer() {",
      "  instance Child = Leaf()",
      "}",
      "instance First = Outer()",
      "instance Second = Outer()"
    ].join("\n");
    const compiled = compileCurrent(source);
    const materialization = compiled.moduleMaterialization!;
    const runtimeElements = runtimeElementsFor(compiled);
    const childIds = [...materialization.originByRuntimeElementId.entries()]
      .filter(([, origin]) => origin.kind === "moduleInstance" && origin.sourceStatementIndex === 5)
      .map(([runtimeElementId]) => runtimeElementId);
    expect(childIds.length).toBeGreaterThanOrEqual(2);
    const bodyId = runtimeElements.find((element) => element.type !== "moduleInstance")?.id;
    expect(bodyId).toBeDefined();

    const proofs = inlineModuleCanvasTargetProofsFor({
      source: { normalizedSource: source, sourceRevision },
      compiled,
      elements: runtimeElements,
      selectedElementIds: [childIds[1]!, childIds[0]!, bodyId!],
      moduleMaterialization: materialization
    });

    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({
      sourceStatementIndex: 5,
      sourceStatementPath: [7, 5]
    });
  });

  it("does not consult the generic ordinary-owner selectedElementSources projection", () => {
    const source = [
      "nui 1",
      "module Leaf() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Copy = Leaf()"
    ].join("\n");
    const compiled = compileCurrent(source);
    const runtimeElements = runtimeElementsFor(compiled);
    const instanceId = runtimeElements.find((element) => element.type === "moduleInstance")?.id;
    expect(instanceId).toBeDefined();

    const proofs = inlineModuleCanvasTargetProofsFor({
      source: { normalizedSource: source, sourceRevision },
      compiled,
      elements: runtimeElements,
      selectedElementIds: [instanceId!],
      moduleMaterialization: compiled.moduleMaterialization
    });
    expect(proofs).toHaveLength(1);
  });
});
