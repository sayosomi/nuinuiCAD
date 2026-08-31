import { Transaction, type EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchCommand } from "../commands/commands";
import { renameTypedBindingWithPropagation } from "../commands/renameTypedBindingWithPropagation";
import type { BindingId } from "../scalars/bindingCatalog";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  view: {
    state: EditorState;
    dispatch: (spec: unknown) => void;
    scrollDOM: { scrollTop: number; scrollLeft: number };
  };
};

const source = ["nui 1", "let base: number = 1", "let derived: number = @base", "const anchor: number = 42"].join("\n");

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

  it("preserves blank lines when a declaration and a final-line reference are renamed together", () => {
    const sourceWithFinalReference = [
      "nui 1",
      "",
      "const zoom_ratio: number = 2",
      "const SA: number = 7 * @zoom_ratio"
    ].join("\n");
    const expected = [
      "nui 1",
      "",
      "const ZOOM_RATIO: number = 2",
      "const SA: number = 7 * @ZOOM_RATIO"
    ].join("\n");
    useCadDocumentStore.getState().commitText(sourceWithFinalReference, "test");
    const id = typedBindingId("zoom_ratio");

    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    expect(renameTypedBindingWithPropagation(id, "ZOOM_RATIO")).toBe(true);
    expect(useCadDocumentStore.getState().sourceText).toBe(expected);
    expect(internals.view.state.doc.toString()).toBe(expected);

    controller.destroy();
  });

  it("leaves the CM selection completely untouched on a same-scope collision rejection", () => {
    useCadDocumentStore.getState().commitText(["nui 1", "const a: number = 1", "const b: number = 2"].join("\n"), "test");
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
    useCadDocumentStore.getState().commitText(["nui 1", "const base: number = 1"].join("\n"), "test");
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

describe("SourceEditorController.currentCursorTypedRenameTargetBindingId / F2 dispatch", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  it("resolves a cursor on a typed declaration's own name to its own binding", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const offset = source.indexOf("let base") + "let ".length;
    internals.view.dispatch({ selection: { anchor: offset }, annotations: Transaction.addToHistory.of(false) });

    expect(controller.currentCursorTypedRenameTargetBindingId()).toBe(typedBindingId("base"));

    controller.destroy();
  });

  it("resolves a cursor on a reference to the referenced binding, not the declaring one", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const offset = source.indexOf("@base") + 1;
    internals.view.dispatch({ selection: { anchor: offset }, annotations: Transaction.addToHistory.of(false) });

    expect(controller.currentCursorTypedRenameTargetBindingId()).toBe(typedBindingId("base"));

    controller.destroy();
  });

  it("returns null while an uncommitted edit makes the compiled typed metadata stale, even at an otherwise-matching position", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const offset = source.indexOf("let base") + "let ".length;
    internals.view.dispatch({
      changes: { from: 0, to: 0, insert: "// " },
      annotations: Transaction.addToHistory.of(false)
    });
    internals.view.dispatch({ selection: { anchor: offset + 2 }, annotations: Transaction.addToHistory.of(false) });

    expect(controller.currentCursorTypedRenameTargetBindingId()).toBeNull();

    controller.destroy();
  });

  it("F2 dispatch opens the typed rename prompt (not the CAD element prompt) when the cursor is on a typed binding", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const offset = source.indexOf("let base") + "let ".length;
    internals.view.dispatch({ selection: { anchor: offset }, annotations: Transaction.addToHistory.of(false) });

    const handled = dispatchCommand("renameSelectedElement", {
      currentCursorElementId: controller.currentCursorElementId,
      currentCursorTypedRenameTargetBindingId: controller.currentCursorTypedRenameTargetBindingId
    });

    expect(handled).toBe(true);
    expect(useCadUiStore.getState().renameTypedBindingPromptTargetId).toBe(typedBindingId("base"));
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull();

    controller.destroy();
  });

  it("F2 dispatch falls back to the existing CAD element prompt when the cursor is not on any typed construct", () => {
    useCadDocumentStore.getState().commitText(
      [source, "point A = coordinate(x: 0, y: 0)"].join("\n"),
      "test"
    );
    publishTestCanvasSelectionEligibility();
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const elementId = useCadDocumentStore.getState().elements[0]!.id;
    useCadUiStore.getState().setSelectedElementId(elementId);

    const offset = internals.view.state.doc.toString().indexOf("point A") + "point ".length;
    internals.view.dispatch({ selection: { anchor: offset }, annotations: Transaction.addToHistory.of(false) });

    const handled = dispatchCommand("renameSelectedElement", {
      currentCursorElementId: controller.currentCursorElementId,
      currentCursorTypedRenameTargetBindingId: controller.currentCursorTypedRenameTargetBindingId
    });

    expect(handled).toBe(true);
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBe(elementId);
    expect(useCadUiStore.getState().renameTypedBindingPromptTargetId).toBeNull();

    controller.destroy();
  });

  it("F2 dispatch with no typed context at all (e.g. a Canvas-focused F2) leaves CAD element rename completely unaffected", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = coordinate(x: 0, y: 0)", "test");
    publishTestCanvasSelectionEligibility();
    const elementId = useCadDocumentStore.getState().elements[0]!.id;
    useCadUiStore.getState().setSelectedElementId(elementId);

    const handled = dispatchCommand("renameSelectedElement");

    expect(handled).toBe(true);
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBe(elementId);
    expect(useCadUiStore.getState().renameTypedBindingPromptTargetId).toBeNull();
  });

  it("a single F2-resolved rename from the declaration propagates to an initializer reference, a set target, a set-RHS reference, && a template-hole reference together", () => {
    const combined = [
      "nui 1",
      "let base: number = 1",
      "let derived: number = @base",
      "set base = @base + 1",
      'text Label = label(text: "${@base}", anchor: none, size: 3)'
    ].join("\n");
    useCadDocumentStore.getState().commitText(combined, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const offset = combined.indexOf("let base") + "let ".length;
    internals.view.dispatch({ selection: { anchor: offset }, annotations: Transaction.addToHistory.of(false) });
    const bindingId = controller.currentCursorTypedRenameTargetBindingId();
    expect(bindingId).toBe(typedBindingId("base"));

    expect(renameTypedBindingWithPropagation(bindingId!, "renamedBase")).toBe(true);

    const after = useCadDocumentStore.getState().sourceText;
    expect(after).toContain("let renamedBase: number = 1");
    expect(after).toContain("let derived: number = @renamedBase");
    expect(after).toContain("set renamedBase = @renamedBase + 1");
    expect(after).toContain('text Label = label(text: "${@renamedBase}"');
    expect(after).not.toContain("@base");

    controller.destroy();
  });

  it("propagates a declaration rename into a compiled numeric expression", () => {
    const source = ["nui 1", "const length: number = 12", "point B = coordinate(x: @length + 5, y: 0)"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const offset = source.indexOf("const length") + "const ".length;
    internals.view.dispatch({ selection: { anchor: offset }, annotations: Transaction.addToHistory.of(false) });
    const bindingId = controller.currentCursorTypedRenameTargetBindingId();
    expect(renameTypedBindingWithPropagation(bindingId!, "width")).toBe(true);
    expect(useCadDocumentStore.getState().sourceText).toContain("coordinate(x: @width + 5, y: 0)");
    controller.destroy();
  });

  it("propagates a declaration rename into a layout numeric field", () => {
    const source = [
      "nui 1",
      "const printScale: number = 120",
      "layout Main (scale: @printScale) {",
      "}"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const offset = source.indexOf("const printScale") + "const ".length;
    internals.view.dispatch({ selection: { anchor: offset }, annotations: Transaction.addToHistory.of(false) });
    const bindingId = controller.currentCursorTypedRenameTargetBindingId();
    expect(renameTypedBindingWithPropagation(bindingId!, "outputScale")).toBe(true);
    expect(useCadDocumentStore.getState().sourceText).toContain("scale: @outputScale");
    expect(useCadDocumentStore.getState().sourceText).not.toContain("@printScale");
    controller.destroy();
  });

  it("routes && propagates rename through a multiline numeric attribute using its exact physical span", () => {
    const source = ["nui 1", "const length: number = 12", "", "point P = coordinate(", "  x: @length,", "  y: 0", ")"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const name = source.indexOf("@length") + 1;
    for (const cursor of [name, name + 3, name + 5]) {
      internals.view.dispatch({ selection: { anchor: cursor }, annotations: Transaction.addToHistory.of(false) });
      expect(controller.currentCursorTypedRenameTargetBindingId()).not.toBeNull();
    }
    expect(renameTypedBindingWithPropagation(controller.currentCursorTypedRenameTargetBindingId()!, "width")).toBe(true);
    expect(useCadDocumentStore.getState().sourceText).toContain("x: @width");
    controller.destroy();
  });

  it("neither prompt opens, && no source changes, when nothing is selected && the cursor is not on a typed construct", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = coordinate(x: 0, y: 0)", "test");
    useCadUiStore.getState().reconcileSelectionWithElements([]);
    const beforeSourceText = useCadDocumentStore.getState().sourceText;

    const handled = dispatchCommand("renameSelectedElement", {
      currentCursorElementId: () => null,
      currentCursorTypedRenameTargetBindingId: () => null
    });

    expect(handled).toBe(false);
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull();
    expect(useCadUiStore.getState().renameTypedBindingPromptTargetId).toBeNull();
    expect(useCadDocumentStore.getState().sourceText).toBe(beforeSourceText);
  });
});
