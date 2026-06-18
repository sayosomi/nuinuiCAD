import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand, filterCommandPaletteItems } from "./commands";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, useCadStore } from "../state/useCadStore";

describe("commands", () => {
  beforeEach(() => {
    useCadStore.setState({
      elements: sampleElements,
      selectedElementId: sampleElements[0].id,
      isParameterEditMode: false,
      selectedParameterKey: "name",
      showElementInfoPanel: true,
      isDependencyJumpMode: false,
      selectedDependencyJumpIndex: 0,
      showShortcutHelp: true,
      showCommandPalette: false,
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
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

  it("keeps parameter edit mode and normalizes the parameter when selecting another element", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[2].id,
      isParameterEditMode: true,
      selectedParameterKey: "dx"
    });

    dispatchCommand("selectNextElement");

    expect(useCadStore.getState()).toMatchObject({
      selectedElementId: sampleElements[3].id,
      isParameterEditMode: true,
      selectedParameterKey: "name",
      past: []
    });
  });

  it("updates dependency jump mode when selecting another element", () => {
    useCadStore.setState({
      elements: [
        sampleElements[0],
        sampleElements[1],
        {
          id: "isolated-point",
          name: "孤立点",
          type: "freePoint",
          visible: true,
          enabled: true,
          x: 10,
          y: 20
        }
      ],
      selectedElementId: sampleElements[1].id,
      isDependencyJumpMode: true,
      selectedDependencyJumpIndex: 1,
      past: []
    });

    dispatchCommand("selectNextElement");

    expect(useCadStore.getState()).toMatchObject({
      selectedElementId: "isolated-point",
      isDependencyJumpMode: false,
      selectedDependencyJumpIndex: 0,
      past: []
    });
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

  it("enters element list mode and focuses the element list", () => {
    const focusElementList = vi.fn();
    useCadStore.setState({
      isParameterEditMode: true,
      isDependencyJumpMode: true,
      selectedDependencyJumpIndex: 1
    });

    dispatchCommand("enterElementListMode", { focusElementList });

    expect(useCadStore.getState()).toMatchObject({
      isParameterEditMode: false,
      isDependencyJumpMode: false,
      selectedDependencyJumpIndex: 0
    });
    expect(focusElementList).toHaveBeenCalledOnce();
  });

  it("zooms and resets the canvas viewport", () => {
    dispatchCommand("zoomInCanvas");
    expect(useCadStore.getState().canvasViewport.zoom).toBeCloseTo(1.1);

    dispatchCommand("zoomOutCanvas");
    expect(useCadStore.getState().canvasViewport.zoom).toBeCloseTo(1);

    useCadStore.getState().panCanvasViewport(12, -8);
    dispatchCommand("resetCanvasView");
    expect(useCadStore.getState().canvasViewport).toEqual(DEFAULT_CANVAS_VIEWPORT);
  });

  it("clamps canvas zoom at the configured bounds", () => {
    useCadStore.getState().setCanvasViewport({ panX: 0, panY: 0, zoom: MAX_CANVAS_ZOOM });
    dispatchCommand("zoomInCanvas");
    expect(useCadStore.getState().canvasViewport.zoom).toBe(MAX_CANVAS_ZOOM);

    useCadStore.getState().setCanvasViewport({ panX: 0, panY: 0, zoom: MIN_CANVAS_ZOOM });
    dispatchCommand("zoomOutCanvas");
    expect(useCadStore.getState().canvasViewport.zoom).toBe(MIN_CANVAS_ZOOM);
  });

  it("keeps canvas viewport changes out of document history", () => {
    useCadStore.getState().panCanvasViewport(10, 5);
    dispatchCommand("zoomInCanvas");

    expect(useCadStore.getState().past).toHaveLength(0);

    dispatchCommand("undo");
    expect(useCadStore.getState().canvasViewport).toMatchObject({
      panX: 10,
      panY: 5,
      zoom: expect.any(Number)
    });
  });

  it("toggles the element info panel and exits dependency jump mode when collapsed", () => {
    useCadStore.setState({ isDependencyJumpMode: true, selectedDependencyJumpIndex: 1 });

    dispatchCommand("toggleElementInfoPanel");

    expect(useCadStore.getState()).toMatchObject({
      showElementInfoPanel: false,
      isDependencyJumpMode: false
    });

    dispatchCommand("toggleElementInfoPanel");

    expect(useCadStore.getState().showElementInfoPanel).toBe(true);
  });

  it("enters dependency jump mode when the selected element has targets", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[1].id,
      isParameterEditMode: true,
      showElementInfoPanel: false
    });

    dispatchCommand("enterDependencyJumpMode");

    expect(useCadStore.getState()).toMatchObject({
      showElementInfoPanel: true,
      isParameterEditMode: false,
      isDependencyJumpMode: true,
      selectedDependencyJumpIndex: 0
    });
  });

  it("does not enter dependency jump mode without targets", () => {
    useCadStore.setState({
      elements: [sampleElements[0]],
      selectedElementId: sampleElements[0].id
    });

    dispatchCommand("enterDependencyJumpMode");

    expect(useCadStore.getState().isDependencyJumpMode).toBe(false);
  });

  it("cycles dependency jump targets", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[1].id,
      isDependencyJumpMode: true,
      selectedDependencyJumpIndex: 0
    });

    dispatchCommand("selectNextDependencyJumpTarget");
    expect(useCadStore.getState().selectedDependencyJumpIndex).toBe(1);

    dispatchCommand("selectPreviousDependencyJumpTarget");
    expect(useCadStore.getState().selectedDependencyJumpIndex).toBe(0);
  });

  it("jumps to the selected dependency target and keeps jump mode when possible", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[1].id,
      isDependencyJumpMode: true,
      selectedDependencyJumpIndex: 1
    });

    dispatchCommand("jumpToSelectedDependencyTarget");

    expect(useCadStore.getState()).toMatchObject({
      selectedElementId: sampleElements[2].id,
      isDependencyJumpMode: true,
      selectedDependencyJumpIndex: 0
    });
  });

  it("exits dependency jump mode", () => {
    useCadStore.setState({ isDependencyJumpMode: true, selectedDependencyJumpIndex: 1 });

    dispatchCommand("exitDependencyJumpMode");

    expect(useCadStore.getState()).toMatchObject({
      isDependencyJumpMode: false,
      selectedDependencyJumpIndex: 0
    });
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
