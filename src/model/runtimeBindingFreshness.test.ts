import { describe, expect, it } from "vitest";
import { isRuntimeBindingDisplayFresh } from "./runtimeBindingFreshness";

describe("isRuntimeBindingDisplayFresh", () => {
  it("is fresh only when the source is clean and the evaluation is not stale", () => {
    expect(isRuntimeBindingDisplayFresh({ isSourceDirty: false, isEvaluationStale: false })).toBe(true);
  });

  it("is not fresh when the source is dirty (last-good document)", () => {
    expect(isRuntimeBindingDisplayFresh({ isSourceDirty: true, isEvaluationStale: false })).toBe(false);
  });

  it("is not fresh when the evaluation is stale", () => {
    expect(isRuntimeBindingDisplayFresh({ isSourceDirty: false, isEvaluationStale: true })).toBe(false);
  });

  it("is not fresh when both are true", () => {
    expect(isRuntimeBindingDisplayFresh({ isSourceDirty: true, isEvaluationStale: true })).toBe(false);
  });
});
