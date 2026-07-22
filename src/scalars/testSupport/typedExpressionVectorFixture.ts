// Test-only decoder for the shared typed-expression vector fixture
// (test/fixtures/typed-expressions.json). Not part of the "shared vector"
// artifact itself - Task 18's Rust parity suite builds its own equivalent
// JSON -> Rust-struct decoder via Task 17's payload validator, independent
// of this file.

import type { BindingId } from "../bindingCatalog";
import type { ScalarBinaryOperator, ScalarUnaryOperator } from "../expressionAst";
import type { ScalarEvaluationEnvironment } from "../expressionEvaluator";
import { parseScalarEvaluationJson, parseScalarTypeJson } from "../scalarJson";
import type { TypedScalarExpression } from "../typedExpressionAst";
import type { ChoiceScalarType, ScalarEvaluation, ScalarType } from "../types";

const DUMMY_SPAN = { start: 0, end: 0 };

const decodeNullableScalarType = (json: unknown): ScalarType | null => (json === null ? null : parseScalarTypeJson(json));

const fail = (message: string): never => {
  throw new Error(`typedExpressionVectorFixture: ${message}`);
};

const isPlainObject = (json: unknown): json is Record<string, unknown> =>
  typeof json === "object" && json !== null && !Array.isArray(json);

/** Decodes a vector's JSON `ast` into a real TypedScalarExpression, filling
 * dummy spans (the evaluator never reads them). */
export const decodeTypedExpressionNode = (json: unknown): TypedScalarExpression => {
  if (!isPlainObject(json)) return fail("expression node must be a plain object");

  switch (json.kind) {
    case "numberLiteral":
      return {
        kind: "numberLiteral",
        span: DUMMY_SPAN,
        value: json.value as number,
        type: parseScalarTypeJson(json.type) as Extract<ScalarType, { kind: "number" }>
      };
    case "stringLiteral":
      return {
        kind: "stringLiteral",
        span: DUMMY_SPAN,
        value: json.value as string,
        type: parseScalarTypeJson(json.type) as Extract<ScalarType, { kind: "string" }>
      };
    case "booleanLiteral":
      return {
        kind: "booleanLiteral",
        span: DUMMY_SPAN,
        value: json.value as boolean,
        type: parseScalarTypeJson(json.type) as Extract<ScalarType, { kind: "boolean" }>
      };
    case "choiceLiteral":
      return {
        kind: "choiceLiteral",
        span: DUMMY_SPAN,
        value: json.value as string,
        type: decodeNullableScalarType(json.type) as ChoiceScalarType | null
      };
    case "reference":
      return {
        kind: "reference",
        span: DUMMY_SPAN,
        nameSpan: DUMMY_SPAN,
        name: json.name as string,
        bindingId: (json.bindingId as BindingId | null | undefined) ?? null,
        type: decodeNullableScalarType(json.type)
      };
    case "unary":
      return {
        kind: "unary",
        span: DUMMY_SPAN,
        operator: json.operator as ScalarUnaryOperator,
        operand: decodeTypedExpressionNode(json.operand),
        type: decodeNullableScalarType(json.type)
      };
    case "binary":
      return {
        kind: "binary",
        span: DUMMY_SPAN,
        operator: json.operator as ScalarBinaryOperator,
        left: decodeTypedExpressionNode(json.left),
        right: decodeTypedExpressionNode(json.right),
        type: decodeNullableScalarType(json.type)
      };
    case "group":
      return {
        kind: "group",
        span: DUMMY_SPAN,
        expression: decodeTypedExpressionNode(json.expression),
        type: decodeNullableScalarType(json.type)
      };
    default:
      return fail(`unknown expression node kind: ${String(json.kind)}`);
  }
};

export const decodeVectorBindings = (json: Record<string, unknown>): ReadonlyMap<BindingId, ScalarEvaluation> =>
  new Map(Object.entries(json).map(([id, value]) => [id, parseScalarEvaluationJson(value)]));

/** Builds a mock environment from a vector's decoded bindings. A binding ID
 * listed in `tripwireBindingIds` throws immediately if ever looked up - the
 * mechanical proof that a short-circuited branch is never evaluated. */
export const buildMockEnvironment = (
  bindings: ReadonlyMap<BindingId, ScalarEvaluation>,
  tripwireBindingIds: readonly BindingId[] = []
): ScalarEvaluationEnvironment => {
  const tripwires = new Set(tripwireBindingIds);
  return {
    lookupBinding: (bindingId: BindingId): ScalarEvaluation => {
      if (tripwires.has(bindingId)) {
        fail(`bindingId "${bindingId}" must not be looked up (short-circuit tripwire)`);
      }
      const result = bindings.get(bindingId);
      if (result === undefined) return fail(`no mock binding registered for "${bindingId}"`);
      return result;
    }
  };
};
