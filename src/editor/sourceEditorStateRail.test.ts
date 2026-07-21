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

describe("SourceEditor element state gutter", () => {
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
    vi.useRealTimers();
    if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    HTMLElement.prototype.getBoundingClientRect = originalBoundingRect;
  });

  it("cycles the clicked row's element directly on mousedown, without moving the cursor", () => {
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
    const marker = parent.querySelector<HTMLElement>(`[data-element-activity-line="${secondLine.from}"]`)!;

    fireEvent.mouseDown(marker);

    const elements = useCadDocumentStore.getState().elements;
    expect(elements.find((element) => element.name === "A")).toMatchObject({ visible: true, enabled: true });
    expect(elements.find((element) => element.name === "B")).toMatchObject({ visible: false, enabled: true });
    expect(view.state.selection.main.head).toBe(firstLine.from);
    controller.destroy();
    parent.remove();
  });

  it("cycles independently per row through all three states back to the start", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const controller = new SourceEditorController(parent);
    controller.setEvaluation({
      evaluation: { computedGeometry: new Map(), computedVariables: new Map(), errors: [], warnings: [] },
      compiledDocumentRevision: useCadDocumentStore.getState().compiledDocumentRevision,
      evaluationRequestRevision: 1
    });
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const secondLineFrom = view.state.doc.line(3).from;
    const marker = () => parent.querySelector<HTMLElement>(`[data-element-activity-line="${secondLineFrom}"]`)!;
    const elementB = () => useCadDocumentStore.getState().elements.find((element) => element.name === "B");

    fireEvent.mouseDown(marker());
    expect(elementB()).toMatchObject({ visible: false, enabled: true });

    fireEvent.mouseDown(marker());
    expect(elementB()).toMatchObject({ visible: true, enabled: false });

    fireEvent.mouseDown(marker());
    expect(elementB()).toMatchObject({ visible: true, enabled: true });

    expect(useCadDocumentStore.getState().elements.find((element) => element.name === "A"))
      .toMatchObject({ visible: true, enabled: true });
    controller.destroy();
    parent.remove();
  });

  it("anchors a state marker on a vertical statement header, never its argument rows", () => {
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
    expect(parent.querySelector(`[data-element-activity-line="${header.from}"]`)).not.toBeNull();
    expect(parent.querySelector(`[data-element-activity-line="${argument.from}"]`)).toBeNull();
    controller.destroy();
    parent.remove();
  });

  it("recovers gutter markers and Alt value-step on unrelated lines after a fatal-then-valid typed edit", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const controller = new SourceEditorController(parent);
    controller.setEvaluation({
      evaluation: { computedGeometry: new Map(), computedVariables: new Map(), errors: [], warnings: [] },
      compiledDocumentRevision: useCadDocumentStore.getState().compiledDocumentRevision,
      evaluationRequestRevision: 1
    });
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!;
    const lineOfA = view.state.doc.line(2);
    const lineOfB = view.state.doc.line(3);
    const markerFor = (lineFrom: number) => parent.querySelector<HTMLElement>(`[data-element-activity-line="${lineFrom}"]`);

    expect(markerFor(lineOfA.from)).not.toBeNull();
    expect(markerFor(lineOfB.from)).not.toBeNull();

    vi.useFakeTimers();

    // Repro A (point/coordinate): an unclosed call auto-commits as fatal via
    // the editor's own commit debounce, then gets completed into a new,
    // valid statement.
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\npoint C = coordinate(" } });
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().docText).not.toBe(useCadDocumentStore.getState().sourceText);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "x: 5 y: 5)" } });
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().docText).toBe(useCadDocumentStore.getState().sourceText);

    expect(markerFor(lineOfA.from)).not.toBeNull();
    expect(markerFor(lineOfB.from)).not.toBeNull();

    // Repro B (var): a second, independent fatal-then-valid edit must not
    // compound (or merely coincidentally clear) any staleness left by repro A.
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nvar test2 = " } });
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().docText).not.toBe(useCadDocumentStore.getState().sourceText);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "1" } });
    vi.advanceTimersByTime(300);
    expect(useCadDocumentStore.getState().docText).toBe(useCadDocumentStore.getState().sourceText);

    expect(markerFor(lineOfA.from)).not.toBeNull();
    expect(markerFor(lineOfB.from)).not.toBeNull();

    // Alt+Right must still resolve and step a value span on the untouched line A.
    const xPos = view.state.doc.toString().indexOf("x: 0") + "x: ".length;
    view.dispatch({ selection: EditorSelection.cursor(xPos) });
    const stepRight = { key: "ArrowRight", code: "ArrowRight", altKey: true };
    fireEvent.keyDown(view.contentDOM, stepRight);
    fireEvent.keyUp(view.contentDOM, stepRight);

    expect(useCadDocumentStore.getState().sourceText).toContain("x: 1 ");

    controller.destroy();
    parent.remove();
  });
});
