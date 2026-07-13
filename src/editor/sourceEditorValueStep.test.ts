import { undoDepth } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../commands/commands";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

const source = "nui 1\npoint A = (12, 0) locked=true\nvar V = 1 scope=global";

const openEditor = () => {
  useCadDocumentStore.getState().commitText(source, "test");
  const parent = document.createElement("div");
  document.body.append(parent);
  const controller = new SourceEditorController(parent);
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
  return { controller, parent, view };
};

const selectToken = (view: EditorView, token: string) => {
  const position = view.state.doc.toString().indexOf(token);
  expect(position).toBeGreaterThanOrEqual(0);
  view.dispatch({ selection: EditorSelection.cursor(position) });
};

const pressStep = (view: EditorView, direction: 1 | -1) =>
  fireEvent.keyDown(view.contentDOM, {
    key: direction > 0 ? "ArrowRight" : "ArrowLeft",
    altKey: true
  });

const pressShiftAltStep = (view: EditorView) =>
  fireEvent.keyDown(view.contentDOM, { key: "ArrowRight", altKey: true, shiftKey: true });

describe("SourceEditor editor-native value step commands", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  afterEach(() => vi.restoreAllMocks());

  it("changes one numeric token and creates one store Undo step with no CM history", () => {
    const { controller, parent, view } = openEditor();
    selectToken(view, "12");
    const pastBefore = useCadDocumentStore.getState().past.length;

    pressStep(view, 1);

    expect(useCadDocumentStore.getState().sourceText).toContain("(13, 0)");
    expect(view.state.doc.toString().slice(view.state.selection.main.from, view.state.selection.main.to)).toBe("13");
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore + 1);
    expect(undoDepth(view.state)).toBe(0);
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    controller.destroy();
    parent.remove();
  });

  it("runs boolean and choice changes through the same command path", () => {
    const { controller, parent, view } = openEditor();
    selectToken(view, "true");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("locked=false");

    selectToken(view, "global");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("scope=group");
    controller.destroy();
    parent.remove();
  });

  it("uses Source Editor shortcut overrides after the editor is already mounted", () => {
    const { controller, parent, view } = openEditor();
    selectToken(view, "12");
    useCadUiStore.getState().setShortcutSettings({
      version: 1,
      overrides: [{
        bindingId: "sourceEditor.stepSourceValueForward",
        chords: [{ key: "ArrowRight", mod: false, alt: true, shift: true }]
      }]
    });

    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("(12, 0)");
    selectToken(view, "12");
    pressShiftAltStep(view);
    expect(useCadDocumentStore.getState().sourceText).toContain("(13, 0)");
    controller.destroy();
    parent.remove();
  });

  it("does not pre-flush a dirty burst before the command-owned commit", () => {
    const { controller, parent, view } = openEditor();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n# pending" } });
    selectToken(view, "12");
    const pastBefore = useCadDocumentStore.getState().past.length;

    expect(dispatchCommand("stepSourceValueForward")).toBe(true);

    expect(useCadDocumentStore.getState().sourceText).toContain("(13, 0)");
    expect(useCadDocumentStore.getState().sourceText).toContain("# pending");
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore + 1);
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    controller.destroy();
    parent.remove();
  });

  it("falls through without an error for expressions and stays inert during composition or pick", () => {
    const { controller, parent, view } = openEditor();
    const x = view.state.doc.toString().indexOf("12");
    view.dispatch({ changes: { from: x, to: x + 2, insert: "a + 1" }, selection: EditorSelection.cursor(x) });
    pressStep(view, 1);
    expect(view.state.doc.toString()).toContain("a + 1");
    expect(useCadUiStore.getState().commandErrorMessage).toBeNull();

    const content = parent.querySelector(".cm-content")!;
    fireEvent.compositionStart(content);
    pressStep(view, 1);
    expect(view.state.doc.toString()).toContain("a + 1");
    fireEvent.compositionEnd(content);

    useCadUiStore.getState().setActivePointPickTarget({ elementId: "missing", parameterKey: "startPoint" as never });
    selectToken(view, "0");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).not.toContain("(12, 1)");
    controller.destroy();
    parent.remove();
  });

  it("does not step while any editor pick or template insertion is active", () => {
    const { controller, parent, view } = openEditor();
    const activatePickModes = [
      () => useCadUiStore.getState().setActivePointPickTarget({
        elementId: "missing",
        parameterKey: "startPoint" as never
      }),
      () => useCadUiStore.getState().setActiveNumericReferencePickTarget({
        elementId: "missing",
        parameterKey: "x" as never,
        mode: "replace",
        property: "distance" as never
      }),
      () => useCadUiStore.getState().setActiveLinePickTarget({
        elementId: "missing",
        parameterKey: "baseLineId" as never
      }),
      () => useCadUiStore.getState().setActiveTemplateInsertion({} as never)
    ];

    for (const activatePickMode of activatePickModes) {
      useCadUiStore.getState().clearPickMode();
      selectToken(view, "12");
      activatePickMode();
      const before = view.state.doc.toString();
      pressStep(view, 1);
      expect(view.state.doc.toString()).toBe(before);
    }
    controller.destroy();
    parent.remove();
  });
});
