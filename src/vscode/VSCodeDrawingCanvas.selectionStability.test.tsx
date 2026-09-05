/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { creationRecipeForType } from "../commands/creationRecipes";
import { startCommandLineCreationForRecipe } from "../commands/commandLineSessionCommands";
import type { SourceCreationCursor } from "../commands/sourceCreationInsertion";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";
import type { VscodeMultiDocumentCanvasRuntimePresentation } from "./multiDocumentRuntimeTransport";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

const baseline = [
  "nui 1",
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
  "nui 1",
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

const renderCurrent = (
  evaluation: EvaluationResult,
  state: EvaluationEngineState,
  canvasCreationRequest?: { requestId: number; sourceCursor: SourceCreationCursor },
  multiDocumentRuntimePresentation?: VscodeMultiDocumentCanvasRuntimePresentation | null
) => (
  <VSCodeDrawingCanvas
    evaluation={evaluation}
    evaluationState={state}
    canvasFocusRef={createRef()}
    canvasCreationRequest={canvasCreationRequest}
    multiDocumentRuntimePresentation={multiDocumentRuntimePresentation}
    postCanonicalSourceText={vi.fn()}
    currentReferencePickAuthorityFor={() => null}
  />
);

const multiDocumentRuntimePresentationFor = (
  graphRevision: number,
  elements: CadElement[],
  importedElementId: string
): VscodeMultiDocumentCanvasRuntimePresentation => ({
  graphRevision,
  rootDocumentId: "file:///workspace/root.nui",
  rootSourceRevision: graphRevision,
  elements,
  evaluationLimitIndex: elements.length,
  visibilityProfiles: [],
  activeVisibilityProfileId: "",
  moduleMaterialization: {
    instanceBaseGeometrySnapshots: [],
    originByRuntimeElementId: new Map([[importedElementId, {
      kind: "moduleBody",
      instancePath: ["use"]
    }]])
  }
});

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

const currentCanvasCreationCursor = (): SourceCreationCursor => {
  const state = useCadDocumentStore.getState();
  const line = state.elements.find((element) => element.name === "AB");
  if (!line) throw new Error("Expected the AB line in the current document");
  const info = state.doc.statementMap.byElementId.get(line.id);
  if (!info) throw new Error("Expected source metadata for the AB line");
  return {
    sourceRevision: state.sourceRevision,
    line: Math.max(info.range.endLine, info.endLine),
    lineCount: state.sourceText.split("\n").length,
    elementId: line.id
  };
};

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

  it("recovers ordinary point selection on the same Canvas after an imported runtime refresh", async () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const state = useCadDocumentStore.getState();
    const rootPoint = state.elements.find((element) => element.name === "A");
    if (!rootPoint) throw new Error("Expected the importer-authored point");
    const importedPoint: CadElement = {
      id: "runtime-library-point",
      name: "P",
      type: "freePoint",
      activity: "visible",
      x: 120,
      y: 20
    };
    const runtimeElements = [...state.elements, importedPoint];
    const initialRevision = state.compiledDocumentRevision;
    const initialEvaluation = evaluateElements(runtimeElements);
    const view = render(renderCurrent(
      initialEvaluation,
      evaluationState(initialEvaluation, initialRevision, initialRevision),
      undefined,
      multiDocumentRuntimePresentationFor(initialRevision, runtimeElements, importedPoint.id)
    ));

    await act(async () => {
      await Promise.resolve();
    });

    const pointsBeforeNavigation = view.container.querySelectorAll<SVGCircleElement>(".overlay-draggable-point");
    const importedRenderedPoint = pointsBeforeNavigation.item(pointsBeforeNavigation.length - 1);
    if (!importedRenderedPoint) throw new Error("Expected the imported runtime point");
    clickRenderedGeometry(importedRenderedPoint, {
      clientX: Number(importedRenderedPoint.getAttribute("cx")),
      clientY: Number(importedRenderedPoint.getAttribute("cy"))
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(importedPoint.id);

    const transitionRevision = 42;
    const transitionEvaluation = evaluateElements(state.elements);
    await act(async () => {
      view.rerender(renderCurrent(
        transitionEvaluation,
        evaluationState(transitionEvaluation, transitionRevision, transitionRevision),
        undefined,
        null
      ));
      await Promise.resolve();
    });

    const recoveredEvaluation = evaluateElements(runtimeElements);
    await act(async () => {
      view.rerender(renderCurrent(
        recoveredEvaluation,
        evaluationState(recoveredEvaluation, transitionRevision, transitionRevision),
        undefined,
        multiDocumentRuntimePresentationFor(transitionRevision, runtimeElements, importedPoint.id)
      ));
      await Promise.resolve();
    });

    const pointsAfterNavigation = view.container.querySelectorAll<SVGCircleElement>(".overlay-draggable-point");
    const recoveredRootPoint = pointsAfterNavigation.item(0);
    if (!recoveredRootPoint) throw new Error("Expected the importer-authored point after recovery");
    clickRenderedGeometry(recoveredRootPoint, {
      clientX: Number(recoveredRootPoint.getAttribute("cx")),
      clientY: Number(recoveredRootPoint.getAttribute("cy"))
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(rootPoint.id);
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

  it("routes Creation Assist Option+Enter and a production webview-boundary Canvas pointer through the shared line-list draft", async () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const state = useCadDocumentStore.getState();
    const sourceCursor = currentCanvasCreationCursor();
    const evaluation = evaluateElements(state.elements);
    const view = render(renderCurrent(
      evaluation,
      evaluationState(evaluation, state.compiledDocumentRevision, state.compiledDocumentRevision),
      { requestId: 1, sourceCursor }
    ));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Expected Canvas viewport");
    const recipe = creationRecipeForType("offsetLine");
    if (!recipe) throw new Error("Missing Offset Line creation recipe");

    act(() => {
      expect(startCommandLineCreationForRecipe(recipe, {
        currentSourceCursor: () => sourceCursor,
        sourceCreationOrigin: "canvas-retained"
      })).toBe(true);
    });
    const nameInput = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.keyDown(nameInput, { key: "Enter" });
    const lineInput = screen.getByRole<HTMLInputElement>("textbox");
    lineInput.focus();
    fireEvent.keyDown(lineInput, { key: "Enter", altKey: true });

    const lineId = state.elements.find((element) => element.name === "AB")!.id;
    expect(useCadUiStore.getState().activeLinePickTarget).toMatchObject({
      elementId: "__command-line__",
      parameterKey: "baseLineIds",
      draftLineIds: []
    });
    expect(document.activeElement).toBe(viewport);

    const line = view.container.querySelector<SVGLineElement>(".drawing-overlay line");
    if (!line) throw new Error("Expected the rendered AB line");
    const pointer = renderedLineMidpoint(line);
    const blockReactPointerBoundary = (event: Event) => event.stopImmediatePropagation();
    view.container.addEventListener("pointerdown", blockReactPointerBoundary);
    fireEvent.pointerDown(line, {
      button: 0,
      buttons: 1,
      ...pointer,
      pointerId: 1
    });
    await act(async () => { await Promise.resolve(); });
    view.container.removeEventListener("pointerdown", blockReactPointerBoundary);

    expect(useCadUiStore.getState().activeLinePickTarget).toMatchObject({
      elementId: "__command-line__",
      parameterKey: "baseLineIds",
      draftLineIds: [lineId]
    });
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("baseLineIds");
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);
  });

  it("applies a candidate-line pointer exactly once when React and the native fallback both receive it", async () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const state = useCadDocumentStore.getState();
    const sourceCursor = currentCanvasCreationCursor();
    const evaluation = evaluateElements(state.elements);
    const container = document.createElement("div");
    document.body.append(container);
    let blockReactPointerBoundary = false;
    const stopReactPointerBoundary = (event: Event) => {
      if (blockReactPointerBoundary) event.stopImmediatePropagation();
    };
    container.addEventListener("pointerdown", stopReactPointerBoundary);
    const view = render(renderCurrent(
      evaluation,
      evaluationState(evaluation, state.compiledDocumentRevision, state.compiledDocumentRevision),
      { requestId: 1, sourceCursor }
    ), { container });
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Expected Canvas viewport");
    const recipe = creationRecipeForType("offsetLine");
    if (!recipe) throw new Error("Missing Offset Line creation recipe");

    act(() => {
      expect(startCommandLineCreationForRecipe(recipe, {
        currentSourceCursor: () => sourceCursor,
        sourceCreationOrigin: "canvas-retained"
      })).toBe(true);
    });
    const nameInput = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.keyDown(nameInput, { key: "Enter" });
    const lineInput = screen.getByRole<HTMLInputElement>("textbox");
    lineInput.focus();
    fireEvent.keyDown(lineInput, { key: "Enter", altKey: true });

    const lineId = state.elements.find((element) => element.name === "AB")!.id;
    expect(useCadUiStore.getState().activeLinePickTarget?.draftLineIds).toEqual([]);
    expect(document.activeElement).toBe(viewport);

    const clickLine = async (pointerId: number, nativeFallbackFirst = false) => {
      const line = view.container.querySelector<SVGLineElement>(".drawing-overlay line");
      if (!line) throw new Error("Expected the rendered AB line");
      await act(async () => {
        if (nativeFallbackFirst) blockReactPointerBoundary = true;
        fireEvent.pointerDown(line, {
          button: 0,
          buttons: 1,
          ...renderedLineMidpoint(line),
          pointerId
        });
        if (nativeFallbackFirst) {
          // Let the deferred native fallback claim the gesture before the
          // React boundary receives the duplicate delivery.
          await Promise.resolve();
          blockReactPointerBoundary = false;
        }
        // Model the webview boundary delivering the same physical press to the
        // other path as a second native event before this task drains. Only the
        // first delivery may apply the gesture regardless of delivery order.
        if (!nativeFallbackFirst) blockReactPointerBoundary = true;
        const duplicateLine = view.container.querySelector<SVGLineElement>(".drawing-overlay line");
        if (!duplicateLine) throw new Error("Expected the rendered AB line after the first delivery");
        fireEvent.pointerDown(duplicateLine, {
          button: 0,
          buttons: 1,
          ...renderedLineMidpoint(duplicateLine),
          pointerId
        });
        blockReactPointerBoundary = false;
        fireEvent.pointerUp(duplicateLine, {
          buttons: 0,
          ...renderedLineMidpoint(duplicateLine),
          pointerId
        });
        await Promise.resolve();
      });
    };

    await clickLine(1);
    expect(useCadUiStore.getState().activeLinePickTarget?.draftLineIds).toEqual([lineId]);
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);

    await clickLine(1);
    expect(useCadUiStore.getState().activeLinePickTarget?.draftLineIds).toEqual([]);
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);

    await clickLine(1, true);
    expect(useCadUiStore.getState().activeLinePickTarget?.draftLineIds).toEqual([lineId]);
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);
    view.unmount();
    container.removeEventListener("pointerdown", stopReactPointerBoundary);
    container.remove();
  });

  it("routes Shift+Enter from the Canvas-owned pick through Creation Assist as non-destructive Back", () => {
    useCadDocumentStore.getState().replaceTextDocument(baseline, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    const state = useCadDocumentStore.getState();
    const sourceCursor = currentCanvasCreationCursor();
    const evaluation = evaluateElements(state.elements);
    const view = render(renderCurrent(
      evaluation,
      evaluationState(evaluation, state.compiledDocumentRevision, state.compiledDocumentRevision),
      { requestId: 1, sourceCursor }
    ));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Expected Canvas viewport");
    const recipe = creationRecipeForType("offsetLine");
    if (!recipe) throw new Error("Missing Offset Line creation recipe");

    act(() => {
      expect(startCommandLineCreationForRecipe(recipe, {
        currentSourceCursor: () => sourceCursor,
        sourceCreationOrigin: "canvas-retained"
      })).toBe(true);
    });
    const nameInput = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(nameInput, { target: { value: "Offset" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });
    const suppliedArgs = useCadUiStore.getState().commandLineSession?.args;
    expect(suppliedArgs).toEqual({ name: "Offset" });
    expect(document.activeElement).toBe(viewport);

    fireEvent.keyDown(viewport, { key: "Enter", shiftKey: true });

    expect(useCadUiStore.getState().commandLineSession?.currentStepIndex).toBe(0);
    expect(useCadUiStore.getState().commandLineSession?.args).toEqual(suppliedArgs);
    expect(useCadUiStore.getState().activeLinePickTarget).toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
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
