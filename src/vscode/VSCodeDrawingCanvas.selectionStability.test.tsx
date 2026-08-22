import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";

const mocks = vi.hoisted(() => ({
  hostAdapter: null as CanvasHostAdapter | null
}));

vi.mock("../commands/commands", () => ({
  dispatchCommand: vi.fn()
}));

vi.mock("../components/DrawingCanvas", async () => {
  const React = await import("react");
  return {
    DrawingCanvas: React.forwardRef((props: { hostAdapter: CanvasHostAdapter }, ref) => {
      void ref;
      mocks.hostAdapter = props.hostAdapter;
      return React.createElement("div");
    })
  };
});

const baseline = [
  "nui 4",
  "",
  "point A = coordinate(",
  "  x: 0,",
  "  y: 0,",
  ")",
  "",
  "point B = coordinate(",
  "  x: 60,",
  "  y: 0,",
  ")",
  "",
  "line AB = segment(",
  "  start: @A,",
  "  end: @B,",
  ")"
].join("\n");

const errorfulWithoutA = [
  "nui 4",
  "",
  "point B = coordinate(",
  "  x: 60,",
  "  y: 0,",
  ")",
  "",
  "line Temp = segment(",
  "  start: @B,",
  "  end:",
  ")"
].join("\n");

const evaluationState = (
  evaluation: ReturnType<typeof emptyEvaluationResult>,
  evaluationRevision: number,
  evaluationRequestRevision: number,
  overrides: Partial<EvaluationEngineState> = {}
): EvaluationEngineState => ({
  evaluation,
  evaluationRevision,
  evaluationRequestRevision,
  mode: "rust",
  source: "rust",
  status: "ready",
  rustEligible: true,
  isStale: false,
  error: null,
  ...overrides
});

const renderCurrent = (
  evaluation: ReturnType<typeof emptyEvaluationResult>,
  state: EvaluationEngineState
) => (
  <VSCodeDrawingCanvas
    evaluation={evaluation}
    evaluationState={state}
    canvasFocusRef={createRef()}
    postCanonicalSourceText={vi.fn()}
  />
);

const adapter = () => {
  if (!mocks.hostAdapter) throw new Error("Canvas host adapter was not captured");
  return mocks.hostAdapter;
};

describe("VSCodeDrawingCanvas transient invalid-source selection presentation", () => {
  beforeEach(() => {
    mocks.hostAdapter = null;
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("keeps A selected in the pinned presentation while Unit 1 source omits A", async () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const baselineState = useCadDocumentStore.getState();
    const baselineRevision = baselineState.compiledDocumentRevision;
    const baselineEvaluation = emptyEvaluationResult(baselineState.elements);
    const view = render(renderCurrent(
      baselineEvaluation,
      evaluationState(baselineEvaluation, baselineRevision, baselineRevision)
    ));

    await act(async () => {
      await Promise.resolve();
    });

    const initialA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(initialA).toBeDefined();
    act(() => useCadUiStore.getState().setSelectedElementId(initialA!.id));
    expect(adapter().selectedElementIds).toEqual([initialA!.id]);

    act(() => useCadDocumentStore.getState().commitText(errorfulWithoutA, "editor"));
    const errorfulState = useCadDocumentStore.getState();
    const errorfulRevision = errorfulState.compiledDocumentRevision;
    expect(errorfulState.elements.some((element) => element.name === "A")).toBe(false);
    expect(errorfulState.diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing-attribute-value", severity: "error" })
    );

    await act(async () => {
      view.rerender(renderCurrent(
        baselineEvaluation,
        evaluationState(baselineEvaluation, baselineRevision, errorfulRevision, {
          status: "evaluating",
          isStale: true
        })
      ));
      await Promise.resolve();
    });

    expect(adapter().elements.map((element) => element.name)).toEqual(["A", "B", "AB"]);
    expect(adapter().selectedElementIds).toEqual([initialA!.id]);
    expect(adapter().selectedElementId).toBe(initialA!.id);

    const errorfulEvaluation = emptyEvaluationResult(errorfulState.elements);
    await act(async () => {
      view.rerender(renderCurrent(
        errorfulEvaluation,
        evaluationState(errorfulEvaluation, errorfulRevision, errorfulRevision)
      ));
      await Promise.resolve();
    });

    expect(adapter().elements.map((element) => element.name)).toEqual(["A", "B", "AB"]);
    expect(adapter().selectedElementIds).toEqual([initialA!.id]);

    act(() => useCadDocumentStore.getState().commitText(baseline, "editor"));
    const restoredState = useCadDocumentStore.getState();
    const restoredRevision = restoredState.compiledDocumentRevision;
    const restoredA = restoredState.elements.find((element) => element.name === "A");
    expect(restoredA?.id).toBe(initialA!.id);
    expect(useCadUiStore.getState().selectedElementId).toBe(initialA!.id);

    const restoredEvaluation = emptyEvaluationResult(restoredState.elements);
    await act(async () => {
      view.rerender(renderCurrent(
        restoredEvaluation,
        evaluationState(restoredEvaluation, restoredRevision, restoredRevision)
      ));
      await Promise.resolve();
    });

    expect(adapter().elements.map((element) => element.name)).toEqual(["A", "B", "AB"]);
    expect(adapter().selectedElementIds).toEqual([initialA!.id]);
    expect(adapter().selectedElementId).toBe(initialA!.id);
  });
});
