import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import {
  evaluateWithRustFixture,
  isCurrentReleaseFixture,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  parityFixtureNames,
  readParityFixture,
  runtimeDiagnosticsFor,
  evaluateWithRustOptions,
  fixtureFromSource
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runRustParity = import.meta.env.VITE_RUN_RUST_PARITY === "1";
const fixtureNames = runRustParity ? parityFixtureNames(repoRoot) : [];

const scalarBindingFor = (
  fixture: ReturnType<typeof readParityFixture>,
  payload: ReturnType<typeof evaluateWithRustFixture>,
  name: string
) => {
  const binding = fixture.compiled?.doc?.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding "${name}" not found`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

const expectScalarNumberClose = (
  value: ReturnType<typeof scalarBindingFor>,
  expected: number
): void => {
  expect(value?.status).toBe("ok");
  if (value?.status !== "ok" || value.value.kind !== "number") throw new Error("expected a numeric scalar success");
  expect(value.value.value).toBeCloseTo(expected, 10);
};

describe.skipIf(!runRustParity)("TypeScript/Rust evaluation parity fixtures", () => {
  it("keeps incompatible geometry-value construction in the occurrence-owned error channel", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const PointValue: point = coordinate(x: 1, y: 2)",
      "const LineValue: line = segment(start: (0, 0), end: (10, 0))"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 2) throw new Error("expected two geometry value program entries");
    const options = {
      ...optionsFor(fixture),
      geometryValueProgram: [
        { ...program[0]!, declaredInterfaceType: "line" as const },
        { ...program[1]!, declaredInterfaceType: "point" as const }
      ]
    };
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(tsPayload.errors).toEqual([]);
    expect(tsPayload.computedGeometryValues).toBeUndefined();
    expect(tsPayload.geometryValueErrors).toEqual([
      {
        occurrence: program[0]!.occurrence,
        message: "Geometry value construction is incompatible with its declared interface type."
      },
      {
        occurrence: program[1]!.occurrence,
        message: "Geometry value construction is incompatible with its declared interface type."
      }
    ]);
  }, 30000);

  it("matches direct pure arc values and radius diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Valid: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: clockwise)",
      "const Invalid: path = arc(center: (0, 0), radius: -5, start: 0, end: 90, direction: counterclockwise)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 2) throw new Error("expected valid and invalid pure arc program entries");
    const validEntry = program[0]!;
    const invalidEntry = program[1]!;
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const sameOccurrence = (
      left: typeof validEntry.occurrence,
      right: typeof validEntry.occurrence
    ) => left.sourceStatementId === right.sourceStatementId &&
      left.instancePath.length === right.instancePath.length &&
      left.instancePath.every((value, index) => value === right.instancePath[index]);
    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof validEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => sameOccurrence(entry.occurrence, occurrence))?.value;

    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      const validValue = valueFor(result, validEntry.occurrence);
      expect(validValue).toMatchObject({ kind: "arcLine", radius: 10, sweepAngleDeg: -270 });
      expect(validValue).not.toHaveProperty("elementId");
      expect(valueFor(result, invalidEntry.occurrence)).toBeUndefined();
      expect(result.geometryValueErrors).toEqual([{
        occurrence: invalidEntry.occurrence,
        message: "円弧の半径は0より大きい値で指定してください。"
      }]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure transformCopy and mirrorCopy path values across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 2, endAngle: -90, endLength: 2)",
      "const Transformed: path = transformCopy(startPoint: (0, 0), endPoint: (20, 10), scale: 2, angleDeg: 90, mirrorX: true, baseLines: [@Curve])",
      "const Arc: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "const Mirrored: path = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [@Arc])"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 4) throw new Error("expected four pure copy path program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      const values = [...(result.computedGeometryValues?.values() ?? [])].map((entry) => entry.value);
      expect(values).toHaveLength(4);
      expect(values[0]).toMatchObject({ kind: "bezierCurve", segments: [{ control1: expect.any(Object), control2: expect.any(Object) }] });
      expect(values[1]).toMatchObject({
        kind: "offsetLine",
        start: { x: 20, y: 10 },
        end: { x: 20, y: -10 },
        segments: [{ kind: "bezier", control1: { x: 16, y: 10 }, control2: { x: 16, y: -10 } }]
      });
      expect(values[2]).toMatchObject({ kind: "arcLine", radius: 10, sweepAngleDeg: 90 });
      expect(values[3]).toMatchObject({ kind: "offsetLine", segments: [{ kind: "arc", radius: 10, sweepAngleDeg: -90 }] });
      expect(values.every((value) => !("elementId" in value) && !("name" in value) && !("baseLineIds" in value))).toBe(true);
      expect(values[1]).not.toHaveProperty("elementId");
      expect(values[3]).not.toHaveProperty("name");
      expect(result.geometryValueErrors).toEqual([]);
    }
  }, 30000);

  it("matches invalid copy path scale, mirror axis, and ordered sources across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line First = segment(start: (0, 0), end: (10, 0))",
      "line Second = segment(start: (20, 0), end: (30, 0))",
      "const BadScale: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), scale: 0, baseLines: [@First])",
      "const BadAxis: path = mirrorCopy(axis1: (0, 0), axis2: (0, 0), baseLines: [@First])",
      "const Discontinuous: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), baseLines: [@First, @Second])",
      "const EmptyTransform: path = transformCopy(startPoint: (0, 0), endPoint: (10, 0), baseLines: [])",
      "const EmptyMirror: path = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [])"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 5) throw new Error("expected five invalid pure copy path program entries");
    const badScale = program.find((entry) => entry.sourceStatementIndex === 3);
    const badAxis = program.find((entry) => entry.sourceStatementIndex === 4);
    const discontinuous = program.find((entry) => entry.sourceStatementIndex === 5);
    const emptyTransform = program.find((entry) => entry.sourceStatementIndex === 6);
    const emptyMirror = program.find((entry) => entry.sourceStatementIndex === 7);
    if (!badScale || !badAxis || !discontinuous || !emptyTransform || !emptyMirror) throw new Error("expected invalid copy path entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometryValues).toEqual(new Map());
      expect(result.geometryValueErrors).toEqual([
        {
          occurrence: badScale.occurrence,
          message: "transformCopy geometry value construction scale must be a finite positive number."
        },
        {
          occurrence: badAxis.occurrence,
          message: "mirrorCopy geometry value construction requires two distinct axis points."
        },
        {
          occurrence: discontinuous.occurrence,
          message: "transformCopy geometry value construction baseLines are not continuous in the specified order."
        },
        {
          occurrence: emptyTransform.occurrence,
          message: "transformCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments."
        },
        {
          occurrence: emptyMirror.occurrence,
          message: "mirrorCopy geometry value construction inputs are unavailable, non-line-like, or contain no segments."
        }
      ]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure polar point and strict-line values across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "const P: point = polar(from: @Base, angle: 90, distance: 20)",
      "const DefaultP: point = polar(from: @Base)",
      "const L: line = polar(start: @P, angle: 30, length: 100)",
      "const DefaultL: line = polar(start: @P)",
      "const Path: path = @L",
      "const Px: number = @P.x",
      "const Ly: number = @L.end.y"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 4) throw new Error("expected four pure polar geometry value program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      const values = [...(result.computedGeometryValues?.values() ?? [])];
      expect(values).toHaveLength(4);
      expect(values[0]?.value).toMatchObject({ kind: "point", x: expect.closeTo(10, 10), y: 40 });
      expect(values[1]?.value).toEqual({ kind: "point", x: 10, y: 20 });
      expect(values[2]?.value).toMatchObject({ kind: "line", start: { x: expect.closeTo(10, 10), y: 40 }, length: expect.closeTo(100, 10) });
      expect(values[3]?.value).toMatchObject({ kind: "line", start: { x: expect.closeTo(10, 10), y: 40 }, end: { x: expect.closeTo(110, 10), y: 40 }, length: expect.closeTo(100, 10) });
      expect(values.every((entry) => !("elementId" in entry.value) && !("name" in entry.value))).toBe(true);
    }
  }, 30000);

  it("matches pure commonTangent solutions and pure arc inputs across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point C1 = coordinate(x: 0, y: 0)",
      "point C2 = coordinate(x: 60, y: 0)",
      "arc A = arc(center: @C1, radius: 20, start: 40, end: 80)",
      "arc B = arc(center: @C2, radius: 10, start: 210, end: 250)",
      "const ExternalLeft: line = commonTangent(first: @A, second: @B, kind: external, side: left)",
      "const ExternalRight: line = commonTangent(first: @A, second: @B, kind: external, side: right)",
      "const InternalLeft: line = commonTangent(first: @A, second: @B, kind: internal, side: left)",
      "const InternalRight: line = commonTangent(first: @A, second: @B, kind: internal, side: right)",
      "const PureFirst: path = arc(center: (0, 0), radius: 20, start: 0, end: 90, direction: counterclockwise)",
      "const PureSecond: path = through(point1: (70, 0), point2: (60, 10), point3: (50, 0), start: 0, end: 90)",
      "const PureInputs: line = commonTangent(first: @PureFirst, second: @PureSecond, kind: external, side: left)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 7) throw new Error("expected seven pure commonTangent program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      const values = [...(result.computedGeometryValues?.values() ?? [])];
      expect(values).toHaveLength(7);
      expect(values.filter((entry) => entry.value.kind === "line")).toHaveLength(5);
      expect(values.filter((entry) => entry.value.kind === "line").every((entry) => {
        const value = entry.value;
        return value.kind === "line" && !(
          "elementId" in value || "name" in value
        );
      })).toBe(true);
      expect(values.at(-1)?.value).toMatchObject({ kind: "line", length: expect.any(Number) });
    }
  }, 30000);

  it("matches pure Bezier feature points from pure and drawable sources", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "const PureExtreme: point = bezierExtremePoint(source: @Curve, segmentIndex: 0, direction: 450)",
      "const PureBulge: point = bezierBulgePoint(source: @Curve)",
      "curve Drawable = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "const DrawableExtreme: point = bezierExtremePoint(source: @Drawable, direction: 90)",
      "const DrawableBulge: point = bezierBulgePoint(source: @Drawable)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 5) throw new Error("expected five pure Bezier feature-point program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      const values = [...(result.computedGeometryValues?.values() ?? [])];
      expect(values).toHaveLength(5);
      for (const entry of values.filter((candidate) => candidate.value.kind === "point")) {
        expect(entry.value).toMatchObject({
          kind: "point",
          x: expect.closeTo(5, 10),
          y: expect.closeTo(7.5, 10)
        });
        expect(entry.value).not.toHaveProperty("elementId");
        expect(entry.value).not.toHaveProperty("name");
      }
    }
  }, 30000);

  it("matches pure tangentOffset angle and curve-side values across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
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
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 7) throw new Error("expected seven pure tangentOffset program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      const values = [...(result.computedGeometryValues?.values() ?? [])];
      expect(values).toHaveLength(7);
      expect(values[2]?.value).toMatchObject({ kind: "point", x: expect.closeTo(0, 10), y: expect.closeTo(2, 10) });
      expect(values[3]?.value).toMatchObject({ kind: "point", x: expect.closeTo(2, 10), y: expect.closeTo(0, 10) });
      expect(values[5]?.value).toMatchObject({ kind: "point", x: expect.closeTo(5, 10), y: expect.closeTo(8.5, 10) });
      expect(values[6]?.value).toMatchObject({ kind: "point", x: expect.closeTo(5, 10), y: expect.closeTo(6.5, 10) });
      expect(values.every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    }
  }, 30000);

  it("matches pure between and onLine division points across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 100, y: 0)",
      "const BetweenRatio: point = between(start: @A, end: @B, ratio: 0.5)",
      "const BetweenDistance: point = between(start: @A, end: @B, distance: 25)",
      "const L: line = segment(start: @A, end: @B)",
      "const OnLineRatio: point = onLine(from: @L.start, ratio: 0.5)",
      "const OnLineDistance: point = onLine(from: @L.end, distance: 25)",
      "line Use = segment(start: @BetweenRatio, end: @OnLineDistance)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure division geometry value program entries");
    const entryFor = (sourceStatementIndex: number) => program.find((entry) => entry.sourceStatementIndex === sourceStatementIndex);
    const betweenRatio = entryFor(3);
    const betweenDistance = entryFor(4);
    const line = entryFor(5);
    const onLineRatio = entryFor(6);
    const onLineDistance = entryFor(7);
    if (!betweenRatio || !betweenDistance || !line || !onLineRatio || !onLineDistance) {
      throw new Error("expected all pure division geometry value entries");
    }
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof betweenRatio.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
        entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      expect(valueFor(result, betweenRatio.occurrence)).toEqual({ kind: "point", x: 50, y: 0 });
      expect(valueFor(result, betweenDistance.occurrence)).toEqual({ kind: "point", x: 25, y: 0 });
      expect(valueFor(result, line.occurrence)).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, length: 100 });
      expect(valueFor(result, onLineRatio.occurrence)).toEqual({ kind: "point", x: 50, y: 0 });
      expect(valueFor(result, onLineDistance.occurrence)).toEqual({ kind: "point", x: 75, y: 0 });
      expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
      expect([...result.computedGeometry.values()][0]).toMatchObject({ kind: "line", start: { x: 50, y: 0 }, end: { x: 75, y: 0 } });
    }
  }, 30000);

  it("matches pure intersection points, extensions, and path inputs across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
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
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure intersection geometry value program entries");
    const entryFor = (sourceStatementIndex: number) => program.find((entry) => entry.sourceStatementIndex === sourceStatementIndex);
    const defaultEntry = entryFor(3);
    const explicitEntry = entryFor(4);
    const pathEntry = entryFor(5);
    const fromPathEntry = entryFor(6);
    const noIntersectionEntry = entryFor(8);
    const extendedEntry = entryFor(9);
    if (!defaultEntry || !explicitEntry || !pathEntry || !fromPathEntry || !noIntersectionEntry || !extendedEntry) {
      throw new Error("expected all pure intersection entries");
    }
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof defaultEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
        entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;

    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(valueFor(result, defaultEntry.occurrence)).toEqual({ kind: "point", x: 50, y: 0 });
      expect(valueFor(result, explicitEntry.occurrence)).toEqual({ kind: "point", x: 50, y: 0 });
      expect(valueFor(result, pathEntry.occurrence)).toMatchObject({ kind: "polyline", closed: false });
      expect(valueFor(result, fromPathEntry.occurrence)).toEqual({ kind: "point", x: 50, y: 0 });
      expect(valueFor(result, extendedEntry.occurrence)).toEqual({ kind: "point", x: 150, y: 0 });
      expect(result.geometryValueErrors).toEqual([{
        occurrence: noIntersectionEntry.occurrence,
        message: "intersection geometry value could not find an intersection between the referenced geometry inputs. Check line1, line2, or extensions."
      }]);
      expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    }
  }, 30000);

  it("matches deterministic nonzero pure intersection indexes across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Horizontal = segment(start: (-20, 0), end: (20, 0))",
      "const Circle: path = arc(center: (0, 0), radius: 10, start: 0, end: 360, direction: counterclockwise)",
      "const First: point = intersection(line1: @Horizontal, line2: @Circle, index: 0, extensions: false)",
      "const Second: point = intersection(line1: @Horizontal, line2: @Circle, index: 1, extensions: false)",
      "line Use = segment(start: @First, end: @Second)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure intersection geometry value program entries");
    const firstEntry = program.find((entry) => entry.sourceStatementIndex === 3);
    const secondEntry = program.find((entry) => entry.sourceStatementIndex === 4);
    if (!firstEntry || !secondEntry) throw new Error("expected both indexed pure intersection entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof firstEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
        entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([]);
      expect(valueFor(result, firstEntry.occurrence)).toEqual({ kind: "point", x: -10, y: 0 });
      expect(valueFor(result, secondEntry.occurrence)).toEqual({ kind: "point", x: 10, y: 0 });
      expect([...result.computedGeometryValues!.values()].every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    }
  }, 30000);

  it("matches same-source alias rejection and unavailable intersection inputs across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Source = segment(start: (0, 0), end: (100, 0))",
      "const First: path = @Source",
      "const Second: line = @Source",
      "const Same: point = intersection(line1: @First, line2: @Second)",
      "line Vertical = segment(start: (5, -10), end: (5, 10))",
      "const Invalid: path = polyline(points: [(0, 0), (10 / 0, 0)], closed: false)",
      "const Failed: point = intersection(line1: @Invalid, line2: @Vertical)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure intersection geometry value program entries");
    const sameEntry = program.find((entry) => entry.sourceStatementIndex === 4);
    const invalidEntry = program.find((entry) => entry.sourceStatementIndex === 6);
    const failedEntry = program.find((entry) => entry.sourceStatementIndex === 7);
    if (!sameEntry || !invalidEntry || !failedEntry) throw new Error("expected alias and unavailable intersection entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometryValues).toEqual(new Map());
      expect(result.geometryValueErrors).toEqual([
        {
          occurrence: sameEntry.occurrence,
          message: "intersection geometry value cannot intersect the same source geometry twice."
        },
        {
          occurrence: invalidEntry.occurrence,
          message: "Polyline geometry value construction inputs are unavailable or invalid."
        },
        {
          occurrence: failedEntry.occurrence,
          message: "intersection geometry value inputs are unavailable or invalid."
        }
      ]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure intersection source, index, and cardinality diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Horizontal = segment(start: (0, 0), end: (100, 0))",
      "line Vertical = segment(start: (50, -50), end: (50, 50))",
      "const Same: point = intersection(line1: @Horizontal, line2: @Horizontal)",
      "const Negative: point = intersection(line1: @Horizontal, line2: @Vertical, index: -1)",
      "const Fractional: point = intersection(line1: @Horizontal, line2: @Vertical, index: 0.5)",
      "const OutOfRange: point = intersection(line1: @Horizontal, line2: @Vertical, index: 1)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure intersection geometry value program entries");
    const entryFor = (sourceStatementIndex: number) => program.find((entry) => entry.sourceStatementIndex === sourceStatementIndex);
    const same = entryFor(3);
    const negative = entryFor(4);
    const fractional = entryFor(5);
    const outOfRange = entryFor(6);
    if (!same || !negative || !fractional || !outOfRange) throw new Error("expected all intersection diagnostic entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([
        { occurrence: same.occurrence, message: "intersection geometry value cannot intersect the same source geometry twice." },
        { occurrence: negative.occurrence, message: "intersection geometry value index must be a finite non-negative integer." },
        { occurrence: fractional.occurrence, message: "intersection geometry value index must be a finite non-negative integer." },
        { occurrence: outOfRange.occurrence, message: "intersection geometry value index 1 is unavailable. There are 1 intersections." }
      ]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure division-point degenerate diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const A: point = coordinate(x: 0, y: 0)",
      "const B: point = coordinate(x: 0, y: 0)",
      "const BetweenDistance: point = between(start: @A, end: @B, distance: 1)",
      "const L: line = segment(start: @A, end: @B)",
      "const OnLineDistance: point = onLine(from: @L.start, distance: 1)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure division geometry value program entries");
    const betweenDistance = program.find((entry) => entry.sourceStatementIndex === 3);
    const onLineDistance = program.find((entry) => entry.sourceStatementIndex === 5);
    if (!betweenDistance || !onLineDistance) throw new Error("expected degenerate division entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(evaluationPayloadToResult(tsPayload).errors).toEqual([]);
    expect(evaluationPayloadToResult(rustPayload).errors).toEqual([]);
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.geometryValueErrors).toEqual([
        {
          occurrence: betweenDistance.occurrence,
          message: "between construction cannot determine a distance direction because its endpoints coincide."
        },
        {
          occurrence: onLineDistance.occurrence,
          message: "onLine construction cannot determine a point from the referenced line. Specify a usable line-like geometry."
        }
      ]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure through values and degenerate diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const P1: point = coordinate(x: 10, y: 0)",
      "const P2: point = coordinate(x: 0, y: 10)",
      "const P3: point = coordinate(x: -10, y: 0)",
      "const Valid: path = through(point1: @P1, point2: @P2, point3: @P3, start: 30, end: 120)",
      "const Invalid: path = through(point1: (0, 0), point2: (1, 1), point3: (2, 2))"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure through geometry value program entries");
    const validEntry = program.find((entry) => entry.construction.kind === "through" && entry.sourceStatementIndex === 4);
    const invalidEntry = program.find((entry) => entry.construction.kind === "through" && entry.sourceStatementIndex === 5);
    if (!validEntry || !invalidEntry) throw new Error("expected valid and invalid pure through program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const sameOccurrence = (
      left: typeof validEntry.occurrence,
      right: typeof validEntry.occurrence
    ) => left.sourceStatementId === right.sourceStatementId &&
      left.instancePath.length === right.instancePath.length &&
      left.instancePath.every((value, index) => value === right.instancePath[index]);
    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof validEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => sameOccurrence(entry.occurrence, occurrence))?.value;

    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([{
        occurrence: invalidEntry.occurrence,
        message: "点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。"
      }]);
      const validValue = valueFor(result, validEntry.occurrence);
      expect(validValue).toMatchObject({
        kind: "arcLine",
        center: { x: 0, y: 0 },
        radius: 10,
        startAngleDeg: 30,
        endAngleDeg: 120,
        sweepAngleDeg: 90,
        length: 10 * Math.PI / 2
      });
      expect(validValue).not.toHaveProperty("elementId");
      expect(valueFor(result, invalidEntry.occurrence)).toBeUndefined();
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure bezier values, intermediates, and invalid-input diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Start: point = coordinate(x: 0, y: 0)",
      "const Middle: point = coordinate(x: 5, y: 2)",
      "const End: point = coordinate(x: 10, y: 0)",
      "const Valid: path = bezier(start: @Start, end: @End, startAngle: 0, startLength: 3, endAngle: 180, endLength: 4, intermediates: [@Middle: 90: 1: 2])",
      "const Invalid: path = bezier(start: (0, 0), end: (10, 0), startAngle: 0, startLength: 10 / 0, endAngle: 180, endLength: 2)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure bezier geometry value program entries");
    const validEntry = program.find((entry) => entry.construction.kind === "bezier" && entry.sourceStatementIndex === 4);
    const invalidEntry = program.find((entry) => entry.construction.kind === "bezier" && entry.sourceStatementIndex === 5);
    if (!validEntry || !invalidEntry) throw new Error("expected valid and invalid pure bezier program entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const sameOccurrence = (
      left: typeof validEntry.occurrence,
      right: typeof validEntry.occurrence
    ) => left.sourceStatementId === right.sourceStatementId &&
      left.instancePath.length === right.instancePath.length &&
      left.instancePath.every((value, index) => value === right.instancePath[index]);
    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof validEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => sameOccurrence(entry.occurrence, occurrence))?.value;

    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors).toEqual([{
        occurrence: invalidEntry.occurrence,
        message: "Bezier geometry value construction inputs are unavailable or invalid."
      }]);
      expect(valueFor(result, validEntry.occurrence)).toMatchObject({
        kind: "bezierCurve",
        segments: [
          { start: { x: 0, y: 0 }, control1: { x: 3, y: 0 }, control2: { x: 5, y: 1 }, end: { x: 5, y: 2 } },
          { start: { x: 5, y: 2 }, control1: { x: 5, y: 4 }, control2: { x: 14 }, end: { x: 10, y: 0 } }
        ]
      });
      expect(valueFor(result, validEntry.occurrence)).not.toHaveProperty("elementId");
      expect(valueFor(result, invalidEntry.occurrence)).toBeUndefined();
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure polyline values and occurrence-owned cardinality diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const Open: path = polyline(points: [(0, 0), (3, 4), (3, 0)], closed: false)",
      "const Closed: path = polyline(points: [(0, 0), (3, 4), (3, 0)], closed: true)",
      "const Invalid: path = polyline(points: [(0, 0)], closed: false)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure polyline geometry value program entries");
    const openEntry = program.find((entry) => entry.construction.kind === "polyline" && entry.sourceStatementIndex === 1);
    const closedEntry = program.find((entry) => entry.construction.kind === "polyline" && entry.sourceStatementIndex === 2);
    const invalidEntry = program.find((entry) => entry.construction.kind === "polyline" && entry.sourceStatementIndex === 3);
    if (!openEntry || !closedEntry || !invalidEntry) throw new Error("expected open, closed, and invalid pure polyline entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const valueFor = (
      result: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof openEntry.occurrence
    ) => [...(result.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId && entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;

    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      expect(valueFor(result, openEntry.occurrence)).toMatchObject({ kind: "polyline", closed: false, length: 9 });
      expect(valueFor(result, closedEntry.occurrence)).toMatchObject({ kind: "polyline", closed: true, length: 12, end: { x: 0, y: 0 } });
      expect(valueFor(result, openEntry.occurrence)).not.toHaveProperty("elementId");
      expect(valueFor(result, invalidEntry.occurrence)).toBeUndefined();
      expect(result.geometryValueErrors).toEqual([{
        occurrence: invalidEntry.occurrence,
        message: "Polyline geometry value construction requires at least 2 finite points."
      }]);
      expect(result.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches pure point and line offset values, joins, and occurrence diagnostics across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point BasePoint = coordinate(x: 1, y: 2)",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "line BC = segment(start: (10, 0), end: (10, 10))",
      "line CA = segment(start: (10, 10), end: (0, 0))",
      "line CD = segment(start: (20, 0), end: (30, 0))",
      "const Point: point = offset(from: @BasePoint, dx: 1 + 2, dy: -4)",
      "const Open: path = offset(sources: [@AB, @BC], distance: 2, side: right, closed: false, suppressTrimWarnings: false)",
      "const Closed: path = offset(sources: [@AB, @BC, @CA], distance: 2, side: right, closed: true, suppressTrimWarnings: false)",
      "const Invalid: path = offset(sources: [@AB, @CD], distance: 1, side: right, closed: false, suppressTrimWarnings: false)",
      "line Use = segment(start: @Point, end: @Open.start)"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program) throw new Error("expected pure offset geometry value program entries");
    const pointEntry = program.find((entry) => entry.construction.kind === "offsetPoint");
    const openEntry = program.find((entry) => entry.construction.kind === "offsetPath" && entry.sourceStatementIndex === 7);
    const closedEntry = program.find((entry) => entry.construction.kind === "offsetPath" && entry.sourceStatementIndex === 8);
    const invalidEntry = program.find((entry) => entry.construction.kind === "offsetPath" && entry.sourceStatementIndex === 9);
    if (!pointEntry || !openEntry || !closedEntry || !invalidEntry) throw new Error("expected point, open, closed, and invalid offset entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      payload: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof pointEntry.occurrence
    ) => [...(payload.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId && entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;
    for (const payload of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(payload.errors).toEqual([]);
      expect(valueFor(payload, pointEntry.occurrence)).toEqual({ kind: "point", x: 4, y: -2 });
      expect(valueFor(payload, pointEntry.occurrence)).not.toHaveProperty("elementId");
      expect(valueFor(payload, openEntry.occurrence)).toMatchObject({ kind: "offsetLine", closed: false, start: { x: 0, y: -2 }, end: { x: 12, y: 10 } });
      expect(valueFor(payload, closedEntry.occurrence)).toMatchObject({ kind: "offsetLine", closed: true });
      expect(valueFor(payload, closedEntry.occurrence)).not.toHaveProperty("name");
      expect(valueFor(payload, invalidEntry.occurrence)).toBeUndefined();
      expect(payload.geometryValueErrors).toEqual([{
        occurrence: invalidEntry.occurrence,
        message: "geometry value の sources は前の線.end から次の線.start へ連続していません。reverse を使うか順序を見直してください。"
      }]);
      expect(payload.geometryValueErrors?.every((error) => !("elementId" in error))).toBe(true);
    }
  }, 30000);

  it("matches root collection length evaluation across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const numbers: number[] = [1, 1, 2]",
      "const count: number = @numbers.length"
    ].join("\n"));
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "count"), 3);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "count"), 3);
  }, 30000);

  it("matches scalar and choice value-if evaluation while skipping the unselected branch", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const flag: boolean = true",
      "const amount: number = if (@flag) { 10 } else { 1 / 0 }",
      "const side: choice(left, right) = if (@flag) { left } else { right }"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "amount"), 10);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "amount"), 10);
    expect(scalarBindingFor(fixture, tsPayload, "side")).toMatchObject({
      status: "ok",
      value: { kind: "choice", value: "left", options: ["left", "right"] }
    });
    expect(scalarBindingFor(fixture, rustPayload, "side")).toMatchObject({
      status: "ok",
      value: { kind: "choice", value: "left", options: ["left", "right"] }
    });
  }, 30000);

  it("matches geometry value if and exhaustive match while skipping unselected runtime failures", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const side: choice(left, right) = right",
      "const SelectedPoint: point = if (true) { coordinate(x: 1, y: 2) } else { between(start: @A, end: @B, ratio: 1 / 0) }",
      "const SelectedPath: path = match @side { left => arc(center: @A, radius: 0, start: 0, end: 90, direction: counterclockwise) right => segment(start: @A, end: @B) }"
    ].join("\n"));
    const program = fixture.compiled?.doc.geometryValueProgram;
    if (!program || program.length !== 2) throw new Error("expected two dynamic geometry value program entries");
    const pointEntry = program.find((entry) => entry.sourceStatementIndex === 5);
    const pathEntry = program.find((entry) => entry.sourceStatementIndex === 6);
    if (!pointEntry || !pathEntry) throw new Error("expected point and path dynamic entries");
    const options = optionsFor(fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const valueFor = (
      payload: ReturnType<typeof evaluationPayloadToResult>,
      occurrence: typeof pointEntry.occurrence
    ) => [...(payload.computedGeometryValues?.values() ?? [])]
      .find((entry) => entry.occurrence.sourceStatementId === occurrence.sourceStatementId &&
        entry.occurrence.instancePath.join("\0") === occurrence.instancePath.join("\0"))?.value;
    for (const payload of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(payload.errors).toEqual([]);
      expect(payload.geometryValueErrors).toEqual([]);
      expect(valueFor(payload, pointEntry.occurrence)).toEqual({ kind: "point", x: 1, y: 2 });
      expect(valueFor(payload, pathEntry.occurrence)).toMatchObject({
        kind: "line",
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      });
    }
  }, 30000);

  it("matches Module collection length evaluation across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const values: number[] = [1, 2, 2]",
      "module M(items: number[]) {",
      "  const localLength: number = @items.length",
      "  export const output: number[] = @items",
      "}",
      "instance Use = M(items: @values)",
      "const exportLength: number = @Use::output.length"
    ].join("\n"));
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const name of ["localLength", "exportLength"]) {
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), 3);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), 3);
    }
  }, 30000);

  it("matches repeated Module conditional collection selectors across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const first: number[] = [2]",
      "const second: number[] = [0]",
      "module M(items: number[]) {",
      "  export const selected: number[] = if (@items[0] > 0) { [10] } else { [20, 30] }",
      "  export const count: number = @selected.length",
      "}",
      "instance A = M(items: @first)",
      "instance B = M(items: @second)",
      "const aItem: number = @A::selected[0]",
      "const aCount: number = @A::count",
      "const bItem: number = @B::selected[1]",
      "const bCount: number = @B::count"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const [name, expected] of [["aItem", 10], ["aCount", 1], ["bItem", 30], ["bCount", 2]] as const) {
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), expected);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), expected);
    }
  }, 30000);

  it("matches conditional geometry collection length and consumers across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 3, y: 4)",
      "const n: number = 1",
      "const selected: point[] = if (@n > 0) { [@B, @A] } else { [@A] }",
      "const count: number = @selected.length",
      "line Use = segment(start: @selected[0], end: @selected[0])",
      "line Outline = polyline(points: @selected, closed: false)"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "count"), 2);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "count"), 2);
    const selected = fixture.elements.find((element) => element.name === "Use")!;
    const outline = fixture.elements.find((element) => element.name === "Outline")!;
    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(selected.id)).toMatchObject({
        kind: "line",
        start: { x: 3, y: 4 },
        end: { x: 3, y: 4 }
      });
      expect(result.computedGeometry.get(outline.id)).toMatchObject({
        kind: "polyline",
        segments: [{ start: { x: 3, y: 4 }, end: { x: 1, y: 2 } }]
      });
    }
  }, 30000);

  it("matches conditional scalar collection length and indexing across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const trueFlag: boolean = true",
      "const falseFlag: boolean = false",
      "const left: number[] = [1]",
      "const right: number[] = [2, 3]",
      "const selectedTrue: number[] = if (@trueFlag) { @left } else { @right }",
      "const selectedFalse: number[] = if (@falseFlag) { @left } else { @right }",
      "const trueCount: number = @selectedTrue.length",
      "const trueItem: number = @selectedTrue[0]",
      "const falseCount: number = @selectedFalse.length",
      "const falseItem: number = @selectedFalse[1]"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const [name, expected] of [["trueCount", 1], ["trueItem", 1], ["falseCount", 2], ["falseItem", 3]] as const) {
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), expected);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), expected);
    }
  }, 30000);

  it("matches nominal-record collection value-for field projections across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Pair(",
      "  x: number,",
      "  label: string,",
      ")",
      "const first: Pair = Pair(x: 1, label: \"one\")",
      "const second: Pair = Pair(x: 2, label: \"two\")",
      "const pairs: Pair[] = [@first, @second]",
      "const mapped: Pair[] = for item in @pairs { Pair(x: @item.x + 10, label: @item.label) }",
      "const selected: Pair = @mapped[1]",
      "const selectedX: number = @selected.x",
      "const selectedLabel: string = @selected.label"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "selectedX"), 12);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "selectedX"), 12);
    for (const payload of [tsPayload, rustPayload]) {
      const selectedLabel = scalarBindingFor(fixture, payload, "selectedLabel");
      expect(selectedLabel?.status).toBe("ok");
      if (selectedLabel?.status === "ok") expect(selectedLabel.value).toEqual({ kind: "string", value: "two" });
    }
  }, 30000);

  it("matches lazy unrequested mapped record field failures across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const source: Pair = Pair(x: 2, label: "source")',
      'const labels: string[] = ["valid"]',
      "const pairs: Pair[] = [@source]",
      "const mapped: Pair[] = for item in @pairs { Pair(x: @item.x + 10, label: @labels[99]) }",
      "const selected: Pair = @mapped[0]",
      "const selectedX: number = @selected.x"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "selectedX"), 12);
    }
  }, 30000);

  it("matches lazy unused source record binder field failures across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Pair(x: number, label: string)",
      'const labels: string[] = ["valid"]',
      "const source: Pair = Pair(x: 7, label: @labels[99])",
      "const pairs: Pair[] = [@source]",
      "let offset: number = 0",
      "set offset = 1",
      'const mapped: Pair[] = for item in @pairs { Pair(x: @item.x + @offset, label: "mapped") }',
      "const selected: Pair = @mapped[0]",
      "const selectedX: number = @selected.x"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expect(evaluationPayloadToResult(payload).errors).toEqual([]);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "selectedX"), 8);
    }
  }, 30000);

  it("matches collection selector source-order capabilities across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const base: number[] = [2]",
      "const selectedByIndex: number[] = if (@base[0] > 0) { [10] } else { [20, 30] }",
      "const indexItem: number = @selectedByIndex[0]",
      "const selectedByLength: number[] = if (@base.length > 0) { [11] } else { [21, 31] }",
      "const lengthCount: number = @selectedByLength.length",
      "const lengthItem: number = @selectedByLength[0]",
      "const choices: choice(left, right)[] = [left]",
      "const selectedByMatch: number[] = match @choices[0] { left => [12] right => [22, 32] }",
      "const matchItem: number = @selectedByMatch[0]",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "const selectedByProperty: point[] = if (@AB.length > 0) { [@A, @B] } else { [@A] }",
      "const propertyCount: number = @selectedByProperty.length",
      "line PropertyUse = segment(start: @selectedByProperty[0], end: @selectedByProperty[1])",
      "const selectedByBuiltin: point[] = if (distance(@A, @B) > 0) { [@A, @B] } else { [@A] }",
      "const builtinCount: number = @selectedByBuiltin.length",
      "line BuiltinUse = segment(start: @selectedByBuiltin[0], end: @selectedByBuiltin[1])"
    ].join("\n"));
    const options = optionsFor(fixture);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const name of ["indexItem", "lengthItem", "matchItem"] as const) {
      const expected = name === "indexItem" ? 10 : name === "lengthItem" ? 11 : 12;
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), expected);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), expected);
    }
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "lengthCount"), 1);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "lengthCount"), 1);
    for (const name of ["propertyCount", "builtinCount"] as const) {
      expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, name), 2);
      expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, name), 2);
    }
    const propertyUse = fixture.elements.find((element) => element.name === "PropertyUse")!;
    const builtinUse = fixture.elements.find((element) => element.name === "BuiltinUse")!;
    for (const result of [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)]) {
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(propertyUse.id)).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
      expect(result.computedGeometry.get(builtinUse.id)).toMatchObject({ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    }
  }, 30000);

  it("matches typed dynamic geometry collection indexing across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const index: number = 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 3, y: 4)",
      "const points: point[] = [@A, @B]",
      "line Selected = segment(start: @points[@index], end: @points[@index - 1])"
    ].join("\n"));
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const selected = fixture.elements.find((element) => element.name === "Selected")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(ts.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    for (const result of [ts, rust]) {
      expect(result.computedGeometry.get(selected.id)).toMatchObject({
        kind: "line",
        start: { x: 3, y: 4 },
        end: { x: 1, y: 2 }
      });
    }
  }, 30000);

  it("matches invalid dynamic geometry collection indexes across TypeScript and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const badIndex: number = -1",
      "point A = coordinate(x: 1, y: 2)",
      "const points: point[] = [@A]",
      "line Invalid = segment(start: @points[@badIndex], end: @A)"
    ].join("\n"));
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustOptions(repoRoot, fixture.elements, options);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const invalid = fixture.elements.find((element) => element.name === "Invalid")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const result of [ts, rust]) {
      expect(result.computedGeometry.get(invalid.id)).toBeUndefined();
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("evaluation-collection-index-invalid") })
      ]));
    }
  }, 30000);

  it.each(fixtureNames)("%s matches the TypeScript reference payload", (name: string) => {
    const fixture = readParityFixture(repoRoot, name);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    if (!isCurrentReleaseFixture(name)) return;
    expect(isRustEligibleFixture(fixture), `${name} must use the production Rust route`).toBe(true);
    expect(normalizeParityPayload(runtimeDiagnosticsFor(fixture, rustPayload))).toEqual(
      normalizeParityPayload(runtimeDiagnosticsFor(fixture, tsPayload))
    );
  }, 30000);

  it("uses the materialized runtime position for Module geometry-property reads", () => {
    const fixture = readParityFixture(repoRoot, "nui1-geometry-value-module-runtime-order.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const use = fixture.elements.find((element) => element.name === "Use")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(use.id)).toMatchObject({
        kind: "line",
        start: { x: 7, y: 42 },
        end: { x: 0, y: 42 }
      });
    }
  }, 30000);

  it("uses the discriminated geometry input target for immutable segment consumers", () => {
    const fixture = readParityFixture(repoRoot, "nui1-geometry-value-segment-consumer.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(ts.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    for (const result of [ts, rust]) {
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "Tangent")!.id)).toMatchObject({ kind: "point" });
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "Division")!.id)).toMatchObject({ kind: "point" });
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "Transform")!.id)).toMatchObject({ kind: "offsetLine" });
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "Mirror")!.id)).toMatchObject({ kind: "offsetLine" });
    }
  }, 30000);

  it("evaluates Label, Bare, and Boolean through the Rust-first declarations/templates fixture", () => {
    const fixture = readParityFixture(repoRoot, "nui1-declarations-templates.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const label = fixture.elements.find((element) => element.type === "text" && element.name === "Label")!;
    const bare = fixture.elements.find((element) => element.type === "text" && element.name === "Bare")!;
    const boolean = fixture.elements.find((element) => element.type === "text" && element.name === "Boolean")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const result of [ts, rust]) {
      expect(result.errors.filter((error) => [label.id, bare.id, boolean.id].includes(error.elementId))).toEqual([]);
      expect(result.computedGeometry.get(label.id)).toMatchObject({ kind: "text", text: "{draft} 前身頃 12.346\n" });
      expect(result.computedGeometry.get(bare.id)).toMatchObject({ kind: "text", text: "前身頃" });
      expect(result.computedGeometry.get(boolean.id)).toMatchObject({ kind: "text", text: "true false true true" });
    }
  }, 30000);

  it("evaluates reference-free boolean templates through the Rust production boundary", () => {
    const fixture = readParityFixture(repoRoot, "nui1-reference-free-boolean-template.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const booleanLiteral = fixture.elements.find((element) => element.type === "text" && element.name === "BooleanLiteral")!;
    const booleanCall = fixture.elements.find((element) => element.type === "text" && element.name === "BooleanCall")!;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const result of [ts, rust]) {
      expect(result.errors).toEqual([]);
      expect(result.computedGeometry.get(booleanLiteral.id)).toMatchObject({ kind: "text", text: "false" });
      expect(result.computedGeometry.get(booleanCall.id)).toMatchObject({ kind: "text", text: "true" });
    }
  }, 30000);

  it("keeps tangentOffset curveSide literal, choice binding, and pathReverse parity", () => {
    const fixture = readParityFixture(repoRoot, "nui1-tangent-offset-curve-side.nui");
    const options = optionsFor(fixture);
    const ts = evaluationPayloadToResult(evaluateElementsReferencePayload(fixture.elements, options));
    const rust = evaluationPayloadToResult(evaluateWithRustFixture(repoRoot, fixture));

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(ts.errors).toEqual([]);
    expect(rust.errors).toEqual([]);
    expect(rust.errors).toEqual(ts.errors);
    for (const name of ["Convex", "Concave", "Bound", "ReverseConvex"]) {
      const element = fixture.elements.find((candidate) => candidate.name === name)!;
      expect(ts.computedGeometry.get(element.id)).toMatchObject({ kind: "point" });
      const tsPoint = ts.computedGeometry.get(element.id);
      const rustPoint = rust.computedGeometry.get(element.id);
      expect(rustPoint).toMatchObject({ kind: "point" });
      if (tsPoint?.kind !== "point" || rustPoint?.kind !== "point") throw new Error("expected tangentOffset points");
      expect(rustPoint.x).toBeCloseTo(tsPoint.x, 10);
      expect(rustPoint.y).toBeCloseTo(tsPoint.y, 10);
    }
    const convex = fixture.elements.find((candidate) => candidate.name === "Convex")!;
    const concave = fixture.elements.find((candidate) => candidate.name === "Concave")!;
    const reverseConvex = fixture.elements.find((candidate) => candidate.name === "ReverseConvex")!;
    for (const [element, x, y] of [[convex, 5, 8.5], [concave, 5, 6.5], [reverseConvex, 5, 8.5]] as const) {
      const geometry = ts.computedGeometry.get(element.id);
      expect(geometry).toMatchObject({ kind: "point" });
      if (geometry?.kind !== "point") throw new Error("expected tangentOffset point");
      expect(geometry.x).toBeCloseTo(x, 10);
      expect(geometry.y).toBeCloseTo(y, 10);
    }

    for (const name of ["Split", "TrimCurve", "ExtendCurve"]) {
      const element = fixture.elements.find((candidate) => candidate.name === name)!;
      expect(ts.computedGeometry.get(element.id)).toMatchObject({ kind: "bezierCurve" });
      expect(rust.computedGeometry.get(element.id)).toMatchObject({ kind: "bezierCurve" });
    }
    for (const name of ["SplitOffset", "TrimOffset", "ExtendOffset"]) {
      const element = fixture.elements.find((candidate) => candidate.name === name)!;
      const tsPoint = ts.computedGeometry.get(element.id);
      const rustPoint = rust.computedGeometry.get(element.id);
      expect(tsPoint).toMatchObject({ kind: "point" });
      expect(rustPoint).toMatchObject({ kind: "point" });
      if (tsPoint?.kind !== "point" || rustPoint?.kind !== "point") throw new Error("expected tangentOffset point");
      expect(rustPoint.x).toBeCloseTo(tsPoint.x, 10);
      expect(rustPoint.y).toBeCloseTo(tsPoint.y, 10);
    }
  }, 30000);

  it("matches TS/Rust for selected Drawing Profile modifier deltas and disabled state", () => {
    const fixture = readParityFixture(repoRoot, "nui1-drawing-modifier-profiles.nui");
    const profile = fixture.compiled?.doc.document.drawingProfiles?.find((candidate) => candidate.name === "Print");
    if (!profile) throw new Error("Print Drawing Profile was not compiled");
    const options = optionsFor(fixture, profile.id);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture, profile.id);
    const ts = evaluationPayloadToResult(tsPayload);
    const rust = evaluationPayloadToResult(rustPayload);
    const styled = fixture.elements.find((element) => element.name === "Styled");
    const disabled = fixture.elements.find((element) => element.name === "Disabled");
    const dependent = fixture.elements.find((element) => element.name === "Dependent");

    expect(isRustEligibleFixture(fixture, profile.id)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(ts.effectiveDrawingModifierStrokes?.get(styled!.id)).toEqual({
      widthPx: 0.5,
      style: "dashed",
      color: { kind: "themeRole", role: "warning" }
    });
    expect(rust.effectiveDrawingModifierStrokes?.get(styled!.id)).toEqual(
      ts.effectiveDrawingModifierStrokes?.get(styled!.id)
    );
    expect(ts.effectiveVisibleElementIds).not.toContain(disabled!.id);
    expect(ts.effectiveEnabledElementIds).not.toContain(disabled!.id);
    expect(ts.computedGeometry.has(disabled!.id)).toBe(false);
    expect(ts.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ elementId: dependent!.id, missingDependencyId: disabled!.id })
    ]));
    expect(rust.effectiveVisibleElementIds).not.toContain(disabled!.id);
    expect(rust.effectiveEnabledElementIds).not.toContain(disabled!.id);
    expect(rust.computedGeometry.has(disabled!.id)).toBe(false);
  }, 30000);

  it("asserts nui1 builtin scalar values and runtime errors in both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "absValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "minValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 10 } });
      expect(scalarBindingFor(fixture, payload, "maxValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 20 } });
      expect(scalarBindingFor(fixture, payload, "sqrtValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "roundPositive")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "roundNegative")).toMatchObject({ status: "ok", value: { kind: "number", value: -2 } });
      expect(scalarBindingFor(fixture, payload, "roundDecimal")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.35 } });
      expect(scalarBindingFor(fixture, payload, "roundDecimalCoefficientBoundary")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 9484088218495944 }
      });
      expect(scalarBindingFor(fixture, payload, "roundCoarse")).toMatchObject({ status: "ok", value: { kind: "number", value: 1200 } });
      expect(scalarBindingFor(fixture, payload, "floorDecimal")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.34 } });
      expect(scalarBindingFor(fixture, payload, "floorCoarse")).toMatchObject({ status: "ok", value: { kind: "number", value: 1200 } });
      expect(scalarBindingFor(fixture, payload, "ceilDecimal")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.35 } });
      expect(scalarBindingFor(fixture, payload, "ceilCoarse")).toMatchObject({ status: "ok", value: { kind: "number", value: 1300 } });
      expect(scalarBindingFor(fixture, payload, "roundToValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 12.5 } });
      expect(scalarBindingFor(fixture, payload, "roundToNonFiniteResult")).toMatchObject({
        status: "error",
        issueCode: "evaluation-non-finite-result"
      });
      expect(scalarBindingFor(fixture, payload, "closeValue")).toMatchObject({ status: "ok", value: { kind: "boolean", value: true } });
      expect(scalarBindingFor(fixture, payload, "nestedValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
      expect(scalarBindingFor(fixture, payload, "referenceArgument")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "geometryArgument")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "sqrtInvalid")).toMatchObject({
        status: "error",
        issueCode: "evaluation-sqrt-negative-input"
      });
      expect(scalarBindingFor(fixture, payload, "roundToInvalid")).toMatchObject({
        status: "error",
        issueCode: "evaluation-round-to-non-positive-step"
      });
      expect(scalarBindingFor(fixture, payload, "closeInvalid")).toMatchObject({
        status: "error",
        issueCode: "evaluation-is-close-negative-tolerance"
      });
      const offset = fixture.elements.find((element) => element.name === "BuiltinOffset")!;
      const template = fixture.elements.find((element) => element.name === "BuiltinTemplate")!;
      const evaluated = evaluationPayloadToResult(payload);
      expect(evaluated.errors.filter((error) => error.elementId === offset.id || error.elementId === template.id)).toEqual([]);
      expect(evaluated.computedGeometry.get(offset.id)).toMatchObject({ kind: "offsetLine" });
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "丸め=10" });
    }
  }, 30000);

  it("asserts the canonical pi number literal through the Rust production boundary", () => {
    const fixture = readParityFixture(repoRoot, "nui1-builtin-constant-pi.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    const piBinding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "piValue");
    expect(fixture.compiled?.doc.scalarProgram?.statements.find((statement) => statement.bindingId === piBinding?.id)?.declaration.initializer).toMatchObject({
      kind: "numberLiteral",
      value: Math.PI
    });
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "piValue"), Math.PI);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "piScaled"), 2 * Math.PI);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "piRadius"), 6 * Math.PI);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "builtinPiWithUserBinding"), Math.PI);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "explicitUserPi"), 2);
      expect(scalarBindingFor(fixture, payload, "piComparison")).toMatchObject({
        status: "ok",
        value: { kind: "boolean", value: true }
      });
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "piMutable"), Math.PI);
      const evaluated = evaluationPayloadToResult(payload);
      const point = fixture.elements.find((element) => element.name === "PiPoint")!;
      const template = fixture.elements.find((element) => element.name === "PiTemplate")!;
      expect(evaluated.errors.filter((error) => error.elementId === point.id || error.elementId === template.id)).toEqual([]);
      expect(evaluated.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: Math.PI, y: 2 * Math.PI });
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "円周率=3.142" });
    }
  }, 30000);

  it("asserts public choice geometry properties through the Rust production boundary", () => {
    const fixture = readParityFixture(repoRoot, "nui1-choice-geometry-properties.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "direction")).toEqual({
        status: "ok",
        type: { kind: "choice", options: ["counterclockwise", "clockwise"] },
        value: { kind: "choice", options: ["counterclockwise", "clockwise"], value: "clockwise" }
      });
      expect(scalarBindingFor(fixture, payload, "isClockwise")).toMatchObject({
        status: "ok",
        value: { kind: "boolean", value: true }
      });
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts current intermediate Bezier handle properties through the Rust production boundary", () => {
    const fixture = readParityFixture(repoRoot, "nui1-bezier-intermediate-handle-properties.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "incomingAngle"), 225);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "incomingLength"), 3);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "outgoingAngle"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "outgoingLength"), 4);
    }
  }, 30000);

  it("asserts nui1 trigonometric scalar, geometry, module, and text values in both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-trigonometric-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      for (const [name, expected] of [
        ["sin30", 0.5], ["cos60", 0.5], ["tan45", 1],
        ["asinHalf", 30], ["acosHalf", 60], ["atanOne", 45],
        ["atan2Right", 0], ["atan2Up", 90], ["atan2Left", 180], ["atan2Down", 270],
        ["atan2Diagonal", 45], ["atan2Zero", 0], ["nestedTrig", 30], ["referenceTrig", -1]
      ] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
      for (const name of ["tanInvalid90", "tanInvalid270", "tanInvalidNegative90"] as const) {
        expect(scalarBindingFor(fixture, payload, name)).toMatchObject({
          status: "error",
          issueCode: "evaluation-tan-odd-multiple-of-90"
        });
      }
      for (const name of ["asinInvalidLow", "asinInvalidHigh"] as const) {
        expect(scalarBindingFor(fixture, payload, name)).toMatchObject({ status: "error", issueCode: "evaluation-asin-out-of-range" });
      }
      for (const name of ["acosInvalidLow", "acosInvalidHigh"] as const) {
        expect(scalarBindingFor(fixture, payload, name)).toMatchObject({ status: "error", issueCode: "evaluation-acos-out-of-range" });
      }

      const evaluated = evaluationPayloadToResult(payload);
      const origin = fixture.elements.find((element) => element.name === "Origin")!;
      const offset = fixture.elements.find((element) => element.name === "TrigOffset")!;
      const template = fixture.elements.find((element) => element.name === "TrigTemplate")!;
      const modulePoint = fixture.elements.find((element) => element.name === "ModulePoint")!;
      expect(evaluated.computedGeometry.get(origin.id)).toMatchObject({ kind: "point" });
      const originGeometry = evaluated.computedGeometry.get(origin.id);
      if (originGeometry?.kind !== "point") throw new Error("Origin must be a computed point");
      expect(originGeometry.x).toBeCloseTo(0.5, 10);
      expect(originGeometry.y).toBeCloseTo(0.5, 10);
      expect(evaluated.errors.filter((error) => error.elementId === offset.id)).toEqual([]);
      expect(evaluated.computedGeometry.get(offset.id)).toMatchObject({ kind: "offsetLine" });
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "sin30=0.5" });
      const moduleGeometry = evaluated.computedGeometry.get(modulePoint.id);
      expect(moduleGeometry).toMatchObject({ kind: "point", y: 0 });
      if (moduleGeometry?.kind !== "point") throw new Error("ModulePoint must be a computed point");
      expect(moduleGeometry.x).toBeCloseTo(0.5, 10);

    }
  }, 30000);

  it("asserts nui1 spreadAngle named arguments, domains, module, and text values in both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-spread-angle.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const expected = 11.4783409545;

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      for (const name of ["spreadBasic", "spreadReversed", "spreadReferences", "mutableSpread"] as const) {
        expectScalarNumberClose(scalarBindingFor(fixture, payload, name), expected);
      }
      expect(scalarBindingFor(fixture, payload, "spreadZero")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
      expect(scalarBindingFor(fixture, payload, "spreadStraight")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
      for (const name of [
        "spreadInvalidLengthZero",
        "spreadInvalidLengthNegative",
        "spreadInvalidNegative",
        "spreadInvalidTooLarge"
      ] as const) {
        expect(scalarBindingFor(fixture, payload, name)).toMatchObject({
          status: "error",
          issueCode: "evaluation-invalid-builtin-argument"
        });
      }

      const evaluated = evaluationPayloadToResult(payload);
      const origin = fixture.elements.find((element) => element.name === "Origin")!;
      const template = fixture.elements.find((element) => element.name === "SpreadTemplate")!;
      const modulePoint = fixture.elements.find((element) => element.name === "ModulePoint")!;
      const originGeometry = evaluated.computedGeometry.get(origin.id);
      if (originGeometry?.kind !== "point") throw new Error("Origin must be a computed point");
      expect(originGeometry.x).toBeCloseTo(expected, 10);
      expect(evaluated.computedGeometry.get(template.id)).toMatchObject({ kind: "text", text: "angle=11.478" });
      const moduleGeometry = evaluated.computedGeometry.get(modulePoint.id);
      if (moduleGeometry?.kind !== "point") throw new Error("ModulePoint must be a computed point");
      expect(moduleGeometry.x).toBeCloseTo(expected, 10);

    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts nui1 geometry builtin values and mutation through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-geometry-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);

    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "distanceFive")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 5 }
      });
      expect(scalarBindingFor(fixture, payload, "distanceZero")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 0 }
      });
      expect(scalarBindingFor(fixture, payload, "distanceTen")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 10 }
      });
      expect(scalarBindingFor(fixture, payload, "disabledDistance")).toMatchObject({
        status: "error",
        issueCode: "evaluation-geometry-builtin-disabled"
      });
      expect(scalarBindingFor(fixture, payload, "derivedDistance")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 7 }
      });
      expect(scalarBindingFor(fixture, payload, "derivedAngle")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 135 }
      });
      expect(scalarBindingFor(fixture, payload, "derivedLineDistance")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 0 }
      });
      expect(scalarBindingFor(fixture, payload, "angleRight")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
      expect(scalarBindingFor(fixture, payload, "angleUp")).toMatchObject({ status: "ok", value: { kind: "number", value: 90 } });
      expect(scalarBindingFor(fixture, payload, "angleLeft")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
      expect(scalarBindingFor(fixture, payload, "angleDown")).toMatchObject({ status: "ok", value: { kind: "number", value: 270 } });
      expect(scalarBindingFor(fixture, payload, "angleDiagonal")).toMatchObject({ status: "ok", value: { kind: "number", value: 45 } });
      expect(scalarBindingFor(fixture, payload, "angleSame")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
      expect(scalarBindingFor(fixture, payload, "lineDistanceHorizontal")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 3 }
      });
      expect(scalarBindingFor(fixture, payload, "lineDistanceVertical")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 5 }
      });
      const diagonal = scalarBindingFor(fixture, payload, "lineDistanceDiagonal");
      expect(diagonal?.status).toBe("ok");
      if (diagonal?.status !== "ok" || diagonal.value.kind !== "number") {
        throw new Error("lineDistanceDiagonal must be a numeric success");
      }
      expect(diagonal.value.value).toBeCloseTo(Math.SQRT2, 12);
      expect(scalarBindingFor(fixture, payload, "lineDistanceOnLine")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 0 }
      });
      expect(scalarBindingFor(fixture, payload, "lineDistanceZero")).toMatchObject({
        status: "error",
        issueCode: "evaluation-zero-length-line"
      });
      expect(scalarBindingFor(fixture, payload, "mutationValue")).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 5 }
      });
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "evaluation-geometry-builtin-disabled",
          message: "「Disabled」は評価OFFのためgeometry引数として利用できません。評価ONにするか、参照先を変更してください。",
          origin: "runtime"
        })
      ]));
    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts lineAngle semantics and errors through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-line-angle.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "parallel"), 0);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "diagonal45"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "perpendicular"), 90);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "reversedParallel"), 0);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "directed135"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "spatiallySeparated"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "reverseFirst"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "reverseSecond"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "swapped"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "polarAngle"), 45);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "setValue"), 90);
      expect(scalarBindingFor(fixture, payload, "zeroFirst")).toMatchObject({
        status: "error",
        issueCode: "evaluation-zero-length-line"
      });
      expect(scalarBindingFor(fixture, payload, "zeroSecond")).toMatchObject({
        status: "error",
        issueCode: "evaluation-zero-length-line"
      });
    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts module geometry builtin lowering values and parity through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-module-geometry-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expect(scalarBindingFor(fixture, payload, "radius")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "direction")).toMatchObject({ status: "ok", value: { kind: "number", value: 45 } });
      expect(scalarBindingFor(fixture, payload, "height")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
      expect(scalarBindingFor(fixture, payload, "lineAngleValue")).toMatchObject({ status: "ok", value: { kind: "number", value: 90 } });
      expect(scalarBindingFor(fixture, payload, "localDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "childDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "childLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 4 } });
      expect(scalarBindingFor(fixture, payload, "parameterStartDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "parameterEndAngle")).toMatchObject({ status: "ok", value: { kind: "number", value: 180 } });
      expect(scalarBindingFor(fixture, payload, "localEndpointLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 2 } });
      expect(scalarBindingFor(fixture, payload, "measured")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "rootDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 5 } });
      expect(scalarBindingFor(fixture, payload, "rootLineDistance")).toMatchObject({ status: "ok", value: { kind: "number", value: 3 } });
      expect(scalarBindingFor(fixture, payload, "rootLineAngle")).toMatchObject({ status: "ok", value: { kind: "number", value: 0 } });
    }
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts the Module numeric geometry builtin through the Rust production boundary", () => {
    const fixture = readParityFixture(repoRoot, "nui1-module-numeric-geometry-builtin.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const tsResult = evaluationPayloadToResult(tsPayload);
    const rustResult = evaluationPayloadToResult(rustPayload);
    const modulePoint = fixture.elements.find((element) => element.name === "Q");

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(tsResult.errors).toEqual([]);
    expect(rustResult.errors).toEqual([]);
    expect(modulePoint).toBeDefined();
    expect(tsResult.computedGeometry.get(modulePoint!.id)).toMatchObject({ kind: "point", x: 7, y: 4 });
    expect(rustResult.computedGeometry.get(modulePoint!.id)).toMatchObject({ kind: "point", x: 7, y: 4 });
    expectScalarNumberClose(scalarBindingFor(fixture, tsPayload, "moduleCheck"), 0);
    expectScalarNumberClose(scalarBindingFor(fixture, rustPayload, "moduleCheck"), 0);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);

  it("asserts root set geometry builtin resolution with an unrelated module through both evaluators", () => {
    const fixture = readParityFixture(repoRoot, "nui1-module-root-set-geometry-builtin-functions.nui");
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    for (const payload of [tsPayload, rustPayload]) {
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "distanceValue"), 5);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "angleValue"), 90);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "lineDistanceValue"), 3);
      expectScalarNumberClose(scalarBindingFor(fixture, payload, "lineAngleValue"), 90);
    }

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
  }, 30000);
});
