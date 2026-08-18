import { invoke } from "@tauri-apps/api/core";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { evaluateElements, type EvaluateElementsOptions } from "./evaluate";
import {
  evaluationResultToPayload,
  type EvaluationPayload
} from "./evaluationPayload";
import {
  evaluatePreparedRust,
  prepareRustEvaluation,
  type RustEvaluationTransport
} from "./rustEvaluationRunner";
import {
  beginRustRoundTrip,
  finishRustRoundTrip
} from "../performance/benchmarkInstrumentation";

export type EvaluationEngineMode = "reference" | "parity" | "shadow" | "rust";

const configuredEvaluationEngineMode = (
  value: string | undefined
): EvaluationEngineMode | null => {
  if (value === "reference" || value === "parity" || value === "shadow" || value === "rust") {
    return value;
  }
  return null;
};

export const resolveEvaluationEngineMode = ({
  configuredMode,
  tauriRuntime
}: {
  configuredMode?: string;
  tauriRuntime: boolean;
  dev: boolean;
}): EvaluationEngineMode => {
  const configured = configuredEvaluationEngineMode(configuredMode);
  if (configured) return configured;
  if (!tauriRuntime) return "reference";
  return "rust";
};

export const isParityEvaluationEngineMode = (mode: EvaluationEngineMode) =>
  mode === "parity" || mode === "shadow";

export const getEvaluationEngineMode = (tauriRuntime = isTauriRuntime()): EvaluationEngineMode =>
  resolveEvaluationEngineMode({
    configuredMode: import.meta.env.VITE_EVALUATION_ENGINE,
    tauriRuntime,
    dev: import.meta.env.DEV
  });

export const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const evaluateElementsReference = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
) => evaluateElements(elements, options);

export const emptyEvaluationResult = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
): EvaluationResult => {
  const evaluationLimitIndex = Math.min(
    Math.max(options.evaluationLimitIndex ?? elements.length, 0),
    elements.length
  );
  return {
    computedGeometry: new Map(),
    errors: [],
    warnings: [],
    evaluatedElementIds: new Set(),
    evaluationLimitIndex,
    effectiveVisibleElementIds: new Set(),
    effectiveEnabledElementIds: new Set(),
    effectiveDrawingModifierStrokes: new Map()
  };
};

export const evaluateElementsReferencePayload = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
): EvaluationPayload => evaluationResultToPayload(evaluateElementsReference(elements, options));

const tauriRustEvaluationTransport: RustEvaluationTransport = (input) =>
  invoke<EvaluationPayload>("evaluate_document", { input });

export const evaluateElementsWithRust = async (
  elements: CadElement[],
  options: EvaluateElementsOptions = {},
  transport: RustEvaluationTransport = tauriRustEvaluationTransport
): Promise<EvaluationResult> => {
  const prepared = prepareRustEvaluation(elements, options);
  const rustAttempt = beginRustRoundTrip(elements);
  const result = await evaluatePreparedRust(prepared, transport);
  finishRustRoundTrip(rustAttempt, result);
  return result;
};

const normalizeEvaluationPayloadForComparison = (value: unknown): unknown => {
  if (typeof value === "number") {
    const normalized = Math.round(value * 1e7) / 1e7;
    return Object.is(normalized, -0) ? 0 : normalized;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeEvaluationPayloadForComparison);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeEvaluationPayloadForComparison(nested)])
    );
  }
  return value;
};

const payloadForComparison = (result: EvaluationResult) =>
  JSON.stringify(normalizeEvaluationPayloadForComparison(evaluationResultToPayload(result)));

export const evaluationResultsMatch = (
  left: EvaluationResult,
  right: EvaluationResult
) => payloadForComparison(left) === payloadForComparison(right);
