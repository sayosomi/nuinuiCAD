import { describe, expect, it } from "vitest";
import { parseDsl } from "./dslParser";
import { buildGeometryArraySourceCatalog } from "./geometryArraySourceCatalog";

const catalog = (source: string) => {
  const parse = parseDsl(source);
  const stableStatementIdByIndex = new Map(parse.statements.map((_, index) => [index, `statement:${index}`]));
  return { parse, catalog: buildGeometryArraySourceCatalog({ parse, stableStatementIdByIndex }) };
};

describe("geometry array source catalog", () => {
  it("recovers root and module-local array types without widening the scalar AST", () => {
    const { parse, catalog: result } = catalog([
      "nui 4",
      "const root: path[] = []",
      "module M(edges: line[], anchors?: point[]) {",
      "  export const local: path[] = @edges",
      "}"
    ].join("\n"));

    expect(parse.diagnostics).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations.map((item) => ({
      id: item.statementId,
      name: item.name,
      type: item.type.elementType,
      owner: item.ownerModuleDefinitionStatementIndex,
      exported: item.exported
    }))).toEqual([
      { id: "statement:1", name: "root", type: "path", owner: null, exported: false },
      { id: "statement:3", name: "local", type: "path", owner: 2, exported: true }
    ]);
    expect(result.moduleParameters.map((item) => ({
      slot: `${item.definitionStatementId}:${item.parameterIndex}`,
      name: item.name,
      type: item.type.elementType,
      optional: item.optional
    }))).toEqual([
      { slot: "statement:2:0", name: "edges", type: "line", optional: false },
      { slot: "statement:2:1", name: "anchors", type: "point", optional: true }
    ]);
  });

  it("rejects geometry-array module defaults with the authored default span", () => {
    const source = "nui 4\nmodule M(edges: path[] = []) {\n}";
    const { catalog: result } = catalog(source);
    expect(result.moduleParameters).toHaveLength(1);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "geometry-array-parameter-default",
      physicalSpan: expect.objectContaining({ sourceRevision: 0 })
    }));
    const diagnostic = result.diagnostics.find((item) => item.code === "geometry-array-parameter-default")!;
    expect(diagnostic.physicalSpan?.segments.map((segment) => source.slice(segment.from, segment.to)).join(""))
      .toBe("[]");
  });

  it("does not catalog scalar, record, or singular geometry parameter types", () => {
    const { catalog: result } = catalog([
      "nui 4",
      "record R(x: number)",
      "const n: number = 1",
      "const r: R = R(x: 1)",
      "module M(p: point, n: number, r: R) {",
      "}"
    ].join("\n"));
    expect(result.declarations).toEqual([]);
    expect(result.moduleParameters).toEqual([]);
  });
});
