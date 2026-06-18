import { beforeEach, describe, expect, it } from "vitest";
import { dispatchCommand, filterCommandPaletteItems } from "./commands";
import { sampleElements } from "../sampleData";
import { useCadStore } from "../state/useCadStore";

describe("commands", () => {
  beforeEach(() => {
    useCadStore.setState({
      elements: sampleElements,
      selectedElementId: sampleElements[0].id,
      isParameterEditMode: false,
      selectedParameterKey: "name",
      showShortcutHelp: true,
      showCommandPalette: false,
      past: [],
      future: []
    });
  });

  it("selects next and previous elements", () => {
    dispatchCommand("selectNextElement");
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[1].id);

    dispatchCommand("selectPreviousElement");
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[0].id);
  });

  it("moves the selected element down and up", () => {
    dispatchCommand("moveSelectedElementDown");
    expect(useCadStore.getState().elements[1].id).toBe(sampleElements[0].id);

    dispatchCommand("moveSelectedElementUp");
    expect(useCadStore.getState().elements[0].id).toBe(sampleElements[0].id);
  });

  it("toggles selected element visibility", () => {
    dispatchCommand("toggleSelectedElementVisibility");
    expect(useCadStore.getState().elements[0].visible).toBe(false);
  });

  it("deletes the selected element", () => {
    dispatchCommand("deleteSelectedElement");

    expect(useCadStore.getState().elements.some((element) => element.id === sampleElements[0].id)).toBe(
      false
    );
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[1].id);
  });

  it("adds elements and selects them", () => {
    dispatchCommand("addFreePoint");

    const state = useCadStore.getState();
    expect(state.elements).toHaveLength(sampleElements.length + 1);
    expect(state.elements.at(-1)?.type).toBe("freePoint");
    expect(state.selectedElementId).toBe(state.elements.at(-1)?.id);
  });

  it("opens and closes the command palette", () => {
    dispatchCommand("openCommandPalette");
    expect(useCadStore.getState().showCommandPalette).toBe(true);

    dispatchCommand("closeCommandPalette");
    expect(useCadStore.getState().showCommandPalette).toBe(false);
  });

  it("finds add commands from command palette queries", () => {
    expect(filterCommandPaletteItems("").slice(0, 3).map((item) => item.commandId)).toEqual([
      "addFreePoint",
      "addOffsetPoint",
      "addLine"
    ]);
    expect(filterCommandPaletteItems("point").map((item) => item.commandId)).toEqual(
      expect.arrayContaining(["addFreePoint", "addOffsetPoint"])
    );
    expect(filterCommandPaletteItems("点").map((item) => item.commandId)).toEqual(
      expect.arrayContaining(["addFreePoint", "addOffsetPoint"])
    );
    expect(filterCommandPaletteItems("line").map((item) => item.commandId)).toContain("addLine");
    expect(filterCommandPaletteItems("直線").map((item) => item.commandId)).toContain("addLine");
  });

  it("uses a unique name when adding an element would reuse an existing name", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          ...sampleElements[0],
          id: "manual-point-4",
          name: "点5"
        }
      ]
    });

    dispatchCommand("addFreePoint");

    expect(useCadStore.getState().elements.at(-1)?.name).toBe("点5 2");
  });

  it("renames elements with a unique name", () => {
    useCadStore.getState().renameElement(sampleElements[1].id, "点A");

    expect(useCadStore.getState().elements[1].name).toBe("点A 2");
  });

  it("falls back to a default name when renaming with blank input", () => {
    useCadStore.getState().renameElement(sampleElements[0].id, " ");

    expect(useCadStore.getState().elements[0].name).toBe("点");
  });

  it("enters parameter edit mode with an initial parameter", () => {
    useCadStore.setState({ selectedParameterKey: null });

    dispatchCommand("enterParameterEditMode");

    expect(useCadStore.getState().isParameterEditMode).toBe(true);
    expect(useCadStore.getState().selectedParameterKey).toBe("name");
  });

  it("cycles parameters for the selected element", () => {
    dispatchCommand("enterParameterEditMode");

    dispatchCommand("selectNextParameter");
    expect(useCadStore.getState().selectedParameterKey).toBe("visible");

    dispatchCommand("selectPreviousParameter");
    expect(useCadStore.getState().selectedParameterKey).toBe("name");
  });

  it("selects parameters by direct key", () => {
    dispatchCommand("enterParameterEditMode");

    dispatchCommand("selectParameterByKey", { parameterDirectKey: "x" });

    expect(useCadStore.getState().selectedParameterKey).toBe("x");
  });

  it("increments numeric parameters using the parameter step", () => {
    useCadStore.setState({
      selectedParameterKey: "x",
      elements: [
        {
          ...sampleElements[0],
          numericParameterSteps: { x: 2.5 }
        },
        ...sampleElements.slice(1)
      ]
    });

    dispatchCommand("incrementSelectedParameter", { stepMultiplier: 10 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 75 });
  });

  it("changes numeric parameter steps through fixed levels", () => {
    useCadStore.setState({ selectedParameterKey: "x" });

    dispatchCommand("increaseSelectedParameterStep");
    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 10 });

    dispatchCommand("decreaseSelectedParameterStep");
    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 1 });

    dispatchCommand("decreaseSelectedParameterStep");
    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 0.1 });
  });

  it("clamps numeric parameter steps at the fixed level bounds", () => {
    useCadStore.setState({
      selectedParameterKey: "x",
      elements: [
        {
          ...sampleElements[0],
          numericParameterSteps: { x: 0.1, y: 100 }
        },
        ...sampleElements.slice(1)
      ]
    });

    dispatchCommand("decreaseSelectedParameterStep");
    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 0.1 });

    useCadStore.setState({ selectedParameterKey: "y" });
    dispatchCommand("increaseSelectedParameterStep");
    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ y: 100 });
  });

  it("moves custom numeric parameter steps to the nearest fixed level in the chosen direction", () => {
    useCadStore.setState({
      selectedParameterKey: "x",
      elements: [
        {
          ...sampleElements[0],
          numericParameterSteps: { x: 2.5 }
        },
        ...sampleElements.slice(1)
      ]
    });

    dispatchCommand("increaseSelectedParameterStep");
    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 10 });

    useCadStore.setState({
      selectedParameterKey: "x",
      elements: [
        {
          ...useCadStore.getState().elements[0],
          numericParameterSteps: { x: 2.5 }
        },
        ...useCadStore.getState().elements.slice(1)
      ]
    });
    dispatchCommand("decreaseSelectedParameterStep");
    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 1 });
  });

  it("does not change parameter steps for non-numeric parameters", () => {
    useCadStore.setState({ selectedParameterKey: "visible" });

    dispatchCommand("increaseSelectedParameterStep");
    dispatchCommand("decreaseSelectedParameterStep");

    expect(useCadStore.getState().elements[0].numericParameterSteps).toBeUndefined();
  });

  it("cycles reference parameters with arrow commands", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[3].id,
      selectedParameterKey: "startPointId"
    });

    dispatchCommand("incrementSelectedParameter");

    expect(useCadStore.getState().elements[3]).toMatchObject({ startPointId: "point-b" });
  });

  it("toggles boolean parameters", () => {
    useCadStore.setState({ selectedParameterKey: "visible" });

    dispatchCommand("toggleSelectedBooleanParameter");

    expect(useCadStore.getState().elements[0].visible).toBe(false);
  });

  it("undoes and redoes adding an element", () => {
    dispatchCommand("addFreePoint");
    const addedElement = useCadStore.getState().elements.at(-1);

    dispatchCommand("undo");
    expect(useCadStore.getState().elements).toHaveLength(sampleElements.length);
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[0].id);

    dispatchCommand("redo");
    expect(useCadStore.getState().elements.at(-1)).toEqual(addedElement);
    expect(useCadStore.getState().selectedElementId).toBe(addedElement?.id);
  });

  it("undoes and redoes deleting an element", () => {
    dispatchCommand("deleteSelectedElement");
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[1].id);

    dispatchCommand("undo");
    expect(useCadStore.getState().elements[0].id).toBe(sampleElements[0].id);
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[0].id);

    dispatchCommand("redo");
    expect(useCadStore.getState().elements.some((element) => element.id === sampleElements[0].id)).toBe(
      false
    );
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[1].id);
  });

  it("undoes and redoes element reordering", () => {
    dispatchCommand("moveSelectedElementDown");
    expect(useCadStore.getState().elements[1].id).toBe(sampleElements[0].id);

    dispatchCommand("undo");
    expect(useCadStore.getState().elements[0].id).toBe(sampleElements[0].id);

    dispatchCommand("redo");
    expect(useCadStore.getState().elements[1].id).toBe(sampleElements[0].id);
  });

  it("undoes and redoes parameter value changes", () => {
    useCadStore.setState({ selectedParameterKey: "x" });

    dispatchCommand("incrementSelectedParameter");
    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 51 });

    dispatchCommand("undo");
    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });

    dispatchCommand("redo");
    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 51 });
  });

  it("undoes and redoes visibility changes", () => {
    dispatchCommand("toggleSelectedElementVisibility");
    expect(useCadStore.getState().elements[0].visible).toBe(false);

    dispatchCommand("undo");
    expect(useCadStore.getState().elements[0].visible).toBe(true);

    dispatchCommand("redo");
    expect(useCadStore.getState().elements[0].visible).toBe(false);
  });

  it("clears redo history after a new document mutation", () => {
    dispatchCommand("addFreePoint");
    const addedElementId = useCadStore.getState().elements.at(-1)?.id;

    dispatchCommand("undo");
    dispatchCommand("toggleSelectedElementVisibility");
    dispatchCommand("redo");

    expect(useCadStore.getState().elements.some((element) => element.id === addedElementId)).toBe(false);
    expect(useCadStore.getState().elements[0].visible).toBe(false);
  });
});
