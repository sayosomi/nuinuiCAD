import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import {
  evaluateWithRustFixture,
  fixtureFromSource,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";

describe("arithmetic operator numeric runtime Rust parity", () => {
  it("carries typed ^ / % ASTs through both numeric runtime payloads", () => {
    const fixture = fixtureFromSource([
      "nui 4",
      "point Pow = coordinate(x: 2 ^ 3, y: 0)",
      "point Remainder = coordinate(x: 5 % 3, y: 0)",
      "point PowChain = coordinate(x: 2 ^ 3 ^ 2, y: 0)",
      "point NegativePow = coordinate(x: -2 ^ 2, y: 0)",
      "point FractionalPow = coordinate(x: 2 ^ -2, y: 0)"
    ].join("\n"));
    const input = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    const numericBindings = input.scalarExpressionPayload?.numericBindings ?? [];
    expect(numericBindings).toHaveLength(5);
    expect(numericBindings.every((entry) => entry.typedExpression)).toBe(true);
    expect(numericBindings.some((entry) => JSON.stringify(entry.typedExpression).includes('"operator":"^"'))).toBe(true);
    expect(numericBindings.some((entry) => JSON.stringify(entry.typedExpression).includes('"operator":"%"'))).toBe(true);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
    const rustPayload = evaluateWithRustFixture(process.cwd(), fixture);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const tsResult = evaluationPayloadToResult(tsPayload);
    const values = new Map(fixture.elements.map((element) => [
      element.name,
      (tsResult.computedGeometry.get(element.id) as { x: number }).x
    ]));
    expect(values).toEqual(new Map([
      ["Pow", 8],
      ["Remainder", 2],
      ["PowChain", 512],
      ["NegativePow", -4],
      ["FractionalPow", 0.25]
    ]));
  }, 30_000);
});
