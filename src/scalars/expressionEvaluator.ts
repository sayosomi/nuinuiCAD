// Pure reference evaluator for Task 15's typed scalar expression AST
// (TypedScalarExpression). Consumes only the typed AST && a caller-injected
// environment - it never parses, tokenizes, resolves names, || typechecks.
// References resolve solely by the stable bindingId already attached to each
// reference node; scope, shadowing, declaration order, && binding
// eligibility are Tasks 11-13's finished, closed surface && are never
// reinterpreted here. Document declaration order, `set` versions, control
// flow, property wiring, && Rust are all out of scope - see
// docs/typed-variables/tasks/16-ts-expression-reference-evaluator.md.

import type { BindingId } from "./bindingCatalog";
import type {
  TypedScalarBinaryExpressionNode,
  TypedScalarExpression,
  TypedScalarReferenceNode,
  TypedScalarUnaryExpressionNode
} from "./typedExpressionAst";
import { scalarTypesEqual, scalarValueMatchesType, type ScalarEvaluation, type ScalarType, type ScalarValue } from "./types";

export interface ScalarEvaluationEnvironment {
  /**
   * Resolves a runtime value for an already-resolved binding ID. Called at
   * most once per reference node actually reached during evaluation - never
   * for a bindingId inside a short-circuited ` && ` / ` || ` branch. Its `ok`
   * result is defensively re-checked against the reference node's own static
   * type before use (see evaluateReference); its `error` result is
   * propagated verbatim, with no new issueCode minted for it.
   */
  lookupBinding(bindingId: BindingId): ScalarEvaluation;

  /** Document-bound property reads are already resolved to stable IDs. */
  lookupGeometryProperty?: (reference: Extract<TypedScalarExpression, { kind: "geometryProperty" }>) => ScalarEvaluation;

}

/**
 * Documented placeholder used only when a node's static `type` is null.
 * ScalarEvaluation.type is non-nullable (Task 08), so an honest "no static
 * type" cannot be represented in-band; this mirrors expressionTypecheck.ts's
 * existing "unknown -> number" default for the same reason. Consumers must
 * key off `issueCode === "evaluation-static-type-null"`, never off `.type`,
 * to detect this case.
 */
const STATIC_TYPE_NULL_PLACEHOLDER: ScalarType = { kind: "number" };

const staticTypeNullError = (bindingId?: BindingId): ScalarEvaluation =>
  bindingId !== undefined
    ? { status: "error", type: STATIC_TYPE_NULL_PLACEHOLDER, issueCode: "evaluation-static-type-null", bindingId }
    : { status: "error", type: STATIC_TYPE_NULL_PLACEHOLDER, issueCode: "evaluation-static-type-null" };

/** Numeric literals && external values are finite at their boundaries, but
 * arithmetic on otherwise-valid finite operands can overflow. Keep that
 * result out of both the scalar contract && JSON IPC. */
const finiteNumberResult = (type: ScalarType, value: number): ScalarEvaluation =>
  Number.isFinite(value)
    ? { status: "ok", type, value: { kind: "number", value } }
    : { status: "error", type, issueCode: "evaluation-non-finite-result" };

/** Re-stamps an already-produced error to `type`, keeping issueCode/bindingId verbatim. */
const propagateError = (type: ScalarType, source: Extract<ScalarEvaluation, { status: "error" }>): ScalarEvaluation =>
  source.bindingId !== undefined
    ? { status: "error", type, issueCode: source.issueCode, bindingId: source.bindingId }
    : { status: "error", type, issueCode: source.issueCode };

/**
 * These extraction helpers throw on a kind mismatch rather than returning a
 * ScalarEvaluation error: by the time a value reaches here it has already
 * passed either the reference trust-boundary check (evaluateReference) || is
 * a literal/computed value that is self-consistent with its own static type
 * by construction (guaranteed by Task 15's typecheck). A mismatch here would
 * be an invariant violation in this module, not an expected runtime failure.
 */
const numberValueOf = (value: ScalarValue): number => {
  if (value.kind !== "number") throw new Error(`expressionEvaluator: expected a number value, got "${value.kind}"`);
  return value.value;
};

const booleanValueOf = (value: ScalarValue): boolean => {
  if (value.kind !== "boolean") throw new Error(`expressionEvaluator: expected a boolean value, got "${value.kind}"`);
  return value.value;
};

/**
 * Choice equality checks both the value && the payload's choice-type
 * identity (options + order, D07) - two references can share a statically
 * checked-equal declared type while the environment (a trust boundary)
 * returns runtime values whose actual `options` diverge.
 */
const scalarValuesEqual = (a: ScalarValue, b: ScalarValue): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "choice" && b.kind === "choice") {
    return a.value === b.value && scalarTypesEqual({ kind: "choice", options: a.options }, { kind: "choice", options: b.options });
  }
  return a.value === b.value;
};

/**
 * The one real trust boundary in this module: a reference's value crosses
 * from the caller-supplied environment. Validated unconditionally here -
 * not deferred to whichever parent happens to consume it - so a bare
 * top-level reference, a reference under a no-op `group`, an operand of
 * unary/binary, && an equality operand are all covered by the same check.
 */
const evaluateReference = (node: TypedScalarReferenceNode, environment: ScalarEvaluationEnvironment): ScalarEvaluation => {
  const type = node.type;
  if (type === null || node.bindingId === null) {
    return staticTypeNullError(node.bindingId ?? undefined);
  }

  const result = environment.lookupBinding(node.bindingId);
  if (result.status === "error") return result;

  if (!scalarTypesEqual(type, result.type) || !scalarValueMatchesType(result.type, result.value)) {
    return { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch", bindingId: node.bindingId };
  }
  return result;
};

const evaluateGeometryProperty = (
  node: Extract<TypedScalarExpression, { kind: "geometryProperty" }>,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluation => {
  if (!node.elementId || node.targetSourceOrder === null || !environment.lookupGeometryProperty) {
    return { status: "error", type: node.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  const result = environment.lookupGeometryProperty(node);
  if (result.status === "error") return result;
  if (result.type.kind !== "number" || result.value.kind !== "number") {
    return { status: "error", type: node.type, issueCode: "evaluation-runtime-value-type-mismatch" };
  }
  return result;
};

const evaluateUnary = (node: TypedScalarUnaryExpressionNode, environment: ScalarEvaluationEnvironment): ScalarEvaluation => {
  const type = node.type;
  if (type === null) return staticTypeNullError();

  const operand = evaluateTypedExpression(node.operand, environment);
  if (operand.status === "error") return propagateError(type, operand);

  if (node.operator === "!") {
    return { status: "ok", type, value: { kind: "boolean", value: !booleanValueOf(operand.value) } };
  }
  const numeric = numberValueOf(operand.value);
  return { status: "ok", type, value: { kind: "number", value: node.operator === "-" ? -numeric : numeric } };
};

/** ` && `/` || `: the only short-circuiting operators. Left is always evaluated
 * first; right is evaluated only when it can still affect the result. */
const evaluateLogicalOperator = (
  operator: "&&" | "||",
  leftNode: TypedScalarExpression,
  rightNode: TypedScalarExpression,
  type: ScalarType,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluation => {
  const left = evaluateTypedExpression(leftNode, environment);
  if (left.status === "error") return propagateError(type, left);

  const leftValue = booleanValueOf(left.value);
  if (operator === "&&" && leftValue === false) return { status: "ok", type, value: { kind: "boolean", value: false } };
  if (operator === "||" && leftValue === true) return { status: "ok", type, value: { kind: "boolean", value: true } };

  const right = evaluateTypedExpression(rightNode, environment);
  if (right.status === "error") return propagateError(type, right);
  return { status: "ok", type, value: { kind: "boolean", value: booleanValueOf(right.value) } };
};

const evaluateEqualityOperator = (
  operator: "==" | "!=",
  leftNode: TypedScalarExpression,
  rightNode: TypedScalarExpression,
  type: ScalarType,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluation => {
  const left = evaluateTypedExpression(leftNode, environment);
  const right = evaluateTypedExpression(rightNode, environment);
  if (left.status === "error") return propagateError(type, left);
  if (right.status === "error") return propagateError(type, right);

  const equal = scalarValuesEqual(left.value, right.value);
  return { status: "ok", type, value: { kind: "boolean", value: operator === "==" ? equal : !equal } };
};

const evaluateArithmeticOrComparisonOperator = (
  operator: "+" | "-" | "*" | "/" | "<" | "<=" | ">" | ">=",
  leftNode: TypedScalarExpression,
  rightNode: TypedScalarExpression,
  type: ScalarType,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluation => {
  const left = evaluateTypedExpression(leftNode, environment);
  const right = evaluateTypedExpression(rightNode, environment);
  if (left.status === "error") return propagateError(type, left);
  if (right.status === "error") return propagateError(type, right);

  const leftNumber = numberValueOf(left.value);
  const rightNumber = numberValueOf(right.value);

  switch (operator) {
    case "+":
      return finiteNumberResult(type, leftNumber + rightNumber);
    case "-":
      return finiteNumberResult(type, leftNumber - rightNumber);
    case "*":
      return finiteNumberResult(type, leftNumber * rightNumber);
    case "/": {
      const quotient = leftNumber / rightNumber;
      if (rightNumber === 0) {
        return { status: "error", type, issueCode: "evaluation-divide-by-zero" };
      }
      return finiteNumberResult(type, quotient);
    }
    case "<":
      return { status: "ok", type, value: { kind: "boolean", value: leftNumber < rightNumber } };
    case "<=":
      return { status: "ok", type, value: { kind: "boolean", value: leftNumber <= rightNumber } };
    case ">":
      return { status: "ok", type, value: { kind: "boolean", value: leftNumber > rightNumber } };
    case ">=":
      return { status: "ok", type, value: { kind: "boolean", value: leftNumber >= rightNumber } };
  }
};

const evaluateBinary = (node: TypedScalarBinaryExpressionNode, environment: ScalarEvaluationEnvironment): ScalarEvaluation => {
  const type = node.type;
  if (type === null) return staticTypeNullError();

  if (node.operator === "&&" || node.operator === "||") {
    return evaluateLogicalOperator(node.operator, node.left, node.right, type, environment);
  }
  if (node.operator === "==" || node.operator === "!=") {
    return evaluateEqualityOperator(node.operator, node.left, node.right, type, environment);
  }
  return evaluateArithmeticOrComparisonOperator(node.operator, node.left, node.right, type, environment);
};

export const evaluateTypedExpression = (
  node: TypedScalarExpression,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluation => {
  switch (node.kind) {
    case "numberLiteral":
      return { status: "ok", type: node.type, value: { kind: "number", value: node.value } };
    case "stringLiteral":
      return { status: "ok", type: node.type, value: { kind: "string", value: node.value } };
    case "booleanLiteral":
      return { status: "ok", type: node.type, value: { kind: "boolean", value: node.value } };
    case "choiceLiteral": {
      const type = node.type;
      if (type === null) return staticTypeNullError();
      return { status: "ok", type, value: { kind: "choice", value: node.value, options: type.options } };
    }
    case "reference":
      return evaluateReference(node, environment);
    case "geometryProperty":
      return evaluateGeometryProperty(node, environment);
    case "unary":
      return evaluateUnary(node, environment);
    case "binary":
      return evaluateBinary(node, environment);
    case "group": {
      const type = node.type;
      if (type === null) return staticTypeNullError();
      return evaluateTypedExpression(node.expression, environment);
    }
  }
};
