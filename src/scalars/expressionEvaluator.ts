// Pure reference evaluator for the typed scalar expression AST
// (TypedScalarExpression). Consumes only the typed AST && a caller-injected
// environment - it never parses, tokenizes, resolves names, || typechecks.
// References resolve solely by the stable bindingId already attached to each
// reference node; scope, shadowing, declaration order, && binding
// eligibility are established before evaluation and are never reinterpreted
// here. Document declaration order, immutable carry state, control flow, property
// wiring, && Rust integration are owned by the surrounding document/runtime
// layers rather than this expression evaluator.

import type { BindingId } from "@nuinuicad/nui-language";
import type {
  TypedScalarBinaryExpressionNode,
  TypedScalarCallExpressionNode,
  TypedScalarExpression,
  TypedScalarReferenceNode,
  TypedScalarUnaryExpressionNode
} from "@nuinuicad/nui-language";
import type { ScalarExpressionResolvedGeometryTarget, ScalarExpressionResolvedOptionalMemberTarget, TypedBuiltinArgument } from "@nuinuicad/nui-language";
import { evaluateBuiltinFunction } from "@nuinuicad/nui-language";
import { atan2Degrees360 } from "@nuinuicad/nui-language";
import { scalarTypesEqual, scalarValueMatchesType, type ScalarEvaluation, type ScalarExpressionType, type ScalarType, type ScalarValue } from "@nuinuicad/nui-language";
import { isScalarExpressionTypeAssignable, scalarExpressionTypesEqual } from "@nuinuicad/nui-language";
import { isDslOptionalValueType } from "@nuinuicad/nui-language";
import type { ComputedGeometry } from "../types/geometry";
import type { ComputedGeometryValue } from "../geometry/evaluationTypes";
import { computedReferencePathValue } from "../geometry/numericExpressionsRuntime";

export type GeometryBuiltinTargetLookupResult =
  | ComputedGeometry
  | ComputedGeometryValue
  | { kind: "unavailable"; reason: "disabled" };

export type GeometryCollectionEndpointLookupResult =
  | { kind: "resolved"; target: ScalarExpressionResolvedGeometryTarget }
  | { kind: "error"; issueCode: "evaluation-collection-index-invalid" | "evaluation-collection-index-unavailable" };

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

  /** Selects a runtime member of a compiler-resolved geometry collection. */
  lookupGeometryCollectionEndpoint?: (
    target: Extract<ScalarExpressionResolvedGeometryTarget, { kind: "geometryCollectionIndex" }>,
    index: number
  ) => GeometryCollectionEndpointLookupResult;

  /** Resolves one already-typed collection member after its numeric index. */
  lookupCollectionIndex?: (
    collectionValueId: string,
    index: number,
    elementType: ScalarExpressionType,
    collectionLength: number | null,
    targetSourceOrder: number
  ) => ScalarEvaluation;

  /** Resolves the selected cardinality of a runtime-dependent collection. */
  lookupCollectionLength?: (collectionValueId: string) => number | undefined;

  /** Error-capable collection cardinality lookup used by typed scalar evaluation. */
  lookupCollectionLengthEvaluation?: (
    collectionValueId: string
  ) => number | Extract<ScalarEvaluation, { status: "error" }> | undefined;

  /** Resolves a compiler-resolved general optional member. The callback owns
   * the receiver-family runtime adapter and must return the lifted result. */
  lookupOptionalMember?: (
    target: ScalarExpressionResolvedOptionalMemberTarget,
    type: ScalarExpressionType
  ) => ScalarEvaluation;

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

type GeometryPointLike = { x: number; y: number };
type GeometryLineLike = { kind: "line"; start: GeometryPointLike; end: GeometryPointLike };

const distanceBetweenPoints = (point1: GeometryPointLike, point2: GeometryPointLike): number =>
  Math.hypot(point2.x - point1.x, point2.y - point1.y);

const angleBetweenPoints = (point1: GeometryPointLike, point2: GeometryPointLike): number =>
  atan2Degrees360(point2.y - point1.y, point2.x - point1.x);

const distancePointToInfiniteLine = (point: GeometryPointLike, line: GeometryLineLike): number | null => {
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
const propagateError = (type: ScalarExpressionType, source: Extract<ScalarEvaluation, { status: "error" }>): ScalarEvaluation => ({
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
  if (a.kind === "none") return true;
  if (a.kind === "choice" && b.kind === "choice") {
    return a.value === b.value && scalarTypesEqual({ kind: "choice", options: a.options }, { kind: "choice", options: b.options });
  }
  if (a.kind === "number" && b.kind === "number") return a.value === b.value;
  if (a.kind === "string" && b.kind === "string") return a.value === b.value;
  if (a.kind === "boolean" && b.kind === "boolean") return a.value === b.value;
  return false;
};

/**
 * The one real trust boundary in this module: a reference's value crosses
 * from the caller-supplied environment. Validated unconditionally here -
 * not deferred to whichever parent happens to consume it - so a bare
 * top-level reference, a reference under a no-op `group`, an operand of
 * unary/binary, && an equality operand are all covered by the same check.
 */
function* evaluateReference(node: TypedScalarReferenceNode, environment: ScalarEvaluationEnvironment): ScalarEvaluationSteps {
  const type = node.type;
  if (type === null || node.bindingId === null) {
    return staticTypeNullError(node.bindingId ?? undefined);
  }

  const bindingId = node.bindingId;
  const result = yield* readBindingDependency(() => environment.lookupBinding(bindingId));
  if (result.status === "error") return result;

  if (!scalarExpressionTypesEqual(type, result.type) || !scalarValueMatchesType(result.type, result.value)) {
    return { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch", bindingId: node.bindingId };
  }
  return result;
}

function* evaluateGeometryProperty(
  node: Extract<TypedScalarExpression, { kind: "geometryProperty" }>,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  if (node.type === null) return staticTypeNullError();
  if (isDslOptionalValueType(node.type)) return { status: "error", type: node.type, issueCode: "evaluation-geometry-property-unavailable" };
  if (node.collectionValueId !== undefined) {
    const resolvedLength = yield* readBindingDependency(() => node.collectionLength ??
      environment.lookupCollectionLengthEvaluation?.(node.collectionValueId!) ??
      environment.lookupCollectionLength?.(node.collectionValueId!));
    if (typeof resolvedLength === "object") return propagateError(node.type, resolvedLength);
    const length = resolvedLength;
    if (length === undefined) {
      return { status: "error", type: node.type, issueCode: "evaluation-geometry-property-unavailable" };
    }
    if (node.type.kind !== "number" || !Number.isInteger(length) || length < 0) {
      return { status: "error", type: node.type, issueCode: "evaluation-geometry-property-unavailable" };
    }
    return { status: "ok", type: node.type, value: { kind: "number", value: length } };
  }
  if (node.type.kind !== "number" && node.type.kind !== "choice") {
    return { status: "error", type: node.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  if ((!node.elementId && !node.geometryValueOccurrence && !node.geometryValueBinderId && !node.forGroupOccurrenceTemplateElementId && !node.geometryCarryBindingId) || node.targetSourceOrder === null || !environment.lookupGeometryProperty) {
    return { status: "error", type: node.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  const result = yield* readBindingDependency(() => environment.lookupGeometryProperty!(node));
  if (result.status === "error") return result;
  if (!scalarExpressionTypesEqual(node.type, result.type) || !scalarValueMatchesType(result.type, result.value)) {
    return { status: "error", type: node.type, issueCode: "evaluation-runtime-value-type-mismatch" };
  }
  return result;
}

function* evaluateOptionalMember(
  node: Extract<TypedScalarExpression, { kind: "optionalMember" }>,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  if (node.type === null || !node.target || !environment.lookupOptionalMember) return staticTypeNullError();
  const result = yield* readBindingDependency(() => environment.lookupOptionalMember!(node.target!, node.type!));
  if (result.status === "error") return result;
  return scalarExpressionTypesEqual(result.type, node.type) && scalarValueMatchesType(node.type, result.value)
    ? result
    : { status: "error", type: node.type, issueCode: "evaluation-runtime-value-type-mismatch" };
}

function* evaluateCollectionIndex(
  node: Extract<TypedScalarExpression, { kind: "collectionIndex" }>,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  if (node.type === null || node.collectionValueId === null || node.targetSourceOrder === null) return staticTypeNullError();
  const index = yield* evaluateTypedExpressionSteps(node.index, environment);
  if (index.status === "error") return propagateError(node.type, index);
  if (
    index.value.kind !== "number" ||
    !Number.isFinite(index.value.value) ||
    !Number.isInteger(index.value.value) ||
    index.value.value < 0 ||
    (node.collectionLength !== null && index.value.value >= node.collectionLength)
  ) {
    return { status: "error", type: node.type, issueCode: "evaluation-collection-index-invalid" };
  }
  if (!environment.lookupCollectionIndex) return { status: "error", type: node.type, issueCode: "evaluation-collection-index-unavailable" };
  const collectionValueId = node.collectionValueId;
  const indexValue = index.value.value;
  const elementType = node.type;
  const result = yield* readBindingDependency(() => environment.lookupCollectionIndex!(
    collectionValueId,
    indexValue,
    elementType,
    node.collectionLength,
    node.targetSourceOrder!
  ));
  if (result.status === "error") return result;
  return scalarExpressionTypesEqual(node.type, result.type) && scalarValueMatchesType(result.type, result.value)
    ? result
    : { status: "error", type: node.type, issueCode: "evaluation-runtime-value-type-mismatch" };
}

function* evaluateUnary(node: TypedScalarUnaryExpressionNode, environment: ScalarEvaluationEnvironment): ScalarEvaluationSteps {
  const type = node.type;
  if (type === null) return staticTypeNullError();

  const operand = yield* evaluateTypedExpressionSteps(node.operand, environment);
  if (operand.status === "error") return propagateError(type, operand);

  if (node.operator === "!") {
    return { status: "ok", type, value: { kind: "boolean", value: !booleanValueOf(operand.value) } };
  }
  const numeric = numberValueOf(operand.value);
  return { status: "ok", type, value: { kind: "number", value: node.operator === "-" ? -numeric : numeric } };
}

/** ` && `/` || `: the only short-circuiting operators. Left is always evaluated
 * first; right is evaluated only when it can still affect the result. */
function* evaluateLogicalOperator(
  operator: "&&" | "||",
  leftNode: TypedScalarExpression,
  rightNode: TypedScalarExpression,
  type: ScalarType,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  const left = yield* evaluateTypedExpressionSteps(leftNode, environment);
  if (left.status === "error") return propagateError(type, left);

  const leftValue = booleanValueOf(left.value);
  if (operator === "&&" && leftValue === false) return { status: "ok", type, value: { kind: "boolean", value: false } };
  if (operator === "||" && leftValue === true) return { status: "ok", type, value: { kind: "boolean", value: true } };

  const right = yield* evaluateTypedExpressionSteps(rightNode, environment);
  if (right.status === "error") return propagateError(type, right);
  return { status: "ok", type, value: { kind: "boolean", value: booleanValueOf(right.value) } };
}

function* evaluateEqualityOperator(
  operator: "==" | "!=",
  leftNode: TypedScalarExpression,
  rightNode: TypedScalarExpression,
  type: ScalarType,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  const left = yield* evaluateTypedExpressionSteps(leftNode, environment);
  const right = yield* evaluateTypedExpressionSteps(rightNode, environment);
  if (left.status === "error") return propagateError(type, left);
  if (right.status === "error") return propagateError(type, right);

  const equal = scalarValuesEqual(left.value, right.value);
  return { status: "ok", type, value: { kind: "boolean", value: operator === "==" ? equal : !equal } };
}

function* evaluateCoalesceOperator(
  node: TypedScalarBinaryExpressionNode,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  const type = node.type;
  if (type === null || isDslOptionalValueType(type)) return staticTypeNullError();
  const left = yield* evaluateTypedExpressionSteps(node.left, environment);
  if (left.status === "error") return propagateError(type, left);
  const optionalType = { kind: "optional", valueType: type } as const;
  if (!scalarExpressionTypesEqual(left.type, optionalType) || !scalarValueMatchesType(optionalType, left.value)) {
    return { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
  }
  if (left.value.kind !== "none") {
    return { status: "ok", type, value: left.value };
  }
  const right = yield* evaluateTypedExpressionSteps(node.right, environment);
  if (right.status === "error") return propagateError(type, right);
  if (!scalarExpressionTypesEqual(type, right.type) || !scalarValueMatchesType(type, right.value)) {
    return { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
  }
  return right;
}

function* evaluateArithmeticOrComparisonOperator(
  operator: "+" | "-" | "*" | "/" | "%" | "^" | "<" | "<=" | ">" | ">=",
  leftNode: TypedScalarExpression,
  rightNode: TypedScalarExpression,
  type: ScalarType,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  const left = yield* evaluateTypedExpressionSteps(leftNode, environment);
  const right = yield* evaluateTypedExpressionSteps(rightNode, environment);
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
}

function* evaluateBinary(node: TypedScalarBinaryExpressionNode, environment: ScalarEvaluationEnvironment): ScalarEvaluationSteps {
  const type = node.type;
  if (type === null) return staticTypeNullError();
  if (isDslOptionalValueType(type)) return staticTypeNullError();

  if (node.operator === "&&" || node.operator === "||") {
    return yield* evaluateLogicalOperator(node.operator, node.left, node.right, type, environment);
  }
  if (node.operator === "==" || node.operator === "!=") {
    return yield* evaluateEqualityOperator(node.operator, node.left, node.right, type, environment);
  }
  if (node.operator === "??") return yield* evaluateCoalesceOperator(node, environment);
  return yield* evaluateArithmeticOrComparisonOperator(node.operator, node.left, node.right, type, environment);
}

function* evaluateGeometryBuiltin(
  node: TypedScalarCallExpressionNode,
  environment: ScalarEvaluationEnvironment,
  name: GeometryBuiltinName
): ScalarEvaluationSteps {
  const type = node.type;
  if (type === null || isDslOptionalValueType(type)) return staticTypeNullError();
  if (name === "lineAngle") {
    const tangentAngles: number[] = [];
    for (const argument of node.args) {
      if (argument.kind !== "geometryEndpoint" || argument.target === null || argument.target.geometryType !== "path") {
        return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };
      }
      let target = argument.target;
      if (target.kind === "geometryCollectionIndex") {
        if (!target.index) return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };
        const indexResult = yield* evaluateTypedExpressionSteps(target.index, environment);
        if (indexResult.status === "error") return propagateError(type, indexResult);
        if (indexResult.value.kind !== "number") {
          return { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
        }
        const index = indexResult.value.value;
        if (!Number.isFinite(index) || !Number.isInteger(index) || index < 0) {
          return { status: "error", type, issueCode: "evaluation-collection-index-invalid" };
        }
        const selected = (yield* readBindingDependency(() => environment.lookupGeometryCollectionEndpoint?.(target as Extract<ScalarExpressionResolvedGeometryTarget, { kind: "geometryCollectionIndex" }>, index))) ?? {
          kind: "error" as const,
          issueCode: "evaluation-collection-index-unavailable" as const
        };
        if (selected.kind === "error") return { status: "error", type, issueCode: selected.issueCode };
        target = selected.target;
      }
      const geometry = yield* readBindingDependency(() => environment.lookupGeometryTarget?.(target));
      if (geometry?.kind === "unavailable") {
        return {
          status: "error",
          type,
          issueCode: "evaluation-geometry-builtin-disabled",
          context: {
            kind: "geometryBuiltinTarget",
            targetElementId: target.kind === "forGroupOccurrence" ? target.templateElementId : target.statementId
          }
        };
      }
      if (!geometry) return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };
      const angle = computedReferencePathValue(
        geometry,
        argument.endpointKey === "start" ? "startAngleDeg" : "endAngleDeg"
      );
      if (typeof angle !== "number" || !Number.isFinite(angle)) {
        return { status: "error", type, issueCode: "evaluation-geometry-endpoint-tangent-unavailable" };
      }
      tangentAngles.push(angle);
    }
    if (tangentAngles.length !== 2) return { status: "error", type, issueCode: "evaluation-invalid-builtin-argument" };
    const axisDelta = Math.abs(tangentAngles[0]! - tangentAngles[1]!) % 180;
    return finiteNumberResult(type, Math.min(axisDelta, 180 - axisDelta));
  }

  const expectedTypes: readonly ("point" | "line")[] = name === "lineDistance"
    ? ["point", "line"]
    : ["point", "point"];
  const argumentsByPosition: (ComputedGeometry | ComputedGeometryValue)[] = [];
  for (const [index, argument] of node.args.entries()) {
    const geometry = yield* readBindingDependency(() => geometryArgument(argument, expectedTypes[index]!, environment));
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
                targetElementId: target.kind === "forGroupOccurrence" ? target.templateElementId : target.statementId,
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

  if (first.kind !== "point" || second.kind !== "line") {
    return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };
  }
  const result = distancePointToInfiniteLine(first, second);
  return result === null
    ? { status: "error", type, issueCode: "evaluation-zero-length-line" }
    : finiteNumberResult(type, result);
}

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

function* evaluateStringBuiltin(
  node: TypedScalarCallExpressionNode,
  environment: ScalarEvaluationEnvironment,
  type: ScalarType
): ScalarEvaluationSteps {
  if (node.args.length !== 1 || node.args[0]?.kind !== "scalar") {
    return { status: "error", type, issueCode: "evaluation-invalid-builtin-argument" };
  }
  const argument = yield* evaluateTypedExpressionSteps(node.args[0].expression, environment);
  if (argument.status === "error") return propagateError(type, argument);
  if (argument.value.kind !== "choice") {
    return { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
  }
  return { status: "ok", type, value: { kind: "string", value: argument.value.value } };
}

function* evaluateCall(node: TypedScalarCallExpressionNode, environment: ScalarEvaluationEnvironment): ScalarEvaluationSteps {
  const type = node.type;
  if (type === null || node.target === null) return staticTypeNullError();
  if (isDslOptionalValueType(type)) return staticTypeNullError();

  if (isGeometryBuiltin(node.target.name)) return yield* evaluateGeometryBuiltin(node, environment, node.target.name);
  if (node.target.name === "string") return yield* evaluateStringBuiltin(node, environment, type);

  const args: number[] = [];
  for (const argumentNode of node.args) {
    if (argumentNode.kind === "geometryReference" || argumentNode.kind === "geometryEndpoint") {
      return { status: "error", type, issueCode: "evaluation-geometry-builtin-unavailable" };
    }
    const argument = yield* evaluateTypedExpressionSteps(argumentNode.expression, environment);
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
}

function* evaluateValueIf(
  node: Extract<TypedScalarExpression, { kind: "valueIf" }>,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  const type = node.type;
  if (type === null) return staticTypeNullError();
  const condition = yield* evaluateTypedExpressionSteps(node.condition, environment);
  if (condition.status === "error") return propagateError(type, condition);
  if (condition.type.kind !== "boolean" || condition.value.kind !== "boolean") {
    return { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
  }
  const selected = yield* evaluateTypedExpressionSteps(condition.value.value ? node.thenBranch : node.elseBranch, environment);
  if (selected.status === "error") return propagateError(type, selected);
  return isScalarExpressionTypeAssignable(selected.type, type) && scalarValueMatchesType(type, selected.value)
    ? { ...selected, type }
    : { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
}

function* evaluateValueMatch(
  node: Extract<TypedScalarExpression, { kind: "valueMatch" }>,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  const type = node.type;
  if (type === null) return staticTypeNullError();
  const scrutineeType = node.scrutinee.type;
  if (scrutineeType === null || (scrutineeType.kind !== "choice" && scrutineeType.kind !== "optional")) {
    return { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
  }
  const scrutinee = yield* evaluateTypedExpressionSteps(node.scrutinee, environment);
  if (scrutinee.status === "error") return propagateError(type, scrutinee);
  if (
    !scalarExpressionTypesEqual(scrutineeType, scrutinee.type) ||
    !scalarValueMatchesType(scrutineeType, scrutinee.value)
  ) {
    return { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
  }
  const scrutineeValue = scrutinee.value;
  const selected = scrutineeType.kind === "optional"
    ? node.arms.find((arm) => arm.label === (scrutineeValue.kind === "none" ? "none" : "some"))
    : scrutineeValue.kind === "choice" ? node.arms.find((arm) => arm.label === scrutineeValue.value) : undefined;
  if (!selected) return { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
  const selectedEnvironment = scrutineeType.kind === "optional" && selected.label === "some" && selected.binderId && selected.binderType && scrutineeValue.kind !== "none"
    ? {
        ...environment,
        lookupBinding: (bindingId: string): ScalarEvaluation => bindingId === selected.binderId
          ? { status: "ok", type: selected.binderType!, value: scrutineeValue }
          : environment.lookupBinding(bindingId)
      }
    : environment;
  const result = yield* evaluateTypedExpressionSteps(selected.expression, selectedEnvironment);
  if (result.status === "error") return propagateError(type, result);
  return isScalarExpressionTypeAssignable(result.type, type) && scalarValueMatchesType(type, result.value)
    ? { ...result, type }
    : { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
}

function* evaluateTypedExpressionNode(
  node: TypedScalarExpression,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  switch (node.kind) {
    case "numberLiteral":
      return { status: "ok", type: node.type, value: { kind: "number", value: node.value } };
    case "stringLiteral":
      return { status: "ok", type: node.type, value: { kind: "string", value: node.value } };
    case "booleanLiteral":
      return { status: "ok", type: node.type, value: { kind: "boolean", value: node.value } };
    case "noneLiteral":
      if (node.type === null) return staticTypeNullError();
      return { status: "ok", type: node.type, value: { kind: "none" } };
    case "choiceLiteral": {
      const type = node.type;
      if (type === null) return staticTypeNullError();
      return { status: "ok", type, value: { kind: "choice", value: node.value, options: type.options } };
    }
    case "reference":
      return yield* evaluateReference(node, environment);
    case "collectionIndex":
      return yield* evaluateCollectionIndex(node, environment);
    case "geometryProperty":
      return yield* evaluateGeometryProperty(node, environment);
    case "optionalMember":
      return yield* evaluateOptionalMember(node, environment);
    case "unary":
      return yield* evaluateUnary(node, environment);
    case "binary":
      return yield* evaluateBinary(node, environment);
    case "group": {
      const type = node.type;
      if (type === null) return staticTypeNullError();
      return yield* evaluateTypedExpressionSteps(node.expression, environment);
    }
    case "valueIf":
      return yield* evaluateValueIf(node, environment);
    case "valueMatch":
      return yield* evaluateValueMatch(node, environment);
    case "call":
      return yield* evaluateCall(node, environment);
  }
}

/** Internal suspension raised only by the on-demand document resolver. */
export class ScalarBindingDemand {
  constructor(readonly bindingId: BindingId) {}
}

type ScalarEvaluationSteps = Generator<ScalarBindingDemand, ScalarEvaluation, void>;

// Keep environment calls at their original evaluation point. In particular an
// index or selected condition is not re-evaluated when its lookup must wait.
function* readBindingDependency<T>(read: () => T): Generator<ScalarBindingDemand, T, void> {
  for (;;) {
    try { return read(); }
    catch (error) {
      if (!(error instanceof ScalarBindingDemand)) throw error;
      yield error;
    }
  }
}

function* evaluateTypedExpressionSteps(
  node: TypedScalarExpression,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps {
  const evaluation = yield* evaluateTypedExpressionNode(node, environment);
  environment.onExpressionEvaluated?.(node, evaluation);
  return evaluation;
}

/** Retains the existing reached-expression execution while its owner supplies a binding. */
export const createTypedExpressionEvaluation = (
  node: TypedScalarExpression,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluationSteps => evaluateTypedExpressionSteps(node, environment);

export const evaluateTypedExpression = (
  node: TypedScalarExpression,
  environment: ScalarEvaluationEnvironment
): ScalarEvaluation => {
  const step = createTypedExpressionEvaluation(node, environment).next();
  // A nested collection/local helper returns control to its document owner;
  // ordinary expression environments never produce a demand.
  if (!step.done) throw step.value;
  return step.value;
};
