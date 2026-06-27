import { useEffect, useMemo, useState } from "react";
import type { CadElement, EvaluationResult } from "../types/geometry";
import type { EvaluateElementsOptions } from "./evaluate";
import {
  canUseRustEvaluationForElements,
  evaluateElementsReference,
  evaluateElementsWithRust,
  evaluationResultsMatch,
  isTauriRuntime
} from "./evaluationEngine";

export const useEvaluationEngine = (
  elements: CadElement[],
  options: EvaluateElementsOptions
): EvaluationResult => {
  const referenceEvaluation = useMemo(
    () => evaluateElementsReference(elements, options),
    [elements, options]
  );
  const [rustEvaluation, setRustEvaluation] = useState<EvaluationResult | null>(null);
  const rustEligible = canUseRustEvaluationForElements(elements, options);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let cancelled = false;
    evaluateElementsWithRust(elements, options)
      .then((nextEvaluation) => {
        if (cancelled) return;
        setRustEvaluation(nextEvaluation);
        if (rustEligible && !evaluationResultsMatch(referenceEvaluation, nextEvaluation)) {
          console.warn("Rust evaluation differs from the TypeScript reference evaluation.", {
            referenceEvaluation,
            rustEvaluation: nextEvaluation
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("Rust evaluation failed; using the TypeScript reference evaluation.", error);
          setRustEvaluation(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [elements, options, referenceEvaluation, rustEligible]);

  return rustEligible && rustEvaluation ? rustEvaluation : referenceEvaluation;
};
