import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import type { EvaluationResult } from "../types/geometry";
import { buildNumericBindingRuntimeEntries } from "./numericBindingRuntime";
import { evaluateElements, type EvaluateElementsOptions } from "./evaluate";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

const optionsFor = (compiled: LastGoodDslDocument): EvaluateElementsOptions => ({
  scalarProgram: compiled.scalarProgram,
  bindingVersions: compiled.bindingVersions,
  statementInfoByElementId: compiled.statementMap.byElementId,
  statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
  numericBindingEntries: buildNumericBindingRuntimeEntries({
    numericBindings: compiled.numericBindings ?? new Map(),
    elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex
  }, compiled.document.elements)
});

const point = (compiled: LastGoodDslDocument, name: string) => {
  const element = compiled.document.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing ${name}`);
  return element;
};

const pointCoordinates = (compiled: LastGoodDslDocument, evaluation: EvaluationResult, name: string) => {
  const geometry = evaluation.computedGeometry.get(point(compiled, name).id);
  return geometry?.kind === "point" ? { x: geometry.x, y: geometry.y } : undefined;
};

describe("geometry measurement builtins through the production TS scalar path", () => {
  it("evaluates distance, angle, lineDistance, and lineAngle before downstream point construction", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "point U = coordinate(x: 0, y: 1)",
      "point Lend = coordinate(x: 1, y: 0)",
      "point P = coordinate(x: 10, y: 3)",
      "line L = segment(start: @A, end: @Lend)",
      "line V = segment(start: (0, 0), end: (0, 1))",
      "const distanceValue: number = distance(@A, @B)",
      "const angleValue: number = angle(@A, @U)",
      "const lineDistanceValue: number = lineDistance(@P, @L)",
      "const lineAngleValue: number = lineAngle(@L, @V)",
      "point DistanceResult = coordinate(x: @distanceValue, y: 0)",
      "point AngleResult = coordinate(x: @angleValue, y: 0)",
      "point LineDistanceResult = coordinate(x: @lineDistanceValue, y: 0)",
      "point LineAngleResult = coordinate(x: @lineAngleValue, y: 0)"
    ].join("\n"));

    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));

    expect(result.errors).toEqual([]);
    expect(pointCoordinates(compiled, result, "DistanceResult")).toEqual({ x: 5, y: 0 });
    expect(pointCoordinates(compiled, result, "AngleResult")).toEqual({ x: 90, y: 0 });
    expect(pointCoordinates(compiled, result, "LineDistanceResult")).toEqual({ x: 3, y: 0 });
    expect(pointCoordinates(compiled, result, "LineAngleResult")).toEqual({ x: 90, y: 0 });
  });

  it("keeps geometry builtin declarations working when linear mutation evaluation is selected", () => {
    const compiled = compile([
      "nui 1",
      "let unrelated: number = 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "const distanceValue: number = distance(@A, @B)",
      "set unrelated = 2",
      "point Result = coordinate(x: @distanceValue, y: 0)"
    ].join("\n"));

    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));

    expect(result.errors).toEqual([]);
    expect(pointCoordinates(compiled, result, "Result")).toEqual({ x: 5, y: 0 });
  });
});
