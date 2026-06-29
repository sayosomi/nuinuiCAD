import { useEffect, useMemo, useState } from "react";
import type { CadElement, EvaluationResult } from "../types/geometry";
import type { EvaluateElementsOptions } from "./evaluate";
import {
  canUseRustEvaluationForElements,
  emptyEvaluationResult,
  type EvaluationEngineMode,
  evaluateElementsReference,
  evaluateElementsWithRust,
  evaluationResultsMatch,
  getEvaluationEngineMode,
  isTauriRuntime
} from "./evaluationEngine";

export type EvaluationSource = "reference" | "rust" | "fallback";
export type EvaluationStatus = "idle" | "evaluating" | "ready" | "failed";

export type EvaluationEngineState = {
  evaluation: EvaluationResult;
  mode: EvaluationEngineMode;
  source: EvaluationSource;
  status: EvaluationStatus;
  rustEligible: boolean;
  isStale: boolean;
  error: unknown | null;
};

type AsyncEvaluationState = {
  requestKey: string;
  evaluation: EvaluationResult;
  source: Exclude<EvaluationSource, "reference">;
  status: Extract<EvaluationStatus, "ready" | "failed">;
  error: unknown | null;
};

export const useEvaluationEngine = (
  elements: CadElement[],
  options: EvaluateElementsOptions
): EvaluationEngineState => {
  const evaluationLimitIndex = options.evaluationLimitIndex;
  const evaluationOptions = useMemo(
    () => ({ evaluationLimitIndex }),
    [evaluationLimitIndex]
  );
  const engineMode = getEvaluationEngineMode();
  const tauriRuntime = isTauriRuntime();
  const rustEligible = canUseRustEvaluationForElements(elements, evaluationOptions);
  const requestKey = useMemo(
    () => JSON.stringify({ elements, evaluationLimitIndex }),
    [elements, evaluationLimitIndex]
  );
  const needsReferenceEvaluation = !tauriRuntime || engineMode !== "rust" || !rustEligible;
  const referenceEvaluation = useMemo(
    () => (needsReferenceEvaluation ? evaluateElementsReference(elements, evaluationOptions) : null),
    [elements, evaluationOptions, needsReferenceEvaluation]
  );
  const [asyncEvaluation, setAsyncEvaluation] = useState<AsyncEvaluationState | null>(null);
  const emptyEvaluation = useMemo(
    () => emptyEvaluationResult(elements, evaluationOptions),
    [elements, evaluationOptions]
  );

  useEffect(() => {
    if (!tauriRuntime || engineMode === "reference" || !rustEligible) {
      return;
    }

    let cancelled = false;
    evaluateElementsWithRust(elements, evaluationOptions)
      .then((nextEvaluation) => {
        if (cancelled) return;
        setAsyncEvaluation({
          requestKey,
          evaluation: nextEvaluation,
          source: "rust",
          status: "ready",
          error: null
        });
        if (
          engineMode === "shadow" &&
          referenceEvaluation &&
          !evaluationResultsMatch(referenceEvaluation, nextEvaluation)
        ) {
          console.warn("Rust evaluation differs from the TypeScript reference evaluation.", {
            referenceEvaluation,
            rustEvaluation: nextEvaluation
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("Rust evaluation failed; using the TypeScript reference evaluation.", error);
          setAsyncEvaluation(
            engineMode === "rust"
              ? {
                  requestKey,
                  evaluation: evaluateElementsReference(elements, evaluationOptions),
                  source: "fallback",
                  status: "failed",
                  error
                }
              : {
                  requestKey,
                  evaluation: referenceEvaluation ?? evaluateElementsReference(elements, evaluationOptions),
                  source: "fallback",
                  status: "failed",
                  error
                }
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    elements,
    engineMode,
    evaluationOptions,
    referenceEvaluation,
    requestKey,
    rustEligible,
    tauriRuntime
  ]);

  if (engineMode === "reference" || !rustEligible || !tauriRuntime) {
    return {
      evaluation: referenceEvaluation ?? emptyEvaluation,
      mode: engineMode,
      source: "reference",
      status: "idle",
      rustEligible,
      isStale: false,
      error: null
    };
  }

  if (engineMode === "shadow") {
    const isCurrentAsyncEvaluation = asyncEvaluation?.requestKey === requestKey;
    return {
      evaluation: referenceEvaluation ?? emptyEvaluation,
      mode: engineMode,
      source: "reference",
      status: isCurrentAsyncEvaluation ? asyncEvaluation.status : "evaluating",
      rustEligible,
      isStale: false,
      error: isCurrentAsyncEvaluation ? asyncEvaluation.error : null
    };
  }

  if (asyncEvaluation) {
    const isCurrentAsyncEvaluation = asyncEvaluation.requestKey === requestKey;
    return {
      evaluation: asyncEvaluation.evaluation,
      mode: engineMode,
      source: asyncEvaluation.source,
      status: isCurrentAsyncEvaluation ? asyncEvaluation.status : "evaluating",
      rustEligible,
      isStale: !isCurrentAsyncEvaluation,
      error: isCurrentAsyncEvaluation ? asyncEvaluation.error : null
    };
  }

  return {
    evaluation: emptyEvaluation,
    mode: engineMode,
    source: "rust",
    status: "evaluating",
    rustEligible,
    isStale: false,
    error: null
  };
};
