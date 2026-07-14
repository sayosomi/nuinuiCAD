import { beforeEach, describe, expect, it } from "vitest";
import { initialCadUiState, useCadUiStore } from "./cadUiStore";
import { isElseExpanded, isGroupExpanded } from "../model/groups";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";
import { startSession } from "../commands/commandLineSession";
import type { CreationRecipe } from "../commands/creationRecipes";

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

  it("uses the legacy visual defaults for unregistered ids and supports set/toggle", () => {
    const store = useCadUiStore.getState();
    expect(isGroupExpanded("group", store.groupFoldById)).toBe(false);
    expect(isElseExpanded("group", store.groupFoldById)).toBe(true);

    store.setGroupFold("group", { expanded: true });
    store.toggleElseExpanded("group");
    store.toggleGroupExpanded("group");

    const fold = useCadUiStore.getState().groupFoldById;
    expect(isGroupExpanded("group", fold)).toBe(false);
    expect(isElseExpanded("group", fold)).toBe(false);
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
      activeTemplateInsertion: {} as never,
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
      activeTemplateInsertion: null,
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
});
