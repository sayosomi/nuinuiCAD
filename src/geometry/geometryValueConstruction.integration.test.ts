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
  it("evaluates geometry-valued if and exhaustive match with selected-branch runtime semantics", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const side: choice(left, right) = left",
      "const P: point = if (true) { coordinate(x: 1, y: 2) } else { coordinate(x: 100, y: 200) }",
      "const Q: point = match @side { left => coordinate(x: 3, y: 4) right => coordinate(x: 300, y: 400) }"
    ].join("\n"));

    expect(compiled.moduleSemanticAnalysis?.geometryValues.find((value) => value.name === "P")?.backingTarget).toBeNull();
    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual(["if", "match"]);
    expect([...result.computedGeometryValues?.values() ?? []].map((entry) => entry.value)).toEqual([
      { kind: "point", x: 1, y: 2 },
      { kind: "point", x: 3, y: 4 }
    ]);
    expect(result.geometryValueErrors).toEqual([]);
  });

  it("evaluates a root geometry value-if condition from an actual scalar reference", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const flag: boolean = true",
      "const Selected: point =",
      "  if (@flag) {",
      "    coordinate(x: 1, y: 2)",
      "  } else {",
      "    coordinate(x: 100, y: 200)",
      "  }"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect([...result.computedGeometryValues?.values() ?? []].map((entry) => entry.value)).toEqual([
      { kind: "point", x: 1, y: 2 }
    ]);
    expect(result.geometryValueErrors).toEqual([]);
  });

  it("supports point, line, and path control-flow values through existing consumers", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const side: choice(left, right) = left",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const SelectedPoint: point = if (true) { @A } else { between(start: @A, end: @B, ratio: 1 / 0) }",
      "const SelectedLine: line = match @side { left => @Base right => segment(start: (0, 0), end: (10, 0)) }",
      "const SelectedPath: path = if (true) { @Base } else { arc(center: @A, radius: 0, start: 0, end: 90) }",
      "const SelectedX: number = @SelectedPoint.x",
      "const SelectedLength: number = @SelectedPath.length",
      "line Use = segment(start: @SelectedPoint, end: @SelectedPath.end)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    expect(values.map((entry) => entry.value)).toEqual([
      { kind: "point", x: 0, y: 0 },
      expect.objectContaining({ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }),
      expect.objectContaining({ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } })
    ]);
    expect(result.computedScalarBindings?.get("binding:geometry-value-runtime:8")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 0 }
    });
    expect(result.computedScalarBindings?.get("binding:geometry-value-runtime:9")).toMatchObject({
      status: "ok",
      value: { kind: "number", value: 10 }
    });
    expect(result.computedGeometry.get("geometry-value-runtime:10")).toMatchObject({
      kind: "line",
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 }
    });
  });

  it("reports geometry branch type and exhaustive-match diagnostics, including unselected references", () => {
    const compiled = compile([
      "nui 1",
      "const side: choice(left, right) = left",
      "point A = coordinate(x: 0, y: 0)",
      "line Base = segment(start: @A, end: (10, 0))",
      "const Wrong: point = if (true) { @A } else { @Base }",
      "const Missing: point = match @side { left => @A }",
      "const Duplicate: point = match @side { left => @A left => @A right => @A }",
      "const Impossible: point = match @side { left => @A right => @A other => @A }",
      "const Dangling: point = if (true) { @A } else { @NoSuchPoint }"
    ].join("\n"));
    const codes = compiled.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(expect.arrayContaining([
      "module-geometry-type-mismatch",
      "missing-match-case",
      "duplicate-match-case",
      "impossible-match-case",
      "module-undefined-geometry-reference"
    ]));
  });

  it("maps a multiline geometry value diagnostic to the exact offending branch token", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "const Broken: point =",
      "  if (true) {",
      "    @Missing",
      "  } else {",
      "    @A",
      "  }"
    ].join("\n");
    const compiled = compile(source);
    const diagnostic = compiled.diagnostics.find((candidate) => candidate.code === "module-undefined-geometry-reference");
    const missingFrom = source.indexOf("@Missing") + 1;

    expect(diagnostic?.physicalSpan?.segments).toEqual([{ from: missingFrom, to: missingFrom + "Missing".length }]);
    expect(source.slice(missingFrom, missingFrom + "Missing".length)).toBe("Missing");
  });

  it("remaps geometry control-flow values independently for repeated Module instances", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 5, y: 0)",
      "point C = coordinate(x: 0, y: 7)",
      "module M(flag: boolean, side: choice(left, right), start: point, leftEnd: point, rightEnd: point) {",
      "  export const Point: point =",
      "    if (@flag) {",
      "      coordinate(x: 1, y: 2)",
      "    } else {",
      "      coordinate(x: 10, y: 20)",
      "    }",
      "  export const Edge: path =",
      "    match @side {",
      "      left => segment(start: @start, end: @leftEnd)",
      "      right => segment(start: @start, end: @rightEnd)",
      "    }",
      "}",
      "instance First = M(flag: true, side: left, start: @A, leftEnd: @B, rightEnd: @C)",
      "instance Second = M(flag: false, side: right, start: @A, leftEnd: @B, rightEnd: @C)",
      "line Use = segment(start: @First::Point, end: @Second::Point)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])]
      .filter((entry) => entry.occurrence.instancePath.length === 1);
    expect(values).toHaveLength(4);
    expect(values.map((entry) => entry.value)).toEqual(expect.arrayContaining([
      { kind: "point", x: 1, y: 2 },
      { kind: "point", x: 10, y: 20 },
      expect.objectContaining({ kind: "line", end: { x: 5, y: 0 } }),
      expect.objectContaining({ kind: "line", end: { x: 0, y: 7 } })
    ]));
    const use = compiled.document?.elements.find((element) => element.name === "Use");
    expect(use && result.computedGeometry.get(use.id)).toMatchObject({
      kind: "line",
      start: { x: 1, y: 2 },
      end: { x: 10, y: 20 }
    });
  });

  it("evaluates transformCopy and mirrorCopy as identity-free path values", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "const Copied: path = transformCopy(startPoint: (0, 0), endPoint: (20, 10), baseLines: [@Base])",
      "const Mirrored: path = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [@Base])"
    ].join("\n"));

    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual([
      "transformCopy",
      "mirrorCopy"
    ]);
    const values = [...(result.computedGeometryValues?.values() ?? [])].map((entry) => entry.value);
    expect(values).toEqual([
      expect.objectContaining({
        kind: "offsetLine",
        start: { x: 20, y: 10 },
        end: { x: 30, y: 10 }
      }),
      expect.objectContaining({
        kind: "offsetLine",
        start: { x: 0, y: 0 },
        end: { x: -10, y: 0 }
      })
    ]);
    expect(values.every((value) => !("elementId" in value) && !("name" in value) && !("baseLineIds" in value))).toBe(true);
    expect(result.computedGeometry.get("geometry-value-runtime:1")).toMatchObject({ kind: "line" });
  });

  it("evaluates non-default copies for Bezier, arc, polyline, and offset path sources", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 2, endAngle: -90, endLength: 2)",
      "const Arc: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "const Polyline: path = polyline(points: [(0, 0), (10, 0), (10, 10)], closed: false)",
      "const Offset: path = offset(sources: [@Polyline], distance: 1, side: right, closed: false, suppressTrimWarnings: false)",
      "const Transformed: path = transformCopy(startPoint: (0, 0), endPoint: (20, 10), scale: 2, angleDeg: 90, mirrorX: true, baseLines: [@Curve])",
      "const Mirrored: path = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [@Arc])",
      "const PolylineCopy: path = transformCopy(startPoint: (0, 0), endPoint: (0, 0), scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@Polyline])",
      "const OffsetCopy: path = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [@Offset])",
      "const TransformedLength: number = @Transformed.length",
      "const MirroredStartX: number = @Mirrored.start.x",
      "line CopyUse = segment(start: @Transformed.start, end: @Mirrored.end)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const valueFor = (statementIndex: number) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === `geometry-value-runtime:${statementIndex}`)?.value;

    expect(valueFor(5)).toMatchObject({
      kind: "offsetLine",
      start: { x: 20, y: 10 },
      end: { x: 20, y: -10 },
      segments: [{
        kind: "bezier",
        control1: { x: 16, y: 10 },
        control2: { x: 16, y: -10 }
      }]
    });
    expect(valueFor(6)).toMatchObject({
      kind: "offsetLine",
      segments: [{ kind: "arc", radius: 10, sweepAngleDeg: -90 }]
    });
    expect(valueFor(7)).toMatchObject({
      kind: "offsetLine",
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      segments: [{ kind: "line" }, { kind: "line" }]
    });
    expect(valueFor(8)).toMatchObject({
      kind: "offsetLine",
      segments: expect.arrayContaining([expect.objectContaining({ kind: "line" })])
    });
    expect(valueFor(5)).not.toHaveProperty("elementId");
    expect(valueFor(8)).not.toHaveProperty("name");
    expect([...result.computedGeometryValues!.values()].every(({ value }) =>
      !("elementId" in value) && !("name" in value) && !("baseLineIds" in value)
    )).toBe(true);
    expect(result.computedScalarBindings?.get("binding:geometry-value-runtime:9")).toMatchObject({
      status: "ok",
      value: { kind: "number" }
    });
    expect(result.computedScalarBindings?.get("binding:geometry-value-runtime:10")).toMatchObject({
      status: "ok",
      value: { kind: "number" }
    });
    expect(result.computedGeometry.get("geometry-value-runtime:11")).toMatchObject({ kind: "line" });
  });

  it("reports copy path parameter, ordering, and empty-source failures through occurrence-owned errors", () => {
    const cases = [
      [
        "invalid scale",
        [
          "line Base = segment(start: (0, 0), end: (10, 0))",
          "const Bad: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), scale: 0, baseLines: [@Base])"
        ],
        "transformCopy geometry value construction scale must be a finite positive number."
      ],
      [
        "coincident mirror axis",
        [
          "line Base = segment(start: (0, 0), end: (10, 0))",
          "const Bad: path = mirrorCopy(axis1: (0, 0), axis2: (0, 0), baseLines: [@Base])"
        ],
        "mirrorCopy geometry value construction requires two distinct axis points."
      ],
      [
        "discontinuous ordered sources",
        [
          "line First = segment(start: (0, 0), end: (10, 0))",
          "line Second = segment(start: (20, 0), end: (30, 0))",
          "const Bad: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), baseLines: [@First, @Second])"
        ],
        "transformCopy geometry value construction baseLines are not continuous in the specified order."
      ],
      [
        "empty source list",
        [
          "const Bad: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), baseLines: [])"
        ],
        "transformCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments."
      ],
      [
        "empty mirror source list",
        [
          "const Bad: path = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [])"
        ],
        "mirrorCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments."
      ],
      [
        "degenerate source segments",
        [
          "const Source: path = polyline(points: [(0, 0), (0, 0)], closed: false)",
          "const Bad: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), baseLines: [@Source])"
        ],
        "transformCopy geometry value construction produced no transformed segments."
      ]
    ] as const;

    for (const testCase of cases) {
      const [, declarations, message] = testCase;
      const { compiled, result } = evaluate(["nui 1", ...declarations].join("\n"));
      const entry = compiled.geometryValueProgram?.at(-1);
      expect(entry).toBeDefined();
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([{ occurrence: entry?.occurrence, message }]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  });

  it("reports an unavailable source before reporting its dependent copy", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const Failed: path = polyline(points: [(0, 0), (10 / 0, 0)], closed: false)",
      "const Copied: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), baseLines: [@Failed])"
    ].join("\n"));
    const failed = compiled.geometryValueProgram?.find((entry) => entry.sourceStatementIndex === 1);
    const copied = compiled.geometryValueProgram?.find((entry) => entry.sourceStatementIndex === 2);

    expect(failed).toBeDefined();
    expect(copied).toBeDefined();
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([
      { occurrence: failed?.occurrence, message: "Polyline geometry value construction inputs are unavailable or invalid." },
      { occurrence: copied?.occurrence, message: "transformCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments." }
    ]);
    expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
  });

  it("evaluates copy path values through a Module local, export, and instance", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M(source: path) {",
      "  const copied: path = transformCopy(startPoint: (0, 0), endPoint: (20, 10), baseLines: [@source])",
      "  export const output: path = @copied",
      "}",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "instance I = M(source: @Base)",
      "const Root: path = @I::output"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    const copyValues = [...(result.computedGeometryValues?.values() ?? [])]
      .filter((entry) => entry.value.kind === "offsetLine");
    expect(copyValues).toHaveLength(1);
    expect(copyValues.every((entry) => entry.value.kind === "offsetLine" && !("elementId" in entry.value))).toBe(true);
    expect(copyValues.at(-1)?.value).toMatchObject({ start: { x: 20, y: 10 }, end: { x: 30, y: 10 } });
  });

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

  it("evaluates Module-local and exported commonTangent values through an instance", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M(first: point, second: point) {",
      "  const FirstArc: path = arc(center: @first, radius: 20, start: 0, end: 90)",
      "  const SecondArc: path = arc(center: @second, radius: 10, start: 0, end: 90)",
      "  const Local: line = commonTangent(first: @FirstArc, second: @SecondArc, kind: external, side: left)",
      "  export const Output: line = @Local",
      "}",
      "point C1 = coordinate(x: 0, y: 0)",
      "point C2 = coordinate(x: 60, y: 0)",
      "instance One = M(first: @C1, second: @C2)",
      "const Root: line = @One::Output",
      "line Use = segment(start: @Root.start, end: @Root.end)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    expect(values.filter((entry) => entry.occurrence.instancePath.length === 1)).toHaveLength(3);
    expect(values.filter((entry) => entry.occurrence.instancePath.length === 1 && entry.value.kind === "line")).toHaveLength(1);
    expect(values.every((entry) => !("elementId" in entry.value) && !("name" in entry.value))).toBe(true);
    const use = compiled.document!.elements.find((element) => element.name === "Use");
    expect(use && result.computedGeometry.get(use.id)).toMatchObject({ kind: "line" });
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

  it.each([
    ["external", "left"],
    ["external", "right"],
    ["internal", "left"],
    ["internal", "right"]
  ] as const)("evaluates pure commonTangent %s/%s as a strict identity-free line", (kind, side) => {
    const { compiled, result } = evaluate([
      "nui 1",
      "point C1 = coordinate(x: 0, y: 0)",
      "point C2 = coordinate(x: 60, y: 0)",
      "arc A = arc(center: @C1, radius: 20, start: 40, end: 80)",
      "arc B = arc(center: @C2, radius: 10, start: 210, end: 250)",
      `const Tangent: line = commonTangent(first: @A, second: @B, kind: ${kind}, side: ${side})`,
      "const Path: path = @Tangent",
      "const StartX: number = @Tangent.start.x",
      "line Use = segment(start: @Tangent.start, end: @Tangent.end)"
    ].join("\n"));

    const entry = compiled.geometryValueProgram?.find((candidate) => candidate.sourceStatementId === "geometry-value-runtime:5");
    const value = [...(result.computedGeometryValues?.values() ?? [])]
      .find((candidate) => candidate.occurrence.sourceStatementId === "geometry-value-runtime:5")?.value;
    expect(entry?.construction.kind).toBe("commonTangent");
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    expect(value).toMatchObject({ kind: "line", length: expect.any(Number) });
    expect(value && "elementId" in value).toBe(false);
    expect(value && "name" in value).toBe(false);
    expect(result.computedGeometry.get("geometry-value-runtime:8")).toMatchObject({
      kind: "line",
      start: { x: value?.kind === "line" ? value.start.x : expect.any(Number) },
      end: { x: value?.kind === "line" ? value.end.x : expect.any(Number) }
    });
  });

  it("accepts direct and through pure arcs as commonTangent inputs", () => {
    const { result } = evaluate([
      "nui 1",
      "const First: path = arc(center: (0, 0), radius: 20, start: 0, end: 90, direction: counterclockwise)",
      "const Second: path = through(point1: (70, 0), point2: (60, 10), point3: (50, 0), start: 0, end: 90)",
      "const Tangent: line = commonTangent(first: @First, second: @Second, kind: external, side: left)",
      "const Path: path = @Tangent"
    ].join("\n"));

    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    expect([...result.computedGeometryValues!.values()].map((entry) => entry.value.kind)).toEqual([
      "arcLine",
      "arcLine",
      "line"
    ]);
  });

  it("evaluates commonTangent kind and side through typed choice bindings", () => {
    const { result } = evaluate([
      "nui 1",
      "const Kind: choice(external, internal) = internal",
      "const Side: choice(left, right) = right",
      "const First: path = arc(center: (0, 0), radius: 20, start: 0, end: 90)",
      "const Second: path = arc(center: (60, 0), radius: 10, start: 0, end: 90)",
      "const Tangent: line = commonTangent(first: @First, second: @Second, kind: @Kind, side: @Side)"
    ].join("\n"));

    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    expect([...result.computedGeometryValues!.values()].at(-1)?.value).toMatchObject({ kind: "line" });
  });

  it("reports pure commonTangent non-arc and impossible solutions on the owning occurrence", () => {
    const nonArc = evaluate([
      "nui 1",
      "const Line: line = segment(start: (0, 0), end: (10, 0))",
      "const Tangent: line = commonTangent(first: @Line, second: @Line, kind: external, side: left)"
    ].join("\n"));
    expect(nonArc.result.errors).toEqual([]);
    expect(nonArc.result.computedGeometryValues).toEqual(expect.any(Map));
    expect([...nonArc.result.computedGeometryValues!.values()].map((entry) => entry.value.kind)).toEqual(["line"]);
    expect(nonArc.result.geometryValueErrors).toEqual([
      {
        occurrence: nonArc.compiled.geometryValueProgram![1]!.occurrence,
        message: "first に円弧が指定されていません。共通接線には円弧を指定してください。"
      },
      {
        occurrence: nonArc.compiled.geometryValueProgram![1]!.occurrence,
        message: "second に円弧が指定されていません。共通接線には円弧を指定してください。"
      }
    ]);

    const impossible = evaluate([
      "nui 1",
      "const First: path = arc(center: (0, 0), radius: 10, start: 0, end: 90)",
      "const Second: path = arc(center: (15, 0), radius: 10, start: 0, end: 90)",
      "const Tangent: line = commonTangent(first: @First, second: @Second, kind: internal, side: left)"
    ].join("\n"));
    expect(impossible.result.errors).toEqual([]);
    expect(impossible.result.computedGeometryValues).toEqual(expect.any(Map));
    expect([...impossible.result.computedGeometryValues!.values()].map((entry) => entry.value.kind)).toEqual(["arcLine", "arcLine"]);
    expect(impossible.result.geometryValueErrors).toEqual([{
      occurrence: impossible.compiled.geometryValueProgram![2]!.occurrence,
      message: "kind: internal の共通接線は存在しません。2つの円の位置・半径または kind を変更してください。"
    }]);
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

  it("evaluates pure Bezier feature points from an identity-free Bezier path", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "const Extreme: point = bezierExtremePoint(source: @Curve, segmentIndex: 0, direction: 90)",
      "const Bulge: point = bezierBulgePoint(source: @Curve, segmentIndex: 0)",
      "line Use = segment(start: @Extreme, end: @Bulge)"
    ].join("\n"));

    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual([
      "bezier",
      "bezierExtremePoint",
      "bezierBulgePoint"
    ]);
    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    expect(values[0]?.value).toEqual(expect.objectContaining({ kind: "bezierCurve" }));
    expect(values[1]?.value).toMatchObject({ kind: "point", x: expect.closeTo(5, 10), y: expect.closeTo(7.5, 10) });
    expect(values[2]?.value).toEqual({ kind: "point", x: 5, y: 7.5 });
    expect(values.every((entry) => !("elementId" in entry.value) && !("name" in entry.value))).toBe(true);
    expect(result.computedGeometry.has("geometry-value-runtime:2")).toBe(false);
    expect(result.computedGeometry.has("geometry-value-runtime:3")).toBe(false);
    expect(result.computedGeometry.get("geometry-value-runtime:4")).toMatchObject({
      kind: "line",
      start: { x: expect.closeTo(5, 10), y: expect.closeTo(7.5, 10) },
      end: { x: 5, y: 7.5 }
    });
  });

  it("evaluates pure Bezier feature points from a drawable Bezier source", () => {
    const { result } = evaluate([
      "nui 1",
      "curve Curve = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "const Extreme: point = bezierExtremePoint(source: @Curve, segmentIndex: 0, direction: 450)",
      "const Bulge: point = bezierBulgePoint(source: @Curve)"
    ].join("\n"));

    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    expect(values[0]?.value).toMatchObject({ kind: "point", x: expect.closeTo(5, 10), y: expect.closeTo(7.5, 10) });
    expect(values[1]?.value).toEqual({ kind: "point", x: 5, y: 7.5 });
    expect(result.computedGeometry.get("geometry-value-runtime:1")).toMatchObject({
      kind: "bezierCurve"
    });
    expect(result.computedGeometry.has("geometry-value-runtime:2")).toBe(false);
    expect(result.computedGeometry.has("geometry-value-runtime:3")).toBe(false);
  });

  it("evaluates pure tangentOffset angle defaults and curve-side modes without drawable identity", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "const Line: path = segment(start: (0, 0), end: (10, 0))",
      "const Base: point = coordinate(x: 0, y: 0)",
      "const Explicit: point = tangentOffset(line: @Line, base: @Base, angle: 90, distance: 2)",
      "const Default: point = tangentOffset(line: @Line, base: @Base, distance: 2)",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "const Convex: point = tangentOffset(line: @Curve, base: (5, 7.5), curveSide: convex, distance: 1)",
      "const Concave: point = tangentOffset(line: @Curve, base: (5, 7.5), curveSide: concave, distance: 1)",
      "line Use = segment(start: @Explicit, end: @Concave)"
    ].join("\n"));

    expect(compiled.geometryValueProgram?.map((entry) => entry.construction.kind)).toEqual([
      "segment", "coordinate", "tangentOffset", "tangentOffset", "bezier", "tangentOffset", "tangentOffset"
    ]);
    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])];
    expect(values.map((entry) => entry.value)).toEqual([
      expect.objectContaining({ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }),
      { kind: "point", x: 0, y: 0 },
      { kind: "point", x: expect.closeTo(0, 10), y: expect.closeTo(2, 10) },
      { kind: "point", x: expect.closeTo(2, 10), y: expect.closeTo(0, 10) },
      expect.objectContaining({ kind: "bezierCurve" }),
      { kind: "point", x: expect.closeTo(5, 10), y: expect.closeTo(8.5, 10) },
      { kind: "point", x: expect.closeTo(5, 10), y: expect.closeTo(6.5, 10) }
    ]);
    expect(values.every((entry) => !("elementId" in entry.value) && !("name" in entry.value))).toBe(true);
    expect(result.computedGeometry.has("geometry-value-runtime:3")).toBe(false);
    expect(result.computedGeometry.has("geometry-value-runtime:6")).toBe(false);
    expect(result.computedGeometry.has("geometry-value-runtime:7")).toBe(false);
    expect(result.computedGeometry.get("geometry-value-runtime:8")).toMatchObject({
      kind: "line",
      start: { x: expect.closeTo(0, 10), y: expect.closeTo(2, 10) },
      end: { x: expect.closeTo(5, 10), y: expect.closeTo(6.5, 10) }
    });
  });

  it.each([
    [
      "curveSide on a non-Bezier path",
      ["const Line: path = segment(start: (0, 0), end: (10, 0))", "const Bad: point = tangentOffset(line: @Line, base: (0, 0), curveSide: convex, distance: 1)"],
      "tangentOffset geometry value curveSide はベジェ曲線の計算結果にのみ指定できます。"
    ],
    [
      "negative curveSide distance",
      ["const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)", "const Bad: point = tangentOffset(line: @Curve, base: (5, 7.5), curveSide: convex, distance: -1)"],
      "tangentOffset geometry value curveSide の距離は0以上で指定してください。"
    ],
    [
      "off-curve base point",
      ["const Line: path = segment(start: (0, 0), end: (10, 0))", "const Bad: point = tangentOffset(line: @Line, base: (5, 1), angle: 0, distance: 1)"],
      "tangentOffset geometry value 基準点は基準線上にありません。基準線上の点を指定してください。"
    ]
  ] as const)("reports %s through the occurrence-owned channel", (_kind, declarations, message) => {
    const { compiled, result } = evaluate(["nui 1", ...declarations].join("\n"));
    const occurrence = compiled.geometryValueProgram?.at(-1)?.occurrence;
    expect(result.computedGeometryValues).toEqual(expect.any(Map));
    expect(result.geometryValueErrors).toEqual([{ occurrence, message }]);
    expect(result.errors).toEqual([]);
  });

  it.each([
    ["non-Bezier source", "const Source: path = segment(start: (0, 0), end: (10, 0))", "const Invalid: point = bezierExtremePoint(source: @Source, segmentIndex: 0, direction: 90)", "Bezier feature-point construction requires a computed Bezier curve source."],
    ["out-of-range segment", "const Source: path = bezier(start: (0, 0), end: (10, 0))", "const Invalid: point = bezierBulgePoint(source: @Source, segmentIndex: 1)", "bezierBulgePoint segmentIndex 1 is outside the source Bezier segment range (1 segments)."],
    ["degenerate bulge chord", "const Source: path = bezier(start: (0, 0), end: (0, 0), startAngle: 0, startLength: 0, endAngle: 0, endLength: 0)", "const Invalid: point = bezierBulgePoint(source: @Source)", "bezierBulgePoint selected segment has coincident endpoints, so its bulge chord is undefined."]
  ] as const)("reports pure Bezier feature-point failure for %s through the occurrence-owned channel", (_kind, source, declaration, message) => {
    const { compiled, result } = evaluate(["nui 1", source, declaration].join("\n"));
    const occurrence = compiled.geometryValueProgram?.at(-1)?.occurrence;
    expect(result.computedGeometryValues).toEqual(expect.any(Map));
    expect(result.computedGeometryValues?.size).toBe(1);
    expect(result.geometryValueErrors).toEqual([{ occurrence, message }]);
    expect(result.errors).toEqual([]);
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

  it("evaluates Module-local Bezier feature points and qualified exports", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M() {",
      "  const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "  const LocalExtreme: point = bezierExtremePoint(source: @Curve, direction: 90)",
      "  export const Output: point = bezierBulgePoint(source: @Curve)",
      "}",
      "instance One = M()",
      "const Root: point = @One::Output",
      "line Use = segment(start: @Root, end: @One::Output)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])].filter((entry) => entry.occurrence.instancePath.length === 1);
    expect(values).toHaveLength(3);
    expect(values.filter((entry) => entry.value.kind === "point")).toHaveLength(2);
    for (const entry of values.filter((candidate) => candidate.value.kind === "point")) {
      expect(entry.value).toMatchObject({ x: expect.closeTo(5, 10), y: expect.closeTo(7.5, 10) });
    }
    expect(result.computedGeometry.has("geometry-value-runtime:7")).toBe(false);
    expect(result.computedGeometry.get("geometry-value-runtime:8")).toMatchObject({ kind: "line" });
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

  it("evaluates pure intersection points from drawable and path inputs with defaults", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "line Horizontal = segment(start: (0, 0), end: (100, 0))",
      "line Vertical = segment(start: (50, -50), end: (50, 50))",
      "const Default: point = intersection(line1: @Horizontal, line2: @Vertical)",
      "const Explicit: point = intersection(line1: @Horizontal, line2: @Vertical, index: 0, extensions: false)",
      "const Path: path = polyline(points: [(0, 0), (100, 0)], closed: false)",
      "const FromPath: point = intersection(line1: @Path, line2: @Vertical)",
      "line Far = segment(start: (150, -50), end: (150, 50))",
      "const NoIntersection: point = intersection(line1: @Horizontal, line2: @Far)",
      "const Extended: point = intersection(line1: @Horizontal, line2: @Far, extensions: true)",
      "line Use = segment(start: @Default, end: @FromPath)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Horizontal", "Vertical", "Far", "Use"]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([{
      occurrence: { sourceStatementId: "geometry-value-runtime:8", instancePath: [] },
      message: "intersection geometry value could not find an intersection between the referenced geometry inputs. Check line1, line2, or extensions."
    }]);
    const valueFor = (sourceStatementId: string) => [...result.computedGeometryValues!.values()]
      .find((entry) => entry.occurrence.sourceStatementId === sourceStatementId)?.value;
    expect(valueFor("geometry-value-runtime:3")).toEqual({ kind: "point", x: 50, y: 0 });
    expect(valueFor("geometry-value-runtime:4")).toEqual({ kind: "point", x: 50, y: 0 });
    expect(valueFor("geometry-value-runtime:5")).toMatchObject({ kind: "polyline", closed: false });
    expect(valueFor("geometry-value-runtime:6")).toEqual({ kind: "point", x: 50, y: 0 });
    expect(valueFor("geometry-value-runtime:9")).toEqual({ kind: "point", x: 150, y: 0 });
    expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    expect(result.computedGeometry.get("geometry-value-runtime:10")).toMatchObject({
      kind: "line",
      start: { x: 50, y: 0 },
      end: { x: 50, y: 0 }
    });
  });

  it("selects deterministic nonzero pure intersection indexes and feeds the selected points to a consumer", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "line Horizontal = segment(start: (-20, 0), end: (20, 0))",
      "const Circle: path = arc(center: (0, 0), radius: 10, start: 0, end: 360, direction: counterclockwise)",
      "const First: point = intersection(line1: @Horizontal, line2: @Circle, index: 0, extensions: false)",
      "const Second: point = intersection(line1: @Horizontal, line2: @Circle, index: 1, extensions: false)",
      "line Use = segment(start: @First, end: @Second)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const valueFor = (sourceStatementId: string) => [...result.computedGeometryValues!.values()]
      .find((entry) => entry.occurrence.sourceStatementId === sourceStatementId)?.value;
    expect(valueFor("geometry-value-runtime:3")).toEqual({ kind: "point", x: -10, y: 0 });
    expect(valueFor("geometry-value-runtime:4")).toEqual({ kind: "point", x: 10, y: 0 });
    expect(result.computedGeometry.get("geometry-value-runtime:5")).toMatchObject({
      kind: "line",
      start: { x: -10, y: 0 },
      end: { x: 10, y: 0 },
      length: 20
    });
    expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
  });

  it("rejects distinct source-level aliases that resolve to the same intersection source", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "line Source = segment(start: (0, 0), end: (100, 0))",
      "const First: path = @Source",
      "const Second: line = @Source",
      "const Same: point = intersection(line1: @First, line2: @Second)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometryValues).toEqual(new Map());
    expect(result.geometryValueErrors).toEqual([{
      occurrence: { sourceStatementId: "geometry-value-runtime:4", instancePath: [] },
      message: "intersection geometry value cannot intersect the same source geometry twice."
    }]);
    expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
  });

  it("reports an intersection with an unavailable invalid path through occurrence-owned geometryValueErrors", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "line Vertical = segment(start: (5, -10), end: (5, 10))",
      "const Invalid: path = polyline(points: [(0, 0), (10 / 0, 0)], closed: false)",
      "const Failed: point = intersection(line1: @Invalid, line2: @Vertical)"
    ].join("\n"));

    const invalid = compiled.geometryValueProgram?.find((entry) => entry.sourceStatementId === "geometry-value-runtime:2");
    const failed = compiled.geometryValueProgram?.find((entry) => entry.sourceStatementId === "geometry-value-runtime:3");
    expect(invalid).toBeDefined();
    expect(failed).toBeDefined();
    expect(result.computedGeometryValues).toEqual(new Map());
    expect(result.geometryValueErrors).toEqual([
      {
        occurrence: invalid!.occurrence,
        message: "Polyline geometry value construction inputs are unavailable or invalid."
      },
      {
        occurrence: failed!.occurrence,
        message: "intersection geometry value inputs are unavailable or invalid."
      }
    ]);
    expect(result.errors).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Vertical"]);
    expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
  });

  it("reports pure intersection source, index, and cardinality failures by occurrence", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "line Horizontal = segment(start: (0, 0), end: (100, 0))",
      "line Vertical = segment(start: (50, -50), end: (50, 50))",
      "const Same: point = intersection(line1: @Horizontal, line2: @Horizontal)",
      "const Negative: point = intersection(line1: @Horizontal, line2: @Vertical, index: -1)",
      "const Fractional: point = intersection(line1: @Horizontal, line2: @Vertical, index: 0.5)",
      "const OutOfRange: point = intersection(line1: @Horizontal, line2: @Vertical, index: 1)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.computedGeometryValues).toEqual(expect.any(Map));
    expect(result.geometryValueErrors).toEqual([
      {
        occurrence: { sourceStatementId: "geometry-value-runtime:3", instancePath: [] },
        message: "intersection geometry value cannot intersect the same source geometry twice."
      },
      {
        occurrence: { sourceStatementId: "geometry-value-runtime:4", instancePath: [] },
        message: "intersection geometry value index must be a finite non-negative integer."
      },
      {
        occurrence: { sourceStatementId: "geometry-value-runtime:5", instancePath: [] },
        message: "intersection geometry value index must be a finite non-negative integer."
      },
      {
        occurrence: { sourceStatementId: "geometry-value-runtime:6", instancePath: [] },
        message: "intersection geometry value index 1 is unavailable. There are 1 intersections."
      }
    ]);
  });

  it("supports pure intersection points in Module locals and qualified exports", () => {
    const { compiled, result } = evaluate([
      "nui 1",
      "module M(first: path, second: path) {",
      "  const Local: point = intersection(line1: @first, line2: @second)",
      "  export const Output: point = intersection(line1: @first, line2: @second, index: 0, extensions: false)",
      "}",
      "line Horizontal = segment(start: (0, 0), end: (100, 0))",
      "line Vertical = segment(start: (50, -50), end: (50, 50))",
      "instance One = M(first: @Horizontal, second: @Vertical)",
      "const Root: point = @One::Output",
      "line Use = segment(start: @One::Output, end: @Root)"
    ].join("\n"));

    expect(compiled.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const values = [...result.computedGeometryValues!.values()];
    expect(values.filter((entry) => entry.occurrence.instancePath.length === 1).map((entry) => entry.value)).toEqual([
      { kind: "point", x: 50, y: 0 },
      { kind: "point", x: 50, y: 0 }
    ]);
    expect(values.filter((entry) => entry.occurrence.instancePath.length === 0)).toEqual([]);
    expect(values.every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    expect(result.computedGeometry.get("geometry-value-runtime:9")).toMatchObject({
      kind: "line",
      start: { x: 50, y: 0 },
      end: { x: 50, y: 0 }
    });
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
