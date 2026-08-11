import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import {
  sourceOwnerByRuntimeElementId,
  sourceOwnerForRuntimeElementId
} from "./sourceOwnership";

const compileWithStableIds = (source: string) => {
  const parsed = parseDsl(source);
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `stable:${index}`]))
  });
  if (!compiled.document || !compiled.statementMap) throw new Error("source ownership fixture did not compile");
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return { ...compiled, document: compiled.document, statementMap: compiled.statementMap };
};

describe("source ownership", () => {
  const source = [
    "nui 3",
    "point Outside = coordinate(x: 0, y: 0)",
    "module Inner() {",
    "  point InnerPoint = coordinate(x: 1, y: 2)",
    "}",
    "module Outer() {",
    "  module Nested = Inner()",
    "}",
    "module First = Outer()",
    "module Second = Outer()"
  ].join("\n");

  it("resolves ordinary elements through StatementMap.byElementId", () => {
    const compiled = compileWithStableIds(source);
    const outside = compiled.document!.elements.find((element) => element.name === "Outside")!;
    const owner = sourceOwnerForRuntimeElementId(compiled, outside.id);

    expect(owner).toMatchObject({
      kind: "ordinary",
      sourceStatementId: "stable:1",
      sourceStatementIndex: 1,
      statement: { statementIndex: 1, line: 2 }
    });
    expect(compiled.statementMap!.statementRangeById.get("stable:1")).toBe(owner!.statement);
  });

  it("resolves module instances to their call statements", () => {
    const compiled = compileWithStableIds(source);
    const first = compiled.document!.elements.find((element) => element.name === "First")!;
    const owner = sourceOwnerForRuntimeElementId(compiled, first.id);

    expect(owner).toMatchObject({
      kind: "moduleInstance",
      sourceStatementId: "stable:8",
      sourceStatementIndex: 8,
      statement: { statementIndex: 8, line: 9 }
    });
  });

  it("resolves repeated and nested materialized children to the same definition source", () => {
    const compiled = compileWithStableIds(source);
    const firstNestedPoint = compiled.document!.elements.find(
      (element) => element.name === "InnerPoint" && element.parentGroupId === compiled.document!.elements.find((item) => item.name === "Nested" && item.parentGroupId === compiled.document!.elements.find((item) => item.name === "First")!.id)!.id
    )!;
    const secondNestedPoint = compiled.document!.elements.find(
      (element) => element.name === "InnerPoint" && element.parentGroupId === compiled.document!.elements.find((item) => item.name === "Nested" && item.parentGroupId === compiled.document!.elements.find((item) => item.name === "Second")!.id)!.id
    )!;
    const firstOwner = sourceOwnerForRuntimeElementId(compiled, firstNestedPoint.id);
    const secondOwner = sourceOwnerForRuntimeElementId(compiled, secondNestedPoint.id);

    expect(firstOwner).toMatchObject({ kind: "moduleBody", sourceStatementId: "stable:3", sourceStatementIndex: 3 });
    expect(secondOwner).toMatchObject({ kind: "moduleBody", sourceStatementId: "stable:3", sourceStatementIndex: 3 });
    expect(firstOwner!.statement).toBe(secondOwner!.statement);
    expect(sourceOwnerByRuntimeElementId(compiled).get(firstNestedPoint.id)?.statement).toBe(firstOwner!.statement);
    expect(compiled.statementMap!.statementRangeById.get("stable:3")).toBe(firstOwner!.statement);
  });
});
