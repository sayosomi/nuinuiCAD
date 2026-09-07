import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../../packages/nui-language/src/dsl/dslDocument";
import { parseDslSnapshot } from "../../packages/nui-language/src/dsl/dslParser";
import { buildEvaluationOptions } from "./productionEvaluationContext";
import { evaluateElements } from "./evaluate";
import { runtimeGeometryDiagnostics } from "./runtimeGeometryDiagnostics";
import type { LastGoodDslDocument } from "../document/canonicalDocument";

const compile = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `geometry-value-runtime:${index}`]))
  });
  return compiled as LastGoodDslDocument;
};

const evaluate = (source: string) => {
  const compiled = compile(source);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.document).not.toBeNull();
  const result = evaluateElements(
    compiled.document!.elements,
    buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined })
  );
  return { compiled, result };
};

describe("pure geometry construction runtime", () => {
  it.each([
    ["coordinate", "point", "line"],
    ["segment", "line", "point"]
  ] as const)("reports an incompatible %s construction through the occurrence-owned channel", (constructionKind, validInterface, incompatibleInterface) => {
    const compiled = compile([
      "nui 1",
      constructionKind === "coordinate"
        ? "const Value: point = coordinate(x: 1, y: 2)"
        : "const Value: line = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"));
    const entry = compiled.geometryValueProgram?.[0];
    expect(entry?.declaredInterfaceType).toBe(validInterface);
    if (!entry) throw new Error("expected compiled geometry value entry");

    const result = evaluateElements(compiled.document!.elements, {
      ...buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined }),
      geometryValueProgram: [{ ...entry, declaredInterfaceType: incompatibleInterface }]
    });

    expect(result.errors).toEqual([]);
    expect(result.computedGeometryValues).toEqual(new Map());
    expect(result.geometryValueErrors).toEqual([{
      occurrence: entry.occurrence,
      message: "Geometry value construction is incompatible with its declared interface type."
    }]);
  });

  it("keeps constructed points out of drawable identity while feeding a later line", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const P: point = coordinate(x: 10, y: 20)",
      "line L = segment(start: @P, end: (30, 20))"
    ].join("\n"));

    expect(compiled.document!.elements.map((element) => element.name)).toEqual(["L"]);
    expect(compiled.document!.elements.every((element) => element.name !== "P")).toBe(true);
    expect(result.computedGeometry.has("geometry-value-runtime:1")).toBe(false);
    expect(result.evaluatedElementIds?.has("geometry-value-runtime:1")).toBe(false);
    expect(result.effectiveVisibleElementIds?.has("geometry-value-runtime:1")).toBe(false);
    expect(result.effectiveEnabledElementIds?.has("geometry-value-runtime:1")).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("geometry-value-runtime:2")).toMatchObject({
      kind: "line",
      start: { x: 10, y: 20 },
      end: { x: 30, y: 20 },
      length: 20
    });
    expect([...result.computedGeometryValues!.values()]).toEqual([
      expect.objectContaining({
        occurrence: { sourceStatementId: "geometry-value-runtime:1", instancePath: [] },
        value: { kind: "point", x: 10, y: 20 }
      })
    ]);
  });

  it("supports segment values, aliases, properties, point access, and geometry builtins", () => {
    const { result } = evaluate([
      "nui 1",
      "const P: point = coordinate(x: 0, y: 0)",
      "const Q: point = coordinate(x: 3, y: 4)",
      "const L: line = segment(start: @P, end: @Q)",
      "const L2: line = @L",
      "const PX: number = @P.x",
      "const LY: number = @L.end.y",
      "const LL: number = @L.length",
      "const D: number = distance(@P, @Q)",
      "const LD: number = lineDistance(@P, @L)",
      "line Later = segment(start: @L2.start, end: @L2.end)"
    ].join("\n"));

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("geometry-value-runtime:10")).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 3, y: 4 },
      length: 5
    });
    const scalars = new Map(
      [...(result.computedScalarBindings ?? [])].map(([bindingId, value]) => [bindingId, value.status === "ok" && value.value.kind === "number" ? value.value.value : null])
    );
    expect(scalars.get("binding:geometry-value-runtime:5")).toBe(0);
    expect(scalars.get("binding:geometry-value-runtime:6")).toBe(4);
    expect(scalars.get("binding:geometry-value-runtime:7")).toBe(5);
    expect(scalars.get("binding:geometry-value-runtime:8")).toBe(5);
    expect(scalars.get("binding:geometry-value-runtime:9")).toBe(0);
  });

  it("evaluates direct arc values as identity-free paths and feeds read-only consumers", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const Arc: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "const DefaultArc: path = arc(center: (10, 20))",
      "const Length: number = @Arc.length",
      "const StartX: number = @Arc.start.x",
      "line Chord = segment(start: @Arc.start, end: @Arc.end)",
      "line Offset = offset(sources: [@Arc], distance: 1, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    const arc = values.find((entry) => entry.occurrence.sourceStatementId === "geometry-value-runtime:1")?.value;
    const defaultArc = values.find((entry) => entry.occurrence.sourceStatementId === "geometry-value-runtime:2")?.value;
    expect(arc).toEqual(expect.objectContaining({
      kind: "arcLine",
      center: { x: 0, y: 0 },
      start: { x: 10, y: 0 },
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 90,
      sweepAngleDeg: 90,
      length: 10 * Math.PI / 2
    }));
    expect(arc && arc.kind === "arcLine" ? arc.end.x : undefined).toBeCloseTo(0);
    expect(arc && arc.kind === "arcLine" ? arc.end.y : undefined).toBeCloseTo(10);
    expect(arc).not.toHaveProperty("elementId");
    expect(arc).not.toHaveProperty("name");
    expect(defaultArc).toEqual(expect.objectContaining({ radius: 30, sweepAngleDeg: 90 }));
    expect(result.computedGeometry.get("geometry-value-runtime:5")).toMatchObject({ kind: "line" });
    expect(result.computedGeometry.get("geometry-value-runtime:6")).toMatchObject({ kind: "offsetLine" });
  });

  it.each([0, -5])("reports an invalid pure arc radius through geometryValueErrors without drawable identity (%s)", (radius) => {
    const { compiled, result } = evaluate([
      "nui 1",
      `const Invalid: path = arc(center: (0, 0), radius: ${radius}, start: 0, end: 90, direction: counterclockwise)`
    ].join("\n"));

    const occurrence = compiled.geometryValueProgram![0]!.occurrence;
    expect(result.computedGeometryValues).toEqual(new Map());
    expect(result.geometryValueErrors).toEqual([{
      occurrence,
      message: "円弧の半径は0より大きい値で指定してください。"
    }]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
  });

  it("preserves module occurrence identity for an invalid pure arc and projects its runtime diagnostic", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M() {",
      "  const Invalid: path = arc(center: (0, 0), radius: -1, start: 0, end: 90, direction: counterclockwise)",
      "}",
      "instance One = M()"
    ].join("\n"));

    const entry = compiled.geometryValueProgram!.find((candidate) => candidate.construction.kind === "arc");
    expect(entry).toBeDefined();
    const error = result.geometryValueErrors?.find((candidate) => candidate.occurrence.instancePath.length > 0);
    expect(error).toEqual({
      occurrence: expect.objectContaining({
        sourceStatementId: entry!.occurrence.sourceStatementId,
        instancePath: expect.arrayContaining([expect.stringMatching(/^geometry-value-runtime:/)])
      }),
      message: "円弧の半径は0より大きい値で指定してください。"
    });
    expect(error?.occurrence.instancePath).toHaveLength(1);
    expect(result.computedGeometryValues).toEqual(new Map());
    expect(result.errors).toEqual([]);

    const diagnostics = runtimeGeometryDiagnostics({
      geometryValueErrors: result.geometryValueErrors,
      compiledDocument: compiled
    });
    const statementIndex = compiled.statementMap.statementIndexByStatementId!.get(entry!.occurrence.sourceStatementId)!;
    const statement = compiled.statements[statementIndex]!;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: "error",
      message: "円弧の半径は0より大きい値で指定してください。",
      origin: "runtime",
      navigationTarget: { kind: "sourceSpan", physicalSpan: statement.namePhysicalSpan }
    });
    expect(diagnostics[0]).not.toHaveProperty("elementId");
    expect(diagnostics[0]).not.toHaveProperty("bindingId");
  });

  it("passes a constructed line directly to a strict read-only line consumer", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 10, y: 0)",
      "const C: point = coordinate(x: 5, y: -5)",
      "const D: point = coordinate(x: 5, y: 5)",
      "const L: line = segment(start: @A, end: @B)",
      "const R: line = segment(start: @C, end: @D)",
      "point I = intersection(line1: @L, line2: @R, index: 0, extensions: false)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("geometry-value-runtime:7")).toMatchObject({ kind: "point", x: 5, y: 0 });
    expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value))).toBe(true);
  });

  it("passes a constructed path and its alias to broad line consumers", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 10, y: 0)",
      "const L: path = segment(start: @A, end: @B)",
      "const Alias: path = @L",
      "line Offset = offset(sources: [@Alias], distance: 1, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("geometry-value-runtime:5")).toMatchObject({ kind: "offsetLine" });
    expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value))).toBe(true);
    expect([...result.evaluatedElementIds ?? []]).not.toContain("geometry-value-runtime:3");
  });

  it("passes constructed segments through tangentOffset, onLine, transformCopy, and mirrorCopy", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 10, y: 0)",
      "const L: line = segment(start: @A, end: @B)",
      "const Alias: line = @L",
      "point Tangent = tangentOffset(line: @Alias, base: @A, angle: 0, distance: 2)",
      "point Division = onLine(from: @L.end, ratio: 0.5)",
      "line Transform = transformCopy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@L])",
      "line Mirror = mirrorCopy(axis1: @A, axis2: @B, baseLines: [@L])",
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("geometry-value-runtime:5")).toMatchObject({ kind: "point", x: 2, y: 0 });
    expect(result.computedGeometry.get("geometry-value-runtime:6")).toMatchObject({ kind: "point", x: 5, y: 0 });
    expect(result.computedGeometry.get("geometry-value-runtime:7")).toMatchObject({ kind: "offsetLine" });
    expect(result.computedGeometry.get("geometry-value-runtime:8")).toMatchObject({ kind: "offsetLine" });
    expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value))).toBe(true);
    expect([...result.evaluatedElementIds ?? []]).not.toContain("geometry-value-runtime:3");
  });

  it("passes a Module-local constructed segment through tangentOffset", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M() {",
      "  const A: point = coordinate(x: 0, y: 0)",
      "  const B: point = coordinate(x: 10, y: 0)",
      "  const L: line = segment(start: @A, end: @B)",
      "  point T = tangentOffset(line: @L, base: @A, angle: 0, distance: 1)",
      "  export const Out: line = @L",
      "}",
      "instance One = M()",
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect([...result.computedGeometry.values()].some((geometry) => geometry.kind === "point" && geometry.x === 1 && geometry.y === 0)).toBe(true);
    expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value))).toBe(true);
  });

  it("preserves specialized wrong-kind diagnostics for immutable line inputs", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 10, y: 0)",
      "const L: line = segment(start: @A, end: @B)",
      "const C: point = coordinate(x: 20, y: 0)",
      "const D: point = coordinate(x: 30, y: 0)",
      "const R: line = segment(start: @C, end: @D)",
      "point Extreme = bezierExtremePoint(source: @L, segmentIndex: 0, direction: 0)",
      "line Tangent = commonTangent(first: @L, second: @R, kind: external, side: left)",
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ elementId: "geometry-value-runtime:7", message: expect.stringContaining("ベジェ曲線") }),
      expect.objectContaining({ elementId: "geometry-value-runtime:8", message: expect.stringContaining("円弧") }),
    ]));
    expect(result.errors.some((error) => error.message.includes("存在しません") || error.message.includes("後にある"))).toBe(false);
  });

  it("passes a Module-exported constructed line to a root consumer", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M() {",
      "  const A: point = coordinate(x: 0, y: 0)",
      "  const B: point = coordinate(x: 10, y: 0)",
      "  export const Out: line = segment(start: @A, end: @B)",
      "}",
      "const C: point = coordinate(x: 5, y: -5)",
      "const D: point = coordinate(x: 5, y: 5)",
      "const R: line = segment(start: @C, end: @D)",
      "instance One = M()",
      "point I = intersection(line1: @One::Out, line2: @R, index: 0, extensions: false)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("geometry-value-runtime:10")).toMatchObject({ kind: "point", x: 5, y: 0 });
    expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value))).toBe(true);
  });

  it("rejects immutable geometry values in mutation target roles", () => {
    for (const [mutation, expectedCount] of [
      ["line Split = split(source: @L, at: @A)", 1],
      ["arc Corner = corner(end1: @L.start, end2: @L.end, radius: 1, index: 0)", 2],
      ["edge(end1: @L.start, end2: @L.end)", 2],
      ["extend(end: @L.start, to: (3, 0))", 1],
      ["move(targets: [@L], from: (0, 0), to: (1, 0))", 1],
      ["mirrorMove(targets: [@L], axis1: (0, 0), axis2: (0, 1))", 1],
      ["reverse(target: @L)", 1]
    ] as const) {
      const compiled = compile([
        "nui 1",
        "const A: point = coordinate(x: 0, y: 0)",
        "const B: point = coordinate(x: 10, y: 0)",
        "const L: line = segment(start: @A, end: @B)",
        mutation
      ].join("\n"));
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "geometry-value-mutation-target-unsupported")).toHaveLength(expectedCount);
      expect(compiled.document).toBeNull();
    }
  });

  it("preserves registry defaults and rejects drawable metadata exactly once", () => {
    const omitted = evaluate(["nui 1", "const P: point = coordinate(x: 12)"].join("\n"));
    expect(omitted.result.errors).toEqual([]);
    expect([...omitted.result.computedGeometryValues!.values()][0]?.value).toEqual({ kind: "point", x: 12, y: 0 });

    const unknown = compile(["nui 1", "const P: point = coordinate(unknown: 1)"].join("\n"));
    expect(unknown.diagnostics.filter((diagnostic) => diagnostic.code === "unknown-construction-argument")).toHaveLength(1);
    expect(unknown.diagnostics.filter((diagnostic) => diagnostic.code === "geometry-value-drawable-metadata")).toHaveLength(0);

    const metadata = compile(["nui 1", "const P: point = coordinate(x: 1, id: p1, state: disabled, roles: [draft], parent: @G, branch: then)"].join("\n"));
    expect(metadata.diagnostics.filter((diagnostic) => diagnostic.code === "geometry-value-drawable-metadata")).toHaveLength(5);
  });

  it("keeps later references fail-closed", () => {
    const compiled = compile([
      "nui 1",
      "line Later = segment(start: @P, end: (1, 0))",
      "const P: point = coordinate(x: 0, y: 0)"
    ].join("\n"));
    expect(compiled.diagnostics.some((diagnostic) => diagnostic.message.includes("この位置より後"))).toBe(true);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Later"]);
  });

  it("materializes direct Module construction values per instance without drawable identity", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M(source: point, x: number) {",
      "  const Local: point = coordinate(x: @x, y: @source.y)",
      "  const Edge: line = segment(start: @Local, end: @source)",
      "  export const Out: point = @Local",
      "  export const OutEdge: line = @Edge",
      "}",
      "point Base = coordinate(x: 0, y: 5)",
      "instance One = M(source: @Base, x: 10)",
      "instance Two = M(source: @Base, x: 20)",
      "line Use = segment(start: @One::Out, end: @Two::Out)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Base", "One", "Two", "Use"]);
    expect(result.errors).toEqual([]);
    const occurrences = [...(result.computedGeometryValues?.values() ?? [])]
      .filter((entry) => entry.occurrence.instancePath.length > 0);
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
    expect(new Set(occurrences.map((entry) => entry.occurrence.instancePath.join("/"))).size).toBeGreaterThan(1);
    expect(occurrences.every((entry) => !("elementId" in entry.value))).toBe(true);
    expect(result.computedGeometry.get("geometry-value-runtime:10")).toMatchObject({ kind: "line", start: { x: 10, y: 5 }, end: { x: 20, y: 5 } });
  });
});
