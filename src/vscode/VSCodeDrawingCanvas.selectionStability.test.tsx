import { createRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { EvaluationResult } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";

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
  evaluation: EvaluationResult,
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

const renderCurrent = (evaluation: EvaluationResult, state: EvaluationEngineState) => (
  <VSCodeDrawingCanvas
    evaluation={evaluation}
    evaluationState={state}
    canvasFocusRef={createRef()}
    postCanonicalSourceText={vi.fn()}
  />
);

const mockCanvasContext = () => ({
  arc: vi.fn(),
  bezierCurveTo: vi.fn(),
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  closePath: vi.fn(),
  drawImage: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  lineTo: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  moveTo: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  setLineDash: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn()
});

const selectedPointCount = (container: HTMLElement) =>
  container.querySelectorAll(".overlay-selected-point").length;
const selectedGlowCount = (container: HTMLElement) =>
  container.querySelectorAll(".overlay-selected-point-glow").length;

const clickFirstPoint = (container: HTMLElement) => {
  const viewport = container.querySelector<HTMLDivElement>(".canvas-viewport");
  const point = container.querySelector<SVGCircleElement>(".overlay-draggable-point");
  if (!viewport || !point) throw new Error("Expected Canvas viewport and point overlay");
  const clientX = Number(point.getAttribute("cx"));
  const clientY = Number(point.getAttribute("cy"));
  fireEvent.pointerDown(viewport, {
    button: 0,
    buttons: 1,
    clientX,
    clientY,
    pointerId: 1
  });
  fireEvent.pointerUp(viewport, {
    buttons: 0,
    clientX,
    clientY,
    pointerId: 1
  });
};

describe("VSCodeDrawingCanvas transient invalid-source selection presentation", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      value: 500
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 400
    });
    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 500,
      bottom: 400,
      width: 500,
      height: 400,
      toJSON: () => ({})
    }));
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      mockCanvasContext() as unknown as CanvasRenderingContext2D
    );

    class ResizeObserverMock {
      private callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        this.callback([{ target } as ResizeObserverEntry], this);
      }

      disconnect() {
        return undefined;
      }

      unobserve() {
        return undefined;
      }
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("keeps the clicked A marker through the exact Unit 1 error and recovery", async () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const baselineState = useCadDocumentStore.getState();
    const baselineRevision = baselineState.compiledDocumentRevision;
    const baselineEvaluation = evaluateElements(baselineState.elements);
    const view = render(renderCurrent(
      baselineEvaluation,
      evaluationState(baselineEvaluation, baselineRevision, baselineRevision)
    ));

    await act(async () => {
      await Promise.resolve();
    });

    clickFirstPoint(view.container);
    expect(useCadUiStore.getState().selectedElementIds).toHaveLength(1);
    const selectedA = useCadUiStore.getState().selectedElementId;
    expect(selectedA).not.toBeNull();
    expect(baselineState.elements.find((element) => element.id === selectedA)?.name).toBe("A");
    expect(selectedPointCount(view.container)).toBe(1);
    expect(selectedGlowCount(view.container)).toBe(1);

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

    expect(useCadUiStore.getState().selectedElementId).toBe(selectedA);
    expect(selectedPointCount(view.container)).toBe(1);
    expect(selectedGlowCount(view.container)).toBe(1);

    const errorfulEvaluation = evaluateElements(errorfulState.elements);
    await act(async () => {
      view.rerender(renderCurrent(
        errorfulEvaluation,
        evaluationState(errorfulEvaluation, errorfulRevision, errorfulRevision)
      ));
      await Promise.resolve();
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(selectedA);
    expect(selectedPointCount(view.container)).toBe(1);
    expect(selectedGlowCount(view.container)).toBe(1);

    act(() => useCadDocumentStore.getState().commitText(baseline, "editor"));
    const restoredState = useCadDocumentStore.getState();
    const restoredRevision = restoredState.compiledDocumentRevision;
    const restoredA = restoredState.elements.find((element) => element.name === "A");
    expect(restoredA?.id).toBe(selectedA);

    const restoredEvaluation = evaluateElements(restoredState.elements);
    await act(async () => {
      view.rerender(renderCurrent(
        restoredEvaluation,
        evaluationState(restoredEvaluation, restoredRevision, restoredRevision)
      ));
      await Promise.resolve();
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(selectedA);
    expect(selectedPointCount(view.container)).toBe(1);
    expect(selectedGlowCount(view.container)).toBe(1);
  });
});
