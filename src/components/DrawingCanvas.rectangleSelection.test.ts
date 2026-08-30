import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creationRecipeForType } from "../commands/creationRecipes";
import { startSession } from "../commands/commandLineSession";
import { canvasRectangleSelectionForMembers } from "../commands/canvasRectangleSelectionCommands";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { useCadUiStore } from "../state/cadUiStore";
import { useCadDocumentStore, type SelectionSnapshot } from "../state/cadDocumentStore";
import { DEFAULT_CANVAS_VIEWPORT } from "../state/useCadStore";
import type { CadElement } from "../types/geometry";
import { DrawingCanvas, type DrawingCanvasHandle } from "./DrawingCanvas";
import type { CanvasHostAdapter } from "./canvasHostAdapter";
import { LEGACY_CANVAS_THEME } from "./canvasTheme";
import { worldToScreen } from "./canvasViewport";

const rectangleElements: CadElement[] = [
  {
    id: "inside-point",
    name: "Inside point",
    type: "freePoint",
    activity: "visible",
    x: -100,
    y: 50
  },
  {
    id: "outside-point",
    name: "Outside point",
    type: "freePoint",
    activity: "visible",
    x: 200,
    y: -100
  },
  {
    id: "window-line",
    name: "Window line",
    type: "line",
    activity: "visible",
    startPoint: { mode: "coordinate", x: -80, y: 40 },
    endPoint: { mode: "coordinate", x: -20, y: 40 }
  },
  {
    id: "crossing-line",
    name: "Crossing line",
    type: "line",
    activity: "visible",
    startPoint: { mode: "coordinate", x: 0, y: 150 },
    endPoint: { mode: "coordinate", x: 0, y: -150 }
  }
];

const screenFor = (point: { x: number; y: number }) =>
  worldToScreen(point, { width: 500, height: 400 }, DEFAULT_CANVAS_VIEWPORT);

const insidePointScreen = screenFor({ x: -100, y: 50 });

const mockCanvasContext = () => ({
  arc: vi.fn(),
  bezierCurveTo: vi.fn(),
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  lineTo: vi.fn(),
  moveTo: vi.fn(),
  setLineDash: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn()
});

const selectionBefore = {
  selectedElementId: "outside-point",
  selectedElementIds: ["outside-point"],
  selectionAnchorElementId: "outside-point"
};

const createHostAdapter = (
  overrides: Partial<CanvasHostAdapter> = {}
): CanvasHostAdapter => {
  const elements = overrides.elements ?? rectangleElements;
  const canonicalElements = overrides.canonicalElements ?? elements;
  return {
    elements,
    canonicalElements,
    evaluationLimitIndex: undefined,
    compiledDocumentRevision: 0,
    canvasTheme: LEGACY_CANVAS_THEME,
    visibilityProfiles: [],
    activeVisibilityProfileId: null,
    moduleSemanticContext: {},
    selectedElementId: selectionBefore.selectedElementId,
    selectedElementIds: [...selectionBefore.selectedElementIds],
    selectionAnchorElementId: selectionBefore.selectionAnchorElementId,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    showCanvasPointNames: true,
    showCanvasGeometryNames: false,
    showCanvasPoints: true,
    renderFixedCanvasChrome: false,
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    commandLineSession: null,
    flushSourceEditorOnCanvasPointerDown: vi.fn<CanvasHostAdapter["flushSourceEditorOnCanvasPointerDown"]>(() => "clean"),
    setCommandErrorMessage: vi.fn(),
    focusSourceEditor: vi.fn(),
    getCurrentCanonicalDocument: () => ({
      elements,
      sourceRevision: 0,
      compiledDocumentRevision: 0,
      sourceText: "",
      docText: ""
    }),
    panCanvasViewport: vi.fn(),
    zoomCanvasViewportAt: vi.fn(),
    selectElement: vi.fn(),
    getCanvasSelectionSnapshot: () => ({ ...selectionBefore, selectedElementIds: [...selectionBefore.selectedElementIds] }),
    previewCanvasSelection: vi.fn(),
    finalizeCanvasSelectionSession: vi.fn(),
    commitCanvasRectangleSelection: vi.fn(),
    clearCanvasSelection: vi.fn(),
    movePointElementByDelta: vi.fn(),
    moveBezierHandleByDelta: vi.fn(),
    applyPickedNumericReference: vi.fn(),
    applyNumericExpressionReference: vi.fn(),
    applyPickedLine: vi.fn(),
    applyPickedPoint: vi.fn(),
    toggleCanvasPoints: vi.fn(),
    resolveImageSourceUrl: (sourcePath) => sourcePath,
    ...overrides
  };
};

const renderCanvas = (
  overrides: Partial<CanvasHostAdapter> = {},
  evaluationState?: EvaluationEngineState
) => {
  const hostAdapter = createHostAdapter(overrides);
  const evaluation = evaluateElements(hostAdapter.elements);
  const view = render(createElement(DrawingCanvas, {
    evaluation,
    evaluationState,
    canvasFocusRef: createRef<HTMLDivElement>(),
    hostAdapter
  }));
  const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
  if (!viewport) throw new Error("Missing canvas viewport");
  return { ...view, hostAdapter, viewport, evaluation };
};

const pointer = (x: number, y: number) => ({ clientX: x, clientY: y });

beforeEach(() => {
  useCadDocumentStore.setState({ elements: rectangleElements });
  useCadUiStore.setState({
    selectedElementId: selectionBefore.selectedElementId,
    selectedElementIds: [...selectionBefore.selectedElementIds],
    selectionAnchorElementId: selectionBefore.selectionAnchorElementId
  });
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DrawingCanvas rectangle selection", () => {
  it("keeps sub-threshold blank movement selection-only and shows no rectangle", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const { container, viewport } = renderCanvas({ commitCanvasRectangleSelection });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(57, 50), pointerId: 1 });

    expect(container.querySelector("[data-canvas-rectangle-selection]")).toBeNull();
    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();

    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(57, 50), pointerId: 1 });
    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();
  });

  it("activates at eight pixels, presents the rectangle, and commits only on release", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const { container, viewport } = renderCanvas({ commitCanvasRectangleSelection });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), pointerId: 2 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(58, 50), pointerId: 2 });

    expect(container.querySelector("[data-canvas-rectangle-selection='window']")).toBeInTheDocument();
    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();

    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(58, 50), pointerId: 2 });
    expect(commitCanvasRectangleSelection).toHaveBeenCalledTimes(1);
    expect(commitCanvasRectangleSelection).toHaveBeenCalledWith([], "replace");
  });

  it("uses Window membership for a left-to-right drag", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const { viewport } = renderCanvas({ commitCanvasRectangleSelection });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), pointerId: 3 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(240, 240), pointerId: 3 });
    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(240, 240), pointerId: 3 });

    expect(commitCanvasRectangleSelection).toHaveBeenCalledOnce();
    expect(commitCanvasRectangleSelection).toHaveBeenCalledWith(
      ["window-line", "inside-point"],
      "replace"
    );
  });

  it("uses Crossing membership and a dashed presentation for a right-to-left drag", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const { container, viewport } = renderCanvas({ commitCanvasRectangleSelection });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(400, 300), pointerId: 4 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(100, 100), pointerId: 4 });

    const rectangle = container.querySelector<SVGRectElement>("[data-canvas-rectangle-selection='crossing']");
    expect(rectangle).toBeInTheDocument();
    expect(rectangle).toHaveAttribute("stroke-dasharray", "6 4");
    expect(rectangle).toHaveStyle({ pointerEvents: "none" });

    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(100, 100), pointerId: 4 });
    expect(commitCanvasRectangleSelection).toHaveBeenCalledWith(
      ["window-line", "crossing-line", "inside-point"],
      "replace"
    );
  });

  it.each([
    ["Shift", { shiftKey: true }, "add"],
    ["Meta", { metaKey: true }, "toggle"],
    ["Ctrl", { ctrlKey: true }, "toggle"]
  ] as const)("maps %s to rectangle %s", (_label, modifiers, expectedMode) => {
    const commitCanvasRectangleSelection = vi.fn();
    const { viewport } = renderCanvas({ commitCanvasRectangleSelection });

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      ...pointer(50, 50),
      ...modifiers,
      pointerId: 5
    });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(80, 80), pointerId: 5 });
    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(80, 80), pointerId: 5 });

    expect(commitCanvasRectangleSelection).toHaveBeenCalledWith([], expectedMode);
  });

  it("keeps empty add and toggle results unchanged through the existing pure semantics", () => {
    let currentSelection: SelectionSnapshot = { ...selectionBefore, selectedElementIds: [...selectionBefore.selectedElementIds] };
    const commitCanvasRectangleSelection = vi.fn((memberIds: readonly string[], mode: "replace" | "add" | "toggle") => {
      const next = canvasRectangleSelectionForMembers(
        rectangleElements,
        currentSelection,
        memberIds,
        mode
      );
      if (next) currentSelection = next;
    });
    const { viewport } = renderCanvas({ commitCanvasRectangleSelection });

    for (const [pointerId, modifiers] of [
      [6, { shiftKey: true }],
      [7, { metaKey: true }]
    ] as const) {
      fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), ...modifiers, pointerId });
      fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(80, 80), pointerId });
      fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(80, 80), pointerId });
    }

    expect(currentSelection).toEqual(selectionBefore);
    expect(commitCanvasRectangleSelection).toHaveBeenCalledTimes(2);
  });

  it("clears through replace semantics for an activated empty rectangle", () => {
    let currentSelection: SelectionSnapshot = { ...selectionBefore, selectedElementIds: [...selectionBefore.selectedElementIds] };
    const commitCanvasRectangleSelection = vi.fn((memberIds: readonly string[], mode: "replace" | "add" | "toggle") => {
      const next = canvasRectangleSelectionForMembers(rectangleElements, currentSelection, memberIds, mode);
      if (next) currentSelection = next;
    });
    const { viewport } = renderCanvas({ commitCanvasRectangleSelection });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), pointerId: 8 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(80, 80), pointerId: 8 });
    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(80, 80), pointerId: 8 });

    expect(currentSelection).toMatchObject({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    });
  });

  it("cancels without committing or changing the prior selection", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const { container, viewport } = renderCanvas({ commitCanvasRectangleSelection });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), pointerId: 9 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(240, 240), pointerId: 9 });
    expect(container.querySelector("[data-canvas-rectangle-selection]")).toBeInTheDocument();

    fireEvent.pointerCancel(viewport, { buttons: 0, ...pointer(240, 240), pointerId: 9 });
    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();
    expect(container.querySelector("[data-canvas-rectangle-selection]")).toBeNull();
  });

  it("keeps an activated rectangle active when the pointer returns within the threshold", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const { container, viewport } = renderCanvas({ commitCanvasRectangleSelection });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), pointerId: 10 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(70, 50), pointerId: 10 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(54, 50), pointerId: 10 });
    expect(container.querySelector("[data-canvas-rectangle-selection='window']")).toBeInTheDocument();
    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();

    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(54, 50), pointerId: 10 });
    expect(commitCanvasRectangleSelection).toHaveBeenCalledOnce();
  });

  it("keeps point-origin movement as point drag instead of rectangle selection", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const movePointElementByDelta = vi.fn();
    const { container, viewport } = renderCanvas({ commitCanvasRectangleSelection, movePointElementByDelta });

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      ...pointer(insidePointScreen.x, insidePointScreen.y),
      pointerId: 11
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      ...pointer(insidePointScreen.x + 12, insidePointScreen.y),
      pointerId: 11
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      ...pointer(insidePointScreen.x + 12, insidePointScreen.y),
      pointerId: 11
    });

    expect(movePointElementByDelta).toHaveBeenCalledTimes(2);
    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();
    expect(container.querySelector("[data-canvas-rectangle-selection]")).toBeNull();
  });

  it("keeps ordinary geometry-origin interaction as click selection", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const selectElement = vi.fn();
    const { viewport } = renderCanvas({ commitCanvasRectangleSelection, selectElement });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(200, 160), pointerId: 12 });
    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(200, 160), pointerId: 12 });

    expect(selectElement).toHaveBeenCalledWith("window-line", "replace");
    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();
  });

  it("suppresses rectangle selection during active Reference Pick", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const { viewport } = renderCanvas({
      commitCanvasRectangleSelection,
      activePointPickTarget: { elementId: "target", parameterKey: "startPoint" }
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), pointerId: 13 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(240, 240), pointerId: 13 });
    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(240, 240), pointerId: 13 });

    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();
  });

  it("suppresses rectangle selection during command-line ghost interaction", () => {
    const ghost: CadElement = {
      id: "command-line-ghost",
      name: "",
      type: "freePoint",
      activity: "visible",
      x: 100,
      y: 0
    };
    const commandLineSession = startSession(creationRecipeForType("freePoint")!, {
      insertionIndex: rectangleElements.length,
      revision: 0,
      elements: rectangleElements
    });
    const commitCanvasRectangleSelection = vi.fn();
    const { viewport } = renderCanvas({
      elements: [...rectangleElements, ghost],
      canonicalElements: rectangleElements,
      commandLineSession,
      commitCanvasRectangleSelection
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), pointerId: 14 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(240, 240), pointerId: 14 });
    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(240, 240), pointerId: 14 });

    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();
  });

  it("leaves middle-button pan unchanged", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const panCanvasViewport = vi.fn();
    const { viewport } = renderCanvas({ commitCanvasRectangleSelection, panCanvasViewport });

    fireEvent.pointerDown(viewport, { button: 1, buttons: 4, ...pointer(50, 50), pointerId: 15 });
    fireEvent.pointerMove(viewport, { buttons: 4, ...pointer(80, 90), pointerId: 15 });
    fireEvent.pointerUp(viewport, { button: 1, buttons: 0, ...pointer(80, 90), pointerId: 15 });

    expect(panCanvasViewport).toHaveBeenCalledWith(30, 40);
    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();
  });

  it("resolves a deferred blank drag against current prepared geometry and latest pointer position", async () => {
    const initialElements: CadElement[] = [];
    const currentElements: CadElement[] = [rectangleElements[2]!];
    const commitCanvasRectangleSelection = vi.fn();
    const staleEvaluation = evaluateElements(initialElements);
    const staleState: EvaluationEngineState = {
      evaluation: staleEvaluation,
      evaluationRevision: 0,
      evaluationRequestRevision: 0,
      mode: "reference",
      source: "reference",
      status: "ready",
      rustEligible: false,
      isStale: false,
      error: null
    };
    const currentState: EvaluationEngineState = {
      evaluation: evaluateElements(currentElements),
      evaluationRevision: 1,
      evaluationRequestRevision: 1,
      mode: "reference",
      source: "reference",
      status: "ready",
      rustEligible: false,
      isStale: false,
      error: null
    };
    const staleAdapter = createHostAdapter({
      elements: initialElements,
      canonicalElements: initialElements,
      compiledDocumentRevision: 1,
      getCurrentCanonicalDocument: () => ({
        elements: initialElements,
        sourceRevision: 0,
        compiledDocumentRevision: 1,
        sourceText: "",
        docText: ""
      }),
      commitCanvasRectangleSelection
    });
    const view = render(createElement(DrawingCanvas, {
      evaluation: staleEvaluation,
      evaluationState: staleState,
      canvasFocusRef: createRef<HTMLDivElement>(),
      hostAdapter: staleAdapter
    }));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Missing canvas viewport");

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), pointerId: 16 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(240, 240), pointerId: 16 });
    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();

    const currentAdapter = createHostAdapter({
      elements: currentElements,
      canonicalElements: currentElements,
      compiledDocumentRevision: 1,
      getCurrentCanonicalDocument: () => ({
        elements: currentElements,
        sourceRevision: 0,
        compiledDocumentRevision: 1,
        sourceText: "",
        docText: ""
      }),
      commitCanvasRectangleSelection
    });
    await act(async () => {
      view.rerender(createElement(DrawingCanvas, {
        evaluation: currentState.evaluation,
        evaluationState: currentState,
        canvasFocusRef: createRef<HTMLDivElement>(),
        hostAdapter: currentAdapter
      }));
      await Promise.resolve();
    });

    await waitFor(() => expect(view.container.querySelector("[data-canvas-rectangle-selection='window']")).toBeInTheDocument());
    fireEvent.pointerUp(viewport, { buttons: 0, ...pointer(240, 240), pointerId: 16 });
    expect(commitCanvasRectangleSelection).toHaveBeenCalledWith(["window-line"], "replace");
  });

  it("clears an active rectangle when finalizeCanvasInteraction is invoked", () => {
    const commitCanvasRectangleSelection = vi.fn();
    const drawingCanvasRef = createRef<DrawingCanvasHandle>();
    const hostAdapter = createHostAdapter({ commitCanvasRectangleSelection });
    const view = render(createElement(DrawingCanvas, {
      ref: drawingCanvasRef,
      evaluation: evaluateElements(hostAdapter.elements),
      canvasFocusRef: createRef<HTMLDivElement>(),
      hostAdapter
    }));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Missing canvas viewport");

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, ...pointer(50, 50), pointerId: 17 });
    fireEvent.pointerMove(viewport, { buttons: 1, ...pointer(240, 240), pointerId: 17 });
    act(() => drawingCanvasRef.current?.finalizeCanvasInteraction());

    expect(view.container.querySelector("[data-canvas-rectangle-selection]")).toBeNull();
    expect(commitCanvasRectangleSelection).not.toHaveBeenCalled();
  });
});
