import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { SourceEditorController } from "./sourceEditorController";

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const originalBoundingRect = HTMLElement.prototype.getBoundingClientRect;

describe("SourceEditor state rail", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText("nui 2\npoint A = coordinate(x: 0 y: 0)\npoint B = coordinate(x: 10 y: 0)", "test");
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 500 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 400 });
    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, top: 0, left: 0, right: 500, bottom: 400, width: 500, height: 400, toJSON: () => ({})
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    HTMLElement.prototype.getBoundingClientRect = originalBoundingRect;
  });

  it("opens for the clicked unfocused row and changes that exact row directly", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const controller = new SourceEditorController(parent);
    controller.setEvaluation({
      evaluation: { computedGeometry: new Map(), computedVariables: new Map(), errors: [], warnings: [] },
      compiledDocumentRevision: useCadDocumentStore.getState().compiledDocumentRevision,
      evaluationRequestRevision: 1
    });
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const firstLine = view.state.doc.line(2);
    const secondLine = view.state.doc.line(3);
    view.dispatch({ selection: EditorSelection.cursor(firstLine.from) });
    const marker = parent.querySelector<HTMLElement>(`[data-source-state-rail-line="${secondLine.from}"]`)!;

    fireEvent.mouseDown(marker);

    const rail = parent.querySelector<HTMLElement>(".cm-element-state-rail")!;
    expect(rail).not.toHaveAttribute("hidden");
    expect(view.state.selection.main.head).toBe(firstLine.from);
    fireEvent.click(rail.querySelector<HTMLButtonElement>("[aria-label='非表示にする']")!);

    const elements = useCadDocumentStore.getState().elements;
    expect(elements.find((element) => element.name === "A")?.visible).toBe(true);
    expect(elements.find((element) => element.name === "B")?.visible).toBe(false);
    expect(view.state.selection.main.head).toBe(firstLine.from);
    controller.destroy();
    parent.remove();
  });

  it("moves to another clicked row and closes on Escape or an outside click", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const controller = new SourceEditorController(parent);
    controller.setEvaluation({
      evaluation: { computedGeometry: new Map(), computedVariables: new Map(), errors: [], warnings: [] },
      compiledDocumentRevision: useCadDocumentStore.getState().compiledDocumentRevision,
      evaluationRequestRevision: 1
    });
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const first = parent.querySelector<HTMLElement>(`[data-source-state-rail-line="${view.state.doc.line(2).from}"]`)!;
    const second = parent.querySelector<HTMLElement>(`[data-source-state-rail-line="${view.state.doc.line(3).from}"]`)!;
    const rail = parent.querySelector<HTMLElement>(".cm-element-state-rail")!;

    fireEvent.mouseDown(first);
    expect(rail).not.toHaveAttribute("hidden");
    fireEvent.mouseDown(second);
    expect(rail).not.toHaveAttribute("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(rail).toHaveAttribute("hidden");

    fireEvent.mouseDown(first);
    fireEvent.pointerDown(view.contentDOM);
    expect(rail).toHaveAttribute("hidden");

    fireEvent.mouseDown(first);
    fireEvent.pointerDown(document.body);
    expect(rail).toHaveAttribute("hidden");
    controller.destroy();
    parent.remove();
  });

  it("anchors a state rail marker on a vertical statement header, never its argument rows", () => {
    useCadDocumentStore.getState().commitText(dslTextForElements([
      { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 }
    ]), "test");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const controller = new SourceEditorController(parent);
    controller.setEvaluation({
      evaluation: { computedGeometry: new Map(), computedVariables: new Map(), errors: [], warnings: [] },
      compiledDocumentRevision: useCadDocumentStore.getState().compiledDocumentRevision,
      evaluationRequestRevision: 1
    });
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const header = view.state.doc.line(view.state.doc.toString().split("\n").findIndex((line) => line.includes("point B =")) + 1);
    const argument = view.state.doc.line(header.number + 1);
    expect(parent.querySelector(`[data-source-state-rail-line="${header.from}"]`)).not.toBeNull();
    expect(parent.querySelector(`[data-source-state-rail-line="${argument.from}"]`)).toBeNull();
    controller.destroy();
    parent.remove();
  });
});
