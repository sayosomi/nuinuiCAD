import { describe, expect, it } from "vitest";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CadElement, DocumentPalette, VisibilityProfile } from "../types/geometry";
import {
  resolveRevisionCoherentCanvasPresentation,
  type CanvasRevisionPresentationInputs,
  type CanvasRevisionPresentationSnapshot
} from "./canvasRevisionPresentation";

const point = (id: string, name: string, x: number): CadElement => ({
  id,
  name,
  type: "freePoint",
  activity: "visible",
  x,
  y: 0
});

const inputs = (id: string): CanvasRevisionPresentationInputs => ({
  elements: [point(id, id.toUpperCase(), id === "old" ? 0 : 10)],
  canonicalElements: [point(id, id.toUpperCase(), id === "old" ? 0 : 10)],
  evaluationLimitIndex: undefined,
  palette: { colors: [], defaultColorId: "" } as DocumentPalette,
  visibilityProfiles: [] as VisibilityProfile[],
  activeVisibilityProfileId: null,
  moduleSemanticContext: {}
});

const evaluationState = (
  revision: number,
  requestRevision: number,
  isStale: boolean
): EvaluationEngineState => ({
  evaluation: {} as EvaluationEngineState["evaluation"],
  evaluationRevision: revision,
  evaluationRequestRevision: requestRevision,
  mode: "rust",
  source: "rust",
  status: isStale ? "evaluating" : "ready",
  rustEligible: true,
  isStale,
  error: null
});

describe("revision-coherent Canvas presentation", () => {
  it("keeps the previous full document inputs while that evaluation is stale", () => {
    const oldInputs = inputs("old");
    const currentInputs = inputs("new");
    const stable: CanvasRevisionPresentationSnapshot = {
      evaluationRevision: 7,
      evaluationRequestRevision: 41,
      inputs: oldInputs
    };

    const resolved = resolveRevisionCoherentCanvasPresentation({
      current: currentInputs,
      compiledDocumentRevision: 8,
      evaluationState: evaluationState(7, 41, true),
      lastStable: stable
    });

    expect(resolved).toBe(oldInputs);
    expect(resolved.elements.map((element) => element.id)).toEqual(["old"]);
  });

  it("fails closed instead of pairing a stale request with another request or the current document", () => {
    const currentInputs = inputs("new");
    const stable: CanvasRevisionPresentationSnapshot = {
      evaluationRevision: 7,
      evaluationRequestRevision: 40,
      inputs: inputs("old")
    };

    const resolved = resolveRevisionCoherentCanvasPresentation({
      current: currentInputs,
      compiledDocumentRevision: 7,
      evaluationState: evaluationState(7, 41, true),
      lastStable: stable
    });

    expect(resolved).not.toBe(currentInputs);
    expect(resolved).not.toBe(stable.inputs);
    expect(resolved.elements).toEqual([]);
    expect(resolved.canonicalElements).toEqual([]);
  });

  it("promotes current document inputs atomically when the newer evaluation resolves", () => {
    const currentInputs = inputs("new");
    const stable: CanvasRevisionPresentationSnapshot = {
      evaluationRevision: 7,
      evaluationRequestRevision: 41,
      inputs: inputs("old")
    };

    const resolved = resolveRevisionCoherentCanvasPresentation({
      current: currentInputs,
      compiledDocumentRevision: 8,
      evaluationState: evaluationState(8, 42, false),
      lastStable: stable
    });

    expect(resolved).toBe(currentInputs);
    expect(resolved.elements.map((element) => element.id)).toEqual(["new"]);
  });
});
