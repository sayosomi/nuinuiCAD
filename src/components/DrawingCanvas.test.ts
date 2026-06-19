import { fireEvent, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";
import { DrawingCanvas } from "./DrawingCanvas";
import { hitTestCanvasGeometry } from "./DrawingCanvasHitTest";
import type { ComputedBezierCurve, ComputedLine, ComputedPoint } from "../types/geometry";

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
  endAngleDeg: 180
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
  startHandleAngleDeg: 0,
  startHandleLength: 30,
  endHandleAngleDeg: 0,
  endHandleLength: 30
});

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectionAnchorElementId: sampleElements[0].id,
    isParameterEditMode: false,
    selectedParameterKey: "name",
    showElementInfoPanel: true,
    isDependencyJumpMode: false,
    selectedDependencyJumpIndex: 0,
    showShortcutHelp: false,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    past: [],
    future: []
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
  setTransform: vi.fn(),
  stroke: vi.fn()
});

const renderDrawingCanvas = () => {
  const view = render(
    createElement(DrawingCanvas, {
      evaluation: evaluateElements(useCadStore.getState().elements),
      canvasFocusRef: createRef<HTMLDivElement>()
    })
  );
  const viewport = view.container.querySelector(".canvas-viewport");
  if (!(viewport instanceof HTMLDivElement)) {
    throw new Error("Missing canvas viewport");
  }
  return { ...view, viewport };
};

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

  it("offers a line length candidate near the clicked line and applies it to the selected numeric parameter", () => {
    useCadStore.setState({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
      selectedParameterKey: "x"
    });
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.click(viewport.querySelector(".measurement-candidate-menu button")!);

    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length" }
    });
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
    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 70, y: 60 });
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

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 60, y: 55 });
  });

  it("locks movement to the x axis while x is pressed", () => {
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.keyDown(window, { key: "x" });
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
    fireEvent.keyUp(window, { key: "x" });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 70, y: 50 });
  });

  it("locks movement to the y axis while y is pressed", () => {
    const { viewport } = renderDrawingCanvas();

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 250,
      pointerId: 1
    });
    fireEvent.keyDown(window, { key: "y" });
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
    fireEvent.keyUp(window, { key: "y" });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50, y: 70 });
  });

  it("locks polar angle while r is pressed during point dragging", () => {
    useCadStore.setState({
      elements: [
        sampleElements[0],
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          visible: true,
          enabled: true,
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
          visible: true,
          enabled: true,
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
});
