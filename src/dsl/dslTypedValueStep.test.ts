import { describe, expect, it } from "vitest";
import { resolveTypedValueStep } from "./dslTypedValueStep";
import type { ScalarType } from "../scalars/types";

const span = { from: 10, to: 14 };
const collapsedAt = (pos: number) => ({ start: pos, end: pos });

describe("resolveTypedValueStep", () => {
  it("toggles a boolean literal in both directions", () => {
    expect(resolveTypedValueStep("true", { kind: "boolean" }, span, collapsedAt(12), 1)).toMatchObject({ insert: "false" });
    expect(resolveTypedValueStep("true", { kind: "boolean" }, span, collapsedAt(12), -1)).toMatchObject({ insert: "false" });
    expect(resolveTypedValueStep("false", { kind: "boolean" }, span, collapsedAt(12), 1)).toMatchObject({ insert: "true" });
    expect(resolveTypedValueStep("false", { kind: "boolean" }, span, collapsedAt(12), -1)).toMatchObject({ insert: "true" });
  });

  it("cycles a choice literal in declared (non-alphabetical) metadata order, wrapping at both ends", () => {
    const type: ScalarType = { kind: "choice", options: ["right", "left", "center"] };
    expect(resolveTypedValueStep("right", type, span, collapsedAt(12), 1)).toMatchObject({ insert: "left" });
    expect(resolveTypedValueStep("left", type, span, collapsedAt(12), 1)).toMatchObject({ insert: "center" });
    expect(resolveTypedValueStep("center", type, span, collapsedAt(12), 1)).toMatchObject({ insert: "right" });
    expect(resolveTypedValueStep("right", type, span, collapsedAt(12), -1)).toMatchObject({ insert: "center" });
    expect(resolveTypedValueStep("center", type, span, collapsedAt(12), -1)).toMatchObject({ insert: "left" });
  });

  it("steps the selected numeric literal with the default one-unit step", () => {
    const numericSpan = { from: 10, to: 17 };
    expect(resolveTypedValueStep("12.3456", { kind: "number" }, numericSpan, collapsedAt(13), 1, { numericStep: 1 })).toMatchObject({
      from: 10,
      to: 17,
      insert: "13.3456",
      selection: { start: 10, end: 17 }
    });
    expect(resolveTypedValueStep("12.3456", { kind: "number" }, numericSpan, collapsedAt(13), -1, { numericStep: 1 })).toMatchObject({
      insert: "11.3456"
    });
  });

  it("is a no-op for numeric references, string, and null declared types", () => {
    expect(resolveTypedValueStep("@length", { kind: "number" }, { from: 10, to: 17 }, collapsedAt(12), 1)).toBeNull();
    expect(resolveTypedValueStep("true", { kind: "string" }, span, collapsedAt(12), 1)).toBeNull();
    expect(resolveTypedValueStep("true", null, span, collapsedAt(12), 1)).toBeNull();
  });

  it("is a no-op when the sliced value does not match the declared type's literal set (drift)", () => {
    expect(resolveTypedValueStep("@表示する", { kind: "boolean" }, span, collapsedAt(12), 1)).toBeNull();
    expect(resolveTypedValueStep("maybe", { kind: "boolean" }, span, collapsedAt(12), 1)).toBeNull();
    const type: ScalarType = { kind: "choice", options: ["right", "left"] };
    expect(resolveTypedValueStep("center", type, span, collapsedAt(12), 1)).toBeNull();
    expect(resolveTypedValueStep("@向き", type, span, collapsedAt(12), 1)).toBeNull();
  });

  it("is a no-op when the choice type has no options to cycle through", () => {
    const type: ScalarType = { kind: "choice", options: [] };
    expect(resolveTypedValueStep("right", type, span, collapsedAt(12), 1)).toBeNull();
  });

  it("is a no-op for a non-collapsed selection that does not exactly equal the span", () => {
    expect(resolveTypedValueStep("true", { kind: "boolean" }, span, { start: 10, end: 13 }, 1)).toBeNull();
    expect(resolveTypedValueStep("true", { kind: "boolean" }, span, { start: 11, end: 14 }, 1)).toBeNull();
  });

  it("accepts a non-collapsed selection that exactly equals the span", () => {
    expect(resolveTypedValueStep("true", { kind: "boolean" }, span, { start: 10, end: 14 }, 1)).toMatchObject({ insert: "false" });
  });

  it("returns a selection anchored at the span start, spanning the new insert's length", () => {
    const type: ScalarType = { kind: "choice", options: ["a", "longer-option"] };
    const result = resolveTypedValueStep("a", type, span, collapsedAt(11), 1);
    expect(result).toMatchObject({ from: 10, to: 14, insert: "longer-option" });
    expect(result?.selection).toEqual({ start: 10, end: 10 + "longer-option".length });
  });
});
