import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  canvasSelectionForElement,
  canvasSelectionSnapshot,
  finalizeCanvasSelectionSession,
  previewCanvasSelection
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
});
