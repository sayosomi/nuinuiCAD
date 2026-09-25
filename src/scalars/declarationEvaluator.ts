// Evaluates a ScalarProgram's const declarations to their immutable value
// using the pure expression evaluator. This
// module never parses source, never re-resolves a binding name, && never
// re-derives forward/self/cycle/eligibility diagnostics.
//
// The evaluation strategy uses an on-demand resolver with stable-result
// memoization
// (`createLazyScalarProgramEvaluator`) rather than a single eager left-to-right
// sweep:
// a binding's initializer is evaluated the first time something asks for it
// (recursing into other referenced bindings on demand) rather than always in
// array order up front. This lets a caller (the per-element evaluation loop)
// ask for a specific binding's value mid-run, without re-evaluating the whole
// program. Stable results are evaluated once; transient unavailable geometry
// results remain retryable as graph predecessors become ready. A
// compiled ScalarProgram is already guaranteed acyclic && forward-reference
// free (`binding-cycle`/`forward-binding-reference`/
// `self-initialization` diagnostics make the whole document fail to compile
// otherwise - see `compileDslDocument`'s early-return-on-error &&
// `buildBindingProgramEligibility`'s own defensive throw in
// bindingProgramEligibility.ts), so on-demand recursion always strictly
// resolves "earlier" statements first && terminates. `evaluateScalarProgram`
// still exists with its original signature && byte-identical output (same
// map, same insertion order) - it walks `program.statements` in array order,
// pulling each value from the resolver, so callers that only need the
// whole-document result never see a difference from the prior array-order
// construction.
//
// Immutable statement-for execution and Rust evaluation are handled by their
// respective compilation/runtime paths rather than this declaration evaluator.

import type { BindingId } from "@nuinuicad/nui-language";
import { evaluateTypedExpression, type GeometryBuiltinTargetLookupResult, type ScalarEvaluationEnvironment } from "./expressionEvaluator";
import type { ScalarProgram, ScalarProgramStatement } from "@nuinuicad/nui-language";
import type { ScalarEvaluation } from "@nuinuicad/nui-language";
import { scalarValueMatchesType, type ScalarExpressionType, type ScalarType } from "@nuinuicad/nui-language";
import { isScalarExpressionTypeAssignable, scalarExpressionTypesEqual } from "@nuinuicad/nui-language";
import type {
  ScalarExpressionResolvedGeometryTarget,
  ScalarExpressionResolvedOptionalMemberTarget,
  TypedScalarGeometryPropertyReferenceNode
} from "@nuinuicad/nui-language";

export type ScalarProgramEvaluation = {
  /** One entry per evaluated `declare` statement, keyed by its bindingId. */
  resultsByBindingId: ReadonlyMap<BindingId, ScalarEvaluation>;
};

export type LazyScalarProgramEvaluator = {
  /**
   * Resolves a single binding's value, evaluating its initializer on first
   * ask && caching stable results for subsequent asks (including asks made
   * recursively while resolving a different binding's initializer). A
   * transient unavailable geometry result remains retryable.
   */
  resolve: (bindingId: BindingId) => ScalarEvaluation;
  collectionResolver?: ScalarProgramCollectionResolver;
};

export type ScalarProgramCollectionResolver = {
  environmentFor: (sourceOrder: number) => Pick<ScalarEvaluationEnvironment, "lookupCollectionIndex" | "lookupCollectionLength" | "lookupOptionalMember">;
  recordFieldFor: (
    collectionValueId: string,
    index: number,
    field: { recordStatementId: string; fieldIndex: number; type: ScalarExpressionType },
    sourceOrder: number
  ) => ScalarEvaluation;
};

type CollectionLocalBindings = ReadonlyMap<BindingId, ScalarEvaluation>;
type ScalarEvaluationError = Extract<ScalarEvaluation, { status: "error" }>;
type ScalarCollectionMatch = Extract<NonNullable<ScalarProgram["collectionValues"]>[number], { kind: "match" }>;
type CollectionMatchSelection =
  | { kind: "selected"; valueId: string; localBindings: CollectionLocalBindings }
  | { kind: "error"; evaluation: ScalarEvaluationError };

const resultForDeclaredType = (evaluation: ScalarEvaluation, declaredType: ScalarExpressionType): ScalarEvaluation => {
  if (evaluation.status === "error") return { ...evaluation, type: declaredType };
  if (isScalarExpressionTypeAssignable(evaluation.type, declaredType) && scalarValueMatchesType(declaredType, evaluation.value)) {
    return { ...evaluation, type: declaredType };
  }
  return { status: "error", type: declaredType, issueCode: "evaluation-runtime-value-type-mismatch" };
};

const isTransientUnavailableEvaluation = (evaluation: ScalarEvaluation): boolean =>
  evaluation.status === "error" && (
    evaluation.issueCode === "evaluation-geometry-property-unavailable" ||
    evaluation.issueCode === "evaluation-geometry-builtin-unavailable" ||
    evaluation.issueCode === "evaluation-collection-property-unavailable" ||
    evaluation.issueCode === "evaluation-collection-index-unavailable" ||
    evaluation.issueCode === "evaluation-optional-member-unavailable"
  );

/**
 * Shared runtime boundary for collection members and cardinality. The
 * collection graph is already compiler-resolved; this helper only follows
 * those IDs and evaluates the already-typed control-flow expressions through
 * the same scalar evaluator used by declarations and mutation runtime.
 */
export const createScalarProgramCollectionResolver = (
  program: Pick<ScalarProgram, "collectionValues">,
  resolveBinding: (bindingId: BindingId) => ScalarEvaluation,
  resolveGeometryProperty?: (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number) => ScalarEvaluation,
  resolveGeometryTarget?: (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number) => GeometryBuiltinTargetLookupResult | undefined,
  resolveExternalCollectionLength?: (collectionValueId: string, sourceOrder: number) => number | undefined,
  resolveCollectionValueId?: (collectionValueId: string, sourceOrder: number) => string | undefined
): ScalarProgramCollectionResolver | undefined => {
  if (!program.collectionValues?.length && !resolveGeometryProperty && !resolveGeometryTarget) return undefined;
  const valuesById = new Map((program.collectionValues ?? []).map((value) => [value.valueId, value] as const));
  const redirectedValueId = (collectionValueId: string, sourceOrder: number): string =>
    resolveCollectionValueId?.(collectionValueId, sourceOrder) ?? collectionValueId;

  const runtimeMismatch = (type: ScalarExpressionType): ScalarEvaluationError => ({
    status: "error",
    type,
    issueCode: "evaluation-runtime-value-type-mismatch"
  });
  const resultError = (evaluation: ScalarEvaluation, type: ScalarExpressionType): ScalarEvaluationError =>
    evaluation.status === "error" ? { ...evaluation, type } : runtimeMismatch(type);
  const isEvaluationError = (value: boolean | number | ScalarEvaluation | undefined): value is ScalarEvaluationError =>
    typeof value === "object" && value !== null && value.status === "error";

  const selectMatchArm = (
    collection: ScalarCollectionMatch,
    localBindings: CollectionLocalBindings
  ): CollectionMatchSelection => {
    const staticType = collection.scrutinee.type;
    if (!staticType) return { kind: "error", evaluation: runtimeMismatch({ kind: "number" }) };
    const scrutinee = evaluateTypedExpression(collection.scrutinee, environmentFor(collection.sourceOrder, localBindings));
    if (scrutinee.status === "error") return { kind: "error", evaluation: scrutinee };
    if (!scalarExpressionTypesEqual(scrutinee.type, staticType) || !scalarValueMatchesType(staticType, scrutinee.value)) {
      return { kind: "error", evaluation: runtimeMismatch(staticType) };
    }

    let label: string;
    let presentValue: Extract<ScalarEvaluation, { status: "ok" }> | undefined;
    if (staticType.kind === "optional") {
      if (scrutinee.value.kind === "none") {
        label = "none";
      } else {
        label = "some";
        presentValue = { status: "ok", type: staticType.valueType as ScalarType, value: scrutinee.value };
      }
    } else if (staticType.kind === "choice" && scrutinee.value.kind === "choice") {
      label = scrutinee.value.value;
    } else {
      return { kind: "error", evaluation: runtimeMismatch(staticType) };
    }

    const arm = collection.arms.find((candidate) => candidate.label === label);
    if (!arm) return { kind: "error", evaluation: runtimeMismatch(staticType) };
    const bindings = new Map(localBindings);
    if (presentValue && (arm.binderId || arm.binderType)) {
      if (!arm.binderId || !arm.binderType || !scalarExpressionTypesEqual(arm.binderType, presentValue.type) ||
        !scalarValueMatchesType(arm.binderType, presentValue.value)) {
        return { kind: "error", evaluation: runtimeMismatch(staticType) };
      }
      bindings.set(arm.binderId, presentValue);
    }
    return { kind: "selected", valueId: arm.valueId, localBindings: bindings };
  };

  const presentFor = (
    collectionValueId: string,
    sourceOrder: number,
    seen: ReadonlySet<string> = new Set(),
    localBindings: CollectionLocalBindings = new Map()
  ): boolean | ScalarEvaluation | undefined => {
    const redirected = redirectedValueId(collectionValueId, sourceOrder);
    if (redirected !== collectionValueId) return presentFor(redirected, sourceOrder, seen, localBindings);
    if (seen.has(collectionValueId)) return undefined;
    const collection = valuesById.get(collectionValueId);
    if (!collection) return undefined;
    const nextSeen = new Set([...seen, collectionValueId]);
    if (collection.kind === "none") return false;
    if (collection.kind === "literal") return true;
    if (collection.kind === "alias" || collection.kind === "map" || collection.kind === "recordMap" || collection.kind === "recordField") {
      return presentFor(collection.kind === "alias" ? collection.targetValueId : collection.sourceValueId, sourceOrder, nextSeen, localBindings);
    }
    if (collection.kind === "coalesce") {
      const leftPresent = presentFor(collection.leftValueId, sourceOrder, nextSeen, localBindings);
      if (isEvaluationError(leftPresent)) return leftPresent;
      return leftPresent === true ? true : presentFor(collection.rightValueId, sourceOrder, nextSeen, localBindings);
    }
    if (collection.kind === "if") {
      const condition = evaluateTypedExpression(collection.condition, environmentFor(collection.sourceOrder, localBindings));
      if (condition.status === "error") return condition;
      if (condition.value.kind !== "boolean") return runtimeMismatch(condition.type);
      return presentFor(condition.value.value ? collection.thenValueId : collection.elseValueId, sourceOrder, nextSeen, localBindings);
    }
    const selected = selectMatchArm(collection, localBindings);
    return selected.kind === "error"
      ? selected.evaluation
      : presentFor(selected.valueId, sourceOrder, nextSeen, selected.localBindings);
  };

  const lengthFor = (
    collectionValueId: string,
    sourceOrder: number,
    seen: ReadonlySet<string> = new Set(),
    localBindings: CollectionLocalBindings = new Map()
  ): number | ScalarEvaluation | undefined => {
    const redirected = redirectedValueId(collectionValueId, sourceOrder);
    if (redirected !== collectionValueId) return lengthFor(redirected, sourceOrder, seen, localBindings);
    if (seen.has(collectionValueId)) return undefined;
    const collection = valuesById.get(collectionValueId);
    if (!collection) return undefined;
    const nextSeen = new Set([...seen, collectionValueId]);
    if (collection.kind === "none") return undefined;
    if (collection.kind === "literal") return collection.members.length;
    if (collection.kind === "alias" || collection.kind === "map" || collection.kind === "recordMap" || collection.kind === "recordField") {
      return lengthFor(collection.kind === "alias" ? collection.targetValueId : collection.sourceValueId, sourceOrder, nextSeen, localBindings);
    }
    if (collection.kind === "if") {
      const environment = environmentFor(collection.sourceOrder, localBindings);
      const condition = evaluateTypedExpression(collection.condition, environment);
      if (condition.status === "error") return condition;
      if (condition.value.kind !== "boolean") return runtimeMismatch(condition.type);
      return lengthFor(condition.value.value ? collection.thenValueId : collection.elseValueId, sourceOrder, nextSeen, localBindings);
    }
    if (collection.kind === "coalesce") {
      const leftPresent = presentFor(collection.leftValueId, sourceOrder, nextSeen, localBindings);
      if (isEvaluationError(leftPresent)) return leftPresent;
      return leftPresent === true
        ? lengthFor(collection.leftValueId, sourceOrder, nextSeen, localBindings)
        : leftPresent === false
          ? lengthFor(collection.rightValueId, sourceOrder, nextSeen, localBindings)
          : undefined;
    }
    const selected = selectMatchArm(collection, localBindings);
    return selected.kind === "error"
      ? selected.evaluation
      : lengthFor(selected.valueId, sourceOrder, nextSeen, selected.localBindings);
  };

  const recordFieldFor = (
    collectionValueId: string,
    index: number,
    field: { recordStatementId: string; fieldIndex: number; type: ScalarExpressionType },
    sourceOrder: number,
    seen: ReadonlySet<string> = new Set(),
    localBindings: CollectionLocalBindings = new Map()
  ): ScalarEvaluation => {
    const redirected = redirectedValueId(collectionValueId, sourceOrder);
    if (redirected !== collectionValueId) return recordFieldFor(redirected, index, field, sourceOrder, seen, localBindings);
    if (seen.has(collectionValueId)) return { status: "error", type: field.type, issueCode: "evaluation-collection-index-unavailable" };
    const collection = valuesById.get(collectionValueId);
    if (!collection) return { status: "error", type: field.type, issueCode: "evaluation-collection-index-unavailable" };
    const nextSeen = new Set([...seen, collectionValueId]);
    if (collection.kind === "none") return { status: "error", type: field.type, issueCode: "evaluation-collection-index-unavailable" };
    if (collection.kind === "alias") return recordFieldFor(collection.targetValueId, index, field, sourceOrder, nextSeen, localBindings);
    if (collection.kind === "if") {
      const condition = evaluateTypedExpression(collection.condition, environmentFor(collection.sourceOrder, localBindings));
      if (condition.status === "error") return resultError(condition, field.type);
      if (condition.value.kind !== "boolean") return runtimeMismatch(field.type);
      return recordFieldFor(condition.value.value ? collection.thenValueId : collection.elseValueId, index, field, sourceOrder, nextSeen, localBindings);
    }
    if (collection.kind === "match") {
      const selected = selectMatchArm(collection, localBindings);
      return selected.kind === "error"
        ? resultError(selected.evaluation, field.type)
        : recordFieldFor(selected.valueId, index, field, sourceOrder, nextSeen, selected.localBindings);
    }
    if (collection.kind === "coalesce") {
      const leftPresent = presentFor(collection.leftValueId, sourceOrder, nextSeen, localBindings);
      if (isEvaluationError(leftPresent)) return resultError(leftPresent, field.type);
      return leftPresent === true
        ? recordFieldFor(collection.leftValueId, index, field, sourceOrder, nextSeen, localBindings)
        : leftPresent === false
          ? recordFieldFor(collection.rightValueId, index, field, sourceOrder, nextSeen, localBindings)
          : { status: "error", type: field.type, issueCode: "evaluation-collection-index-unavailable" };
    }
    if (collection.kind === "recordField") return recordFieldFor(collection.sourceValueId, index, collection.field, sourceOrder, nextSeen, localBindings);
    if (collection.kind === "recordMap") {
      const mappedField = collection.fields.find((candidate) => candidate.recordStatementId === field.recordStatementId && candidate.fieldIndex === field.fieldIndex);
      if (!mappedField) return { status: "error", type: field.type, issueCode: "evaluation-runtime-value-type-mismatch" };
      const binderFields = new Map(collection.binderFields.map((candidate) => [candidate.bindingId, candidate] as const));
      const mapped = evaluateTypedExpression(mappedField.body, {
        ...environmentFor(sourceOrder, localBindings),
        lookupBinding: (bindingId) => {
          const local = localBindings.get(bindingId);
          if (local) return local;
          const binderField = binderFields.get(bindingId);
          return binderField
            ? recordFieldFor(collection.sourceValueId, index, binderField, sourceOrder, nextSeen, localBindings)
            : resolveBinding(bindingId);
        }
      });
      if (mapped.status === "error") return mapped;
      return scalarExpressionTypesEqual(mapped.type, mappedField.type) && scalarValueMatchesType(mapped.type, mapped.value)
        ? mapped
        : { status: "error", type: mappedField.type, issueCode: "evaluation-runtime-value-type-mismatch" };
    }
    if (collection.kind !== "literal") return { status: "error", type: field.type, issueCode: "evaluation-collection-index-unavailable" };
    const member = collection.members[index];
    if (!member || member.kind !== "record") return { status: "error", type: field.type, issueCode: "evaluation-runtime-value-type-mismatch" };
    const memberField = member.fields.find((candidate) => candidate.recordStatementId === field.recordStatementId && candidate.fieldIndex === field.fieldIndex);
    if (!memberField) return { status: "error", type: field.type, issueCode: "evaluation-runtime-value-type-mismatch" };
    const value = localBindings.get(memberField.bindingId) ?? resolveBinding(memberField.bindingId);
    if (value.status === "error") return value;
    return scalarExpressionTypesEqual(value.type, field.type) && scalarValueMatchesType(value.type, value.value)
      ? value
      : { status: "error", type: field.type, issueCode: "evaluation-runtime-value-type-mismatch" };
  };

  const typedGeometryPropertyFor = (
    reference: Extract<ScalarExpressionResolvedOptionalMemberTarget, { kind: "geometryProperty" }>["reference"]
  ): TypedScalarGeometryPropertyReferenceNode | null => {
    if (reference.kind === "collection") return null;
    return {
      kind: "geometryProperty",
      span: { start: 0, end: 0 },
      elementNameSpan: { start: 0, end: 0 },
      propertySpan: { start: 0, end: 0 },
      elementName: "",
      elementId: "elementId" in reference ? reference.elementId : null,
      ...(reference.kind === "geometryValue" ? { geometryValueOccurrence: reference.occurrence } : {}),
      ...(reference.kind === "geometryValue" && reference.pointKey ? { geometryValuePointKey: reference.pointKey } : {}),
      ...(reference.kind === "geometryValueForBinder" ? { geometryValueBinderId: reference.binderId } : {}),
      ...(reference.kind === "forGroupOccurrence" ? {
        forGroupOccurrenceTemplateElementId: reference.templateElementId,
        forGroupOccurrenceIndex: reference.index,
        ...(reference.pointKey ? { forGroupOccurrencePointKey: reference.pointKey } : {})
      } : {}),
      property: reference.property,
      targetSourceOrder: reference.targetSourceOrder,
      type: reference.type
    };
  };

  const evaluateOptionalMember = (
    target: ScalarExpressionResolvedOptionalMemberTarget,
    type: ScalarExpressionType,
    sourceOrder: number,
    localBindings: CollectionLocalBindings = new Map()
  ): ScalarEvaluation => {
    const none = (): ScalarEvaluation => ({ status: "ok", type, value: { kind: "none" } });
    if (target.kind === "collectionLength") {
      const present = presentFor(target.collectionValueId, sourceOrder, new Set(), localBindings);
      if (isEvaluationError(present)) return resultError(present, type);
      if (present === false) return none();
      const externalLength = resolveExternalCollectionLength?.(target.collectionValueId, sourceOrder);
      if (present !== true && externalLength === undefined) {
        // An external geometry collection has no ScalarProgram descriptor. Its
        // length resolver is the established presence/value authority.
        if (present === undefined && resolveExternalCollectionLength) return none();
        return { status: "error", type, issueCode: "evaluation-collection-property-unavailable" };
      }
      const resolvedLength = target.collectionLength ?? externalLength ?? lengthFor(target.collectionValueId, sourceOrder, new Set(), localBindings);
      if (isEvaluationError(resolvedLength)) return resultError(resolvedLength, type);
      const length = resolvedLength;
      return typeof length === "number" && Number.isInteger(length) && length >= 0
        ? { status: "ok", type, value: { kind: "number", value: length } }
        : { status: "error", type, issueCode: "evaluation-collection-property-unavailable" };
    }
    if (target.kind === "recordField") {
      const present = presentFor(target.collectionValueId, sourceOrder, new Set(), localBindings);
      if (isEvaluationError(present)) return resultError(present, type);
      if (present === false) return none();
      if (present !== true) return { status: "error", type, issueCode: "evaluation-collection-index-unavailable" };
      const result = recordFieldFor(
        target.collectionValueId,
        0,
        target.field,
        sourceOrder,
        new Set(),
        localBindings
      );
      if (result.status === "error") return { ...result, type };
      return scalarValueMatchesType(type, result.value)
        ? { status: "ok", type, value: result.value }
        : { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
    }

    const receiverPresent = target.receiver.kind === "collection"
      ? presentFor(target.receiver.collectionValueId, sourceOrder, new Set(), localBindings)
      : resolveGeometryTarget?.(target.receiver.target, sourceOrder) === undefined
        ? false
        : true;
    if (isEvaluationError(receiverPresent)) return resultError(receiverPresent, type);
    if (receiverPresent === false) return none();
    const receiverRuntime = target.receiver.kind === "geometryValue"
      ? resolveGeometryTarget?.(target.receiver.target, sourceOrder)
      : undefined;
    if (receiverRuntime && receiverRuntime.kind === "unavailable") {
      return { status: "error", type, issueCode: "evaluation-geometry-property-unavailable" };
    }
    if (receiverPresent !== true || !resolveGeometryProperty) {
      return { status: "error", type, issueCode: "evaluation-geometry-property-unavailable" };
    }
    const reference = typedGeometryPropertyFor(target.reference);
    if (!reference) return { status: "error", type, issueCode: "evaluation-geometry-property-unavailable" };
    const result = resolveGeometryProperty(reference, sourceOrder);
    if (result.status === "error") return { ...result, type };
    return scalarValueMatchesType(type, result.value)
      ? { status: "ok", type, value: result.value }
      : { status: "error", type, issueCode: "evaluation-runtime-value-type-mismatch" };
  };

  const indexFor = (
    collectionValueId: string,
    index: number,
    elementType: ScalarType,
    collectionLength: number | null,
    targetSourceOrder: number,
    sourceOrder: number,
    seen: ReadonlySet<string> = new Set(),
    localBindings: CollectionLocalBindings = new Map()
  ): ScalarEvaluation => {
    const redirected = redirectedValueId(collectionValueId, sourceOrder);
    if (redirected !== collectionValueId) return indexFor(redirected, index, elementType, collectionLength, targetSourceOrder, sourceOrder, seen, localBindings);
    if (!Number.isFinite(index) || !Number.isInteger(index) || index < 0 ||
      (collectionLength !== null && index >= collectionLength)) {
      return { status: "error", type: elementType, issueCode: "evaluation-collection-index-invalid" };
    }
    if (seen.has(collectionValueId)) return { status: "error", type: elementType, issueCode: "evaluation-collection-index-unavailable" };
    const collection = valuesById.get(collectionValueId);
    if (!collection) return { status: "error", type: elementType, issueCode: "evaluation-collection-index-unavailable" };
    const nextSeen = new Set([...seen, collectionValueId]);
    if (collection.kind === "none") return { status: "error", type: elementType, issueCode: "evaluation-collection-index-unavailable" };
    if (collection.kind === "alias") return indexFor(collection.targetValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, nextSeen, localBindings);
    if (collection.kind === "if") {
      const condition = evaluateTypedExpression(collection.condition, environmentFor(collection.sourceOrder, localBindings));
      if (condition.status === "error") return resultError(condition, elementType);
      if (condition.value.kind !== "boolean") return runtimeMismatch(elementType);
      return indexFor(condition.value.value ? collection.thenValueId : collection.elseValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, nextSeen, localBindings);
    }
    if (collection.kind === "match") {
      const selected = selectMatchArm(collection, localBindings);
      return selected.kind === "error"
        ? resultError(selected.evaluation, elementType)
        : indexFor(selected.valueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, nextSeen, selected.localBindings);
    }
    if (collection.kind === "coalesce") {
      const leftPresent = presentFor(collection.leftValueId, sourceOrder, nextSeen, localBindings);
      if (isEvaluationError(leftPresent)) return resultError(leftPresent, elementType);
      return leftPresent === true
        ? indexFor(collection.leftValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, nextSeen, localBindings)
        : leftPresent === false
          ? indexFor(collection.rightValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, nextSeen, localBindings)
          : { status: "error", type: elementType, issueCode: "evaluation-collection-index-unavailable" };
    }
    if (collection.kind === "map") {
      const source = indexFor(collection.sourceValueId, index, collection.sourceElementType, null, -1, sourceOrder, nextSeen, localBindings);
      if (source.status === "error") return source;
      const mapBindings = new Map(localBindings);
      mapBindings.set(collection.binderId, source);
      const mapped = evaluateTypedExpression(collection.body, {
        ...environmentFor(sourceOrder, mapBindings),
        lookupBinding: (bindingId) => mapBindings.get(bindingId) ?? resolveBinding(bindingId)
      });
      if (mapped.status === "error") return mapped;
      return scalarExpressionTypesEqual(mapped.type, collection.resultElementType) && scalarValueMatchesType(mapped.type, mapped.value)
        ? mapped
        : { status: "error", type: collection.resultElementType, issueCode: "evaluation-runtime-value-type-mismatch" };
    }
    if (collection.kind === "recordField") {
      return recordFieldFor(collection.sourceValueId, index, collection.field, sourceOrder, nextSeen, localBindings);
    }
    if (collection.kind === "recordMap") {
      return { status: "error", type: elementType, issueCode: "evaluation-runtime-value-type-mismatch" };
    }
    const member = collection.members[index];
    if (!member) return { status: "error", type: elementType, issueCode: "evaluation-collection-index-invalid" };
    if (member.kind === "record") return { status: "error", type: elementType, issueCode: "evaluation-runtime-value-type-mismatch" };
    const value = member.kind === "literal"
      ? { status: "ok" as const, type: member.type, value: member.value }
      : localBindings.get(member.bindingId) ?? resolveBinding(member.bindingId);
    if (value.status === "error") return value;
    return scalarExpressionTypesEqual(value.type, elementType) && scalarValueMatchesType(value.type, value.value)
      ? value
      : { status: "error", type: elementType, issueCode: "evaluation-runtime-value-type-mismatch" };
  };

  function environmentFor(sourceOrder: number, localBindings: CollectionLocalBindings = new Map()): ScalarEvaluationEnvironment {
    return {
      lookupBinding: (bindingId) => localBindings.get(bindingId) ?? resolveBinding(bindingId),
      ...(resolveGeometryProperty ? { lookupGeometryProperty: (reference) => resolveGeometryProperty(reference, sourceOrder) } : {}),
      ...(resolveGeometryTarget ? { lookupGeometryTarget: (target) => resolveGeometryTarget(target, sourceOrder) } : {}),
      lookupCollectionLength: (collectionValueId) => {
        const result = lengthFor(collectionValueId, sourceOrder, new Set(), localBindings);
        return typeof result === "number" ? result : undefined;
      },
      lookupCollectionIndex: (collectionValueId, index, elementType, collectionLength, targetSourceOrder) =>
        indexFor(collectionValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, new Set(), localBindings),
      lookupOptionalMember: (target, type) => evaluateOptionalMember(target, type, sourceOrder, localBindings)
    };
  }

  return { environmentFor, recordFieldFor };
};

/**
 * Builds an on-demand resolver over `program`. Nothing is evaluated until
 * `resolve` is actually called for a given bindingId.
 */
export const createLazyScalarProgramEvaluator = (
  program: ScalarProgram,
  resolveGeometryProperty?: (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number) => ScalarEvaluation,
  resolveGeometryTarget?: (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number) => GeometryBuiltinTargetLookupResult | undefined,
  resolveCollectionLength?: (collectionValueId: string, sourceOrder: number) => number | undefined
): LazyScalarProgramEvaluator => {
  const statementByBindingId = new Map<BindingId, ScalarProgramStatement>();
  for (const statement of program.statements) {
    statementByBindingId.set(statement.bindingId, statement);
  }

  const cache = new Map<BindingId, ScalarEvaluation>();
  // Defense-in-depth only (see module comment): a compiled program is already
  // proven acyclic before it reaches this module. Guards against this new
  // on-demand recursion ever silently looping forever if that upstream
  // invariant were somehow violated, rather than letting it hang.
  const inProgressBindingIds = new Set<BindingId>();

  const resolve = (bindingId: BindingId): ScalarEvaluation => {
    const cached = cache.get(bindingId);
    if (cached) return cached;

    const statement = statementByBindingId.get(bindingId);
    if (!statement) {
      return { status: "error", type: { kind: "number" }, issueCode: "evaluation-binding-unavailable", bindingId };
    }

    if (inProgressBindingIds.has(bindingId)) {
      return {
        status: "error",
        type: statement.declaration.declaredType,
        issueCode: "evaluation-binding-cycle-guard",
        bindingId
      };
    }

    inProgressBindingIds.add(bindingId);
    try {
      const environment: ScalarEvaluationEnvironment = {
        lookupBinding: resolve,
        ...(resolveGeometryProperty ? { lookupGeometryProperty: (reference) => resolveGeometryProperty(reference, statement.sourceOrder) } : {}),
        ...(resolveGeometryTarget ? { lookupGeometryTarget: (target) => resolveGeometryTarget(target, statement.sourceOrder) } : {}),
        ...(collectionResolver ? collectionResolver.environmentFor(statement.sourceOrder) : {}),
        ...(resolveCollectionLength ? {
          lookupCollectionLength: (collectionValueId: string) =>
            resolveCollectionLength(collectionValueId, statement.sourceOrder) ??
            collectionResolver?.environmentFor(statement.sourceOrder).lookupCollectionLength?.(collectionValueId)
        } : {})
      };
      const evaluation = resultForDeclaredType(
        evaluateTypedExpression(statement.declaration.initializer, environment),
        statement.declaration.declaredType
      );
      // Geometry-dependent controller probes can be transiently unavailable
      // before their canonical graph predecessors have run. Do not turn that
      // scheduler state into a permanent scalar result.
      if (!isTransientUnavailableEvaluation(evaluation)) cache.set(bindingId, evaluation);
      return evaluation;
    } finally {
      inProgressBindingIds.delete(bindingId);
    }
  };

  const collectionResolver = createScalarProgramCollectionResolver(
    program,
    resolve,
    resolveGeometryProperty,
    resolveGeometryTarget,
    resolveCollectionLength
  );

  return { resolve, ...(collectionResolver ? { collectionResolver } : {}) };
};

/**
 * Walks `program.statements` in array order (already source order) && pulls
 * each statement's value from `evaluator` - a stable-result memoized resolver,
 * so anything already resolved (e.g. by a property-materialization lookup made
 * mid-run) is a free cache hit here. Transient unavailable geometry results may
 * be re-evaluated after their graph predecessors become ready. This is what
 * guarantees the returned map's shape/insertion order is always the same
 * regardless of what order (if any) callers resolved bindings in beforehand,
 * so `computedScalarBindings`'s output stays byte-identical to the original
 * eager-sweep implementation.
 */
export const finalizeScalarProgramEvaluation = (
  program: ScalarProgram,
  evaluator: LazyScalarProgramEvaluator
): ScalarProgramEvaluation => {
  const resultsByBindingId = new Map<BindingId, ScalarEvaluation>();
  for (const statement of program.statements) {
    resultsByBindingId.set(statement.bindingId, evaluator.resolve(statement.bindingId));
  }
  return { resultsByBindingId };
};

/**
 * Evaluates every declaration in `program.statements` && returns them keyed
 * by bindingId, in array order. A thin convenience wrapper for callers that
 * only need the whole-document result with no mid-run lookups of their own -
 * see `finalizeScalarProgramEvaluation` for callers that need to
 * resolve individual bindings before the whole program is walked.
 */
export const evaluateScalarProgram = (
  program: ScalarProgram
): ScalarProgramEvaluation =>
  finalizeScalarProgramEvaluation(program, createLazyScalarProgramEvaluator(program));
