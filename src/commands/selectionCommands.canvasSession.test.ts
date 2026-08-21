import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  canvasSelectionForElement,
  canvasSelectionSnapshot,
  finalizeCanvasSelectionSession,
  previewCanvasSelection,
  replaceCanvasSelection,
  selectAllElements,
  selectElement,
  selectElementByOffset
} from "./selectionCommands";

const elements = [
  { id: "a", name: "A", type: "freePoint" as const, activity: "visible" as const, x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint" as const, activity: "visible" as const, x: 10, y: 0 },
  { id: "c", name: "C", type: "freePoint" as const, activity: "visible" as const, x: 20, y: 0 }
];

describe("ephemeral Canvas overlap selection", () => {
  beforeEach(() => {
    useCadDocumentStore.setState({ ...initialCadDocumentState(), elements });
    useCadUiStore.setState(initialCadUiState());
  });

  it("calculates replace, toggle, and document-order range selection from a snapshot", () => {
    expect(canvasSelectionForElement(elements, {
      selectedElementId: "a",
      selectedElementIds: ["a"],
      selectionAnchorElementId: "a"
    }, "c", "replace")).toEqual({
      selectedElementId: "c",
      selectedElementIds: ["c"],
      selectionAnchorElementId: "c"
    });

    expect(canvasSelectionForElement(elements, {
      selectedElementId: "b",
      selectedElementIds: ["a", "b"],
      selectionAnchorElementId: "b"
    }, "b", "toggle")).toEqual({
      selectedElementId: "a",
      selectedElementIds: ["a"],
      selectionAnchorElementId: "a"
    });

    expect(canvasSelectionForElement(elements, {
      selectedElementId: "a",
      selectedElementIds: ["a"],
      selectionAnchorElementId: "a"
    }, "c", "range")).toEqual({
      selectedElementId: "c",
      selectedElementIds: ["a", "b", "c"],
      selectionAnchorElementId: "a"
    });
  });

  it("recalculates each preview from the A baseline instead of chaining A to B to C", () => {
    const before = {
      selectedElementId: "a",
      selectedElementIds: ["a"],
      selectionAnchorElementId: "a"
    };
    expect(canvasSelectionForElement(elements, before, "b", "replace")).toEqual({
      selectedElementId: "b",
      selectedElementIds: ["b"],
      selectionAnchorElementId: "b"
    });
    expect(canvasSelectionForElement(elements, before, "c", "replace")).toEqual({
      selectedElementId: "c",
      selectedElementIds: ["c"],
      selectionAnchorElementId: "c"
    });
  });

  it("previews from the session baseline and records exactly one history transition on finalize", () => {
    const before = canvasSelectionSnapshot();

    previewCanvasSelection(before, "a", "replace");
    previewCanvasSelection(before, "b", "replace");

    expect(useCadUiStore.getState().selectedElementId).toBe("b");
    expect(useCadDocumentStore.getState().selectionPast).toEqual([]);

    finalizeCanvasSelectionSession(before);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);

    expect(useCadDocumentStore.getState().undoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(useCadDocumentStore.getState().redoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState().selectedElementId).toBe("b");
  });

  it("does not record history when the final preview equals the baseline", () => {
    useCadUiStore.getState().setSelectedElementId("a");
    const before = canvasSelectionSnapshot();

    previewCanvasSelection(before, "a", "replace");
    finalizeCanvasSelectionSession(before);

    expect(useCadDocumentStore.getState().selectionPast).toEqual([]);
  });

  it("filters hidden and disabled targets across replace, range, toggle, and navigation", () => {
    const mixedElements = elements.map((element) =>
      element.id === "b"
        ? { ...element, activity: "hidden" as const }
        : element.id === "c"
          ? { ...element, activity: "disabled" as const }
          : element
    );
    useCadDocumentStore.setState({ elements: mixedElements });
    useCadUiStore.getState().setSelectedElementId("a");

    expect(canvasSelectionForElement(mixedElements, canvasSelectionSnapshot(), "b", "replace"))
      .toBeNull();
    expect(canvasSelectionForElement(mixedElements, canvasSelectionSnapshot(), "c", "toggle"))
      .toBeNull();
    expect(canvasSelectionForElement(mixedElements, canvasSelectionSnapshot(), "c", "range"))
      .toBeNull();
    expect(replaceCanvasSelection(["b", "a", "c"], "c", true)).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "a",
      selectedElementIds: ["a"],
      selectionAnchorElementId: "a"
    });

    selectAllElements();
    expect(useCadUiStore.getState().selectedElementIds).toEqual(["a"]);
    selectElementByOffset(1);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(["a"]);
    selectElement("b", "replace", true);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(["a"]);
  });

  it("does not resurrect a hidden target through Canvas selection Undo/Redo", () => {
    selectElement("b", "replace");
    selectElement("a", "replace", true);
    useCadDocumentStore.setState({
      elements: elements.map((element) =>
        element.id === "b" ? { ...element, activity: "hidden" as const } : element
      )
    });

    expect(useCadDocumentStore.getState().undoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    });
    expect(useCadDocumentStore.getState().redoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState().selectedElementId).toBe("a");
  });
});
