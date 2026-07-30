import { describe, expect, it } from "vitest";
import { tokenizeScalarExpression, type ScalarExpressionToken } from "./expressionTokenizer";

const fullSpan = (source: string) => ({ start: 0, end: source.length });

const tokenizeOk = (source: string): readonly ScalarExpressionToken[] => {
  const result = tokenizeScalarExpression(source, fullSpan(source));
  if (result.error) throw new Error(`expected no tokenizer error, got ${JSON.stringify(result.error)}`);
  return result.tokens;
};

describe("tokenizeScalarExpression / parens and operators", () => {
  it("tokenizes parentheses with exact spans", () => {
    expect(tokenizeOk("(")).toEqual([{ kind: "leftParen", span: { start: 0, end: 1 } }]);
    expect(tokenizeOk(")")).toEqual([{ kind: "rightParen", span: { start: 0, end: 1 } }]);
  });

  it("prefers the 2-char operator over splitting into two 1-char tokens", () => {
    expect(tokenizeOk("&&")).toEqual([{ kind: "operator", value: "&&", span: { start: 0, end: 2 } }]);
    expect(tokenizeOk("||")).toEqual([{ kind: "operator", value: "||", span: { start: 0, end: 2 } }]);
    expect(tokenizeOk("==")).toEqual([{ kind: "operator", value: "==", span: { start: 0, end: 2 } }]);
    expect(tokenizeOk("!=")).toEqual([{ kind: "operator", value: "!=", span: { start: 0, end: 2 } }]);
    expect(tokenizeOk(">=")).toEqual([{ kind: "operator", value: ">=", span: { start: 0, end: 2 } }]);
    expect(tokenizeOk("<=")).toEqual([{ kind: "operator", value: "<=", span: { start: 0, end: 2 } }]);
  });

  it("disambiguates >= from > followed by a literal", () => {
    expect(tokenizeOk(">=5")).toEqual([
      { kind: "operator", value: ">=", span: { start: 0, end: 2 } },
      { kind: "literal", literal: { kind: "number", span: { start: 2, end: 3 }, raw: "5", value: 5 } }
    ]);
    expect(tokenizeOk(">5")).toEqual([
      { kind: "operator", value: ">", span: { start: 0, end: 1 } },
      { kind: "literal", literal: { kind: "number", span: { start: 1, end: 2 }, raw: "5", value: 5 } }
    ]);
  });

  it("tokenizes each 1-char operator with an exact span", () => {
    for (const operator of ["+", "-", "*", "/", "<", ">", "!"] as const) {
      expect(tokenizeOk(operator)).toEqual([{ kind: "operator", value: operator, span: { start: 0, end: 1 } }]);
    }
  });

  it("skips whitespace including tabs and newlines", () => {
    expect(tokenizeOk(" \t1\n+\r2 ")).toEqual([
      { kind: "literal", literal: { kind: "number", span: { start: 2, end: 3 }, raw: "1", value: 1 } },
      { kind: "operator", value: "+", span: { start: 4, end: 5 } },
      { kind: "literal", literal: { kind: "number", span: { start: 6, end: 7 }, raw: "2", value: 2 } }
    ]);
  });

  it("reports an unrecognized bare character as an error, not a token", () => {
    const result = tokenizeScalarExpression("=", fullSpan("="));
    expect(result.tokens).toEqual([]);
    expect(result.error).toMatchObject({ code: "unexpected-token", span: { start: 0, end: 1 } });
  });
});

describe("tokenizeScalarExpression / @name references", () => {
  it("tokenizes a single ASCII reference with span including the sigil", () => {
    expect(tokenizeOk("@width")).toEqual([
      { kind: "reference", name: "width", nameSpan: { start: 1, end: 6 }, span: { start: 0, end: 6 } }
    ]);
  });

  it("tokenizes a Unicode (Japanese) reference name", () => {
    expect(tokenizeOk("@ラベル")).toEqual([
      { kind: "reference", name: "ラベル", nameSpan: { start: 1, end: 4 }, span: { start: 0, end: 4 } }
    ]);
  });

  it("allows underscore and digits after the first character", () => {
    expect(tokenizeOk("@名前_1")).toEqual([
      { kind: "reference", name: "名前_1", nameSpan: { start: 1, end: 5 }, span: { start: 0, end: 5 } }
    ]);
  });

  it("errors with an exact span on a bare @ with no following name", () => {
    const result = tokenizeScalarExpression("@", fullSpan("@"));
    expect(result.tokens).toEqual([]);
    expect(result.error).toMatchObject({ code: "unexpected-token", span: { start: 0, end: 1 } });
  });

  it("errors when @ is followed by a character that cannot start an identifier", () => {
    const result = tokenizeScalarExpression("@(x)", fullSpan("@(x)"));
    expect(result.tokens).toEqual([]);
    expect(result.error).toMatchObject({ code: "unexpected-token", span: { start: 0, end: 1 } });
  });

  it("rejects @Name.property with a dedicated phase diagnostic, not a generic lexer error (Task 51)", () => {
    const source = "@AB.length";
    const result = tokenizeScalarExpression(source, fullSpan(source));
    expect(result.tokens).toEqual([]);
    expect(result.error).toMatchObject({
      code: "geometry-property-in-typed-expression",
      span: { start: 0, end: source.length }
    });
    expect(result.error?.message).toContain("@AB.length");
  });

  it("covers a multi-segment property path in the diagnostic span", () => {
    const source = "@AB.startPoint.x";
    const result = tokenizeScalarExpression(source, fullSpan(source));
    expect(result.error).toMatchObject({ code: "geometry-property-in-typed-expression", span: { start: 0, end: source.length } });
  });

  it("still reports a dedicated diagnostic mid-expression", () => {
    const source = "1 + @AB.length";
    const result = tokenizeScalarExpression(source, fullSpan(source));
    expect(result.tokens).toHaveLength(2); // "1" literal and "+" operator, accumulated before the error
    expect(result.error).toMatchObject({ code: "geometry-property-in-typed-expression", span: { start: 4, end: source.length } });
  });
});

describe("tokenizeScalarExpression / literal delegation", () => {
  it("delegates number/string/boolean/choice literals to scanScalarLiteral", () => {
    expect(tokenizeOk("42")).toEqual([
      { kind: "literal", literal: { kind: "number", span: { start: 0, end: 2 }, raw: "42", value: 42 } }
    ]);
    expect(tokenizeOk('"hi"')).toEqual([
      {
        kind: "literal",
        literal: { kind: "string", span: { start: 0, end: 4 }, quote: "\"", raw: "hi", cooked: "hi", escapes: [] }
      }
    ]);
    expect(tokenizeOk("true")).toEqual([
      { kind: "literal", literal: { kind: "boolean", span: { start: 0, end: 4 }, raw: "true", value: true } }
    ]);
    expect(tokenizeOk("right")).toEqual([
      { kind: "literal", literal: { kind: "choice", span: { start: 0, end: 5 }, raw: "right" } }
    ]);
  });

  it("propagates a literal-scan error, remapping invalid-literal-token to unexpected-token", () => {
    const result = tokenizeScalarExpression(".", fullSpan("."));
    expect(result.tokens).toEqual([]);
    expect(result.error).toMatchObject({ code: "unexpected-token" });
  });

  it("propagates an unterminated-string error unchanged, stopping at that point", () => {
    const source = '1 + "oops';
    const result = tokenizeScalarExpression(source, fullSpan(source));
    expect(result.tokens).toEqual([
      { kind: "literal", literal: { kind: "number", span: { start: 0, end: 1 }, raw: "1", value: 1 } },
      { kind: "operator", value: "+", span: { start: 2, end: 3 } }
    ]);
    expect(result.error).toMatchObject({ code: "unterminated-string", span: { start: 4, end: 9 } });
  });
});

describe("tokenizeScalarExpression / span boundaries", () => {
  it("only tokenizes within the given span, ignoring source outside it", () => {
    const source = "xx 1 + 2 yy";
    const result = tokenizeScalarExpression(source, { start: 3, end: 8 });
    expect(result.error).toBeNull();
    expect(result.tokens).toEqual([
      { kind: "literal", literal: { kind: "number", span: { start: 3, end: 4 }, raw: "1", value: 1 } },
      { kind: "operator", value: "+", span: { start: 5, end: 6 } },
      { kind: "literal", literal: { kind: "number", span: { start: 7, end: 8 }, raw: "2", value: 2 } }
    ]);
  });
});
