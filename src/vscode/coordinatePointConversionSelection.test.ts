import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { currentRuntimeElementIdsForSourceStatementIndexes } from "./coordinatePointConversionSelection";

const compiledFor = (source: string) => compileDslDocument(source);

describe("coordinate-point conversion Canvas selection identity", () => {
  it("resolves ordinary Source statement indexes to current root runtime IDs", () => {
    const compiled = compiledFor([
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = offset(from: @Base, dx: 10, dy: 5)"
    ].join("\n"));
    const target = compiled.document!.elements.find((element) => element.name === "Target")!;
    const sourceStatementIndex = compiled.statementMap!.byElementId.get(target.id)!.statementIndex;

    expect(currentRuntimeElementIdsForSourceStatementIndexes(compiled, [sourceStatementIndex])).toEqual([target.id]);
  });

  it.each([
    ["missing", [99]],
    ["duplicate request", [2, 2]]
  ] as const)("fails closed for %s Source ownership", (_label, indexes) => {
    const compiled = compiledFor([
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = offset(from: @Base, dx: 10, dy: 5)"
    ].join("\n"));

    expect(currentRuntimeElementIdsForSourceStatementIndexes(compiled, indexes)).toBeNull();
  });
});
