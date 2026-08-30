import { fireEvent, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { DEFAULT_CANVAS_VIEWPORT } from "../state/useCadStore";
import type { CadElement } from "../types/geometry";
import { DrawingCanvas } from "./DrawingCanvas";
import { LEGACY_CANVAS_THEME } from "./canvasTheme";
import type { CanvasHostAdapter } from "./canvasHostAdapter";
import { worldToScreen } from "./canvasViewport";

const elements: CadElement[] = [
  {
    id: "point-a",
    name: "Point A",
    type: "freePoint",
    activity: "visible",
    x: 50,
    y: -50
  }
];

const pointScreen = worldToScreen(
  { x: 50, y: -50 },
  { width: 500, height: 400 },
  DEFAULT_CANVAS_VIEWPORT
);

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

const createHostAdapter = (
  overrides: Partial<CanvasHostAdapter> = {}
): CanvasHostAdapter => ({
  elements,
  canonicalElements: elements,
  evaluationLimitIndex: undefined,
  compiledDocumentRevision: 0,
  canvasTheme: LEGACY_CANVAS_THEME,
  visibilityProfiles: [],
  activeVisibilityProfileId: null,
  moduleSemanticContext: {},
  selectedElementId: null,
  selectedElementIds: [],
  selectionAnchorElementId: null,
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
  getCanvasSelectionSnapshot: () => ({
    selectedElementId: null,
    selectedElementIds: [],
    selectionAnchorElementId: null
  }),
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
});

const renderCanvas = (overrides: Partial<CanvasHostAdapter> = {}) => {
  const hostAdapter = createHostAdapter(overrides);
  const view = render(createElement(DrawingCanvas, {
    evaluation: evaluateElements(elements),
    canvasFocusRef: createRef<HTMLDivElement>(),
    hostAdapter
  }));
  const viewport = view.container.querySelector<HTMLDivElement>(".canvas-viewport");
  if (!viewport) throw new Error("Missing canvas viewport");
  return { ...view, hostAdapter, viewport };
};

beforeEach(() => {
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

describe("DrawingCanvas point drag activation threshold", () => {
  it("keeps sub-threshold pointer jitter selection-only without preview or commit movement", () => {
    const movePointElementByDelta = vi.fn();
    const selectElement = vi.fn();
    const { viewport } = renderCanvas({ movePointElementByDelta, selectElement });

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: pointScreen.x,
      clientY: pointScreen.y,
      pointerId: 1
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: pointScreen.x + 7,
      clientY: pointScreen.y,
      pointerId: 1
    });

    expect(movePointElementByDelta).not.toHaveBeenCalled();

    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: pointScreen.x + 7,
      clientY: pointScreen.y,
      pointerId: 1
    });

    expect(movePointElementByDelta).not.toHaveBeenCalled();
    expect(selectElement).toHaveBeenCalledWith("point-a", "replace");
  });

  it("activates at eight pixels and previews then commits the full pointerdown delta", () => {
    const movePointElementByDelta = vi.fn();
    const { viewport } = renderCanvas({ movePointElementByDelta });

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: pointScreen.x,
      clientY: pointScreen.y,
      pointerId: 2
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: pointScreen.x + 8,
      clientY: pointScreen.y,
      pointerId: 2
    });

    expect(movePointElementByDelta).toHaveBeenCalledTimes(1);
    const previewAction = movePointElementByDelta.mock.calls[0]?.[0];
    expect(previewAction).toMatchObject({
      elementId: "point-a",
      dx: 8,
      commitMode: "preview"
    });
    expect(Math.abs(previewAction?.dy ?? Number.NaN)).toBe(0);

    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: pointScreen.x + 8,
      clientY: pointScreen.y,
      pointerId: 2
    });

    expect(movePointElementByDelta).toHaveBeenCalledTimes(2);
    const commitAction = movePointElementByDelta.mock.calls[1]?.[0];
    expect(commitAction).toMatchObject({
      elementId: "point-a",
      dx: 8,
      commitMode: "commit"
    });
    expect(Math.abs(commitAction?.dy ?? Number.NaN)).toBe(0);
  });

  it("keeps drag activated after crossing the threshold and returning close to the start", () => {
    const movePointElementByDelta = vi.fn();
    const { viewport } = renderCanvas({ movePointElementByDelta });

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: pointScreen.x,
      clientY: pointScreen.y,
      pointerId: 4
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: pointScreen.x + 9,
      clientY: pointScreen.y,
      pointerId: 4
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: pointScreen.x + 4,
      clientY: pointScreen.y,
      pointerId: 4
    });
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: pointScreen.x + 4,
      clientY: pointScreen.y,
      pointerId: 4
    });

    expect(movePointElementByDelta).toHaveBeenCalledTimes(3);
    expect(movePointElementByDelta.mock.calls[0]?.[0]).toMatchObject({
      dx: 9,
      commitMode: "preview"
    });
    expect(movePointElementByDelta.mock.calls[1]?.[0]).toMatchObject({
      dx: 4,
      commitMode: "preview"
    });
    expect(movePointElementByDelta.mock.calls[2]?.[0]).toMatchObject({
      dx: 4,
      commitMode: "commit"
    });
  });

  it("preserves Shift orthogonal locking after the drag threshold is crossed", () => {
    const movePointElementByDelta = vi.fn();
    const { viewport } = renderCanvas({ movePointElementByDelta });

    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: pointScreen.x,
      clientY: pointScreen.y,
      pointerId: 3,
      shiftKey: true
    });
    fireEvent.pointerMove(viewport, {
      buttons: 1,
      clientX: pointScreen.x + 9,
      clientY: pointScreen.y + 5,
      pointerId: 3
    });

    expect(movePointElementByDelta.mock.calls[0]?.[0]).toMatchObject({
      dx: 9,
      dy: 0,
      commitMode: "preview"
    });

    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: pointScreen.x + 9,
      clientY: pointScreen.y + 5,
      pointerId: 3
    });
    expect(movePointElementByDelta.mock.calls[1]?.[0]).toMatchObject({
      dx: 9,
      dy: 0,
      commitMode: "commit"
    });
  });
});
