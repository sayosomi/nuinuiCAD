import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { selectionCommandDefinitions } from "./selectionCommandDefinitions";

describe("selection move commands", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("moves only the cursor-owned group and its complete subtree", () => {
    useCadDocumentStore.getState().commitText([
      "nui 4",
      "point Before = coordinate(x: 0, y: 0)",
      "group G {",
      "  point Child = coordinate(x: 1, y: 1)",
      "}",
      "point After = coordinate(x: 2, y: 2)"
    ].join("\n"), "test");
    const elements = useCadDocumentStore.getState().elements;
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
      group.id,
      elements.find((element) => element.name === "Child")!.id
    ]);
    expect(useCadUiStore.getState().selectedElementId).toBe(group.id);
    expect(useCadDocumentStore.getState().sourceText).toMatch(
      /group G \{\n {2}point Child = coordinate\(x: 1, y: 1\)\n\}\npoint Before/
    );
  });
});
