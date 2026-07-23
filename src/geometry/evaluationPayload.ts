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

/** A Rust scalar-output failure is never eligible for reference fallback. */
export class ScalarOutputDecodeError extends Error {
  constructor(message: string) {
    super(`invalid computedScalarBindings payload: ${message}`);
    this.name = "ScalarOutputDecodeError";
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const failScalarOutput = (message: string): never => {
  throw new ScalarOutputDecodeError(message);
};

const parseComputedScalarBindings = (value: unknown): Map<BindingId, ScalarEvaluation> => {
  if (!Array.isArray(value)) return failScalarOutput("must be an array");

  const bindings = new Map<BindingId, ScalarEvaluation>();
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry) || Object.keys(entry).length !== 2 || !("bindingId" in entry) || !("evaluation" in entry)) {
      return failScalarOutput(`entry at index ${index} must contain only bindingId and evaluation`);
    }
    if (typeof entry.bindingId !== "string" || entry.bindingId.length === 0) {
      return failScalarOutput(`entry at index ${index} has an invalid bindingId`);
    }
    if (bindings.has(entry.bindingId)) {
      return failScalarOutput(`entry at index ${index} duplicates bindingId ${entry.bindingId}`);
    }
    try {
      bindings.set(entry.bindingId, parseScalarEvaluationJson(entry.evaluation));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failScalarOutput(`entry at index ${index} has an invalid evaluation: ${message}`);
    }
  }
  return bindings;
};

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
  /** Task 21: Rust and TypeScript share this JSON-friendly binding output. */
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
  ...(payload.computedScalarBindings !== undefined
    ? {
        computedScalarBindings: parseComputedScalarBindings(payload.computedScalarBindings)
      }
    : {})
});
