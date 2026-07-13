import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

const source = [
  "nui 1",
  "point 長い基準点 = (120, -45) # 選択行レンズの実測とCanvas同期を確認するための十分に長い注釈テキストです",
  "point B = (1, 1)"
].join("\n");

const settleLens = () => new Promise((resolve) => window.setTimeout(resolve, 20));

describe("SourceEditor main-editor click Lens focus", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(source, "test");
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => []
    });
  });

  afterEach(() => vi.restoreAllMocks());

  const openLongLineEditor = () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lens = parent.querySelector<HTMLElement>(".cm-source-line-lens")!;
    const measure = parent.querySelector<HTMLElement>(".cm-source-line-lens-measure")!;
    Object.defineProperty(view.contentDOM, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(view.scrollDOM, "clientWidth", { configurable: true, value: 72 });
    Object.defineProperty(view.dom.querySelector(".cm-gutters-before")!, "offsetWidth", { configurable: true, value: 24 });
    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 480 });
    return { parent, controller, view, lens };
  };

  const clickMainEditorLine = (view: EditorView, position: number, selection: ReturnType<typeof EditorSelection.cursor>) => {
    vi.spyOn(view, "posAtCoords").mockReturnValue(position);
    fireEvent.mouseDown(view.contentDOM, { button: 0, clientX: 20, clientY: 20 });
    view.dispatch({ selection });
    fireEvent.mouseUp(view.contentDOM, { button: 0, clientX: 20, clientY: 20 });
  };

  it("hands a plain value click on a long line to the Lens", async () => {
    const { parent, controller, view, lens } = openLongLineEditor();
    const longLine = view.state.doc.line(2);
    const valuePosition = longLine.from + longLine.text.indexOf("120") + 1;
    view.focus();
    clickMainEditorLine(view, valuePosition, EditorSelection.cursor(valuePosition));
    await settleLens();

    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;
    const selection = lensView.state.selection.main;
    expect(lens).toHaveClass("is-visible");
    expect(lensView.state.doc.toString().slice(selection.from, selection.to)).toBe("120");
    expect(lensView.hasFocus).toBe(true);
    controller.destroy();
    parent.remove();
  });

  it("hands a plain non-value click to the Lens without moving the cursor", async () => {
    const { parent, controller, view, lens } = openLongLineEditor();
    const longLine = view.state.doc.line(2);
    const namePosition = longLine.from + longLine.text.indexOf("長い基準点") + 2;
    view.focus();
    clickMainEditorLine(view, namePosition, EditorSelection.cursor(namePosition));
    await settleLens();

    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(lens).toHaveClass("is-visible");
    expect(lensView.state.selection.main.empty).toBe(true);
    expect(lensView.state.selection.main.head).toBe(namePosition - longLine.from);
    expect(lensView.hasFocus).toBe(true);
    controller.destroy();
    parent.remove();
  });

  it("does not hand drag or modifier clicks to the Lens", async () => {
    const { parent, controller, view, lens } = openLongLineEditor();
    const longLine = view.state.doc.line(2);
    const valueStart = longLine.from + longLine.text.indexOf("120");
    view.focus();
    vi.spyOn(view, "posAtCoords").mockReturnValue(valueStart);
    fireEvent.mouseDown(view.contentDOM, { button: 0, clientX: 20, clientY: 20 });
    view.dispatch({ selection: EditorSelection.range(valueStart - 2, valueStart + 1) });
    fireEvent.mouseUp(view.contentDOM, { button: 0, clientX: 40, clientY: 20 });
    await settleLens();

    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(lensView.hasFocus).toBe(false);

    vi.restoreAllMocks();
    vi.spyOn(view, "posAtCoords").mockReturnValue(valueStart + 1);
    fireEvent.mouseDown(view.contentDOM, { button: 0, clientX: 20, clientY: 20, metaKey: true });
    view.dispatch({ selection: EditorSelection.cursor(valueStart + 1) });
    fireEvent.mouseUp(view.contentDOM, { button: 0, clientX: 20, clientY: 20, metaKey: true });
    await settleLens();

    expect(lensView.hasFocus).toBe(false);
    expect(view.hasFocus).toBe(true);
    controller.destroy();
    parent.remove();
  });

  it("cancels a pending Lens handoff when the selection moves to another line", async () => {
    const { parent, controller, view, lens } = openLongLineEditor();
    const longLine = view.state.doc.line(2);
    view.focus();
    const namePosition = longLine.from + longLine.text.indexOf("長い基準点");
    clickMainEditorLine(view, namePosition, EditorSelection.cursor(namePosition));
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(3).from) });
    await settleLens();

    const lensView = EditorView.findFromDOM(lens.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(lensView.hasFocus).toBe(false);
    expect(view.hasFocus).toBe(true);
    controller.destroy();
    parent.remove();
  });
});
