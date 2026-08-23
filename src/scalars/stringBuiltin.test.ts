import { describe, expect, it } from "vitest";
import { formatBuiltinFunctionSignatures, getBuiltinFunctionDefinition, isBuiltinFunctionName } from "./builtinFunctions";
import { evaluateTypedExpression } from "./expressionEvaluator";
import { parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import type { BindingId } from "./bindingCatalog";
import type { ScalarExpressionResolvedReference, TypedScalarExpression } from "./typedExpressionAst";
import type { ScalarEvaluation, ScalarType } from "./types";

const STRING_TYPE: ScalarType = { kind: "string" };
const choiceType = (options: readonly string[]): ScalarType => ({ kind: "choice", options });

const astFor = (source: string) => {
  const result = parseScalarExpression(source, { start: 0, end: source.length });
  if (!result.ast) throw new Error(`expected expression parse success: ${source}`);
  return result.ast;
};

const resolvedChoice = (bindingId: BindingId, type: ScalarType): ScalarExpressionResolvedReference => ({
  kind: "resolvedType",
  bindingId,
  type
});

const typedChoiceStringCall = (
  options: readonly string[],
  bindingId = "binding:choice" as BindingId
): TypedScalarExpression => {
  const type = choiceType(options);
  const result = typecheckScalarExpression(astFor("string(@value)"), {
    expectedType: STRING_TYPE,
    references: [resolvedChoice(bindingId, type)]
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.type).toEqual(STRING_TYPE);
  return result.typed;
};

describe("nui4 string(choice) builtin", () => {
  it("publishes registry-driven signature metadata", () => {
    const definition = getBuiltinFunctionDefinition("string");
    expect(definition).not.toBeNull();
    expect(isBuiltinFunctionName("string")).toBe(true);
    expect(formatBuiltinFunctionSignatures(definition!)).toBe("string(choice) -> string");
    expect(definition?.signatures).toEqual([{
      callingStyle: "positional",
      parameters: [{ type: { kind: "anyChoice" } }],
      returnType: STRING_TYPE
    }]);
  });

  it.each([
    [["right", "left"], "right"],
    [["front", "back"], "back"]
  ] as const)("accepts any concrete choice type and returns its canonical token", (options, selected) => {
    const bindingId = "binding:choice" as BindingId;
    const typed = typedChoiceStringCall(options, bindingId);
    const type = choiceType(options);
    const evaluation = evaluateTypedExpression(typed, {
      lookupBinding: (id): ScalarEvaluation => {
        expect(id).toBe(bindingId);
        return { status: "ok", type, value: { kind: "choice", value: selected, options } };
      }
    });

    expect(evaluation).toEqual({
      status: "ok",
      type: STRING_TYPE,
      value: { kind: "string", value: selected }
    });
  });

  it.each([
    ["string(12.5)", { kind: "number" }],
    ["string(true)", { kind: "boolean" }],
    ['string("front")', { kind: "string" }]
  ] as const)("rejects non-choice input: %s", (source, actualType) => {
    const result = typecheckScalarExpression(astFor(source), { expectedType: STRING_TYPE, references: [] });
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "scalar-type-mismatch", actualType })
    ]);
  });

  it("keeps a context-free bare choice literal unresolved", () => {
    const result = typecheckScalarExpression(astFor("string(right)"), { expectedType: STRING_TYPE, references: [] });
    expect(result.type).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "invalid-choice-literal" })
    ]);
  });

  it("propagates argument evaluation errors through the string result type", () => {
    const bindingId = "binding:choice" as BindingId;
    const typed = typedChoiceStringCall(["right", "left"], bindingId);
    const evaluation = evaluateTypedExpression(typed, {
      lookupBinding: () => ({
        status: "error",
        type: choiceType(["right", "left"]),
        issueCode: "poisoned-binding",
        bindingId
      })
    });

    expect(evaluation).toEqual({
      status: "error",
      type: STRING_TYPE,
      issueCode: "poisoned-binding",
      bindingId
    });
  });

  it("fails closed when a runtime binding does not match its static choice type", () => {
    const bindingId = "binding:choice" as BindingId;
    const typed = typedChoiceStringCall(["right", "left"], bindingId);
    const evaluation = evaluateTypedExpression(typed, {
      lookupBinding: () => ({
        status: "ok",
        type: STRING_TYPE,
        value: { kind: "string", value: "right" }
      })
    });

    expect(evaluation).toEqual({
      status: "error",
      type: STRING_TYPE,
      issueCode: "evaluation-runtime-value-type-mismatch",
      bindingId
    });
  });
});
