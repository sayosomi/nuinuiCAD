import { useEffect, useMemo, useState } from "react";
import {
  evaluatePreparedRust,
  type RustEvaluationTransport
} from "../geometry/rustEvaluationRunner";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { EvaluationResult } from "../types/geometry";
import type { VscodeMultiDocumentCanvasRuntimeSnapshot } from "./multiDocumentRuntimeTransport";

type RuntimeEvaluation = {
  request: RuntimeEvaluationRequest;
  evaluation: EvaluationResult;
  status: "ready" | "failed";
  error: unknown | null;
};

type RuntimeEvaluationRequest = {
  snapshot: VscodeMultiDocumentCanvasRuntimeSnapshot;
  requestRevision: number;
};

let nextRuntimeEvaluationRequestRevision = 1;

const emptyRuntimeEvaluation = (
  elements: readonly unknown[],
  evaluationLimitIndex = elements.length
): EvaluationResult => ({
  computedGeometry: new Map(),
  preMutationGeometry: new Map(),
  instanceBaseGeometry: new Map(),
  errors: [],
  warnings: [],
  evaluatedElementIds: new Set(),
  evaluationLimitIndex: Math.min(Math.max(evaluationLimitIndex, 0), elements.length),
  effectiveVisibleElementIds: new Set(),
  effectiveEnabledElementIds: new Set(),
  effectiveDrawingModifierStrokes: new Map()
});

/**
 * Evaluate one exact host-prepared runtime snapshot. This intentionally has no
 * reference fallback: imported runtime authority is either the matching Rust
 * result or an empty failed presentation.
 */
export const useVscodeMultiDocumentRuntimeEvaluation = (
  snapshot: VscodeMultiDocumentCanvasRuntimeSnapshot | null,
  transport: RustEvaluationTransport
): EvaluationEngineState => {
  const [completed, setCompleted] = useState<RuntimeEvaluation | null>(null);
  const emptyEvaluation = useMemo(
    () => snapshot
      ? emptyRuntimeEvaluation(
          snapshot.preparedRustEvaluation.input.elements,
          snapshot.preparedRustEvaluation.input.evaluationLimitIndex
        )
      : emptyRuntimeEvaluation([]),
    [snapshot]
  );
  const request = useMemo<RuntimeEvaluationRequest | null>(() => {
    if (!snapshot) return null;
    return {
      snapshot,
      requestRevision: nextRuntimeEvaluationRequestRevision++
    };
  }, [snapshot]);

  useEffect(() => {
    if (!request) return;
    const { snapshot: requestedSnapshot } = request;
    let cancelled = false;
    void evaluatePreparedRust(requestedSnapshot.preparedRustEvaluation, transport)
      .then((evaluation) => {
        if (cancelled) return;
        setCompleted({
          request,
          evaluation,
          status: "ready",
          error: null
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCompleted({
          request,
          evaluation: emptyEvaluation,
          status: "failed",
          error
        });
      });
    return () => {
      cancelled = true;
    };
  }, [emptyEvaluation, request, transport]);

  if (!snapshot) {
    return {
      evaluation: emptyEvaluation,
      evaluationRevision: 0,
      evaluationRequestRevision: 0,
      mode: "rust",
      source: "rust",
      status: "idle",
      rustEligible: false,
      isStale: false,
      error: null
    };
  }

  const matching = completed?.request === request ? completed : null;
  return {
    evaluation: matching?.evaluation ?? emptyEvaluation,
    evaluationRevision: snapshot.graphRevision,
    evaluationRequestRevision: request?.requestRevision ?? 0,
    mode: "rust",
    source: "rust",
    status: matching?.status ?? "evaluating",
    rustEligible: snapshot.preparedRustEvaluation.rustEligible,
    isStale: false,
    error: matching?.error ?? null
  };
};
