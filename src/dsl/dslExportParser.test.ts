import { describe, expect, it } from "vitest";
import {
  DSL_GEOMETRY_DECLARATION_CATEGORIES,
  MUTATION_CATEGORY,
  constructionCandidatesFor,
  isGeometryDeclarationCategory,
} from "./dslConstructions";
import { parseDslExportedGeometryStatement } from "./dslExportParser";

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
});
