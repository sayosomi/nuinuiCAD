import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand, filterCommandPaletteItems } from "./commands";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, useCadStore } from "../state/useCadStore";

describe("commands", () => {
  beforeEach(() => {
    useCadStore.setState({
      elements: sampleElements,
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id],
      selectionAnchorElementId: sampleElements[0].id,
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
    expect(useCadStore.getState().selectedElementIds).toEqual([sampleElements[1].id]);

    dispatchCommand("selectPreviousElement");
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[0].id);
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

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 62, y: 45 });
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
    expect(moved.angleDeg).toBeCloseTo(18.43494882292201);
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
    expect(moved.angleDeg).toBeCloseTo(18.43494882292201);
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

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 65, y: 60 });
    expect(useCadStore.getState().past).toHaveLength(0);

    dispatchCommand("movePointElementByDelta", {
      elementId: sampleElements[0].id,
      dx: 15,
      dy: 10,
      commitMode: "commit",
      baseElements: snapshot.elements,
      historySnapshot: snapshot
    });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 65, y: 60 });
    expect(useCadStore.getState().past).toHaveLength(1);

    dispatchCommand("undo");
    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50, y: 50 });
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
    expect(curve.startHandleAngleDeg).toBeCloseTo(45);
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
    expect(curve.startHandleAngleDeg).toBeCloseTo(45);
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
    expect(curve.intermediatePoints[0].handleAngleDeg).toBeCloseTo(315);
    expect(curve.intermediatePoints[0].incomingHandleLength).toBeCloseTo(14.142135623730951);
    expect(curve.intermediatePoints[0].outgoingHandleLength).toBe(20);
  });

  it("previews Bezier handle movement without history and commits one undo step", () => {
    const state = useCadStore.getState();
    const snapshot = {
      elements: state.elements,
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
      "addLine"
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
    expect(filterCommandPaletteItems("line").map((item) => item.commandId)).toContain("addLine");
    expect(filterCommandPaletteItems("直線").map((item) => item.commandId)).toContain("addLine");
    expect(filterCommandPaletteItems("円弧").map((item) => item.commandId)).toContain("addArcLine");
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
    const focusSelectedParameterInput = vi.fn();

    dispatchCommand("enterParameterEditMode");

    dispatchCommand("selectNextParameter", { focusSelectedParameterInput });
    expect(useCadStore.getState().selectedParameterKey).toBe("visible");

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
