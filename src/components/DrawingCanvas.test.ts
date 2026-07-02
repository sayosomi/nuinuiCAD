import { fireEvent, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { defaultDocumentPalette } from "../palette/palette";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";
import { DrawingCanvas } from "./DrawingCanvas";
import { hitTestCanvasGeometry } from "./DrawingCanvasHitTest";
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

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    palette: defaultDocumentPalette(),
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectionAnchorElementId: sampleElements[0].id,
    isParameterEditMode: false,
    selectedParameterKey: "name",
    showElementInfoPanel: true,
    isDependencyJumpMode: false,
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activeExpressionInsertTarget: null,
    activeMeasurementInsertTarget: null,
    activePickCursor: null,
    selectedDependencyJumpIndex: 0,
    elementSearchQuery: "",
    elementSearchCursorId: null,
    elementSearchPickableOnly: false,
    showCanvasElementNames: true,
    showCanvasPoints: true,
    showShortcutHelp: false,
    showShortcutSettings: false,
    showPaletteSettings: false,
    showSelectionColorPicker: false,
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

describe("DrawingCanvas rendering", () => {
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
          visible: false,
          enabled: true,
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
          visible: true,
          enabled: true,
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

    fireEvent.click(getByRole("button", { name: "要素名" }));

    expect(container.querySelector("text")).toBeNull();
    expect(useCadStore.getState().showCanvasElementNames).toBe(false);
  });

  it("uses resolved element colors for selected line overlays", () => {
    useCadStore.setState({
      elements: sampleElements.map((element): CadElement =>
        element.id === "line-ab" ? { ...element, colorId: "cut-red" } : element
      ),
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"]
    });

    const { container } = renderDrawingCanvas();
    const selectedLine = container.querySelector(".overlay-selected-line");

    expect(selectedLine).toHaveStyle({ stroke: "rgb(180 35 24 / 0.3)" });
  });

  it("uses resolved element colors for selected point overlays", () => {
    useCadStore.setState({
      elements: sampleElements.map((element): CadElement =>
        element.id === "point-a" ? { ...element, colorId: "guide-blue" } : element
      ),
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"]
    });

    const { container } = renderDrawingCanvas();
    const selectedPoint = container.querySelector(".overlay-selected-point");

    expect(selectedPoint).toHaveStyle({
      fill: "rgb(37 99 235 / 0.14)",
      stroke: "rgb(37 99 235 / 0.45)"
    });
  });

  it("hides unselected overlay points while keeping the selected point visible", () => {
    const { container, getByRole } = renderDrawingCanvas();

    expect(container.querySelectorAll(".overlay-draggable-point")).toHaveLength(3);

    fireEvent.click(getByRole("button", { name: "点" }));

    expect(container.querySelectorAll(".overlay-draggable-point")).toHaveLength(1);
    expect(useCadStore.getState().showCanvasPoints).toBe(false);
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

    expect(viewport.querySelector(".numeric-reference-candidate-menu")).toBeNull();
    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
  });

  it("applies a picked numeric reference while numeric reference picking is active", () => {
    useCadStore.setState({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
      selectedParameterKey: "x",
      activeNumericReferencePickTarget: {
        elementId: "point-a",
        parameterKey: "x",
        mode: "replace",
        property: "length"
      }
    });
    const { viewport } = renderDrawingCanvas();

    expect(viewport).toHaveClass("is-numeric-reference-picking");

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 350,
      clientY: 250,
      pointerId: 1
    });

    expect(useCadStore.getState().activeNumericReferencePickTarget).toBeNull();
    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length" }
    });
  });

  it("adds a base line while line picking is active", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          visible: true,
          enabled: true,
          numericVariables: [],
          baseLineIds: [],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "baseLineIds",
      activeLinePickTarget: {
        elementId: "offset-line",
        parameterKey: "baseLineIds"
      }
    });
    const { viewport } = renderDrawingCanvas();

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
      parameterKey: "baseLineIds"
    });
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
          visible: true,
          enabled: true,
          startPoint: { mode: "reference", pointId: "point-a" },
          endPoint: { mode: "reference", pointId: "point-b" }
        },
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          visible: true,
          enabled: true,
          numericVariables: [],
          baseLineIds: [],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "baseLineIds",
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

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: ["line-ab-copy"]
    });
    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "offset-line",
      parameterKey: "baseLineIds"
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

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 70, y: -50 });
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

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50, y: -70 });
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
