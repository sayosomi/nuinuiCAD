import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenizeScalarExpression, type ScalarExpressionToken } from "./expressionTokenizer";
import {
  classifyScalarExpressionPosition,
  expectedOperandType,
  scalarExpressionCompletionContextAt,
  scalarOperandWordEndingAt
} from "./scalarExpressionPositionClassifier";
import * as builtinFunctions from "../../packages/nui-language/src/scalars/builtinFunctions";
import type { BuiltinFunctionDefinition, BuiltinFunctionName } from "../../packages/nui-language/src/scalars/builtinFunctions";

const fullSpan = (source: string) => ({ start: 0, end: source.length });
const tokenizeOk = (source: string): readonly ScalarExpressionToken[] => {
  const result = tokenizeScalarExpression(source, fullSpan(source));
  if (result.error) throw new Error(`expected no tokenizer error, got ${JSON.stringify(result.error)}`);
  return result.tokens;
};

const namedDefinition = (name: string): BuiltinFunctionDefinition => ({
  name: name as BuiltinFunctionName,
  signatures: [{
    callingStyle: "named",
    parameters: [{ name: "first", type: { kind: "number" } }, { name: "second", type: { kind: "number" } }],
    returnType: { kind: "number" }
  }]
});

const withNamedDefinitions = () => {
  const original = builtinFunctions.getBuiltinFunctionDefinition;
  vi.spyOn(builtinFunctions, "getBuiltinFunctionDefinition").mockImplementation((name) =>
    name === "someFunction" || name === "innerFunction" ? namedDefinition(name) : original(name)
  );
};

afterEach(() => vi.restoreAllMocks());

describe("classifyScalarExpressionPosition", () => {
  it("classifies the empty/start position as operand with no preceding token", () => {
    expect(classifyScalarExpressionPosition([], 0)).toEqual({ kind: "operand", precedingToken: null });
  });

  it("classifies right after an operator as operand", () => {
    const tokens = tokenizeOk("1 + ");
    expect(classifyScalarExpressionPosition(tokens, 4)).toEqual({
      kind: "operand",
      precedingToken: { kind: "operator", value: "+", span: { start: 2, end: 3 } }
    });
  });

  it("classifies right after a left paren as operand", () => {
    const tokens = tokenizeOk("(");
    expect(classifyScalarExpressionPosition(tokens, 1)).toEqual({
      kind: "operand",
      precedingToken: { kind: "leftParen", span: { start: 0, end: 1 } }
    });
  });

  it("classifies right after a literal as operator", () => {
    const tokens = tokenizeOk("5");
    const result = classifyScalarExpressionPosition(tokens, 1);
    expect(result.kind).toBe("operator");
    expect(result.precedingToken).toEqual({ kind: "literal", literal: { kind: "number", span: { start: 0, end: 1 }, raw: "5", value: 5 } });
  });

  it("classifies right after a reference as operator", () => {
    const tokens = tokenizeOk("@foo");
    const result = classifyScalarExpressionPosition(tokens, 4);
    expect(result.kind).toBe("operator");
    expect(result.precedingToken).toEqual({ kind: "reference", name: "foo", nameSpan: { start: 1, end: 4 }, span: { start: 0, end: 4 } });
  });

  it("classifies right after a right paren as operator", () => {
    const tokens = tokenizeOk("(1)");
    const result = classifyScalarExpressionPosition(tokens, 3);
    expect(result.kind).toBe("operator");
    expect(result.precedingToken).toEqual({ kind: "rightParen", span: { start: 2, end: 3 } });
  });

  it("never inspects token semantics beyond kind - it does not resolve any type", () => {
    // Type-level check only: the classifier's return type carries no `type`/`ScalarType` field at all.
    const result = classifyScalarExpressionPosition(tokenizeOk("5"), 1);
    expect(result).not.toHaveProperty("type");
  });

  it("treats a position strictly inside a token as not-yet-preceded by it", () => {
    const tokens = tokenizeOk("55");
    // pos=1 is inside the "55" literal token (span 0..2), so it is not "after" it.
    expect(classifyScalarExpressionPosition(tokens, 1)).toEqual({ kind: "operand", precedingToken: null });
  });
});

const opToken = (value: ScalarExpressionToken & { kind: "operator" }) => value;

describe("expectedOperandType", () => {
  it("no preceding token / left paren: falls back to root type", () => {
    expect(expectedOperandType(null, { kind: "number" })).toEqual({ kind: "number" });
    expect(expectedOperandType({ kind: "leftParen", span: { start: 0, end: 1 } }, { kind: "boolean" })).toEqual({ kind: "boolean" });
  });

  it(" and ,  or , ! require a boolean operand", () => {
    for (const value of ["&&", "||", "!"] as const) {
      expect(expectedOperandType(opToken({ kind: "operator", value, span: { start: 0, end: 1 } }), { kind: "number" })).toEqual({ kind: "boolean" });
    }
  });

  it("arithmetic/comparison operators require a number operand", () => {
    for (const value of ["+", "-", "*", "/", "%", "^", "<", "<=", ">", ">="] as const) {
      expect(expectedOperandType(opToken({ kind: "operator", value, span: { start: 0, end: 1 } }), { kind: "boolean" })).toEqual({ kind: "number" });
    }
  });

  it("==, != fall back to root type (documented equality approximation)", () => {
    for (const value of ["==", "!="] as const) {
      expect(expectedOperandType(opToken({ kind: "operator", value, span: { start: 0, end: 2 } }), { kind: "string" })).toEqual({ kind: "string" });
    }
  });

  it("literal/reference/rightParen can never precede another operand: null", () => {
    expect(expectedOperandType({ kind: "literal", literal: { kind: "number", span: { start: 0, end: 1 }, raw: "1", value: 1 } }, { kind: "number" })).toBeNull();
    expect(expectedOperandType({ kind: "rightParen", span: { start: 0, end: 1 } }, { kind: "number" })).toBeNull();
  });
});

describe("scalarOperandWordEndingAt", () => {
  it("matches an empty in-progress reference right after @", () => {
    expect(scalarOperandWordEndingAt("@", 1, 0)).toEqual({ from: 0, to: 1, kind: "reference" });
  });
  it("matches a partial in-progress reference", () => {
    expect(scalarOperandWordEndingAt("@fo", 3, 0)).toEqual({ from: 0, to: 3, kind: "reference" });
  });
  it("matches a reference following an operator with no space", () => {
    expect(scalarOperandWordEndingAt("1+@fo", 5, 0)).toEqual({ from: 2, to: 5, kind: "reference" });
  });
  it("matches a bare in-progress identifier (never mistaken for the reference form)", () => {
    expect(scalarOperandWordEndingAt("tr", 2, 0)).toEqual({ from: 0, to: 2, kind: "bareWord" });
  });
  it("prefers the reference match over the trailing bare-word match for a completed @name", () => {
    expect(scalarOperandWordEndingAt("@existingName", 13, 0)).toEqual({ from: 0, to: 13, kind: "reference" });
  });
  it("returns null right after a completed token with no partial word pending", () => {
    expect(scalarOperandWordEndingAt("1 + ", 4, 0)).toBeNull();
  });
});

describe("scalarExpressionCompletionContextAt", () => {
  const rootType = { kind: "boolean" as const };

  it("empty span: operand position, no word in progress", () => {
    const span = { start: 0, end: 0 };
    expect(scalarExpressionCompletionContextAt("", 0, span, rootType)).toEqual({
      kind: "operand",
      from: 0,
      to: 0,
      referenceOnly: false,
      literalOnly: false,
      expectedType: rootType
    });
  });

  it("in-progress reference: operand position scoped to the @partial span", () => {
    const text = "@fo";
    const span = { start: 0, end: text.length };
    const context = scalarExpressionCompletionContextAt(text, 3, span, rootType);
    expect(context).toEqual({ kind: "operand", from: 0, to: 3, referenceOnly: true, literalOnly: false, expectedType: rootType });
  });

  it("in-progress bare word: operand position, literalOnly", () => {
    const text = "tr";
    const span = { start: 0, end: text.length };
    const context = scalarExpressionCompletionContextAt(text, 2, span, rootType);
    expect(context).toEqual({ kind: "operand", from: 0, to: 2, referenceOnly: false, literalOnly: true, expectedType: rootType });
  });

  it("uses builtin argument types inside a call instead of the root result type", () => {
    const text = "isClose(1, ";
    const span = { start: 0, end: text.length };
    expect(scalarExpressionCompletionContextAt(text, text.length, span, rootType)).toMatchObject({
      kind: "operand",
      expectedType: { kind: "number" }
    });
  });

  it("returns parameter-name context for a named-only call", () => {
    withNamedDefinitions();
    const text = "someFunction(\n  fi";
    const context = scalarExpressionCompletionContextAt(text, text.length, { start: 0, end: text.length }, { kind: "number" });
    expect(context).toEqual({ kind: "argumentName", from: text.length - 2, to: text.length, names: ["first", "second"] });
  });

  it("filters already-used named parameters", () => {
    withNamedDefinitions();
    const text = "someFunction(first: 1,\n  ";
    const context = scalarExpressionCompletionContextAt(text, text.length, { start: 0, end: text.length }, { kind: "number" });
    expect(context).toEqual({ kind: "argumentName", from: text.length, to: text.length, names: ["second"] });
  });

  it("uses a named parameter type after its colon", () => {
    withNamedDefinitions();
    const text = "someFunction(first: ";
    expect(scalarExpressionCompletionContextAt(text, text.length, { start: 0, end: text.length }, { kind: "boolean" })).toMatchObject({
      kind: "operand",
      expectedType: { kind: "number" }
    });
  });

  it("keeps value completion after a named colon and uses the innermost call", () => {
    withNamedDefinitions();
    const text = "someFunction(first: innerFunction(second: @va";
    const context = scalarExpressionCompletionContextAt(text, text.length, { start: 0, end: text.length }, { kind: "boolean" });
    expect(context).toMatchObject({ kind: "operand", referenceOnly: true, expectedType: { kind: "number" } });
  });

  it("counts only direct commas for the outer builtin argument index", () => {
    const text = "isClose(round(1, 2), round(3, 4), ";
    const span = { start: 0, end: text.length };
    expect(scalarExpressionCompletionContextAt(text, text.length, span, rootType)).toMatchObject({
      kind: "operand",
      expectedType: { kind: "number" }
    });
  });

  it("ignores commas inside nested grouping when finding the outer argument index", () => {
    const text = "isClose((1, 2), ";
    const span = { start: 0, end: text.length };
    expect(scalarExpressionCompletionContextAt(text, text.length, span, rootType)).toMatchObject({
      kind: "operand",
      expectedType: { kind: "number" }
    });
  });

  it("uses the nested builtin argument type while the nested call is in progress", () => {
    const text = "isClose(round(1, ";
    const span = { start: 0, end: text.length };
    expect(scalarExpressionCompletionContextAt(text, text.length, span, rootType)).toMatchObject({
      kind: "operand",
      expectedType: { kind: "number" }
    });
  });

  it("keeps the outer builtin argument type after a nested call", () => {
    const text = "isClose(roundTo(1, 0.5), ";
    const span = { start: 0, end: text.length };
    expect(scalarExpressionCompletionContextAt(text, text.length, span, rootType)).toMatchObject({
      kind: "operand",
      expectedType: { kind: "number" }
    });
  });

  it("right after a completed reference followed by a space: operator position", () => {
    // Note "@flag" with the cursor immediately at its end (no trailing space) is
    // itself an in-progress reference word (still replaceable) - see
    // scalarOperandWordEndingAt's own "prefers the reference match ... for a
    // completed @name" case above. Operator position only emerges once a real
    // boundary (here, a space) separates the reference from the cursor.
    const text = "@flag ";
    const span = { start: 0, end: text.length };
    const context = scalarExpressionCompletionContextAt(text, 6, span, rootType);
    expect(context).toEqual({
      kind: "operator",
      from: 6,
      to: 6,
      precedingToken: { kind: "reference", name: "flag", nameSpan: { start: 1, end: 5 }, span: { start: 0, end: 5 } },
      rootType
    });
  });

  it("a bare word typed where an operator is grammatically expected yields no completion", () => {
    const text = "5 tr";
    const span = { start: 0, end: text.length };
    expect(scalarExpressionCompletionContextAt(text, 4, span, rootType)).toBeNull();
  });

  it("an earlier tokenizer error before the effective position yields no completion", () => {
    // "&" alone is not a valid one-char operator in this grammar (only " and " is), so
    // tokenizing up to the space before it fails.
    const text = "1 & true";
    const span = { start: 0, end: text.length };
    expect(scalarExpressionCompletionContextAt(text, 4, span, rootType)).toBeNull();
  });
});
