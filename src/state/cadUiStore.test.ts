import { beforeEach, describe, expect, it } from "vitest";
import { initialCadUiState, useCadUiStore } from "./cadUiStore";
import { isElseExpanded, isGroupExpanded } from "../model/groups";
import { useCadDocumentStore } from "./cadDocumentStore";

describe("cadUiStore group fold state", () => {
  beforeEach(() => useCadUiStore.setState(initialCadUiState()));

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
});
