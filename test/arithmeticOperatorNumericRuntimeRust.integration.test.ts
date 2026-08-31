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
  it("retains an empty scalar program for ref-free typed module expressions", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "module Example() {",
      "  point P = coordinate(x: 2 ^ 3, y: 5 % 3)",
      "}",
      "instance A = Example()"
    ].join("\n"));
    const compiled = fixture.compiled?.doc;
    expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled?.scalarProgram).toBeDefined();
    expect(compiled?.scalarProgram?.statements).toHaveLength(0);

    const input = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    const numericBindings = input.scalarExpressionPayload?.numericBindings ?? [];
    expect(numericBindings).toHaveLength(2);
    expect(numericBindings.every((entry) => entry.typedExpression)).toBe(true);
    expect(input.bindingVersions).toBeDefined();
    expect(input.bindingVersions?.versions).toHaveLength(0);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
    const rustPayload = evaluateWithRustFixture(process.cwd(), fixture);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const tsResult = evaluationPayloadToResult(tsPayload);
    const p = fixture.elements.find((element) => element.name === "P");
    expect(p).toBeDefined();
    expect(tsResult.computedGeometry.get(p!.id)).toMatchObject({ kind: "point", x: 8, y: 2 });
  }, 30_000);

  it("carries typed ^ / % ASTs through both numeric runtime payloads", () => {
    const fixture = fixtureFromSource([
      "nui 1",
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
