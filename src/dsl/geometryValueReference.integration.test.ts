import { describe, expect, it } from "vitest";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { parseDsl } from "@nuinuicad/nui-language";
import { unwrapModuleGeometrySourceTarget } from "@nuinuicad/nui-language";
import { pureGeometryValueConstructionCandidates } from "@nuinuicad/nui-language";

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
    expect(errorCodes(mutable)).toContain("unknown-dsl-keyword");
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
    expect(pureGeometryValueConstructionCandidates("point").map((candidate) => candidate.label)).toEqual(["coordinate", "offset", "polar", "between", "onLine", "intersection", "tangentOffset", "bezierExtremePoint", "bezierBulgePoint"]);
    expect(pureGeometryValueConstructionCandidates("line").map((candidate) => candidate.label)).toEqual(["segment", "polar", "commonTangent"]);
    expect(pureGeometryValueConstructionCandidates("path").map((candidate) => candidate.label)).toEqual(["segment", "polar", "commonTangent", "offset", "join", "polyline", "transformCopy", "mirrorCopy", "bezier", "arc", "through"]);
    expect(pureGeometryValueConstructionCandidates("point").map((candidate) => candidate.label)).not.toContain("through");
    expect(pureGeometryValueConstructionCandidates("line").map((candidate) => candidate.label)).not.toContain("through");
    expect(pureGeometryValueConstructionCandidates("point").map((candidate) => candidate.label)).not.toContain("transformCopy");
    expect(pureGeometryValueConstructionCandidates("line").map((candidate) => candidate.label)).not.toContain("transformCopy");
    expect(pureGeometryValueConstructionCandidates("point").map((candidate) => candidate.label)).not.toContain("mirrorCopy");
    expect(pureGeometryValueConstructionCandidates("line").map((candidate) => candidate.label)).not.toContain("mirrorCopy");

    const missingRequiredChoice = compile([
      "nui 1",
      "const Missing: line = commonTangent(first: (0, 0), second: (10, 0), kind: external)"
    ].join("\n"));
    expect(missingRequiredChoice.diagnostics.some((diagnostic) => diagnostic.message.includes("必須引数「side」"))).toBe(true);
  });

  it("registers point and strict-line polar constructions with shared reference and scalar sites", () => {
    const compiled = compile([
      "nui 1",
      "point Base = coordinate(x: 1, y: 2)",
      "const P: point = polar(from: @Base, angle: 90, distance: 20)",
      "const L: line = polar(start: @P, angle: 30, length: 100)",
      "const Broad: path = polar(start: @P, angle: 0, length: 5)"
    ].join("\n"), "geometry-value-polar");

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.moduleSemanticAnalysis?.geometryValues.map((value) => value.construction?.kind)).toEqual([
      "polarPoint",
      "polarLine",
      "polarLine"
    ]);
    expect(compiled.moduleSemanticAnalysis?.geometryValues[0]?.construction).toMatchObject({
      kind: "polarPoint",
      from: { target: { kind: "sourceGeometry", geometryKind: "point" } },
      angle: { ast: { kind: "numberLiteral", value: 90 } },
      distance: { ast: { kind: "numberLiteral", value: 20 } }
    });
    expect(compiled.moduleSemanticAnalysis?.geometryValues[1]?.construction).toMatchObject({
      kind: "polarLine",
      start: { target: { kind: "geometryValue" } },
      angle: { ast: { kind: "numberLiteral", value: 30 } },
      length: { ast: { kind: "numberLiteral", value: 100 } }
    });
    expect(compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get("geometry-value-polar:2")?.map((site) => site.parameterKey)).toEqual(["from"]);
    expect(compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get("geometry-value-polar:3")?.map((site) => site.parameterKey)).toEqual(["start"]);
    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual([
      "polarPoint",
      "polarLine",
      "polarLine"
    ]);
  });

  it("registers pure between and onLine with explicit placement modes and full line targets", () => {
    const compiled = compile([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 100, y: 0)",
      "const M: point = between(start: @A, end: @B, ratio: 0.5)",
      "const D: point = between(start: @A, end: @B, distance: 25)",
      "const L: line = segment(start: @A, end: @B)",
      "const P: point = onLine(from: @L.start, ratio: 0.5)",
      "const Q: point = onLine(from: @L.end, distance: 25)"
    ].join("\n"), "geometry-value-division");

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.moduleSemanticAnalysis?.geometryValues.map((value) => value.construction?.kind)).toEqual([
      "coordinate", "coordinate", "between", "between", "segment", "onLine", "onLine"
    ]);
    expect(compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "M")?.construction).toMatchObject({
      kind: "between",
      start: { target: { kind: "geometryValue" } },
      end: { target: { kind: "geometryValue" } },
      placement: { kind: "ratio", value: { ast: { kind: "numberLiteral", value: 0.5 } } }
    });
    expect(compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "P")?.construction).toMatchObject({
      kind: "onLine",
      from: { target: { kind: "geometryValue", pointKey: "start" } },
      line: { target: { kind: "geometryValue" } },
      endpointKey: "start",
      placement: { kind: "ratio", value: { ast: { kind: "numberLiteral", value: 0.5 } } }
    });
    expect(compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get("geometry-value-division:3")?.map((site) => site.parameterKey)).toEqual(["start", "end"]);
    expect(compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get("geometry-value-division:6")?.map((site) => site.parameterKey)).toEqual(["from"]);
    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual([
      "coordinate", "coordinate", "between", "between", "segment", "onLine", "onLine"
    ]);
  });

  it("preserves the resolved stage and endpoint target when lowering pure onLine paths", () => {
    const compiled = compile([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as shifted(from: (0, 0), to: (0, 20))",
      "move L as finish(from: (0, 20), to: (0, 50))",
      "const BaseStart: point = onLine(from: @L.base.start, ratio: 0)",
      "const ShiftedStart: point = onLine(from: @L.shifted.start, ratio: 0)",
      "const FinalStart: point = onLine(from: @L.final.start, ratio: 0)",
      "const ShiftedEnd: point = onLine(from: @L.shifted.end, distance: 2)",
      "const Alias: path = @L.shifted",
      "const AliasStart: point = onLine(from: @Alias.start, ratio: 0)",
      "module M(source: path) {",
      "  const LocalEnd: point = onLine(from: @source.end, distance: 2)",
      "}",
      "instance Use = M(source: @L.shifted)",
      "module Provider() {",
      "  export line Edge = segment(start: (0, 0), end: (10, 0))",
      "  move Edge as shifted(from: (0, 0), to: (0, 20))",
      "}",
      "instance ProviderInstance = Provider()",
      "const ExportedStart: point = onLine(from: @ProviderInstance::Edge.shifted.start, ratio: 0)"
    ].join("\n"), "geometry-value-on-line-stage");

    expect(compiled.diagnostics).toEqual([]);

    const constructionFor = (name: string) => {
      const value = compiled.moduleSemanticAnalysis?.geometryValues.find((candidate) => candidate.name === name);
      if (value?.construction?.kind !== "onLine") throw new Error(`expected onLine construction for ${name}`);
      return value.construction;
    };
    for (const [name, stagePath, endpointKey] of [
      ["BaseStart", ["base"], "start"],
      ["ShiftedStart", ["shifted"], "start"],
      ["FinalStart", ["final"], "start"],
      ["ShiftedEnd", ["shifted"], "end"]
    ] as const) {
      const construction = constructionFor(name);
      expect(construction.from.target).toMatchObject({ pointKey: endpointKey, stagePath });
      expect(construction.line).toMatchObject({
        expectedGeometryKind: "line",
        role: "lineReference",
        target: { kind: "sourceGeometry", stagePath }
      });
      expect(construction.line.target).not.toHaveProperty("pointKey");
      expect(construction.endpointKey).toBe(endpointKey);
    }
    expect(constructionFor("ShiftedEnd").placement.kind).toBe("distance");

    const loweredFor = (sourceStatementIndex: number) => {
      const entry = compiled.geometryValueProgram?.find((candidate) => candidate.sourceStatementIndex === sourceStatementIndex);
      if (entry?.construction.kind !== "onLine") throw new Error(`expected lowered onLine program at ${sourceStatementIndex}`);
      return entry.construction;
    };
    const lineId = compiled.document?.elements.find((element) => element.name === "L")?.id;
    for (const [sourceStatementIndex, stagePath] of [
      [4, ["base"]],
      [5, ["shifted"]],
      [6, ["final"]],
      [7, ["shifted"]]
    ] as const) {
      expect(loweredFor(sourceStatementIndex).line.target).toMatchObject({
        statementId: lineId,
        geometryType: "line",
        stagePath
      });
      expect(loweredFor(sourceStatementIndex).line.target).not.toHaveProperty("pointKey");
    }

    const alias = constructionFor("AliasStart");
    expect(alias.line.target).toMatchObject({
      kind: "geometryValue",
      backingTarget: { kind: "sourceGeometry", stagePath: ["shifted"] }
    });
    expect(alias.line.target).not.toHaveProperty("pointKey");
    expect(loweredFor(9).line.target).toMatchObject({ statementId: lineId, stagePath: ["shifted"] });

    const exported = constructionFor("ExportedStart");
    expect(exported.line.target).toMatchObject({
      kind: "deferredModuleExport",
      instanceName: "ProviderInstance",
      exportName: "Edge",
      expectedGeometryKind: "line",
      expectedInterfaceType: "path",
      stagePath: ["shifted"]
    });
    expect(exported.line.target).not.toHaveProperty("pointKey");

    const module = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "M");
    const localEnd = module?.localGeometryValues.find((value) => value.name === "LocalEnd")?.construction;
    if (localEnd?.kind !== "onLine") throw new Error("expected Module-local onLine construction");
    expect(localEnd.line).toMatchObject({
      expectedGeometryKind: "line",
      role: "lineReference",
      target: { kind: "parameter", geometryKind: "line" }
    });
    expect(localEnd.line.target).not.toHaveProperty("pointKey");
    expect(localEnd.endpointKey).toBe("end");
  });

  it("registers pure Bezier feature points with path sources, scalar defaults, and reference sites", () => {
    const compiled = compile([
      "nui 1",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0))",
      "const Extreme: point = bezierExtremePoint(source: @Curve, direction: 90)",
      "const Bulge: point = bezierBulgePoint(source: @Curve, segmentIndex: 0)"
    ].join("\n"), "geometry-value-bezier-feature-points");

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.moduleSemanticAnalysis?.geometryValues.map((value) => value.construction?.kind)).toEqual([
      "bezier", "bezierExtremePoint", "bezierBulgePoint"
    ]);
    const extreme = compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "Extreme");
    expect(extreme?.construction).toMatchObject({
      kind: "bezierExtremePoint",
      source: { target: { kind: "geometryValue" } },
      segmentIndex: { ast: { kind: "numberLiteral", value: 0 } },
      direction: { ast: { kind: "numberLiteral", value: 90 } }
    });
    expect(compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get(extreme!.statementId)?.map((site) => site.parameterKey)).toEqual(["source"]);
    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual([
      "bezier", "bezierExtremePoint", "bezierBulgePoint"
    ]);
  });

  it("registers pure tangentOffset with line, base, mode, and distance references", () => {
    const compiled = compile([
      "nui 1",
      "const Line: path = segment(start: (0, 0), end: (10, 0))",
      "const Base: point = coordinate(x: 0, y: 0)",
      "const Explicit: point = tangentOffset(line: @Line, base: @Base, angle: 90, distance: 2)",
      "const Default: point = tangentOffset(line: @Line, base: @Base, distance: 2)",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "const Convex: point = tangentOffset(line: @Curve, base: (5, 7.5), curveSide: convex, distance: 1)"
    ].join("\n"), "geometry-value-tangent-offset");

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.moduleSemanticAnalysis?.geometryValues.map((value) => value.construction?.kind)).toEqual([
      "segment", "coordinate", "tangentOffset", "tangentOffset", "bezier", "tangentOffset"
    ]);
    const explicit = compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "Explicit");
    const curve = compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "Convex");
    expect(explicit?.construction).toMatchObject({
      kind: "tangentOffset",
      line: { target: { kind: "geometryValue" } },
      base: { target: { kind: "geometryValue" } },
      angle: { ast: { kind: "numberLiteral", value: 90 } },
      curveSide: null,
      distance: { ast: { kind: "numberLiteral", value: 2 } }
    });
    expect(curve?.construction).toMatchObject({
      kind: "tangentOffset",
      angle: null,
      curveSide: { ast: { kind: "unresolvedChoiceLiteral", raw: "convex" } }
    });
    expect(compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get(explicit!.statementId)?.map((site) => site.parameterKey)).toEqual(["line", "base"]);
    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual([
      "segment", "coordinate", "tangentOffset", "tangentOffset", "bezier", "tangentOffset"
    ]);
  });

  it("requires exactly one pure division placement mode", () => {
    const missing = compile([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 10, y: 0)",
      "const Missing: point = between(start: @A, end: @B)"
    ].join("\n"), "geometry-value-missing-placement");
    expect(errorCodes(missing)).toContain("geometry-value-placement-required");
    expect(missing.geometryValueProgram?.some((entry) => entry.sourceStatementId.endsWith(":3"))).toBe(false);

    const simultaneous = compile([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 10, y: 0)",
      "const L: line = segment(start: @A, end: @B)",
      "const Both: point = onLine(from: @L.start, distance: 1, ratio: 0.5)"
    ].join("\n"), "geometry-value-simultaneous-placement");
    expect(simultaneous.diagnostics.some((diagnostic) => diagnostic.message.includes("同時に指定できません"))).toBe(true);
  });

  it("uses the existing point-reference restrictions for point polar", () => {
    const compiled = compile([
      "nui 1",
      "const Invalid: point = polar(from: (1, 2), angle: 0, distance: 1)"
    ].join("\n"), "geometry-value-polar-coordinate");

    expect(errorCodes(compiled)).toContain("module-geometry-type-mismatch");
  });

  it("registers point and path offset as pure constructions with resolved sources", () => {
    const compiled = compile([
      "nui 1",
      "point BasePoint = coordinate(x: 1, y: 2)",
      "line BaseLine = segment(start: (0, 0), end: (10, 0))",
      "const P: point = offset(from: @BasePoint, dx: 1 + 2, dy: -4)",
      "const Path: path = offset(sources: [@BaseLine], distance: 2, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n"), "geometry-value-offset");

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.moduleSemanticAnalysis?.geometryValues.map((value) => value.construction?.kind)).toEqual([
      "offsetPoint",
      "offsetPath"
    ]);
    const path = compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "Path");
    expect(path?.construction).toMatchObject({
      kind: "offsetPath",
      sources: [{ target: { kind: "sourceGeometry", geometryKind: "line" } }],
      distance: { type: { kind: "number" } },
      side: { type: { kind: "choice", options: ["right", "left"] } },
      closed: { type: { kind: "boolean" } },
      suppressTrimWarnings: { type: { kind: "boolean" } }
    });
    expect(compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get(path!.statementId)?.map((site) => site.parameterKey)).toEqual(["sources:0"]);
    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual(["offsetPoint", "offsetPath"]);
  });

  it("registers copy constructions as path values with every reference site", () => {
    const compiled = compile([
      "nui 1",
      "point Start = coordinate(x: 0, y: 0)",
      "point End = coordinate(x: 0, y: 10)",
      "line First = segment(start: (0, 0), end: (10, 0))",
      "line Second = segment(start: (10, 0), end: (20, 0))",
      "const Copied: path = transformCopy(startPoint: @Start, endPoint: @End, scale: 2, angleDeg: 15, mirrorX: true, baseLines: [@First, @Second])",
      "const Mirrored: path = mirrorCopy(axis1: @Start, axis2: @End, baseLines: [@First, @Second])"
    ].join("\n"), "geometry-value-copy");

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.moduleSemanticAnalysis?.geometryValues.map((value) => value.construction?.kind)).toEqual([
      "transformCopy",
      "mirrorCopy"
    ]);
    const start = compiled.document?.elements.find((element) => element.name === "Start");
    const end = compiled.document?.elements.find((element) => element.name === "End");
    const first = compiled.document?.elements.find((element) => element.name === "First");
    const second = compiled.document?.elements.find((element) => element.name === "Second");
    if (!start || !end || !first || !second) throw new Error("expected named copy references");
    const copied = compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "Copied");
    expect(copied?.construction).toMatchObject({
      kind: "transformCopy",
      startPoint: { target: { kind: "sourceGeometry", statementId: start.id, geometryKind: "point" } },
      endPoint: { target: { kind: "sourceGeometry", statementId: end.id, geometryKind: "point" } },
      scale: { ast: { kind: "numberLiteral", value: 2 } },
      angleDeg: { ast: { kind: "numberLiteral", value: 15 } },
      mirrorX: { ast: { kind: "booleanLiteral", value: true } },
      baseLines: [
        { target: { kind: "sourceGeometry", statementId: first.id, geometryKind: "line" } },
        { target: { kind: "sourceGeometry", statementId: second.id, geometryKind: "line" } }
      ]
    });
    const copiedSites = compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get(copied!.statementId);
    expect(copiedSites?.map((site) => site.parameterKey)).toEqual(["startPoint", "endPoint", "baseLines:0", "baseLines:1"]);
    expect(copiedSites?.map((site) => site.reference.target)).toEqual([
      expect.objectContaining({ kind: "sourceGeometry", statementId: start.id }),
      expect.objectContaining({ kind: "sourceGeometry", statementId: end.id }),
      expect.objectContaining({ kind: "sourceGeometry", statementId: first.id }),
      expect.objectContaining({ kind: "sourceGeometry", statementId: second.id })
    ]);
    const mirrored = compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "Mirrored");
    const mirroredSites = compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get(mirrored!.statementId);
    expect(mirroredSites?.map((site) => site.parameterKey)).toEqual(["axis1", "axis2", "baseLines:0", "baseLines:1"]);
    expect(mirroredSites?.map((site) => site.reference.target)).toEqual([
      expect.objectContaining({ kind: "sourceGeometry", statementId: start.id }),
      expect.objectContaining({ kind: "sourceGeometry", statementId: end.id }),
      expect.objectContaining({ kind: "sourceGeometry", statementId: first.id }),
      expect.objectContaining({ kind: "sourceGeometry", statementId: second.id })
    ]);
    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual(["transformCopy", "mirrorCopy"]);
  });

  it("allows copy constructions for path values but rejects strict line values at compile time", () => {
    const compiled = compile([
      "nui 1",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "const Transform: line = transformCopy(startPoint: (0, 0), endPoint: (10, 0), baseLines: [@Base])",
      "const Mirror: line = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [@Base])"
    ].join("\n"), "geometry-value-copy-interface");

    expect(errorCodes(compiled)).toEqual([
      "module-geometry-type-mismatch",
      "module-geometry-type-mismatch"
    ]);
    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual(["transformCopy", "mirrorCopy"]);
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
    expect(errorCodes(forwardTarget)).not.toContain("module-forward-geometry-reference");
  });

  it("resolves same-scope forward typed aliases using the target geometry value identity", () => {
    const exact = compile([
      "nui 1",
      "const b: point = @a",
      "const a: point = coordinate(x: 2, y: 3)"
    ].join("\n"));
    expect(errorCodes(exact)).toEqual([]);
    const exactValues = exact.moduleSemanticAnalysis?.geometryValues ?? [];
    const exactB = exactValues.find((value) => value.name === "b");
    const exactA = exactValues.find((value) => value.name === "a");
    expect(exactB?.initializer?.target).toMatchObject({
      kind: "geometryValue",
      statementId: exactA?.statementId,
      statementIndex: exactA?.statementIndex,
      declaredInterfaceType: "point",
      backingTarget: null
    });

    const reversed = compile([
      "nui 1",
      "const a: point = coordinate(x: 2, y: 3)",
      "const b: point = @a"
    ].join("\n"));
    expect(errorCodes(reversed)).toEqual([]);

    const paddedChain = compile([
      "nui 1",
      "const unrelatedScalar: number = 17",
      "point unrelatedGeometry = coordinate(x: 90, y: 80)",
      "",
      "const first: point = @second",
      "",
      "const padding: number = 23",
      "const second: point = @third",
      "point anotherUnrelatedGeometry = coordinate(x: 70, y: 60)",
      "",
      "const third: point = coordinate(x: 2, y: 3)"
    ].join("\n"));
    expect(errorCodes(paddedChain)).toEqual([]);
    const chainValues = paddedChain.moduleSemanticAnalysis?.geometryValues ?? [];
    const first = chainValues.find((value) => value.name === "first");
    const second = chainValues.find((value) => value.name === "second");
    const third = chainValues.find((value) => value.name === "third");
    expect(first?.initializer?.target).toMatchObject({
      kind: "geometryValue",
      statementId: second?.statementId,
      declaredInterfaceType: "point",
      backingTarget: null
    });
    expect(second?.initializer?.target).toMatchObject({
      kind: "geometryValue",
      statementId: third?.statementId,
      declaredInterfaceType: "point",
      backingTarget: null
    });
  });

  it("keeps incompatible forward alias types and true alias cycles invalid", () => {
    const incompatible = compile([
      "nui 1",
      "const edge: line = @laterPoint",
      "const laterPoint: point = coordinate(x: 2, y: 3)"
    ].join("\n"));
    expect(errorCodes(incompatible)).toContain("module-geometry-type-mismatch");

    const cycle = compile([
      "nui 1",
      "const first: point = @second",
      "const second: point = @first"
    ].join("\n"));
    expect(errorCodes(cycle)).toContain("dependency-cycle");
  });

  it("retains Module ownership and outer-capture checks for forward typed aliases", () => {
    const sameModule = compile([
      "nui 1",
      "module M() {",
      "  const later: point = @earlier",
      "  const earlier: point = coordinate(x: 2, y: 3)",
      "  line Use = segment(start: @later, end: (0, 0))",
      "}",
      "instance I = M()"
    ].join("\n"));
    expect(errorCodes(sameModule)).toEqual([]);
    const moduleDefinition = sameModule.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "M");
    const localLater = moduleDefinition?.localGeometryValues.find((value) => value.name === "later");
    const localEarlier = moduleDefinition?.localGeometryValues.find((value) => value.name === "earlier");
    expect(localLater?.initializer?.target).toMatchObject({
      kind: "geometryValue",
      statementId: localEarlier?.statementId,
      declaredInterfaceType: "point",
      backingTarget: null,
      ownerModuleDefinitionStatementId: moduleDefinition?.statementId,
      ownerModuleDefinitionStatementIndex: moduleDefinition?.statementIndex
    });

    const outerCapture = compile([
      "nui 1",
      "const outside: point = coordinate(x: 2, y: 3)",
      "module M() {",
      "  const inside: point = @outside",
      "}",
      "instance I = M()"
    ].join("\n"));
    expect(errorCodes(outerCapture)).toContain("module-outer-capture");
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
