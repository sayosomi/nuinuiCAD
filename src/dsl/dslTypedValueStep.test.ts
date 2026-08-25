import { describe, expect, it } from "vitest";
import { resolveTypedValueStep } from "./dslTypedValueStep";
import type { ScalarType } from "../scalars/types";
import { findNumericExpressionLiteralSpanAt } from "../geometry/numericExpressionLiteralSpan";

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

  it("normalizes redundant decimal places after a numeric step", () => {
    const cases = [
      { literal: "12.3400", span: { from: 10, to: 17 }, caret: 13, forward: "13.34", backward: "11.34" },
      { literal: "1.00", span: { from: 10, to: 14 }, caret: 11, forward: "2", backward: "0" }
    ];
    for (const { literal, span: numericSpan, caret, forward, backward } of cases) {
      expect(resolveTypedValueStep(literal, { kind: "number" }, numericSpan, collapsedAt(caret), 1, { numericStep: 1 }))
        .toMatchObject({ insert: forward });
      expect(resolveTypedValueStep(literal, { kind: "number" }, numericSpan, collapsedAt(caret), -1, { numericStep: 1 }))
        .toMatchObject({ insert: backward });
    }
    expect(resolveTypedValueStep("1.50", { kind: "number" }, { from: 0, to: 4 }, collapsedAt(1), 1, { numericStep: 1 }))
      .toMatchObject({ insert: "2.5" });
    expect(resolveTypedValueStep("1.5", { kind: "number" }, { from: 0, to: 3 }, collapsedAt(1), 1, { numericStep: 0.5 }))
      .toMatchObject({ insert: "2" });
  });

  it("clamps an in-range number at configured bounds", () => {
    const numericSpan = { from: 10, to: 13 };
    expect(resolveTypedValueStep("199", { kind: "number" }, numericSpan, collapsedAt(11), 1, {
      numericStep: 5,
      numericMin: 0,
      numericMax: 200
    })).toMatchObject({ insert: "200" });
    expect(resolveTypedValueStep("1", { kind: "number" }, { from: 10, to: 11 }, collapsedAt(10), -1, {
      numericStep: 5,
      numericMin: 0,
      numericMax: 200
    })).toMatchObject({ insert: "0" });
  });

  it("only returns an initially out-of-range number toward its nearest bound", () => {
    const options = { numericStep: 5, numericMin: 0, numericMax: 200 };
    expect(resolveTypedValueStep("250", { kind: "number" }, { from: 10, to: 13 }, collapsedAt(11), -1, options))
      .toMatchObject({ insert: "200" });
    expect(resolveTypedValueStep("250", { kind: "number" }, { from: 10, to: 13 }, collapsedAt(11), 1, options)).toBeNull();
    expect(resolveTypedValueStep("-20", { kind: "number" }, { from: 10, to: 13 }, collapsedAt(11), 1, options))
      .toMatchObject({ insert: "0" });
    expect(resolveTypedValueStep("-20", { kind: "number" }, { from: 10, to: 13 }, collapsedAt(11), -1, options)).toBeNull();
  });

  it("writes exponent-free small and large bounds that remain valid DSL literals", () => {
    const cases = [
      { literal: "0.00", direction: 1 as const, options: { numericStep: 1, numericMin: 1e-7 }, expected: "0.0000001" },
      { literal: "-1.00", direction: 1 as const, options: { numericStep: 1, numericMin: -1e-7 }, expected: "-0.0000001" },
      { literal: "1.00", direction: -1 as const, options: { numericStep: 1, numericMax: 1e-7 }, expected: "0.0000001" },
      { literal: "0.00", direction: -1 as const, options: { numericStep: 1, numericMax: -1e-7 }, expected: "-0.0000001" },
      { literal: "0", direction: 1 as const, options: { numericStep: 1, numericMin: 1e21 }, expected: "1000000000000000000000" },
      { literal: "0", direction: -1 as const, options: { numericStep: 1, numericMax: -1e21 }, expected: "-1000000000000000000000" }
    ];
    for (const { literal, direction, options, expected } of cases) {
      const result = resolveTypedValueStep(literal, { kind: "number" }, { from: 0, to: literal.length }, collapsedAt(0), direction, options);
      expect(result?.insert).toBe(expected);
      expect(result?.insert).not.toMatch(/e/i);
      expect(findNumericExpressionLiteralSpanAt(result?.insert ?? "", { start: 0, end: 0 })).toEqual({ start: 0, end: expected.length });
    }
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
