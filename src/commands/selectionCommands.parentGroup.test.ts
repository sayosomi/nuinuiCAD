import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { selectElement, selectParentGroup } from "./selectionCommands";

const group = (id: string, parentGroupId?: string) => ({
  id,
  name: id,
  type: "group",
  activity: "visible",
  parentGroupId
} as CadElement);

const point = (id: string, parentGroupId?: string) => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  parentGroupId,
  x: 0,
  y: 0
} as CadElement);

describe("selectParentGroup", () => {
  beforeEach(() => {
    useCadDocumentStore.setState({
      ...initialCadDocumentState(),
      elements: [
        group("outer"),
        group("inner", "outer"),
        point("child", "inner")
      ]
    });
    useCadUiStore.setState(initialCadUiState());
  });

  it("selects one parent identity at a time without expanding descendants", () => {
    selectElement("child");
    selectParentGroup();

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "inner",
      selectedElementIds: ["inner"],
      selectionAnchorElementId: "inner"
    });

    selectParentGroup();
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "outer",
      selectedElementIds: ["outer"],
      selectionAnchorElementId: "outer"
    });
  });

  it("does nothing when the selected identity has no parent", () => {
    selectElement("outer");
    selectParentGroup();

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "outer",
      selectedElementIds: ["outer"]
    });
  });
});
