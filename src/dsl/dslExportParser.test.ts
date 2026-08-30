import { describe, expect, it } from "vitest";
import {
  DSL_GEOMETRY_DECLARATION_CATEGORIES,
  MUTATION_CATEGORY,
  constructionCandidatesFor,
  isGeometryDeclarationCategory,
} from "./dslConstructions";
import { parseDslExportStatement, parseDslExportedGeometryStatement } from "./dslExportParser";
import { parseDsl } from "./dslParser";

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
    { category: "for", source: "export for (i, from: 0, count: 1) {" },
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

  it("parses only a direct top-level export module as public", () => {
    const source = [
      "nui 4",
      "export module Public(width: number = 40) {",
      "}",
      "module Private() {",
      "}",
      "module Outer() {",
      "  export module Nested() {",
      "  }",
      "}"
    ].join("\n");
    const parsed = parseDsl(source);
    const definitions = parsed.statements.filter((statement) => statement.kind === "moduleDefinition");

    expect(definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Public", exported: true }),
      expect.objectContaining({ name: "Private", exported: false }),
      expect.objectContaining({ name: "Nested", exported: true, enclosing: { statementIndex: 5, branch: "then" } })
    ]));
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-export-top-level-only" })
    ]));
    const publicDefinition = definitions.find((statement) => statement.name === "Public")!;
    expect(publicDefinition.exportSpan).toEqual({ start: 0, end: 6 });
    expect(publicDefinition.exportPhysicalSpan?.segments[0]).toMatchObject({ from: 6, to: 12 });
    expect(source.slice(
      publicDefinition.namePhysicalSpan!.segments[0]!.from,
      publicDefinition.namePhysicalSpan!.segments[0]!.to
    )).toBe("Public");
  });
});
