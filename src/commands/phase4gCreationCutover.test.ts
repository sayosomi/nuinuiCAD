import { beforeEach, describe, expect, it } from "vitest";
import { referenceAnchor } from "../model/pointAnchors";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { submitCommandLineInput, skipCommandLineStep } from "./commandLineSessionCommands";
import { commands, dispatchCommand } from "./commands";
import { type CommandId } from "./commandTypes";
import { legacyCreationCommandRecipeMap, creationRecipeForLegacyCommand } from "./legacyCreationRecipes";

const temporaryIdFor = (commandId: string) =>
  `commandLine${commandId[0].toUpperCase()}${commandId.slice(1)}`;

describe("Phase 4g creation command cutover", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 100, y: 0)",
      "line AB = segment(start: @A, end: @B)"
    ].join("\n"), "test");
  });

  it("starts each normal creation command from the sole legacy command recipe mapping", () => {
    for (const commandId of Object.keys(legacyCreationCommandRecipeMap)) {
      const recipe = creationRecipeForLegacyCommand(commandId);
      expect(recipe, commandId).not.toBeNull();
      expect(dispatchCommand(commandId as CommandId), commandId).toBe(true);
      expect(useCadUiStore.getState().commandLineSession).toMatchObject({ recipe, args: {} });
      useCadUiStore.getState().clearPickMode();
    }
  });

  it("removes temporary ids from the registry without changing normal command ids", () => {
    for (const commandId of Object.keys(legacyCreationCommandRecipeMap)) {
      expect(commands).toHaveProperty(commandId);
      expect(commands).not.toHaveProperty(temporaryIdFor(commandId));
      expect(dispatchCommand(temporaryIdFor(commandId) as never)).toBe(false);
    }
  });

  it("does not auto-adopt the selected point or line when a normal creation command starts", () => {
    const document = useCadDocumentStore.getState();
    const pointA = document.elements.find((element) => element.name === "A")!;
    const lineAB = document.elements.find((element) => element.name === "AB")!;
    useCadUiStore.getState().setSelectedElementIds([pointA.id, lineAB.id]);

    for (const commandId of Object.keys(legacyCreationCommandRecipeMap)) {
      expect(dispatchCommand(commandId as CommandId), commandId).toBe(true);
      expect(useCadUiStore.getState().commandLineSession?.args, commandId).toEqual({});
      useCadUiStore.getState().clearPickMode();
    }
  });

  it("creates a 45 degree, 120 mm line through the normal command dispatch path", () => {
    const pointA = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;
    const historyBefore = useCadDocumentStore.getState().past.length;

    expect(dispatchCommand("addAngleLengthLine")).toBe(true);
    expect(useCadUiStore.getState().commandLineSession?.args).toEqual({});
    dispatchCommand("applyPickedPoint", { pickedPointAnchor: referenceAnchor(pointA.id) });
    expect(useCadUiStore.getState().commandLineSession?.args.startPoint).toEqual(referenceAnchor(pointA.id));
    expect(submitCommandLineInput("45")).toBe(true);
    expect(submitCommandLineInput("120")).toBe(true);
    expect(skipCommandLineStep()).toBe(true);
    expect(dispatchCommand("confirmCommandLineSession")).toBe(true);

    const document = useCadDocumentStore.getState();
    expect(document.past).toHaveLength(historyBefore + 1);
    expect(document.elements.at(-1)).toMatchObject({
      type: "angleLengthLine",
      startPoint: referenceAnchor(pointA.id),
      angleDeg: 45,
      length: 120,
      name: ""
    });
    expect(document.previewElements).toBeNull();
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
  });
});
