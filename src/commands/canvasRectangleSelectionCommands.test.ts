import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { replaceCanvasSelection } from "./selectionCommands";
import {
  canvasRectangleSelectionForMembers,
  commitCanvasRectangleSelection
} from "./canvasRectangleSelectionCommands";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";

const elements = [
  { id: "a", name: "A", type: "freePoint" as const, activity: "visible" as const, x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint" as const, activity: "visible" as const, x: 10, y: 0 },
  { id: "c", name: "C", type: "freePoint" as const, activity: "visible" as const, x: 20, y: 0 },
  { id: "hidden", name: "Hidden", type: "freePoint" as const, activity: "hidden" as const, x: 30, y: 0 },
  { id: "disabled", name: "Disabled", type: "freePoint" as const, activity: "disabled" as const, x: 40, y: 0 }
];

describe("Canvas rectangle selection commands", () => {
  beforeEach(() => {
    useCadDocumentStore.setState({ ...initialCadDocumentState(), elements });
    useCadUiStore.setState(initialCadUiState());
    publishTestCanvasSelectionEligibility(elements);
  });

  it("normalizes replace members to eligible document order", () => {
    expect(canvasRectangleSelectionForMembers(
      elements,
      {
        selectedElementId: "c",
        selectedElementIds: ["c"],
        selectionAnchorElementId: "c"
      },
      ["c", "hidden", "a", "b", "c", "disabled"],
      "replace"
    )).toEqual({
      selectedElementId: "a",
      selectedElementIds: ["a", "b", "c"],
      selectionAnchorElementId: "a"
    });
  });

  it("adds while preserving existing order and appending new members in document order", () => {
    replaceCanvasSelection(["c", "a"], "c", false, "requested");

    expect(commitCanvasRectangleSelection(["c", "b", "a"], "add", true)).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "c",
      selectedElementIds: ["c", "a", "b"],
      selectionAnchorElementId: "c"
    });
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
  });

  it("toggles members, keeps survivor order, and falls back primary deterministically", () => {
    replaceCanvasSelection(["c", "a"], "c", false, "requested");

    expect(commitCanvasRectangleSelection(["c", "b"], "toggle", true)).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "a",
      selectedElementIds: ["a", "b"],
      selectionAnchorElementId: "a"
    });
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
  });

  it("clears on an empty replace but leaves empty add/toggle as history-neutral no-ops", () => {
    replaceCanvasSelection(["b"], "b");

    expect(commitCanvasRectangleSelection([], "add", true)).toBe(false);
    expect(commitCanvasRectangleSelection([], "toggle", true)).toBe(false);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(["b"]);
    expect(useCadDocumentStore.getState().selectionPast).toEqual([]);

    expect(commitCanvasRectangleSelection([], "replace", true)).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    });
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
  });

  it("filters hidden/disabled members and records one undoable transition per commit", () => {
    expect(commitCanvasRectangleSelection(["c", "hidden", "a", "disabled"], "replace", true)).toBe(true);
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "a",
      selectedElementIds: ["a", "c"],
      selectionAnchorElementId: "a"
    });
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);

    expect(useCadDocumentStore.getState().undoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(useCadDocumentStore.getState().redoCanvasSelection()).toBe(true);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(["a", "c"]);
  });
});
