import { useEffect, useMemo, useRef, useState } from "react";
import {
  evaluatePreparedRust,
  type RustEvaluationTransport
} from "../geometry/rustEvaluationRunner";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { EvaluationResult } from "../types/geometry";
import type { VscodeMultiDocumentCanvasRuntimeSnapshot } from "./multiDocumentRuntimeTransport";

type RuntimeEvaluation = {
  snapshot: VscodeMultiDocumentCanvasRuntimeSnapshot;
  evaluation: EvaluationResult;
  status: "ready" | "failed";
  error: unknown | null;
  requestRevision: number;
};

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
  const requestRevisionRef = useRef(0);
  const emptyEvaluation = useMemo(
    () => snapshot
      ? emptyRuntimeEvaluation(
          snapshot.preparedRustEvaluation.input.elements,
          snapshot.preparedRustEvaluation.input.evaluationLimitIndex
        )
      : emptyRuntimeEvaluation([]),
    [snapshot]
  );

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const requestRevision = ++requestRevisionRef.current;
    let cancelled = false;
    void evaluatePreparedRust(snapshot.preparedRustEvaluation, transport)
      .then((evaluation) => {
        if (cancelled) return;
        setCompleted({
          snapshot,
          evaluation,
          status: "ready",
          error: null,
          requestRevision
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCompleted({
          snapshot,
          evaluation: emptyEvaluation,
          status: "failed",
          error,
          requestRevision
        });
      });
    return () => {
      cancelled = true;
    };
  }, [emptyEvaluation, snapshot, transport]);

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

  const matching = completed?.snapshot === snapshot ? completed : null;
  return {
    evaluation: matching?.evaluation ?? emptyEvaluation,
    evaluationRevision: snapshot.graphRevision,
    evaluationRequestRevision: matching?.requestRevision ?? snapshot.graphRevision,
    mode: "rust",
    source: "rust",
    status: matching?.status ?? "evaluating",
    rustEligible: snapshot.preparedRustEvaluation.rustEligible,
    isStale: false,
    error: matching?.error ?? null
  };
};
