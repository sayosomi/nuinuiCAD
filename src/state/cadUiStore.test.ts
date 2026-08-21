import { beforeEach, describe, expect, it } from "vitest";
import { initialCadUiState, useCadUiStore } from "./cadUiStore";
import { isElseExpanded, isFoldTargetExpanded, isGroupExpanded, isStatementExpanded } from "../model/groups";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";
import { startSession } from "../commands/commandLineSession";
import type { CreationRecipe } from "../commands/creationRecipes";
import type { CadElement } from "../types/geometry";

const commandLineRecipe: CreationRecipe = {
  type: "line",
  steps: [
    { kind: "lineList", key: "baseLineIds", prompt: "基準線" },
    { kind: "name", autoSuggest: true }
  ]
};

describe("cadUiStore group fold state", () => {
  beforeEach(() => {
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("uses the visual defaults for unregistered ids and supports set/toggle", () => {
    const store = useCadUiStore.getState();
    // An id with no entry is expanded: only a document load writes the
    // collapsed overview, so a group created mid-session stays open.
    expect(isGroupExpanded("group", store.groupFoldById)).toBe(true);
    expect(isElseExpanded("group", store.groupFoldById)).toBe(true);

    store.setGroupFold("group", { expanded: true });
    store.toggleElseExpanded("group");
    store.toggleGroupExpanded("group");

    const fold = useCadUiStore.getState().groupFoldById;
    expect(isGroupExpanded("group", fold)).toBe(false);
    expect(isElseExpanded("group", fold)).toBe(false);
  });

  it("toggles an unregistered id off its expanded default", () => {
    useCadUiStore.getState().toggleGroupExpanded("group");

    expect(isGroupExpanded("group", useCadUiStore.getState().groupFoldById)).toBe(false);

    useCadUiStore.getState().toggleGroupExpanded("group");

    expect(isGroupExpanded("group", useCadUiStore.getState().groupFoldById)).toBe(true);
  });

  it("replaces the whole map so a loaded document never inherits stale entries", () => {
    useCadUiStore.getState().setGroupFold("stale", { expanded: false });

    useCadUiStore.getState().replaceGroupFoldById(new Map([["loaded", { expanded: false }]]));

    const folds = useCadUiStore.getState().groupFoldById;
    expect(folds.has("stale")).toBe(false);
    expect(isGroupExpanded("loaded", folds)).toBe(false);
  });

  it("updates statement, primary, and else presentation targets independently", () => {
    const store = useCadUiStore.getState();
    const statement = { elementId: "point", branch: "statement" as const };
    const primary = { elementId: "if", branch: "primary" as const };
    const elseTarget = { elementId: "if", branch: "else" as const };

    store.setFoldTargetExpanded(statement, false);
    store.setFoldTargetExpanded(primary, true);
    store.setFoldTargetExpanded(elseTarget, false);

    const folds = useCadUiStore.getState().groupFoldById;
    expect(isStatementExpanded("point", folds)).toBe(false);
    expect(isFoldTargetExpanded(statement, folds)).toBe(false);
    expect(isFoldTargetExpanded(primary, folds)).toBe(true);
    expect(isFoldTargetExpanded(elseTarget, folds)).toBe(false);
  });

  it("batches many fold targets into a single groupFoldById update, and no-ops when nothing changes", () => {
    const store = useCadUiStore.getState();
    const targets = [
      { elementId: "point", branch: "statement" as const },
      { elementId: "if", branch: "primary" as const },
      { elementId: "if", branch: "else" as const }
    ];

    store.setFoldTargetsExpanded(targets, false);

    const folds = useCadUiStore.getState().groupFoldById;
    expect(isStatementExpanded("point", folds)).toBe(false);
    expect(isGroupExpanded("if", folds)).toBe(false);
    expect(isElseExpanded("if", folds)).toBe(false);

    useCadUiStore.getState().setFoldTargetsExpanded(targets, false);
    expect(useCadUiStore.getState().groupFoldById).toBe(folds);
  });

  it("prunes fold state for deleted elements", () => {
    useCadUiStore.getState().setGroupFold("keep", { expanded: true });
    useCadUiStore.getState().setGroupFold("remove", { elseExpanded: false });

    useCadUiStore.getState().pruneGroupFold(new Set(["keep"]));

    expect(useCadUiStore.getState().groupFoldById.has("keep")).toBe(true);
    expect(useCadUiStore.getState().groupFoldById.has("remove")).toBe(false);
  });

  it("prunes fold state after an element-removing document commit", () => {
    const element = useCadDocumentStore.getState().elements[0];
    useCadUiStore.getState().setGroupFold(element.id, { expanded: true });

    useCadDocumentStore.getState().commitDocumentChange({
      elements: useCadDocumentStore.getState().elements.filter((item) => item.id !== element.id)
    });

    expect(useCadUiStore.getState().groupFoldById.has(element.id)).toBe(false);
  });

  it("does not prune fold state while updating a drag preview", () => {
    const element = useCadDocumentStore.getState().elements[0];
    useCadUiStore.getState().setGroupFold(element.id, { expanded: true });

    useCadDocumentStore.getState().previewDocumentChange({
      elements: useCadDocumentStore.getState().elements.filter((item) => item.id !== element.id)
    });

    expect(useCadUiStore.getState().groupFoldById.has(element.id)).toBe(true);
  });

  it("atomically replaces a command-line session and all in-store pick state", () => {
    const oldSession = startSession(commandLineRecipe, {
      insertionIndex: 0,
      revision: 3,
      elements: useCadDocumentStore.getState().elements
    });
    const nextSession = startSession(commandLineRecipe, {
      insertionIndex: 1,
      revision: 4,
      elements: useCadDocumentStore.getState().elements
    });
    const documentBefore = useCadDocumentStore.getState();
    useCadUiStore.setState({
      commandLineSession: oldSession,
      activePointPickTarget: { elementId: "point", parameterKey: "startPoint" as never },
      activeNumericReferencePickTarget: {
        elementId: "numeric",
        parameterKey: "offset" as never,
        mode: "replace",
        property: "length"
      },
      activeLinePickTarget: {
        elementId: "line",
        parameterKey: "baseLineIds" as never,
        draftLineIds: ["line-a"]
      },
      activeMeasurementInsertTarget: {
        elementId: "measurement",
        parameterKey: "offset" as never,
        mode: "distance",
        point1Anchor: null,
        point2Anchor: null,
        lineId: null,
        displayedExpression: "",
        selectionStart: null,
        selectionEnd: null
      },
      activePickCursor: { elementId: "line-a", optionIndex: 0 }
    });
    const observed: Array<ReturnType<typeof useCadUiStore.getState>> = [];
    const unsubscribe = useCadUiStore.subscribe((state) => observed.push(state));

    useCadUiStore.getState().startCommandLineSession(nextSession);
    unsubscribe();

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      commandLineSession: nextSession,
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activeMeasurementInsertTarget: null,
      activePickCursor: null
    });
    expect(useCadUiStore.getState().activeLinePickTarget).toBeNull();
    expect(useCadDocumentStore.getState()).toMatchObject({
      elements: documentBefore.elements,
      sourceText: documentBefore.sourceText,
      past: documentBefore.past,
      future: documentBefore.future
    });
  });

  it("clears a command-line session together with pick mode", () => {
    const session = startSession(commandLineRecipe, {
      insertionIndex: 0,
      revision: 0,
      elements: useCadDocumentStore.getState().elements
    });
    useCadUiStore.setState({ commandLineSession: session });

    useCadUiStore.getState().clearPickMode();

    expect(useCadUiStore.getState().commandLineSession).toBeNull();
  });

  it("keeps an in-progress measurement insert through clearPickMode", () => {
    const measurementTarget = {
      elementId: "measurement" as never,
      parameterKey: "offset" as never,
      mode: "distance" as const,
      point1Anchor: { mode: "reference" as const, pointId: "point-a" as never },
      point2Anchor: null,
      lineId: null,
      displayedExpression: "1 + 2",
      selectionStart: 0,
      selectionEnd: 5
    };
    useCadUiStore.setState({
      activeMeasurementInsertTarget: measurementTarget,
      activePointPickTarget: { elementId: "measurement" as never, parameterKey: "offset" as never },
      activePickCursor: { elementId: "point-a" as never, optionIndex: 0 }
    });

    // Selection changes (clearTransientSelectionUi) && rejected commits reach
    // clearPickMode without meaning to abandon the measurement in progress.
    useCadUiStore.getState().clearPickMode();

    expect(useCadUiStore.getState().activeMeasurementInsertTarget).toEqual(measurementTarget);
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
    expect(useCadUiStore.getState().activePickCursor).toBeNull();
  });
});

describe("cadUiStore element/binding selection mutual exclusion", () => {
  beforeEach(() => {
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("clears the element selection when a typed binding is selected", () => {
    const element = useCadDocumentStore.getState().elements[0];
    useCadUiStore.getState().setSelectedElementId(element.id);
    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "elements" });

    useCadUiStore.getState().setSelectedBindingId("binding:x");

    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "binding", bindingId: "binding:x" });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(useCadUiStore.getState().selectionAnchorElementId).toBeNull();
  });

  it("clears the binding selection when an element is selected via setSelectedElementId", () => {
    useCadUiStore.getState().setSelectedBindingId("binding:x");
    const element = useCadDocumentStore.getState().elements[0];

    useCadUiStore.getState().setSelectedElementId(element.id);

    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "elements" });
    expect(useCadUiStore.getState().selectedElementId).toBe(element.id);
  });

  it("clears the binding selection when elements are selected via setSelectedElementIds", () => {
    useCadUiStore.getState().setSelectedBindingId("binding:x");
    const elements = useCadDocumentStore.getState().elements;

    useCadUiStore.getState().setSelectedElementIds([elements[0].id, elements[1].id]);

    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "elements" });
  });

  it("clears the binding selection when a range is selected via setSelectedElementRange", () => {
    useCadUiStore.getState().setSelectedBindingId("binding:x");
    const elements = useCadDocumentStore.getState().elements;

    useCadUiStore.getState().setSelectedElementRange(elements[0].id, elements[1].id);

    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "elements" });
  });

  it("clears the binding selection via applySelection", () => {
    useCadUiStore.getState().setSelectedBindingId("binding:x");
    const elements = useCadDocumentStore.getState().elements;

    useCadUiStore.getState().applySelection(elements, {
      selectedElementId: elements[0].id,
      selectedElementIds: [elements[0].id],
      selectionAnchorElementId: elements[0].id
    });

    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "elements" });
  });

  it("does not let reconcileSelectionWithElements repopulate a default element while a binding is selected", () => {
    useCadUiStore.getState().setSelectedBindingId("binding:x");
    const elements = useCadDocumentStore.getState().elements;

    useCadUiStore.getState().reconcileSelectionWithElements(elements);

    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "binding", bindingId: "binding:x" });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
  });

  it("preserves a genuinely empty selection while in elements mode", () => {
    useCadUiStore.setState({ selectedElementId: null, selectedElementIds: [], selectionAnchorElementId: null });
    const elements = useCadDocumentStore.getState().elements;

    useCadUiStore.getState().reconcileSelectionWithElements(elements);

    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "elements" });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(useCadUiStore.getState().selectionAnchorElementId).toBeNull();
  });

  it("preserves typed-binding ownership when clearing element fields", () => {
    const element = useCadDocumentStore.getState().elements[0]!;
    useCadUiStore.getState().setSelectedElementId(element.id);
    useCadUiStore.getState().setSelectedBindingId("binding:x");

    useCadUiStore.getState().clearElementSelection();

    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "binding", bindingId: "binding:x" });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
  });
});

describe("cadUiStore activity-aware element selection", () => {
  const elements: CadElement[] = [
    { id: "visible", name: "Visible", type: "freePoint", activity: "visible", x: 0, y: 0 },
    { id: "visible-second", name: "Visible Second", type: "freePoint", activity: "visible", x: 0, y: 1 },
    { id: "hidden", name: "Hidden", type: "freePoint", activity: "hidden", x: 1, y: 0 },
    { id: "disabled", name: "Disabled", type: "freePoint", activity: "disabled", x: 2, y: 0 },
    { id: "hidden-group", name: "Hidden Group", type: "group", activity: "hidden" },
    {
      id: "hidden-child",
      name: "Hidden Child",
      type: "freePoint",
      activity: "visible",
      parentGroupId: "hidden-group",
      x: 3,
      y: 0
    },
    { id: "disabled-group", name: "Disabled Group", type: "group", activity: "disabled" },
    {
      id: "disabled-child",
      name: "Disabled Child",
      type: "freePoint",
      activity: "visible",
      parentGroupId: "disabled-group",
      x: 4,
      y: 0
    },
    {
      id: "modifier-hidden",
      name: "Modifier Hidden",
      type: "freePoint",
      activity: "visible",
      modifierNames: ["hide"],
      x: 5,
      y: 0
    },
    {
      id: "modifier-disabled",
      name: "Modifier Disabled",
      type: "freePoint",
      activity: "visible",
      modifierNames: ["disable"],
      x: 6,
      y: 0
    },
  ];

  beforeEach(() => {
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.setState({ ...initialCadDocumentState(), elements });
  });

  it.each(["hidden", "disabled"] as const)("prunes directly %s elements", (activity) => {
    useCadUiStore.getState().applySelection(elements, {
      selectedElementId: activity,
      selectedElementIds: [activity],
      selectionAnchorElementId: activity
    });

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    });
  });

  it("prunes children whose ancestor is hidden or disabled", () => {
    useCadUiStore.getState().applySelection(elements, {
      selectedElementId: "hidden-child",
      selectedElementIds: ["hidden-child", "disabled-child"],
      selectionAnchorElementId: "hidden-child"
    });

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    });
  });

  it("uses Drawing Modifier state as selection activity", () => {
    useCadDocumentStore.setState({
      modifiers: [
        { name: "hide", state: "hidden" },
        { name: "disable", state: "disabled" }
      ]
    });
    useCadUiStore.getState().applySelection(elements, {
      selectedElementId: "modifier-hidden",
      selectedElementIds: ["modifier-hidden", "modifier-disabled"],
      selectionAnchorElementId: "modifier-disabled"
    });

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    });
  });

  it("preserves eligible order and normalizes invalid primary and anchor", () => {
    useCadUiStore.getState().applySelection(elements, {
      selectedElementId: "hidden",
      selectedElementIds: ["visible", "hidden", "visible-second"],
      selectionAnchorElementId: "disabled"
    });

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "visible",
      selectedElementIds: ["visible", "visible-second"],
      selectionAnchorElementId: "visible"
    });
  });

  it("preserves the current selection for a direct hidden or disabled target attempt", () => {
    useCadUiStore.getState().setSelectedElementId("visible");

    useCadUiStore.getState().setSelectedElementId("hidden");
    expect(useCadUiStore.getState().selectedElementId).toBe("visible");

    useCadUiStore.getState().setSelectedElementId("disabled");
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "visible",
      selectedElementIds: ["visible"],
      selectionAnchorElementId: "visible"
    });
  });
});

describe("cadUiStore CAD Canvas zoom safety", () => {
  beforeEach(() => {
    useCadUiStore.setState(initialCadUiState());
  });

  it("allows normal CAD zoom above the historical product ceiling", () => {
    useCadUiStore.getState().zoomCanvasViewportAt(100);

    expect(useCadUiStore.getState().canvasViewport.zoom).toBe(100);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "ignores invalid candidate zoom factor %s",
    (zoomFactor) => {
      useCadUiStore.getState().zoomCanvasViewportAt(zoomFactor);

      expect(useCadUiStore.getState().canvasViewport).toEqual(initialCadUiState().canvasViewport);
    }
  );

  it("rejects invalid direct CAD viewport zoom values", () => {
    useCadUiStore.getState().setCanvasViewport({ panX: 4, panY: 5, zoom: Number.NaN });

    expect(useCadUiStore.getState().canvasViewport).toEqual(initialCadUiState().canvasViewport);
  });
});
