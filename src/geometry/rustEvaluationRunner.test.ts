import { describe, expect, it, vi } from "vitest";
import type { CadElement } from "../types/geometry";
import type { BindingVersionGraph } from "../scalars/bindingVersions";
import {
  evaluationPayloadToResult,
  type EvaluationPayload
} from "./evaluationPayload";
import { buildRustEvaluationInput } from "./rustEvaluationInput";
import {
  evaluatePreparedRust,
  prepareRustEvaluation
} from "./rustEvaluationRunner";

const point: CadElement = {
  id: "point",
  name: "Point",
  type: "freePoint",
  activity: "visible",
  x: 1,
  y: 2
};

const unsupportedElement = {
  id: "unsupported",
  name: "Unsupported",
  type: "unsupportedElement",
  activity: "visible"
} as unknown as CadElement;

const emptyBindingVersions = (): BindingVersionGraph => ({
  versions: [],
  versionsById: new Map(),
  versionIdsByBindingId: new Map(),
  timelinesByBindingId: new Map(),
  requiresExecutionOrdering: true
});

const payload: EvaluationPayload = {
  computedGeometry: [],
  errors: [],
  warnings: [],
  evaluatedElementIds: ["point"],
  evaluationLimitIndex: 1,
  effectiveVisibleElementIds: ["point"],
  effectiveEnabledElementIds: ["point"],
  conditionInactiveElementIds: []
};

describe("rustEvaluationRunner", () => {
  it("prepares an eligible document with the existing Rust input projection", () => {
    const elements = [point];
    const prepared = prepareRustEvaluation(elements);

    expect(prepared.rustEligible).toBe(true);
    expect(prepared.input).toEqual(buildRustEvaluationInput(elements, {}, {
      includeBindingVersions: true
    }));
    expect(prepared.input.elements).toBe(elements);
  });

  it("prepares an ineligible document with the existing fallback-compatible projection", () => {
    const elements = [unsupportedElement];
    const options = { bindingVersions: emptyBindingVersions() };
    const prepared = prepareRustEvaluation(elements, options);

    expect(prepared.rustEligible).toBe(false);
    expect(prepared.input).toEqual(buildRustEvaluationInput(elements, options, {
      includeBindingVersions: false
    }));
    expect(prepared.input).not.toHaveProperty("bindingVersions");
  });

  it("passes the prepared input to transport and decodes the returned payload", async () => {
    const prepared = prepareRustEvaluation([point]);
    const transport = vi.fn(async (input) => {
      expect(input).toBe(prepared.input);
      return payload;
    });

    const result = await evaluatePreparedRust(prepared, transport);

    expect(transport).toHaveBeenCalledWith(prepared.input);
    expect(result).toEqual(evaluationPayloadToResult(payload));
  });

  it("propagates transport errors without fallback", async () => {
    const prepared = prepareRustEvaluation([point]);
    const error = new Error("transport failed");

    await expect(evaluatePreparedRust(prepared, async () => {
      throw error;
    })).rejects.toBe(error);
  });

  it("does not add request or revision lifecycle state", () => {
    const elements = [point];
    const first = prepareRustEvaluation(elements);
    const second = prepareRustEvaluation(elements);

    expect(first.input.elements).toBe(elements);
    expect(second.input.elements).toBe(elements);
    expect(first).not.toHaveProperty("requestId");
    expect(first).not.toHaveProperty("evaluationRevision");
    expect(second).not.toHaveProperty("requestId");
    expect(second).not.toHaveProperty("evaluationRevision");
  });
});
