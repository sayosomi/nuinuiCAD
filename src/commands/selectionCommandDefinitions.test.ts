import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
import { selectionCommandDefinitions } from "./selectionCommandDefinitions";

describe("selection move commands", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("moves only the cursor-owned group and its complete subtree", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "point Before = coordinate(x: 0, y: 0)",
      "group G {",
      "  point Child = coordinate(x: 1, y: 1)",
      "}",
      "point After = coordinate(x: 2, y: 2)"
    ].join("\n"), "test");
    const elements = useCadDocumentStore.getState().elements;
    publishTestCanvasSelectionEligibility(elements);
    const group = elements.find((element) => element.name === "G")!;
    useCadUiStore.getState().setSelectedElementIds(elements.map((element) => element.id), elements[0]!.id);

    selectionCommandDefinitions.moveSelectedElementUp.run({
      elementId: group.id,
      moveCursorElementOnly: true
    });

    expect(useCadDocumentStore.getState().elements.map((element) => element.name)).toEqual([
      "G", "Child", "Before", "After"
    ]);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([
      elements.find((element) => element.name === "Before")!.id,
      elements.find((element) => element.name === "Child")!.id,
      elements.find((element) => element.name === "After")!.id
    ]);
    expect(useCadUiStore.getState().selectedElementId).toBe(elements.find((element) => element.name === "Before")!.id);
    expect(useCadDocumentStore.getState().sourceText).toMatch(
      /group G \{\n {2}point Child = coordinate\(x: 1, y: 1\)\n\}\npoint Before/
    );
  });
});

describe("Canvas selection commands", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("clears single and multi-selection through the shared selection owner", () => {
    const elements = useCadDocumentStore.getState().elements;
    useCadUiStore.getState().setSelectedElementIds(elements.slice(0, 2).map((element) => element.id));

    selectionCommandDefinitions.clearCanvasSelection.run();

    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(useCadUiStore.getState().selectionAnchorElementId).toBeNull();
  });

  it("does not declare a default ArrowLeft shortcut for parent-group selection", () => {
    expect("shortcuts" in selectionCommandDefinitions.selectParentGroup).toBe(false);
  });
});
