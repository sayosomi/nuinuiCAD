import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { sampleElements } from "../sampleData";
import { evaluateElements } from "./evaluate";
import {
  evaluationPayloadToResult,
  evaluationResultToPayload
} from "./evaluationPayload";

describe("evaluation payload conversion", () => {
  it("round-trips computed geometry, variables, errors, warnings, and id sets", () => {
    const evaluation = evaluateElements(sampleElements, { evaluationLimitIndex: 3 });
    const payload = evaluationResultToPayload(evaluation);
    const roundTrip = evaluationPayloadToResult(payload);

    expect(Array.from(roundTrip.computedGeometry.values())).toEqual(
      Array.from(evaluation.computedGeometry.values())
    );
    expect(Array.from(roundTrip.computedVariables.values())).toEqual(
      Array.from(evaluation.computedVariables.values())
    );
    expect(roundTrip.errors).toEqual(evaluation.errors);
    expect(roundTrip.warnings).toEqual(evaluation.warnings);
    expect(roundTrip.evaluatedElementIds).toEqual(evaluation.evaluatedElementIds);
    expect(roundTrip.effectiveVisibleElementIds).toEqual(evaluation.effectiveVisibleElementIds);
    expect(roundTrip.effectiveEnabledElementIds).toEqual(evaluation.effectiveEnabledElementIds);
  });

  it("is absent from the payload when there is no scalarProgram", () => {
    const evaluation = evaluateElements(sampleElements, { evaluationLimitIndex: 3 });
    const payload = evaluationResultToPayload(evaluation);
    expect(payload.computedScalarBindings).toBeUndefined();
    expect(evaluationPayloadToResult(payload).computedScalarBindings).toBeUndefined();
  });

  it("round-trips ok and error computedScalarBindings entries (Task 20)", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
    const compiled = compileCanonicalText(baseline, [
      "nui 3",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 3 y: 4)",
      "var d = pointDistance(point1: A point2: B state: disabled)",
      "const dist: number = @d",
      "const label: string = \"seam\""
    ].join("\n")).doc;

    const evaluation = evaluateElements(compiled.document!.elements, { scalarProgram: compiled.scalarProgram });
    expect(evaluation.computedScalarBindings?.size).toBe(2);

    const payload = evaluationResultToPayload(evaluation);
    expect(payload.computedScalarBindings).toHaveLength(2);
    const roundTrip = evaluationPayloadToResult(payload);
    expect(roundTrip.computedScalarBindings).toEqual(evaluation.computedScalarBindings);
  });
});
