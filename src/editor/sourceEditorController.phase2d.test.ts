import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import type { DslDocumentData } from "../dsl/dslDocument";
import { SourceEditorController } from "./sourceEditorController";
import type { PositionedDiagnostic } from "./sourceEditorDiagnostics";
import type { AtStopRange } from "./statementRangeIndex";
import type { EvaluationResult } from "../types/geometry";
import { evaluateElements } from "../geometry/evaluate";

const forGroupSource = () => dslTextForElements([
  { id: "loop", name: "繰返し", type: "forGroup", activity: "visible", variableName: "i", start: 0, count: 2, step: 1, showGenerated: true },
  { id: "p", name: "P", type: "freePoint", activity: "visible", x: { kind: "expression", expression: "i" }, y: 0, parentGroupId: "loop" }
]);

const twoPointSource = () => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
]);

// @stopの直前で評価を打ち切った文書(A有効・B以降は評価対象外)。
const stoppedSource = (elements: DslDocumentData["elements"]) => dslTextForElements(elements, 1);

vi.mock("../commands/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../commands/commands")>()),
  dispatchCommand: vi.fn()
}));
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
  appliedEvaluation: { evaluation: EvaluationResult; compiledDocumentRevision: number; evaluationRequestRevision: number } | null;
  pendingEvaluations: Map<number, { evaluation: EvaluationResult; evaluationRequestRevision: number }>;
  decorationIndex: {
    statuses: readonly { elementId: string; disabledSelf: boolean }[];
    generatedWidgets: readonly unknown[];
  };
  atStopRange: AtStopRange | null;
  staleDiagnosticBaseline: PositionedDiagnostic[];
  runEscape: () => boolean;
  handleElementStateGutterAction: (lineFrom: number) => boolean;
  runPickApply: () => boolean;
};

const emptyEvaluation: EvaluationResult = {
  computedGeometry: new Map(),
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

    controller.setEvaluation({ evaluation: emptyEvaluation, compiledDocumentRevision: currentRevision - 1, evaluationRequestRevision: 1 });
    expect(internals.appliedEvaluation).toBeNull();
    expect(internals.pendingEvaluations).toHaveLength(0);

    controller.destroy();
  });

  it("applies an evaluation immediately when its revision matches the current, applied revision", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const currentRevision = useCadDocumentStore.getState().sourceRevision;

    controller.setEvaluation({ evaluation: emptyEvaluation, compiledDocumentRevision: currentRevision, evaluationRequestRevision: 1 });
    expect(internals.appliedEvaluation?.evaluation).toBe(emptyEvaluation);
    expect(internals.pendingEvaluations).toHaveLength(0);

    controller.destroy();
  });

  it("promotes a pending evaluation once CM catches up to its revision", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const currentRevision = useCadDocumentStore.getState().sourceRevision;
    const nextEvaluation: EvaluationResult = { ...emptyEvaluation, warnings: [] };

    controller.setEvaluation({ evaluation: nextEvaluation, compiledDocumentRevision: currentRevision + 1, evaluationRequestRevision: 2 });
    expect(internals.appliedEvaluation).toBeNull();

    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "\n# edit" } });
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().sourceRevision).toBe(currentRevision + 1);
    expect(internals.appliedEvaluation?.evaluation).toBe(nextEvaluation);

    controller.destroy();
  });

  it("clears the applied evaluation immediately on a document reset instead of showing it over new text", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const currentRevision = useCadDocumentStore.getState().sourceRevision;

    controller.setEvaluation({ evaluation: emptyEvaluation, compiledDocumentRevision: currentRevision, evaluationRequestRevision: 1 });
    expect(internals.appliedEvaluation?.evaluation).toBe(emptyEvaluation);

    useCadDocumentStore.getState().replaceTextDocument("nui 1\n# reset", {
      currentFilePath: null,
      dirtySinceSave: false
    });
    expect(internals.appliedEvaluation).toBeNull();
    expect(internals.pendingEvaluations).toHaveLength(0);

    controller.destroy();
  });

  it("removes generated-row widgets before a document reset transaction", () => {
    useCadDocumentStore.getState().commitText(forGroupSource(), "test");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const controller = new SourceEditorController(parent);
    const before = useCadDocumentStore.getState();
    const group = before.elements.find((element) => element.type === "forGroup")!;
    useCadUiStore.getState().setGroupFold(group.id, { expanded: true });
    controller.setEvaluation({
      evaluation: evaluateElements(before.elements),
      compiledDocumentRevision: before.compiledDocumentRevision,
      evaluationRequestRevision: 1
    });
    expect(parent.querySelectorAll(".cm-generated-rows-widget")).toHaveLength(1);

    useCadDocumentStore.getState().replaceTextDocument(dslTextForElements([
      { id: "x", name: "X", type: "freePoint", activity: "visible", x: 0, y: 0 }
    ]), {
      currentFilePath: null,
      dirtySinceSave: false
    });
    expect(parent.querySelectorAll(".cm-generated-rows-widget")).toHaveLength(0);

    controller.destroy();
    parent.remove();
  });

  it("keeps only the two newest future results and never lets an older result replace them", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const revision = useCadDocumentStore.getState().compiledDocumentRevision;
    const futureOne = { ...emptyEvaluation, warnings: [] };
    const futureTwo = { ...emptyEvaluation, errors: [] };
    const futureThree = { ...emptyEvaluation, computedVariables: new Map() };

    controller.setEvaluation({ evaluation: futureOne, compiledDocumentRevision: revision + 1, evaluationRequestRevision: 1 });
    controller.setEvaluation({ evaluation: futureTwo, compiledDocumentRevision: revision + 2, evaluationRequestRevision: 2 });
    controller.setEvaluation({ evaluation: futureThree, compiledDocumentRevision: revision + 3, evaluationRequestRevision: 3 });
    expect([...internals.pendingEvaluations.keys()]).toEqual([revision + 2, revision + 3]);

    useCadDocumentStore.getState().commitText(`${useCadDocumentStore.getState().sourceText}\n# next`, "editor");
    controller.setEvaluation({ evaluation: emptyEvaluation, compiledDocumentRevision: revision, evaluationRequestRevision: 0 });
    expect([...internals.pendingEvaluations.keys()]).toEqual([revision + 2, revision + 3]);
    expect(internals.appliedEvaluation).toBeNull();
    controller.destroy();
  });

  it("rejects a late result from an older request for the same compiled document", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const revision = useCadDocumentStore.getState().compiledDocumentRevision;
    const newer = { ...emptyEvaluation, warnings: [] };

    controller.setEvaluation({ evaluation: newer, compiledDocumentRevision: revision, evaluationRequestRevision: 2 });
    controller.setEvaluation({ evaluation: emptyEvaluation, compiledDocumentRevision: revision, evaluationRequestRevision: 1 });
    expect(internals.appliedEvaluation?.evaluation).toBe(newer);
    expect(internals.appliedEvaluation?.evaluationRequestRevision).toBe(2);
    expect(internals.pendingEvaluations.size).toBe(0);
    controller.destroy();
  });

  it("keeps all element decorations while a Canvas model patch awaits its fresh evaluation", () => {
    useCadDocumentStore.getState().commitText(twoPointSource(), "test");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const before = useCadDocumentStore.getState();
    const initialEvaluation = evaluateElements(before.elements);

    controller.setEvaluation({
      evaluation: initialEvaluation,
      compiledDocumentRevision: before.compiledDocumentRevision,
      evaluationRequestRevision: 1
    });
    const beforeIds = internals.decorationIndex.statuses.map((status) => status.elementId);
    expect(beforeIds).toHaveLength(2);

    const updatedElements = before.elements.map((element) =>
      element.name === "B" ? { ...element, activity: "disabled" as const } : element
    );
    expect(useCadDocumentStore.getState().commitDocumentChange({ elements: updatedElements }).status).toBe("applied");

    // This assertion runs after the synchronous CM model-patch reflection but
    // before any new evaluation is published. The prior evaluation must remain
    // as the stable presentation instead of clearing every element decoration.
    expect(internals.appliedEvaluation?.evaluation).toBe(initialEvaluation);
    expect(internals.decorationIndex.statuses.map((status) => status.elementId)).toEqual(beforeIds);
    expect(internals.decorationIndex.statuses.find((status) => status.elementId === updatedElements[1].id)?.disabledSelf).toBe(true);
    expect(parent.querySelectorAll(".cm-eval-line").length).toBeGreaterThan(0);

    const current = useCadDocumentStore.getState();
    const freshEvaluation = evaluateElements(current.elements);
    controller.setEvaluation({
      evaluation: freshEvaluation,
      compiledDocumentRevision: current.compiledDocumentRevision,
      evaluationRequestRevision: 2
    });
    expect(internals.appliedEvaluation?.evaluation).toBe(freshEvaluation);
    expect(internals.decorationIndex.statuses.map((status) => status.elementId)).toEqual(beforeIds);

    controller.destroy();
    parent.remove();
  });

  it("keeps generated-row widgets mounted while a Canvas model patch awaits its fresh evaluation", () => {
    useCadDocumentStore.getState().commitText(forGroupSource(), "test");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const before = useCadDocumentStore.getState();
    const group = before.elements.find((element) => element.type === "forGroup")!;
    const child = before.elements.find((element) => element.parentGroupId === group.id)!;
    useCadUiStore.getState().setGroupFold(group.id, { expanded: true });
    controller.setEvaluation({
      evaluation: evaluateElements(before.elements),
      compiledDocumentRevision: before.compiledDocumentRevision,
      evaluationRequestRevision: 1
    });
    expect(internals.decorationIndex.generatedWidgets).toHaveLength(1);
    expect(parent.querySelectorAll(".cm-generated-rows-widget")).toHaveLength(1);

    const updatedElements = before.elements.map((element) =>
      element.id === child.id ? { ...element, activity: "disabled" as const } : element
    );
    expect(useCadDocumentStore.getState().commitDocumentChange({ elements: updatedElements }).status).toBe("applied");
    expect(internals.decorationIndex.generatedWidgets).toHaveLength(1);
    expect(parent.querySelectorAll(".cm-generated-rows-widget")).toHaveLength(1);

    controller.destroy();
    parent.remove();
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
    useCadDocumentStore.getState().commitText(stoppedSource([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ]), "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const stopLine = internals.view.state.doc.line(6);
    expect(internals.atStopRange).toEqual({ from: stopLine.from, to: stopLine.to });

    controller.destroy();
  });

  it("remaps the @stop range through a dirty edit above it instead of using a stale line number", () => {
    useCadDocumentStore.getState().commitText(stoppedSource([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ]), "test");
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
    useCadDocumentStore.getState().commitText(stoppedSource([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ]), "test");
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

  it("invalidates @stop when any part of its token changes", () => {
    // @stopは末尾要素の後に何も続かない場合serializer(layoutElementTree)からは
    // 出力されない(次要素の直前にのみ挿入される仕組みのため)が、@stop自体は
    // v1/v2間で不変のキーワードなので末尾に直接付与しても構文上問題ない。
    const source = `${dslTextForElements([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 }
    ])}\n@stop`;
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const stopRange = internals.atStopRange!;

    internals.view.dispatch({ changes: { from: stopRange.from + 1, to: stopRange.from + 2, insert: "x" } });
    expect(internals.atStopRange).toBeNull();
    controller.destroy();
  });

  it("routes state gutter actions through the activity cycle command", () => {
    useCadDocumentStore.getState().commitText(dslTextForElements([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 }
    ]), "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const point = useCadDocumentStore.getState().elements[0];
    const lineFrom = internals.view.state.doc.line(2).from;

    expect(internals.handleElementStateGutterAction(lineFrom)).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith("cycleElementActivity", { elementId: point.id });
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

describe("SourceEditorController flushed pick safety", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    vi.useFakeTimers();
    vi.mocked(dispatchCommand).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("flushes dirty text then cancels a search pick that no longer resolves", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "\n# pending" } });

    expect(controller.applyPickCandidate("removed-element")).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toContain("# pending");
    expect(dispatchCommand).not.toHaveBeenCalled();
    controller.destroy();
  });

  it("does not apply a pre-flush pick cursor when it cannot be resolved afterwards", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    useCadUiStore.getState().setActivePointPickTarget({ elementId: "missing", parameterKey: "startPoint" as never });
    useCadUiStore.getState().setActivePickCursor({ elementId: "removed-element", optionIndex: 0 });
    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "\n# pending" } });

    expect(internals.runPickApply()).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toContain("# pending");
    expect(dispatchCommand).not.toHaveBeenCalled();
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

describe("SourceEditorController structural shortcuts", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
    vi.mocked(dispatchCommand).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const dispatchedCommandIds = () =>
    vi.mocked(dispatchCommand).mock.calls.map((call) => call[0] as string);

  const buildController = () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const content = parent.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("Missing CodeMirror content");
    return { controller, content };
  };

  it("dispatches structural commands from real CodeMirror keydown", () => {
    const { controller, content } = buildController();

    // jsdom is not detected as macOS, so CodeMirror's Mod prefix is Ctrl here.
    fireEvent.keyDown(content, { key: "ArrowUp", ctrlKey: true });
    fireEvent.keyDown(content, { key: "ArrowDown", ctrlKey: true, altKey: true });
    fireEvent.keyDown(content, { key: "ArrowUp", ctrlKey: true, altKey: true, shiftKey: true });
    fireEvent.keyDown(content, { key: "ArrowDown", ctrlKey: true, altKey: true, shiftKey: true });
    fireEvent.keyDown(content, { key: "End", ctrlKey: true, altKey: true, shiftKey: true });
    fireEvent.keyDown(content, { key: "]", ctrlKey: true });
    fireEvent.keyDown(content, { key: "[", ctrlKey: true });

    expect(dispatchedCommandIds()).toEqual(expect.arrayContaining([
      "moveSelectedElementUp",
      "moveSelectedElementDown",
      "moveEvaluationDividerUp",
      "moveEvaluationDividerDown",
      "moveEvaluationDividerToEnd",
      "indentSelectedElements",
      "outdentSelectedElements"
    ]));

    // Bare brackets stay ordinary DSL text input.
    fireEvent.keyDown(content, { key: "[" });
    fireEvent.keyDown(content, { key: "]" });
    expect(dispatchedCommandIds().filter((id) => id === "outdentSelectedElements")).toHaveLength(1);
    expect(dispatchedCommandIds().filter((id) => id === "indentSelectedElements")).toHaveLength(1);

    controller.destroy();
  });

  it("moves a collapsed element as one unit from its visible closing row with Option+Arrow", () => {
    useCadDocumentStore.getState().commitText([
      "nui 3",
      "point Before = coordinate(x: 0, y: 0)",
      "group G {",
      "  point Child = coordinate(x: 1, y: 1)",
      "}",
      "point After = coordinate(x: 2, y: 2)"
    ].join("\n"), "test");
    const group = useCadDocumentStore.getState().elements.find((element) => element.name === "G")!;
    useCadUiStore.getState().setGroupFold(group.id, { expanded: false });
    const { controller, content } = buildController();
    const internals = controller as unknown as ControllerInternals;
    const closingBrace = internals.view.state.doc.line(5);
    internals.view.dispatch({ selection: { anchor: closingBrace.from } });

    fireEvent.keyDown(content, { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(content, { key: "ArrowDown", altKey: true });

    expect(dispatchCommand).toHaveBeenCalledWith("moveSelectedElementUp", {
      elementId: group.id,
      moveCursorElementOnly: true
    });
    expect(dispatchCommand).toHaveBeenCalledWith("moveSelectedElementDown", {
      elementId: group.id,
      moveCursorElementOnly: true
    });
    controller.destroy();
  });

  it("leaves Option+Arrow to CodeMirror when the current row is not folded", () => {
    useCadDocumentStore.getState().commitText(twoPointSource(), "test");
    const { controller, content } = buildController();
    const internals = controller as unknown as ControllerInternals;
    const secondLine = internals.view.state.doc.line(3);
    const sourceBefore = internals.view.state.doc.toString();
    internals.view.dispatch({ selection: { anchor: secondLine.from } });

    fireEvent.keyDown(content, { key: "ArrowUp", altKey: true });

    expect(dispatchedCommandIds()).not.toContain("moveSelectedElementUp");
    expect(internals.view.state.doc.toString()).not.toBe(sourceBefore);
    controller.destroy();
  });

  it("routes clean-editor Mod+Z, Mod+Y, and Mod+Shift+Z to document history", () => {
    const { controller, content } = buildController();

    fireEvent.keyDown(content, { key: "z", ctrlKey: true });
    fireEvent.keyDown(content, { key: "y", ctrlKey: true });
    fireEvent.keyDown(content, { key: "z", ctrlKey: true, shiftKey: true });

    expect(dispatchedCommandIds()).toEqual(expect.arrayContaining(["undo", "redo", "redo"]));
    controller.destroy();
  });

  it("swallows structural shortcuts during composition and recovers after compositionend", async () => {
    const { controller, content } = buildController();

    fireEvent.compositionStart(content);
    fireEvent.keyDown(content, { key: "ArrowUp", ctrlKey: true });
    fireEvent.keyDown(content, { key: "]", ctrlKey: true });
    expect(dispatchedCommandIds()).not.toContain("moveSelectedElementUp");
    expect(dispatchedCommandIds()).not.toContain("indentSelectedElements");

    fireEvent.compositionEnd(content);
    // jsdom reports a WebKit navigator.vendor, so CodeMirror applies its
    // Safari IME guard: the first key event within 100ms of compositionend is
    // dropped. Real typing arrives later than that; emulate it here.
    await new Promise((resolve) => setTimeout(resolve, 110));
    fireEvent.keyDown(content, { key: "ArrowUp", ctrlKey: true });
    expect(dispatchedCommandIds()).toContain("moveSelectedElementUp");

    controller.destroy();
  });

  it("yields structural shortcuts to pick navigation while a pick target is active", () => {
    const { controller, content } = buildController();
    useCadUiStore.getState().setActivePointPickTarget({
      elementId: "target-element",
      parameterKey: "startPoint" as never
    });

    fireEvent.keyDown(content, { key: "]", ctrlKey: true });
    fireEvent.keyDown(content, { key: "ArrowUp", ctrlKey: true });
    expect(dispatchedCommandIds()).not.toContain("indentSelectedElements");
    expect(dispatchedCommandIds()).not.toContain("moveSelectedElementUp");

    controller.destroy();
  });

  it("leaves Shift+C to normal text input and CodeMirror-owned Mod+Shift+K", () => {
    useCadDocumentStore.getState().commitText(twoPointSource(), "test");
    const { controller, content } = buildController();
    const shiftedC = new KeyboardEvent("keydown", { key: "C", shiftKey: true, bubbles: true, cancelable: true });
    content.dispatchEvent(shiftedC);
    expect(shiftedC.defaultPrevented).toBe(false);
    expect(dispatchedCommandIds()).toEqual([]);

    // This key is deliberately not in the app registry: CodeMirror keeps its
    // standard current-line deletion meaning.
    const deleteLine = new KeyboardEvent("keydown", {
      key: "k", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    });
    fireEvent(content, deleteLine);
    expect(deleteLine.defaultPrevented).toBe(true);
    expect(dispatchedCommandIds()).toEqual([]);
    controller.destroy();
  });

  it("consumes an unavailable app-exclusive key but lets an unavailable editor transaction fall through", () => {
    const { controller } = buildController();
    vi.mocked(dispatchCommand).mockReturnValue(false);
    const internals = controller as unknown as {
      view: unknown;
      sourceEditorShortcutKeymap: () => readonly { key: string; run: (view: unknown) => boolean }[];
    };
    const bindings = internals.sourceEditorShortcutKeymap();

    expect(bindings.find((binding) => binding.key === "Mod-ArrowUp")?.run(internals.view)).toBe(true);
    expect(bindings.find((binding) => binding.key === "Alt-ArrowRight")?.run(internals.view)).toBe(false);
    controller.destroy();
  });
});
