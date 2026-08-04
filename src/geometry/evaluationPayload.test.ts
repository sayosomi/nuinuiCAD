import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { sampleElements } from "../sampleData";
import { evaluateElements } from "./evaluate";
import {
  ScalarOutputDecodeError,
  evaluationPayloadToResult,
  evaluationResultToPayload
} from "./evaluationPayload";
import type { EvaluationPayload } from "./evaluationPayload";

describe("evaluation payload conversion", () => {
  it("round-trips computed geometry, errors, warnings, and id sets", () => {
    const evaluation = evaluateElements(sampleElements, { evaluationLimitIndex: 3 });
    const payload = evaluationResultToPayload(evaluation);
    const roundTrip = evaluationPayloadToResult(payload);

    expect(Array.from(roundTrip.computedGeometry.values())).toEqual(
      Array.from(evaluation.computedGeometry.values())
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
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "line AB = segment(start: A, end: B, state: disabled)",
      "const dist: number = @AB.length",
      "const label: string = \"seam\""
    ].join("\n")).doc;

    const evaluation = evaluateElements(compiled.document!.elements, { scalarProgram: compiled.scalarProgram });
    expect(evaluation.computedScalarBindings?.size).toBe(2);

    const payload = evaluationResultToPayload(evaluation);
    expect(payload.computedScalarBindings).toHaveLength(2);
    const roundTrip = evaluationPayloadToResult(payload);
    expect(roundTrip.computedScalarBindings).toEqual(evaluation.computedScalarBindings);
  });

  it("fails closed on malformed or duplicate computedScalarBindings output", () => {
    const baseline = evaluationResultToPayload(evaluateElements(sampleElements, { evaluationLimitIndex: 3 }));
    const validEvaluation = {
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 1 }
    };
    const malformedOutputs: unknown[] = [
      { bindingId: "binding:a", evaluation: validEvaluation },
      [{ bindingId: "", evaluation: validEvaluation }],
      [{ bindingId: "binding:a" }],
      [{ bindingId: "binding:a", evaluation: { status: "ok", type: { kind: "number" }, value: null } }],
      [
        { bindingId: "binding:a", evaluation: validEvaluation },
        { bindingId: "binding:a", evaluation: validEvaluation }
      ]
    ];

    for (const computedScalarBindings of malformedOutputs) {
      expect(() => evaluationPayloadToResult({
        ...baseline,
        computedScalarBindings
      } as unknown as typeof baseline)).toThrow(ScalarOutputDecodeError);
    }
  });

  it("round-trips ordered mutation history and rejects malformed version output", () => {
    const baseline = evaluationResultToPayload(evaluateElements(sampleElements, { evaluationLimitIndex: 3 }));
    const evaluation = {
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 2 }
    } as const;
    const computedScalarBindingVersions: NonNullable<EvaluationPayload["computedScalarBindingVersions"]> = [
      { versionId: "decl:x", statementId: "decl:x", bindingId: "binding:x", status: "executed", evaluation },
      { versionId: "set:x", statementId: "set:x", bindingId: "binding:x", status: "poisoned", evaluation: { status: "error", type: { kind: "number" }, issueCode: "poisoned-binding", bindingId: "binding:x" } }
    ];
    const payload: EvaluationPayload = {
      ...baseline,
      computedScalarBindingVersions
    };
    const result = evaluationPayloadToResult(payload);
    expect(Array.from(result.computedScalarBindingVersions?.keys() ?? [])).toEqual(["decl:x", "set:x"]);
    expect(() => evaluationPayloadToResult({
      ...payload,
      computedScalarBindingVersions: [computedScalarBindingVersions[0], computedScalarBindingVersions[0]]
    })).toThrow(ScalarOutputDecodeError);
  });
});
