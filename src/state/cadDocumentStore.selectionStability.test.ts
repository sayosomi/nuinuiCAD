import { beforeEach, describe, expect, it } from "vitest";
import { dslFlatTextForElements } from "../dsl/dslDocumentTestUtils";
import type { CadElement } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "./cadUiStore";

const pointA: CadElement = {
  id: "selection-a",
  name: "A",
  type: "freePoint",
  activity: "visible",
  x: 0,
  y: 0
};
const pointB: CadElement = {
  id: "selection-b",
  name: "B",
  type: "freePoint",
  activity: "visible",
  x: 60,
  y: 0
};

const validSource = dslFlatTextForElements([pointA, pointB]);
const bOnlySource = dslFlatTextForElements([pointB]);
const errorfulWithoutA = [
  bOnlySource,
  "line Temp = segment(",
  "  start: @B,",
  "  end: ",
  ")"
].join("\n");
const errorfulWithBoth = [
  validSource,
  "line Temp = segment(",
  "  start: @B,",
  "  end: ",
  ")"
].join("\n");

const selection = () => {
  const ui = useCadUiStore.getState();
  return {
    selectedElementId: ui.selectedElementId,
    selectedElementIds: ui.selectedElementIds,
    selectionAnchorElementId: ui.selectionAnchorElementId
  };
};

const selectA = () => useCadUiStore.getState().applySelection(
  useCadDocumentStore.getState().elements,
  {
    selectedElementId: "selection-a",
    selectedElementIds: ["selection-a"],
    selectionAnchorElementId: "selection-a"
  }
);

describe("editor selection stability across transient invalid source", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText(validSource, "test");
    selectA();
    expect(selection().selectedElementId).toBe("selection-a");
  });

  it("preserves the last stable selection when an errorful editor snapshot temporarily drops its element", () => {
    useCadDocumentStore.getState().commitText(errorfulWithoutA, "editor");

    const documentState = useCadDocumentStore.getState();
    expect(documentState.sourceText).toBe(errorfulWithoutA);
    expect(documentState.sourceUpdate.kind).toBe("editor");
    expect(documentState.diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing-attribute-value", severity: "error" })
    );
    expect(documentState.elements.some((element) => element.id === "selection-a")).toBe(false);
    expect(selection()).toEqual({
      selectedElementId: "selection-a",
      selectedElementIds: ["selection-a"],
      selectionAnchorElementId: "selection-a"
    });

    useCadDocumentStore.getState().commitText(validSource, "editor");
    expect(useCadDocumentStore.getState().diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(selection().selectedElementId).toBe("selection-a");
  });

  it("clears the preserved selection when the next error-free editor revision intentionally deletes it", () => {
    useCadDocumentStore.getState().commitText(errorfulWithoutA, "editor");
    expect(selection().selectedElementId).toBe("selection-a");

    useCadDocumentStore.getState().commitText(bOnlySource, "editor");
    expect(selection()).toEqual({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    });
  });

  it.each(["hidden", "disabled"] as const)(
    "prunes the preserved selection when the final valid revision makes it %s",
    (activity) => {
      useCadDocumentStore.getState().commitText(errorfulWithoutA, "editor");
      expect(selection().selectedElementId).toBe("selection-a");

      useCadDocumentStore.getState().commitText(
        dslFlatTextForElements([{ ...pointA, activity }, pointB]),
        "editor"
      );
      expect(selection()).toEqual({
        selectedElementId: null,
        selectedElementIds: [],
        selectionAnchorElementId: null
      });
    }
  );

  it("keeps unrelated selected members while an error exists elsewhere", () => {
    useCadUiStore.getState().setSelectedElementIds(["selection-a", "selection-b"], "selection-a");
    useCadDocumentStore.getState().commitText(errorfulWithBoth, "editor");

    expect(selection()).toEqual({
      selectedElementId: "selection-a",
      selectedElementIds: ["selection-a", "selection-b"],
      selectionAnchorElementId: "selection-a"
    });
  });

  it("keeps replaceTextDocument as an authoritative reset path", () => {
    useCadDocumentStore.getState().commitText(errorfulWithoutA, "editor");
    expect(selection().selectedElementId).toBe("selection-a");

    useCadDocumentStore.getState().replaceTextDocument(bOnlySource, {
      currentFilePath: "/tmp/replaced.nui",
      dirtySinceSave: false
    });
    expect(selection()).toEqual({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    });
  });
});
