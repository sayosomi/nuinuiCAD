// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { fixtureFromSource, optionsFor, evaluateWithRustFixture, normalizeParityPayload } from "../../test/evaluationParitySupport";
import { evaluateElementsReferencePayload } from "./evaluationEngine";
import { evaluationPayloadToResult } from "./evaluationPayload";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { emptyDocument } from "@nuinuicad/nui-language";

const evaluateFixture = (fixture: ReturnType<typeof fixtureFromSource>) => {
  const tsPayload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
  const payload = import.meta.env.VITE_RUN_RUST_PARITY === "1"
    ? evaluateWithRustFixture(fileURLToPath(new URL("../../", import.meta.url)), fixture)
    : tsPayload;
  expect(normalizeParityPayload(payload)).toEqual(normalizeParityPayload(tsPayload));
  const result = evaluationPayloadToResult(payload);
  const geometry = (name: string) => result.computedGeometry.get(fixture.elements.find(element => element.name === name)!.id);
  return { fixture, result, geometry };
};
const evaluate = (source: string) => evaluateFixture(fixtureFromSource(source));

describe("geometry builtins in construction numeric arguments (#1534 / #1531)", () => {
  it("preserves explicit generated occurrence selection outside the frame", () => {
    const { result, geometry } = evaluate(`nui 1
for i in range(min: 0, max: 1, step: 1) {
  point A = coordinate(x: @i + 3, y: 4)
}
point Result = coordinate(x: distance(@A[0], @A[1]), y: angle(@A[0], @A[1]))`);
    expect(result.errors).toEqual([]);
    expect(geometry("Result")).toMatchObject({ kind: "point", x: 1, y: 0 });
  });
  it.each([false, true])("a base-stage measurement does not depend on the later final stage (direct=%s)", direct => {
    const { result, geometry } = evaluate(`nui 1
point P = coordinate(x: 0, y: 5)
line L = segment(start: (0, 0), end: (10, 0))
const measured: number = lineDistance(@P, @L.base)
point Result = coordinate(x: ${direct ? "lineDistance(@P, @L.base)" : "@measured"}, y: 0)
move L(from: (0, 0), to: (@Result.x, 0))`);
    expect(result.errors).toEqual([]);
    expect(geometry("Result")).toMatchObject({ kind: "point", x: 5, y: 0 });
    expect(geometry("L")).toMatchObject({ kind: "line", start: { x: 5, y: 0 } });
  });
  it("preserves generated endpoint identities in direct measurement calls", () => {
    const { result } = evaluate(`nui 1
for i in range(min: 0, max: 1, step: 1) {
  line L = segment(start: (0, 0), end: (10, 0))
  line V = segment(start: (0, 0), end: (0, 10))
  point Q = coordinate(x: distance(@L.start, @V.end) + @L.length, y: lineAngle(@L.start, @V.end))
}`);
    expect(result.errors).toEqual([]);
    const points = [...result.computedGeometry.values()].filter(g => g.kind === "point" && g.name.endsWith(" Q"));
    expect(points).toHaveLength(2);
    for (const point of points) expect(point).toMatchObject({ x: 20, y: 90 });
  });
  it("measures the correct generated points in nested for-group frames", () => {
    const { result } = evaluate(readFileSync(new URL("../../test/fixtures/evaluation/nui1-for-group-generated-point-measurement.nui", import.meta.url), "utf8"));
    expect(result.errors).toEqual([]);
    const points = [...result.computedGeometry.values()].filter(g => g.kind === "point" && g.name.endsWith(" Q"));
    expect(points).toHaveLength(4);
    for (const point of points) expect(point).toMatchObject({ x: 10, y: 0 });
  });
  it("reevaluates a distance-only consumer after an authored dependency changes", () => {
    const source = `nui 1
point Result = coordinate(x: distance(@A, @B), y: 0)
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 30, y: 40)`;
    const initial = evaluate(source);
    expect(initial.result.errors).toEqual([]);
    expect(initial.geometry("Result")).toMatchObject({ kind: "point", x: 50 });
    const compiled = compileCanonicalText(initial.fixture.compiled!, source.replace("y: 40", "y: 0"));
    expect(compiled.status).not.toBe("fatal");
    if (compiled.status === "fatal") throw new Error(JSON.stringify(compiled.diagnostics));
    const changed = evaluateFixture({ elements: compiled.doc.document.elements, compiled });
    expect(changed.result.errors).toEqual([]);
    expect(changed.geometry("Result")).toMatchObject({ kind: "point", x: 30 });
    expect(changed.fixture.elements.find(e => e.name === "Result")?.id).toBe(initial.fixture.elements.find(e => e.name === "Result")?.id);
  });
  it("covers inline coordinate components, Bezier handles and intermediate numbers", () => {
    const { result, geometry } = evaluate(`nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 30, y: 40)
line L = segment(start: (distance(@A, @B), angle(@A, @B)), end: @B)
curve C = bezier(start: @A, end: @B, startLength: distance(@A, @B) / 5, startAngle: angle(@A, @B), endLength: distance(@A, @B) / 10, endAngle: angle(@B, @A), intermediates: [@A:angle(@A, @B):distance(@A, @B) / 5:distance(@A, @B) / 10])`);
    expect(result.errors).toEqual([]);
    expect(geometry("L")).toMatchObject({ kind: "line", start: { x: 50 } });
    expect(geometry("C")).toMatchObject({ kind: "bezierCurve", startHandleLength: 10, endHandleLength: 5 });
  });
  it("preserves stage, derived point, and endpoint identities", () => {
    const { result, geometry } = evaluate(`nui 1
point Result = coordinate(x: distance(@L.base.start, @L.final.end), y: lineAngle(@L.base.start, @L.final.end))
line L = segment(start: (0, 0), end: (10, 0))
move L as rotated(from: (0, 0), to: (0, 0), angleDeg: 90)`);
    expect(result.errors).toEqual([]);
    expect(geometry("Result")).toMatchObject({ kind: "point", x: 10, y: 90 });
  });

  it("preserves module parameter and exported geometry identities", () => {
    const { result, geometry } = evaluate(`nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 30, y: 40)
module Measure(a: point, b: point) {
  export point Q = coordinate(x: distance(@a, @b), y: angle(@a, @b))
  export line Inline = segment(start: (distance(@a, @b), angle(@a, @b)), end: @b)
  export curve C = bezier(start: @a, end: @b, intermediates: [@a:angle(@a, @b):distance(@a, @b) / 5:10])
}
instance Use = Measure(a: @A, b: @B)
point Result = coordinate(x: distance(@A, @Use::Q), y: 0)
line RootInline = segment(start: (distance(@A, @Use::Q), 0), end: @A)
curve RootCurve = bezier(start: @A, end: @B, intermediates: [@A:angle(@A, @Use::Q):distance(@A, @Use::Q):10])`);
    expect(result.errors).toEqual([]);
    const point = geometry("Result");
    expect(point?.kind).toBe("point");
    if (point?.kind !== "point") throw new Error("expected point");
    expect(point.x).toBeCloseTo(Math.hypot(50, Math.atan2(40, 30) * 180 / Math.PI), 10);
    expect(geometry("RootInline")).toMatchObject({ kind: "line", start: { x: point.x, y: 0 } });
  });

  it.each([
    'distance(@A)',
    'distance(@A, @A, @A)',
    'distance(3, @A)',
    'distance(@L, @A)',
    'distance(@Missing, @A)',
    'lineAngle(@L, @L)',
    'lineDistance(@A, @A)',
    'distance(@A, )'
  ])("reports invalid operands and arity: %s", expression => {
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), `nui 1
point A = coordinate(x: 0, y: 0)
line L = segment(start: (0, 0), end: (10, 0))
point Result = coordinate(x: ${expression}, y: 0)`);
    expect(compiled.diagnostics.some(d => d.severity === "error")).toBe(true);
    expect(compiled.diagnostics.some(d => d.physicalSpan?.segments.length)).toBe(true);
  });

  it.each([
    'distance(@Disabled, @A)',
    'lineDistance(@A, @Zero)',
    'lineAngle(@Zero.start, @L.end)',
    'distance(@Broken, @A)'
  ])("does not replace unavailable or degenerate geometry with a number: %s", expression => {
    const { result, geometry } = evaluate(`nui 1
point A = coordinate(x: 0, y: 0)
point Disabled = coordinate(x: 3, y: 4, enabled: false)
point Broken = between(start: @A, end: @A, distance: 5)
line Zero = segment(start: @A, end: @A)
line L = segment(start: (0, 0), end: (10, 0))
point Result = coordinate(x: ${expression}, y: 0)`);
    expect(result.errors.some(error => error.elementName === "Result")).toBe(true);
    expect(geometry("Result")).toBeUndefined();
  });

  it("reports a geometry dependency cycle", () => {
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), `nui 1
point A = coordinate(x: distance(@B, @Origin), y: 0)
point B = coordinate(x: distance(@A, @Origin), y: 0)
point Origin = coordinate(x: 0, y: 0)`);
    expect(compiled.status).toBe("fatal");
    expect(compiled.diagnostics.some(d => /cycle/.test(d.code ?? ""))).toBe(true);
  });
  it.each([40, 80])("all four builtins without scalar declarations and dependency edits (height=%s)", height => {
    const { result, geometry } = evaluate(`nui 1
point Result = coordinate(x: distance(@A, @B) / 2 + lineDistance(@B, @L), y: angle(@A, @B) + lineAngle(@L.start, @V.end))
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 30, y: ${height})
line L = segment(start: (0, 0), end: (10, 0))
line V = segment(start: (0, 0), end: (0, 10))`);
    expect(result.errors).toEqual([]);
    const point = geometry("Result");
    expect(point?.kind).toBe("point");
    if (point?.kind !== "point") throw new Error("expected point");
    expect(point.x).toBeCloseTo(Math.hypot(30, height) / 2 + height, 10);
    expect(point.y).toBeCloseTo(Math.atan2(height, 30) * 180 / Math.PI + 90, 10);
  });
  it.each([false, true])("Bezier oracle and const equivalence (direct=%s)", direct => {
    const { result, geometry } = evaluate(`nui 1
point SP = coordinate(x: 0, y: 80)
point Guide = coordinate(x: 10, y: 40)
point DartEnd = coordinate(x: 20, y: 0)
const measuredAngle: number = angle(@DartEnd, @Guide)
curve Armhole = bezier(start: @SP, end: @DartEnd, startAngle: 270, startLength: 20, endAngle: ${direct ? "angle(@DartEnd, @Guide)" : "@measuredAngle"}, endLength: 10)
curve Oracle = bezier(start: @SP, end: @DartEnd, startAngle: 270, startLength: 20, endAngle: 104.03624346792648, endLength: 10)`);
    expect(result.errors).toEqual([]);
    const curve = geometry("Armhole");
    const oracle = geometry("Oracle");
    expect(curve?.kind).toBe("bezierCurve");
    if (curve?.kind !== "bezierCurve" || oracle?.kind !== "bezierCurve") throw new Error("expected curves");
    expect(curve.endHandleAngleDeg).toBeCloseTo(104.03624346792648, 10);
    expect(curve.segments).toEqual(oracle.segments);
    expect(curve.length).toBeCloseTo(oracle.length, 10);
  });

  it.each([false, true])("#1531 between distance and ratio oracle (direct=%s)", direct => {
    const { result, geometry } = evaluate(`nui 1
point Corner = coordinate(x: 0, y: 0)
point B = coordinate(x: 30, y: 40)
const measuredDistance: number = distance(@Corner, @B)
point P = between(start: @Corner, end: @B, distance: ${direct ? "distance(@Corner, @B)" : "@measuredDistance"} / 3 + 5)
point Ratio = between(start: @Corner, end: @B, ratio: 1 / 3 + 5 / ${direct ? "distance(@Corner, @B)" : "@measuredDistance"})`);
    expect(result.errors).toEqual([]);
    for (const name of ["P", "Ratio"]) {
      const point = geometry(name);
      expect(point?.kind).toBe("point");
      if (point?.kind !== "point") throw new Error("expected point");
      expect(point.x).toBeCloseTo(13, 10);
      expect(point.y).toBeCloseTo(52 / 3, 10);
    }
  });
});
