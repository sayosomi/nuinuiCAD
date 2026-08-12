import { describe, expect, it } from "vitest";
import { MAX_SCALAR_EXPRESSION_DEPTH, parseScalarExpression } from "./expressionParser";
import type { ScalarExpressionAst, ScalarExpressionDiagnostic } from "./expressionAst";

const fullSpan = (source: string) => ({ start: 0, end: source.length });

const parseOk = (source: string): ScalarExpressionAst => {
  const result = parseScalarExpression(source, fullSpan(source));
  if (!result.ast || result.diagnostics.length !== 0) {
    throw new Error(`expected a successful parse, got ${JSON.stringify(result)}`);
  }
  return result.ast;
};

const parseErr = (source: string): ScalarExpressionDiagnostic => {
  const result = parseScalarExpression(source, fullSpan(source));
  if (result.ast !== null || result.diagnostics.length !== 1) {
    throw new Error(`expected exactly one failure diagnostic, got ${JSON.stringify(result)}`);
  }
  return result.diagnostics[0];
};

describe("parseScalarExpression / exclusive success-failure contract", () => {
  it("returns a non-null ast and empty diagnostics on success", () => {
    const result = parseScalarExpression("1", fullSpan("1"));
    expect(result.ast).not.toBeNull();
    expect(result.diagnostics).toEqual([]);
  });

  it("returns a null ast and exactly one diagnostic on any failure, including trailing tokens", () => {
    const result = parseScalarExpression("1 2", fullSpan("1 2"));
    expect(result.ast).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("trailing-token");
  });
});

describe("parseScalarExpression / literal nodes", () => {
  it("parses a number literal", () => {
    expect(parseOk("42")).toEqual({ kind: "numberLiteral", span: { start: 0, end: 2 }, value: 42 });
  });

  it("parses a double- and single-quoted string literal", () => {
    expect(parseOk('"hello"')).toEqual({ kind: "stringLiteral", span: { start: 0, end: 7 }, value: "hello" });
    expect(parseOk("'hello'")).toEqual({ kind: "stringLiteral", span: { start: 0, end: 7 }, value: "hello" });
  });

  it("parses boolean literals", () => {
    expect(parseOk("true")).toEqual({ kind: "booleanLiteral", span: { start: 0, end: 4 }, value: true });
    expect(parseOk("false")).toEqual({ kind: "booleanLiteral", span: { start: 0, end: 5 }, value: false });
  });

  it("parses a bare choice token as an unresolved node, guessing no type", () => {
    expect(parseOk("right")).toEqual({ kind: "unresolvedChoiceLiteral", span: { start: 0, end: 5 }, raw: "right" });
  });

  describe("string escapes (Task 09 delegation)", () => {
    const cases: Array<[string, string]> = [
      ["\\\\", "\\"],
      ['\\"', "\""],
      ["\\'", "'"],
      ["\\n", "\n"],
      ["\\r", "\r"],
      ["\\t", "\t"],
      ["\\{", "{"],
      ["\\}", "}"]
    ];

    it.each(cases)("unescapes %j inside a parsed string literal", (raw, cooked) => {
      const source = `"x${raw}y"`;
      const ast = parseOk(source);
      expect(ast).toMatchObject({ kind: "stringLiteral", value: `x${cooked}y` });
    });
  });
});

describe("parseScalarExpression / @qualifiedName reference", () => {
  it("parses a single ASCII reference with an exact nameSpan excluding the sigil", () => {
    expect(parseOk("@width")).toEqual({
      kind: "reference",
      span: { start: 0, end: 6 },
      nameSpan: { start: 1, end: 6 },
      name: "width"
    });
  });

  it("parses a Unicode (Japanese) reference name", () => {
    expect(parseOk("@ラベル")).toEqual({
      kind: "reference",
      span: { start: 0, end: 4 },
      nameSpan: { start: 1, end: 4 },
      name: "ラベル"
    });
  });

  it.each(["@foo::実高さ", '@"foo bar"::実高さ'])("parses a qualified reference path without resolving its namespace", (source) => {
    expect(parseOk(source)).toEqual({
      kind: "reference",
      span: { start: 0, end: source.length },
      nameSpan: { start: 1, end: source.length },
      name: source.slice(1)
    });
  });
});

describe("parseScalarExpression / unary", () => {
  it("parses unary !", () => {
    expect(parseOk("!true")).toEqual({
      kind: "unary",
      operator: "!",
      span: { start: 0, end: 5 },
      operand: { kind: "booleanLiteral", span: { start: 1, end: 5 }, value: true }
    });
  });

  it("is right-associative for chained unary !", () => {
    const ast = parseOk("!!true");
    expect(ast).toMatchObject({
      kind: "unary",
      operator: "!",
      operand: { kind: "unary", operator: "!", operand: { kind: "booleanLiteral", value: true } }
    });
  });

  it("is right-associative for chained unary -", () => {
    const ast = parseOk("--5");
    expect(ast).toMatchObject({
      kind: "unary",
      operator: "-",
      operand: { kind: "unary", operator: "-", operand: { kind: "numberLiteral", value: 5 } }
    });
  });

  it("parses unary + and - over a reference", () => {
    expect(parseOk("-@x")).toMatchObject({ kind: "unary", operator: "-", operand: { kind: "reference", name: "x" } });
    expect(parseOk("+@x")).toMatchObject({ kind: "unary", operator: "+", operand: { kind: "reference", name: "x" } });
  });
});

describe("parseScalarExpression / precedence and associativity", () => {
  it("binds * tighter than +", () => {
    const ast = parseOk("1 + 2 * 3");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "+",
      left: { kind: "numberLiteral", value: 1 },
      right: { kind: "binary", operator: "*", left: { value: 2 }, right: { value: 3 } }
    });
  });

  it("binds + tighter than comparison", () => {
    const ast = parseOk("1 + 2 < 3 + 4");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "<",
      left: { kind: "binary", operator: "+", left: { value: 1 }, right: { value: 2 } },
      right: { kind: "binary", operator: "+", left: { value: 3 }, right: { value: 4 } }
    });
  });

  it("binds comparison tighter than equality", () => {
    const ast = parseOk("1 < 2 == true");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "==",
      left: { kind: "binary", operator: "<", left: { value: 1 }, right: { value: 2 } },
      right: { kind: "booleanLiteral", value: true }
    });
  });

  it("binds equality tighter than &&", () => {
    const ast = parseOk("1 == 1 && true");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "&&",
      left: { kind: "binary", operator: "==" },
      right: { kind: "booleanLiteral", value: true }
    });
  });

  it("binds && tighter than ||", () => {
    const ast = parseOk("true || false && false");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "||",
      left: { kind: "booleanLiteral", value: true },
      right: { kind: "binary", operator: "&&" }
    });
  });

  it("binds ! tighter than arithmetic (unary applies to the immediate operand only)", () => {
    const ast = parseOk("!true == false");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "==",
      left: { kind: "unary", operator: "!", operand: { value: true } },
      right: { kind: "booleanLiteral", value: false }
    });
  });

  it("left-associates a chain of + and -", () => {
    const ast = parseOk("1 - 2 - 3");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "-",
      left: { kind: "binary", operator: "-", left: { value: 1 }, right: { value: 2 } },
      right: { value: 3 }
    });
  });

  it("left-associates a chain of * and /", () => {
    const ast = parseOk("8 / 4 / 2");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "/",
      left: { kind: "binary", operator: "/", left: { value: 8 }, right: { value: 4 } },
      right: { value: 2 }
    });
  });

  it("left-associates a chain of &&", () => {
    const ast = parseOk("true && true && true");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "&&",
      left: { kind: "binary", operator: "&&" }
    });
  });

  it("left-associates a chain of ||", () => {
    const ast = parseOk("false || false || true");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "||",
      left: { kind: "binary", operator: "||" }
    });
  });

  it("rejects a chained comparison as unsupported", () => {
    const diagnostic = parseErr("1 < 2 < 3");
    expect(diagnostic.code).toBe("chained-comparison-not-supported");
  });

  it("rejects a chained equality as unsupported", () => {
    const diagnostic = parseErr("1 == 2 == 3");
    expect(diagnostic.code).toBe("chained-comparison-not-supported");
  });

  it("allows a chained comparison when explicitly parenthesized", () => {
    const ast = parseOk("(1 < 2) == true");
    expect(ast).toMatchObject({ kind: "binary", operator: "==", left: { kind: "group" } });
  });
});

describe("parseScalarExpression / parentheses and group span", () => {
  it("parses a group node whose span includes both parentheses", () => {
    const ast = parseOk("(1 + 2)");
    expect(ast).toEqual({
      kind: "group",
      span: { start: 0, end: 7 },
      expression: {
        kind: "binary",
        operator: "+",
        span: { start: 1, end: 6 },
        left: { kind: "numberLiteral", span: { start: 1, end: 2 }, value: 1 },
        right: { kind: "numberLiteral", span: { start: 5, end: 6 }, value: 2 }
      }
    });
  });

  it("lets parentheses override default precedence", () => {
    const ast = parseOk("(1 + 2) * 3");
    expect(ast).toMatchObject({
      kind: "binary",
      operator: "*",
      left: { kind: "group", expression: { kind: "binary", operator: "+" } },
      right: { value: 3 }
    });
  });
});

describe("parseScalarExpression / error scenarios", () => {
  it("reports a malformed token", () => {
    expect(parseErr("1 % 2").code).toBe("unexpected-token");
  });

  it("reports a missing left operand", () => {
    expect(parseErr("* 2").code).toBe("missing-operand");
    expect(parseErr("&& true").code).toBe("missing-operand");
  });

  it("reports a missing right operand", () => {
    const diagnostic = parseErr("1 +");
    expect(diagnostic.code).toBe("missing-operand");
    expect(diagnostic.span).toEqual({ start: 3, end: 3 });
  });

  it("reports a missing closing parenthesis anchored at the opening paren", () => {
    const diagnostic = parseErr("(1 + 2");
    expect(diagnostic.code).toBe("unterminated-group");
    expect(diagnostic.span).toEqual({ start: 0, end: 1 });
  });

  it("reports a trailing token anchored at the first unconsumed token", () => {
    const diagnostic = parseErr("1 + 2 3");
    expect(diagnostic.code).toBe("trailing-token");
    expect(diagnostic.span).toEqual({ start: 6, end: 7 });
  });

  it("propagates an unterminated string from the tokenizer", () => {
    expect(parseErr('"oops').code).toBe("unterminated-string");
  });
});

describe("parseScalarExpression / exact spans", () => {
  it("fixes exact spans through a nested expression", () => {
    const ast = parseOk("@a + 2 * 3");
    expect(ast).toEqual({
      kind: "binary",
      operator: "+",
      span: { start: 0, end: 10 },
      left: { kind: "reference", span: { start: 0, end: 2 }, nameSpan: { start: 1, end: 2 }, name: "a" },
      right: {
        kind: "binary",
        operator: "*",
        span: { start: 5, end: 10 },
        left: { kind: "numberLiteral", span: { start: 5, end: 6 }, value: 2 },
        right: { kind: "numberLiteral", span: { start: 9, end: 10 }, value: 3 }
      }
    });
  });

  it("uses absolute offsets into source when parsing a sub-span, not offsets relative to the span", () => {
    const source = "xx @width + 1 yy";
    const result = parseScalarExpression(source, { start: 3, end: 13 });
    expect(result.diagnostics).toEqual([]);
    expect(result.ast).toEqual({
      kind: "binary",
      operator: "+",
      span: { start: 3, end: 13 },
      left: { kind: "reference", span: { start: 3, end: 9 }, nameSpan: { start: 4, end: 9 }, name: "width" },
      right: { kind: "numberLiteral", span: { start: 12, end: 13 }, value: 1 }
    });
  });
});

describe("parseScalarExpression / JSON round-trip", () => {
  const sources = ['1 + 2 * 3 == 4 && !@flag || (5 - 1)', '"hi" ', "right", "@名前_1"];

  it.each(sources)("round-trips %j through JSON.stringify/JSON.parse", (source) => {
    const ast = parseOk(source);
    const roundTripped = JSON.parse(JSON.stringify(ast));
    expect(roundTripped).toEqual(ast);
  });
});

describe("parseScalarExpression / depth guard", () => {
  it("returns expression-depth-exceeded instead of crashing on deeply nested parentheses", () => {
    const source = "(".repeat(5000) + "1" + ")".repeat(5000);
    const result = parseScalarExpression(source, fullSpan(source));
    expect(result.ast).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("expression-depth-exceeded");
  });

  it("returns expression-depth-exceeded instead of crashing on a long unary chain", () => {
    const source = "!".repeat(5000) + "true";
    const result = parseScalarExpression(source, fullSpan(source));
    expect(result.ast).toBeNull();
    expect(result.diagnostics[0].code).toBe("expression-depth-exceeded");
  });

  it("parses successfully well under the depth limit", () => {
    const depth = MAX_SCALAR_EXPRESSION_DEPTH - 10;
    const source = "(".repeat(depth) + "1" + ")".repeat(depth);
    const result = parseScalarExpression(source, fullSpan(source));
    expect(result.diagnostics).toEqual([]);
    let node = result.ast;
    let count = 0;
    while (node && node.kind === "group") {
      count += 1;
      node = node.expression;
    }
    expect(count).toBe(depth);
  });
});
