import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import { forGroupGeneratedElementId } from "../src/geometry/forGroupExpansion";
import { propertyBindingOccurrenceKey } from "../src/scalars/propertyBindingCompiler";
import {
  evaluateWithRustFixture,
  fixtureFromSource,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";

describe("SAY-128 record scalar mixed numeric fallback parity", () => {
  it("materializes record fields before the legacy forGroup iteration runtime in TS and Rust", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "record Config(amount: number)",
      "const config: Config = Config(amount: 12)",
      "const offset: number = 2",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  point P = coordinate(x: @config.amount + @offset + @i, y: 0)",
      "}"
    ].join("\n"));
    const compiled = fixture.compiled!.doc;
    expect(fixture.compiled!.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const pointStatementIndex = compiled.statements.findIndex((statement) => statement.name === "P");
    const numeric = compiled.numericBindings?.get(propertyBindingOccurrenceKey(pointStatementIndex, "x"));
    const amount = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "config.amount")!;
    const offset = compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.name === "offset")!;

    expect(numeric?.typedExpression).toBeUndefined();
    expect(numeric?.references.map((reference) => [reference.name, reference.bindingId])).toEqual([
      ["config.amount", amount.id],
      ["offset", offset.id]
    ]);
    expect(numeric?.references[0].physicalNameSpan).toBeNull();
    expect(numeric?.references[1].physicalNameSpan).not.toBeNull();

    const input = buildRustEvaluationInput(fixture.elements, optionsFor(fixture));
    const payloadBinding = input.scalarExpressionPayload?.numericBindings.find((entry) =>
      entry.parameterKey === "x" && entry.references.some((reference) => reference.name === "config.amount")
    );
    expect(payloadBinding?.typedExpression).toBeUndefined();
    expect(payloadBinding?.references.map((reference) => reference.name)).toEqual(["config.amount", "offset"]);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
    const rustPayload = evaluateWithRustFixture(process.cwd(), fixture);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const result = evaluationPayloadToResult(tsPayload);
    const loop = fixture.elements.find((element) => element.type === "forGroup")!;
    const point = fixture.elements.find((element) => element.name === "P")!;
    const first = forGroupGeneratedElementId({
      forGroupId: loop.id,
      templateElementId: point.id,
      iterationIndex: 0
    });
    const second = forGroupGeneratedElementId({
      forGroupId: loop.id,
      templateElementId: point.id,
      iterationIndex: 1
    });
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(first)).toMatchObject({ kind: "point", x: 14, y: 0 });
    expect(result.computedGeometry.get(second)).toMatchObject({ kind: "point", x: 15, y: 0 });
  }, 30_000);
});
