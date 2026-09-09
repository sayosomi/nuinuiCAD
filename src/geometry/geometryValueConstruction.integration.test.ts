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

  it("evaluates point offsets as identity-free values with numeric expressions", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "point Base = coordinate(x: 1, y: 2)",
      "const P: point = offset(from: @Base, dx: 1 + 2, dy: -4)",
      "const Default: point = offset(from: @Base)",
      "line Use = segment(start: @P, end: @Default)"
    ].join("\n"));

    expect(compiled.document!.elements.map((element) => element.name)).toEqual(["Base", "Use"]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometryValues).toEqual(expect.any(Map));
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    expect(values.map((entry) => entry.value)).toEqual([
      { kind: "point", x: 4, y: -2 },
      { kind: "point", x: 1, y: 2 }
    ]);
    expect(values.every((entry) => !("elementId" in entry.value) && !("name" in entry.value))).toBe(true);
    expect(result.computedGeometry.get("geometry-value-runtime:4")).toMatchObject({
      kind: "line",
      start: { x: 4, y: -2 },
      end: { x: 1, y: 2 }
    });
  });

  it("evaluates polar point and strict-line values with drawable defaults", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "const P: point = polar(from: @Base, angle: 90, distance: 20)",
      "const DefaultP: point = polar(from: @Base)",
      "const L: line = polar(start: @P, angle: 30, length: 100)",
      "const DefaultL: line = polar(start: @P)",
      "const Path: path = @L",
      "const Px: number = @P.x",
      "const Ly: number = @L.end.y",
      "line Use = segment(start: @P, end: @Path.end)"
    ].join("\n"));

    expect(compiled.document!.elements.map((element) => element.name)).toEqual(["Base", "Use"]);
    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    expect(values.map((entry) => entry.value)).toEqual([
      expect.objectContaining({ kind: "point", x: expect.closeTo(10, 10), y: 40 }),
      { kind: "point", x: 10, y: 20 },
      expect.objectContaining({ kind: "line", start: { x: expect.closeTo(10, 10), y: 40 }, length: expect.closeTo(100, 10) }),
      expect.objectContaining({ kind: "line", start: { x: expect.closeTo(10, 10), y: 40 }, end: { x: expect.closeTo(110, 10), y: 40 }, length: expect.closeTo(100, 10) })
    ]);
    expect(values.every((entry) => !("elementId" in entry.value) && !("name" in entry.value))).toBe(true);
    expect(result.computedGeometry.get("geometry-value-runtime:9")).toMatchObject({
      kind: "line",
      start: { x: expect.closeTo(10, 10), y: 40 },
      end: { x: 10 + Math.cos(Math.PI / 6) * 100, y: 40 + Math.sin(Math.PI / 6) * 100 }
    });
    const scalarValues = [...(result.computedScalarBindings?.values() ?? [])]
      .filter((value): value is Extract<typeof value, { status: "ok" }> => value.status === "ok")
      .map((value) => value.value.kind === "number" ? value.value.value : null);
    expect(scalarValues).toEqual(expect.arrayContaining([expect.closeTo(10, 10), 90]));
  });

  it("evaluates module-local and exported polar values with occurrence identity", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M(source: point) {",
      "  const Local: point = polar(from: @source, angle: 90, distance: 10)",
      "  export const Output: line = polar(start: @Local, angle: 0, length: 5)",
      "}",
      "point Base = coordinate(x: 1, y: 2)",
      "instance One = M(source: @Base)",
      "const Root: line = @One::Output",
      "line Use = segment(start: @Root.start, end: @Root.end)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    const moduleValues = [...(result.computedGeometryValues?.values() ?? [])].filter((entry) => entry.occurrence.instancePath.length === 1);
    expect(moduleValues.map((entry) => entry.value)).toEqual([
      expect.objectContaining({ kind: "point", x: expect.closeTo(1, 10), y: 12 }),
      expect.objectContaining({ kind: "line", start: { x: expect.closeTo(1, 10), y: 12 }, end: { x: expect.closeTo(6, 10), y: 12 }, length: 5 })
    ]);
    expect(moduleValues.every((entry) => !("elementId" in entry.value) && !("name" in entry.value))).toBe(true);
  });

  it("evaluates open and closed line offsets as identity-free paths and reuses them", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "line BC = segment(start: (10, 0), end: (10, 10))",
      "line CA = segment(start: (10, 10), end: (0, 0))",
      "const Open: path = offset(sources: [@AB, @BC], distance: 2, side: right, closed: false, suppressTrimWarnings: false)",
      "const Closed: path = offset(sources: [@AB, @BC, @CA], distance: 2, side: right, closed: true, suppressTrimWarnings: false)",
      "line Use = offset(sources: [@Open], distance: 1, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    const open = values.find((entry) => entry.occurrence.sourceStatementId === "geometry-value-runtime:4")?.value;
    const closed = values.find((entry) => entry.occurrence.sourceStatementId === "geometry-value-runtime:5")?.value;
    expect(open).toMatchObject({ kind: "offsetLine", closed: false, start: { x: 0, y: -2 }, end: { x: 12, y: 10 } });
    expect(closed).toMatchObject({ kind: "offsetLine", closed: true });
    expect(closed && closed.kind === "offsetLine" ? closed.start : undefined).toEqual(closed && closed.kind === "offsetLine" ? closed.end : undefined);
    expect(open).not.toHaveProperty("elementId");
    expect(open).not.toHaveProperty("name");
    expect((open as { segments: unknown[] }).segments.length).toBeGreaterThan(0);
    expect(result.computedGeometry.get("geometry-value-runtime:6")).toMatchObject({ kind: "offsetLine", start: { x: 0, y: -3 } });
  });

  it("reports invalid pure line offsets through the occurrence-owned channel", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "line CD = segment(start: (20, 0), end: (30, 0))",
      "const Invalid: path = offset(sources: [@AB, @CD], distance: 1, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));

    const entry = compiled.geometryValueProgram!.find((candidate) => candidate.sourceStatementId === "geometry-value-runtime:3")!;
    expect(result.computedGeometryValues).toEqual(new Map());
    expect(result.geometryValueErrors).toEqual([{
      occurrence: entry.occurrence,
      message: "geometry value の sources は前の線.end から次の線.start へ連続していません。reverse を使うか順序を見直してください。"
    }]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
  });

  it("evaluates Module-local and exported pure line offsets through the shared value owner", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M(source: path) {",
      "  const Local: path = offset(sources: [@source], distance: 1, side: right, closed: false, suppressTrimWarnings: false)",
      "  export const Output: path = offset(sources: [@source], distance: 2, side: right, closed: false, suppressTrimWarnings: false)",
      "}",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "instance One = M(source: @Base)",
      "const Root: path = offset(sources: [@One::Output], distance: 1, side: right, closed: false, suppressTrimWarnings: false)",
      "line Use = segment(start: @Root.start, end: @One::Output.end)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    expect(values.filter((entry) => entry.occurrence.instancePath.length === 1 && entry.value.kind === "offsetLine")).toHaveLength(2);
    expect(values.some((entry) => entry.occurrence.instancePath.length === 1 && entry.value.kind === "offsetLine" && entry.value.start?.y === -2)).toBe(true);
    expect(values.some((entry) => entry.occurrence.instancePath.length === 0 && entry.value.kind === "offsetLine" && entry.value.start?.y === -3)).toBe(true);
    expect(result.computedGeometry.get("geometry-value-runtime:8")).toMatchObject({ kind: "line", start: { x: 0, y: -3 }, end: { x: 10, y: -2 } });
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

  it("evaluates through values as identity-free paths with defaults and shared consumers", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const P1: point = coordinate(x: 10, y: 0)",
      "const P2: point = coordinate(x: 0, y: 10)",
      "const P3: point = coordinate(x: -10, y: 0)",
      "const Through: path = through(point1: @P1, point2: @P2, point3: @P3)",
      "const Length: number = @Through.length",
      "line Chord = segment(start: @Through.start, end: @Through.end)",
      "line Offset = offset(sources: [@Through], distance: 1, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));

    const through = [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === "geometry-value-runtime:4")?.value;
    expect(compiled.geometryValueProgram?.[3]?.construction.kind).toBe("through");
    expect(result.errors).toEqual([]);
    expect(through).toEqual(expect.objectContaining({
      kind: "arcLine",
      center: { x: 0, y: 0 },
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 90,
      sweepAngleDeg: 90,
      length: 10 * Math.PI / 2
    }));
    expect(through).not.toHaveProperty("elementId");
    expect(through).not.toHaveProperty("name");
    expect(result.computedGeometry.get("geometry-value-runtime:6")).toMatchObject({ kind: "line", length: 10 * Math.SQRT2 });
    expect(result.computedGeometry.get("geometry-value-runtime:7")).toMatchObject({ kind: "offsetLine" });
  });

  it("evaluates pure bezier values with multiple segments and shared path consumers", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const Start: point = coordinate(x: 0, y: 0)",
      "const Middle: point = coordinate(x: 5, y: 2)",
      "const End: point = coordinate(x: 10, y: 0)",
      "const Curve: path = bezier(start: @Start, end: @End, startAngle: 0, startLength: 3, endAngle: 180, endLength: 4, intermediates: [@Middle: 90: 1: 2])",
      "const Alias: path = @Curve",
      "const Length: number = @Alias.length",
      "line Chord = segment(start: @Curve.start, end: @Curve.end)",
      "line Offset = offset(sources: [@Alias], distance: 1, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));

    const curve = [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === "geometry-value-runtime:4")?.value;
    expect(compiled.geometryValueProgram?.[3]?.construction.kind).toBe("bezier");
    expect(result.errors).toEqual([]);
    expect(curve).toMatchObject({
      kind: "bezierCurve",
      segments: [
        { start: { x: 0, y: 0 }, control1: { x: 3, y: 0 }, control2: { x: 5, y: 1 }, end: { x: 5, y: 2 } },
        { start: { x: 5, y: 2 }, control1: { x: 5, y: 4 }, control2: { x: 14 }, end: { x: 10, y: 0 } }
      ]
    });
    expect(curve).not.toHaveProperty("elementId");
    expect(curve).not.toHaveProperty("name");
    expect(result.computedGeometry.get("geometry-value-runtime:7")).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    expect(result.computedGeometry.get("geometry-value-runtime:8")).toMatchObject({ kind: "offsetLine" });
  });

  it("evaluates open and closed pure polylines without drawable identity", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const Open: path = polyline(points: [(0, 0), (3, 4), (3, 0)], closed: false)",
      "const Closed: path = polyline(points: [(0, 0), (3, 4), (3, 0)], closed: true)",
      "const OpenLength: number = @Open.length",
      "const ClosedLength: number = @Closed.length",
      "line Use = segment(start: @Open.start, end: @Closed.end)",
      "line Offset = offset(sources: [@Closed], distance: 1, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    const open = values.find((entry) => entry.occurrence.sourceStatementId === "geometry-value-runtime:1")?.value;
    const closed = values.find((entry) => entry.occurrence.sourceStatementId === "geometry-value-runtime:2")?.value;
    expect(open).toEqual(expect.objectContaining({
      kind: "polyline",
      closed: false,
      start: { x: 0, y: 0 },
      end: { x: 3, y: 0 },
      length: 9
    }));
    expect(open && open.kind === "polyline" ? open.segments : undefined).toEqual([
      { start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, length: 5 },
      { start: { x: 3, y: 4 }, end: { x: 3, y: 0 }, length: 4 }
    ]);
    expect(closed).toEqual(expect.objectContaining({
      kind: "polyline",
      closed: true,
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      length: 12
    }));
    expect(closed && closed.kind === "polyline" ? closed.segments.map((segment) => segment.length) : undefined).toEqual([5, 4, 3]);
    expect(open).not.toHaveProperty("elementId");
    expect(open).not.toHaveProperty("name");
    expect(result.computedGeometry.get("geometry-value-runtime:5")).toMatchObject({ kind: "line" });
    expect(result.computedGeometry.get("geometry-value-runtime:6")).toMatchObject({ kind: "offsetLine" });
  });

  it("supports pure polyline points aliases and Module local/export flows", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const vertices: point[] = [(0, 0), (3, 4), (3, 0)]",
      "const Root: path = polyline(points: @vertices, closed: false)",
      "module M() {",
      "  const Local: path = polyline(points: [(0, 0), (10, 0)], closed: false)",
      "  export const Output: path = polyline(points: [(0, 0), (0, 10), (10, 10)], closed: true)",
      "}",
      "instance One = M()",
      "const Length: number = @One::Output.length",
      "line Use = segment(start: @Root.start, end: @One::Output.end)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])].filter((entry) => entry.value.kind === "polyline");
    expect(values).toHaveLength(3);
    expect(values.some((entry) => entry.occurrence.sourceStatementId === "geometry-value-runtime:2" && entry.occurrence.instancePath.length === 0)).toBe(true);
    expect(values.some((entry) => entry.occurrence.instancePath.length === 1 && entry.value.kind === "polyline" && entry.value.closed)).toBe(true);
    expect(result.computedGeometry.get("geometry-value-runtime:9")).toMatchObject({ kind: "line" });
  });

  it("reports invalid pure polyline inputs through the occurrence-owned channel", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const Invalid: path = polyline(points: [(0, 0), (10 / 0, 0)], closed: false)"
    ].join("\n"));

    const occurrence = compiled.geometryValueProgram![0]!.occurrence;
    expect(result.computedGeometryValues).toEqual(new Map());
    expect(result.geometryValueErrors).toEqual([{
      occurrence,
      message: "Polyline geometry value construction inputs are unavailable or invalid."
    }]);
    expect(result.errors).toEqual([]);
  });

  it("lowers root typed scalar inputs into the pure bezier value program", () => {
    const { result } = evaluate([
      "nui 1",
      "const StartAngle: number = 90",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: @StartAngle, startLength: 3, endAngle: 180, endLength: 2)",
      "const Length: number = @Curve.length"
    ].join("\n"));

    const curve = [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === "geometry-value-runtime:2")?.value;
    expect(result.errors).toEqual([]);
    expect(curve).toMatchObject({
      kind: "bezierCurve",
      segments: [{ control1: { y: 3 } }]
    });
  });

  it("evaluates local and exported Module pure bezier occurrences", () => {
    const { result } = evaluate([
      "nui 1",
      "module M(startAngle: number) {",
      "  const Local: path = bezier(start: (0, 0), end: (10, 0), startAngle: @startAngle, startLength: 2, endAngle: 180, endLength: 2)",
      "  export const Output: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 3, endAngle: 270, endLength: 3)",
      "}",
      "instance One = M(startAngle: 90)",
      "const Length: number = @One::Output.length",
      "line Use = segment(start: @One::Output.start, end: @One::Output.end)"
    ].join("\n"));

    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    expect(values.filter((entry) => entry.value.kind === "bezierCurve")).toHaveLength(2);
    expect(values.filter((entry) => entry.occurrence.instancePath.length === 1 && entry.value.kind === "bezierCurve")).toHaveLength(2);
    expect(values.filter((entry) => entry.occurrence.instancePath.length === 1 && entry.value.kind === "bezierCurve").map((entry) => entry.value.kind === "bezierCurve" ? entry.value.segments[0]?.control1.y : undefined)).toEqual(expect.arrayContaining([2, 3]));
    expect(result.computedGeometry.get("geometry-value-runtime:7")).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  });

  it("reports invalid pure bezier runtime inputs through the occurrence-owned channel", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const Invalid: path = bezier(start: (0, 0), end: (10, 0), startAngle: 0, startLength: 10 / 0, endAngle: 180, endLength: 2)"
    ].join("\n"));

    const occurrence = compiled.geometryValueProgram![0]!.occurrence;
    expect(result.computedGeometryValues).toEqual(new Map());
    expect(result.geometryValueErrors).toEqual([{
      occurrence,
      message: "Bezier geometry value construction inputs are unavailable or invalid."
    }]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
  });

  it("supports authored and derived points plus exported Module through occurrences", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "point P3 = coordinate(x: -10, y: 0)",
      "line Base = segment(start: (10, 0), end: (0, 10))",
      "const Through: path = through(point1: @Base.start, point2: @Base.end, point3: @P3)",
      "module M() {",
      "  export const Through: path = through(point1: (10, 0), point2: (0, 10), point3: (-10, 0))",
      "}",
      "instance One = M()",
      "line Use = segment(start: @One::Through.start, end: @One::Through.end)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    expect(values.filter((entry) => entry.value.kind === "arcLine")).toHaveLength(2);
    expect(values.some((entry) => entry.occurrence.instancePath.length === 1)).toBe(true);
    const use = result.computedGeometry.get("geometry-value-runtime:8");
    expect(use).toMatchObject({ kind: "line", start: { x: 10, y: 0 } });
    if (use?.kind !== "line") throw new Error("expected a line consumer");
    expect(use.end.x).toBeCloseTo(0);
    expect(use.end.y).toBeCloseTo(10);
  });

  it.each([
    ["duplicate", "const Invalid: path = through(point1: (0, 0), point2: (0, 0), point3: (1, 1))"],
    ["collinear", "const Invalid: path = through(point1: (0, 0), point2: (1, 1), point3: (2, 2))"]
  ] as const)("reports a %s through failure through the occurrence-owned channel", (_kind, declaration) => {
    const { compiled, result } = evaluate(["nui 1", declaration].join("\n"));
    const occurrence = compiled.geometryValueProgram![0]!.occurrence;
    expect(result.computedGeometryValues).toEqual(new Map());
    expect(result.geometryValueErrors).toEqual([{
      occurrence,
      message: "点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。"
    }]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
  });

  it("preserves Module occurrence identity and authored declaration diagnostics for invalid through", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M() {",
      "  const Invalid: path = through(point1: (0, 0), point2: (1, 1), point3: (2, 2))",
      "}",
      "instance One = M()"
    ].join("\n"));

    const entry = compiled.geometryValueProgram!.find((candidate) => candidate.construction.kind === "through");
    expect(entry).toBeDefined();
    const error = result.geometryValueErrors?.find((candidate) => candidate.occurrence.instancePath.length > 0);
    expect(error).toEqual({
      occurrence: expect.objectContaining({
        sourceStatementId: entry!.occurrence.sourceStatementId,
        instancePath: expect.arrayContaining([expect.stringMatching(/^geometry-value-runtime:/)])
      }),
      message: "点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。"
    });
    expect(result.errors).toEqual([]);
    expect(result.computedGeometryValues).toEqual(new Map());
    expect(result.geometryValueErrors?.every((candidate) => !("elementId" in candidate))).toBe(true);

    const diagnostics = runtimeGeometryDiagnostics({
      geometryValueErrors: result.geometryValueErrors,
      compiledDocument: compiled
    });
    const statementIndex = compiled.statementMap.statementIndexByStatementId!.get(entry!.occurrence.sourceStatementId)!;
    const statement = compiled.statements[statementIndex]!;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: "error",
      message: "点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。",
      origin: "runtime",
      navigationTarget: { kind: "sourceSpan", physicalSpan: statement.namePhysicalSpan }
    });
    expect(diagnostics[0]).not.toHaveProperty("elementId");
    expect(diagnostics[0]).not.toHaveProperty("bindingId");
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

  it("evaluates pure between and onLine points without drawable identity", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 100, y: 0)",
      "const M: point = between(start: @A, end: @B, ratio: 0.5)",
      "const D: point = between(start: @A, end: @B, distance: 25)",
      "const L: line = segment(start: @A, end: @B)",
      "const P: point = onLine(from: @L.start, ratio: 0.5)",
      "const Q: point = onLine(from: @L.end, distance: 25)",
      "line Use = segment(start: @M, end: @Q)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Use"]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    expect([...result.computedGeometryValues!.values()].map((entry) => entry.value)).toEqual([
      { kind: "point", x: 0, y: 0 },
      { kind: "point", x: 100, y: 0 },
      { kind: "point", x: 50, y: 0 },
      { kind: "point", x: 25, y: 0 },
      expect.objectContaining({ kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }),
      { kind: "point", x: 50, y: 0 },
      { kind: "point", x: 75, y: 0 }
    ]);
    expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    expect(result.computedGeometry.get("geometry-value-runtime:8")).toMatchObject({
      kind: "line",
      start: { x: 50, y: 0 },
      end: { x: 75, y: 0 }
    });
  });

  it("supports pure division values in Module locals and exports", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M(source: path) {",
      "  export const Local: point = onLine(from: @source.start, ratio: 0.25)",
      "  export const Output: point = between(start: @source.start, end: @source.end, distance: 5)",
      "}",
      "line Base = segment(start: (0, 0), end: (100, 0))",
      "instance One = M(source: @Base)",
      "line Use = segment(start: @One::Local, end: @One::Output)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    expect(result.computedGeometry.get("geometry-value-runtime:7")).toMatchObject({
      kind: "line",
      start: { x: 25, y: 0 },
      end: { x: 5, y: 0 }
    });
    expect([...result.computedGeometryValues!.values()]
      .filter((entry) => entry.occurrence.instancePath.length === 1)
      .map((entry) => entry.value)).toEqual([
        { kind: "point", x: 25, y: 0 },
        { kind: "point", x: 5, y: 0 }
      ]);
  });

  it("reports pure distance and onLine degenerate failures by occurrence", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 0, y: 0)",
      "const Distance: point = between(start: @A, end: @B, distance: 1)",
      "const L: line = segment(start: @A, end: @B)",
      "const OnLine: point = onLine(from: @L.start, distance: 1)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometryValues).toEqual(expect.any(Map));
    expect([...result.computedGeometryValues!.values()].map((entry) => entry.occurrence.sourceStatementId)).toEqual([
      "geometry-value-runtime:1",
      "geometry-value-runtime:2",
      "geometry-value-runtime:4"
    ]);
    expect(result.geometryValueErrors).toEqual([
      {
        occurrence: { sourceStatementId: "geometry-value-runtime:3", instancePath: [] },
        message: "between construction cannot determine a distance direction because its endpoints coincide."
      },
      {
        occurrence: { sourceStatementId: "geometry-value-runtime:5", instancePath: [] },
        message: "onLine construction cannot determine a point from the referenced line. Specify a usable line-like geometry."
      }
    ]);
  });

  it("preserves ratio semantics for coincident pure between endpoints", () => {
    const { result } = evaluate([
      "nui 1",
      "const A: point = coordinate(x: 2, y: 3)",
      "const B: point = coordinate(x: 2, y: 3)",
      "const Ratio: point = between(start: @A, end: @B, ratio: 0.5)"
    ].join("\n"));

    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    expect([...result.computedGeometryValues!.values()].at(-1)?.value).toEqual({ kind: "point", x: 2, y: 3 });
  });
});
