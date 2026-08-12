import { describe, expect, it } from "vitest";
import {
  DSL_GEOMETRY_DECLARATION_CATEGORIES,
  MUTATION_CATEGORY,
  constructionCandidatesFor,
  isGeometryDeclarationCategory,
} from "./dslConstructions";
import { parseDslExportStatement, parseDslExportedGeometryStatement } from "./dslExportParser";

describe("DSL exported geometry parser", () => {
  it.each(DSL_GEOMETRY_DECLARATION_CATEGORIES)("accepts canonical geometry category: %s", (category) => {
    const construction = constructionCandidatesFor(category)[0]?.construction;
    expect(construction).toBeDefined();
    if (!construction) return;

    const result = parseDslExportedGeometryStatement(`export ${category} P = ${construction}()`);
    expect(isGeometryDeclarationCategory(category)).toBe(true);
    expect(result.call.statement).toMatchObject({ category, name: "P" });
    expect(result.call.diagnostics).not.toContainEqual(expect.objectContaining({
      message: "export の後には geometry declaration が必要です。"
    }));
  });

  const nonGeometryExports = [
    { category: "group", source: "export group G {" },
    { category: "if", source: "export if (true) {" },
    { category: "for", source: "export for (i from: 0, count: 1) {" },
    { category: MUTATION_CATEGORY, source: "export move(targets: L, from: A, to: B)" },
  ] as const;

  it.each(nonGeometryExports)("rejects non-geometry category $category", ({ category, source }) => {
    const result = parseDslExportedGeometryStatement(source);
    expect(isGeometryDeclarationCategory(category)).toBe(false);
    expect(result.call.statement).toBeNull();
    expect(result.call.diagnostics).toEqual([
      { message: "export の後には geometry declaration が必要です。", span: { start: 7, end: source.length } }
    ]);
  });

  it("parses a typed scalar export through the existing export parser", () => {
    const result = parseDslExportStatement("export const length: number = 1");
    expect(result.kind).toBe("typedDeclaration");
    expect(result.diagnostics).toEqual([]);
    expect(result.declaration?.diagnostics).toEqual([]);
    expect(result.declaration?.statement).toMatchObject({
      kind: "typedDeclaration",
      name: "length",
      declaredType: { kind: "number" },
      exported: true,
      exportSpan: { start: 0, end: 6 }
    });
  });
});
