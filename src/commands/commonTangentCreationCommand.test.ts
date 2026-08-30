import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { commands, dispatchCommand } from "./commands";
import { creationRecipeForLegacyCommand } from "./legacyCreationRecipes";

describe("common tangent creation command", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText("nui 4", "test");
  });

  it("starts the shared command-line creation recipe from the palette command", () => {
    const recipe = creationRecipeForLegacyCommand("addCommonTangentLine");
    expect(recipe).not.toBeNull();
    expect(recipe!.type).toBe("commonTangentLine");
    expect(recipe!.steps.map((step) => step.kind === "name" ? "name" : step.key)).toEqual([
      "name",
      "firstLineId",
      "secondLineId"
    ]);
    expect(commands.addCommonTangentLine).toMatchObject({
      label: "Add Common Tangent",
      palette: { order: 8.75 }
    });

    expect(dispatchCommand("addCommonTangentLine")).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      recipe,
      args: {}
    });
  });
});
