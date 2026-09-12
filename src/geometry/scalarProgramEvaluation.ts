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
  createScalarProgramCollectionResolver,
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
import type { ScalarEvaluation, ScalarType } from "../scalars/types";
import type { ScalarExpressionResolvedGeometryTarget, TypedScalarGeometryPropertyReferenceNode, TypedScalarExpression } from "../scalars/typedExpressionAst";
import { evaluateTypedExpression, type GeometryBuiltinTargetLookupResult, type ScalarEvaluationEnvironment } from "../scalars/expressionEvaluator";
import type { EffectiveElementActivity } from "../model/elementActivity";
import type { GeometryInputCollectionNode } from "../types/geometry";

/**
 * A scalar-program binding resolver for one compiled nui 1 document.
 */
export type ScalarBindingResolver = {
  resolveBinding: (bindingId: BindingId) => ScalarEvaluation;
  resolveCollectionIndex?: (
    collectionValueId: string,
    index: number,
    elementType: ScalarType,
    collectionLength: number | null,
    targetSourceOrder: number,
    sourceOrder: number
  ) => ScalarEvaluation;
  resolveCollectionLength?: (collectionValueId: string, sourceOrder: number) => number | undefined;
  resolveGeometryCollectionLength?: (collectionValueId: string, sourceOrder: number) => number | undefined;
  finalize: () => ScalarProgramEvaluation;
};

export type LinearScalarBindingResolver = {
  advanceTo: (position: BindingReadPosition) => void;
  registerConditionalResult: (ownerStatementId: string, branch: "then" | "else" | null) => void;
  resolveBinding: (bindingId: BindingId) => ScalarEvaluation;
  resolveCollectionIndex?: ScalarBindingResolver["resolveCollectionIndex"];
  resolveCollectionLength?: ScalarBindingResolver["resolveCollectionLength"];
  resolveGeometryCollectionLength?: ScalarBindingResolver["resolveGeometryCollectionLength"];
  finalize: (position: BindingReadPosition) => LinearMutationEvaluation;
  runForGroup: (
    plan: ForGroupMutationExecutionPlan,
    executeStatement: (statement: ForGroupMutationStatement, context: ForGroupMutationExecutionContext) => ForGroupMutationRunOutcome
  ) => ForGroupMutationRunOutcome;
};

export type DocumentGeometryRuntime = {
  computedGeometry: ReadonlyMap<ElementId, ComputedGeometry>;
  computedGeometryValues?: ReadonlyMap<GeometryValueOccurrenceKey, { value: ComputedGeometryValue }>;
  geometryCollectionNodesByValueId?: ReadonlyMap<string, GeometryInputCollectionNode>;
  elementsById: ReadonlyMap<ElementId, CadElement>;
  activities: ReadonlyMap<ElementId, EffectiveElementActivity>;
  forGroupGeneratedRows?: readonly import("./evaluationTypes").ForGroupGeneratedRow[];
  /** Expected total occurrences for a source/template drawable once the
   * enclosing statement-for expansion has been materialized. This lets bare
   * generated references reject an ambiguous future occurrence instead of
   * accidentally selecting the first row evaluated so far. */
  forGroupExpectedOccurrenceCountByTemplateId?: ReadonlyMap<ElementId, number>;
};

type OccurrenceIndexResolver = (expression: TypedScalarExpression, sourceOrder: number) => ScalarEvaluation;

const generatedOccurrenceRowFor = (
  geometry: DocumentGeometryRuntime,
  templateElementId: ElementId,
  index: TypedScalarExpression | null,
  sourceOrder: number,
  resolveIndex?: OccurrenceIndexResolver
): import("./evaluationTypes").ForGroupGeneratedRow | undefined => {
  const rows = geometry.forGroupGeneratedRows?.filter((row) => row.templateElementId === templateElementId) ?? [];
  if (!index) {
    const expectedCount = geometry.forGroupExpectedOccurrenceCountByTemplateId?.get(templateElementId);
    return (expectedCount ?? rows.length) === 1 && rows.length === 1 ? rows[0] : undefined;
  }
  if (!resolveIndex) return undefined;
  const evaluated = resolveIndex(index, sourceOrder);
  if (evaluated.status !== "ok" || evaluated.value.kind !== "number") return undefined;
  const ordinal = evaluated.value.value;
  if (!Number.isFinite(ordinal) || !Number.isInteger(ordinal) || ordinal < 0) return undefined;
  return rows[ordinal];
};

export const resolveDocumentGeometryProperty = (
  geometry: DocumentGeometryRuntime,
  reference: TypedScalarGeometryPropertyReferenceNode,
  sourceOrder: number,
  resolveCollectionLength?: (collectionValueId: string, sourceOrder: number) => number | undefined,
  resolveOccurrenceIndex?: OccurrenceIndexResolver
): ScalarEvaluation => {
  if (reference.type === null) {
    return { status: "error", type: { kind: "number" }, issueCode: "evaluation-static-type-null" };
  }
  if (reference.type.kind !== "number" && reference.type.kind !== "choice") {
    return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  if (reference.collectionValueId) {
    const length = resolveCollectionLength?.(reference.collectionValueId, sourceOrder);
    return typeof length === "number"
      ? { status: "ok", type: reference.type, value: { kind: "number", value: length } }
      : { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  if (reference.forGroupOccurrenceTemplateElementId) {
    const row = generatedOccurrenceRowFor(
      geometry,
      reference.forGroupOccurrenceTemplateElementId,
      reference.forGroupOccurrenceIndex ?? null,
      sourceOrder,
      resolveOccurrenceIndex
    );
    if (!row) return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
    const computed = geometry.computedGeometry.get(row.generatedElementId);
    if (!computed) return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
    if (reference.type.kind === "number") {
      const point = reference.forGroupOccurrencePointKey
        ? resolveDerivedPoint(computed, reference.forGroupOccurrencePointKey, new Map(geometry.elementsById))
        : undefined;
      const value = point && (reference.property === "x" || reference.property === "y")
        ? point[reference.property]
        : computedReferencePathValue(computed, reference.property);
      return typeof value === "number"
        ? { status: "ok", type: reference.type, value: { kind: "number", value } }
        : { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
    }
    const element = geometry.elementsById.get(row.generatedElementId);
    const value = element ? getParameterValue(element, reference.property) : undefined;
    return typeof value === "string" && reference.type.options.includes(value)
      ? { status: "ok", type: reference.type, value: { kind: "choice", value, options: reference.type.options } }
      : { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
  }
  if (reference.geometryValueOccurrence) {
    const entry = geometry.computedGeometryValues?.get(geometryValueOccurrenceKey(reference.geometryValueOccurrence));
    if (!entry) return { status: "error", type: reference.type, issueCode: "evaluation-geometry-property-unavailable" };
    if (reference.type.kind === "number") {
      const value = (() => {
        if (entry.value.kind === "point") return reference.property === "x" ? entry.value.x : reference.property === "y" ? entry.value.y : undefined;
        if (reference.property === "length") return entry.value.length;
        const start = entry.value.kind === "bezierCurve" ? entry.value.segments[0]?.start : entry.value.start;
        const end = entry.value.kind === "bezierCurve" ? entry.value.segments.at(-1)?.end : entry.value.end;
        if (reference.geometryValuePointKey === "start" && reference.property === "x") return start?.x;
        if (reference.geometryValuePointKey === "start" && reference.property === "y") return start?.y;
        if (reference.geometryValuePointKey === "end" && reference.property === "x") return end?.x;
        if (reference.geometryValuePointKey === "end" && reference.property === "y") return end?.y;
        if (reference.property === "start.x" || reference.property === "startPoint.x") return start?.x;
        if (reference.property === "start.y" || reference.property === "startPoint.y") return start?.y;
        if (reference.property === "end.x" || reference.property === "endPoint.x") return end?.x;
        if (reference.property === "end.y" || reference.property === "endPoint.y") return end?.y;
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

const geometryCollectionLengthForNode = (
  node: GeometryInputCollectionNode,
  environmentFor: (sourceOrder: number) => ScalarEvaluationEnvironment
): number | undefined => {
  if (node.kind === "leaf") return node.targets.length;
  if (node.kind === "if") {
    const condition = evaluateTypedExpression(node.condition, environmentFor(node.sourceOrder));
    if (condition.status !== "ok" || condition.value.kind !== "boolean") return undefined;
    return geometryCollectionLengthForNode(condition.value.value ? node.thenBranch : node.elseBranch, environmentFor);
  }
  const scrutinee = evaluateTypedExpression(node.scrutinee, environmentFor(node.sourceOrder));
  const scrutineeValue = scrutinee.status === "ok" ? scrutinee.value : null;
  if (scrutineeValue === null || scrutineeValue.kind !== "choice") return undefined;
  const arm = node.arms.find((candidate) => candidate.label === scrutineeValue.value);
  return arm ? geometryCollectionLengthForNode(arm.value, environmentFor) : undefined;
};

export const resolveDocumentGeometryTarget = (
  geometry: DocumentGeometryRuntime,
  target: ScalarExpressionResolvedGeometryTarget,
  sourceOrder: number,
  resolveOccurrenceIndex?: OccurrenceIndexResolver
): GeometryBuiltinTargetLookupResult | undefined => {
  if (target.kind === "geometryValue") {
    const entry = geometry.computedGeometryValues?.get(geometryValueOccurrenceKey(target.occurrence));
    if (!entry) return undefined;
    if (!target.pointKey) return entry.value;
    if (entry.value.kind !== "line" && entry.value.kind !== "arcLine" && entry.value.kind !== "offsetLine" && entry.value.kind !== "joinedPath" && entry.value.kind !== "polyline") return undefined;
    return target.pointKey === "end" && entry.value.end ? { kind: "point", x: entry.value.end.x, y: entry.value.end.y } :
      target.pointKey === "start" && entry.value.start ? { kind: "point", x: entry.value.start.x, y: entry.value.start.y } : undefined;
  }
  if (target.kind === "forGroupOccurrence") {
    const row = generatedOccurrenceRowFor(geometry, target.templateElementId, target.index, sourceOrder, resolveOccurrenceIndex);
    if (!row) return undefined;
    if (geometry.activities.get(row.generatedElementId)?.activity === "disabled") {
      return { kind: "unavailable", reason: "disabled" };
    }
    const computed = geometry.computedGeometry.get(row.generatedElementId);
    if (!computed) return undefined;
    if (!target.pointKey) return computed;
    return resolveDerivedPoint(computed, target.pointKey, new Map(geometry.elementsById)) ?? undefined;
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
  const resolveGeometryCollectionLength = geometry
    ? (collectionValueId: string): number | undefined => {
        const node = geometry.geometryCollectionNodesByValueId?.get(collectionValueId);
        if (!node || !evaluator) return undefined;
        const environmentFor = (currentSourceOrder: number): ScalarEvaluationEnvironment => ({
          lookupBinding: evaluator.resolve,
          lookupGeometryProperty: (reference) => resolveDocumentGeometryProperty(geometry, reference, currentSourceOrder, resolveGeometryCollectionLength, evaluateOccurrenceIndex),
          lookupGeometryTarget: (target) => resolveDocumentGeometryTarget(geometry, target, currentSourceOrder, evaluateOccurrenceIndex),
          ...evaluator.collectionResolver?.environmentFor(currentSourceOrder)
        });
        return geometryCollectionLengthForNode(node, environmentFor);
      }
    : undefined;
  const resolveGeometryProperty = geometry
    ? (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number): ScalarEvaluation =>
        resolveDocumentGeometryProperty(geometry, reference, sourceOrder, resolveGeometryCollectionLength, evaluateOccurrenceIndex)
    : undefined;
  const resolveGeometryTarget = geometry
    ? (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number): GeometryBuiltinTargetLookupResult | undefined => {
        return resolveDocumentGeometryTarget(geometry, target, sourceOrder, evaluateOccurrenceIndex);
      }
    : undefined;
  const evaluator = createLazyScalarProgramEvaluator(program, resolveGeometryProperty, resolveGeometryTarget, resolveGeometryCollectionLength);
  const collectionResolver = evaluator.collectionResolver;
  const evaluateOccurrenceIndex: OccurrenceIndexResolver = (expression, sourceOrder) => evaluateTypedExpression(expression, {
    lookupBinding: evaluator.resolve,
    lookupGeometryProperty: (reference) => resolveDocumentGeometryProperty(geometry!, reference, sourceOrder, resolveGeometryCollectionLength, evaluateOccurrenceIndex),
    lookupGeometryTarget: (target) => resolveDocumentGeometryTarget(geometry!, target, sourceOrder, evaluateOccurrenceIndex),
    ...collectionResolver?.environmentFor(sourceOrder)
  });

  return {
    resolveBinding: evaluator.resolve,
    ...(collectionResolver ? {
      resolveCollectionIndex: (collectionValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder) =>
        collectionResolver.environmentFor(sourceOrder).lookupCollectionIndex!(collectionValueId, index, elementType, collectionLength, targetSourceOrder),
      resolveCollectionLength: (collectionValueId, sourceOrder) => collectionResolver.environmentFor(sourceOrder).lookupCollectionLength!(collectionValueId)
    } : {}),
    ...(resolveGeometryCollectionLength ? { resolveGeometryCollectionLength } : {}),
    finalize: () => finalizeScalarProgramEvaluation(program, evaluator)
  };
};

/** Task 31's live document adapter for a Task 30 graph with linear sets. */
export const createDocumentLinearScalarBindingResolver = (
  graph: BindingVersionGraph,
  geometry?: DocumentGeometryRuntime,
  collectionValues?: readonly ScalarProgramCollection[]
): LinearScalarBindingResolver => {
  const resolveGeometryCollectionLength = geometry
    ? (collectionValueId: string): number | undefined => {
        const node = geometry.geometryCollectionNodesByValueId?.get(collectionValueId);
        if (!node || !evaluator) return undefined;
        const environmentFor = (currentSourceOrder: number): ScalarEvaluationEnvironment => ({
          lookupBinding: evaluator.resolveCurrent,
          lookupGeometryProperty: (reference) => resolveDocumentGeometryProperty(geometry, reference, currentSourceOrder, resolveGeometryCollectionLength, evaluateOccurrenceIndex),
          lookupGeometryTarget: (target) => resolveDocumentGeometryTarget(geometry, target, currentSourceOrder, evaluateOccurrenceIndex),
          ...collectionResolver?.environmentFor(currentSourceOrder)
        });
        return geometryCollectionLengthForNode(node, environmentFor);
      }
    : undefined;
  const resolveGeometryProperty = geometry
    ? (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number): ScalarEvaluation =>
        resolveDocumentGeometryProperty(geometry, reference, sourceOrder, resolveGeometryCollectionLength, evaluateOccurrenceIndex)
    : undefined;
  const resolveGeometryTarget = geometry
    ? (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number): GeometryBuiltinTargetLookupResult | undefined => {
        return resolveDocumentGeometryTarget(geometry, target, sourceOrder, evaluateOccurrenceIndex);
      }
    : undefined;
  const evaluator = createIncrementalLinearMutationEvaluator(graph, resolveGeometryProperty, resolveGeometryTarget, collectionValues, resolveGeometryCollectionLength);
  const collectionResolver = createScalarProgramCollectionResolver(
    { collectionValues },
    evaluator.resolveCurrent,
    resolveGeometryProperty,
    resolveGeometryTarget
  );
  const evaluateOccurrenceIndex: OccurrenceIndexResolver = (expression, sourceOrder) => evaluateTypedExpression(expression, {
    lookupBinding: evaluator.resolveCurrent,
    lookupGeometryProperty: (reference) => resolveDocumentGeometryProperty(geometry!, reference, sourceOrder, resolveGeometryCollectionLength, evaluateOccurrenceIndex),
    lookupGeometryTarget: (target) => resolveDocumentGeometryTarget(geometry!, target, sourceOrder, evaluateOccurrenceIndex),
    ...collectionResolver?.environmentFor(sourceOrder)
  });
  return {
    advanceTo: evaluator.advanceTo,
    registerConditionalResult: evaluator.registerConditionalResult,
    resolveBinding: evaluator.resolveCurrent,
    ...(collectionResolver ? {
      resolveCollectionIndex: (collectionValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder) =>
        collectionResolver.environmentFor(sourceOrder).lookupCollectionIndex!(collectionValueId, index, elementType, collectionLength, targetSourceOrder),
      resolveCollectionLength: (collectionValueId, sourceOrder) => collectionResolver.environmentFor(sourceOrder).lookupCollectionLength!(collectionValueId)
    } : {}),
    ...(resolveGeometryCollectionLength ? { resolveGeometryCollectionLength } : {}),
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
