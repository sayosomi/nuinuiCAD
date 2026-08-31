import type { EditorState } from "@codemirror/state";
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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

const source = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "let base: number = 1",
  "const anchor: number = 42"
].join("\n");

const typedBindingId = (name: string): BindingId =>
  useCadDocumentStore.getState().doc.bindingAnalysis!.catalog.bindings.find(
    (binding) => binding.kind === "typed" && binding.name === name
  )!.id;

const elementId = (name: string) =>
  useCadDocumentStore.getState().elements.find((element) => element.name === name)!.id;

const offsetOf = (text: string, needle: string) => text.indexOf(needle);

describe("SourceEditorController typed binding selection - mutual exclusion with element selection", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  it("auto-selects a typed binding when the cursor enters its declaration, clearing an active element selection", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    publishTestCanvasSelectionEligibility();
    const pointId = elementId("A");
    const baseId = typedBindingId("base");
    useCadUiStore.getState().setSelectedElementId(pointId);
    expect(useCadUiStore.getState().selectedElementId).toBe(pointId);

    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const cursorOffset = offsetOf(source, "let base") + "let base: number = ".length;
    internals.view.dispatch({ selection: { anchor: cursorOffset } });

    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "binding", bindingId: baseId });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(useCadUiStore.getState().selectionAnchorElementId).toBeNull();

    controller.destroy();
  });

  it("auto-selects an element when the cursor enters its statement, clearing an active binding selection", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    publishTestCanvasSelectionEligibility();
    const pointId = elementId("A");
    const baseId = typedBindingId("base");
    useCadUiStore.getState().setSelectedBindingId(baseId);
    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "binding", bindingId: baseId });

    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    const cursorOffset = offsetOf(source, "point A") + "point A = coordinate(x: ".length;
    internals.view.dispatch({ selection: { anchor: cursorOffset } });

    expect(useCadUiStore.getState().selectedElementId).toBe(pointId);
    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "elements" });

    controller.destroy();
  });

  it("jumpToBindingDeclaration moves the cursor to the declaration and clears an active element selection", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    publishTestCanvasSelectionEligibility();
    const pointId = elementId("A");
    const anchorId = typedBindingId("anchor");
    useCadUiStore.getState().setSelectedElementId(pointId);

    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;

    expect(controller.jumpToBindingDeclaration(anchorId)).toBe(true);

    const expectedFrom = offsetOf(internals.view.state.doc.toString(), "const anchor");
    expect(internals.view.state.selection.main.head).toBe(expectedFrom);
    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "binding", bindingId: anchorId });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();

    controller.destroy();
  });

  it("jumpToBindingDeclaration returns false for an unknown binding id, without changing selection", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    publishTestCanvasSelectionEligibility();
    const pointId = elementId("A");
    useCadUiStore.getState().setSelectedElementId(pointId);

    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);

    expect(controller.jumpToBindingDeclaration("binding:does-not-exist")).toBe(false);
    expect(useCadUiStore.getState().selectedElementId).toBe(pointId);

    controller.destroy();
  });

  it("does not jump while composing", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const anchorId = typedBindingId("anchor");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const content = parent.querySelector(".cm-content")!;
    const before = internals.view.state.selection.main.head;
    fireEvent.compositionStart(content);

    expect(controller.jumpToBindingDeclaration(anchorId)).toBe(false);
    expect(internals.view.state.selection.main.head).toBe(before);
    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "elements" });

    fireEvent.compositionEnd(content);
    controller.destroy();
  });
});
