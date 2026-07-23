import type {
  ComputedGeometry,
  ComputedVariable,
  DependencyError,
  ElementId,
  EvaluationResult,
  EvaluationWarning,
  ForGroupGeneratedRow
} from "../types/geometry";
import type { BindingId } from "../scalars/bindingCatalog";
import { parseScalarEvaluationJson } from "../scalars/scalarJson";
import type { ScalarEvaluation } from "../scalars/types";

export type ScalarBindingEvaluationPayload = { bindingId: BindingId; evaluation: ScalarEvaluation };

export type EvaluationPayload = {
  computedGeometry: ComputedGeometry[];
  computedVariables: ComputedVariable[];
  errors: DependencyError[];
  warnings: EvaluationWarning[];
  evaluatedElementIds: ElementId[];
  evaluationLimitIndex: number;
  effectiveVisibleElementIds: ElementId[];
  effectiveEnabledElementIds: ElementId[];
  conditionInactiveElementIds?: ElementId[];
  forGroupGeneratedRows?: ForGroupGeneratedRow[];
  /** Task 20: TS-reference-only until Task 21 gives Rust a matching field - see EvaluationResult.computedScalarBindings. */
  computedScalarBindings?: ScalarBindingEvaluationPayload[];
};

export const evaluationResultToPayload = (result: EvaluationResult): EvaluationPayload => ({
  computedGeometry: Array.from(result.computedGeometry.values()),
  computedVariables: Array.from(result.computedVariables.values()),
  errors: result.errors,
  warnings: result.warnings,
  evaluatedElementIds: Array.from(result.evaluatedElementIds ?? []),
  evaluationLimitIndex: result.evaluationLimitIndex ?? result.evaluatedElementIds?.size ?? 0,
  effectiveVisibleElementIds: Array.from(result.effectiveVisibleElementIds ?? []),
  effectiveEnabledElementIds: Array.from(result.effectiveEnabledElementIds ?? []),
  conditionInactiveElementIds: Array.from(result.conditionInactiveElementIds ?? []),
  forGroupGeneratedRows: result.forGroupGeneratedRows?.length
    ? result.forGroupGeneratedRows
    : undefined,
  computedScalarBindings: result.computedScalarBindings
    ? Array.from(result.computedScalarBindings, ([bindingId, evaluation]) => ({ bindingId, evaluation }))
    : undefined
});

export const evaluationPayloadToResult = (payload: EvaluationPayload): EvaluationResult => ({
  computedGeometry: new Map(payload.computedGeometry.map((geometry) => [geometry.elementId, geometry])),
  computedVariables: new Map(payload.computedVariables.map((variable) => [variable.elementId, variable])),
  errors: payload.errors,
  warnings: payload.warnings,
  evaluatedElementIds: new Set(payload.evaluatedElementIds),
  evaluationLimitIndex: payload.evaluationLimitIndex,
  effectiveVisibleElementIds: new Set(payload.effectiveVisibleElementIds),
  effectiveEnabledElementIds: new Set(payload.effectiveEnabledElementIds),
  conditionInactiveElementIds: new Set(payload.conditionInactiveElementIds ?? []),
  forGroupGeneratedRows: payload.forGroupGeneratedRows ?? [],
  ...(payload.computedScalarBindings
    ? {
        computedScalarBindings: new Map(
          payload.computedScalarBindings.map(({ bindingId, evaluation }) => [bindingId, parseScalarEvaluationJson(evaluation)])
        )
      }
    : {})
});
