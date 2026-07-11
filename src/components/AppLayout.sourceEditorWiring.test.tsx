import { forwardRef, useImperativeHandle } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { defaultDocumentPalette } from "../palette/palette";
import { sampleElements } from "../sampleData";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";
import type { EvaluationResult } from "../types/geometry";
import { AppLayout } from "./AppLayout";

const emptyEvaluation: EvaluationResult = {
  computedGeometry: new Map(),
  computedVariables: new Map(),
  errors: [],
  warnings: []
};

// The engine reports the revisions captured when the evaluation request STARTED.
// They intentionally differ from the store's current compiledDocumentRevision below,
// so a pass-through can be told apart from stamping the current revision.
const engineState: EvaluationEngineState = {
  evaluation: emptyEvaluation,
  evaluationRevision: 41,
  evaluationRequestRevision: 7,
  mode: "reference",
  source: "reference",
  status: "idle",
  rustEligible: false,
  isStale: false,
  error: null
};

vi.mock("../geometry/useEvaluationEngine", () => ({
  useEvaluationEngine: () => engineState
}));

const paneHandle = {
  focus: vi.fn(),
  getText: vi.fn(() => ""),
  setEvaluation: vi.fn(),
  jumpToElement: vi.fn(),
  applyPickCandidate: vi.fn(() => true),
  pickCandidateElementIds: vi.fn(() => []),
  openTextSearch: vi.fn(),
  closeTextSearch: vi.fn(),
  focusSearch: vi.fn()
};

vi.mock("./SourceEditorPane", () => ({
  SourceEditorPane: forwardRef(function SourceEditorPaneStub(_props, ref) {
    useImperativeHandle(ref, () => paneHandle);
    return <div data-source-editor-scope="true" />;
  })
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useCadStore.setState({
    elements: sampleElements,
    palette: defaultDocumentPalette(),
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectionAnchorElementId: sampleElements[0].id,
    isParameterEditMode: false,
    isDependencyJumpMode: false,
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    shortcutSettings: { version: 1, overrides: [] },
    showShortcutHelp: false,
    showShortcutSettings: false,
    showPaletteSettings: false,
    showCommandRibbonSettings: false,
    showDslPanel: false,
    showSelectionColorPicker: false,
    showPrintLayout: false,
    showPrintPreviewWindow: false,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    mockCanvasContext() as unknown as CanvasRenderingContext2D
  );
  class ResizeObserverMock {
    observe() {
      return undefined;
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

describe("AppLayout source editor wiring", () => {
  it("publishes the engine's captured revisions to setEvaluation, not the store's current revision", async () => {
    useCadDocumentStore.setState({ compiledDocumentRevision: 99 });

    render(<AppLayout />);

    await waitFor(() => expect(paneHandle.setEvaluation).toHaveBeenCalled());
    expect(paneHandle.setEvaluation).toHaveBeenCalledWith({
      evaluation: emptyEvaluation,
      compiledDocumentRevision: 41,
      evaluationRequestRevision: 7
    });
    expect(paneHandle.setEvaluation).not.toHaveBeenCalledWith(
      expect.objectContaining({ compiledDocumentRevision: 99 })
    );
  });

  it("routes enterElementListMode (g) to the source editor focus", () => {
    render(<AppLayout />);

    fireEvent.keyDown(window, { key: "g" });

    expect(paneHandle.focus).toHaveBeenCalled();
  });

  it("routes focusElementSearch (Mod+F) to the source editor search", () => {
    render(<AppLayout />);

    fireEvent.keyDown(window, { key: "f", metaKey: true });

    expect(paneHandle.focusSearch).toHaveBeenCalled();
  });
});
