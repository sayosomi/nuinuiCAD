import { beforeEach, describe, expect, it } from "vitest";
import { dispatchCommand } from "./commands";
import { sampleElements } from "../sampleData";
import { useCadStore } from "../state/useCadStore";

describe("commands", () => {
  beforeEach(() => {
    useCadStore.setState({
      elements: sampleElements,
      selectedElementId: sampleElements[0].id,
      isParameterEditMode: false,
      selectedParameterKey: "name",
      showShortcutHelp: true
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
});
