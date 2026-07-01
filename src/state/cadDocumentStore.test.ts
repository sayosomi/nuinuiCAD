import { beforeEach, describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import { currentDocumentSnapshot, initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

describe("cadDocumentStore file state", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("marks committed edits, undo, and redo as dirty", () => {
    useCadDocumentStore.getState().markDocumentSaved("/tmp/pattern.nuinui.json");
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(false);

    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(true);

    useCadDocumentStore.getState().markDocumentSaved("/tmp/pattern.nuinui.json");
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(true);

    useCadDocumentStore.getState().markDocumentSaved("/tmp/pattern.nuinui.json");
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(true);
  });

  it("replaces the document, resets history, and normalizes invalid selection", () => {
    useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: 1 });
    expect(useCadDocumentStore.getState().past).toHaveLength(1);

    useCadDocumentStore.getState().replaceDocument(
      {
        elements: [sampleElements[1]],
        palette: useCadDocumentStore.getState().palette,
        evaluationLimitIndex: 999,
        selectedElementId: "missing",
        selectedElementIds: ["missing"],
        selectionAnchorElementId: "missing",
        selectedParameterKey: "x"
      },
      "/tmp/loaded.nuinui.json"
    );

    expect(useCadDocumentStore.getState()).toMatchObject({
      elements: [sampleElements[1]],
      evaluationLimitIndex: 1,
      selectedElementId: sampleElements[1].id,
      selectedElementIds: [sampleElements[1].id],
      selectionAnchorElementId: sampleElements[1].id,
      selectedParameterKey: "name",
      past: [],
      future: [],
      currentFilePath: "/tmp/loaded.nuinui.json",
      dirtySinceSave: false
    });
  });

  it("does not include file state in document snapshots", () => {
    useCadDocumentStore.getState().markDocumentSaved("/tmp/pattern.nuinui.json");

    expect(currentDocumentSnapshot(useCadDocumentStore.getState())).not.toHaveProperty("currentFilePath");
    expect(currentDocumentSnapshot(useCadDocumentStore.getState())).not.toHaveProperty("dirtySinceSave");
  });

  it("tracks palette edits in document history", () => {
    useCadDocumentStore.getState().setDefaultColorId("cut-red");

    expect(useCadDocumentStore.getState().palette.defaultColorId).toBe("cut-red");
    expect(useCadDocumentStore.getState().past).toHaveLength(1);

    useCadDocumentStore.getState().undo();

    expect(useCadDocumentStore.getState().palette.defaultColorId).toBe("pattern-black");
  });

  it("clears element color ids when deleting a palette color", () => {
    useCadDocumentStore.setState({
      elements: [{ ...sampleElements[0], colorId: "cut-red" }, ...sampleElements.slice(1)]
    });

    useCadDocumentStore.getState().deletePaletteColor("cut-red");

    expect(useCadDocumentStore.getState().elements[0].colorId).toBeUndefined();
    expect(useCadDocumentStore.getState().palette.colors.some((color) => color.id === "cut-red")).toBe(false);
  });
});
