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

describe("legacy numeric sqrt", () => {
  it("keeps the existing negative-argument error", () => {
    expect(() => evaluate("sqrt(-1)")).toThrow("sqrt の引数は0以上である必要があります。");
  });

  it("uses shared sqrt semantics and rejects a non-finite argument", () => {
    const parser = new Parser(
      tokenize("sqrt(value.length)"),
      () => Number.POSITIVE_INFINITY,
      () => 0,
      () => 0
    );
    expect(() => parser.parse()).toThrow("sqrt の計算結果が不正です。");
  });

  it("continues to evaluate valid legacy sqrt expressions", () => {
    expect(evaluate("sqrt(9) + 1")).toBe(4);
  });
});

describe("legacy numeric pi constant", () => {
  it("reuses the canonical constant value while retaining the legacy number token", () => {
    expect(legacyTokenShape("pi")).toEqual([{ type: "number", value: Math.PI }]);
    expect(evaluate("2 * pi")).toBe(2 * Math.PI);
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
