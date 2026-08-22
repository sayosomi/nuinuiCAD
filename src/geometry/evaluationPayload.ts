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
import { parseConditionEvaluationTraceJson, type ConditionEvaluationTrace } from "../scalars/conditionEvaluationTrace";
import type { ScalarEvaluation } from "../scalars/types";
import {
  effectiveDrawingModifierResolutionsFromResult,
  type DrawingModifierPropertyWinner,
  type EffectiveDrawingModifierResolution,
  type EvaluationResultWithDrawingModifierInspection
} from "../model/drawingModifierInspection";

export type ScalarBindingEvaluationPayload = { bindingId: BindingId; evaluation: ScalarEvaluation };
export type ScalarBindingVersionEvaluationPayload = BindingVersionRuntimeHistory;

/** A Rust scalar-output failure is never eligible for reference fallback. */
export class ScalarOutputDecodeError extends Error {
  constructor(message: string) {
    super(`invalid computedScalarBindings payload: ${message}`);
    this.name = "ScalarOutputDecodeError";
  }
}

export class DrawingModifierInspectionDecodeError extends Error {
  constructor(message: string) {
    super(`invalid effectiveDrawingModifierResolutions payload: ${message}`);
    this.name = "DrawingModifierInspectionDecodeError";
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const failScalarOutput = (message: string): never => {
  throw new ScalarOutputDecodeError(message);
};

const failModifierInspection = (message: string): never => {
  throw new DrawingModifierInspectionDecodeError(message);
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

const parseConditionEvaluationTraces = (value: unknown): Map<ElementId, ConditionEvaluationTrace> => {
  if (!Array.isArray(value)) return failScalarOutput("conditionEvaluationTraces must be an array");
  const traces = new Map<ElementId, ConditionEvaluationTrace>();
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry) || Object.keys(entry).length !== 2 || !("elementId" in entry) || !("trace" in entry)) {
      return failScalarOutput(`conditionEvaluationTraces entry at index ${index} must contain only elementId && trace`);
    }
    if (typeof entry.elementId !== "string" || entry.elementId.length === 0) {
      return failScalarOutput(`conditionEvaluationTraces entry at index ${index} has an invalid elementId`);
    }
    if (traces.has(entry.elementId)) {
      return failScalarOutput(`conditionEvaluationTraces duplicates elementId ${entry.elementId}`);
    }
    try {
      traces.set(entry.elementId, parseConditionEvaluationTraceJson(entry.trace));
    } catch (error) {
      return failScalarOutput(`conditionEvaluationTraces entry at index ${index} has an invalid trace: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return traces;
};

const parseModifierWinner = (value: unknown, path: string): DrawingModifierPropertyWinner | null => {
  if (value === null) return null;
  if (!isPlainObject(value) || Object.keys(value).length !== 3 ||
    typeof value.ownerElementId !== "string" || !value.ownerElementId ||
    typeof value.modifierName !== "string" || !value.modifierName ||
    !("selectedProfileDelta" in value)) {
    return failModifierInspection(`${path}.winner is malformed`);
  }
  const profile = value.selectedProfileDelta;
  if (profile !== null && (
    !isPlainObject(profile) || Object.keys(profile).length !== 2 ||
    typeof profile.profileId !== "string" || !profile.profileId ||
    typeof profile.profileName !== "string" || !profile.profileName
  )) {
    return failModifierInspection(`${path}.winner.selectedProfileDelta is malformed`);
  }
  return {
    ownerElementId: value.ownerElementId,
    modifierName: value.modifierName,
    selectedProfileDelta: profile === null
      ? null
      : { profileId: profile.profileId as string, profileName: profile.profileName as string }
  };
};

const parseModifierProperty = (
  value: unknown,
  path: string,
  parseValue: (nested: unknown) => unknown
) => {
  if (!isPlainObject(value) || Object.keys(value).length !== 2 || !("value" in value) || !("winner" in value)) {
    return failModifierInspection(`${path} must contain only value && winner`);
  }
  return {
    value: parseValue(value.value),
    winner: parseModifierWinner(value.winner, path)
  };
};

const parseModifierState = (value: unknown, path: string) => {
  if (value !== "visible" && value !== "hidden" && value !== "disabled") {
    return failModifierInspection(`${path}.value is not an activity state`);
  }
  return value;
};

const parseModifierWidth = (value: unknown, path: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return failModifierInspection(`${path}.value is not a finite number`);
  }
  return value;
};

const parseModifierStyle = (value: unknown, path: string) => {
  if (value !== "solid" && value !== "dashed" && value !== "dotted") {
    return failModifierInspection(`${path}.value is not a stroke style`);
  }
  return value;
};

const parseModifierColor = (value: unknown, path: string) => {
  if (!isPlainObject(value) || typeof value.kind !== "string") {
    return failModifierInspection(`${path}.value is not a stroke color`);
  }
  if (value.kind === "fixed" && Object.keys(value).length === 2 && typeof value.hex === "string") {
    return { kind: "fixed" as const, hex: value.hex };
  }
  if (value.kind === "themeRole" && Object.keys(value).length === 2 &&
    (value.role === "foreground" || value.role === "muted" || value.role === "accent" ||
      value.role === "info" || value.role === "warning" || value.role === "error")) {
    return { kind: "themeRole" as const, role: value.role };
  }
  return failModifierInspection(`${path}.value is not a supported stroke color`);
};

const parseEffectiveDrawingModifierResolutions = (
  value: unknown
): Map<ElementId, EffectiveDrawingModifierResolution> => {
  if (!Array.isArray(value)) return failModifierInspection("must be an array");
  const resolutions = new Map<ElementId, EffectiveDrawingModifierResolution>();
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry) || Object.keys(entry).length !== 2 ||
      typeof entry.elementId !== "string" || !entry.elementId || !("resolution" in entry)) {
      return failModifierInspection(`entry at index ${index} must contain only elementId && resolution`);
    }
    if (resolutions.has(entry.elementId)) {
      return failModifierInspection(`entry at index ${index} duplicates elementId ${entry.elementId}`);
    }
    const resolution = entry.resolution;
    if (!isPlainObject(resolution) || Object.keys(resolution).length !== 4 ||
      !("state" in resolution) || !("widthPx" in resolution) || !("style" in resolution) || !("color" in resolution)) {
      return failModifierInspection(`entry at index ${index} has a malformed resolution`);
    }
    resolutions.set(entry.elementId, {
      state: parseModifierProperty(
        resolution.state,
        `entry at index ${index}.resolution.state`,
        (nested) => parseModifierState(nested, `entry at index ${index}.resolution.state`)
      ) as EffectiveDrawingModifierResolution["state"],
      widthPx: parseModifierProperty(
        resolution.widthPx,
        `entry at index ${index}.resolution.widthPx`,
        (nested) => parseModifierWidth(nested, `entry at index ${index}.resolution.widthPx`)
      ) as EffectiveDrawingModifierResolution["widthPx"],
      style: parseModifierProperty(
        resolution.style,
        `entry at index ${index}.resolution.style`,
        (nested) => parseModifierStyle(nested, `entry at index ${index}.resolution.style`)
      ) as EffectiveDrawingModifierResolution["style"],
      color: parseModifierProperty(
        resolution.color,
        `entry at index ${index}.resolution.color`,
        (nested) => parseModifierColor(nested, `entry at index ${index}.resolution.color`)
      ) as EffectiveDrawingModifierResolution["color"]
    });
  }
  return resolutions;
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
  effectiveDrawingModifierResolutions?: Array<{
    elementId: ElementId;
    resolution: EffectiveDrawingModifierResolution;
  }>;
  conditionInactiveElementIds?: ElementId[];
  conditionEvaluationTraces?: Array<{ elementId: ElementId; trace: ConditionEvaluationTrace }>;
  forGroupGeneratedRows?: ForGroupGeneratedRow[];
  /** Task 25: `forGroup` ids whose generated-result presentation is enabled. */
  forGroupEffectiveShowGeneratedIds?: ElementId[];
  /** Task 21: Rust && TypeScript share this JSON-friendly binding output. */
  computedScalarBindings?: ScalarBindingEvaluationPayload[];
  computedScalarBindingVersions?: ScalarBindingVersionEvaluationPayload[];
};

export const evaluationResultToPayload = (result: EvaluationResult): EvaluationPayload => {
  const modifierResolutions = effectiveDrawingModifierResolutionsFromResult(result);
  return {
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
    effectiveDrawingModifierResolutions: modifierResolutions.size
      ? Array.from(modifierResolutions, ([elementId, resolution]) => ({ elementId, resolution }))
      : undefined,
    conditionInactiveElementIds: Array.from(result.conditionInactiveElementIds ?? []),
    conditionEvaluationTraces: result.conditionEvaluationTraces?.size
      ? Array.from(result.conditionEvaluationTraces, ([elementId, trace]) => ({ elementId, trace }))
      : undefined,
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
  };
};

export const evaluationPayloadToResult = (
  payload: EvaluationPayload
): EvaluationResultWithDrawingModifierInspection => ({
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
  effectiveDrawingModifierResolutions: payload.effectiveDrawingModifierResolutions !== undefined
    ? parseEffectiveDrawingModifierResolutions(payload.effectiveDrawingModifierResolutions)
    : new Map(),
  conditionInactiveElementIds: new Set(payload.conditionInactiveElementIds ?? []),
  conditionEvaluationTraces: payload.conditionEvaluationTraces !== undefined
    ? parseConditionEvaluationTraces(payload.conditionEvaluationTraces)
    : new Map(),
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
