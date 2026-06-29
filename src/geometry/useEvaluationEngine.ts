import { useEffect, useMemo, useState } from "react";
import type { CadElement, EvaluationResult } from "../types/geometry";
import type { EvaluateElementsOptions } from "./evaluate";
import {
  canUseRustEvaluationForElements,
  emptyEvaluationResult,
  evaluateElementsReference,
  evaluateElementsWithRust,
  evaluationResultsMatch,
  getEvaluationEngineMode,
  isTauriRuntime
} from "./evaluationEngine";

export const useEvaluationEngine = (
  elements: CadElement[],
  options: EvaluateElementsOptions
): EvaluationResult => {
  const engineMode = getEvaluationEngineMode();
  const tauriRuntime = isTauriRuntime();
  const rustEligible = canUseRustEvaluationForElements(elements, options);
  const needsReferenceEvaluation = !tauriRuntime || engineMode !== "rust" || !rustEligible;
  const referenceEvaluation = useMemo(
    () => (needsReferenceEvaluation ? evaluateElementsReference(elements, options) : null),
    [elements, needsReferenceEvaluation, options]
  );
  const [asyncEvaluation, setAsyncEvaluation] = useState<EvaluationResult | null>(null);
  const emptyEvaluation = useMemo(
    () => emptyEvaluationResult(elements, options),
    [elements, options]
  );

  useEffect(() => {
    if (!tauriRuntime || engineMode === "reference" || !rustEligible) {
      return;
    }

    let cancelled = false;
    evaluateElementsWithRust(elements, options)
      .then((nextEvaluation) => {
        if (cancelled) return;
        setAsyncEvaluation(nextEvaluation);
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
            engineMode === "rust" ? evaluateElementsReference(elements, options) : null
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [elements, engineMode, options, referenceEvaluation, rustEligible, tauriRuntime]);

  if (engineMode === "reference" || !rustEligible || !tauriRuntime) {
    return referenceEvaluation ?? emptyEvaluation;
  }

  if (engineMode === "shadow") {
    return asyncEvaluation ?? referenceEvaluation ?? emptyEvaluation;
  }

  return asyncEvaluation ?? emptyEvaluation;
};
