import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import { unwrapModuleGeometrySourceTarget } from "./moduleSemanticTypes";
import { pureGeometryValueConstructionCandidates } from "./dslCallCompletionCandidates";

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

  it("retains derived point identity through alias chains and ordinary consumers", () => {
    const compiled = compile([
      "nui 1",
      "line AB = segment(start: (2, 3), end: (10, 7))",
      "point Other = coordinate(x: 2, y: 3)",
      "const P: point = @AB.start",
      "const P2: point = @P",
      "line L = segment(start: @P2, end: (20, 7))",
      "const x: number = @P2.x",
      "const d: number = distance(@P2, @Other)"
    ].join("\n"), "geometry-derived-point");

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["AB", "Other", "L"]);
    const p2 = compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "P2");
    expect(p2?.backingTarget).not.toBeNull();
    expect(unwrapModuleGeometrySourceTarget(p2!.backingTarget!).target).toMatchObject({ kind: "sourceGeometry", pointKey: "start" });
    const p2Property = [...(compiled.moduleSemanticAnalysis?.rootScalarExpressionsByStatementId.values() ?? [])]
      .flatMap((site) => site.expression.geometryProperties)
      .find((property) => property.geometryName === "P2");
    expect(p2Property?.target).toMatchObject({ kind: "sourceGeometryProperty", pointKey: "start", property: "x" });
    const p2Builtin = [...(compiled.moduleSemanticAnalysis?.rootScalarExpressionsByStatementId.values() ?? [])]
      .flatMap((site) => site.expression.geometryBuiltinArguments)
      .find((argument) => argument.reference.source.trim() === "@P2");
    expect(p2Builtin?.reference.target).toMatchObject({ kind: "geometryValue" });
    expect(compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.size).toBeGreaterThan(0);
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

  it("accepts coordinate/segment constructions and requires const", () => {
    const construction = compile([
      "nui 1",
      "const origin: point = coordinate(x: 0, y: 0)"
    ].join("\n"));
    expect(construction.diagnostics).toEqual([]);
    expect(construction.document?.elements).toEqual([]);
    expect(construction.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual(["coordinate"]);

    const mutable = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "let origin: point = @A"
    ].join("\n"));
    expect(errorCodes(mutable)).toContain("geometry-value-const-only");
    expect(mutable.document).toBeNull();
  });

  it("registers direct arc as a path-only pure construction", () => {
    const compiled = compile([
      "nui 1",
      "const A: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "const BadLine: line = arc(center: (0, 0), radius: 10, start: 0, end: 90)",
      "const BadPoint: point = arc(center: (0, 0), radius: 10, start: 0, end: 90)"
    ].join("\n"), "geometry-value-arc");

    expect(errorCodes(compiled)).toEqual([
      "module-geometry-type-mismatch",
      "module-geometry-type-mismatch"
    ]);
    expect(compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "A")?.construction).toMatchObject({
      kind: "arc",
      center: { coordinate: { x: { type: { kind: "number" } }, y: { type: { kind: "number" } } } },
      radius: { type: { kind: "number" } },
      start: { type: { kind: "number" } },
      end: { type: { kind: "number" } },
      direction: { type: { kind: "choice", options: ["counterclockwise", "clockwise"] } }
    });
    expect(pureGeometryValueConstructionCandidates("point").map((candidate) => candidate.label)).toEqual(["coordinate"]);
    expect(pureGeometryValueConstructionCandidates("line").map((candidate) => candidate.label)).toEqual(["segment"]);
    expect(pureGeometryValueConstructionCandidates("path").map((candidate) => candidate.label)).toEqual(["segment", "bezier", "arc", "through"]);
    expect(pureGeometryValueConstructionCandidates("point").map((candidate) => candidate.label)).not.toContain("through");
    expect(pureGeometryValueConstructionCandidates("line").map((candidate) => candidate.label)).not.toContain("through");
  });

  it("accepts through as a path-only pure construction with resolved point sites and defaults", () => {
    const compiled = compile([
      "nui 1",
      "const P1: point = coordinate(x: 10, y: 0)",
      "const P2: point = coordinate(x: 0, y: 10)",
      "const P3: point = coordinate(x: -10, y: 0)",
      "const Through: path = through(point1: @P1, point2: @P2, point3: @P3)"
    ].join("\n"), "geometry-value-through");

    expect(compiled.diagnostics).toEqual([]);
    const value = compiled.moduleSemanticAnalysis?.geometryValues.find((candidate) => candidate.name === "Through");
    expect(value?.construction).toMatchObject({
      kind: "through",
      point1: { target: { kind: "geometryValue" } },
      point2: { target: { kind: "geometryValue" } },
      point3: { target: { kind: "geometryValue" } },
      start: { ast: { kind: "numberLiteral", value: 0 } },
      end: { ast: { kind: "numberLiteral", value: 90 } }
    });
    expect(compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get(value!.statementId)?.map((site) => site.parameterKey)).toEqual([
      "point1", "point2", "point3"
    ]);
    expect(compiled.geometryValueProgram?.[3]?.construction.kind).toBe("through");
  });

  it("rejects through for incompatible declared geometry interfaces", () => {
    const compiled = compile([
      "nui 1",
      "const PointValue: point = through(point1: (10, 0), point2: (0, 10), point3: (-10, 0))",
      "const LineValue: line = through(point1: (10, 0), point2: (0, 10), point3: (-10, 0))"
    ].join("\n"), "geometry-value-through-mismatch");

    expect(errorCodes(compiled)).toEqual([
      "module-geometry-type-mismatch",
      "module-geometry-type-mismatch"
    ]);
  });

  it("keeps construction interfaces and initializer argument spans source-owned", () => {
    const source = [
      "nui 1",
      "const P: point = coordinate(x: 10, y: 20)",
      "const AsPath: path = segment(start: @P, end: (30, 20))"
    ].join("\n");
    const compiled = compile(source, "geometry-value-spans");
    expect(compiled.diagnostics).toEqual([]);
    const values = compiled.moduleSemanticAnalysis?.geometryValues ?? [];
    const point = values.find((value) => value.name === "P")!;
    const path = values.find((value) => value.name === "AsPath")!;
    expect(point.declaredInterfaceType).toBe("point");
    expect(point.construction).toMatchObject({ kind: "coordinate" });
    const pointLineStart = source.indexOf("const P");
    expect(point.construction?.kind === "coordinate" && point.construction.x?.ast.span).toEqual({ start: source.indexOf("10") - pointLineStart, end: source.indexOf("10") - pointLineStart + 2 });
    expect(path.declaredInterfaceType).toBe("path");
    expect(path.construction).toMatchObject({ kind: "segment" });
    expect(path.construction?.kind === "segment" && path.construction.start.span).toEqual({
      start: source.indexOf("@P", source.indexOf("segment")) - source.indexOf("const AsPath"),
      end: source.indexOf("@P", source.indexOf("segment")) - source.indexOf("const AsPath") + 2
    });
  });

  it("typechecks the construction subset, accepts pure bezier, and preserves spans", () => {
    const incompatible = compile([
      "nui 1",
      "const badPoint: line = coordinate(x: 0, y: 0)",
      "const badLine: point = segment(start: (0, 0), end: (1, 0))"
    ].join("\n"), "geometry-value-construction-mismatch");
    expect(errorCodes(incompatible)).toEqual([
      "module-geometry-type-mismatch",
      "module-geometry-type-mismatch"
    ]);

    const bezier = compile([
      "nui 1",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 0, startLength: 3, endAngle: 180, endLength: 4, intermediates: [(5, 2): 90: 1: 2])"
    ].join("\n"), "geometry-value-bezier");
    expect(bezier.diagnostics).toEqual([]);
    expect(bezier.geometryValueProgram?.[0]?.construction).toMatchObject({
      kind: "bezier",
      startAngleDeg: { kind: "numberLiteral", value: 0 },
      startLength: { kind: "numberLiteral", value: 3 },
      endAngleDeg: { kind: "numberLiteral", value: 180 },
      endLength: { kind: "numberLiteral", value: 4 },
      intermediates: [{ angleDeg: { kind: "numberLiteral", value: 90 }, incomingLength: { kind: "numberLiteral", value: 1 }, outgoingLength: { kind: "numberLiteral", value: 2 } }]
    });

    const metadata = compile([
      "nui 1",
      "const P: point = coordinate(x: 0, y: 0, id: P)"
    ].join("\n"), "geometry-value-metadata");
    expect(errorCodes(metadata)).toContain("geometry-value-drawable-metadata");
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

  it("validates root aliases from Module geometry exports through deferred export sites", () => {
    const valid = compile([
      "nui 1",
      "module M() {",
      "  export line Edge = segment(start: (0, 0), end: (10, 0))",
      "  line Private = segment(start: (0, 0), end: (5, 0))",
      "}",
      "instance I = M()",
      "const Valid: path = @I::Edge",
      "line Copy = transformCopy(startPoint: (0, 0), endPoint: (10, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@Valid])"
    ].join("\n"), "geometry-export-alias-valid");
    expect(valid.diagnostics).toEqual([]);
    expect(valid.document?.elements.map((element) => element.name)).toEqual(["I", "Edge", "Private", "Copy"]);

    const invalid = compile([
      "nui 1",
      "module M() {",
      "  export line Edge = segment(start: (0, 0), end: (10, 0))",
      "  line Private = segment(start: (0, 0), end: (5, 0))",
      "}",
      "instance I = M()",
      "const Invalid: point = @I::Edge",
      "const Private: line = @I::Private",
      "const Missing: line = @I::Missing"
    ].join("\n"), "geometry-export-alias-invalid");

    expect(errorCodes(invalid)).toEqual(expect.arrayContaining([
      "module-geometry-type-mismatch",
      "module-private-member",
      "module-undefined-export"
    ]));
    expect(invalid.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.size).toBeGreaterThan(0);
  });
});
