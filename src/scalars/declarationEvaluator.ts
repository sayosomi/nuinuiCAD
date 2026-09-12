// Evaluates a ScalarProgram's const/let declarations to their version-0 value
// using the pure expression evaluator. This
// module never parses source, never re-resolves a binding name, && never
// re-derives forward/self/cycle/eligibility diagnostics.
//
// The evaluation strategy uses an on-demand, memoized resolver
// (`createLazyScalarProgramEvaluator`) rather than a single eager left-to-right
// sweep:
// a binding's initializer is evaluated the first time something asks for it
// (recursing into other referenced bindings on demand) rather than always in
// array order up front. This lets a caller (the per-element evaluation loop)
// ask for a specific binding's value mid-run, without re-evaluating the whole
// program && without ever evaluating any single binding more than once. A
// compiled ScalarProgram is already guaranteed acyclic && forward-reference
// free (`binding-cycle`/`forward-binding-reference`/
// `self-initialization` diagnostics make the whole document fail to compile
// otherwise - see `compileDslDocument`'s early-return-on-error &&
// `buildBindingProgramEligibility`'s own defensive throw in
// bindingProgramEligibility.ts), so on-demand recursion always strictly
// resolves "earlier" statements first && terminates. `evaluateScalarProgram`
// still exists with its original signature && byte-identical output (same
// map, same insertion order) - it walks `program.statements` in array order,
// pulling each value from the (memoized, so free after the first ask)
// resolver, so callers that only need the whole-document result never see a
// difference from the prior array-order construction.
//
// `set`, control-flow mutation, && Rust evaluation are handled by their
// respective compilation/runtime paths rather than this declaration evaluator.

import type { BindingId } from "./bindingCatalog";
import { evaluateTypedExpression, type GeometryBuiltinTargetLookupResult, type ScalarEvaluationEnvironment } from "./expressionEvaluator";
import type { ScalarProgram, ScalarProgramStatement } from "./scalarProgram";
import type { ScalarEvaluation } from "./types";
import { scalarValueMatchesType, type ScalarExpressionType, type ScalarType } from "./types";
import { isScalarExpressionTypeAssignable, scalarExpressionTypesEqual } from "./scalarAssignability";
import type {
  ScalarExpressionResolvedGeometryTarget,
  TypedScalarGeometryPropertyReferenceNode
} from "./typedExpressionAst";

export type ScalarProgramEvaluation = {
  /** One entry per evaluated `declare` statement, keyed by its bindingId. */
  resultsByBindingId: ReadonlyMap<BindingId, ScalarEvaluation>;
};

export type LazyScalarProgramEvaluator = {
  /**
   * Resolves a single binding's value, evaluating its initializer on first
   * ask && caching the result for every subsequent ask (including asks made
   * recursively while resolving a different binding's initializer).
   */
  resolve: (bindingId: BindingId) => ScalarEvaluation;
  collectionResolver?: ScalarProgramCollectionResolver;
};

export type ScalarProgramCollectionResolver = {
  environmentFor: (sourceOrder: number) => Pick<ScalarEvaluationEnvironment, "lookupCollectionIndex" | "lookupCollectionLength">;
};

const resultForDeclaredType = (evaluation: ScalarEvaluation, declaredType: ScalarExpressionType): ScalarEvaluation => {
  if (evaluation.status === "error") return { ...evaluation, type: declaredType };
  if (isScalarExpressionTypeAssignable(evaluation.type, declaredType) && scalarValueMatchesType(declaredType, evaluation.value)) {
    return { ...evaluation, type: declaredType };
  }
  return { status: "error", type: declaredType, issueCode: "evaluation-runtime-value-type-mismatch" };
};

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
  resolveGeometryTarget?: (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number) => GeometryBuiltinTargetLookupResult | undefined
): ScalarProgramCollectionResolver | undefined => {
  if (!program.collectionValues?.length) return undefined;
  const valuesById = new Map(program.collectionValues.map((value) => [value.valueId, value] as const));

  const presentFor = (collectionValueId: string, sourceOrder: number, seen: ReadonlySet<string> = new Set()): boolean | undefined => {
    if (seen.has(collectionValueId)) return undefined;
    const collection = valuesById.get(collectionValueId);
    if (!collection) return undefined;
    const nextSeen = new Set([...seen, collectionValueId]);
    if (collection.kind === "none") return false;
    if (collection.kind === "literal") return true;
    if (collection.kind === "alias" || collection.kind === "map" || collection.kind === "recordMap" || collection.kind === "recordField") {
      return presentFor(collection.kind === "alias" ? collection.targetValueId : collection.sourceValueId, sourceOrder, nextSeen);
    }
    if (collection.kind === "coalesce") {
      const leftPresent = presentFor(collection.leftValueId, sourceOrder, nextSeen);
      return leftPresent === true ? true : presentFor(collection.rightValueId, sourceOrder, nextSeen);
    }
    if (collection.kind === "if") {
      const condition = evaluateTypedExpression(collection.condition, environmentFor(collection.sourceOrder));
      if (condition.status !== "ok" || condition.value.kind !== "boolean") return undefined;
      return presentFor(condition.value.value ? collection.thenValueId : collection.elseValueId, sourceOrder, nextSeen);
    }
    const scrutinee = evaluateTypedExpression(collection.scrutinee, environmentFor(collection.sourceOrder));
    const scrutineeValue = scrutinee.status === "ok" ? scrutinee.value : null;
    if (scrutineeValue === null || scrutineeValue.kind !== "choice") return undefined;
    const arm = collection.arms.find((candidate) => candidate.label === scrutineeValue.value);
    return arm ? presentFor(arm.valueId, sourceOrder, nextSeen) : undefined;
  };

  const lengthFor = (collectionValueId: string, sourceOrder: number, seen: ReadonlySet<string> = new Set()): number | undefined => {
    if (seen.has(collectionValueId)) return undefined;
    const collection = valuesById.get(collectionValueId);
    if (!collection) return undefined;
    const nextSeen = new Set([...seen, collectionValueId]);
    if (collection.kind === "none") return undefined;
    if (collection.kind === "literal") return collection.members.length;
    if (collection.kind === "alias" || collection.kind === "map" || collection.kind === "recordMap" || collection.kind === "recordField") {
      return lengthFor(collection.kind === "alias" ? collection.targetValueId : collection.sourceValueId, sourceOrder, nextSeen);
    }
    if (collection.kind === "if") {
      const environment = environmentFor(collection.sourceOrder);
      const condition = evaluateTypedExpression(collection.condition, environment);
      if (condition.status !== "ok" || condition.value.kind !== "boolean") return undefined;
      return lengthFor(condition.value.value ? collection.thenValueId : collection.elseValueId, sourceOrder, nextSeen);
    }
    if (collection.kind === "coalesce") {
      const leftPresent = presentFor(collection.leftValueId, sourceOrder, nextSeen);
      return leftPresent === true
        ? lengthFor(collection.leftValueId, sourceOrder, nextSeen)
        : leftPresent === false
          ? lengthFor(collection.rightValueId, sourceOrder, nextSeen)
          : undefined;
    }
    const environment = environmentFor(collection.sourceOrder);
    const scrutinee = evaluateTypedExpression(collection.scrutinee, environment);
    const scrutineeValue = scrutinee.status === "ok" ? scrutinee.value : null;
    if (scrutineeValue === null || scrutineeValue.kind !== "choice") return undefined;
    const arm = collection.arms.find((candidate) => candidate.label === scrutineeValue.value);
    return arm ? lengthFor(arm.valueId, sourceOrder, nextSeen) : undefined;
  };

  const recordFieldFor = (
    collectionValueId: string,
    index: number,
    field: { recordStatementId: string; fieldIndex: number; type: ScalarType },
    sourceOrder: number,
    seen: ReadonlySet<string> = new Set()
  ): ScalarEvaluation => {
    if (seen.has(collectionValueId)) return { status: "error", type: field.type, issueCode: "evaluation-collection-index-unavailable" };
    const collection = valuesById.get(collectionValueId);
    if (!collection) return { status: "error", type: field.type, issueCode: "evaluation-collection-index-unavailable" };
    const nextSeen = new Set([...seen, collectionValueId]);
    if (collection.kind === "none") return { status: "error", type: field.type, issueCode: "evaluation-collection-index-unavailable" };
    if (collection.kind === "alias") return recordFieldFor(collection.targetValueId, index, field, sourceOrder, nextSeen);
    if (collection.kind === "if") {
      const condition = evaluateTypedExpression(collection.condition, environmentFor(collection.sourceOrder));
      if (condition.status !== "ok" || condition.value.kind !== "boolean") return { status: "error", type: field.type, issueCode: condition.status === "error" ? condition.issueCode : "evaluation-runtime-value-type-mismatch" };
      return recordFieldFor(condition.value.value ? collection.thenValueId : collection.elseValueId, index, field, sourceOrder, nextSeen);
    }
    if (collection.kind === "match") {
      const scrutinee = evaluateTypedExpression(collection.scrutinee, environmentFor(collection.sourceOrder));
      const scrutineeValue = scrutinee.status === "ok" ? scrutinee.value : null;
      if (scrutineeValue === null || scrutineeValue.kind !== "choice") return { status: "error", type: field.type, issueCode: scrutinee.status === "error" ? scrutinee.issueCode : "evaluation-runtime-value-type-mismatch" };
      const arm = collection.arms.find((candidate) => candidate.label === scrutineeValue.value);
      return arm ? recordFieldFor(arm.valueId, index, field, sourceOrder, nextSeen) : { status: "error", type: field.type, issueCode: "evaluation-runtime-value-type-mismatch" };
    }
    if (collection.kind === "coalesce") {
      const leftPresent = presentFor(collection.leftValueId, sourceOrder, nextSeen);
      return leftPresent === true
        ? recordFieldFor(collection.leftValueId, index, field, sourceOrder, nextSeen)
        : leftPresent === false
          ? recordFieldFor(collection.rightValueId, index, field, sourceOrder, nextSeen)
          : { status: "error", type: field.type, issueCode: "evaluation-collection-index-unavailable" };
    }
    if (collection.kind === "recordField") return recordFieldFor(collection.sourceValueId, index, collection.field, sourceOrder, nextSeen);
    if (collection.kind === "recordMap") {
      const mappedField = collection.fields.find((candidate) => candidate.recordStatementId === field.recordStatementId && candidate.fieldIndex === field.fieldIndex);
      if (!mappedField) return { status: "error", type: field.type, issueCode: "evaluation-runtime-value-type-mismatch" };
      const binderFields = new Map(collection.binderFields.map((candidate) => [candidate.bindingId, candidate] as const));
      const mapped = evaluateTypedExpression(mappedField.body, {
        ...environmentFor(sourceOrder),
        lookupBinding: (bindingId) => {
          const binderField = binderFields.get(bindingId);
          return binderField
            ? recordFieldFor(collection.sourceValueId, index, binderField, sourceOrder, nextSeen)
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
    const value = resolveBinding(memberField.bindingId);
    if (value.status === "error") return value;
    return scalarExpressionTypesEqual(value.type, field.type) && scalarValueMatchesType(value.type, value.value)
      ? value
      : { status: "error", type: field.type, issueCode: "evaluation-runtime-value-type-mismatch" };
  };

  const indexFor = (
    collectionValueId: string,
    index: number,
    elementType: ScalarType,
    collectionLength: number | null,
    targetSourceOrder: number,
    sourceOrder: number,
    seen: ReadonlySet<string> = new Set()
  ): ScalarEvaluation => {
    if (targetSourceOrder >= sourceOrder) return { status: "error", type: elementType, issueCode: "evaluation-collection-index-unavailable" };
    if (!Number.isFinite(index) || !Number.isInteger(index) || index < 0 ||
      (collectionLength !== null && index >= collectionLength)) {
      return { status: "error", type: elementType, issueCode: "evaluation-collection-index-invalid" };
    }
    if (seen.has(collectionValueId)) return { status: "error", type: elementType, issueCode: "evaluation-collection-index-unavailable" };
    const collection = valuesById.get(collectionValueId);
    if (!collection) return { status: "error", type: elementType, issueCode: "evaluation-collection-index-unavailable" };
    const nextSeen = new Set([...seen, collectionValueId]);
    if (collection.kind === "none") return { status: "error", type: elementType, issueCode: "evaluation-collection-index-unavailable" };
    if (collection.kind === "alias") return indexFor(collection.targetValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, nextSeen);
    if (collection.kind === "if") {
      const condition = evaluateTypedExpression(collection.condition, environmentFor(collection.sourceOrder));
      if (condition.status === "error") return condition;
      if (condition.value.kind !== "boolean") return { status: "error", type: elementType, issueCode: "evaluation-runtime-value-type-mismatch" };
      return indexFor(condition.value.value ? collection.thenValueId : collection.elseValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, nextSeen);
    }
    if (collection.kind === "match") {
      const scrutinee = evaluateTypedExpression(collection.scrutinee, environmentFor(collection.sourceOrder));
      if (scrutinee.status === "error") return scrutinee;
      const scrutineeValue = scrutinee.value;
      if (scrutineeValue.kind !== "choice") return { status: "error", type: elementType, issueCode: "evaluation-runtime-value-type-mismatch" };
      const arm = collection.arms.find((candidate) => candidate.label === scrutineeValue.value);
      return arm
        ? indexFor(arm.valueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, nextSeen)
        : { status: "error", type: elementType, issueCode: "evaluation-runtime-value-type-mismatch" };
    }
    if (collection.kind === "coalesce") {
      const leftPresent = presentFor(collection.leftValueId, sourceOrder, nextSeen);
      return leftPresent === true
        ? indexFor(collection.leftValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, nextSeen)
        : leftPresent === false
          ? indexFor(collection.rightValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder, nextSeen)
          : { status: "error", type: elementType, issueCode: "evaluation-collection-index-unavailable" };
    }
    if (collection.kind === "map") {
      const source = indexFor(collection.sourceValueId, index, collection.sourceElementType, null, -1, sourceOrder, nextSeen);
      if (source.status === "error") return source;
      const mapped = evaluateTypedExpression(collection.body, {
        ...environmentFor(sourceOrder),
        lookupBinding: (bindingId) => bindingId === collection.binderId ? source : resolveBinding(bindingId)
      });
      if (mapped.status === "error") return mapped;
      return scalarExpressionTypesEqual(mapped.type, collection.resultElementType) && scalarValueMatchesType(mapped.type, mapped.value)
        ? mapped
        : { status: "error", type: collection.resultElementType, issueCode: "evaluation-runtime-value-type-mismatch" };
    }
    if (collection.kind === "recordField") {
      return recordFieldFor(collection.sourceValueId, index, collection.field, sourceOrder, nextSeen);
    }
    if (collection.kind === "recordMap") {
      return { status: "error", type: elementType, issueCode: "evaluation-runtime-value-type-mismatch" };
    }
    const member = collection.members[index];
    if (!member) return { status: "error", type: elementType, issueCode: "evaluation-collection-index-invalid" };
    if (member.kind === "record") return { status: "error", type: elementType, issueCode: "evaluation-runtime-value-type-mismatch" };
    const value = member.kind === "literal" ? { status: "ok" as const, type: member.type, value: member.value } : resolveBinding(member.bindingId);
    if (value.status === "error") return value;
    return scalarExpressionTypesEqual(value.type, elementType) && scalarValueMatchesType(value.type, value.value)
      ? value
      : { status: "error", type: elementType, issueCode: "evaluation-runtime-value-type-mismatch" };
  };

  function environmentFor(sourceOrder: number): ScalarEvaluationEnvironment {
    return {
      lookupBinding: resolveBinding,
      ...(resolveGeometryProperty ? { lookupGeometryProperty: (reference) => resolveGeometryProperty(reference, sourceOrder) } : {}),
      ...(resolveGeometryTarget ? { lookupGeometryTarget: (target) => resolveGeometryTarget(target, sourceOrder) } : {}),
      lookupCollectionLength: (collectionValueId) => lengthFor(collectionValueId, sourceOrder),
      lookupCollectionIndex: (collectionValueId, index, elementType, collectionLength, targetSourceOrder) =>
        indexFor(collectionValueId, index, elementType, collectionLength, targetSourceOrder, sourceOrder)
    };
  }

  return { environmentFor };
};

const isWithinEvaluationLimit = (
  program: ScalarProgram,
  statement: ScalarProgramStatement,
  postStopBindingIds: ReadonlySet<BindingId>
): boolean =>
  program.evaluationLimitSourceOrder === undefined ||
  statement.sourceOrder < program.evaluationLimitSourceOrder ||
  postStopBindingIds.has(statement.bindingId);

/**
 * Builds an on-demand resolver over `program`. Nothing is evaluated until
 * `resolve` is actually called for a given bindingId; a statement at or after
 * `program.evaluationLimitSourceOrder` (the `stop` cutoff) is treated as
 * absent unless its resolved bindingId is explicitly listed in
 * `postStopBindingIds` for a printLayout-local binding.
 */
export const createLazyScalarProgramEvaluator = (
  program: ScalarProgram,
  resolveGeometryProperty?: (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number) => ScalarEvaluation,
  resolveGeometryTarget?: (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number) => GeometryBuiltinTargetLookupResult | undefined,
  resolveCollectionLength?: (collectionValueId: string, sourceOrder: number) => number | undefined
): LazyScalarProgramEvaluator => {
  const postStopBindingIds = new Set(program.postStopBindingIds ?? []);
  const statementByBindingId = new Map<BindingId, ScalarProgramStatement>();
  for (const statement of program.statements) {
    if (isWithinEvaluationLimit(program, statement, postStopBindingIds)) statementByBindingId.set(statement.bindingId, statement);
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
      throw new Error(
        `createLazyScalarProgramEvaluator: cyclic reference detected while resolving ${bindingId} - ` +
          "a compiled ScalarProgram is expected to be acyclic (Task 13's binding-cycle diagnostic should " +
          "have rejected this document at compile time)"
      );
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
      cache.set(bindingId, evaluation);
      return evaluation;
    } finally {
      inProgressBindingIds.delete(bindingId);
    }
  };

  const collectionResolver = createScalarProgramCollectionResolver(
    program,
    resolve,
    resolveGeometryProperty,
    resolveGeometryTarget
  );

  return { resolve, ...(collectionResolver ? { collectionResolver } : {}) };
};

/**
 * Walks `program.statements` in array order (already source order) && pulls
 * each statement's value from `evaluator` - a memoized resolver, so anything
   * already resolved (e.g. by a property-materialization lookup made mid-run)
   * is a free cache hit here, never re-evaluated. This is what
 * guarantees the returned map's shape/insertion order is always the same
 * regardless of what order (if any) callers resolved bindings in beforehand,
 * so `computedScalarBindings`'s output stays byte-identical to the original
 * eager-sweep implementation.
 */
export const finalizeScalarProgramEvaluation = (
  program: ScalarProgram,
  evaluator: LazyScalarProgramEvaluator
): ScalarProgramEvaluation => {
  const postStopBindingIds = new Set(program.postStopBindingIds ?? []);
  const resultsByBindingId = new Map<BindingId, ScalarEvaluation>();
  for (const statement of program.statements) {
    if (!isWithinEvaluationLimit(program, statement, postStopBindingIds)) continue;
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
