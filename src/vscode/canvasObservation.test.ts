import { describe, expect, it } from "vitest";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { canvasObservationSnapshot } from "./canvasObservation";

const evaluationState = (
  overrides: Partial<EvaluationEngineState> = {}
): EvaluationEngineState => ({
  evaluation: {
    computedGeometry: new Map(),
    errors: [],
    warnings: []
  } as EvaluationEngineState["evaluation"],
  evaluationRevision: 12,
  evaluationRequestRevision: 34,
  mode: "rust",
  source: "rust",
  status: "ready",
  rustEligible: true,
  isStale: false,
  error: null,
  ...overrides
});

const snapshot = (input: {
  state?: EvaluationEngineState;
  selectionSubject?: { kind: "elements" } | { kind: "binding"; bindingId: string };
  selectedElementIds?: readonly string[];
  previewActive?: boolean;
  compiledDocumentRevision?: number;
} = {}) => canvasObservationSnapshot({
  documentVersion: 7,
  selectedElementIds: input.selectedElementIds ?? ["point-a", "line-b"],
  selectionSubject: input.selectionSubject ?? { kind: "elements" },
  compiledDocumentRevision: input.compiledDocumentRevision ?? 12,
  previewActive: input.previewActive ?? false,
  evaluationState: input.state ?? evaluationState()
});

describe("canvasObservationSnapshot", () => {
  it("publishes current canonical selection and compact evaluation metadata", () => {
    const result = snapshot({
      state: evaluationState({
        evaluation: {
          computedGeometry: new Map(),
          errors: [{
            elementId: "point-a",
            elementName: "A",
            missingDependencyId: "missing",
            message: "Missing dependency"
          }],
          warnings: [{
            elementId: "line-b",
            elementName: "B",
            message: "Trim warning"
          }]
        } as EvaluationEngineState["evaluation"]
      })
    });

    expect(result).toMatchObject({
      documentVersion: 7,
      selectedElementIds: ["point-a", "line-b"],
      selectionSubject: { kind: "elements" },
      compiledDocumentRevision: 12,
      evaluationRevision: 12,
      evaluationRequestRevision: 34,
      evaluationStatus: "ready",
      evaluationSource: "rust",
      rustEligible: true,
      isStale: false,
      isCurrent: true,
      errorCount: 1,
      warningCount: 1,
      errorSummaries: [{ elementId: "point-a", elementName: "A", message: "Missing dependency" }],
      warningSummaries: [{ elementId: "line-b", elementName: "B", message: "Trim warning" }]
    });
    expect(result).not.toHaveProperty("computedGeometry");
  });

  it("treats missing issue arrays in partial evaluation fixtures as empty observation facts", () => {
    const result = snapshot({
      state: evaluationState({
        evaluation: { computedGeometry: new Map() } as EvaluationEngineState["evaluation"]
      })
    });

    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.errorSummaries).toEqual([]);
    expect(result.warningSummaries).toEqual([]);
  });

  it("updates element selection without changing the evaluation identity", () => {
    const result = snapshot({ selectedElementIds: ["line-c"] });
    expect(result.selectedElementIds).toEqual(["line-c"]);
    expect(result.evaluationRequestRevision).toBe(34);
  });

  it("does not leak stale element selection for a binding selection", () => {
    const result = snapshot({
      selectionSubject: { kind: "binding", bindingId: "binding:waist" },
      selectedElementIds: ["stale-element"]
    });
    expect(result.selectionSubject).toEqual({ kind: "binding", bindingId: "binding:waist" });
    expect(result.selectedElementIds).toEqual([]);
  });

  it("preserves evaluationStateIsCurrentFor semantics", () => {
    expect(snapshot({
      state: evaluationState({ status: "evaluating", source: "reference" })
    }).isCurrent).toBe(true);
    expect(snapshot({
      state: evaluationState({ status: "evaluating", source: "rust" })
    }).isCurrent).toBe(false);
    expect(snapshot({
      state: evaluationState({ status: "ready", isStale: true })
    }).isCurrent).toBe(false);
    expect(snapshot({
      state: evaluationState({ status: "failed", source: "fallback" })
    }).isCurrent).toBe(true);
    expect(snapshot({
      state: evaluationState({ evaluationRevision: 11 })
    }).isCurrent).toBe(false);
  });

  it("marks preview-active without changing canonical evaluation provenance", () => {
    const result = snapshot({ previewActive: true });
    expect(result.previewActive).toBe(true);
    expect(result.evaluationRevision).toBe(12);
    expect(result.evaluationSource).toBe("rust");
  });
});
