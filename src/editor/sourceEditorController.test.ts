import { undoDepth, redoDepth } from "@codemirror/commands";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  view: { state: { doc: { length: number }; selection: { main: { head: number } } }; dispatch: (spec: unknown) => void };
  runUndo: () => boolean;
};

describe("SourceEditorController commit and history boundaries", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    vi.useFakeTimers();
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => []
    });
  });

  it("clears CM history after an editor commit, store undo/redo, and reset", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const append = (text: string) => internals.view.dispatch({
      changes: { from: internals.view.state.doc.length, insert: text }
    });

    append("\n# burst A");
    expect(undoDepth(internals.view.state as never)).toBeGreaterThan(0);
    internals.runUndo();
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);

    append("\n# burst B");
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().sourceText).toContain("# burst B");
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);

    useCadDocumentStore.getState().undo();
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);
    useCadDocumentStore.getState().redo();
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);

    useCadDocumentStore.getState().replaceTextDocument("nui 1\n# reset", {
      currentFilePath: null,
      dirtySinceSave: false
    });
    expect(undoDepth(internals.view.state as never)).toBe(0);
    expect(redoDepth(internals.view.state as never)).toBe(0);
    controller.destroy();
  });
});
