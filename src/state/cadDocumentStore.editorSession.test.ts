import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "./cadUiStore";

const onePointSource = (x = 0, y = 0) => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x, y }
]);

const twoPointSource = () => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
]);

describe("cadDocumentStore editor mutation boundary", () => {
  let unregister = () => {};

  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  afterEach(() => unregister());

  it("flushes then rejects an old-model commit and clears preview", () => {
    const flush = vi.fn(() => "flushed" as const);
    unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => false,
      flush
    });
    const before = useCadDocumentStore.getState();
    useCadDocumentStore.setState({ previewElements: before.elements });
    useCadUiStore.getState().setActivePointPickTarget({
      elementId: before.elements[0].id,
      parameterKey: "point"
    });

    const result = useCadDocumentStore.getState().commitDocumentChange({
      evaluationLimitIndex: Math.max(0, (before.evaluationLimitIndex ?? before.elements.length) - 1)
    });

    expect(flush).toHaveBeenCalledWith("model-mutation");
    expect(result).toEqual({ status: "rejected", reason: "pending-text" });
    expect(useCadDocumentStore.getState().sourceText).toBe(before.sourceText);
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
  });

  it("rejects preview, commit, and history restoration during composition", () => {
    const flush = vi.fn(() => "blocked-composition" as const);
    unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => true,
      flush
    });
    const before = useCadDocumentStore.getState();

    expect(useCadDocumentStore.getState().previewDocumentChange({ elements: before.elements })).toEqual({
      status: "rejected",
      reason: "composition"
    });
    expect(useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 0 })).toEqual({
      status: "rejected",
      reason: "composition"
    });
    useCadDocumentStore.getState().commitText("nui 1\n# blocked", "test");
    useCadDocumentStore.getState().replaceTextDocument("nui 1\n# blocked reset", {
      currentFilePath: null,
      dirtySinceSave: false
    });
    useCadUiStore.getState().setSourceCursorLine(9);
    useCadDocumentStore.getState().undo();
    useCadDocumentStore.getState().redo();

    expect(flush).not.toHaveBeenCalled();
    expect(useCadDocumentStore.getState().sourceText).toBe(before.sourceText);
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
    expect(useCadUiStore.getState().sourceCursorLine).toBeNull();
  });

  it("flushes a pending burst before performing a direct store undo", () => {
    useCadDocumentStore.getState().commitText(onePointSource(), "test");
    const baseline = useCadDocumentStore.getState().sourceText;

    const flushedText = twoPointSource();
    const flush = vi.fn(() => {
      useCadDocumentStore.getState().commitText(flushedText, "editor");
      return "flushed" as const;
    });
    unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => false,
      flush
    });

    useCadDocumentStore.getState().undo();

    expect(flush).toHaveBeenCalledWith("command");
    // The burst is flushed && committed first, then a single undo step removes
    // exactly that burst -- not some pre-flush, never-committed intermediate state.
    expect(useCadDocumentStore.getState().sourceText).toBe(baseline);
    expect(useCadDocumentStore.getState().future[0]?.text).toBe(flushedText);
  });

  it("stores and restores the explicit source cursor snapshot", () => {
    useCadUiStore.getState().setSourceCursorLine(3);
    useCadDocumentStore.getState().commitText(onePointSource(3, 0), "test");
    useCadUiStore.getState().setSourceCursorLine(2);
    useCadDocumentStore.getState().commitText(onePointSource(4, 0), "test");

    useCadDocumentStore.getState().undo();
    expect(useCadUiStore.getState().sourceCursorLine).toBe(2);
    useCadDocumentStore.getState().undo();
    expect(useCadUiStore.getState().sourceCursorLine).toBe(3);
    useCadDocumentStore.getState().redo();
    expect(useCadUiStore.getState().sourceCursorLine).toBe(2);
  });
});
