import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { dispatchCommand } from "../commands/commands";
import { creationRecipeForType } from "../commands/creationRecipes";
import { startSession } from "../commands/commandLineSession";
import type { SourceEditSession } from "../editor/sourceEditSession";
import { evaluateElements } from "../geometry/evaluate";
import { canvasPresentationEligibleElementIds } from "../geometry/canvasDrawingBounds";
import { makeNumericExpression } from "../geometry/numericExpressions";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { LEGACY_CANVAS_THEME } from "./canvasTheme";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, useCadDocumentStore, useCadStore } from "../state/useCadStore";
import { useCadUiStore } from "../state/cadUiStore";
import { DrawingCanvas } from "./DrawingCanvas";
import { DrawingCanvasTestHost } from "./DrawingCanvas.testHost";
import type { CanvasHostAdapter } from "./canvasHostAdapter";
import { worldToScreen } from "./canvasViewport";
import { hitTestCanvasGeometry } from "./DrawingCanvasHitTest";
import {
  abortBenchmarkSample,
  beginBenchmarkSample,
  capturePointerMoveEntry,
  claimPointerMoveEntry,
  drainCompletedBenchmarkSamples
} from "../performance/benchmarkInstrumentation";
import { waitForCurrentDrawAndFrame } from "../performance/benchmarkFrameObserver";
import type {
  CadElement,
  ComputedBezierCurve,
  ComputedLine,
  ComputedPoint
} from "../types/geometry";

const point = (elementId: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId,
  name: elementId,
  x,
  y
});

const line = (
  elementId: string,
  start: ComputedPoint,
  end: ComputedPoint
): ComputedLine => ({
  kind: "line",
  elementId,
  name: elementId,
  startPointId: start.elementId,
  endPointId: end.elementId,
  start,
  end,
  length: Math.hypot(end.x - start.x, end.y - start.y),
  startAngleDeg: 0,
  endAngleDeg: 180,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180
});

const bezierCurve = (
  elementId: string,
  start: ComputedPoint,
  end: ComputedPoint
): ComputedBezierCurve => ({
  kind: "bezierCurve",
  elementId,
  name: elementId,
  startPointId: start.elementId,
  endPointId: end.elementId,
  intermediatePointIds: [],
  segments: [
    {
      startPointId: start.elementId,
      endPointId: end.elementId,
      start,
      control1: { x: start.x + 30, y: start.y },
      control2: { x: end.x - 30, y: end.y },
      end
    }
  ],
  length: 100,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180,
  startHandleAngleDeg: 0,
  startHandleLength: 30,
  endHandleAngleDeg: 0,
  endHandleLength: 30
});

const forGroupPickElements = (): CadElement[] => [
  {
    id: "loop", name: "Loop", type: "forGroup", activity: "visible",
    variableName: "i", start: 0, count: 3, step: 1, showGenerated: true
  },
  {
    id: "loop-point", name: "Loop point", type: "freePoint", activity: "visible",
    parentGroupId: "loop", x: makeNumericExpression("@i * 40"), y: 0
  },
  {
    id: "loop-line", name: "Loop line", type: "line", activity: "visible",
    parentGroupId: "loop", startPoint: { mode: "reference", pointId: "loop-point" },
    endPoint: { mode: "coordinate", x: makeNumericExpression("@i * 40"), y: 20 }
  },
  {
    id: "endpoint-target", name: "Endpoint target", type: "lineDivisionPoint", activity: "visible",
    parentGroupId: "loop", endpoint: { lineId: "loop-line", endpointKey: "start" },
    placement: { kind: "ratio", value: 0.5 }
  },
  {
    id: "point-target", name: "Point target", type: "offsetPoint", activity: "visible",
    parentGroupId: "loop", fromPoint: { mode: "reference", pointId: "loop-point" }, dx: 5, dy: 0
  },
  {
    id: "line-target", name: "Line target", type: "offsetLine", activity: "visible",
    parentGroupId: "loop", baseLineIds: [], offset: 2, side: "right", closed: false
  }
];

const screenFor = (point: { x: number; y: number }) =>
  worldToScreen(point, { width: 500, height: 400 }, DEFAULT_CANVAS_VIEWPORT);

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    previewElements: null,
    previewEvaluationLimitIndex: null,
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectionAnchorElementId: sampleElements[0].id,
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activeMeasurementInsertTarget: null,
    activePickCursor: null,
    commandLineSession: null,
    elementSearchQuery: "",
    elementSearchCursorId: null,
    elementSearchPickableOnly: false,
    showCanvasPointNames: true,
    showCanvasGeometryNames: false,
    showCanvasPoints: true,
    canvasSelectionEligibleElementIds: null,
    showShortcutHelp: false,
    showShortcutSettings: false,
    shortcutSettings: { version: 1, overrides: [] },
    shortcutSettingsLoading: false,
    shortcutSettingsError: null,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    past: [],
    future: [],
    currentFilePath: null,
    dirtySinceSave: false
  });
};

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

const renderDrawingCanvas = () => {
  const view = render(
    createElement(DrawingCanvasTestHost, {
      evaluation: evaluateElements(useCadStore.getState().elements),
      canvasFocusRef: createRef<HTMLDivElement>(),
      leftPanelDockRef: createRef<HTMLDivElement>()
    })
  );
  const viewport = view.container.querySelector(".canvas-viewport");
  if (!(viewport instanceof HTMLDivElement)) {
    throw new Error("Missing canvas viewport");
  }
  return { ...view, viewport };
};

const renderWithHostAdapter = (overrides: Partial<CanvasHostAdapter> = {}) => {
  const hostAdapter = createFakeCanvasHostAdapter(overrides);
  const view = render(createElement(DrawingCanvas, {
    evaluation: evaluateElements(hostAdapter.elements),
    canvasFocusRef: createRef<HTMLDivElement>(),
    hostAdapter
  }));
  const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
  if (!viewport) throw new Error("Missing canvas viewport");
  return { ...view, hostAdapter, viewport };
};

const createFakeCanvasHostAdapter = (
  overrides: Partial<CanvasHostAdapter> = {}
): CanvasHostAdapter => {
  const elements = useCadStore.getState().elements;
  return {
    elements,
    canonicalElements: elements,
    evaluationLimitIndex: undefined,
    compiledDocumentRevision: 0,
    canvasTheme: LEGACY_CANVAS_THEME,
    visibilityProfiles: [],
    activeVisibilityProfileId: null,
    moduleSemanticContext: {},
    selectedElementId: useCadStore.getState().selectedElementId,
    selectedElementIds: useCadStore.getState().selectedElementIds,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    showCanvasPointNames: true,
    showCanvasGeometryNames: false,
    showCanvasPoints: true,
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
    getCanvasSelectionSnapshot: () => ({
      selectedElementId: useCadUiStore.getState().selectedElementId,
      selectedElementIds: [...useCadUiStore.getState().selectedElementIds],
      selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId
    }),
    previewCanvasSelection: vi.fn(),
    finalizeCanvasSelectionSession: vi.fn(),
    commitCanvasRectangleSelection: vi.fn(),
    movePointElementByDelta: vi.fn(),
    moveBezierHandleByDelta: vi.fn(),
    clearCanvasSelection: vi.fn(),
    applyPickedNumericReference: vi.fn(),
    applyNumericExpressionReference: vi.fn(),
    applyPickedLine: vi.fn(),
    applyPickedPoint: vi.fn(),
    toggleCanvasPointNames: vi.fn(),
    toggleCanvasGeometryNames: vi.fn(),
    toggleCanvasPoints: vi.fn(),
    resolveImageSourceUrl: (sourcePath) => sourcePath,
    ...overrides
  };
};

const referenceEvaluationState = (revision: number): EvaluationEngineState => ({
  evaluation: evaluateElements(useCadStore.getState().elements),
  evaluationRevision: revision,
  evaluationRequestRevision: revision,
  mode: "reference",
  source: "reference",
  status: "idle",
  rustEligible: false,
  isStale: false,
  error: null
});

const dragPoint = (
  viewport: HTMLElement,
  {
    fromX,
    fromY,
    toX,
    toY,
    pointerId = 1
  }: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    pointerId?: number;
  }
) => {
  fireEvent.pointerDown(viewport, {
    button: 0,
    buttons: 1,
    clientX: fromX,
    clientY: fromY,
    pointerId
  });
  fireEvent.pointerMove(viewport, {
    buttons: 1,
    clientX: toX,
    clientY: toY,
    pointerId
  });
  fireEvent.pointerUp(viewport, {
    buttons: 0,
    clientX: toX,
    clientY: toY,
    pointerId
  });
};

beforeEach(() => {
  resetStore();

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

describe("DrawingCanvas rendering", () => {
  it("does not publish stale Canvas presentation eligibility", async () => {
    const hostAdapter = createFakeCanvasHostAdapter({ compiledDocumentRevision: 1 });
    const evaluation = evaluateElements(hostAdapter.elements);
    const staleEvaluationState: EvaluationEngineState = {
      evaluation,
      evaluationRevision: 0,
      evaluationRequestRevision: 0,
      mode: "reference",
      source: "reference",
      status: "idle",
      rustEligible: false,
      isStale: false,
      error: null
    };
    const view = render(createElement(DrawingCanvas, {
      evaluation,
      evaluationState: staleEvaluationState,
      canvasFocusRef: createRef<HTMLDivElement>(),
      hostAdapter
    }));

    expect(useCadUiStore.getState().canvasSelectionEligibleElementIds).toBeNull();

    await act(async () => {
      view.rerender(createElement(DrawingCanvas, {
        evaluation,
        evaluationState: { ...staleEvaluationState, evaluationRevision: 1, evaluationRequestRevision: 1 },
        canvasFocusRef: createRef<HTMLDivElement>(),
        hostAdapter
      }));
    });

    expect(useCadUiStore.getState().canvasSelectionEligibleElementIds).toEqual(
      canvasPresentationEligibleElementIds({
        elements: hostAdapter.elements,
        evaluation,
        visibilityProfiles: [],
        activeVisibilityProfileId: null,
        showCanvasPoints: true
      })
    );
  });

  it("classifies context-menu hits through the existing hit-test without selecting or suppressing the native menu", () => {
    const publishCanvasContextMenu = vi.fn();
    const publishCanvasPointerPosition = vi.fn();
    const { viewport } = renderWithHostAdapter({ publishCanvasContextMenu, publishCanvasPointerPosition });
    const selectionBefore = [...useCadUiStore.getState().selectedElementIds];

    const blankContextMenu = new MouseEvent("contextmenu", {
      bubbles: true,
      clientX: 10,
      clientY: 10
    });
    const blankPreventDefault = vi.spyOn(blankContextMenu, "preventDefault");
    viewport.dispatchEvent(blankContextMenu);

    const elementContextMenu = new MouseEvent("contextmenu", {
      bubbles: true,
      clientX: 300,
      clientY: 250
    });
    const elementPreventDefault = vi.spyOn(elementContextMenu, "preventDefault");
    viewport.dispatchEvent(elementContextMenu);

    expect(publishCanvasContextMenu).toHaveBeenNthCalledWith(1, {
      kind: "blank",
      pointer: { x: -240, y: 190 }
    });
    expect(publishCanvasContextMenu).toHaveBeenNthCalledWith(2, { kind: "element" });
    expect(publishCanvasPointerPosition).toHaveBeenNthCalledWith(1, { x: -240, y: 190 });
    expect(useCadUiStore.getState().selectedElementIds).toEqual(selectionBefore);
    expect(blankPreventDefault).not.toHaveBeenCalled();
    expect(elementPreventDefault).not.toHaveBeenCalled();
  });

  it("opens an overlap candidate session for a short multi-hit point click and commits one final selection transition", () => {
    const previewCanvasSelection = vi.fn();
    const finalizeCanvasSelectionSession = vi.fn();
    const { viewport } = renderWithHostAdapter({
      previewCanvasSelection,
      finalizeCanvasSelectionSession
    });

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });

    expect(viewport.querySelector('[role="listbox"]')).toBeInTheDocument();
    expect(viewport.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(viewport.querySelector('[role="listbox"]')).toHaveStyle({ left: "8px", top: "8px" });
    expect(previewCanvasSelection).toHaveBeenCalled();

    const arrowDown = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
    const arrowPreventDefault = vi.spyOn(arrowDown, "preventDefault");
    const arrowStopPropagation = vi.spyOn(arrowDown, "stopPropagation");
    viewport.dispatchEvent(arrowDown);
    expect(arrowPreventDefault).toHaveBeenCalled();
    expect(arrowStopPropagation).toHaveBeenCalled();
    expect(previewCanvasSelection.mock.calls.at(-1)?.[1]).toBe("curve-ac");
    fireEvent.keyDown(viewport, { key: "Enter" });
    expect(finalizeCanvasSelectionSession).toHaveBeenCalledTimes(1);
    expect(viewport.querySelector('[role="listbox"]')).toBeNull();
  });

  it("cycles overlap candidates by wheel remainder without reversing direction", () => {
    const previewCanvasSelection = vi.fn();
    const { viewport } = renderWithHostAdapter({ previewCanvasSelection });

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    const previewCount = previewCanvasSelection.mock.calls.length;

    fireEvent.wheel(viewport, { deltaY: 20, deltaMode: 0, clientX: 300, clientY: 250 });
    fireEvent.wheel(viewport, { deltaY: -1, deltaMode: 0, clientX: 300, clientY: 250 });
    expect(previewCanvasSelection).toHaveBeenCalledTimes(previewCount);

    fireEvent.wheel(viewport, { deltaY: -24, deltaMode: 0, clientX: 300, clientY: 250 });
    expect(previewCanvasSelection).toHaveBeenCalledTimes(previewCount + 1);
    expect(previewCanvasSelection.mock.calls.at(-1)?.[1]).toBe("line-ab");
  });

  it("shows one named hover behind an unnamed front hit without opening a popup", async () => {
    const elements: CadElement[] = [
      { id: "unnamed-point", name: "", type: "freePoint", activity: "visible", x: 0, y: 0 },
      {
        id: "named-line",
        name: "Named line",
        type: "line",
        activity: "visible",
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 100, y: 0 }
      }
    ];
    const { container, viewport } = renderWithHostAdapter({
      elements,
      canonicalElements: elements,
      selectedElementId: null,
      selectedElementIds: []
    });

    fireEvent.pointerMove(viewport, { buttons: 0, clientX: 250, clientY: 200, pointerId: 1 });

    await waitFor(() => expect(container.querySelector("[data-element-identity='named-line']")).toBeInTheDocument());
    expect(container.querySelector(".canvas-hover-identity-candidate-menu")).toBeNull();
    expect(container.querySelector("[data-element-identity='unnamed-point']")).toBeNull();
  });

  it("shows a passive front-to-back popup for multiple named hover hits and emphasizes persistent labels", async () => {
    const { container, viewport } = renderWithHostAdapter();

    fireEvent.pointerMove(viewport, { buttons: 0, clientX: 300, clientY: 250, pointerId: 1 });

    await waitFor(() => expect(container.querySelector(".canvas-hover-identity-candidate-menu")).toBeInTheDocument());
    expect(container.querySelectorAll(".canvas-hover-identity-candidate-menu [role='option']")).toHaveLength(2);
    expect(container.querySelector("[data-element-identity='point-a']")).toHaveClass(
      "overlay-element-identity-hovered"
    );
    expect(container.querySelector(".canvas-hover-identity-candidate-menu")).toHaveClass(
      "canvas-hover-identity-candidate-menu"
    );
  });

  it("suppresses hover identity while point picking is active", async () => {
    const { container, viewport } = renderWithHostAdapter({
      activePointPickTarget: { elementId: "line-ab", parameterKey: "startPoint" }
    });

    fireEvent.pointerMove(viewport, { buttons: 0, clientX: 300, clientY: 250, pointerId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(container.querySelector("[data-element-identity='point-a']")).not.toHaveClass(
      "overlay-element-identity-hovered"
    );
    expect(container.querySelector(".canvas-hover-identity-candidate-menu")).toBeNull();
  });

  it.each([
    ["no modifier", {}],
    ["Meta", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Shift", { shiftKey: true }]
  ])("keeps selection and focuses Canvas on a blank left click with %s", (_modifierLabel, modifiers) => {
    const hostAdapter = createFakeCanvasHostAdapter();
    const evaluation = evaluateElements(hostAdapter.elements);
    const view = render(createElement(DrawingCanvas, {
      evaluation,
      canvasFocusRef: createRef<HTMLDivElement>(),
      hostAdapter
    }));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Missing canvas viewport");

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 1,
      clientY: 1,
      pointerId: 1,
      ...modifiers
    });

    expect(hostAdapter.clearCanvasSelection).not.toHaveBeenCalled();
    expect(viewport).toBe(document.activeElement);
  });

  it("clears selection on Canvas Escape but leaves active pick interactions to their owner", () => {
    const hostAdapter = createFakeCanvasHostAdapter();
    const evaluation = evaluateElements(hostAdapter.elements);
    const view = render(createElement(DrawingCanvas, {
      evaluation,
      canvasFocusRef: createRef<HTMLDivElement>(),
      hostAdapter
    }));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Missing canvas viewport");

    viewport.focus();
    fireEvent.keyDown(viewport, { key: "Escape" });
    expect(hostAdapter.clearCanvasSelection).toHaveBeenCalledTimes(1);

    view.unmount();
    const pickingAdapter = createFakeCanvasHostAdapter({
      activePointPickTarget: { elementId: "target", parameterKey: "point" }
    });
    const pickingView = render(createElement(DrawingCanvas, {
      evaluation,
      canvasFocusRef: createRef<HTMLDivElement>(),
      hostAdapter: pickingAdapter
    }));
    const pickingViewport = pickingView.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!pickingViewport) throw new Error("Missing picking canvas viewport");
    pickingViewport.focus();
    fireEvent.keyDown(pickingViewport, { key: "Escape" });

    expect(pickingAdapter.clearCanvasSelection).not.toHaveBeenCalled();
  });

  it("lets a host hide the shared fixed Canvas chrome", () => {
    const hostAdapter = createFakeCanvasHostAdapter({ renderFixedCanvasChrome: false });
    const view = render(createElement(DrawingCanvas, {
      evaluation: evaluateElements(hostAdapter.elements),
      canvasFocusRef: createRef<HTMLDivElement>(),
      hostAdapter
    }));

    expect(view.container.querySelector(".canvas-display-controls")).toBeNull();
    expect(view.container.querySelector(".canvas-warning")).toBeNull();
    expect(view.container.querySelector(".canvas-scale-overlay")).toBeNull();
  });

  it("uses the host adapter for preview and commit actions with one drag base", () => {
    const hostAdapter = createFakeCanvasHostAdapter();
    const evaluation = evaluateElements(hostAdapter.elements);
    const evaluationState: EvaluationEngineState = {
      evaluation,
      evaluationRevision: 0,
      evaluationRequestRevision: 0,
      mode: "reference",
      source: "reference",
      status: "idle",
      rustEligible: false,
      isStale: false,
      error: null
    };
    const view = render(createElement(DrawingCanvas, {
      evaluation,
      evaluationState,
      canvasFocusRef: createRef<HTMLDivElement>(),
      hostAdapter
    }));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Missing canvas viewport");

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 320,
      clientY: 260,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 320,
      clientY: 260,
      pointerId: 1
    });

    const pointActions = vi.mocked(hostAdapter.movePointElementByDelta).mock.calls;
    expect(pointActions).toHaveLength(2);
    expect(pointActions.map(([action]) => action.commitMode)).toEqual(["preview", "commit"]);
    expect(pointActions[0]?.[0].baseElements).toBe(hostAdapter.canonicalElements);
    expect(pointActions[1]?.[0].baseElements).toBe(hostAdapter.canonicalElements);
    expect(pointActions[1]?.[0].baseElements).toBe(pointActions[0]?.[0].baseElements);
    expect(hostAdapter.canonicalElements).toBe(useCadStore.getState().elements);
  });

  it("uses a current partial evaluation snapshot as the Bezier drag baseline", () => {
    const elements: CadElement[] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 100, y: 0 },
      {
        id: "curve",
        name: "Curve",
        type: "bezierCurve",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 30,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "b" },
        endHandleAngleDeg: 180,
        endHandleLength: 30
      },
      {
        id: "later-point",
        name: "Later point",
        type: "freePoint",
        activity: "visible",
        x: 10,
        y: 10
      }
    ];
    const evaluation = evaluateElements(elements, { evaluationLimitIndex: 3 });
    const hostAdapter = createFakeCanvasHostAdapter({
      elements,
      canonicalElements: elements,
      evaluationLimitIndex: 3,
      selectedElementId: "curve",
      selectedElementIds: ["curve"],
      getCurrentCanonicalDocument: () => ({
        elements,
        sourceRevision: 0,
        compiledDocumentRevision: 0,
        sourceText: "",
        docText: ""
      })
    });
    const evaluationState: EvaluationEngineState = {
      evaluation,
      evaluationRevision: 0,
      evaluationRequestRevision: 0,
      mode: "reference",
      source: "reference",
      status: "ready",
      rustEligible: false,
      isStale: false,
      error: null
    };
    const view = render(createElement(DrawingCanvas, {
      evaluation,
      evaluationState,
      canvasFocusRef: createRef<HTMLDivElement>(),
      hostAdapter
    }));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Missing canvas viewport");
    const control = worldToScreen({ x: 30, y: 0 }, { width: 500, height: 400 }, DEFAULT_CANVAS_VIEWPORT);

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: control.x,
      clientY: control.y,
      pointerId: 1
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: control.x + 10,
      clientY: control.y,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: control.x + 10,
      clientY: control.y,
      pointerId: 1
    });

    const actions = vi.mocked(hostAdapter.moveBezierHandleByDelta).mock.calls;
    expect(actions).toHaveLength(2);
    expect(actions.map(([action]) => action.commitMode)).toEqual(["preview", "commit"]);
    expect(actions.every(([action]) => action.baseEvaluation === evaluation)).toBe(true);
    expect(actions.every(([action]) => action.baseElements === elements)).toBe(true);
  });

  it("notifies the passive frame observer after the current production draw", async () => {
    const revision = useCadStore.getState().compiledDocumentRevision;
    const wait = waitForCurrentDrawAndFrame(revision);
    renderDrawingCanvas();
    await wait.promise;
  });

  it("draws Bezier offset line segments as canvas Bezier curves", () => {
    const context = mockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    );
    useCadStore.setState({
      elements: [
        {
          id: "curve",
          name: "曲線",
          type: "bezierCurve",
          activity: "hidden",
          startPoint: { mode: "coordinate", x: 0, y: 0 },
          startHandleAngleDeg: 45,
          startHandleLength: 80,
          intermediatePoints: [],
          endPoint: { mode: "coordinate", x: 120, y: 0 },
          endHandleAngleDeg: 135,
          endHandleLength: 80
        },
        {
          id: "offset",
          name: "オフセット",
          type: "offsetLine",
          activity: "visible",
          baseLineIds: ["curve"],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset",
      selectedElementIds: ["offset"]
    });

    renderDrawingCanvas();

    expect(context.bezierCurveTo).toHaveBeenCalled();
  });

  it("toggles canvas point names from the canvas controls", () => {
    const { container, getByRole } = renderDrawingCanvas();

    expect(container.querySelector("text")?.textContent).toBe("点A");

    fireEvent.click(getByRole("button", { name: "点名" }));

    expect(container.querySelectorAll("[data-element-identity]")).toHaveLength(1);
    expect(useCadStore.getState().showCanvasPointNames).toBe(false);
  });

  it("uses the semantic Canvas selection color for selected line overlays", () => {
    useCadStore.setState({
      elements: sampleElements.map((element): CadElement =>
        element.id === "line-ab" ? ({ ...element, colorId: "cut-red" } as unknown as CadElement) : element
      ),
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"]
    });

    const { container } = renderDrawingCanvas();
    const selectedLine = container.querySelector(".overlay-selected-line");

    expect(selectedLine).toHaveClass("overlay-selected-line");
    expect(container.querySelector(".drawing-overlay")?.getAttribute("style")).toContain(
      "--canvas-selection: rgb(15 118 110 / 80%)"
    );
  });

  it("uses the semantic Canvas selection color for selected point overlays", () => {
    useCadStore.setState({
      elements: sampleElements.map((element): CadElement =>
        element.id === "point-a" ? ({ ...element, colorId: "guide-blue" } as unknown as CadElement) : element
      ),
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"]
    });

    const { container } = renderDrawingCanvas();
    const selectedPoint = container.querySelector(".overlay-selected-point");
    const selectedPointGlow = container.querySelector(".overlay-selected-point-glow");

    expect(selectedPoint).toHaveAttribute("r", "3.5");
    expect(selectedPoint).toHaveClass("overlay-selected-point");
    expect(selectedPointGlow).toHaveAttribute("r", "9");
    expect(selectedPointGlow).toHaveClass("overlay-selected-point-glow");
  });

  it("hides all normal point overlays when point presentation is disabled", () => {
    const { container, getByRole } = renderDrawingCanvas();

    expect(container.querySelectorAll(".overlay-draggable-point")).toHaveLength(3);

    fireEvent.click(getByRole("button", { name: "点" }));

    expect(container.querySelectorAll(".overlay-draggable-point")).toHaveLength(0);
    expect(useCadStore.getState().showCanvasPoints).toBe(false);

    fireEvent.click(getByRole("button", { name: "点" }));

    expect(container.querySelectorAll(".overlay-draggable-point")).toHaveLength(3);
    expect(useCadStore.getState().showCanvasPoints).toBe(true);
  });

  it("does not hit an otherwise presented point at its normal location when point presentation is disabled", () => {
    const pointElement: CadElement = {
      id: "point-only",
      name: "Point only",
      type: "freePoint",
      activity: "visible",
      x: 0,
      y: 0
    };
    const selectElement = vi.fn();
    const { viewport } = renderWithHostAdapter({
      elements: [pointElement],
      canonicalElements: [pointElement],
      selectedElementId: null,
      selectedElementIds: [],
      showCanvasPoints: false,
      selectElement
    });
    const screen = screenFor({ x: pointElement.x as number, y: pointElement.y as number });

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: screen.x,
      clientY: screen.y,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: screen.x,
      clientY: screen.y,
      pointerId: 1
    });

    expect(selectElement).not.toHaveBeenCalled();
  });
});

describe("DrawingCanvas command-line ghost isolation", () => {
  it("renders a ghost without allowing it to become a normal selection or drag target", () => {
    const document = useCadDocumentStore.getState();
    const selectedBefore = useCadUiStore.getState().selectedElementId;
    useCadDocumentStore.getState().previewDocumentChange({
      elements: [
        ...document.elements,
        {
          id: "command-line-ghost",
          name: "",
          type: "freePoint",
          activity: "visible",
          x: 100,
          y: 0
        }
      ],
      evaluationLimitIndex: (document.evaluationLimitIndex ?? document.elements.length) + 1
    });
    useCadUiStore.getState().setCommandLineSession(startSession(creationRecipeForType("freePoint")!, {
      insertionIndex: document.elements.length,
      revision: document.sourceRevision,
      elements: document.elements
    }));

    const { viewport } = renderDrawingCanvas();
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 9 });
    fireEvent.pointerUp(viewport, { button: 0, buttons: 0, clientX: 350, clientY: 200, pointerId: 9 });

    expect(useCadUiStore.getState().selectedElementId).toBe(selectedBefore);
    expect(useCadDocumentStore.getState().elements).toBe(document.elements);
  });
});

describe("hitTestCanvasGeometry", () => {
  const start = point("point-a", 0, 0);
  const end = point("point-b", 100, 0);
  const baseLine = line("line-ab", start, end);

  it("selects a visible point within the point hit radius", () => {
    expect(
      hitTestCanvasGeometry({
        screen: { x: 54, y: 54 },
        lines: [],
        points: [{ point: start, screen: { x: 50, y: 50 } }]
      })
    ).toBe("point-a");
  });

  it("selects a visible line within the line hit distance", () => {
    expect(
      hitTestCanvasGeometry({
        screen: { x: 70, y: 55 },
        lines: [{ line: baseLine, start: { x: 20, y: 50 }, end: { x: 120, y: 50 } }],
        points: []
      })
    ).toBe("line-ab");
  });

  it("prefers points over lines when both are hit", () => {
    expect(
      hitTestCanvasGeometry({
        screen: { x: 50, y: 50 },
        lines: [{ line: baseLine, start: { x: 20, y: 50 }, end: { x: 120, y: 50 } }],
        points: [{ point: start, screen: { x: 50, y: 50 } }]
      })
    ).toBe("point-a");
  });

  it("uses later drawn same-kind geometry when hit targets overlap", () => {
    const laterPoint = point("point-c", 0, 0);

    expect(
      hitTestCanvasGeometry({
        screen: { x: 50, y: 50 },
        lines: [],
        points: [
          { point: start, screen: { x: 50, y: 50 } },
          { point: laterPoint, screen: { x: 50, y: 50 } }
        ]
      })
    ).toBe("point-c");
  });

  it("selects a visible Bezier curve within the curve hit distance", () => {
    const curve = bezierCurve("curve-ab", start, end);

    expect(
      hitTestCanvasGeometry({
        screen: { x: 70, y: 50 },
        lines: [],
        curves: [
          {
            curve,
            points: [
              { x: 20, y: 50 },
              { x: 120, y: 50 }
            ]
          }
        ],
        points: []
      })
    ).toBe("curve-ab");
  });

  it("selects an image inside its transformed screen corners", () => {
    expect(
      hitTestCanvasGeometry({
        screen: { x: 70, y: 70 },
        lines: [],
        images: [
          {
            image: { elementId: "image" },
            corners: [
              { x: 50, y: 50 },
              { x: 100, y: 50 },
              { x: 100, y: 100 },
              { x: 50, y: 100 }
            ]
          }
        ],
        points: []
      })
    ).toBe("image");
  });

  it("ignores hidden or unevaluated geometry because it is omitted from hit-test input", () => {
    expect(
      hitTestCanvasGeometry({
        screen: { x: 50, y: 50 },
        lines: [],
        points: []
      })
    ).toBeNull();
  });
});

describe("DrawingCanvas point dragging", () => {
  it("keeps the axis feedback absent at idle and shows the fixed bottom-right hint during a point drag", () => {
    const { container, viewport } = renderDrawingCanvas();
    const feedback = () => container.querySelector<HTMLElement>("[data-point-drag-axis-lock-feedback]");
    const hint = () => container.querySelector<HTMLElement>("[data-point-drag-axis-lock-hint]");

    expect(feedback()).toBeNull();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });

    expect(feedback()).not.toBeNull();
    expect(hint()).toHaveTextContent(/^Hold Shift for Horizontal \/ Vertical$/);
    expect(hint()).toHaveAttribute("data-point-drag-axis-lock-hint-position", "bottom-right");
    expect(hint()).toHaveStyle({ right: "0px", bottom: "0px" });
    expect(feedback()).toHaveStyle({ pointerEvents: "none" });
    expect(container.querySelector("[data-point-drag-axis-guide]")).toBeNull();

    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 320,
      clientY: 270,
      pointerId: 1
    });
    expect(hint()).toHaveStyle({ right: "0px", bottom: "0px" });

    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 320,
      clientY: 270,
      pointerId: 1
    });
    expect(feedback()).toBeNull();
  });

  it("does not retain cursor-following positioning state", () => {
    const { container, viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });

    const hint = container.querySelector<HTMLElement>("[data-point-drag-axis-lock-hint]");
    if (!hint) throw new Error("Missing point drag hint");
    expect(hint.style.right).toBe("0px");
    expect(hint.style.left).toBe("");
    expect(hint.style.top).toBe("");
    expect(hint.style.bottom).toBe("0px");
    expect(hint).toHaveAttribute("data-point-drag-axis-lock-hint-position", "bottom-right");

    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 420,
      clientY: 340,
      pointerId: 1
    });
    expect(hint.style.right).toBe("0px");
    expect(hint.style.left).toBe("");
    expect(hint.style.top).toBe("");

    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 420,
      clientY: 340,
      pointerId: 1
    });
  });

  it("seeds Shift from pointerdown, switches the guide with the dominant axis, and releases to free movement", () => {
    const { container, hostAdapter, viewport } = renderWithHostAdapter();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1,
      shiftKey: true
    });

    const xAction = container.querySelector<HTMLElement>('[data-point-drag-axis-lock-hint] [data-axis="x"]');
    expect(xAction).toHaveClass("is-active");
    expect(container.querySelector('[data-point-drag-axis-guide="x"]')).not.toBeNull();
    expect(container.querySelector('[data-point-drag-axis-guide="y"]')).toBeNull();

    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 330,
      clientY: 260,
      pointerId: 1
    });
    expect(container.querySelector('[data-point-drag-axis-guide="x"]')).not.toBeNull();
    expect(container.querySelector('[data-point-drag-axis-guide="y"]')).toBeNull();
    expect(hostAdapter.movePointElementByDelta).toHaveBeenLastCalledWith(
      expect.objectContaining({ dx: 30, dy: 0, commitMode: "preview" })
    );

    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 310,
      clientY: 290,
      pointerId: 1
    });
    expect(container.querySelector('[data-point-drag-axis-guide="x"]')).toBeNull();
    const yGuide = container.querySelector<SVGLineElement>('[data-point-drag-axis-guide="y"]');
    expect(yGuide).not.toBeNull();
    expect(yGuide).toHaveAttribute("x1", "300");
    expect(yGuide).toHaveAttribute("x2", "300");
    expect(hostAdapter.movePointElementByDelta).toHaveBeenLastCalledWith(
      expect.objectContaining({ dx: 0, dy: -40, commitMode: "preview" })
    );

    fireEvent.keyUp(window, { key: "Shift" });

    expect(container.querySelector('[data-point-drag-axis-guide]')).toBeNull();
    expect(container.querySelector("[data-point-drag-axis-lock-hint]")).toHaveTextContent(
      /^Hold Shift for Horizontal \/ Vertical$/
    );
    expect(hostAdapter.movePointElementByDelta).toHaveBeenLastCalledWith(
      expect.objectContaining({ dx: 10, dy: -40, commitMode: "preview" })
    );

    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 310,
      clientY: 290,
      pointerId: 1
    });
  });

  it("activates Shift pressed during an active point drag", () => {
    const { container, viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 320,
      clientY: 260,
      pointerId: 1
    });
    fireEvent.keyDown(window, { key: "Shift" });

    const xAction = container.querySelector<HTMLElement>('[data-point-drag-axis-lock-hint] [data-axis="x"]');
    const xGuide = container.querySelector<SVGLineElement>('[data-point-drag-axis-guide="x"]');
    expect(xAction).toHaveClass("is-active");
    expect(xGuide).toHaveAttribute("x1", "0");
    expect(xGuide).toHaveAttribute("x2", "500");
    expect(xGuide).toHaveAttribute("y1", "250");
    expect(xGuide).toHaveAttribute("y2", "250");

    fireEvent.keyUp(window, { key: "Shift" });

    expect(xAction).not.toHaveClass("is-active");
    expect(container.querySelector('[data-point-drag-axis-guide="x"]')).toBeNull();
    expect(container.querySelector("[data-point-drag-axis-lock-hint]")).not.toBeNull();

    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 320,
      clientY: 260,
      pointerId: 1
    });
  });

  it("does not activate a point-drag axis lock for X or Y", () => {
    const { container, hostAdapter, viewport } = renderWithHostAdapter();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.keyDown(window, { key: "x" });
    fireEvent.keyDown(window, { key: "y" });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 320,
      clientY: 260,
      pointerId: 1
    });

    expect(container.querySelector('[data-point-drag-axis-guide]')).toBeNull();
    expect(hostAdapter.movePointElementByDelta).toHaveBeenLastCalledWith(
      expect.objectContaining({ dx: 20, dy: -10, commitMode: "preview" })
    );

    fireEvent.keyUp(window, { key: "y" });
    fireEvent.keyUp(window, { key: "x" });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 320,
      clientY: 260,
      pointerId: 1
    });
  });

  it("uses horizontal for equal Shift displacement", () => {
    const { container, viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1,
      shiftKey: true
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 320,
      clientY: 270,
      pointerId: 1
    });

    expect(container.querySelector('[data-axis="x"]')).toHaveClass("is-active");
    expect(container.querySelector('[data-axis="y"]')).not.toHaveClass("is-active");
    expect(container.querySelector('[data-point-drag-axis-guide="x"]')).not.toBeNull();
    expect(container.querySelector('[data-point-drag-axis-guide="y"]')).toBeNull();

    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 320,
      clientY: 270,
      pointerId: 1
    });
  });

  it("clears active axis feedback on window blur but keeps the point hint until pointerup", () => {
    const { container, viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.keyDown(window, { key: "Shift" });
    expect(container.querySelector('[data-point-drag-axis-guide="x"]')).not.toBeNull();

    fireEvent.blur(window);

    expect(container.querySelector('[data-point-drag-axis-guide]')).toBeNull();
    expect(container.querySelector('[data-point-drag-axis-lock-hint]')).not.toBeNull();

    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
  });

  it("clears point feedback on pointer cancel and rejected preview mutation", () => {
    const cancelled = renderDrawingCanvas();
    fireEvent.pointerDown(cancelled.viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.keyDown(window, { key: "Shift" });
    expect(cancelled.container.querySelector("[data-point-drag-axis-lock-feedback]")).not.toBeNull();
    fireEvent.pointerCancel(cancelled.viewport, {
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    expect(cancelled.container.querySelector("[data-point-drag-axis-lock-feedback]")).toBeNull();
    fireEvent.keyUp(window, { key: "Shift" });
    cancelled.unmount();

    const rejected = renderWithHostAdapter({
      movePointElementByDelta: vi.fn<CanvasHostAdapter["movePointElementByDelta"]>(() => ({ status: "rejected" }))
    });
    fireEvent.pointerDown(rejected.viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    expect(rejected.container.querySelector("[data-point-drag-axis-lock-feedback]")).not.toBeNull();
    fireEvent.pointerMove(rejected.viewport, {
      buttons: 1,
      clientX: 320,
      clientY: 270,
      pointerId: 1
    });
    expect(rejected.container.querySelector("[data-point-drag-axis-lock-feedback]")).toBeNull();
  });

  it("does not show the point hint during a Bezier handle drag", () => {
    useCadStore.setState({
      selectedElementId: "curve-ac",
      selectedElementIds: ["curve-ac"]
    });
    const { container, viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 345,
      clientY: 250,
      pointerId: 1
    });

    expect(container.querySelector("[data-point-drag-axis-lock-hint]")).toBeNull();

    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 345,
      clientY: 250,
      pointerId: 1
    });
  });

  it("does not show the point hint during point reference picking", () => {
    useCadStore.setState({
      activePointPickTarget: {
        elementId: "line-ab",
        parameterKey: "startPoint"
      }
    });
    const { container, viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });

    expect(container.querySelector("[data-point-drag-axis-lock-hint]")).toBeNull();
  });

  it("only shows Bezier handles for the primary selected curve", () => {
    const { container, unmount } = renderDrawingCanvas();
    expect(container.querySelectorAll(".overlay-bezier-handle-point")).toHaveLength(0);
    unmount();

    useCadStore.setState({
      selectedElementId: "curve-ac",
      selectedElementIds: ["curve-ac"]
    });
    const selected = renderDrawingCanvas();

    expect(selected.container.querySelectorAll(".overlay-bezier-handle-line")).toHaveLength(2);
    expect(selected.container.querySelectorAll(".overlay-bezier-handle-point")).toHaveLength(2);
  });

  it("drags a selected Bezier start handle on the canvas", () => {
    useCadStore.setState({
      selectedElementId: "curve-ac",
      selectedElementIds: ["curve-ac"]
    });
    const { viewport } = renderDrawingCanvas();

    dragPoint(viewport, {
      fromX: 345,
      fromY: 250,
      toX: 345,
      toY: 205
    });

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.startHandleAngleDeg).toBeCloseTo(45);
    expect(curve.startHandleLength).toBeCloseTo(63.63961030678928);
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("converts selected Bezier handle drag distance through the current canvas zoom", () => {
    useCadStore.setState({
      selectedElementId: "curve-ac",
      selectedElementIds: ["curve-ac"],
      canvasViewport: { panX: 0, panY: 0, zoom: 2 }
    });
    const { viewport } = renderDrawingCanvas();

    dragPoint(viewport, {
      fromX: 440,
      fromY: 300,
      toX: 440,
      toY: 280
    });

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.startHandleAngleDeg).toBeCloseTo(12.528807709151511);
    expect(curve.startHandleLength).toBeCloseTo(46.09772228646444);
  });

  it("locks Bezier handle angle with r during canvas dragging", () => {
    useCadStore.setState({
      selectedElementId: "curve-ac",
      selectedElementIds: ["curve-ac"]
    });
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 345,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 355,
      clientY: 205,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 355,
      clientY: 205,
      pointerId: 1
    });
    fireEvent.keyUp(window, { key: "r" });

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.startHandleAngleDeg).toBe(0);
    expect(curve.startHandleLength).toBeCloseTo(55);
  });

  it("locks Bezier handle distance with f during canvas dragging", () => {
    useCadStore.setState({
      selectedElementId: "curve-ac",
      selectedElementIds: ["curve-ac"]
    });
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 345,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.keyDown(window, { key: "f" });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 345,
      clientY: 205,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 345,
      clientY: 205,
      pointerId: 1
    });
    fireEvent.keyUp(window, { key: "f" });

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.startHandleAngleDeg).toBeCloseTo(45);
    expect(curve.startHandleLength).toBe(45);
  });

  it("does not offer numeric reference candidates unless numeric reference picking is active", () => {
    useCadStore.setState({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
    });
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });

    expect(viewport.querySelector(".numeric-reference-candidate-menu")).toBeNull();
    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
  });

  it("applies a picked numeric reference while numeric reference picking is active", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        { id: "target-point", name: "参照先", type: "freePoint", activity: "visible", x: 0, y: 0 }
      ],
      selectedElementId: "target-point",
      selectedElementIds: ["target-point"],
      activeNumericReferencePickTarget: {
        elementId: "target-point",
        parameterKey: "x",
        mode: "replace",
        property: "length"
      }
    });
    const { viewport, getByRole } = renderDrawingCanvas();

    expect(viewport).toHaveClass("is-numeric-reference-picking");

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });

    expect(useCadStore.getState().activeNumericReferencePickTarget).not.toBeNull();
    expect(getByRole("menu", { name: "数値参照候補" })).toBeInTheDocument();
    fireEvent.click(getByRole("menuitem", { name: /直線AB.*長さ/ }));
    expect(useCadStore.getState().activeNumericReferencePickTarget).toBeNull();
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length" }
    });
  });

  it("uses the clicked candidate's property instead of the pick target's stale property", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        { id: "target-point", name: "参照先", type: "freePoint", activity: "visible", x: 0, y: 0 }
      ],
      selectedElementId: "target-point",
      selectedElementIds: ["target-point"],
      activeNumericReferencePickTarget: {
        elementId: "target-point",
        parameterKey: "x",
        mode: "replace",
        property: "length"
      }
    });
    const { viewport, getByRole } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });

    expect(getByRole("menu", { name: "数値参照候補" })).toBeInTheDocument();
    fireEvent.click(getByRole("menuitem", { name: /直線AB.*始接線角度/ }));
    expect(useCadStore.getState().activeNumericReferencePickTarget).toBeNull();
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      x: { kind: "expression", expression: "line-ab.startTangentAngleDeg" }
    });
  });

  it("inserts the clicked candidate's property into the displayed expression in insert mode", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        { id: "target-point", name: "参照先", type: "freePoint", activity: "visible", x: 10, y: 0 }
      ],
      selectedElementId: "target-point",
      selectedElementIds: ["target-point"],
      activeNumericReferencePickTarget: {
        elementId: "target-point",
        parameterKey: "x",
        mode: "insert",
        property: "length",
        displayedExpression: "10",
        selectionStart: null,
        selectionEnd: null
      }
    });
    const { viewport, getByRole } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });

    fireEvent.click(getByRole("menuitem", { name: /直線AB.*始接線角度/ }));
    expect(useCadStore.getState().activeNumericReferencePickTarget).toBeNull();
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      x: { kind: "expression", expression: "10 + line-ab.startTangentAngleDeg" }
    });
  });

  it("highlights only lines the numeric pick would accept", () => {
    const target: CadElement = {
      id: "target-point",
      name: "参照先",
      type: "freePoint",
      activity: "visible",
      x: 0,
      y: 0
    };
    const pickTarget = {
      elementId: "target-point",
      parameterKey: "x",
      mode: "replace",
      property: "length"
    } as const;

    useCadStore.setState({
      elements: [...sampleElements, target],
      activeNumericReferencePickTarget: pickTarget
    });
    const { container, unmount } = renderDrawingCanvas();
    expect(
      container.querySelectorAll('[data-numeric-reference-candidate="true"]').length
    ).toBeGreaterThan(0);
    unmount();

    useCadStore.setState({
      elements: [target, ...sampleElements],
      activeNumericReferencePickTarget: pickTarget
    });
    const { container: laterContainer } = renderDrawingCanvas();
    expect(laterContainer.querySelector('[data-numeric-reference-candidate="true"]')).toBeNull();
  });

  it("does not offer the target line itself while numeric reference picking on the canvas", () => {
    const elements: CadElement[] = [
      {
        id: "self-line",
        name: "自己線",
        type: "line",
        activity: "visible",
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 100, y: 0 }
      }
    ];
    useCadStore.setState({
      elements,
      selectedElementId: "self-line",
      selectedElementIds: ["self-line"],
      activeNumericReferencePickTarget: {
        elementId: "self-line",
        parameterKey: "name",
        mode: "replace",
        property: "length"
      }
    });
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 200,
      pointerId: 1
    });

    expect(viewport.querySelector(".numeric-reference-candidate-menu")).toBeNull();
    expect(useCadStore.getState().activeNumericReferencePickTarget).toEqual({
      elementId: "self-line",
      parameterKey: "name",
      mode: "replace",
      property: "length"
    });
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("does not offer the target line's own endpoints while point picking on the canvas", () => {
    const elements: CadElement[] = [
      {
        id: "self-line",
        name: "自己線",
        type: "line",
        activity: "visible",
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 100, y: 0 }
      }
    ];
    useCadStore.setState({
      elements,
      selectedElementId: "self-line",
      selectedElementIds: ["self-line"],
      activePointPickTarget: {
        elementId: "self-line",
        parameterKey: "startPoint"
      }
    });
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 250,
      clientY: 200,
      pointerId: 1
    });

    expect(viewport.querySelector(".measurement-candidate-menu")).toBeNull();
    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: "self-line",
      parameterKey: "startPoint"
    });
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("shows and accepts each generated forGroup point and endpoint on the Canvas", () => {
    const elements = forGroupPickElements();
    useCadStore.setState({
      elements,
      selectedElementId: "point-target",
      selectedElementIds: ["point-target"],
      activePointPickTarget: { elementId: "point-target", parameterKey: "fromPoint" }
    });
    const { viewport, container, unmount } = renderDrawingCanvas();

    // All prior same-instance points && line endpoints remain selectable;
    // the generated source point itself contributes three of these markers.
    expect(container.querySelectorAll(".overlay-derived-point-pick-candidate")).toHaveLength(12);
    const pointScreen = screenFor({ x: 40, y: 0 });
    fireEvent.pointerDown(viewport, {
      button: 0, buttons: 1, clientX: pointScreen.x, clientY: pointScreen.y, pointerId: 1
    });
    expect(useCadStore.getState().elements.find((element) => element.id === "point-target"))
      .toMatchObject({ fromPoint: { mode: "reference", pointId: "loop-point" } });
    unmount();

    useCadStore.setState({
      elements: forGroupPickElements(),
      selectedElementId: "endpoint-target",
      selectedElementIds: ["endpoint-target"],
      activePointPickTarget: { elementId: "endpoint-target", parameterKey: "endpoint" }
    });
    const endpointView = renderDrawingCanvas();
    expect(endpointView.container.querySelectorAll(".overlay-derived-point-pick-candidate")).toHaveLength(6);
    const endpointScreen = screenFor({ x: 40, y: 20 });
    fireEvent.pointerDown(endpointView.viewport, {
      button: 0, buttons: 1, clientX: endpointScreen.x, clientY: endpointScreen.y, pointerId: 2
    });
    expect(useCadStore.getState().elements.find((element) => element.id === "endpoint-target"))
      .toMatchObject({ endpoint: { lineId: "loop-line", endpointKey: "end" } });
  });

  it("shows generated forGroup lines in the shared overlay and accepts their hit-test result", () => {
    useCadStore.setState({
      elements: forGroupPickElements(),
      selectedElementId: "line-target",
      selectedElementIds: ["line-target"],
      activeLinePickTarget: { elementId: "line-target", parameterKey: "baseLineIds" }
    });
    const { viewport, container } = renderDrawingCanvas();

    expect(container.querySelectorAll("[data-line-pick-candidate=\"true\"]")).toHaveLength(3);
    const lineScreen = screenFor({ x: 40, y: 10 });
    fireEvent.pointerDown(viewport, {
      button: 0, buttons: 1, clientX: lineScreen.x, clientY: lineScreen.y, pointerId: 3
    });
    expect(useCadStore.getState().activeLinePickTarget).toMatchObject({ draftLineIds: ["loop-line"] });
  });

  it("adds a base line while line picking is active", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          activity: "visible",
          baseLineIds: [],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      activeLinePickTarget: {
        elementId: "offset-line",
        parameterKey: "baseLineIds"
      }
    });
    const { viewport, container } = renderDrawingCanvas();

    expect(viewport).toHaveClass("is-line-picking");

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });

    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "offset-line",
      parameterKey: "baseLineIds",
      draftLineIds: ["line-ab"]
    });
    const draftLine = container.querySelector(".overlay-draft-line-pick");
    expect(draftLine).toBeInTheDocument();
    expect(draftLine).toHaveAttribute("data-line-pick-candidate", "true");
    expect(container.querySelector(".overlay-draft-line-pick-marker")).toBeInTheDocument();
    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });
    expect(useCadStore.getState().activeLinePickTarget).toMatchObject({ draftLineIds: [] });
    expect(container.querySelector(".overlay-draft-line-pick")).toBeNull();
    expect(container.querySelector(".overlay-draft-line-pick-marker")).toBeNull();
    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: []
    });
    act(() => { dispatchCommand("finishLinePick"); });
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: ["line-ab"]
    });
  });

  it("shows a candidate menu when multiple line pick targets overlap", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "line-ab-copy",
          name: "直線AB重ね",
          type: "line",
          activity: "visible",
          startPoint: { mode: "reference", pointId: "point-a" },
          endPoint: { mode: "reference", pointId: "point-b" }
        },
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          activity: "visible",
          baseLineIds: [],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      activeLinePickTarget: {
        elementId: "offset-line",
        parameterKey: "baseLineIds"
      }
    });
    const { viewport, getByRole } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });

    expect(getByRole("menu", { name: "線選択候補" })).toBeInTheDocument();

    fireEvent.click(getByRole("menuitem", { name: "直線AB重ね" }));

    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "offset-line",
      parameterKey: "baseLineIds",
      draftLineIds: ["line-ab-copy"]
    });
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: []
    });
    act(() => { dispatchCommand("finishLinePick"); });
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: ["line-ab-copy"]
    });
  });

  it("discards draft base-line picks when cancelled", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          activity: "visible",
          baseLineIds: [],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      activeLinePickTarget: {
        elementId: "offset-line",
        parameterKey: "baseLineIds",
        draftLineIds: []
      }
    });
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });
    act(() => { dispatchCommand("cancelLinePick"); });

    expect(useCadStore.getState().activeLinePickTarget).toBeNull();
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({ baseLineIds: [] });
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("does not finish a single-line pick without a draft selection", () => {
    useCadStore.setState({
      activeLinePickTarget: {
        elementId: "line-ab",
        parameterKey: "startPoint"
      }
    });

    act(() => { dispatchCommand("finishLinePick"); });

    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "line-ab",
      parameterKey: "startPoint"
    });
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("selects and moves a point with a left-button drag", () => {
    const { viewport } = renderDrawingCanvas();

    dragPoint(viewport, {
      fromX: 300,
      fromY: 250,
      toX: 320,
      toY: 260
    });

    expect(useCadStore.getState().selectedElementId).toBe("point-a");
    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 70, y: -60 });
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("converts screen drag distance through the current canvas zoom", () => {
    useCadStore.setState({
      canvasViewport: { panX: 0, panY: 0, zoom: 2 }
    });
    const { viewport } = renderDrawingCanvas();

    dragPoint(viewport, {
      fromX: 350,
      fromY: 300,
      toX: 370,
      toY: 310
    });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 60, y: -55 });
  });

  it("locks movement to the dominant horizontal axis while Shift is held", () => {
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1,
      shiftKey: true
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 320,
      clientY: 270,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 320,
      clientY: 270,
      pointerId: 1
    });
    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 70, y: -50 });
  });

  it("locks movement to the dominant vertical axis while Shift is held", () => {
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1,
      shiftKey: true
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 310,
      clientY: 280,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 310,
      clientY: 280,
      pointerId: 1
    });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50, y: -80 });
  });

  it("locks polar angle while r is pressed during point dragging", () => {
    useCadStore.setState({
      elements: [
        sampleElements[0],
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          activity: "visible",
          fromPointId: "point-a",
          angleDeg: 0,
          distance: 30
        }
      ],
      selectedElementId: "polar-point",
      selectedElementIds: ["polar-point"]
    });
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 330,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 330,
      clientY: 240,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 330,
      clientY: 240,
      pointerId: 1
    });
    fireEvent.keyUp(window, { key: "r" });

    expect(useCadStore.getState().elements[1]).toMatchObject({
      angleDeg: 0,
      distance: 30
    });
  });

  it("locks polar distance while f is pressed during point dragging", () => {
    useCadStore.setState({
      elements: [
        sampleElements[0],
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          activity: "visible",
          fromPointId: "point-a",
          angleDeg: 0,
          distance: 30
        }
      ],
      selectedElementId: "polar-point",
      selectedElementIds: ["polar-point"]
    });
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 330,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.keyDown(window, { key: "f" });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 330,
      clientY: 240,
      pointerId: 1
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 330,
      clientY: 240,
      pointerId: 1
    });
    fireEvent.keyUp(window, { key: "f" });

    const moved = useCadStore.getState().elements[1];
    expect(moved).toMatchObject({ type: "polarOffsetPoint", distance: 30 });
    if (moved.type !== "polarOffsetPoint") throw new Error("Expected a polar offset point");
    expect(moved.angleDeg).toBeCloseTo(18.43494882292201);
  });

  it("clears the dragging cursor state after pointer cancel", () => {
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    expect(viewport).toHaveClass("is-point-dragging");

    fireEvent.pointerCancel(viewport, {
      buttons: 0,
      clientX: 310,
      clientY: 260,
      pointerId: 1
    });

    expect(viewport).not.toHaveClass("is-point-dragging");
  });

  it("finishes a released dirty click only after the matching evaluation arrives", async () => {
    useCadDocumentStore.getState().commitText("nui 4\npoint A = coordinate(x: 0, y: 0)\npoint B = coordinate(x: 100, y: 0)", "test");
    const beforeRevision = useCadDocumentStore.getState().compiledDocumentRevision;
    const staleEvaluation = referenceEvaluationState(beforeRevision);
    const canvasFocusRef = createRef<HTMLDivElement>();
    const view = render(createElement(DrawingCanvasTestHost, {
      evaluation: staleEvaluation.evaluation,
      evaluationState: staleEvaluation,
      canvasFocusRef,
      commandContext: {},
      leftPanelDockRef: createRef<HTMLDivElement>()
    }));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport")!;
    const unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => false,
      flush: () => {
        useCadDocumentStore.getState().commitText("nui 4\npoint A = coordinate(x: 1, y: 0)\npoint B = coordinate(x: 100, y: 0)", "editor");
        return "flushed";
      }
    });

    try {
      fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
      fireEvent.pointerUp(viewport, { button: 0, buttons: 0, clientX: 350, clientY: 200, pointerId: 1 });
      expect(useCadStore.getState().selectedElementId).not.toBe("point-b");

      const currentRevision = useCadDocumentStore.getState().compiledDocumentRevision;
      const pointBId = useCadDocumentStore.getState().elements.find((element) => element.name === "B")?.id;
      expect(pointBId).toBeDefined();
      await act(async () => {
        const fresh = referenceEvaluationState(currentRevision);
        view.rerender(createElement(DrawingCanvasTestHost, {
          evaluation: fresh.evaluation,
          evaluationState: fresh,
          canvasFocusRef,
          commandContext: {},
          leftPanelDockRef: createRef<HTMLDivElement>()
        }));
      });

      await waitFor(() => expect(useCadStore.getState().selectedElementId).toBe(pointBId));
      expect(document.activeElement).toBe(viewport);
    } finally {
      unregister();
    }
  });

  it("flushes pending editor text on pointerdown but not on pointermove alone", () => {
    const flush = vi.fn<SourceEditSession["flush"]>(() => "clean");
    const unregister = registerSourceEditSession({
      hasPendingText: () => false,
      isComposing: () => false,
      flush
    });

    try {
      const { viewport } = renderDrawingCanvas();

      fireEvent.pointerMove(viewport, {
        buttons: 0,
        clientX: 300,
        clientY: 250,
        pointerId: 1
      });
      expect(flush).not.toHaveBeenCalled();

      fireEvent.pointerDown(viewport, {
        button: 0,
        buttons: 1,
        clientX: 300,
        clientY: 250,
        pointerId: 1
      });
      // pointerdown always flushes first, via the Canvas boundary itself; a nested
      // dispatchCommand("selectElement", ...) call may flush again too (idempotent
      // since the session is already clean) -- both are pointerdown-triggered, not
      // pointermove-triggered, which is the behavior under test here.
      expect(flush.mock.calls[0]?.[0]).toBe("canvas-pointerdown");
      const callsAfterPointerDown = flush.mock.calls.length;
      expect(callsAfterPointerDown).toBeGreaterThan(0);

      // A preview-mode drag pointermove must not flush at all (commitMode "preview"
      // bypasses dispatchCommand's own flush call, && the Canvas boundary itself
      // only flushes on pointerdown).
      fireEvent.pointerMove(viewport, {
        buttons: 1,
        clientX: 320,
        clientY: 260,
        pointerId: 1
      });
      expect(flush.mock.calls.length).toBe(callsAfterPointerDown);

      // pointerup finalizes the drag as a commit-mode dispatchCommand call, which is
      // an independent, expected flush boundary (not the pointermove behavior under
      // test here).
      fireEvent.pointerUp(viewport, {
        buttons: 0,
        clientX: 320,
        clientY: 260,
        pointerId: 1
      });
      expect(flush.mock.calls.length).toBeGreaterThanOrEqual(callsAfterPointerDown);
    } finally {
      unregister();
    }
  });
});

describe("DrawingCanvas benchmark drag hooks", () => {
  afterEach(() => {
    abortBenchmarkSample();
    drainCompletedBenchmarkSamples();
  });

  it("claims a point drag through the production pointermove handler", () => {
    beginBenchmarkSample("point-drag-v1");
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 320,
      clientY: 260,
      pointerId: 1
    });

    const entry = capturePointerMoveEntry();
    expect(claimPointerMoveEntry(entry, "point")).toBe(false);
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 320,
      clientY: 260,
      pointerId: 1
    });
  });

  it("claims a Bezier handle drag through the production pointermove handler", () => {
    useCadStore.setState({
      selectedElementId: "curve-ac",
      selectedElementIds: ["curve-ac"]
    });
    beginBenchmarkSample("bezier-handle-drag-v1");
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 345,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 345,
      clientY: 205,
      pointerId: 1
    });

    const entry = capturePointerMoveEntry();
    expect(claimPointerMoveEntry(entry, "bezier-handle")).toBe(false);
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 345,
      clientY: 205,
      pointerId: 1
    });
  });

  it("does not claim a point sample for a Bezier handle movement", () => {
    useCadStore.setState({
      selectedElementId: "curve-ac",
      selectedElementIds: ["curve-ac"]
    });
    beginBenchmarkSample("point-drag-v1");
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 345,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 345,
      clientY: 205,
      pointerId: 1
    });

    const entry = capturePointerMoveEntry();
    expect(claimPointerMoveEntry(entry, "point")).toBe(true);
  });

  it("does not claim an unrelated pointer id", () => {
    beginBenchmarkSample("point-drag-v1");
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: 320,
      clientY: 260,
      pointerId: 2
    });

    const entry = capturePointerMoveEntry();
    expect(claimPointerMoveEntry(entry, "point")).toBe(true);
  });
});

describe("DrawingCanvas pending pointer intents", () => {
  // World (0, 0) renders at screen (250, 200) with the 500x400 test viewport.
  const twoPointText = "nui 4\npoint A = coordinate(x: 0, y: 0)\npoint B = coordinate(x: 100, y: 0)";
  const twoPointFlushText = `${twoPointText}\npoint C = coordinate(x: 0, y: 60)`;

  let unregisterSession: (() => void) | null = null;

  afterEach(() => {
    unregisterSession?.();
    unregisterSession = null;
    vi.useRealTimers();
  });

  const setPointerCaptureSpy = () => vi.mocked(HTMLElement.prototype.setPointerCapture);
  const releasePointerCaptureSpy = () => vi.mocked(HTMLElement.prototype.releasePointerCapture);
  const lastCaptureOpIsAcquire = () => {
    const setOrders = setPointerCaptureSpy().mock.invocationCallOrder;
    const releaseOrders = releasePointerCaptureSpy().mock.invocationCallOrder;
    return Math.max(0, ...setOrders) > Math.max(0, ...releaseOrders);
  };

  const idByName = (name: string) => {
    const id = useCadDocumentStore.getState().elements.find((element) => element.name === name)?.id;
    if (!id) throw new Error(`Missing element ${name}`);
    return id;
  };

  const pointByName = (name: string) => {
    const element = useCadDocumentStore.getState().elements.find((item) => item.name === name);
    if (!element || element.type !== "freePoint") throw new Error(`Missing free point ${name}`);
    return element;
  };

  const renderPendingCanvas = ({
    initialText,
    flushText,
    debouncedCommitText
  }: {
    initialText: string;
    /** Committed by the fake session's first flush; later flushes return "clean". */
    flushText?: string;
    /** Committed before render, as if the editor's debounced commit already ran. */
    debouncedCommitText?: string;
  }) => {
    useCadDocumentStore.getState().commitText(initialText, "test");
    const staleState = referenceEvaluationState(useCadDocumentStore.getState().compiledDocumentRevision);
    if (debouncedCommitText) useCadDocumentStore.getState().commitText(debouncedCommitText, "editor");
    const canvasFocusRef = createRef<HTMLDivElement>();
    const leftPanelDockRef = createRef<HTMLDivElement>();
    const propsFor = (state: EvaluationEngineState) => ({
      evaluation: state.evaluation,
      evaluationState: state,
      canvasFocusRef,
      leftPanelDockRef
    });
    const view = render(createElement(DrawingCanvasTestHost, propsFor(staleState)));
    const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
    if (!viewport) throw new Error("Missing canvas viewport");

    let pendingFlushText = flushText ?? null;
    unregisterSession = registerSourceEditSession({
      hasPendingText: () => pendingFlushText !== null,
      isComposing: () => false,
      flush: () => {
        if (pendingFlushText === null) return "clean";
        const text = pendingFlushText;
        pendingFlushText = null;
        useCadDocumentStore.getState().commitText(text, "editor");
        return "flushed";
      }
    });

    const deliverEvaluationState = async (overrides?: Partial<EvaluationEngineState>) => {
      await act(async () => {
        view.rerender(createElement(DrawingCanvasTestHost, propsFor({
          ...referenceEvaluationState(useCadDocumentStore.getState().compiledDocumentRevision),
          ...overrides
        })));
      });
    };

    return { view, viewport, deliverEvaluationState };
  };

  it("moves the pressed point by the drag delta even when the drop position is blank", async () => {
    const { viewport, deliverEvaluationState } = renderPendingCanvas({
      initialText: twoPointText,
      flushText: twoPointFlushText
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 380, clientY: 210, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 400, clientY: 190, pointerId: 1 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 400, clientY: 190, pointerId: 1 });
    expect(pointByName("B")).toMatchObject({ x: 100, y: 0 });

    await deliverEvaluationState();
    await waitFor(() => expect(pointByName("B")).toMatchObject({ x: 150, y: 10 }));
    expect(useCadStore.getState().selectedElementId).toBe(idByName("B"));

    // A later evaluation update must not re-apply the resolved intent.
    await deliverEvaluationState();
    expect(pointByName("B")).toMatchObject({ x: 150, y: 10 });
  });

  it("keeps drag previews out of the drag base and commits one undoable selection-preserving change", async () => {
    const { viewport, deliverEvaluationState } = renderPendingCanvas({ initialText: twoPointText });
    const bId = idByName("B");
    act(() => { useCadDocumentStore.setState({ past: [], future: [] }); });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 380, clientY: 210, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 400, clientY: 190, pointerId: 1 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 400, clientY: 190, pointerId: 1 });

    await deliverEvaluationState();
    await waitFor(() => expect(pointByName("B")).toMatchObject({ x: 150, y: 10 }));
    expect(useCadDocumentStore.getState().past).toHaveLength(1);
    expect(useCadUiStore.getState().selectedElementId).toBe(bId);

    act(() => { useCadDocumentStore.getState().undo(); });
    expect(pointByName("B")).toMatchObject({ x: 100, y: 0 });
    expect(useCadUiStore.getState().selectedElementId).toBe(bId);
    act(() => { useCadDocumentStore.getState().redo(); });
    expect(pointByName("B")).toMatchObject({ x: 150, y: 10 });
    expect(useCadUiStore.getState().selectedElementId).toBe(bId);
  });

  it("drags the point grabbed at the press position, not the element under the drop position", async () => {
    const { viewport, deliverEvaluationState } = renderPendingCanvas({
      initialText: "nui 4\npoint P = coordinate(x: 0, y: 0)\npoint Q = coordinate(x: 50, y: 0)",
      flushText: "nui 4\npoint P = coordinate(x: 0, y: 0)\npoint Q = coordinate(x: 50, y: 0)\npoint R = coordinate(x: 0, y: 60)"
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 250, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 300, clientY: 195, pointerId: 1 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 300, clientY: 195, pointerId: 1 });

    await deliverEvaluationState();
    await waitFor(() => expect(pointByName("P")).toMatchObject({ x: 50, y: 5 }));
    expect(pointByName("Q")).toMatchObject({ x: 50, y: 0 });
    expect(useCadStore.getState().selectedElementId).toBe(idByName("P"));
  });

  it("continues a held drag from the press target when the evaluation arrives before pointerup", async () => {
    const { viewport, deliverEvaluationState } = renderPendingCanvas({
      initialText: twoPointText,
      flushText: twoPointFlushText
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 370, clientY: 200, pointerId: 1 });
    expect(useCadStore.getState().selectedElementId).not.toBe(idByName("B"));

    await deliverEvaluationState();
    await waitFor(() => expect(viewport).toHaveClass("is-point-dragging"));
    expect(useCadStore.getState().selectedElementId).toBe(idByName("B"));
    expect(lastCaptureOpIsAcquire()).toBe(true);

    // The pointerup lands outside the 500x400 viewport; the capture acquired at
    // resolution keeps routing it to the canvas gesture.
    const releaseCallsBeforeUp = releasePointerCaptureSpy().mock.calls.length;
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 400, clientY: 190, pointerId: 1 });
    expect(releasePointerCaptureSpy().mock.calls.length).toBe(releaseCallsBeforeUp);
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 600, clientY: 150, pointerId: 1 });

    expect(pointByName("B")).toMatchObject({ x: 350, y: 50 });
    expect(viewport).not.toHaveClass("is-point-dragging");
    expect(releasePointerCaptureSpy()).toHaveBeenCalledWith(1);
  });

  it("defers a click when the pointerdown flush is clean but the evaluation is stale", async () => {
    const { viewport, deliverEvaluationState } = renderPendingCanvas({
      initialText: twoPointText,
      debouncedCommitText: twoPointFlushText
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 350, clientY: 200, pointerId: 1 });
    expect(useCadStore.getState().selectedElementId).not.toBe(idByName("B"));

    await deliverEvaluationState();
    await waitFor(() => expect(useCadStore.getState().selectedElementId).toBe(idByName("B")));
  });

  it("replaces a waiting intent with the next gesture and keeps the reused pointer capture", async () => {
    const { viewport, deliverEvaluationState } = renderPendingCanvas({
      initialText: twoPointText,
      flushText: twoPointFlushText
    });
    const bId = idByName("B");
    const selectionLog: (string | null)[] = [];
    const unsubscribe = useCadUiStore.subscribe((state) => {
      selectionLog.push(state.selectedElementId);
    });

    try {
      fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
      fireEvent.pointerUp(viewport, { buttons: 0, clientX: 350, clientY: 200, pointerId: 1 });

      fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 250, clientY: 200, pointerId: 1 });
      // The same pointer id replaced the waiting intent; the capture acquired by
      // the new gesture must survive the old intent's cleanup.
      expect(lastCaptureOpIsAcquire()).toBe(true);
      fireEvent.pointerUp(viewport, { buttons: 0, clientX: 250, clientY: 200, pointerId: 1 });

      await deliverEvaluationState();
      await waitFor(() => expect(useCadStore.getState().selectedElementId).toBe(idByName("A")));
      // The replaced click on B never resolves later.
      expect(selectionLog).not.toContain(bId);
      await deliverEvaluationState();
      expect(useCadStore.getState().selectedElementId).toBe(idByName("A"));
    } finally {
      unsubscribe();
    }
  });

  it("cancels a waiting intent on pointercancel and never executes it", async () => {
    const { viewport, deliverEvaluationState } = renderPendingCanvas({
      initialText: twoPointText,
      flushText: twoPointFlushText
    });
    const bId = idByName("B");

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    const releaseCallsBeforeCancel = releasePointerCaptureSpy().mock.calls.length;
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    expect(releasePointerCaptureSpy().mock.calls.length).toBe(releaseCallsBeforeCancel + 1);

    await deliverEvaluationState();
    expect(useCadStore.getState().selectedElementId).not.toBe(bId);
    expect(pointByName("B")).toMatchObject({ x: 100, y: 0 });
  });

  it("cancels a waiting intent after the deadline instead of keeping it forever", async () => {
    vi.useFakeTimers();
    const { viewport, deliverEvaluationState } = renderPendingCanvas({
      initialText: twoPointText,
      flushText: twoPointFlushText
    });
    const bId = idByName("B");

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(5001);
    });
    expect(useCadUiStore.getState().commandErrorMessage).toContain("タイムアウト");

    vi.useRealTimers();
    await deliverEvaluationState();
    expect(useCadStore.getState().selectedElementId).not.toBe(bId);
  });

  it("cancels immediately when the flushed text has fatal diagnostics", () => {
    const { viewport } = renderPendingCanvas({
      initialText: twoPointText,
      flushText: `${twoPointText}\npoint`
    });
    const bId = idByName("B");

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });

    expect(useCadUiStore.getState().commandErrorMessage).toContain("構文エラー");
    expect(useCadStore.getState().selectedElementId).not.toBe(bId);
  });

  it("cancels when the matching evaluation fails, without resolving on a later success", async () => {
    const { viewport, deliverEvaluationState } = renderPendingCanvas({
      initialText: twoPointText,
      flushText: twoPointFlushText
    });
    const bId = idByName("B");

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 350, clientY: 200, pointerId: 1 });

    await deliverEvaluationState({ status: "failed", error: new Error("evaluation failed") });
    expect(useCadUiStore.getState().commandErrorMessage).toContain("評価に失敗");

    await deliverEvaluationState();
    expect(useCadStore.getState().selectedElementId).not.toBe(bId);
  });

  it("cancels when the pressed target was deleted by the flushed document", async () => {
    const { viewport, deliverEvaluationState } = renderPendingCanvas({
      initialText: twoPointText,
      flushText: "nui 4\npoint A = coordinate(x: 0, y: 0)"
    });
    const bId = idByName("B");

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(viewport, { buttons: 0, clientX: 350, clientY: 200, pointerId: 1 });

    await deliverEvaluationState();
    expect(useCadUiStore.getState().commandErrorMessage).toContain("削除");
    expect(useCadStore.getState().selectedElementId).not.toBe(bId);
  });

  it("releases the waiting capture on unmount", () => {
    const { view, viewport } = renderPendingCanvas({
      initialText: twoPointText,
      flushText: twoPointFlushText
    });

    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, clientX: 350, clientY: 200, pointerId: 1 });
    const releaseCallsBeforeUnmount = releasePointerCaptureSpy().mock.calls.length;
    view.unmount();

    expect(releasePointerCaptureSpy().mock.calls.length).toBe(releaseCallsBeforeUnmount + 1);
    expect(releasePointerCaptureSpy()).toHaveBeenCalledWith(1);
  });
});
