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

describe("tokenizeScalarExpression / @qualifiedName references", () => {
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

  it("tokenizes @Name.property as a typed geometry property reference", () => {
    const source = "@AB.length";
    const result = tokenizeScalarExpression(source, fullSpan(source));
    expect(result.error).toBeNull();
    expect(result.tokens[0]).toMatchObject({ kind: "geometryProperty", elementName: "AB", property: "length", span: { start: 0, end: source.length } });
  });

  it("tokenizes a multi-segment property path", () => {
    const source = "@AB.startPoint.x";
    const result = tokenizeScalarExpression(source, fullSpan(source));
    expect(result.tokens[0]).toMatchObject({ kind: "geometryProperty", property: "startPoint.x", span: { start: 0, end: source.length } });
  });

  it("tokenizes a qualified path without a property as one reference", () => {
    for (const source of ["@foo::実高さ", '@"foo bar"::実高さ']) {
      expect(tokenizeOk(source)).toEqual([
        { kind: "reference", name: source.slice(1), nameSpan: { start: 1, end: source.length }, span: { start: 0, end: source.length } }
      ]);
    }
  });

  it("tokenizes a qualified path with a property as one geometry-property head", () => {
    const elementName = "G::H::AB";
    const source = `@${elementName}.endTangentAngleDeg`;
    const result = tokenizeScalarExpression(source, fullSpan(source));
    expect(result.error).toBeNull();
    expect(result.tokens[0]).toEqual({
      kind: "geometryProperty",
      elementName,
      elementNameSpan: { start: 1, end: 1 + elementName.length },
      property: "endTangentAngleDeg",
      propertySpan: { start: 1 + elementName.length + 1, end: source.length },
      span: { start: 0, end: source.length }
    });
  });

  it("reports an invalid scoped separator at its exact source position", () => {
    const source = "@G:::AB.length";
    const result = tokenizeScalarExpression(source, fullSpan(source));
    expect(result.tokens).toEqual([]);
    expect(result.error).toMatchObject({ code: "unexpected-token", span: { start: source.indexOf("::"), end: source.indexOf("::") + 1 } });
  });

  it("continues tokenizing a property reference mid-expression", () => {
    const source = "1 + @AB.length";
    const result = tokenizeScalarExpression(source, fullSpan(source));
    expect(result.tokens).toHaveLength(3);
    expect(result.tokens[2]).toMatchObject({ kind: "geometryProperty", span: { start: 4, end: source.length } });
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
