import { Transaction, type EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renameTypedBindingWithPropagation } from "../commands/renameTypedBindingWithPropagation";
import type { BindingId } from "../scalars/bindingCatalog";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  view: {
    state: EditorState;
    dispatch: (spec: unknown) => void;
    scrollDOM: { scrollTop: number; scrollLeft: number };
  };
};

const source = ["nui 3", "let base: number = 1", "let derived: number = @base", "const anchor: number = 42"].join("\n");

const typedBindingId = (name: string): BindingId =>
  useCadDocumentStore.getState().doc.bindingAnalysis!.catalog.bindings.find(
    (binding) => binding.kind === "typed" && binding.name === name
  )!.id;

/** Offset right before "42" on the `const anchor` line - never itself edited by the rename. */
const anchorCursorOffset = (text: string) => text.indexOf("const anchor") + "const anchor: number = ".length;

describe("SourceEditorController typed binding rename - selection/cursor preservation", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  afterEach(() => {
    // Individual tests destroy their own controller.
  });

  it("maps a cursor after the rename site through the edit, via the same model-patch selection mapping the element rename already relies on", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const id = typedBindingId("base");

    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const cursorOffset = anchorCursorOffset(source);
    internals.view.dispatch({ selection: { anchor: cursorOffset }, annotations: Transaction.addToHistory.of(false) });
    expect(internals.view.state.selection.main.head).toBe(cursorOffset);

    expect(renameTypedBindingWithPropagation(id, "renamedBase")).toBe(true);

    const after = useCadDocumentStore.getState().sourceText;
    expect(internals.view.state.doc.toString()).toBe(after);
    expect(internals.view.state.selection.main.head).toBe(anchorCursorOffset(after));

    controller.destroy();
  });

  it("leaves the CM selection completely untouched on a same-scope collision rejection", () => {
    useCadDocumentStore.getState().commitText(["nui 3", "const a: number = 1", "const b: number = 2"].join("\n"), "test");
    const id = typedBindingId("a");

    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const cursorOffset = 5;
    internals.view.dispatch({ selection: { anchor: cursorOffset }, annotations: Transaction.addToHistory.of(false) });

    expect(renameTypedBindingWithPropagation(id, "b")).toBe(false);

    expect(internals.view.state.doc.toString()).toBe(useCadDocumentStore.getState().sourceText);
    expect(internals.view.state.selection.main.head).toBe(cursorOffset);

    controller.destroy();
  });

  it("leaves the CM selection completely untouched on a same-name no-op", () => {
    useCadDocumentStore.getState().commitText(["nui 3", "const base: number = 1"].join("\n"), "test");
    const id = typedBindingId("base");

    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const cursorOffset = 5;
    internals.view.dispatch({ selection: { anchor: cursorOffset }, annotations: Transaction.addToHistory.of(false) });

    expect(renameTypedBindingWithPropagation(id, "base")).toBe(true);

    expect(internals.view.state.selection.main.head).toBe(cursorOffset);

    controller.destroy();
  });

  it("restores exact text and the correct cursor line through undo/redo", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const id = typedBindingId("base");

    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const cursorOffset = anchorCursorOffset(source);
    internals.view.dispatch({ selection: { anchor: cursorOffset }, annotations: Transaction.addToHistory.of(false) });
    expect(renameTypedBindingWithPropagation(id, "renamedBase")).toBe(true);
    const anchorLineAfterRename = internals.view.state.doc.lineAt(internals.view.state.selection.main.head).number;

    useCadDocumentStore.getState().undo();
    expect(internals.view.state.doc.toString()).toBe(source);
    // The "const anchor" line itself is never edited by the rename, so its
    // line number is unchanged across the whole sequence - undo/redo's
    // existing line-granularity cursor restore (shared by every other
    // command, not special-cased by this one) lands back on it correctly.
    expect(internals.view.state.doc.lineAt(internals.view.state.selection.main.head).number).toBe(anchorLineAfterRename);

    useCadDocumentStore.getState().redo();
    expect(internals.view.state.doc.toString()).toBe(useCadDocumentStore.getState().sourceText);
    expect(internals.view.state.doc.lineAt(internals.view.state.selection.main.head).number).toBe(anchorLineAfterRename);

    controller.destroy();
  });
});
