// Pure reference evaluator for the typed scalar expression AST
// (TypedScalarExpression). Consumes only the typed AST && a caller-injected
// environment - it never parses, tokenizes, resolves names, || typechecks.
// References resolve solely by the stable bindingId already attached to each
// reference node; scope, shadowing, declaration order, && binding
// eligibility are established before evaluation and are never reinterpreted
// here. Document declaration order, `set` versions, control flow, property
// wiring, && Rust integration are owned by the surrounding document/runtime
// layers rather than this expression evaluator.

import type { BindingId } from "./bindingCatalog";
import type {
  TypedScalarBinaryExpressionNode,
  TypedScalarCallExpressionNode,
  TypedScalarExpression,
  TypedScalarReferenceNode,
  TypedScalarUnaryExpressionNode
} from "./typedExpressionAst";
import type { ScalarExpressionResolvedGeometryTarget, TypedBuiltinArgument } from "./typedExpressionAst";
import { evaluateBuiltinFunction } from "./builtinFunctionSemantics";
import { atan2Degrees360, radiansToDegrees } from "./angleMath";
import { scalarTypesEqual, scalarValueMatchesType, type ScalarEvaluation, type ScalarType, type ScalarValue } from "./types";
import type { ComputedGeometry, ComputedLine, ComputedPoint } from "../types/geometry";

export type GeometryBuiltinTargetLookupResult =
  | ComputedGeometry
  | { kind: "unavailable"; reason: "disabled" };

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

  /** Resolves an already-resolved geometry builtin target to runtime geometry. */
  lookupGeometryTarget?: (target: ScalarExpressionResolvedGeometryTarget) => GeometryBuiltinTargetLookupResult | undefined;

  /** Optional inspection hook. Called once after each expression node actually reached by production evaluation. */
  onExpressionEvaluated?: (node: TypedScalarExpression, evaluation: ScalarEvaluation) => void;

}

/**
 * Documented placeholder used only when a node's static `type` is null.
 * ScalarEvaluation.type is non-nullable, so an honest "no static
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

type GeometryBuiltinName = "distance" | "angle" | "lineDistance" | "lineAngle";

const isGeometryBuiltin = (name: string): name is GeometryBuiltinName =>
  name === "distance" || name === "angle" || name === "lineDistance" || name === "lineAngle";

const distanceBetweenPoints = (point1: ComputedPoint, point2: ComputedPoint): number =>
  Math.hypot(point2.x - point1.x, point2.y - point1.y);

const angleBetweenPoints = (point1: ComputedPoint, point2: ComputedPoint): number =>
  atan2Degrees360(point2.y - point1.y, point2.x - point1.x);

const distancePointToInfiniteLine = (point: ComputedPoint, line: ComputedLine): number | null => {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return null;
  return Math.abs(dx * (line.start.y - point.y) - (line.start.x - point.x) * dy) / length;
};

const geometryArgument = (
  argument: TypedBuiltinArgument,
  expectedGeometryType: "point" | "line",
  environment: ScalarEvaluationEnvironment
): GeometryBuiltinTargetLookupResult | undefined => {
  if (argument.kind !== "geometryReference" || argument.expectedGeometryType !== expectedGeometryType) return undefined;
  const target = argument.target;
  if (target === null || target.geometryType !== expectedGeometryType || !environment.lookupGeometryTarget) return undefined;
  const geometry = environment.lookupGeometryTarget(target);
  if (!geometry || geometry.kind === "unavailable") return geometry;
  if (expectedGeometryType === "point" && geometry.kind !== "point") return undefined;
  if (expectedGeometryType === "line" && geometry.kind !== "line") return undefined;
  return geometry;
};

/** Re-stamps an already-produced error to `type`, keeping issueCode/bindingId verbatim. */
const propagateError = (type: ScalarType, source: Extract<ScalarEvaluation, { status: "error" }>): ScalarEvaluation => ({
  status: "error",
  type,
  issueCode: source.issueCode,
  ...(source.bindingId !== undefined ? { bindingId: source.bindingId } : {}),
  ...(source.context !== undefined ? { context: source.context } : {})
});

/**
 * These extraction helpers throw on a kind mismatch rather than returning a
 * ScalarEvaluation error: by the time a value reaches here it has already
 * passed either the reference trust-boundary check (evaluateReference) || is
 * a literal/computed value that is self-consistent with its own static type
 * by construction (guaranteed by the typechecker). A mismatch here would
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
  operator: "+" | "-" | "*" | "/" | "%" | "^" | "<" | "<=" | ">" | ">=",
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
    case "^":
      return finiteNumberResult(type, Math.pow(leftNumber, rightNumber));
    case "/": {
      const quotient = leftNumber / rightNumber;
      if (rightNumber === 0) {
        return { status: "error", type, issueCode: "evaluation-divide-by-zero" };
      }
      return finiteNumberResult(type, quotient);
    }
    case "%":
      if (rightNumber === 0) return { status: "error", type, issueCode: "evaluation-remainder-by-zero" };
      return finiteNumberResult(type, leftNumber % rightNumber);
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

const evaluateGeometryBuiltin = (
  node: TypedScalarCallExpressionNode,
  environment: ScalarEvaluationEnvironment,
  name: GeometryBuiltinName
): ScalarEvaluation => {
  const type = node.type!;
  const expectedTypes: readonly ("point" | "line")[] = name === "lineDistance"
    ? ["point", "line"]
    : name === "lineAngle"
      ? ["line", "line"]
      : ["point", "point"];
  const argumentsByPosition: ComputedGeometry[] = [];
  for (const [index, argument] of node.args.entries()) {
    const geometry = geometryArgument(argument, expectedTypes[index]!, environment);
    if (geometry?.kind === "unavailable") {
      const target = argument.kind === "geometryReference" ? argument.target : null;
      return {
        status: "error",
        type,
        issueCode: "evaluation-geometry-builtin-disabled",
        ...(target
          ? {
              context: {
                kind: "geometryBuiltinTarget" as const,
                targetElementId: target.statementId,
                ...(target.pointKey !== undefined ? { pointKey: target.pointKey } : {})
              }
            }
          : {})
      };
    }
    if (!geometry) return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };
    argumentsByPosition.push(geometry);
  }
  if (argumentsByPosition.length !== expectedTypes.length) return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };

  const first = argumentsByPosition[0]!;
  const second = argumentsByPosition[1]!;
  if (name === "distance" || name === "angle") {
    if (first.kind !== "point" || second.kind !== "point") {
      return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };
    }
    return finiteNumberResult(type, name === "distance" ? distanceBetweenPoints(first, second) : angleBetweenPoints(first, second));
  }

  if (name === "lineAngle") {
    if (first.kind !== "line" || second.kind !== "line") {
      return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };
    }
    const firstDx = first.end.x - first.start.x;
    const firstDy = first.end.y - first.start.y;
    const secondDx = second.end.x - second.start.x;
    const secondDy = second.end.y - second.start.y;
    const firstLength = Math.hypot(firstDx, firstDy);
    const secondLength = Math.hypot(secondDx, secondDy);
    if (firstLength <= 1e-9 || secondLength <= 1e-9) {
      return { status: "error", type, issueCode: "evaluation-zero-length-line" };
    }
    const ratio = Math.abs(firstDx * secondDx + firstDy * secondDy) / (firstLength * secondLength);
    const angleRad = Math.acos(Math.min(1, Math.max(0, ratio)));
    return finiteNumberResult(type, radiansToDegrees(angleRad));
  }

  if (first.kind !== "point" || second.kind !== "line") {
    return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };
  }
  const result = distancePointToInfiniteLine(first, second);
  return result === null
    ? { status: "error", type, issueCode: "evaluation-zero-length-line" }
    : finiteNumberResult(type, result);
};

const builtinFunctionIssueCode = (reason: Exclude<ReturnType<typeof evaluateBuiltinFunction>, { status: "ok" }>['reason']): string => {
  switch (reason) {
    case "sqrt-negative-input": return "evaluation-sqrt-negative-input";
    case "round-to-non-positive-step": return "evaluation-round-to-non-positive-step";
    case "is-close-negative-tolerance": return "evaluation-is-close-negative-tolerance";
    case "tan-odd-multiple-of-90": return "evaluation-tan-odd-multiple-of-90";
    case "asin-out-of-range": return "evaluation-asin-out-of-range";
    case "acos-out-of-range": return "evaluation-acos-out-of-range";
    case "invalid-argument": return "evaluation-invalid-builtin-argument";
    case "non-finite-result": return "evaluation-non-finite-result";
  }
};

const evaluateCall = (node: TypedScalarCallExpressionNode, environment: ScalarEvaluationEnvironment): ScalarEvaluation => {
  const type = node.type;
  if (type === null || node.target === null) return staticTypeNullError();

  if (isGeometryBuiltin(node.target.name)) return evaluateGeometryBuiltin(node, environment, node.target.name);

  const args: number[] = [];
  for (const argumentNode of node.args) {
    if (argumentNode.kind === "geometryReference") {
      return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };
    }
    const argument = evaluateTypedExpression(argumentNode.expression, environment);
    if (argument.status === "error") return propagateError(type, argument);
    args.push(numberValueOf(argument.value));
  }

  const result = evaluateBuiltinFunction(node.target.name, args);
  if (result.status === "error") {
    return {
      status: "error",
      type,
      issueCode: builtinFunctionIssueCode(result.reason)
    };
  }
  if (typeof result.value === "boolean") {
    return { status: "ok", type, value: { kind: "boolean", value: result.value } };
  }
  return finiteNumberResult(type, result.value);
};

const evaluateTypedExpressionNode = (
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
    case "call":
      return evaluateCall(node, environment);
  }
};


export const evaluateTypedExpression = (
  node: TypedScalarExpression,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluation => {
  const evaluation = evaluateTypedExpressionNode(node, environment);
  environment.onExpressionEvaluated?.(node, evaluation);
  return evaluation;
};
