import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { optionsFor } from "./evaluationParitySupport";

const purePolarAngleSource = `nui 1

module Repro(base: point) {
  const tip: point = coordinate(x: 10, y: 0)

  const tip_reverse: point = polar(
    from: @base,
    angle: angle(@tip, @base),
    distance: 3,
  )
}

point A = coordinate(x: 0, y: 0)
instance test = Repro(base: @A)
`;

const compileSource = (source: string) =>
  compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);

const errorDiagnostics = (source: string) =>
  compileSource(source).diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const evaluateValidSource = (source: string) => {
  const compiled = compileSource(source);
  const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  expect(errors.map((diagnostic) => diagnostic.code), JSON.stringify(errors)).toEqual([]);
  if (compiled.status === "fatal") throw new Error(`Expected valid source, got ${JSON.stringify(compiled.diagnostics)}`);
  const fixture = {
    elements: compiled.doc.document.elements,
    evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex,
    compiled
  };
  const payload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
  const result = evaluationPayloadToResult(payload);
  expect(result.errors).toEqual([]);
  expect(result.geometryValueErrors).toEqual([]);
  return { fixture, result };
};

const expectElementPoint = (
  fixture: ReturnType<typeof evaluateValidSource>["fixture"],
  result: ReturnType<typeof evaluateValidSource>["result"],
  name: string,
  x: number,
  y: number
) => {
  const element = fixture.elements.find((candidate) => candidate.name === name);
  expect(element, `missing drawable point ${name}`).toBeDefined();
  if (!element) return;
  expect(result.computedGeometry.get(element.id)).toMatchObject({
    kind: "point",
    x: expect.closeTo(x, 8),
    y: expect.closeTo(y, 8)
  });
};

const expectPurePointValue = (
  result: ReturnType<typeof evaluateValidSource>["result"],
  x: number,
  y: number
) => {
  const values = [...result.computedGeometryValues.values()].map((entry) => entry.value);
  expect(values).toContainEqual(expect.objectContaining({
    kind: "point",
    x: expect.closeTo(x, 8),
    y: expect.closeTo(y, 8)
  }));
};

describe("Issue #1663 Module pure construction geometry builtins", () => {
  it("accepts the exact pure polar r2 compilation", () => {
    const errors = compileSource(purePolarAngleSource).diagnostics.filter((diagnostic) => diagnostic.severity === "error");

    expect(errors.map((diagnostic) => diagnostic.code), JSON.stringify(errors)).toEqual([]);
  });

  it("accepts geometry builtin operands in the exact pure polar reproduction and evaluates (-3, 0)", () => {
    const { fixture, result } = evaluateValidSource(purePolarAngleSource.replace(
      "  )\n}\n\npoint A",
      "  )\n  export const reverseX: number = @tip_reverse.x\n  export const reverseY: number = @tip_reverse.y\n}\n\npoint A"
    ).replace(
      "instance test = Repro(base: @A)",
      "instance test = Repro(base: @A)\npoint Observed = coordinate(x: @test::reverseX, y: @test::reverseY)"
    ));

    expectPurePointValue(result, -3, 0);
    expect(fixture.elements.some((element) => element.name === "tip_reverse")).toBe(false);
    expectElementPoint(fixture, result, "Observed", -3, 0);
  });

  it("keeps the r1 scalar angle expression valid and evaluable", () => {
    const { fixture, result } = evaluateValidSource(`nui 1
module Repro(base: point) {
  const tip: point = coordinate(x: 10, y: 0)
  const direction: number = angle(@tip, @base)
  export const directionOutput: number = @direction
}
point A = coordinate(x: 0, y: 0)
instance test = Repro(base: @A)
point Observed = coordinate(x: @test::directionOutput, y: 0)
`);

    expectElementPoint(fixture, result, "Observed", 180, 0);
  });

  it("keeps the r3 drawable polar construction valid", () => {
    const { fixture, result } = evaluateValidSource(`nui 1
module Repro(base: point) {
  const tip: point = coordinate(x: 10, y: 0)
  point tip_reverse = polar(from: @base, angle: angle(@tip, @base), distance: 3)
}
point A = coordinate(x: 0, y: 0)
instance test = Repro(base: @A)
`);

    expect(fixture.elements.some((element) => element.name === "tip_reverse")).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("resolves distance() in a pure coordinate numeric argument", () => {
    const compiled = compileSource(`nui 1
module Repro(base: point) {
  const tip: point = coordinate(x: 10, y: 0)
  const measured: point = coordinate(x: distance(@tip, @base) + 1, y: 4)
}
point A = coordinate(x: 0, y: 0)
instance test = Repro(base: @A)
`);
    const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

    expect(errors.map((diagnostic) => diagnostic.code), JSON.stringify(errors)).toEqual([]);
    expect(compiled.doc.document.elements.some((element) => element.name === "measured")).toBe(false);
  });

  it("resolves geometry builtins in a pure geometry value-expression construction", () => {
    const { fixture, result } = evaluateValidSource(`nui 1
module Repro(base: point) {
  const tip: point = coordinate(x: 10, y: 0)
  const selected: point = if (true) {
    polar(from: @base, angle: angle(@tip, @base), distance: 3)
  } else {
    coordinate(x: 99, y: 99)
  }
  export const selectedX: number = @selected.x
  export const selectedY: number = @selected.y
}
point A = coordinate(x: 0, y: 0)
instance test = Repro(base: @A)
point Observed = coordinate(x: @test::selectedX, y: @test::selectedY)
`);

    expectPurePointValue(result, -3, 0);
    expect(fixture.elements.some((element) => element.name === "selected")).toBe(false);
    expectElementPoint(fixture, result, "Observed", -3, 0);
  });

  it("resolves geometry builtins in an applicable next carry construction", () => {
    evaluateValidSource(`nui 1
module Repro(base: point) {
  const tip: point = coordinate(x: 10, y: 0)
  const empty: number[] = []
  for n in @empty carry cursor: point = @base {
    next cursor = if (true) { polar(from: @cursor, angle: angle(@tip, @base), distance: 3) } else { @base }
  }
}
point A = coordinate(x: 0, y: 0)
instance test = Repro(base: @A)
`);
  });

  it("continues rejecting a geometry parameter used as a scalar reference", () => {
    const errors = errorDiagnostics(`nui 1
module Repro(base: point) {
  const invalid: number = @base
}
point A = coordinate(x: 0, y: 0)
instance test = Repro(base: @A)
`);

    expect(errors.map((diagnostic) => diagnostic.code)).toContain("module-scalar-geometry-reference");
  });

  it("continues rejecting unresolved geometry builtin operands", () => {
    const errors = errorDiagnostics(`nui 1
module Repro(base: point) {
  const tip: point = coordinate(x: 10, y: 0)
  const invalid: point = polar(from: @base, angle: angle(@tip, @missing), distance: 3)
}
point A = coordinate(x: 0, y: 0)
instance test = Repro(base: @A)
`);

    expect(errors.map((diagnostic) => diagnostic.code)).toContain("module-undefined-geometry-reference");
  });

  it("continues rejecting wrong-type geometry builtin operands", () => {
    const errors = errorDiagnostics(`nui 1
module Repro(base: point, rail: line) {
  const tip: point = coordinate(x: 10, y: 0)
  const invalid: point = polar(from: @base, angle: angle(@tip, @rail), distance: 3)
}
point A = coordinate(x: 0, y: 0)
line Rail = segment(start: (0, 0), end: (1, 0))
instance test = Repro(base: @A, rail: @Rail)
`);

    expect(errors.map((diagnostic) => diagnostic.code)).toContain("module-geometry-type-mismatch");
  });
});
