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
  isParityEvaluationEngineMode,
  isTauriRuntime
} from "./evaluationEngine";

export type EvaluationSource = "reference" | "rust" | "fallback";
export type EvaluationStatus = "idle" | "evaluating" | "ready" | "failed";

export type EvaluationEngineState = {
  evaluation: EvaluationResult;
  /** Revision of the compiled document used to start this evaluation request. */
  evaluationRevision: number;
  /** Monotonic request identity; distinguishes retries/results for the same document. */
  evaluationRequestRevision: number;
  mode: EvaluationEngineMode;
  source: EvaluationSource;
  status: EvaluationStatus;
  rustEligible: boolean;
  isStale: boolean;
  error: unknown | null;
};

/**
 * Whether the rendered evaluation corresponds to the given compiled document
 * revision, i.e. hit testing that render is safe.  A first Rust evaluation
 * renders an empty placeholder under the current revision while the request is
 * in flight, so "evaluating" only counts as current when a fresh reference
 * evaluation is on screen (parity shadow mode).
 */
export const evaluationStateIsCurrentFor = (
  state: EvaluationEngineState | undefined,
  compiledDocumentRevision: number
): boolean => {
  if (!state) return true;
  if (state.isStale || state.evaluationRevision !== compiledDocumentRevision) return false;
  return state.status !== "evaluating" || state.source === "reference";
};

type AsyncEvaluationState = {
  requestKey: string;
  evaluationRevision: number;
  evaluationRequestRevision: number;
  evaluation: EvaluationResult;
  source: Exclude<EvaluationSource, "reference">;
  status: Extract<EvaluationStatus, "ready" | "failed">;
  error: unknown | null;
};

let nextEvaluationRequestRevision = 1;
const evaluationRequestRevisionByKey = new Map<string, number>();
const MAX_REQUEST_IDENTITIES = 256;

const requestRevisionFor = (key: string) => {
  const existing = evaluationRequestRevisionByKey.get(key);
  if (existing !== undefined) return existing;
  const revision = nextEvaluationRequestRevision;
  nextEvaluationRequestRevision += 1;
  evaluationRequestRevisionByKey.set(key, revision);
  if (evaluationRequestRevisionByKey.size > MAX_REQUEST_IDENTITIES) {
    const oldest = evaluationRequestRevisionByKey.keys().next().value;
    if (oldest !== undefined) evaluationRequestRevisionByKey.delete(oldest);
  }
  return revision;
};

export const useEvaluationEngine = (
  elements: CadElement[],
  options: EvaluateElementsOptions,
  evaluationRevision = 0
): EvaluationEngineState => {
  const evaluationLimitIndex = options.evaluationLimitIndex;
  const evaluationOptions = useMemo(
    () => ({ evaluationLimitIndex }),
    [evaluationLimitIndex]
  );
  const engineMode = getEvaluationEngineMode();
  const tauriRuntime = isTauriRuntime();
  const rustEligible = canUseRustEvaluationForElements(elements, evaluationOptions);
  const parityMode = isParityEvaluationEngineMode(engineMode);
  const requestKey = useMemo(
    () => JSON.stringify({ elements, evaluationLimitIndex }),
    [elements, evaluationLimitIndex]
  );
  const evaluationRequestRevision = useMemo(
    () => requestRevisionFor(`${evaluationRevision}:${requestKey}`),
    [evaluationRevision, requestKey]
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
          evaluationRevision,
          evaluationRequestRevision,
          evaluation: nextEvaluation,
          source: "rust",
          status: "ready",
          error: null
        });
        if (
          parityMode &&
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
                  evaluationRevision,
                  evaluationRequestRevision,
                  evaluation: evaluateElementsReference(elements, evaluationOptions),
                  source: "fallback",
                  status: "failed",
                  error
                }
              : {
                  requestKey,
                  evaluationRevision,
                  evaluationRequestRevision,
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
    evaluationRevision,
    evaluationRequestRevision,
    parityMode,
    referenceEvaluation,
    requestKey,
    rustEligible,
    tauriRuntime
  ]);

  if (engineMode === "reference" || !rustEligible || !tauriRuntime) {
    return {
      evaluation: referenceEvaluation ?? emptyEvaluation,
      evaluationRevision,
      evaluationRequestRevision,
      mode: engineMode,
      source: "reference",
      status: "idle",
      rustEligible,
      isStale: false,
      error: null
    };
  }

  if (parityMode) {
    const isCurrentAsyncEvaluation = asyncEvaluation?.requestKey === requestKey;
    return {
      evaluation: referenceEvaluation ?? emptyEvaluation,
      evaluationRevision,
      evaluationRequestRevision,
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
      evaluationRevision: asyncEvaluation.evaluationRevision,
      evaluationRequestRevision: asyncEvaluation.evaluationRequestRevision,
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
    evaluationRevision,
    evaluationRequestRevision,
    mode: engineMode,
    source: "rust",
    status: "evaluating",
    rustEligible,
    isStale: false,
    error: null
  };
};
