import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";
import type { PositionedDiagnostic } from "./sourceEditorDiagnostics";
import type { AtStopRange } from "./statementRangeIndex";
import type { EvaluationResult } from "../types/geometry";

vi.mock("../commands/commands", () => ({ dispatchCommand: vi.fn() }));
import { dispatchCommand } from "../commands/commands";

type ControllerInternals = {
  view: {
    state: {
      doc: {
        length: number;
        line: (number: number) => { from: number; to: number };
        lineAt: (position: number) => { from: number };
      };
      selection: { main: { head: number }; ranges: readonly unknown[] };
    };
    dispatch: (spec: unknown) => void;
  };
  appliedEvaluation: EvaluationResult | null;
  pendingEvaluation: { evaluation: EvaluationResult; sourceRevision: number } | null;
  atStopRange: AtStopRange | null;
  staleDiagnosticBaseline: PositionedDiagnostic[];
  runEscape: () => boolean;
};

const emptyEvaluation: EvaluationResult = {
  computedGeometry: new Map(),
  computedVariables: new Map(),
  errors: [],
  warnings: []
};

describe("SourceEditorController evaluation revision gating", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    vi.useFakeTimers();
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not apply an evaluation computed against a stale revision", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const currentRevision = useCadDocumentStore.getState().sourceRevision;

    controller.setEvaluation(emptyEvaluation, currentRevision - 1);
    expect(internals.appliedEvaluation).toBeNull();
    expect(internals.pendingEvaluation).not.toBeNull();

    controller.destroy();
  });

  it("applies an evaluation immediately when its revision matches the current, applied revision", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const currentRevision = useCadDocumentStore.getState().sourceRevision;

    controller.setEvaluation(emptyEvaluation, currentRevision);
    expect(internals.appliedEvaluation).toBe(emptyEvaluation);
    expect(internals.pendingEvaluation).toBeNull();

    controller.destroy();
  });

  it("promotes a pending evaluation once CM catches up to its revision", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const currentRevision = useCadDocumentStore.getState().sourceRevision;
    const nextEvaluation: EvaluationResult = { ...emptyEvaluation, warnings: [] };

    controller.setEvaluation(nextEvaluation, currentRevision + 1);
    expect(internals.appliedEvaluation).toBeNull();

    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "\n# edit" } });
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().sourceRevision).toBe(currentRevision + 1);
    expect(internals.appliedEvaluation).toBe(nextEvaluation);

    controller.destroy();
  });

  it("clears the applied evaluation immediately on a document reset instead of showing it over new text", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const currentRevision = useCadDocumentStore.getState().sourceRevision;

    controller.setEvaluation(emptyEvaluation, currentRevision);
    expect(internals.appliedEvaluation).toBe(emptyEvaluation);

    useCadDocumentStore.getState().replaceTextDocument("nui 1\n# reset", {
      currentFilePath: null,
      dirtySinceSave: false
    });
    expect(internals.appliedEvaluation).toBeNull();
    expect(internals.pendingEvaluation).toBeNull();

    controller.destroy();
  });
});

describe("SourceEditorController @stop mapping", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    vi.useFakeTimers();
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resolves the @stop marker to the committed line when clean", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)\n@stop\npoint B = (1, 1)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const stopLine = internals.view.state.doc.line(3);
    expect(internals.atStopRange).toEqual({ from: stopLine.from, to: stopLine.to });

    controller.destroy();
  });

  it("remaps the @stop range through a dirty edit above it instead of using a stale line number", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)\n@stop\npoint B = (1, 1)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const originalFrom = internals.atStopRange!.from;

    internals.view.dispatch({ changes: { from: 0, insert: "# note\n" } });
    expect(internals.atStopRange).not.toBeNull();
    expect(internals.atStopRange!.from).toBeGreaterThan(originalFrom);

    controller.destroy();
  });

  it("hides the @stop marker when an edit fully covers its line, rather than drawing it at a wrong position", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)\n@stop\npoint B = (1, 1)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const stopRange = internals.atStopRange!;

    internals.view.dispatch({
      changes: { from: stopRange.from, to: Math.min(internals.view.state.doc.length, stopRange.to + 1), insert: "" }
    });
    expect(internals.atStopRange).toBeNull();

    controller.destroy();
  });
});

describe("SourceEditorController Escape priority chain", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    vi.useFakeTimers();
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
    vi.mocked(dispatchCommand).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does nothing while composing, rather than assuming the browser already intercepted Escape", () => {
    const onRequestCanvasFocus = vi.fn();
    const closeSourceSearch = vi.fn();
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent, undefined, undefined, {
      onRequestCanvasFocus,
      closeSourceSearch,
      isSourceSearchOpen: () => true
    });
    const internals = controller as unknown as ControllerInternals;
    const content = parent.querySelector(".cm-content")!;
    fireEvent.compositionStart(content);

    expect(internals.runEscape()).toBe(false);
    expect(closeSourceSearch).not.toHaveBeenCalled();
    expect(onRequestCanvasFocus).not.toHaveBeenCalled();
    expect(dispatchCommand).not.toHaveBeenCalled();

    fireEvent.compositionEnd(content);
    controller.destroy();
  });

  it("closes the source search panel before considering pick mode or canvas focus", () => {
    const onRequestCanvasFocus = vi.fn();
    const closeSourceSearch = vi.fn();
    useCadUiStore.setState({
      ...useCadUiStore.getState(),
      activePointPickTarget: { elementId: "e1", parameterKey: "startPoint" as never }
    });
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent, undefined, undefined, {
      onRequestCanvasFocus,
      closeSourceSearch,
      isSourceSearchOpen: () => true
    });
    const internals = controller as unknown as ControllerInternals;

    expect(internals.runEscape()).toBe(true);
    expect(closeSourceSearch).toHaveBeenCalledTimes(1);
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(onRequestCanvasFocus).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("cancels an active pick mode before falling back to canvas focus", () => {
    const onRequestCanvasFocus = vi.fn();
    useCadUiStore.setState({
      ...useCadUiStore.getState(),
      activePointPickTarget: { elementId: "e1", parameterKey: "startPoint" as never }
    });
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent, undefined, undefined, {
      onRequestCanvasFocus,
      isSourceSearchOpen: () => false
    });
    const internals = controller as unknown as ControllerInternals;

    expect(internals.runEscape()).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith("cancelPointPick");
    expect(onRequestCanvasFocus).not.toHaveBeenCalled();

    controller.destroy();
  });

  it("flushes and requests canvas focus when nothing else is active", () => {
    const onRequestCanvasFocus = vi.fn();
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent, undefined, undefined, {
      onRequestCanvasFocus,
      isSourceSearchOpen: () => false
    });
    const internals = controller as unknown as ControllerInternals;

    expect(internals.runEscape()).toBe(true);
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(onRequestCanvasFocus).toHaveBeenCalledTimes(1);

    controller.destroy();
  });
});

describe("SourceEditorController Mod-S save", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    vi.useFakeTimers();
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
    vi.mocked(dispatchCommand).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("flushes pending text and dispatches saveDocument", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const baseline = useCadDocumentStore.getState().sourceText;

    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "\n# pending" } });
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);

    const runSave = (controller as unknown as { runSave: () => boolean }).runSave.bind(controller);
    expect(runSave()).toBe(true);
    expect(useCadDocumentStore.getState().sourceText).toBe(`${baseline}\n# pending`);
    expect(dispatchCommand).toHaveBeenCalledWith("saveDocument");

    controller.destroy();
  });
});
