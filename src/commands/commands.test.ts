import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { dispatchCommand, filterCommandPaletteItems } from "./commands";
import { defaultDocumentPalette } from "../palette/palette";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, useCadStore } from "../state/useCadStore";
import type { CadElement } from "../types/geometry";

describe("commands", () => {
  beforeEach(() => {
    useCadStore.setState({
      elements: sampleElements,
      palette: defaultDocumentPalette(),
      printLayout: DEFAULT_PRINT_LAYOUT,
      evaluationLimitIndex: sampleElements.length,
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id],
      selectionAnchorElementId: sampleElements[0].id,
      isParameterEditMode: false,
      selectedParameterKey: "name",
      showElementInfoPanel: true,
      isDependencyJumpMode: false,
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activeExpressionInsertTarget: null,
      activePickCursor: null,
      selectedDependencyJumpIndex: 0,
      elementSearchQuery: "",
      elementSearchCursorId: null,
      elementSearchPickableOnly: false,
      showCanvasElementNames: true,
      showCanvasPoints: true,
      showElementListColorAccents: false,
      showShortcutHelp: true,
      showPaletteSettings: false,
      showSelectionColorPicker: false,
      showCommandPalette: false,
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
      past: [],
      future: [],
      currentFilePath: null,
      dirtySinceSave: false
    });
  });

  it("selects next and previous elements", () => {
    dispatchCommand("selectNextElement");
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[1].id);
    expect(useCadStore.getState().selectedElementIds).toEqual([sampleElements[1].id]);

    dispatchCommand("selectPreviousElement");
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[0].id);
  });

  it("selects all elements from a command", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[2].id,
      selectedElementIds: [sampleElements[2].id],
      selectionAnchorElementId: sampleElements[2].id
    });

    dispatchCommand("selectAllElements");

    const state = useCadStore.getState();
    expect(state.selectedElementId).toBe(sampleElements[2].id);
    expect(state.selectedElementIds).toEqual(sampleElements.map((element) => element.id));
    expect(state.selectionAnchorElementId).toBe(sampleElements[2].id);
    expect(state.past).toHaveLength(0);
    expect(state.dirtySinceSave).toBe(false);
  });

  it("toggles canvas display helpers", () => {
    dispatchCommand("toggleCanvasElementNames");
    expect(useCadStore.getState().showCanvasElementNames).toBe(false);

    dispatchCommand("toggleCanvasPoints");
    expect(useCadStore.getState().showCanvasPoints).toBe(false);
  });

  it("toggles element list color accents", () => {
    dispatchCommand("toggleElementListColorAccents");
    expect(useCadStore.getState().showElementListColorAccents).toBe(true);

    dispatchCommand("toggleElementListColorAccents");
    expect(useCadStore.getState().showElementListColorAccents).toBe(false);
  });

  it("applies a display color to the color-capable current selection only", () => {
    const variable: CadElement = {
      id: "variable",
      name: "変数",
      type: "variable",
      visible: true,
      enabled: true,
      scope: "global",
      valueMode: "expression",
      expression: 0,
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point: { mode: "reference", pointId: "point-a" },
      lineId: "line-ab"
    };
    useCadStore.setState({
      elements: [...sampleElements, variable],
      selectedElementId: sampleElements[1].id,
      selectedElementIds: [sampleElements[0].id, sampleElements[1].id, variable.id],
      selectionAnchorElementId: sampleElements[0].id
    });

    dispatchCommand("applyDisplayColorToSelection", { colorId: "cut-red" });

    const state = useCadStore.getState();
    expect(state.elements.find((element) => element.id === sampleElements[0].id)?.colorId).toBe(
      "cut-red"
    );
    expect(state.elements.find((element) => element.id === sampleElements[1].id)?.colorId).toBe(
      "cut-red"
    );
    expect(state.elements.find((element) => element.id === sampleElements[2].id)?.colorId).toBeUndefined();
    expect(state.elements.find((element) => element.id === variable.id)?.colorId).toBeUndefined();
    expect(state.selectedElementIds).toEqual([sampleElements[0].id, sampleElements[1].id, variable.id]);
    expect(state.past).toHaveLength(1);
  });

  it("resets display colors to auto across the current selection", () => {
    useCadStore.setState({
      elements: [
        { ...sampleElements[0], colorId: "cut-red" },
        { ...sampleElements[1], colorId: "guide-blue" },
        ...sampleElements.slice(2)
      ],
      selectedElementId: sampleElements[1].id,
      selectedElementIds: [sampleElements[0].id, sampleElements[1].id],
      selectionAnchorElementId: sampleElements[0].id
    });

    dispatchCommand("applyDisplayColorToSelection");

    const state = useCadStore.getState();
    expect(state.elements[0].colorId).toBeUndefined();
    expect(state.elements[1].colorId).toBeUndefined();
    expect(state.selectedElementId).toBe(sampleElements[1].id);
    expect(state.selectedElementIds).toEqual([sampleElements[0].id, sampleElements[1].id]);
  });

  it("clears deleted palette colors from multi-selected elements without collapsing selection", () => {
    useCadStore.setState({
      elements: [
        { ...sampleElements[0], colorId: "cut-red" },
        { ...sampleElements[1], colorId: "cut-red" },
        { ...sampleElements[2], colorId: "guide-blue" },
        ...sampleElements.slice(3)
      ],
      selectedElementId: sampleElements[1].id,
      selectedElementIds: [sampleElements[0].id, sampleElements[1].id, sampleElements[2].id],
      selectionAnchorElementId: sampleElements[0].id
    });

    useCadStore.getState().deletePaletteColor("cut-red");

    const state = useCadStore.getState();
    expect(state.elements[0].colorId).toBeUndefined();
    expect(state.elements[1].colorId).toBeUndefined();
    expect(state.elements[2].colorId).toBe("guide-blue");
    expect(state.selectedElementId).toBe(sampleElements[1].id);
    expect(state.selectedElementIds).toEqual([
      sampleElements[0].id,
      sampleElements[1].id,
      sampleElements[2].id
    ]);
  });

  it("selects ranges and toggles individual elements", () => {
    dispatchCommand("selectElement", {
      elementId: sampleElements[2].id,
      selectionMode: "range"
    });

    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[2].id);
    expect(useCadStore.getState().selectedElementIds).toEqual([
      sampleElements[0].id,
      sampleElements[1].id,
      sampleElements[2].id
    ]);

    dispatchCommand("selectElement", {
      elementId: sampleElements[1].id,
      selectionMode: "toggle"
    });

    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[0].id);
    expect(useCadStore.getState().selectedElementIds).toEqual([
      sampleElements[0].id,
      sampleElements[2].id
    ]);
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

  it("moves selected elements together while preserving their relative order", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[2].id,
      selectedElementIds: [sampleElements[1].id, sampleElements[2].id],
      selectionAnchorElementId: sampleElements[1].id
    });

    dispatchCommand("moveSelectedElementDown");
    expect(useCadStore.getState().elements.map((element) => element.id)).toEqual([
      sampleElements[0].id,
      sampleElements[3].id,
      sampleElements[1].id,
      sampleElements[2].id,
      sampleElements[4].id,
      sampleElements[5].id
    ]);
    expect(useCadStore.getState().selectedElementIds).toEqual([
      sampleElements[1].id,
      sampleElements[2].id
    ]);

    dispatchCommand("moveSelectedElementUp");
    expect(useCadStore.getState().elements.map((element) => element.id)).toEqual(
      sampleElements.map((element) => element.id)
    );
  });

  it("duplicates selected elements and selects the copies", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["point-a", "line-ab"],
      selectionAnchorElementId: "point-a"
    });

    dispatchCommand("duplicateSelectedElement");

    const state = useCadStore.getState();
    const pointCopy = state.elements[4];
    const lineCopy = state.elements[5];

    expect(state.elements.map((element) => element.id).slice(0, 6)).toEqual([
      "point-a",
      "point-b",
      "point-c",
      "line-ab",
      pointCopy.id,
      lineCopy.id
    ]);
    expect(pointCopy).toMatchObject({ type: "freePoint", name: "点A コピー" });
    expect(lineCopy).toMatchObject({
      type: "line",
      name: "直線AB コピー",
      startPoint: { mode: "reference", pointId: pointCopy.id },
      endPoint: { mode: "reference", pointId: "point-b" }
    });
    expect(state.selectedElementIds).toEqual([pointCopy.id, lineCopy.id]);
    expect(state.selectedElementId).toBe(lineCopy.id);
    expect(state.past).toHaveLength(1);
  });

  it("moves an element to a requested insertion index", () => {
    dispatchCommand("moveElementToInsertionIndex", {
      elementId: sampleElements[0].id,
      insertionIndex: 3
    });

    expect(useCadStore.getState().elements.map((element) => element.id).slice(0, 4)).toEqual([
      sampleElements[1].id,
      sampleElements[2].id,
      sampleElements[0].id,
      sampleElements[3].id
    ]);
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[0].id);
  });

  it("moves an element to the start and end insertion indexes", () => {
    dispatchCommand("moveElementToInsertionIndex", {
      elementId: sampleElements[0].id,
      insertionIndex: sampleElements.length
    });
    expect(useCadStore.getState().elements.at(-1)?.id).toBe(sampleElements[0].id);

    dispatchCommand("moveElementToInsertionIndex", {
      elementId: sampleElements[0].id,
      insertionIndex: 0
    });
    expect(useCadStore.getState().elements[0].id).toBe(sampleElements[0].id);
  });

  it("adds new elements immediately above the evaluation divider", () => {
    useCadStore.setState({
      evaluationLimitIndex: 2,
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id]
    });

    dispatchCommand("addFreePoint");

    const state = useCadStore.getState();
    expect(state.elements[2]).toMatchObject({ type: "freePoint" });
    expect(state.evaluationLimitIndex).toBe(3);
    expect(state.selectedElementId).toBe(state.elements[2].id);
  });

  it("moves the evaluation divider by command", () => {
    useCadStore.setState({ evaluationLimitIndex: 2 });

    dispatchCommand("moveEvaluationDividerDown");
    expect(useCadStore.getState().evaluationLimitIndex).toBe(3);

    dispatchCommand("moveEvaluationDividerUp");
    expect(useCadStore.getState().evaluationLimitIndex).toBe(2);

    dispatchCommand("setEvaluationLimitIndex", { evaluationLimitIndex: 999 });
    expect(useCadStore.getState().evaluationLimitIndex).toBe(sampleElements.length);
  });

  it("groups selected elements and ungroups the selected group without changing child order", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[2].id,
      selectedElementIds: [sampleElements[1].id, sampleElements[2].id],
      selectionAnchorElementId: sampleElements[1].id
    });

    dispatchCommand("groupSelectedElements");

    const grouped = useCadStore.getState().elements;
    const group = grouped[1];
    expect(group).toMatchObject({ type: "group", expanded: true });
    expect(grouped[2]).toMatchObject({ id: sampleElements[1].id, parentGroupId: group.id });
    expect(grouped[3]).toMatchObject({ id: sampleElements[2].id, parentGroupId: group.id });

    dispatchCommand("selectElement", { elementId: group.id });
    dispatchCommand("ungroupSelectedGroup");

    const ungrouped = useCadStore.getState().elements;
    expect(ungrouped.map((element) => element.id)).toEqual(sampleElements.map((element) => element.id));
    expect(ungrouped[1].parentGroupId).toBeUndefined();
    expect(ungrouped[2].parentGroupId).toBeUndefined();
  });

  it("adds a conditional group above the evaluation divider", () => {
    useCadStore.setState({
      evaluationLimitIndex: 2,
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id]
    });

    dispatchCommand("addConditionalGroup");

    const state = useCadStore.getState();
    expect(state.elements[2]).toMatchObject({
      type: "conditionalGroup",
      condition: 1,
      expanded: true,
      elseExpanded: true
    });
    expect(state.evaluationLimitIndex).toBe(3);
    expect(state.selectedElementId).toBe(state.elements[2].id);
    expect(state.selectedParameterKey).toBe("name");
  });

  it("wraps selected elements in a conditional group and assigns them to then", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[2].id,
      selectedElementIds: [sampleElements[1].id, sampleElements[2].id],
      selectionAnchorElementId: sampleElements[1].id
    });

    dispatchCommand("wrapSelectedElementsInConditionalGroup");

    const state = useCadStore.getState();
    const group = state.elements[1];
    expect(group).toMatchObject({ type: "conditionalGroup", condition: 1 });
    expect(state.elements[2]).toMatchObject({
      id: sampleElements[1].id,
      parentGroupId: group.id,
      conditionalBranch: "then"
    });
    expect(state.elements[3]).toMatchObject({
      id: sampleElements[2].id,
      parentGroupId: group.id,
      conditionalBranch: "then"
    });
  });

  it("adds a for group above the evaluation divider", () => {
    useCadStore.setState({
      evaluationLimitIndex: 2,
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id]
    });

    dispatchCommand("addForGroup");

    const state = useCadStore.getState();
    expect(state.elements[2]).toMatchObject({
      type: "forGroup",
      variableName: "i",
      start: 0,
      count: 3,
      step: 1,
      expanded: true,
      showGenerated: false
    });
    expect(state.evaluationLimitIndex).toBe(3);
    expect(state.selectedElementId).toBe(state.elements[2].id);
  });

  it("wraps selected elements in a for group", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[2].id,
      selectedElementIds: [sampleElements[1].id, sampleElements[2].id],
      selectionAnchorElementId: sampleElements[1].id
    });

    dispatchCommand("wrapSelectedElementsInForGroup");

    const state = useCadStore.getState();
    const group = state.elements[1];
    expect(group).toMatchObject({ type: "forGroup", count: 3 });
    expect(state.elements[2]).toMatchObject({
      id: sampleElements[1].id,
      parentGroupId: group.id
    });
    expect(state.elements[3]).toMatchObject({
      id: sampleElements[2].id,
      parentGroupId: group.id
    });
  });

  it("toggles generated preview on the selected for group", () => {
    useCadStore.setState({
      elements: [
        sampleElements[0],
        {
          id: "loop",
          name: "プリーツ繰り返し",
          type: "forGroup",
          visible: true,
          enabled: true,
          variableName: "i",
          start: 0,
          count: 3,
          step: 1,
          expanded: true,
          showGenerated: false
        }
      ],
      selectedElementId: "loop",
      selectedElementIds: ["loop"],
      selectionAnchorElementId: "loop"
    });

    dispatchCommand("toggleSelectedForGroupGenerated");

    expect(useCadStore.getState().elements[1]).toMatchObject({ showGenerated: true });
  });

  it("marks selected conditional children as else branch", () => {
    useCadStore.setState({
      elements: [
        sampleElements[0],
        {
          id: "if",
          name: "寸法分岐",
          type: "conditionalGroup",
          visible: true,
          enabled: true,
          condition: 1,
          expanded: true,
          elseExpanded: false
        },
        { ...sampleElements[1], parentGroupId: "if", conditionalBranch: "then" }
      ],
      selectedElementId: sampleElements[1].id,
      selectedElementIds: [sampleElements[1].id],
      selectionAnchorElementId: sampleElements[1].id
    });

    dispatchCommand("addElseBranchToSelectedConditionalGroup");

    const state = useCadStore.getState();
    expect(state.elements[1]).toMatchObject({ type: "conditionalGroup", elseExpanded: true });
    expect(state.elements[2]).toMatchObject({ conditionalBranch: "else" });
  });

  it("moves a selected group together with its children", () => {
    useCadStore.setState({
      elements: [
        sampleElements[0],
        {
          id: "group-1",
          name: "前身頃",
          type: "group",
          visible: true,
          enabled: true,
          expanded: true
        },
        { ...sampleElements[1], parentGroupId: "group-1" },
        { ...sampleElements[2], parentGroupId: "group-1" },
        sampleElements[3]
      ],
      selectedElementId: "group-1",
      selectedElementIds: ["group-1"],
      selectionAnchorElementId: "group-1"
    });

    dispatchCommand("moveSelectedElementDown");

    expect(useCadStore.getState().elements.map((element) => element.id)).toEqual([
      sampleElements[0].id,
      sampleElements[3].id,
      "group-1",
      sampleElements[1].id,
      sampleElements[2].id
    ]);
  });

  it("does not add history for no-op insertion moves", () => {
    dispatchCommand("moveElementToInsertionIndex", {
      elementId: sampleElements[0].id,
      insertionIndex: 1
    });

    expect(useCadStore.getState().elements[0].id).toBe(sampleElements[0].id);
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("moves a free point by a world-space delta", () => {
    dispatchCommand("movePointElementByDelta", {
      elementId: sampleElements[0].id,
      dx: 12,
      dy: -5
    });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 62, y: -55 });
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("moves an offset point by updating dx and dy without changing its reference", () => {
    dispatchCommand("movePointElementByDelta", {
      elementId: sampleElements[1].id,
      dx: 12,
      dy: -5
    });

    expect(useCadStore.getState().elements[1]).toMatchObject({
      fromPointId: "point-a",
      dx: 112,
      dy: -5
    });
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("moves a polar offset point by updating angle and distance", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          visible: true,
          enabled: true,
          fromPointId: "point-a",
          angleDeg: 0,
          distance: 30
        }
      ]
    });

    dispatchCommand("movePointElementByDelta", {
      elementId: "polar-point",
      dx: 0,
      dy: -10
    });

    const moved = useCadStore.getState().elements.at(-1);
    expect(moved).toMatchObject({ type: "polarOffsetPoint" });
    if (moved?.type !== "polarOffsetPoint") throw new Error("Expected a polar offset point");
    expect(moved.angleDeg).toBeCloseTo(341.565051177078);
    expect(moved.distance).toBeCloseTo(31.622776601683793);
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("locks polar offset point angle while dragging", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          visible: true,
          enabled: true,
          fromPointId: "point-a",
          angleDeg: 0,
          distance: 30
        }
      ]
    });

    dispatchCommand("movePointElementByDelta", {
      elementId: "polar-point",
      dx: 0,
      dy: -10,
      angleLocked: true
    });

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      angleDeg: 0,
      distance: 30
    });
  });

  it("locks polar offset point distance while dragging", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          visible: true,
          enabled: true,
          fromPointId: "point-a",
          angleDeg: 0,
          distance: 30
        }
      ]
    });

    dispatchCommand("movePointElementByDelta", {
      elementId: "polar-point",
      dx: 0,
      dy: -10,
      distanceLocked: true
    });

    const moved = useCadStore.getState().elements.at(-1);
    expect(moved).toMatchObject({ type: "polarOffsetPoint" });
    if (moved?.type !== "polarOffsetPoint") throw new Error("Expected a polar offset point");
    expect(moved.angleDeg).toBeCloseTo(341.565051177078);
    expect(moved.distance).toBe(30);
  });

  it("does not move a polar offset point when angle and distance are both locked", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          visible: true,
          enabled: true,
          fromPointId: "point-a",
          angleDeg: 0,
          distance: 30
        }
      ]
    });

    dispatchCommand("movePointElementByDelta", {
      elementId: "polar-point",
      dx: 0,
      dy: -10,
      angleLocked: true,
      distanceLocked: true
    });

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      angleDeg: 0,
      distance: 30
    });
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("does not move lines or missing point IDs", () => {
    dispatchCommand("movePointElementByDelta", {
      elementId: sampleElements[3].id,
      dx: 12,
      dy: -5
    });
    dispatchCommand("movePointElementByDelta", {
      elementId: "missing-point",
      dx: 12,
      dy: -5
    });

    expect(useCadStore.getState().elements).toBe(sampleElements);
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("does not add history for zero-distance point movement", () => {
    dispatchCommand("movePointElementByDelta", {
      elementId: sampleElements[0].id,
      dx: 0,
      dy: 0
    });

    expect(useCadStore.getState().elements).toBe(sampleElements);
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("previews point movement without history and commits one undo step from the drag start", () => {
    const state = useCadStore.getState();
    const snapshot = {
      elements: state.elements,
      palette: state.palette,
      printLayout: state.printLayout,
      evaluationLimitIndex: state.evaluationLimitIndex,
      selectedElementId: state.selectedElementId,
      selectedElementIds: state.selectedElementIds,
      selectionAnchorElementId: state.selectionAnchorElementId,
      isParameterEditMode: state.isParameterEditMode,
      selectedParameterKey: state.selectedParameterKey
    };

    dispatchCommand("movePointElementByDelta", {
      elementId: sampleElements[0].id,
      dx: 5,
      dy: 5,
      commitMode: "preview",
      baseElements: snapshot.elements
    });
    dispatchCommand("movePointElementByDelta", {
      elementId: sampleElements[0].id,
      dx: 15,
      dy: 10,
      commitMode: "preview",
      baseElements: snapshot.elements
    });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 65, y: -40 });
    expect(useCadStore.getState().past).toHaveLength(0);

    dispatchCommand("movePointElementByDelta", {
      elementId: sampleElements[0].id,
      dx: 15,
      dy: 10,
      commitMode: "commit",
      baseElements: snapshot.elements,
      historySnapshot: snapshot
    });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 65, y: -40 });
    expect(useCadStore.getState().past).toHaveLength(1);

    dispatchCommand("undo");
    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50, y: -50 });
  });

  it("moves a Bezier start handle by updating angle and length", () => {
    dispatchCommand("moveBezierHandleByDelta", {
      elementId: "curve-ac",
      bezierHandleRole: "start",
      dx: 0,
      dy: -45
    });

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.startHandleAngleDeg).toBeCloseTo(315);
    expect(curve.startHandleLength).toBeCloseTo(63.63961030678928);
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("locks Bezier handle angle while dragging", () => {
    dispatchCommand("moveBezierHandleByDelta", {
      elementId: "curve-ac",
      bezierHandleRole: "start",
      dx: 10,
      dy: -45,
      angleLocked: true
    });

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.startHandleAngleDeg).toBe(0);
    expect(curve.startHandleLength).toBeCloseTo(55);
  });

  it("updates a shared Bezier numeric variable when dragging a referenced handle length", () => {
    useCadStore.setState({
      elements: sampleElements.map((element) =>
        element.id === "curve-ac" && element.type === "bezierCurve"
          ? {
              ...element,
              numericVariables: [{ id: "shared", name: "共通長", value: 45 }],
              startHandleLength: { kind: "expression", expression: "@shared" },
              endHandleLength: { kind: "expression", expression: "@shared" }
            }
          : element
      )
    });

    dispatchCommand("moveBezierHandleByDelta", {
      elementId: "curve-ac",
      bezierHandleRole: "start",
      dx: 10,
      dy: -45,
      angleLocked: true
    });

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.numericVariables?.[0].value).toBeCloseTo(55);
    expect(curve.startHandleLength).toEqual({ kind: "expression", expression: "@shared" });
    expect(curve.endHandleLength).toEqual({ kind: "expression", expression: "@shared" });
  });

  it("adds Bezier numeric variables with a short ASCII default name", () => {
    useCadStore.setState({
      selectedElementId: "curve-ac",
      selectedElementIds: ["curve-ac"]
    });

    dispatchCommand("addBezierNumericVariable");

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.numericVariables?.[0].name).toBe("v1");
  });

  it("adds numeric variables to non-curve numeric elements", () => {
    useCadStore.setState({
      selectedElementId: "point-b",
      selectedElementIds: ["point-b"]
    });

    dispatchCommand("addNumericVariable");

    const point = useCadStore.getState().elements.find((element) => element.id === "point-b");
    expect(point).toMatchObject({ type: "offsetPoint" });
    expect(point?.numericVariables?.[0]).toMatchObject({ name: "v1", value: 30 });
    expect(useCadStore.getState().selectedParameterKey).toBe(`variable:${point?.numericVariables?.[0].id}:value`);
  });

  it("adds numeric variables to line elements for coordinate expressions", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"]
    });

    dispatchCommand("addNumericVariable");

    const line = useCadStore.getState().elements.find((element) => element.id === "line-ab");
    expect(line).toMatchObject({ type: "line" });
    expect(line?.numericVariables?.[0]).toMatchObject({ name: "v1", value: 30 });
  });

  it("locks Bezier handle distance while dragging", () => {
    dispatchCommand("moveBezierHandleByDelta", {
      elementId: "curve-ac",
      bezierHandleRole: "start",
      dx: 0,
      dy: -45,
      distanceLocked: true
    });

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.startHandleAngleDeg).toBeCloseTo(315);
    expect(curve.startHandleLength).toBe(45);
  });

  it("updates a Bezier end handle using the incoming handle angle convention", () => {
    dispatchCommand("moveBezierHandleByDelta", {
      elementId: "curve-ac",
      bezierHandleRole: "end",
      dx: 35,
      dy: 0
    });

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.endHandleAngleDeg).toBeCloseTo(135);
    expect(curve.endHandleLength).toBeCloseTo(49.49747468305833);
  });

  it("moves a Bezier intermediate incoming handle", () => {
    useCadStore.setState({
      elements: sampleElements.map((element) =>
        element.id === "curve-ac" && element.type === "bezierCurve"
          ? {
              ...element,
              intermediatePoints: [
                {
                  id: "mid-b",
                  point: { mode: "reference", pointId: "point-b" },
                  handleAngleDeg: 0,
                  incomingHandleLength: 10,
                  outgoingHandleLength: 20
                }
              ]
            }
          : element
      )
    });

    dispatchCommand("moveBezierHandleByDelta", {
      elementId: "curve-ac",
      bezierHandleRole: "intermediateIncoming",
      intermediatePointId: "mid-b",
      dx: 0,
      dy: -10
    });

    const curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.intermediatePoints[0].handleAngleDeg).toBeCloseTo(45);
    expect(curve.intermediatePoints[0].incomingHandleLength).toBeCloseTo(14.142135623730951);
    expect(curve.intermediatePoints[0].outgoingHandleLength).toBe(20);
  });

  it("previews Bezier handle movement without history and commits one undo step", () => {
    const state = useCadStore.getState();
    const snapshot = {
      elements: state.elements,
      palette: state.palette,
      printLayout: state.printLayout,
      evaluationLimitIndex: state.evaluationLimitIndex,
      selectedElementId: state.selectedElementId,
      selectedElementIds: state.selectedElementIds,
      selectionAnchorElementId: state.selectionAnchorElementId,
      isParameterEditMode: state.isParameterEditMode,
      selectedParameterKey: state.selectedParameterKey
    };

    dispatchCommand("moveBezierHandleByDelta", {
      elementId: "curve-ac",
      bezierHandleRole: "start",
      dx: 10,
      dy: -10,
      commitMode: "preview",
      baseElements: snapshot.elements
    });
    dispatchCommand("moveBezierHandleByDelta", {
      elementId: "curve-ac",
      bezierHandleRole: "start",
      dx: 20,
      dy: -20,
      commitMode: "preview",
      baseElements: snapshot.elements
    });

    let curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.startHandleLength).toBeCloseTo(68.00735254367721);
    expect(useCadStore.getState().past).toHaveLength(0);

    dispatchCommand("moveBezierHandleByDelta", {
      elementId: "curve-ac",
      bezierHandleRole: "start",
      dx: 20,
      dy: -20,
      commitMode: "commit",
      baseElements: snapshot.elements,
      historySnapshot: snapshot
    });

    expect(useCadStore.getState().past).toHaveLength(1);
    dispatchCommand("undo");
    curve = useCadStore.getState().elements.find((element) => element.id === "curve-ac");
    expect(curve).toMatchObject({ type: "bezierCurve", startHandleAngleDeg: 0, startHandleLength: 45 });
  });

  it("toggles selected element visibility", () => {
    dispatchCommand("toggleSelectedElementVisibility");
    expect(useCadStore.getState().elements[0].visible).toBe(false);
  });

  it("toggles selected element enabled state", () => {
    dispatchCommand("toggleSelectedElementEnabled");
    expect(useCadStore.getState().elements[0].enabled).toBe(false);
  });

  it("toggles visibility for a specified element only", () => {
    dispatchCommand("toggleElementVisibility", { elementId: sampleElements[1].id });

    expect(useCadStore.getState().elements[0].visible).toBe(true);
    expect(useCadStore.getState().elements[1].visible).toBe(false);
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[0].id);
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("toggles enabled state for a specified element only", () => {
    dispatchCommand("toggleElementEnabled", { elementId: sampleElements[1].id });

    expect(useCadStore.getState().elements[0].enabled).toBe(true);
    expect(useCadStore.getState().elements[1].enabled).toBe(false);
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[0].id);
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("does not add history when toggling state for a missing element", () => {
    dispatchCommand("toggleElementVisibility", { elementId: "missing-element" });
    dispatchCommand("toggleElementEnabled", { elementId: "missing-element" });

    expect(useCadStore.getState().elements).toBe(sampleElements);
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("toggles visibility and enabled state for all selected elements", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[2].id,
      selectedElementIds: [sampleElements[0].id, sampleElements[2].id],
      selectionAnchorElementId: sampleElements[0].id,
      elements: [
        { ...sampleElements[0], visible: true, enabled: true },
        sampleElements[1],
        { ...sampleElements[2], visible: false, enabled: false },
        ...sampleElements.slice(3)
      ]
    });

    dispatchCommand("toggleSelectedElementVisibility");
    dispatchCommand("toggleSelectedElementEnabled");

    expect(useCadStore.getState().elements[0]).toMatchObject({ visible: false, enabled: false });
    expect(useCadStore.getState().elements[1]).toMatchObject({ visible: true, enabled: true });
    expect(useCadStore.getState().elements[2]).toMatchObject({ visible: true, enabled: true });
  });

  it("deletes the selected element", () => {
    dispatchCommand("deleteSelectedElement");

    expect(useCadStore.getState().elements.some((element) => element.id === sampleElements[0].id)).toBe(
      false
    );
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[1].id);
  });

  it("deletes all selected elements", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[2].id,
      selectedElementIds: [sampleElements[1].id, sampleElements[2].id],
      selectionAnchorElementId: sampleElements[1].id
    });

    dispatchCommand("deleteSelectedElement");

    expect(useCadStore.getState().elements.map((element) => element.id)).toEqual([
      sampleElements[0].id,
      sampleElements[3].id,
      sampleElements[4].id,
      sampleElements[5].id
    ]);
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[3].id);
    expect(useCadStore.getState().selectedElementIds).toEqual([sampleElements[3].id]);
  });

  it("adds elements and selects them", () => {
    dispatchCommand("addFreePoint");

    const state = useCadStore.getState();
    expect(state.elements).toHaveLength(sampleElements.length + 1);
    expect(state.elements.at(-1)?.type).toBe("freePoint");
    expect(state.selectedElementId).toBe(state.elements.at(-1)?.id);
  });

  it("adds a Bezier curve and selects it", () => {
    dispatchCommand("addBezierCurve");

    const state = useCadStore.getState();
    const curve = state.elements.at(-1);
    expect(curve).toMatchObject({
      type: "bezierCurve",
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    });
    expect(state.selectedElementId).toBe(curve?.id);
    expect(state.past).toHaveLength(1);
  });

  it("adds an offset line from selected line-like elements", () => {
    useCadStore.setState({
      selectedElementId: "line-bc",
      selectedElementIds: ["line-ab", "line-bc"],
      selectionAnchorElementId: "line-ab"
    });

    dispatchCommand("addOffsetLine");

    const state = useCadStore.getState();
    const offsetLine = state.elements.at(-1);
    expect(offsetLine).toMatchObject({
      type: "offsetLine",
      baseLineIds: ["line-ab", "line-bc"],
      offset: 10,
      side: "right",
      closed: false
    });
    expect(state.selectedElementId).toBe(offsetLine?.id);
    expect(state.past).toHaveLength(1);
  });

  it("adds a copy line from selected line-like elements and points", () => {
    useCadStore.setState({
      selectedElementId: "line-bc",
      selectedElementIds: ["point-a", "point-b", "line-ab", "line-bc"],
      selectionAnchorElementId: "point-a"
    });

    dispatchCommand("addCopyLine");

    const state = useCadStore.getState();
    const copyLine = state.elements.at(-1);
    expect(copyLine).toMatchObject({
      type: "copyLine",
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      angleDeg: 0,
      mirrorX: false,
      baseLineIds: ["line-ab", "line-bc"]
    });
    expect(state.selectedElementId).toBe(copyLine?.id);
    expect(state.past).toHaveLength(1);
  });

  it("adds a move modification from selected line-like elements and points", () => {
    useCadStore.setState({
      selectedElementId: "line-bc",
      selectedElementIds: ["point-a", "point-b", "line-ab", "line-bc"],
      selectionAnchorElementId: "point-a"
    });

    dispatchCommand("addMove");

    const state = useCadStore.getState();
    const move = state.elements.at(-1);
    expect(move).toMatchObject({
      type: "move",
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      angleDeg: 0,
      mirrorX: false,
      baseLineIds: ["line-ab", "line-bc"]
    });
    expect(state.selectedElementId).toBe(move?.id);
    expect(state.past).toHaveLength(1);
  });

  it("adds a symmetric copy line from selected line-like elements and points", () => {
    useCadStore.setState({
      selectedElementId: "line-bc",
      selectedElementIds: ["point-a", "point-b", "line-ab", "line-bc"],
      selectionAnchorElementId: "point-a"
    });

    dispatchCommand("addSymmetricCopyLine");

    const state = useCadStore.getState();
    const symmetricCopyLine = state.elements.at(-1);
    expect(symmetricCopyLine).toMatchObject({
      type: "symmetricCopyLine",
      axisPoint1: { mode: "reference", pointId: "point-a" },
      axisPoint2: { mode: "reference", pointId: "point-b" },
      baseLineIds: ["line-ab", "line-bc"]
    });
    expect(state.selectedElementId).toBe(symmetricCopyLine?.id);
    expect(state.past).toHaveLength(1);
  });

  it("adds a symmetric move modification from selected line-like elements and points", () => {
    useCadStore.setState({
      selectedElementId: "line-bc",
      selectedElementIds: ["point-a", "point-b", "line-ab", "line-bc"],
      selectionAnchorElementId: "point-a"
    });

    dispatchCommand("addSymmetricMove");

    const state = useCadStore.getState();
    const symmetricMove = state.elements.at(-1);
    expect(symmetricMove).toMatchObject({
      type: "symmetricMove",
      axisPoint1: { mode: "reference", pointId: "point-a" },
      axisPoint2: { mode: "reference", pointId: "point-b" },
      baseLineIds: ["line-ab", "line-bc"]
    });
    expect(state.selectedElementId).toBe(symmetricMove?.id);
    expect(state.past).toHaveLength(1);
  });

  it("adds a split line from the selected line and point", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["point-b", "line-ab"],
      selectionAnchorElementId: "point-b"
    });

    dispatchCommand("addSplitLine");

    const state = useCadStore.getState();
    const splitLine = state.elements.at(-1);
    expect(splitLine).toMatchObject({
      type: "splitLine",
      baseLineId: "line-ab",
      splitPoint: { mode: "reference", pointId: "point-b" }
    });
    expect(state.selectedElementId).toBe(splitLine?.id);
    expect(state.past).toHaveLength(1);
  });

  it("adds an arc line and selects it", () => {
    dispatchCommand("addArcLine");

    const state = useCadStore.getState();
    const arc = state.elements.at(-1);
    expect(arc).toMatchObject({
      type: "arcLine",
      centerPoint: { mode: "reference", pointId: "point-a" },
      radius: 30,
      startAngleDeg: 0,
      endAngleDeg: 90
    });
    expect(state.selectedElementId).toBe(arc?.id);
    expect(state.past).toHaveLength(1);
  });

  it("adds a three-point arc line and selects it", () => {
    dispatchCommand("addThreePointArcLine");

    const state = useCadStore.getState();
    const arc = state.elements.at(-1);
    expect(arc).toMatchObject({
      type: "threePointArcLine",
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point3: { mode: "reference", pointId: "point-c" },
      startAngleDeg: 0,
      endAngleDeg: 90
    });
    expect(state.selectedElementId).toBe(arc?.id);
    expect(state.past).toHaveLength(1);
  });


  it("adds and deletes a Bezier intermediate point", () => {
    dispatchCommand("addBezierCurve");
    const curveId = useCadStore.getState().selectedElementId;

    dispatchCommand("addBezierIntermediatePoint");
    let curve = useCadStore.getState().elements.find((element) => element.id === curveId);
    expect(curve).toMatchObject({ type: "bezierCurve" });
    if (curve?.type !== "bezierCurve") throw new Error("Expected a Bezier curve");
    expect(curve.intermediatePoints).toHaveLength(1);
    expect(useCadStore.getState().selectedParameterKey).toBe(
      `intermediate:${curve.intermediatePoints[0].id}:point`
    );

    dispatchCommand("deleteBezierIntermediatePoint", {
      intermediatePointId: curve.intermediatePoints[0].id
    });
    curve = useCadStore.getState().elements.find((element) => element.id === curveId);
    expect(curve).toMatchObject({ type: "bezierCurve", intermediatePoints: [] });
  });

  it("opens and closes the command palette", () => {
    dispatchCommand("openCommandPalette");
    expect(useCadStore.getState().showCommandPalette).toBe(true);

    dispatchCommand("closeCommandPalette");
    expect(useCadStore.getState().showCommandPalette).toBe(false);
  });

  it("opens and closes palette settings", () => {
    useCadStore.setState({ showCommandPalette: true });

    dispatchCommand("openPaletteSettings");
    expect(useCadStore.getState()).toMatchObject({
      showPaletteSettings: true,
      showCommandPalette: false
    });

    dispatchCommand("closePaletteSettings");
    expect(useCadStore.getState().showPaletteSettings).toBe(false);
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
    expect(filterCommandPaletteItems("").slice(0, 4).map((item) => item.commandId)).toEqual([
      "addFreePoint",
      "addOffsetPoint",
      "addPolarOffsetPoint",
      "addDivisionPoint"
    ]);
    expect(filterCommandPaletteItems("point").map((item) => item.commandId)).toEqual(
      expect.arrayContaining(["addFreePoint", "addOffsetPoint", "addPolarOffsetPoint"])
    );
    expect(filterCommandPaletteItems("点").map((item) => item.commandId)).toEqual(
      expect.arrayContaining(["addFreePoint", "addOffsetPoint", "addPolarOffsetPoint"])
    );
    expect(filterCommandPaletteItems("角度").map((item) => item.commandId)).toContain(
      "addPolarOffsetPoint"
    );
    expect(filterCommandPaletteItems("分点").map((item) => item.commandId)).toContain(
      "addDivisionPoint"
    );
    expect(filterCommandPaletteItems("中点").map((item) => item.commandId)).toContain(
      "addDivisionPoint"
    );
    expect(filterCommandPaletteItems("line").map((item) => item.commandId)).toContain("addLine");
    expect(filterCommandPaletteItems("分割").map((item) => item.commandId)).toContain("addSplitLine");
    expect(filterCommandPaletteItems("直線").map((item) => item.commandId)).toContain("addLine");
    expect(filterCommandPaletteItems("円弧").map((item) => item.commandId)).toContain("addArcLine");
    expect(filterCommandPaletteItems("三点円弧").map((item) => item.commandId)).toContain(
      "addThreePointArcLine"
    );
    expect(filterCommandPaletteItems("交点").map((item) => item.commandId)).toContain(
      "addIntersectionPoint"
    );
    expect(filterCommandPaletteItems("intersection").map((item) => item.commandId)).toContain(
      "addIntersectionPoint"
    );
    expect(filterCommandPaletteItems("移動").map((item) => item.commandId)).toContain("addMove");
    expect(filterCommandPaletteItems("対称移動").map((item) => item.commandId)).toContain(
      "addSymmetricMove"
    );
    expect(filterCommandPaletteItems("保存").map((item) => item.commandId)).toEqual(
      expect.arrayContaining(["saveDocument", "saveDocumentAs"])
    );
    expect(filterCommandPaletteItems("新規").map((item) => item.commandId)).toContain("newDocument");
    expect(filterCommandPaletteItems("開く").map((item) => item.commandId)).toContain("openDocument");
    expect(filterCommandPaletteItems("パレット").map((item) => item.commandId)).toContain(
      "openPaletteSettings"
    );
    expect(filterCommandPaletteItems("一括").map((item) => item.commandId)).toContain(
      "openSelectionColorPicker"
    );
    expect(filterCommandPaletteItems("色").map((item) => item.commandId)).toContain(
      "openSelectionColorPicker"
    );
    expect(filterCommandPaletteItems("全選択").map((item) => item.commandId)).toContain(
      "selectAllElements"
    );
    expect(filterCommandPaletteItems("select all").map((item) => item.commandId)).toContain(
      "selectAllElements"
    );
  });

  it("creates a new document from a command", async () => {
    useCadStore.setState({
      currentFilePath: "/tmp/edited.nuinui.json",
      dirtySinceSave: true,
      past: [useCadStore.getState()],
      evaluationLimitIndex: 1
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    dispatchCommand("newDocument");

    await waitFor(() =>
      expect(useCadStore.getState()).toMatchObject({
        elements: sampleElements,
        evaluationLimitIndex: sampleElements.length,
        selectedElementId: sampleElements[0].id,
        selectedElementIds: [sampleElements[0].id],
        selectionAnchorElementId: sampleElements[0].id,
        currentFilePath: null,
        dirtySinceSave: false,
        past: [],
        future: []
      })
    );
  });

  it("adds a polar offset point from a command", () => {
    dispatchCommand("addPolarOffsetPoint");

    const added = useCadStore.getState().elements.at(-1);
    expect(added).toMatchObject({
      type: "polarOffsetPoint",
      fromPointId: "point-a",
      angleDeg: 0,
      distance: 30
    });
    expect(useCadStore.getState().selectedElementId).toBe(added?.id);
  });

  it("adds a division point from a command", () => {
    dispatchCommand("addDivisionPoint");

    const added = useCadStore.getState().elements.at(-1);
    expect(added).toMatchObject({
      type: "divisionPoint",
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      placementMode: "ratio",
      distance: 30,
      ratio: 0.5,
      numericParameterSteps: { ratio: 0.01 }
    });
    expect(useCadStore.getState().selectedElementId).toBe(added?.id);
  });

  it("adds a line division point from the selected line-like element", () => {
    useCadStore.setState({
      selectedElementId: "line-bc",
      selectedElementIds: ["line-bc"],
      selectionAnchorElementId: "line-bc"
    });

    dispatchCommand("addLineDivisionPoint");

    const added = useCadStore.getState().elements.at(-1);
    expect(added).toMatchObject({
      type: "lineDivisionPoint",
      endpoint: { lineId: "line-bc", endpointKey: "start" },
      placementMode: "ratio",
      distance: 30,
      ratio: 0.5,
      numericParameterSteps: { ratio: 0.01 }
    });
    expect(useCadStore.getState().selectedElementId).toBe(added?.id);
  });

  it("adds an intersection point from selected line-like elements", () => {
    useCadStore.setState({
      selectedElementId: "line-bc",
      selectedElementIds: ["line-ab", "line-bc"],
      selectionAnchorElementId: "line-ab"
    });

    dispatchCommand("addIntersectionPoint");

    const added = useCadStore.getState().elements.at(-1);
    expect(added).toMatchObject({
      type: "intersectionPoint",
      line1Id: "line-ab",
      line2Id: "line-bc",
      intersectionIndex: 0,
      useExtensions: false
    });
    expect(useCadStore.getState().selectedElementId).toBe(added?.id);
  });

  it("replaces single line reference parameters from line pick mode", () => {
    const intersection = {
      id: "intersection",
      name: "交点",
      type: "intersectionPoint" as const,
      visible: true,
      enabled: true,
      line1Id: "line-ab",
      line2Id: "line-bc",
      intersectionIndex: 0,
      useExtensions: false
    };
    useCadStore.setState({
      elements: [...sampleElements, intersection],
      selectedElementId: "intersection",
      selectedElementIds: ["intersection"],
      selectionAnchorElementId: "intersection",
      selectedParameterKey: "line1Id"
    });

    dispatchCommand("startLinePick");
    dispatchCommand("applyPickedLine", { pickedLineId: "curve-ac" });

    const updated = useCadStore.getState().elements.find((element) => element.id === "intersection");
    expect(updated).toMatchObject({
      type: "intersectionPoint",
      line1Id: "curve-ac",
      line2Id: "line-bc"
    });
    expect(useCadStore.getState().activeLinePickTarget).toBeNull();
  });

  it("cycles line division endpoint references in parameter edit mode", () => {
    const point = {
      id: "line-division",
      name: "線上分点",
      type: "lineDivisionPoint" as const,
      visible: true,
      enabled: true,
      endpoint: { lineId: "line-ab", endpointKey: "start" as const },
      placementMode: "ratio" as const,
      distance: 30,
      ratio: 0.5
    };
    useCadStore.setState({
      elements: [...sampleElements, point],
      selectedElementId: point.id,
      selectedElementIds: [point.id],
      selectionAnchorElementId: point.id,
      selectedParameterKey: "endpoint"
    });

    dispatchCommand("incrementSelectedParameter");

    const updated = useCadStore.getState().elements.find((element) => element.id === point.id);
    expect(updated).toMatchObject({
      type: "lineDivisionPoint",
      endpoint: { lineId: "line-ab", endpointKey: "end" }
    });
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
      ],
      evaluationLimitIndex: sampleElements.length + 1
    });

    dispatchCommand("addFreePoint");

    const state = useCadStore.getState();
    expect(state.elements.find((element) => element.id === state.selectedElementId)?.name).toBe("点5 2");
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
    const focusSelectedParameterInput = vi.fn();

    dispatchCommand("enterParameterEditMode");

    dispatchCommand("selectNextParameter", { focusSelectedParameterInput });
    expect(useCadStore.getState().selectedParameterKey).toBe("colorId");

    dispatchCommand("selectPreviousParameter", { focusSelectedParameterInput });
    expect(useCadStore.getState().selectedParameterKey).toBe("name");
    expect(focusSelectedParameterInput).not.toHaveBeenCalled();
  });

  it("selects parameters by direct key", () => {
    const focusSelectedParameterInput = vi.fn();

    dispatchCommand("enterParameterEditMode");

    dispatchCommand("selectParameterByKey", {
      parameterDirectKey: "x",
      focusSelectedParameterInput
    });

    expect(useCadStore.getState().selectedParameterKey).toBe("x");
    expect(focusSelectedParameterInput).toHaveBeenCalledTimes(1);
  });

  it("selects polar offset point numeric parameters by direct key", () => {
    const focusSelectedParameterInput = vi.fn();
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          visible: true,
          enabled: true,
          fromPointId: "point-a",
          angleDeg: 0,
          distance: 30
        }
      ],
      selectedElementId: "polar-point",
      selectedElementIds: ["polar-point"],
      selectedParameterKey: "name"
    });

    dispatchCommand("selectParameterByKey", {
      parameterDirectKey: "r",
      focusSelectedParameterInput
    });

    expect(useCadStore.getState().selectedParameterKey).toBe("angleDeg");
    dispatchCommand("selectParameterByKey", {
      parameterDirectKey: "f",
      focusSelectedParameterInput
    });
    expect(useCadStore.getState().selectedParameterKey).toBe("distance");
    expect(focusSelectedParameterInput).toHaveBeenCalledTimes(2);
  });

  it("activates selected parameters with Enter behavior", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"],
      selectedParameterKey: "startPoint"
    });

    dispatchCommand("activateSelectedParameter");

    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: "line-ab",
      parameterKey: "startPoint"
    });
  });

  it("toggles coordinate-capable point anchors between reference and coordinate modes", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"],
      selectedParameterKey: "startPoint"
    });

    dispatchCommand("toggleSelectedParameterValue");

    expect(useCadStore.getState().elements[3]).toMatchObject({
      startPoint: { mode: "coordinate", x: 0, y: 0 }
    });
    expect(useCadStore.getState().selectedParameterKey).toBe("startPoint:x");

    dispatchCommand("toggleSelectedParameterValue");

    expect(useCadStore.getState().elements[3]).toMatchObject({
      startPoint: { mode: "reference", pointId: "point-a" }
    });
    expect(useCadStore.getState().selectedParameterKey).toBe("startPoint");
  });

  it("does not switch point anchors to coordinates when the parameter disallows coordinates", () => {
    useCadStore.setState({
      selectedElementId: "point-b",
      selectedElementIds: ["point-b"],
      selectedParameterKey: "fromPoint"
    });

    dispatchCommand("toggleSelectedParameterValue");

    expect(useCadStore.getState().elements[1]).toMatchObject({
      fromPointId: "point-a"
    });
    expect(useCadStore.getState().selectedParameterKey).toBe("fromPoint");
  });

  it("sets point anchor modes from explicit commands", () => {
    dispatchCommand("setSelectedPointAnchorCoordinateMode", {
      elementId: "line-ab",
      parameterKey: "endPoint"
    });

    expect(useCadStore.getState().elements[3]).toMatchObject({
      endPoint: { mode: "coordinate", x: 0, y: 0 }
    });
    expect(useCadStore.getState().selectedParameterKey).toBe("endPoint:x");

    dispatchCommand("setSelectedPointAnchorReferenceMode", {
      elementId: "line-ab",
      parameterKey: "endPoint"
    });

    expect(useCadStore.getState().elements[3]).toMatchObject({
      endPoint: { mode: "reference", pointId: "point-a" }
    });
    expect(useCadStore.getState().selectedParameterKey).toBe("endPoint");
  });

  it("selects division point parameters by direct key and cycles placement mode", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "division",
          name: "分点",
          type: "divisionPoint",
          visible: true,
          enabled: true,
          startPoint: { mode: "reference", pointId: "point-a" },
          endPoint: { mode: "reference", pointId: "point-b" },
          placementMode: "ratio",
          distance: 30,
          ratio: 0.5,
          numericParameterSteps: { ratio: 0.01 }
        }
      ],
      selectedElementId: "division",
      selectedElementIds: ["division"],
      selectedParameterKey: "name"
    });

    dispatchCommand("selectParameterByKey", { parameterDirectKey: "s" });
    expect(useCadStore.getState().selectedParameterKey).toBe("startPoint");
    dispatchCommand("selectParameterByKey", { parameterDirectKey: "t" });
    expect(useCadStore.getState().selectedParameterKey).toBe("endPoint");
    dispatchCommand("selectParameterByKey", { parameterDirectKey: "m" });
    expect(useCadStore.getState().selectedParameterKey).toBe("placementMode");
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      placementMode: "distance"
    });

    dispatchCommand("incrementSelectedParameter");
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      placementMode: "ratio"
    });
    dispatchCommand("decrementSelectedParameter");
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      placementMode: "distance"
    });
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

  it("uses ratio-specific step levels for division point ratios", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "division",
          name: "分点",
          type: "divisionPoint",
          visible: true,
          enabled: true,
          startPoint: { mode: "reference", pointId: "point-a" },
          endPoint: { mode: "reference", pointId: "point-b" },
          placementMode: "ratio",
          distance: 30,
          ratio: 0.5,
          numericParameterSteps: { ratio: 0.01 }
        }
      ],
      selectedElementId: "division",
      selectedElementIds: ["division"],
      selectedParameterKey: "ratio"
    });

    dispatchCommand("incrementSelectedParameter");
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({ ratio: 0.51 });

    dispatchCommand("increaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      ratio: 0.1
    });
  });

  it("changes angle parameter steps through angle-specific fixed levels", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          visible: true,
          enabled: true,
          fromPointId: "point-a",
          angleDeg: 0,
          distance: 30,
          numericParameterSteps: { angleDeg: 0.1 }
        }
      ],
      selectedElementId: "polar-point",
      selectedElementIds: ["polar-point"],
      selectedParameterKey: "angleDeg"
    });

    dispatchCommand("increaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 1
    });

    dispatchCommand("increaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 15
    });

    dispatchCommand("increaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 60
    });

    dispatchCommand("increaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 90
    });

    dispatchCommand("decreaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 60
    });

    dispatchCommand("decreaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 15
    });

    dispatchCommand("decreaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 1
    });

    dispatchCommand("decreaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 0.1
    });
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

  it("clamps angle parameter steps at the angle-specific fixed level bounds", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          visible: true,
          enabled: true,
          fromPointId: "point-a",
          angleDeg: 0,
          distance: 30,
          numericParameterSteps: { angleDeg: 0.1 }
        }
      ],
      selectedElementId: "polar-point",
      selectedElementIds: ["polar-point"],
      selectedParameterKey: "angleDeg"
    });

    dispatchCommand("decreaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 0.1
    });

    useCadStore.setState({
      elements: [
        ...useCadStore.getState().elements.slice(0, -1),
        {
          ...useCadStore.getState().elements.at(-1)!,
          numericParameterSteps: { angleDeg: 90 }
        }
      ]
    });
    dispatchCommand("increaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 90
    });
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

  it("moves custom angle parameter steps to the nearest angle-specific fixed level", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "polar-point",
          name: "角度距離点",
          type: "polarOffsetPoint",
          visible: true,
          enabled: true,
          fromPointId: "point-a",
          angleDeg: 0,
          distance: 30,
          numericParameterSteps: { angleDeg: 30 }
        }
      ],
      selectedElementId: "polar-point",
      selectedElementIds: ["polar-point"],
      selectedParameterKey: "angleDeg"
    });

    dispatchCommand("increaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 60
    });

    useCadStore.setState({
      elements: [
        ...useCadStore.getState().elements.slice(0, -1),
        {
          ...useCadStore.getState().elements.at(-1)!,
          numericParameterSteps: { angleDeg: 30 }
        }
      ]
    });
    dispatchCommand("decreaseSelectedParameterStep");
    expect(useCadStore.getState().elements.at(-1)?.numericParameterSteps).toMatchObject({
      angleDeg: 15
    });
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
      selectedParameterKey: "startPoint"
    });

    dispatchCommand("incrementSelectedParameter");

    expect(useCadStore.getState().elements[3]).toMatchObject({ startPoint: { mode: "reference", pointId: "point-b" } });
  });

  it("applies a picked point to the selected reference parameter", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"],
      selectedParameterKey: "endPoint"
    });

    dispatchCommand("startPointPick");
    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: "line-ab",
      parameterKey: "endPoint"
    });

    dispatchCommand("applyPickedPoint", { pickedPointId: "point-c" });

    expect(useCadStore.getState().activePointPickTarget).toBeNull();
    expect(useCadStore.getState().elements[3]).toMatchObject({
      endPoint: { mode: "reference", pointId: "point-c" }
    });
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("applies a point pick candidate using keyboard candidate commands", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"],
      selectedParameterKey: "endPoint"
    });

    dispatchCommand("startPointPick");
    dispatchCommand("selectNextPickCandidate");
    dispatchCommand("selectNextPickCandidate");
    dispatchCommand("selectNextPickCandidate");
    dispatchCommand("applySelectedPickCandidate");

    expect(useCadStore.getState().activePointPickTarget).toBeNull();
    expect(useCadStore.getState().elements[3]).toMatchObject({
      endPoint: { mode: "reference", pointId: "point-c" }
    });
  });

  it("applies a picked derived point anchor to the selected reference parameter", () => {
    useCadStore.setState({
      selectedElementId: "line-bc",
      selectedElementIds: ["line-bc"],
      selectedParameterKey: "startPoint"
    });

    dispatchCommand("startPointPick");
    dispatchCommand("applyPickedPoint", {
      pickedPointAnchor: { mode: "derived", elementId: "line-ab", pointKey: "end" }
    });

    expect(useCadStore.getState().activePointPickTarget).toBeNull();
    expect(useCadStore.getState().elements[4]).toMatchObject({
      startPoint: { mode: "derived", elementId: "line-ab", pointKey: "end" }
    });
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("maps picked generated point anchors to templates when editing the same for group", () => {
    const elements: CadElement[] = [
      {
        id: "loop",
        name: "繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 3,
        step: 1,
        expanded: true,
        showGenerated: true
      },
      {
        id: "template-point",
        name: "テンプレート点",
        type: "freePoint",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        x: 0,
        y: 0
      },
      {
        id: "target-line",
        name: "対象線",
        type: "line",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 10, y: 0 }
      }
    ];
    useCadStore.setState({
      elements,
      selectedElementId: "target-line",
      selectedElementIds: ["target-line"],
      selectedParameterKey: "startPoint"
    });

    dispatchCommand("startPointPick");
    dispatchCommand("applyPickedPoint", {
      pickedPointAnchor: { mode: "reference", pointId: "template-point@loop:2" }
    });

    expect(useCadStore.getState().activePointPickTarget).toBeNull();
    expect(useCadStore.getState().elements[2]).toMatchObject({
      type: "line",
      startPoint: { mode: "reference", pointId: "template-point" }
    });
  });

  it("ignores picked generated point anchors when editing outside the owning for group", () => {
    const elements: CadElement[] = [
      {
        id: "loop",
        name: "繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 3,
        step: 1,
        expanded: true,
        showGenerated: true
      },
      {
        id: "template-point",
        name: "テンプレート点",
        type: "freePoint",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        x: 0,
        y: 0
      },
      {
        id: "outside-line",
        name: "外側線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 10, y: 0 }
      }
    ];
    useCadStore.setState({
      elements,
      selectedElementId: "outside-line",
      selectedElementIds: ["outside-line"],
      selectedParameterKey: "startPoint"
    });

    dispatchCommand("startPointPick");
    dispatchCommand("applyPickedPoint", {
      pickedPointAnchor: { mode: "reference", pointId: "template-point@loop:2" }
    });

    expect(useCadStore.getState().elements[2]).toMatchObject({
      type: "line",
      startPoint: { mode: "coordinate", x: 0, y: 0 }
    });
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("applies a picked line endpoint anchor to a line division point endpoint", () => {
    const point = {
      id: "line-division",
      name: "線上分点",
      type: "lineDivisionPoint" as const,
      visible: true,
      enabled: true,
      endpoint: { lineId: "line-ab", endpointKey: "start" as const },
      placementMode: "ratio" as const,
      distance: 30,
      ratio: 0.5
    };
    useCadStore.setState({
      elements: [...sampleElements, point],
      selectedElementId: point.id,
      selectedElementIds: [point.id],
      selectedParameterKey: "endpoint"
    });

    dispatchCommand("startPointPick");
    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: point.id,
      parameterKey: "endpoint"
    });

    dispatchCommand("applyPickedPoint", {
      pickedPointAnchor: { mode: "derived", elementId: "line-bc", pointKey: "end" }
    });

    const updated = useCadStore.getState().elements.find((element) => element.id === point.id);
    expect(useCadStore.getState().activePointPickTarget).toBeNull();
    expect(updated).toMatchObject({
      type: "lineDivisionPoint",
      endpoint: { lineId: "line-bc", endpointKey: "end" }
    });
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("maps picked generated line endpoints to template endpoints in the same for group", () => {
    const elements: CadElement[] = [
      {
        id: "loop",
        name: "繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 3,
        step: 1,
        expanded: true,
        showGenerated: true
      },
      {
        id: "template-line",
        name: "テンプレート線",
        type: "line",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 10, y: 0 }
      },
      {
        id: "extend",
        name: "延長短縮",
        type: "extendTrim",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        endpoint: { lineId: "template-line", endpointKey: "start" },
        point: { mode: "derived", elementId: "template-line", pointKey: "start" }
      }
    ];
    useCadStore.setState({
      elements,
      selectedElementId: "extend",
      selectedElementIds: ["extend"],
      selectedParameterKey: "endpoint"
    });

    dispatchCommand("startPointPick");
    dispatchCommand("applyPickedPoint", {
      pickedPointAnchor: { mode: "derived", elementId: "template-line@loop:1", pointKey: "end" }
    });

    expect(useCadStore.getState().activePointPickTarget).toBeNull();
    expect(useCadStore.getState().elements[2]).toMatchObject({
      type: "extendTrim",
      endpoint: { lineId: "template-line", endpointKey: "end" }
    });
  });

  it("uses left and right to choose a line endpoint option before applying it", () => {
    const point = {
      id: "line-division",
      name: "線上分点",
      type: "lineDivisionPoint" as const,
      visible: true,
      enabled: true,
      endpoint: { lineId: "line-ab", endpointKey: "start" as const },
      placementMode: "ratio" as const,
      distance: 30,
      ratio: 0.5
    };
    useCadStore.setState({
      elements: [...sampleElements, point],
      selectedElementId: point.id,
      selectedElementIds: [point.id],
      selectedParameterKey: "endpoint"
    });

    dispatchCommand("startPointPick");
    dispatchCommand("selectNextPickCandidate");
    dispatchCommand("selectNextPickOption");
    dispatchCommand("applySelectedPickCandidate");

    expect(useCadStore.getState().activePointPickTarget).toBeNull();
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "lineDivisionPoint",
      endpoint: { lineId: "line-ab", endpointKey: "end" }
    });
  });

  it("ignores picked anchors that are not line endpoints for line division endpoints", () => {
    const point = {
      id: "line-division",
      name: "線上分点",
      type: "lineDivisionPoint" as const,
      visible: true,
      enabled: true,
      endpoint: { lineId: "line-ab", endpointKey: "start" as const },
      placementMode: "ratio" as const,
      distance: 30,
      ratio: 0.5
    };
    useCadStore.setState({
      elements: [...sampleElements, point],
      selectedElementId: point.id,
      selectedElementIds: [point.id],
      selectedParameterKey: "endpoint"
    });

    dispatchCommand("startPointPick");
    dispatchCommand("applyPickedPoint", { pickedPointId: "point-c" });

    const updated = useCadStore.getState().elements.find((element) => element.id === point.id);
    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: point.id,
      parameterKey: "endpoint"
    });
    expect(updated).toMatchObject({
      type: "lineDivisionPoint",
      endpoint: { lineId: "line-ab", endpointKey: "start" }
    });
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("cancels point picking without changing the document", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"],
      selectedParameterKey: "startPoint"
    });

    dispatchCommand("startPointPick");
    dispatchCommand("cancelPointPick");

    expect(useCadStore.getState().activePointPickTarget).toBeNull();
    expect(useCadStore.getState().elements[3]).toMatchObject({
      startPoint: { mode: "reference", pointId: "point-a" }
    });
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("starts line picking and appends picked base lines in click order", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          visible: true,
          enabled: true,
          numericVariables: [],
          baseLineIds: [],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "baseLineIds"
    });

    dispatchCommand("startLinePick");
    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "offset-line",
      parameterKey: "baseLineIds"
    });

    dispatchCommand("applyPickedLine", { pickedLineId: "line-ab" });
    dispatchCommand("applyPickedLine", { pickedLineId: "line-bc" });

    const offsetLine = useCadStore.getState().elements.at(-1);
    expect(offsetLine).toMatchObject({
      type: "offsetLine",
      baseLineIds: ["line-ab", "line-bc"]
    });
    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "offset-line",
      parameterKey: "baseLineIds"
    });
  });

  it("maps picked generated lines to template line references in the same for group", () => {
    const elements: CadElement[] = [
      {
        id: "loop",
        name: "繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 3,
        step: 1,
        expanded: true,
        showGenerated: true
      },
      {
        id: "template-line",
        name: "テンプレート線",
        type: "line",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 10, y: 0 }
      },
      {
        id: "other-line",
        name: "外部線",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "coordinate", x: 0, y: 10 },
        endPoint: { mode: "coordinate", x: 10, y: 10 }
      },
      {
        id: "intersection",
        name: "交点",
        type: "intersectionPoint",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        line1Id: "other-line",
        line2Id: "other-line",
        intersectionIndex: 0,
        useExtensions: true
      }
    ];
    useCadStore.setState({
      elements,
      selectedElementId: "intersection",
      selectedElementIds: ["intersection"],
      selectedParameterKey: "line1Id"
    });

    dispatchCommand("startLinePick");
    dispatchCommand("applyPickedLine", { pickedLineId: "template-line@loop:2" });

    expect(useCadStore.getState().activeLinePickTarget).toBeNull();
    expect(useCadStore.getState().elements[3]).toMatchObject({
      type: "intersectionPoint",
      line1Id: "template-line"
    });
  });

  it("maps generated lines once for line reference lists", () => {
    const elements: CadElement[] = [
      {
        id: "loop",
        name: "繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 3,
        step: 1,
        expanded: true,
        showGenerated: true
      },
      {
        id: "template-line",
        name: "テンプレート線",
        type: "line",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 10, y: 0 }
      },
      {
        id: "offset-line",
        name: "オフセット線",
        type: "offsetLine",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        baseLineIds: [],
        offset: 10,
        side: "right",
        closed: false
      }
    ];
    useCadStore.setState({
      elements,
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "baseLineIds"
    });

    dispatchCommand("startLinePick");
    dispatchCommand("applyPickedLine", { pickedLineId: "template-line@loop:0" });
    dispatchCommand("applyPickedLine", { pickedLineId: "template-line@loop:1" });

    expect(useCadStore.getState().elements[2]).toMatchObject({
      type: "offsetLine",
      baseLineIds: ["template-line"]
    });
  });

  it("applies line pick candidates from the keyboard and skips already picked lines", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          visible: true,
          enabled: true,
          numericVariables: [],
          baseLineIds: [],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "baseLineIds"
    });

    dispatchCommand("startLinePick");
    dispatchCommand("applySelectedPickCandidate");
    dispatchCommand("applySelectedPickCandidate");

    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "offset-line",
      parameterKey: "baseLineIds"
    });
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: ["line-ab", "line-bc"]
    });
  });

  it("applies a numeric reference candidate using left and right option selection", () => {
    useCadStore.setState({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
      selectedParameterKey: "x"
    });

    dispatchCommand("startNumericReferencePick");
    dispatchCommand("selectNextPickCandidate");
    dispatchCommand("selectNextPickOption");
    dispatchCommand("applySelectedPickCandidate");

    expect(useCadStore.getState().activeNumericReferencePickTarget).toBeNull();
    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.startTangentAngleDeg" }
    });
  });

  it("toggles the expression insert tray for the selected numeric parameter", () => {
    useCadStore.setState({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
      selectedParameterKey: "x"
    });

    dispatchCommand("toggleExpressionInsertTray");

    expect(useCadStore.getState().activeExpressionInsertTarget).toEqual({
      elementId: "point-a",
      parameterKey: "x"
    });

    dispatchCommand("toggleExpressionInsertTray");

    expect(useCadStore.getState().activeExpressionInsertTarget).toBeNull();
  });

  it("inserts numeric expression snippets with replacement, append, and selection rules", () => {
    useCadStore.setState({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
      selectedParameterKey: "x"
    });

    dispatchCommand("insertNumericExpressionSnippet", {
      numericExpressionSnippet: "line-ab.length",
      displayedExpression: "0"
    });

    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length" }
    });

    dispatchCommand("insertNumericExpressionSnippet", {
      numericExpressionSnippet: "@base",
      displayedExpression: "line-ab.length"
    });

    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length + @base" }
    });

    dispatchCommand("insertNumericExpressionSnippet", {
      numericExpressionSnippet: "距離(point-a, point-b)",
      displayedExpression: "line-ab.length + @base",
      selectionStart: 17,
      selectionEnd: 22
    });

    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length + 距離(point-a, point-b)" }
    });
  });

  it("ignores duplicate, non-line, self, and missing picked lines", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          visible: true,
          enabled: true,
          numericVariables: [],
          baseLineIds: ["line-ab"],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "baseLineIds"
    });

    dispatchCommand("startLinePick");
    dispatchCommand("applyPickedLine", { pickedLineId: "line-ab" });
    dispatchCommand("applyPickedLine", { pickedLineId: "point-a" });
    dispatchCommand("applyPickedLine", { pickedLineId: "offset-line" });
    dispatchCommand("applyPickedLine", { pickedLineId: "missing" });

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: ["line-ab"]
    });
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("cancels line picking without changing the document", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          visible: true,
          enabled: true,
          numericVariables: [],
          baseLineIds: [],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "baseLineIds"
    });

    dispatchCommand("startLinePick");
    dispatchCommand("cancelLinePick");

    expect(useCadStore.getState().activeLinePickTarget).toBeNull();
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: []
    });
    expect(useCadStore.getState().past).toHaveLength(0);
  });

  it("toggles boolean parameters", () => {
    useCadStore.setState({ selectedParameterKey: "visible" });

    dispatchCommand("toggleSelectedBooleanParameter");

    expect(useCadStore.getState().elements[0].visible).toBe(false);
  });

  it("toggles boolean parameters by direct key", () => {
    dispatchCommand("toggleBooleanParameterByDirectKey", { parameterDirectKey: "v" });
    dispatchCommand("toggleBooleanParameterByDirectKey", { parameterDirectKey: "a" });

    expect(useCadStore.getState().elements[0]).toMatchObject({
      visible: false,
      enabled: false
    });
    expect(useCadStore.getState().selectedParameterKey).toBe("enabled");
  });

  it("toggles boolean and choice parameters from direct keys", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          visible: true,
          enabled: true,
          numericVariables: [],
          baseLineIds: ["line-ab"],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "name"
    });

    dispatchCommand("selectParameterByKey", { parameterDirectKey: "s" });
    expect(useCadStore.getState().selectedParameterKey).toBe("side");
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      side: "left",
      closed: false
    });

    dispatchCommand("selectParameterByKey", { parameterDirectKey: "s" });
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      side: "right"
    });

    dispatchCommand("selectParameterByKey", { parameterDirectKey: "c" });
    expect(useCadStore.getState().selectedParameterKey).toBe("closed");
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      closed: true
    });
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

  it("undoes and redoes direct insertion reordering", () => {
    dispatchCommand("moveElementToInsertionIndex", {
      elementId: sampleElements[0].id,
      insertionIndex: 3
    });
    expect(useCadStore.getState().elements[2].id).toBe(sampleElements[0].id);

    dispatchCommand("undo");
    expect(useCadStore.getState().elements[0].id).toBe(sampleElements[0].id);

    dispatchCommand("redo");
    expect(useCadStore.getState().elements[2].id).toBe(sampleElements[0].id);
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
