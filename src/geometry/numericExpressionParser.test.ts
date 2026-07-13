import { describe, expect, it } from "vitest";
import { findNumericExpressionLiteralSpanAt } from "./numericExpressionLiteralSpan";
import { Parser, tokenize } from "./numericExpressionParser";

const evaluate = (expression: string) => new Parser(
  tokenize(expression),
  () => 7,
  () => 11,
  () => 13
).parse();

const legacyTokenShape = (expression: string) => tokenize(expression).map((token) => {
  const legacy = { ...token };
  Reflect.deleteProperty(legacy, "start");
  Reflect.deleteProperty(legacy, "end");
  return legacy;
});

describe("numeric expression token spans", () => {
  it("adds source offsets without changing the existing tokenization or evaluation semantics", () => {
    const cases = [
      {
        expression: "-1 + 2 * 3",
        tokens: [
          { type: "operator", value: "-" },
          { type: "number", value: 1 },
          { type: "operator", value: "+" },
          { type: "number", value: 2 },
          { type: "operator", value: "*" },
          { type: "number", value: 3 }
        ],
        value: 5
      },
      {
        expression: "1-2 + -3",
        tokens: [
          { type: "number", value: 1 },
          { type: "operator", value: "-" },
          { type: "number", value: 2 },
          { type: "operator", value: "+" },
          { type: "operator", value: "-" },
          { type: "number", value: 3 }
        ],
        value: -4
      },
      {
        expression: "-(2 + 3) / +5",
        tokens: [
          { type: "operator", value: "-" },
          { type: "leftParen" },
          { type: "number", value: 2 },
          { type: "operator", value: "+" },
          { type: "number", value: 3 },
          { type: "rightParen" },
          { type: "operator", value: "/" },
          { type: "operator", value: "+" },
          { type: "number", value: 5 }
        ],
        value: -1
      }
    ];

    for (const { expression, tokens, value } of cases) {
      expect(legacyTokenShape(expression)).toEqual(tokens);
      expect(evaluate(expression)).toBe(value);
    }
    expect(tokenize("-1 + 2").map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 3, end: 4 },
      { start: 5, end: 6 }
    ]);
  });
});

describe("numeric expression literal spans", () => {
  it("selects only lexer-proven numeric literals, including contiguous unary signs", () => {
    expect(findNumericExpressionLiteralSpanAt("-0.5 + 2", { start: 1, end: 1 })).toEqual({ start: 0, end: 4 });
    expect(findNumericExpressionLiteralSpanAt("-0.5 + 2", { start: 7, end: 8 })).toEqual({ start: 7, end: 8 });
  });

  it("uses a terminal caret only when no ordinary token contains that position", () => {
    expect(findNumericExpressionLiteralSpanAt("12+3", { start: 2, end: 2 })).toBeNull();
    expect(findNumericExpressionLiteralSpanAt("12+3", { start: 4, end: 4 })).toEqual({ start: 3, end: 4 });
  });

  it("rejects exponent, units, identifier fragments, and non-numeric tokens", () => {
    for (const expression of ["1e3", "10mm", "version 2", "@value1", "pi", "name2"]) {
      for (let position = 0; position <= expression.length; position += 1) {
        expect(findNumericExpressionLiteralSpanAt(expression, { start: position, end: position })).toBeNull();
      }
    }
  });
});
