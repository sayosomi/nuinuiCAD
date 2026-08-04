import { undoDepth } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../commands/commands";
import { effectiveElements, initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

const source = "nui 3\npoint A = coordinate(x: 12, y: 0)";

const openEditor = (initialSource = source) => {
  useCadDocumentStore.getState().commitText(initialSource, "test");
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

const stepEvent = (direction: 1 | -1, repeat = false) => ({
  key: direction > 0 ? "ArrowRight" : "ArrowLeft",
  code: direction > 0 ? "ArrowRight" : "ArrowLeft",
  altKey: true,
  repeat
});

const pressStep = (view: EditorView, direction: 1 | -1) => {
  fireEvent.keyDown(view.contentDOM, stepEvent(direction));
  fireEvent.keyUp(view.contentDOM, stepEvent(direction));
};

const pressShiftAltStep = (view: EditorView) => {
  const event = { key: "ArrowRight", code: "ArrowRight", altKey: true, shiftKey: true };
  fireEvent.keyDown(view.contentDOM, event);
  fireEvent.keyUp(view.contentDOM, event);
};

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

    expect(useCadDocumentStore.getState().sourceText).toContain("x: 13");
    expect(view.state.doc.toString().slice(view.state.selection.main.from, view.state.selection.main.to)).toBe("13");
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore + 1);
    expect(undoDepth(view.state)).toBe(0);
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);

    selectToken(view, "12");
    pressStep(view, -1);
    expect(useCadDocumentStore.getState().sourceText).toContain("x: 11");
    controller.destroy();
    parent.remove();
  });

  it("keeps Canvas/evaluation input live through a held repeat but creates one Undo step on keyup", () => {
    const { controller, parent, view } = openEditor();
    selectToken(view, "12");
    const before = useCadDocumentStore.getState();

    fireEvent.keyDown(view.contentDOM, stepEvent(1));
    fireEvent.keyDown(view.contentDOM, stepEvent(1, true));
    fireEvent.keyDown(view.contentDOM, stepEvent(1, true));

    const during = useCadDocumentStore.getState();
    expect(during.sourceText).toBe(before.sourceText);
    expect(during.past).toHaveLength(before.past.length);
    const previewPoint = during.previewElements?.find((element) => element.name === "A");
    expect(previewPoint?.type).toBe("freePoint");
    expect((previewPoint as { x?: number })?.x).toBe(15);
    expect(effectiveElements(during).find((element) => element.name === "A")).toMatchObject({ x: 15 });

    fireEvent.keyUp(view.contentDOM, stepEvent(1));
    expect(useCadDocumentStore.getState().sourceText).toContain("x: 15");
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
    expect(useCadDocumentStore.getState().past).toHaveLength(before.past.length + 1);
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);

    selectToken(view, "12");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().past).toHaveLength(before.past.length + 1);
    controller.destroy();
    parent.remove();
  });

  it("steps one quoted expression literal with the parameter step and keeps repeat Undo semantics", () => {
    const expressionSource = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      'point B = offset(from: A, dx: "@変数1 * 2", dy: 0, steps: [dx: 0.25])'
    ].join("\n");
    const { controller, parent, view } = openEditor(expressionSource);
    const two = view.state.doc.toString().indexOf("* 2") + 2;
    view.dispatch({ selection: EditorSelection.cursor(two) });
    const before = useCadDocumentStore.getState();

    fireEvent.keyDown(view.contentDOM, stepEvent(1));
    fireEvent.keyDown(view.contentDOM, stepEvent(1, true));

    expect(view.state.doc.toString()).toContain('dx: "@変数1 * 2.5"');
    expect(useCadDocumentStore.getState().sourceText).toBe(before.sourceText);
    expect(useCadDocumentStore.getState().past).toHaveLength(before.past.length);
    fireEvent.keyUp(view.contentDOM, stepEvent(1));

    expect(useCadDocumentStore.getState().sourceText).toContain('dx: "@変数1 * 2.5"');
    expect(view.state.doc.toString().slice(view.state.selection.main.from, view.state.selection.main.to)).toBe("2.5");
    expect(useCadDocumentStore.getState().past).toHaveLength(before.past.length + 1);
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(expressionSource);
    controller.destroy();
    parent.remove();
  });

  it("steps an end-of-line value and consumes every repeat without moving to the next line", () => {
    // Vertical canonical form puts `dy: 12` on its own physical line, with the
    // closing `)` as the *next* line — a stronger version of the original
    // "end of physical line" check now that single-line calls always end in `)`.
    const offsetSource = [
      "nui 3",
      "point 点A = coordinate(x: 0, y: 0)",
      "point 点B = offset(",
      "  from: 点A,",
      "  dx: 130,",
      "  dy: 12",
      ")",
      "point 次 = coordinate(x: 1, y: 1)"
    ].join("\n");
    const { controller, parent, view } = openEditor(offsetSource);
    const line = view.state.doc.line(6);
    view.dispatch({ selection: EditorSelection.cursor(line.to) });
    const pastBefore = useCadDocumentStore.getState().past.length;

    expect(fireEvent.keyDown(view.contentDOM, stepEvent(1))).toBe(false);
    expect(view.state.doc.line(6).text).toContain("dy: 13");
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(6);
    expect(view.state.doc.toString().slice(view.state.selection.main.from, view.state.selection.main.to)).toBe("13");
    fireEvent.keyUp(view.contentDOM, stepEvent(1));
    expect(useCadDocumentStore.getState().sourceText).toContain("dy: 13");

    const steppedLine = view.state.doc.line(6);
    view.dispatch({ selection: EditorSelection.cursor(steppedLine.to) });
    expect(fireEvent.keyDown(view.contentDOM, stepEvent(1))).toBe(false);
    expect(view.state.doc.line(6).text).toContain("dy: 14");
    expect(view.state.doc.toString().slice(view.state.selection.main.from, view.state.selection.main.to)).toBe("14");
    expect(fireEvent.keyDown(view.contentDOM, stepEvent(1, true))).toBe(false);
    expect(view.state.doc.line(6).text).toContain("dy: 15");
    expect(view.state.doc.toString().slice(view.state.selection.main.from, view.state.selection.main.to)).toBe("15");
    expect(fireEvent.keyDown(view.contentDOM, stepEvent(1, true))).toBe(false);
    expect(view.state.doc.line(6).text).toContain("dy: 16");
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(6);
    expect(view.state.doc.toString().slice(view.state.selection.main.from, view.state.selection.main.to)).toBe("16");
    fireEvent.keyUp(view.contentDOM, stepEvent(1));
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore + 2);
    controller.destroy();
    parent.remove();
  });

  it("runs boolean and choice changes through the same command path", () => {
    const booleanChoiceSource = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: A, end: B)",
      "line Off = offset(sources: [AB], distance: 5, side: right, closed: false)"
    ].join("\n");
    const { controller, parent, view } = openEditor(booleanChoiceSource);
    selectToken(view, "false");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("closed: true");

    selectToken(view, "right");
    pressStep(view, 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("side: left");
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
    expect(useCadDocumentStore.getState().sourceText).toContain("x: 12");
    selectToken(view, "12");
    pressShiftAltStep(view);
    expect(useCadDocumentStore.getState().sourceText).toContain("x: 13");
    controller.destroy();
    parent.remove();
  });

  it("does not pre-flush a dirty burst before the command-owned commit", () => {
    const { controller, parent, view } = openEditor();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n# pending" } });
    selectToken(view, "12");
    const pastBefore = useCadDocumentStore.getState().past.length;

    expect(dispatchCommand("stepSourceValueForward")).toBe(true);

    expect(useCadDocumentStore.getState().sourceText).toContain("x: 13");
    expect(useCadDocumentStore.getState().sourceText).toContain("# pending");
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore + 1);
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    controller.destroy();
    parent.remove();
  });

  it("commits a dirty burst and held step together at a central flush boundary", () => {
    const { controller, parent, view } = openEditor();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n# pending" } });
    selectToken(view, "12");
    const pastBefore = useCadDocumentStore.getState().past.length;

    fireEvent.keyDown(view.contentDOM, stepEvent(1));
    fireEvent.keyDown(view.contentDOM, stepEvent(1, true));
    fireEvent.blur(view.contentDOM);

    expect(useCadDocumentStore.getState().sourceText).toContain("x: 14");
    expect(useCadDocumentStore.getState().sourceText).toContain("# pending");
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
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
    expect(useCadDocumentStore.getState().sourceText).not.toContain("y: 1");
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
