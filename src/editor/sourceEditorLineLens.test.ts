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

describe("SourceEditor selected-line lens", () => {
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

  it("shows only for an overflowing selected line and moves the real cursor from a lens token", () => {
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lens = parent.querySelector<HTMLElement>(".cm-source-line-lens")!;
    const measure = parent.querySelector<HTMLElement>(".cm-source-line-lens-measure")!;
    Object.defineProperty(view.contentDOM, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(view.scrollDOM, "clientWidth", { configurable: true, value: 72 });
    Object.defineProperty(view.dom.querySelector(".cm-gutters-before")!, "offsetWidth", { configurable: true, value: 24 });
    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 480 });

    const longLine = view.state.doc.line(2);
    view.dispatch({ selection: EditorSelection.cursor(longLine.from + 6) });

    expect(lens).toHaveClass("is-visible");
    const token = lens.querySelector<HTMLElement>("[data-source-lens-from]");
    expect(token).not.toBeNull();
    fireEvent.mouseDown(token!);
    expect(view.state.selection.main.head).toBe(longLine.from);

    Object.defineProperty(measure, "scrollWidth", { configurable: true, value: 12 });
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(3).from) });
    expect(lens).not.toHaveClass("is-visible");
    controller.destroy();
  });

  it("defers cursor restoration until focus returns after a Canvas-equivalent model patch", () => {
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (120, -45)\npoint B = (1, 1)", "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const line = view.state.doc.line(2);
    const cursor = line.from + 12;
    view.dispatch({ selection: EditorSelection.cursor(cursor) });
    const selectedBeforePatch = useCadUiStore.getState().selectedElementId;
    expect(selectedBeforePatch).toBe(useCadDocumentStore.getState().elements.find((element) => element.name === "A")?.id);
    view.scrollDOM.scrollTop = 42;
    view.scrollDOM.scrollLeft = 36;

    const elements = useCadDocumentStore.getState().elements;
    const changed = elements.map((element) =>
      element.name === "A" ? { ...element, locked: true } : element
    );
    expect(useCadDocumentStore.getState().commitDocumentChange({ elements: changed })).toEqual({ status: "applied" });
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("model-patch");
    expect(useCadUiStore.getState().selectedElementId).toBe(selectedBeforePatch);

    expect(view.state.selection.main.head).toBe(line.from);
    expect(view.scrollDOM.scrollTop).toBe(42);
    expect(view.scrollDOM.scrollLeft).toBe(36);
    fireEvent.focus(view.contentDOM);
    expect(view.state.selection.main.head).toBe(cursor);
    controller.destroy();
  });
});
