import type {
  ComputedGeometry,
  ComputedVariable,
  DependencyError,
  ElementId,
  EvaluationResult,
  EvaluationWarning
} from "../types/geometry";

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
  conditionInactiveElementIds: Array.from(result.conditionInactiveElementIds ?? [])
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
  conditionInactiveElementIds: new Set(payload.conditionInactiveElementIds ?? [])
});
