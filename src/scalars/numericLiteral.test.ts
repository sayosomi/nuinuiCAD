import { describe, expect, it } from "vitest";
import { tokenize } from "../geometry/numericExpressionParser";
import { numericLiteralForExpression } from "./numericLiteral";

describe("numericLiteralForExpression", () => {
  it.each([0, -0, Number.MIN_VALUE, Number.MAX_VALUE, 1e-7, -1e-7, 1e20, -42, 12.3456])(
    "keeps %p finite and tokenizer-readable without exponent notation", (value) => {
      const literal = numericLiteralForExpression(value)!;
      expect(literal).not.toMatch(/[eE]/);
      expect(tokenize(literal)).toHaveLength(value < 0 || Object.is(value, -0) ? 2 : 1);
      expect(Object.is(Number(literal), value)).toBe(true);
    }
  );

  it("rejects non-finite values", () => {
    expect(numericLiteralForExpression(Number.NaN)).toBeNull();
    expect(numericLiteralForExpression(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
