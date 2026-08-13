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

/**
 * Builds a resolver for a compiled nui 4 scalar program.
 */
export const createDocumentScalarBindingResolver = (
  program: ScalarProgram,
  geometry?: { computedGeometry: ReadonlyMap<ElementId, ComputedGeometry>; elementsById: ReadonlyMap<ElementId, CadElement> }
): ScalarBindingResolver => {
  const evaluator = createLazyScalarProgramEvaluator(program, geometry
    ? (reference, sourceOrder) => {
        if (!reference.elementId || reference.targetSourceOrder === null || reference.targetSourceOrder >= sourceOrder) {
          return { status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-property-unavailable" };
        }
        const value = computedReferencePathValue(geometry.computedGeometry.get(reference.elementId), reference.property);
        return typeof value === "number"
          ? { status: "ok", type: { kind: "number" }, value: { kind: "number", value } }
          : { status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-property-unavailable" };
      }
    : undefined);

  return {
    resolveBinding: evaluator.resolve,
    finalize: () => finalizeScalarProgramEvaluation(program, evaluator)
  };
};

/** Task 31's live document adapter for a Task 30 graph with linear sets. */
export const createDocumentLinearScalarBindingResolver = (
  graph: BindingVersionGraph,
  geometry?: { computedGeometry: ReadonlyMap<ElementId, ComputedGeometry>; elementsById: ReadonlyMap<ElementId, CadElement> }
): LinearScalarBindingResolver => {
  const evaluator = createIncrementalLinearMutationEvaluator(graph, geometry
    ? (reference, sourceOrder) => {
        if (!reference.elementId || reference.targetSourceOrder === null || reference.targetSourceOrder >= sourceOrder) {
          return { status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-property-unavailable" };
        }
        const value = computedReferencePathValue(geometry.computedGeometry.get(reference.elementId), reference.property);
        return typeof value === "number"
          ? { status: "ok", type: { kind: "number" }, value: { kind: "number", value } }
          : { status: "error", type: { kind: "number" }, issueCode: "evaluation-geometry-property-unavailable" };
      }
    : undefined);
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
