import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compile = (source: string, prefix = "geometry-value") => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `${prefix}:${index}`] as const))
  });
};

const errorCodes = (compiled: ReturnType<typeof compile>) =>
  compiled.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code)
    .filter((code): code is string => Boolean(code));

describe("immutable single-geometry reference values", () => {
  it("preserves point/line/path interfaces through root aliases and chains", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "const origin: point = @A",
      "const strict: line = @AB",
      "const broad: path = @strict",
      "const chained: path = @broad"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["A", "AB"]);
    expect(compiled.moduleSemanticAnalysis?.geometryValues.map((value) => [value.name, value.declaredInterfaceType])).toEqual([
      ["origin", "point"],
      ["strict", "line"],
      ["broad", "path"],
      ["chained", "path"]
    ]);
    expect(compiled.scalarProgram?.statements ?? []).toEqual([]);
  });

  it("unwraps point and line/path aliases at ordinary geometry consumer boundaries", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "const P: point = @A",
      "line L = segment(start: @P, end: @B)",
      "const Broad: path = @L",
      "line Copy = transformCopy(startPoint: (0, 0), endPoint: (10, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@Broad])"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["A", "B", "L", "Copy"]);
    const a = compiled.document?.elements.find((element) => element.name === "A");
    const l = compiled.document?.elements.find((element) => element.name === "L");
    const copy = compiled.document?.elements.find((element) => element.name === "Copy");
    expect(l).toMatchObject({ startPoint: { mode: "reference", pointId: a?.id } });
    expect(copy).toMatchObject({ baseLineIds: [l?.id] });
  });

  it("passes aliased geometry through scalar property reads without making the alias scalar", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 3, y: 4)",
      "const origin: point = @A",
      "const originX: number = @origin.x",
      "const originDistance: number = distance(@origin, @A)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.scalarProgram?.statements).toHaveLength(2);
    expect(compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "origin")?.declaredInterfaceType).toBe("point");
  });

  it("enforces directional geometry assignability and keeps geometry out of scalar bindings", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "const broad: path = @AB",
      "const badLine: line = @broad",
      "const badPoint: point = @AB",
      "const badPath: path = @A",
      "const badNumber: number = @A"
    ].join("\n"));

    expect(errorCodes(compiled)).toEqual(expect.arrayContaining([
      "module-geometry-type-mismatch",
      "scalar-namespace-type-mismatch"
    ]));
    expect(compiled.scalarProgram?.statements).toHaveLength(1);
  });

  it("accepts only existing @geometry references and requires const", () => {
    const construction = compile([
      "nui 1",
      "const origin: point = coordinate(x: 0, y: 0)"
    ].join("\n"));
    expect(errorCodes(construction)).toContain("geometry-value-reference-required");
    expect(construction.document).toBeNull();

    const mutable = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "let origin: point = @A"
    ].join("\n"));
    expect(errorCodes(mutable)).toContain("geometry-value-const-only");
    expect(mutable.document).toBeNull();
  });

  it("retains existing undefined and forward-reference diagnostics for aliases", () => {
    const undefinedTarget = compile("nui 1\nconst missing: point = @Missing");
    expect(errorCodes(undefinedTarget)).toContain("module-undefined-geometry-reference");

    const forwardTarget = compile([
      "nui 1",
      "const forward: point = @Later",
      "point Later = coordinate(x: 0, y: 0)"
    ].join("\n"));
    expect(errorCodes(forwardTarget)).toContain("module-forward-geometry-reference");
  });

  it("does not recover a narrower Module type from an alias backing target", () => {
    const compiled = compile([
      "nui 1",
      "module M(source: path) {",
      "  const broad: path = @source",
      "  const invalid: line = @broad",
      "}",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "instance Use = M(source: @Base)"
    ].join("\n"));

    expect(errorCodes(compiled)).toContain("module-geometry-type-mismatch");
  });

  it("resolves module parameter, local, exported, and qualified aliases through existing runtime targets", () => {
    const compiled = compile([
      "nui 1",
      "module M(source: point, edge: line, broad: path) {",
      "  const localPoint: point = @source",
      "  const localX: number = @localPoint.x",
      "  const localLine: line = @edge",
      "  const localPath: path = @localLine",
      "  export const output: point = @localPoint",
      "  export const outputPath: path = @localPath",
      "}",
      "point Origin = coordinate(x: 3, y: 4)",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "instance One = M(source: @Origin, edge: @Base, broad: @Base)",
      "line Use = transformCopy(startPoint: (0, 0), endPoint: (10, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@One::outputPath])"
    ].join("\n"), "module-geometry-value");

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "M")?.localGeometryValues.map((value) => value.name)).toEqual([
      "localPoint", "localLine", "localPath", "output", "outputPath"
    ]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Origin", "Base", "One", "Use"]);
    const base = compiled.document?.elements.find((element) => element.name === "Base");
    const use = compiled.document?.elements.find((element) => element.name === "Use");
    expect(use).toMatchObject({ baseLineIds: [base?.id] });
  });
});
