import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  canvasSelectionSnapshot,
  finalizeCanvasSelectionSession,
  previewCanvasSelection
} from "./selectionCommands";

const elements = [
  { id: "a", name: "A", type: "freePoint" as const, activity: "visible" as const, x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint" as const, activity: "visible" as const, x: 10, y: 0 }
];

describe("ephemeral Canvas overlap selection", () => {
  beforeEach(() => {
    useCadDocumentStore.setState({ ...initialCadDocumentState(), elements });
    useCadUiStore.setState(initialCadUiState());
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
});
