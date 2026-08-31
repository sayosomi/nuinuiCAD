/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { EvaluationResult } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

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
    currentReferencePickAuthorityFor={() => null}
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

const renderedLineMidpoint = (line: SVGLineElement) => ({
  clientX: (Number(line.getAttribute("x1")) + Number(line.getAttribute("x2"))) / 2,
  clientY: (Number(line.getAttribute("y1")) + Number(line.getAttribute("y2"))) / 2
});

const clickRenderedGeometry = (
  target: Element,
  coordinates: { clientX: number; clientY: number },
  pointerId = 1
) => {
  fireEvent.pointerDown(target, {
    button: 0,
    buttons: 1,
    ...coordinates,
    pointerId
  });
  fireEvent.pointerUp(target, {
    buttons: 0,
    ...coordinates,
    pointerId
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

  it("selects a point when the pointer events target the rendered SVG point", () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const state = useCadDocumentStore.getState();
    const evaluation = evaluateElements(state.elements);
    const view = render(renderCurrent(
      evaluation,
      evaluationState(evaluation, state.compiledDocumentRevision, state.compiledDocumentRevision)
    ));
    const point = view.container.querySelector<SVGCircleElement>(".overlay-draggable-point");
    if (!point) throw new Error("Expected rendered SVG point overlay");

    const coordinates = {
      clientX: Number(point.getAttribute("cx")),
      clientY: Number(point.getAttribute("cy"))
    };
    clickRenderedGeometry(point, coordinates);

    const selectedId = useCadUiStore.getState().selectedElementId;
    expect(state.elements.find((element) => element.id === selectedId)?.name).toBe("A");
  });

  it("selects a point when the React root pointer boundary is interrupted", async () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const state = useCadDocumentStore.getState();
    const evaluation = evaluateElements(state.elements);
    const container = document.createElement("div");
    document.body.append(container);
    const blockReactPointerBoundary = (event: Event) => event.stopImmediatePropagation();
    const pointerEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel"];
    pointerEvents.forEach((eventName) => container.addEventListener(eventName, blockReactPointerBoundary));

    try {
      const view = render(
        renderCurrent(
          evaluation,
          evaluationState(evaluation, state.compiledDocumentRevision, state.compiledDocumentRevision)
        ),
        { container }
      );
      const point = container.querySelector<SVGCircleElement>(".overlay-draggable-point");
      if (!point) throw new Error("Expected rendered SVG point overlay");
      const coordinates = {
        clientX: Number(point.getAttribute("cx")),
        clientY: Number(point.getAttribute("cy"))
      };

      await act(async () => {
        fireEvent.pointerDown(point, {
          button: 0,
          buttons: 1,
          ...coordinates,
          pointerId: 1
        });
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.pointerUp(point, {
          buttons: 0,
          ...coordinates,
          pointerId: 1
        });
        await Promise.resolve();
      });

      const selectedId = useCadUiStore.getState().selectedElementId;
      expect(state.elements.find((element) => element.id === selectedId)?.name).toBe("A");
      view.unmount();
    } finally {
      pointerEvents.forEach((eventName) => container.removeEventListener(eventName, blockReactPointerBoundary));
      container.remove();
    }
  });

  it("selects a line when the pointer events target the rendered SVG line", () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const state = useCadDocumentStore.getState();
    const evaluation = evaluateElements(state.elements);
    const view = render(renderCurrent(
      evaluation,
      evaluationState(evaluation, state.compiledDocumentRevision, state.compiledDocumentRevision)
    ));
    const line = view.container.querySelector<SVGLineElement>(".drawing-overlay line");
    if (!line) throw new Error("Expected rendered SVG line overlay");

    clickRenderedGeometry(line, renderedLineMidpoint(line));

    const selectedId = useCadUiStore.getState().selectedElementId;
    expect(state.elements.find((element) => element.id === selectedId)?.name).toBe("AB");
  });

  it("publishes element context for a right-click on rendered geometry", () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const state = useCadDocumentStore.getState();
    const evaluation = evaluateElements(state.elements);
    const view = render(renderCurrent(
      evaluation,
      evaluationState(evaluation, state.compiledDocumentRevision, state.compiledDocumentRevision)
    ));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    const line = view.container.querySelector<SVGLineElement>(".drawing-overlay line");
    if (!viewport || !line) throw new Error("Expected Canvas viewport and rendered SVG line overlay");

    fireEvent.contextMenu(line, { button: 2, ...renderedLineMidpoint(line) });

    expect(JSON.parse(viewport.dataset.vscodeContext ?? "{}")).toMatchObject({
      webviewSection: "element"
    });
  });

  it("keeps blank Canvas right-click on the blank context path", () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const state = useCadDocumentStore.getState();
    const evaluation = evaluateElements(state.elements);
    const view = render(renderCurrent(
      evaluation,
      evaluationState(evaluation, state.compiledDocumentRevision, state.compiledDocumentRevision)
    ));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Expected Canvas viewport");

    fireEvent.contextMenu(viewport, { button: 2, clientX: 450, clientY: 350 });

    expect(JSON.parse(viewport.dataset.vscodeContext ?? "{}")).toMatchObject({
      webviewSection: "blank"
    });
  });

  it("keeps rendered SVG geometry targetable in the production stylesheet", () => {
    expect(stylesheet).toMatch(
      /\.drawing-overlay line,\s*\.drawing-overlay polyline\s*\{[\s\S]*?pointer-events:\s*stroke;/
    );
    expect(stylesheet).toMatch(
      /\.drawing-overlay \.overlay-draggable-point\s*\{[\s\S]*?pointer-events:\s*all;/
    );
  });
});
