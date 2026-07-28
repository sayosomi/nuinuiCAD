// Task 45: shared canonical freshness gate for any UI surface that wants to
// display a resolved typed-binding runtime value (Inspector's runtime
// section, the Source Editor's print-state gutter class, etc.).
//
// The Inspector (React hook state, via useEvaluationEngine) and the Source
// Editor's imperative controller (its own docText/sourceText/compiledDocumentRevision
// bookkeeping) each compute isSourceDirty/isEvaluationStale from their own,
// structurally different state - there is no single shared store field both
// can read. But once each surface has its own two booleans, both must reduce
// them through this one shared predicate rather than each inventing its own
// "!a && !b" inline, so the definition of "fresh enough to show a resolved
// binding value" never silently drifts between the two surfaces.
export type RuntimeBindingFreshnessInput = {
  /** True when the live source text has advanced past the last successful
   * compile (a fatal parse/compile error is currently blocking a fresh
   * document) - the compiled document being read is a last-good document. */
  isSourceDirty: boolean;
  /** True when the evaluation result being read does not correspond to the
   * current compiled-document revision (pending/in-flight, or a genuinely
   * stale async result). */
  isEvaluationStale: boolean;
};

/**
 * Both conditions must be false before a resolved binding value may be
 * shown. If freshness cannot be proven, the caller must fall back to its own
 * defined "unknown"/literal-only default instead of displaying a value that
 * might be stale.
 */
export const isRuntimeBindingDisplayFresh = ({ isSourceDirty, isEvaluationStale }: RuntimeBindingFreshnessInput): boolean =>
  !isSourceDirty && !isEvaluationStale;
