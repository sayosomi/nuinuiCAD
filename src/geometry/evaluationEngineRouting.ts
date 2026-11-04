import type { CadElement, EvaluationResult } from "../types/geometry";
import type { EvaluateElementsOptions } from "./evaluate";
import { ScalarOutputDecodeError } from "./evaluationPayload";
import { canUseRustEvaluationForElements } from "./rustEvaluationEligibility";
import type { RustEvaluationTransport } from "./rustEvaluationRunner";
import {
  emptyEvaluationResult,
  evaluateElementsReference,
  evaluateElementsWithRust,
  evaluationResultsMatch,
  getEvaluationEngineMode,
  isParityEvaluationEngineMode
} from "./evaluationEngine";

/** Shared production routing for live Canvas and transient evaluation requests. */
export const evaluationEngineRoutingFor = (
  elements: CadElement[], options: EvaluateElementsOptions, rustTransportAvailable: boolean
) => {
  const mode = getEvaluationEngineMode(rustTransportAvailable);
  const rustEligible = canUseRustEvaluationForElements(elements, options);
  const parityMode = isParityEvaluationEngineMode(mode);
  const deferScalarReferenceEvaluation = parityMode && options.scalarProgram !== undefined && rustTransportAvailable && rustEligible;
  return {
    mode, rustEligible, parityMode, deferScalarReferenceEvaluation,
    needsReferenceEvaluation: (!rustTransportAvailable || mode !== "rust" || !rustEligible) && !deferScalarReferenceEvaluation
  };
};

type Routing = ReturnType<typeof evaluationEngineRoutingFor>;

export type RoutedRustEvaluation = {
  evaluation: EvaluationResult;
  source: "rust" | "fallback";
  status: "ready" | "failed";
  error: unknown | null;
  shadowReferenceEvaluation?: EvaluationResult;
};

/** The existing asynchronous Canvas policy, including scalar validation before
 * shadow/reference work and the restricted fallback after transport failures. */
export const evaluateRoutedRust = async ({
  elements, options, transport, routing, referenceEvaluation, emptyEvaluation,
  isCanceled = () => false
}: {
  elements: CadElement[];
  options: EvaluateElementsOptions;
  transport: RustEvaluationTransport;
  routing: Routing;
  referenceEvaluation: EvaluationResult | null;
  emptyEvaluation: EvaluationResult;
  isCanceled?: () => boolean;
}): Promise<RoutedRustEvaluation | null> => {
  try {
    const evaluation = await evaluateElementsWithRust(elements, options, transport);
    if (isCanceled()) return null;
    const shadowReferenceEvaluation = routing.deferScalarReferenceEvaluation
      ? evaluateElementsReference(elements, options) : undefined;
    const comparisonReferenceEvaluation = shadowReferenceEvaluation ?? referenceEvaluation;
    if (routing.parityMode && comparisonReferenceEvaluation && !evaluationResultsMatch(comparisonReferenceEvaluation, evaluation)) {
      console.warn("Rust evaluation differs from the TypeScript reference evaluation.", {
        referenceEvaluation: comparisonReferenceEvaluation,
        rustEvaluation: evaluation
      });
    }
    return { evaluation, source: "rust", status: "ready", error: null, shadowReferenceEvaluation };
  } catch (error: unknown) {
    if (isCanceled()) return null;
    if (options.scalarProgram !== undefined || error instanceof ScalarOutputDecodeError) {
      console.error("Rust scalar evaluation failed; preserving the command failure.", error);
      return { evaluation: emptyEvaluation, source: "rust", status: "failed", error };
    }
    console.error("Rust evaluation failed; using the TypeScript reference evaluation.", error);
    return {
      evaluation: referenceEvaluation ?? evaluateElementsReference(elements, options),
      source: "fallback", status: "failed", error
    };
  }
};

/** Complete one transient request using the same policy as the live hook.
 * Parity/shadow return reference geometry after their comparison completes;
 * fatal Rust failures propagate instead of becoming selectable empty geometry. */
export const evaluateElementsWithEngine = async (
  elements: CadElement[], options: EvaluateElementsOptions, transport?: RustEvaluationTransport
): Promise<EvaluationResult> => {
  const routing = evaluationEngineRoutingFor(elements, options, transport !== undefined);
  const referenceEvaluation = routing.needsReferenceEvaluation ? evaluateElementsReference(elements, options) : null;
  if (!transport || routing.mode === "reference" || !routing.rustEligible) return referenceEvaluation!;
  const result = await evaluateRoutedRust({
    elements, options, transport, routing, referenceEvaluation,
    emptyEvaluation: emptyEvaluationResult(elements, options)
  });
  if (!result) throw new Error("Evaluation canceled");
  if (result.status === "failed" && result.source === "rust") throw result.error;
  return routing.parityMode
    ? result.shadowReferenceEvaluation ?? referenceEvaluation ?? result.evaluation
    : result.evaluation;
};
