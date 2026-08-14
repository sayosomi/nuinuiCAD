import type { CadElement, ComputedGeometry, ElementId } from "../types/geometry";
import { computedReferencePathValue } from "./numericExpressions";
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
import type { ScalarProgram } from "../scalars/scalarProgram";
import type { BindingId } from "../scalars/bindingCatalog";
import type { ScalarEvaluation } from "../scalars/types";
import type { ScalarExpressionResolvedGeometryTarget, TypedScalarGeometryPropertyReferenceNode } from "../scalars/typedExpressionAst";

/**
 * A scalar-program binding resolver for one compiled nui 4 document.
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

type DocumentGeometryRuntime = {
  computedGeometry: ReadonlyMap<ElementId, ComputedGeometry>;
  elementsById: ReadonlyMap<ElementId, CadElement>;
};

const resolveDocumentGeometryTarget = (
  geometry: DocumentGeometryRuntime,
  target: ScalarExpressionResolvedGeometryTarget,
  sourceOrder: number
): ComputedGeometry | undefined => {
  if (target.statementIndex >= sourceOrder || !geometry.elementsById.has(target.statementId)) return undefined;
  return geometry.computedGeometry.get(target.statementId);
};

/**
 * Builds a resolver for a compiled nui 4 scalar program.
 */
export const createDocumentScalarBindingResolver = (
  program: ScalarProgram,
  geometry?: DocumentGeometryRuntime
): ScalarBindingResolver => {
  const resolveGeometryProperty = geometry
    ? (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number): ScalarEvaluation => {
        if (!reference.elementId || reference.targetSourceOrder === null || reference.targetSourceOrder >= sourceOrder) {
          return { status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-property-unavailable" };
        }
        const value = computedReferencePathValue(geometry.computedGeometry.get(reference.elementId), reference.property);
        return typeof value === "number"
          ? { status: "ok", type: { kind: "number" }, value: { kind: "number", value } }
          : { status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-property-unavailable" };
      }
    : undefined;
  const resolveGeometryTarget = geometry
    ? (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number): ComputedGeometry | undefined => {
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
  geometry?: DocumentGeometryRuntime
): LinearScalarBindingResolver => {
  const resolveGeometryProperty = geometry
    ? (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number): ScalarEvaluation => {
        if (!reference.elementId || reference.targetSourceOrder === null || reference.targetSourceOrder >= sourceOrder) {
          return { status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-property-unavailable" };
        }
        const value = computedReferencePathValue(geometry.computedGeometry.get(reference.elementId), reference.property);
        return typeof value === "number"
          ? { status: "ok", type: { kind: "number" }, value: { kind: "number", value } }
          : { status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-property-unavailable" };
      }
    : undefined;
  const resolveGeometryTarget = geometry
    ? (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number): ComputedGeometry | undefined => {
        return resolveDocumentGeometryTarget(geometry, target, sourceOrder);
      }
    : undefined;
  const evaluator = createIncrementalLinearMutationEvaluator(graph, resolveGeometryProperty, resolveGeometryTarget);
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
