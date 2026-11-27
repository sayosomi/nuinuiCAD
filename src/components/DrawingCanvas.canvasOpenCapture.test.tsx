import { render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore, DEFAULT_CANVAS_VIEWPORT } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { DrawingCanvas } from "./DrawingCanvas";
import type { CanvasHostAdapter } from "./canvasHostAdapter";
import { LEGACY_CANVAS_THEME } from "./canvasTheme";

const point: CadElement = {
  id: "point-a",
  name: "A",
  type: "freePoint",
  activity: "visible",
  x: 10,
  y: 10
};

const drawingHost = (elements: CadElement[]): CanvasHostAdapter => ({
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
  canvasViewport: DEFAULT_CANVAS_VIEWPORT,
  showCanvasPointNames: false,
  showCanvasGeometryNames: false,
  showCanvasPoints: true,
  activePointPickTarget: null,
  activeNumericReferencePickTarget: null,
  activeLinePickTarget: null,
  commandLineSession: null,
  flushSourceEditorOnCanvasPointerDown: () => "clean",
  setCommandErrorMessage: () => undefined,
  focusSourceEditor: () => undefined,
  getCurrentCanonicalDocument: () => ({ elements, sourceRevision: 0, compiledDocumentRevision: 0, sourceText: "", docText: "" }),
  panCanvasViewport: () => undefined,
  zoomCanvasViewportAt: () => undefined,
  selectElement: () => undefined,
  getCanvasSelectionSnapshot: () => ({ selectedElementId: null, selectedElementIds: [], selectionAnchorElementId: null }),
  previewCanvasSelection: () => undefined,
  finalizeCanvasSelectionSession: () => undefined,
  commitCanvasRectangleSelection: () => undefined,
  clearCanvasSelection: () => undefined,
  movePointElementByDelta: () => undefined,
  moveBezierHandleByDelta: () => undefined,
  applyPickedNumericReference: () => undefined,
  applyNumericExpressionReference: () => undefined,
  applyPickedLine: () => undefined,
  applyPickedPoint: () => undefined,
  toggleCanvasPoints: () => undefined,
  resolveImageSourceUrl: (sourcePath) => sourcePath,
  renderFixedCanvasChrome: false
});

beforeEach(() => {
  useCadDocumentStore.setState({ ...initialCadDocumentState(), elements: [point] });
  useCadUiStore.setState(initialCadUiState());
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 500 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 400 });
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, top: 0, left: 0, right: 500, bottom: 400, width: 500, height: 400, toJSON: () => ({})
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(new Proxy({}, {
    get: (target, key) => Reflect.get(target, key) ?? vi.fn(),
    set: (target, key, value) => Reflect.set(target, key, value)
  }) as unknown as CanvasRenderingContext2D);
  class ResizeObserverMock {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
});

describe("DrawingCanvas passive Canvas-open capture", () => {
  it("reports primitive counts only after the production geometry draw completes", () => {
    const onProductionDrawCompleted = vi.fn();
    const elements = [point];
    const view = render(<DrawingCanvas
      evaluation={evaluateElements(elements)}
      canvasFocusRef={createRef<HTMLDivElement>()}
      hostAdapter={drawingHost(elements)}
      onProductionDrawCompleted={onProductionDrawCompleted}
    />);

    expect(onProductionDrawCompleted).toHaveBeenCalledWith({
      drawablePrimitiveCount: 1,
      isCurrentDraw: true,
      isProjectedDraw: false
    });
    view.unmount();
  });

  it("reports identity-bearing completion only after an ordinary successful production draw", () => {
    const elements = [point];
    const evaluation = evaluateElements(elements);
    const onCanvasFrameDrawn = vi.fn();
    const onProductionDrawCompleted = vi.fn();

    render(<DrawingCanvas
      evaluation={evaluation}
      evaluationState={{
        evaluation,
        evaluationRevision: 0,
        evaluationRequestRevision: 6,
        mode: "rust",
        source: "rust",
        status: "ready",
        rustEligible: true,
        isStale: false,
        error: null
      }}
      canvasFocusRef={createRef<HTMLDivElement>()}
      hostAdapter={drawingHost(elements)}
      onCanvasFrameDrawn={onCanvasFrameDrawn}
      // This remains the opt-in benchmark path; normal drawing does not provide it.
    />);

    expect(onCanvasFrameDrawn).toHaveBeenCalledOnce();
    expect(onProductionDrawCompleted).not.toHaveBeenCalled();
  });

  it("reports a valid empty geometry frame after successful drawing", () => {
    const elements: CadElement[] = [];
    const evaluation = evaluateElements(elements);
    const onCanvasFrameDrawn = vi.fn();

    render(<DrawingCanvas
      evaluation={evaluation}
      evaluationState={{
        evaluation,
        evaluationRevision: 0,
        evaluationRequestRevision: 1,
        mode: "rust",
        source: "rust",
        status: "ready",
        rustEligible: true,
        isStale: false,
        error: null
      }}
      canvasFocusRef={createRef<HTMLDivElement>()}
      hostAdapter={drawingHost(elements)}
      onCanvasFrameDrawn={onCanvasFrameDrawn}
    />);

    expect(onCanvasFrameDrawn).toHaveBeenCalledOnce();
  });

  it("does not report current-frame completion for placeholder, zero-size, or contextless draws", () => {
    const elements = [point];
    const evaluation = evaluateElements(elements);
    const onCanvasFrameDrawn = vi.fn();
    const canvasRef = createRef<HTMLDivElement>();
    const props = {
      evaluation,
      evaluationState: {
        evaluation,
        evaluationRevision: 0,
        evaluationRequestRevision: 6,
        mode: "rust" as const,
        source: "rust" as const,
        status: "evaluating" as const,
        rustEligible: true,
        isStale: false,
        error: null
      },
      canvasFocusRef: canvasRef,
      hostAdapter: drawingHost(elements),
      onCanvasFrameDrawn
    };
    const view = render(<DrawingCanvas {...props} />);
    expect(onCanvasFrameDrawn).not.toHaveBeenCalled();
    view.unmount();

    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 0 });
    const currentState = { ...props.evaluationState, status: "ready" as const };
    render(<DrawingCanvas {...props} evaluationState={currentState} />);
    expect(onCanvasFrameDrawn).not.toHaveBeenCalled();

    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 500 });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<DrawingCanvas {...props} evaluationState={currentState} />);
    expect(onCanvasFrameDrawn).not.toHaveBeenCalled();
  });
});
