import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
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
    publishTestCanvasSelectionEligibility(useCadDocumentStore.getState().elements);
  });

  it("selects one parent identity at a time without expanding descendants", () => {
    selectElement("child");
    selectParentGroup();

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "child",
      selectedElementIds: ["child"],
      selectionAnchorElementId: "child"
    });

    selectParentGroup();
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: "child",
      selectedElementIds: ["child"],
      selectionAnchorElementId: "child"
    });
  });

  it("does not admit a structural parent identity", () => {
    selectElement("outer");
    selectParentGroup();

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null
    });
  });
});
