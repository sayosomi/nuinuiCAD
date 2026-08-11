import { EditorSelection, Transaction } from "@codemirror/state";
import { describe, expect, it, beforeEach } from "vitest";
import { dispatchCommand } from "../commands/commands";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

describe("SourceEditorController module semantic target priority", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  it("prefers a module source target over a materialized child and clears it while dirty", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  point Private = coordinate(x: 0, y: 0)",
      "}",
      "module I = M()"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const internals = controller as unknown as { view: { dispatch: (spec: unknown) => void; state: { doc: { toString: () => string } } } };
    const privateOffset = source.indexOf("Private");
    internals.view.dispatch({ selection: EditorSelection.cursor(privateOffset), annotations: Transaction.addToHistory.of(false) });
    const target = controller.currentCursorModuleSemanticTarget();
    expect(target?.kind).toBe("moduleSource");
    expect(dispatchCommand("renameSelectedElement", {
      currentCursorModuleSemanticTarget: controller.currentCursorModuleSemanticTarget,
      currentCursorTypedRenameTargetBindingId: controller.currentCursorTypedRenameTargetBindingId
    })).toBe(true);
    expect(useCadUiStore.getState().renameModuleSemanticPromptTarget).toEqual(target);
    useCadUiStore.getState().setRenameModuleSemanticPromptTarget(null);
    internals.view.dispatch({ changes: { from: 0, to: 0, insert: "# " }, annotations: Transaction.addToHistory.of(false) });
    expect(controller.currentCursorModuleSemanticTarget()).toBeNull();
    expect(dispatchCommand("renameSelectedElement", {
      currentCursorModuleSemanticResolution: controller.currentCursorModuleSemanticResolution,
      currentCursorModuleSemanticTarget: controller.currentCursorModuleSemanticTarget,
      currentCursorTypedRenameTargetBindingId: controller.currentCursorTypedRenameTargetBindingId
    })).toBe(true);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("semantic metadata");
    expect(useCadUiStore.getState().renameElementPromptTargetId).toBeNull();
    controller.destroy();
  });

  it("navigates callee, argument label, and qualified export member to exact source declarations", () => {
    const source = [
      "nui 3",
      "module M(width: number) {",
      "  export point Public = coordinate(x: 0, y: 0)",
      "}",
      "module I = M(width: 1)",
      "point X = offset(from: I::Public, dx: 1, dy: 0)"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const internals = controller as unknown as { view: { dispatch: (spec: unknown) => void; state: { selection: { main: { from: number; to: number } }; doc: { sliceString: (from: number, to: number) => string } } } };
    const moveTo = (text: string, start = 0) => {
      const offset = source.indexOf(text, start);
      internals.view.dispatch({ selection: EditorSelection.cursor(offset), annotations: Transaction.addToHistory.of(false) });
    };
    moveTo("M(width", source.indexOf("module I"));
    const callee = controller.currentCursorModuleSemanticTarget();
    expect(callee?.kind).toBe("moduleDefinition");
    expect(controller.jumpToModuleSemanticTarget(callee!)).toBe(true);
    expect(internals.view.state.doc.sliceString(internals.view.state.selection.main.from, internals.view.state.selection.main.to)).toBe("M");
    moveTo("width: 1", source.indexOf("module I"));
    const parameter = controller.currentCursorModuleSemanticTarget();
    expect(parameter?.kind).toBe("moduleParameter");
    expect(controller.jumpToModuleSemanticTarget(parameter!)).toBe(true);
    expect(internals.view.state.doc.sliceString(internals.view.state.selection.main.from, internals.view.state.selection.main.to)).toBe("width");
    moveTo("Public", source.indexOf("I::"));
    const exported = controller.currentCursorModuleSemanticTarget();
    expect(exported?.kind).toBe("moduleSource");
    expect(controller.jumpToModuleSemanticTarget(exported!)).toBe(true);
    expect(internals.view.state.doc.sliceString(internals.view.state.selection.main.from, internals.view.state.selection.main.to)).toBe("Public");
    controller.destroy();
  });

  it("bridges a module default document binding back to the existing BindingId declaration", () => {
    const source = [
      "nui 3",
      "const outer: number = 10",
      "module M(width: number = @outer) {",
      "}",
      "module I = M()"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const controller = new SourceEditorController(document.createElement("div"));
    const internals = controller as unknown as { view: { dispatch: (spec: unknown) => void; state: { doc: { sliceString: (from: number, to: number) => string }; selection: { main: { from: number; to: number } } } } };
    const reference = source.indexOf("@outer") + 1;
    internals.view.dispatch({ selection: EditorSelection.cursor(reference), annotations: Transaction.addToHistory.of(false) });
    const target = controller.currentCursorModuleSemanticTarget();
    expect(target?.kind).toBe("documentBinding");
    expect(controller.jumpToModuleSemanticTarget(target!)).toBe(true);
    expect(internals.view.state.selection.main.from).toBe(source.indexOf("const outer"));
    controller.destroy();
  });
});
