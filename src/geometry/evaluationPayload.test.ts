import { describe, expect, it } from "vitest";
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
});
