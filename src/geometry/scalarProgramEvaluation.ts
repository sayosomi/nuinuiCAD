import type { CadElement, ComputedGeometry, ElementId } from "../types/geometry";
import type { ComputedGeometryValue } from "./evaluationTypes";
import { geometryValueOccurrenceKey } from "../model/geometryValueOccurrence";
import type { GeometryValueOccurrenceKey } from "../model/geometryValueOccurrence";
import { computedReferencePathValue } from "./numericExpressions";
import { resolveDerivedPoint } from "../model/pointAnchors";
import { getParameterValue } from "../parameters/parameterAccess";
import type { BindingReadPosition, BindingVersionGraph } from "../scalars/bindingVersions";
import {
  createLazyScalarProgramEvaluator,
  finalizeScalarProgramEvaluation,
  type ScalarProgramEvaluation
} from "../scalars/declarationEvaluator";
import {
  createIncrementalLinearMutationEvaluator,
  type ForGroupMutationExecutionContext,
  type ForGroupMutationExecutionPlan,
  type ForGroupMutationStatement,
  type LinearMutationEvaluation
} from "../scalars/linearMutationEvaluator";
import type { ForGroupMutationRunOutcome } from "../scalars/forGroupMutationCore";
import type { ScalarProgram, ScalarProgramCollection } from "../scalars/scalarProgram";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ScalarEvaluation } from "../scalars/types";
import type { ScalarExpressionResolvedGeometryTarget, TypedScalarGeometryPropertyReferenceNode } from "../scalars/typedExpressionAst";
import type { GeometryBuiltinTargetLookupResult } from "../scalars/expressionEvaluator";
import type { EffectiveElementActivity } from "../model/elementActivity";

/**
 * A scalar-program binding resolver for one compiled nui 1 document.
 */
export type ScalarBindingResolver = {
  resolveBinding: (bindingId: BindingId) => ScalarEvaluation;
  finalize: () => ScalarProgramEvaluation;
};

export type LinearScalarBindingResolver = {
  advanceTo: (position: BindingReadPosition) => void;
  registerConditionalResult: (ownerStatementId: string, branch: "then" | "else" | null) => void;
  resolveBinding: (bindingId: BindingId) => ScalarEvaluation;
  finalize: (position: BindingReadPosition) => LinearMutationEvaluation;
  runForGroup: (
    plan: ForGroupMutationExecutionPlan,
    executeStatement: (statement: ForGroupMutationStatement, context: ForGroupMutationExecutionContext) => ForGroupMutationRunOutcome
  ) => ForGroupMutationRunOutcome;
};

export type DocumentGeometryRuntime = {
  computedGeometry: ReadonlyMap<ElementId, ComputedGeometry>;
  computedGeometryValues?: ReadonlyMap<GeometryValueOccurrenceKey, { value: ComputedGeometryValue }>;
  elementsById: ReadonlyMap<ElementId, CadElement>;
  activities: ReadonlyMap<ElementId, EffectiveElementActivity>;
};

export const resolveDocumentGeometryProperty = (
  geometry: DocumentGeometryRuntime,
  reference: TypedScalarGeometryPropertyReferenceNode,
  sourceOrder: number
): ScalarEvaluation => {
  if (reference.type === null) {
    return { status: "error", type: { kind: "number" }, issueCode: "evaluation-static-type-null" };
  }
  if (reference.type.kind !== "number" && reference.type.kind !== "choice") {
    return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  if (reference.geometryValueOccurrence) {
    const entry = geometry.computedGeometryValues?.get(geometryValueOccurrenceKey(reference.geometryValueOccurrence));
    if (!entry) return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
    if (reference.type.kind === "number") {
      const value = (() => {
        if (entry.value.kind === "point") return reference.property === "x" ? entry.value.x : reference.property === "y" ? entry.value.y : undefined;
        if (reference.property === "length") return entry.value.length;
        if (reference.geometryValuePointKey === "start" && reference.property === "x") return entry.value.start.x;
        if (reference.geometryValuePointKey === "start" && reference.property === "y") return entry.value.start.y;
        if (reference.geometryValuePointKey === "end" && reference.property === "x") return entry.value.end.x;
        if (reference.geometryValuePointKey === "end" && reference.property === "y") return entry.value.end.y;
        if (reference.property === "start.x" || reference.property === "startPoint.x") return entry.value.start.x;
        if (reference.property === "start.y" || reference.property === "startPoint.y") return entry.value.start.y;
        if (reference.property === "end.x" || reference.property === "endPoint.x") return entry.value.end.x;
        if (reference.property === "end.y" || reference.property === "endPoint.y") return entry.value.end.y;
        return computedReferencePathValue(entry.value as never, reference.property);
      })();
      return typeof value === "number"
        ? { status: "ok", type: reference.type, value: { kind: "number", value } }
        : { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
    }
    return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  if (!reference.elementId || reference.targetSourceOrder === null || reference.targetSourceOrder >= sourceOrder) {
    return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  if (reference.type.kind === "number") {
    const value = computedReferencePathValue(geometry.computedGeometry.get(reference.elementId), reference.property);
    return typeof value === "number"
      ? { status: "ok", type: reference.type, value: { kind: "number", value } }
      : { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  if (!geometry.computedGeometry.has(reference.elementId)) {
    return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  if (geometry.activities.get(reference.elementId)?.activity === "disabled") {
    return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
  }

  const targetElement = geometry.elementsById.get(reference.elementId);
  if (!targetElement) {
    return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  let value = getParameterValue(targetElement, reference.property);
  if (targetElement.type === "arcLine" && reference.property === "direction") {
    const computed = geometry.computedGeometry.get(reference.elementId);
    if (!computed || computed.kind !== "arcLine") {
      return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
    }
    if (computed.sweepAngleDeg > 0) value = "counterclockwise";
    else if (computed.sweepAngleDeg < 0) value = "clockwise";
    else value = getParameterValue(targetElement, reference.property) ?? "counterclockwise";
  }
  return typeof value === "string" && reference.type.options.includes(value)
    ? { status: "ok", type: reference.type, value: { kind: "choice", value, options: reference.type.options } }
    : { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
};

export const resolveDocumentGeometryTarget = (
  geometry: DocumentGeometryRuntime,
  target: ScalarExpressionResolvedGeometryTarget,
  sourceOrder: number
): GeometryBuiltinTargetLookupResult | undefined => {
  if (target.kind === "geometryValue") {
    const entry = geometry.computedGeometryValues?.get(geometryValueOccurrenceKey(target.occurrence));
    if (!entry) return undefined;
    if (!target.pointKey) return entry.value;
    if (entry.value.kind !== "line" && entry.value.kind !== "arcLine") return undefined;
    return target.pointKey === "end" ? { kind: "point", x: entry.value.end.x, y: entry.value.end.y } :
      target.pointKey === "start" ? { kind: "point", x: entry.value.start.x, y: entry.value.start.y } : undefined;
  }
  if (target.statementIndex >= sourceOrder || !geometry.elementsById.has(target.statementId)) return undefined;
  if (geometry.activities.get(target.statementId)?.activity === "disabled") {
    return { kind: "unavailable", reason: "disabled" };
  }
  const computed = geometry.computedGeometry.get(target.statementId);
  if (!computed) return undefined;
  if (!target.pointKey) return computed;
  return resolveDerivedPoint(computed, target.pointKey, new Map(geometry.elementsById)) ?? undefined;
};

/**
 * Builds a resolver for a compiled nui 1 scalar program.
 */
export const createDocumentScalarBindingResolver = (
  program: ScalarProgram,
  geometry?: DocumentGeometryRuntime
): ScalarBindingResolver => {
  const resolveGeometryProperty = geometry
    ? (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number): ScalarEvaluation =>
        resolveDocumentGeometryProperty(geometry, reference, sourceOrder)
    : undefined;
  const resolveGeometryTarget = geometry
    ? (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number): GeometryBuiltinTargetLookupResult | undefined => {
        return resolveDocumentGeometryTarget(geometry, target, sourceOrder);
      }
    : undefined;
  const evaluator = createLazyScalarProgramEvaluator(program, resolveGeometryProperty, resolveGeometryTarget);

  return {
    resolveBinding: evaluator.resolve,
    finalize: () => finalizeScalarProgramEvaluation(program, evaluator)
  };
};

/** Task 31's live document adapter for a Task 30 graph with linear sets. */
export const createDocumentLinearScalarBindingResolver = (
  graph: BindingVersionGraph,
  geometry?: DocumentGeometryRuntime,
  collectionValues?: readonly ScalarProgramCollection[]
): LinearScalarBindingResolver => {
  const resolveGeometryProperty = geometry
    ? (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number): ScalarEvaluation =>
        resolveDocumentGeometryProperty(geometry, reference, sourceOrder)
    : undefined;
  const resolveGeometryTarget = geometry
    ? (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number): GeometryBuiltinTargetLookupResult | undefined => {
        return resolveDocumentGeometryTarget(geometry, target, sourceOrder);
      }
    : undefined;
  const evaluator = createIncrementalLinearMutationEvaluator(graph, resolveGeometryProperty, resolveGeometryTarget, collectionValues);
  return {
    advanceTo: evaluator.advanceTo,
    registerConditionalResult: evaluator.registerConditionalResult,
    resolveBinding: evaluator.resolveCurrent,
    finalize: evaluator.finalize,
    runForGroup: evaluator.runForGroup
  };
};

/**
 * Evaluates `program`'s declarations against a document already evaluated by
 * `evaluateElements` - a convenience
 * wrapper for callers that only need the whole-document result with no
 * mid-run property lookups of their own.
 */
export const evaluateDocumentScalarProgram = (program: ScalarProgram): ScalarProgramEvaluation =>
  createDocumentScalarBindingResolver(program).finalize();
