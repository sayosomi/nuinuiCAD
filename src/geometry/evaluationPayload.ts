import type {
  ComputedGeometry,
  DependencyError,
  DrawingModifierStroke,
  ElementId,
  EvaluationResult,
  EvaluationWarning,
  ForGroupGeneratedRow,
  GeometryMutationExecution
} from "../types/geometry";
import type { BindingId } from "../scalars/bindingCatalog";
import type { BindingVersionId } from "../scalars/bindingVersions";
import type { BindingVersionRuntimeHistory } from "../scalars/linearMutationEvaluator";
import { parseScalarEvaluationJson } from "../scalars/scalarJson";
import type { ScalarEvaluation } from "../scalars/types";

export type ScalarBindingEvaluationPayload = { bindingId: BindingId; evaluation: ScalarEvaluation };
export type ScalarBindingVersionEvaluationPayload = BindingVersionRuntimeHistory;

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
      return failScalarOutput(`entry at index ${index} must contain only bindingId && evaluation`);
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

const parseComputedScalarBindingVersions = (value: unknown): Map<BindingVersionId, BindingVersionRuntimeHistory> => {
  if (!Array.isArray(value)) return failScalarOutput("computedScalarBindingVersions must be an array");
  const history = new Map<BindingVersionId, BindingVersionRuntimeHistory>();
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry) || typeof entry.versionId !== "string" || !entry.versionId ||
      typeof entry.statementId !== "string" || !entry.statementId ||
      typeof entry.bindingId !== "string" || !entry.bindingId ||
      (entry.status !== "executed" && entry.status !== "poisoned" && entry.status !== "skipped-control" && entry.status !== "inactive-control")) {
      return failScalarOutput(`computedScalarBindingVersions entry at index ${index} is malformed`);
    }
    if (history.has(entry.versionId)) return failScalarOutput(`computedScalarBindingVersions duplicates versionId ${entry.versionId}`);
    if (entry.status === "skipped-control" || entry.status === "inactive-control") {
      if (Object.keys(entry).length !== 4) return failScalarOutput(`skipped history entry at index ${index} has unexpected fields`);
      history.set(entry.versionId, entry as BindingVersionRuntimeHistory);
      continue;
    }
    if (Object.keys(entry).length !== 5 || !("evaluation" in entry)) {
      return failScalarOutput(`executed history entry at index ${index} must contain evaluation`);
    }
    try {
      history.set(entry.versionId, { ...entry, evaluation: parseScalarEvaluationJson(entry.evaluation) } as BindingVersionRuntimeHistory);
    } catch (error) {
      return failScalarOutput(`history entry at index ${index} has invalid evaluation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return history;
};

export type EvaluationPayload = {
  computedGeometry: ComputedGeometry[];
  preMutationGeometry?: ComputedGeometry[];
  geometryMutationExecutions?: GeometryMutationExecution[];
  instanceBaseGeometry?: Array<{ instanceId: ElementId; geometry: ComputedGeometry[] }>;
  errors: DependencyError[];
  warnings: EvaluationWarning[];
  evaluatedElementIds: ElementId[];
  evaluationLimitIndex: number;
  effectiveVisibleElementIds: ElementId[];
  effectiveEnabledElementIds: ElementId[];
  effectiveDrawingModifierStrokes?: Array<{ elementId: ElementId; stroke: DrawingModifierStroke }>;
  conditionInactiveElementIds?: ElementId[];
  forGroupGeneratedRows?: ForGroupGeneratedRow[];
  /** Task 25: `forGroup` ids whose generated-result presentation is enabled. */
  forGroupEffectiveShowGeneratedIds?: ElementId[];
  /** Task 21: Rust && TypeScript share this JSON-friendly binding output. */
  computedScalarBindings?: ScalarBindingEvaluationPayload[];
  computedScalarBindingVersions?: ScalarBindingVersionEvaluationPayload[];
};

export const evaluationResultToPayload = (result: EvaluationResult): EvaluationPayload => ({
  computedGeometry: Array.from(result.computedGeometry.values()),
  preMutationGeometry: result.preMutationGeometry?.size
    ? Array.from(result.preMutationGeometry.values())
    : undefined,
  geometryMutationExecutions: result.geometryMutationExecutions?.length
    ? result.geometryMutationExecutions
    : undefined,
  instanceBaseGeometry: result.instanceBaseGeometry?.size
    ? Array.from(result.instanceBaseGeometry, ([instanceId, geometry]) => ({ instanceId, geometry }))
    : undefined,
  errors: result.errors,
  warnings: result.warnings,
  evaluatedElementIds: Array.from(result.evaluatedElementIds ?? []),
  evaluationLimitIndex: result.evaluationLimitIndex ?? result.evaluatedElementIds?.size ?? 0,
  effectiveVisibleElementIds: Array.from(result.effectiveVisibleElementIds ?? []),
  effectiveEnabledElementIds: Array.from(result.effectiveEnabledElementIds ?? []),
  effectiveDrawingModifierStrokes: result.effectiveDrawingModifierStrokes?.size
    ? Array.from(result.effectiveDrawingModifierStrokes, ([elementId, stroke]) => ({ elementId, stroke }))
    : undefined,
  conditionInactiveElementIds: Array.from(result.conditionInactiveElementIds ?? []),
  forGroupGeneratedRows: result.forGroupGeneratedRows?.length
    ? result.forGroupGeneratedRows
    : undefined,
  forGroupEffectiveShowGeneratedIds: Array.from(result.forGroupEffectiveShowGeneratedIds ?? []),
  computedScalarBindings: result.computedScalarBindings
    ? Array.from(result.computedScalarBindings, ([bindingId, evaluation]) => ({ bindingId, evaluation }))
    : undefined,
  computedScalarBindingVersions: result.computedScalarBindingVersions
    ? Array.from(result.computedScalarBindingVersions.values())
    : undefined
});

export const evaluationPayloadToResult = (payload: EvaluationPayload): EvaluationResult => ({
  computedGeometry: new Map(payload.computedGeometry.map((geometry) => [geometry.elementId, geometry])),
  preMutationGeometry: new Map(
    (payload.preMutationGeometry ?? []).map((geometry) => [geometry.elementId, geometry])
  ),
  geometryMutationExecutions: payload.geometryMutationExecutions ?? [],
  instanceBaseGeometry: new Map(
    (payload.instanceBaseGeometry ?? []).map(({ instanceId, geometry }) => [instanceId, geometry])
  ),
  errors: payload.errors,
  warnings: payload.warnings,
  evaluatedElementIds: new Set(payload.evaluatedElementIds),
  evaluationLimitIndex: payload.evaluationLimitIndex,
  effectiveVisibleElementIds: new Set(payload.effectiveVisibleElementIds),
  effectiveEnabledElementIds: new Set(payload.effectiveEnabledElementIds),
  effectiveDrawingModifierStrokes: new Map(
    (payload.effectiveDrawingModifierStrokes ?? []).map(({ elementId, stroke }) => [elementId, stroke])
  ),
  conditionInactiveElementIds: new Set(payload.conditionInactiveElementIds ?? []),
  forGroupGeneratedRows: payload.forGroupGeneratedRows ?? [],
  forGroupEffectiveShowGeneratedIds: new Set(payload.forGroupEffectiveShowGeneratedIds ?? []),
  ...(payload.computedScalarBindings !== undefined
    ? {
        computedScalarBindings: parseComputedScalarBindings(payload.computedScalarBindings)
      }
    : {}),
  ...(payload.computedScalarBindingVersions !== undefined
    ? { computedScalarBindingVersions: parseComputedScalarBindingVersions(payload.computedScalarBindingVersions) }
    : {})
});
