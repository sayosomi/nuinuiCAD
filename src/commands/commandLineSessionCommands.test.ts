import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  cancelCommandLineSession,
  cancelStaleCommandLineSession,
  confirmCommandLineSession,
  skipCommandLineStep,
  startCommandLineCreation,
  submitCommandLineInput
} from "./commandLineSessionCommands";
import { commandLineCommandDefinitions } from "./commandLineCommandDefinitions";
import { legacyCreationCommandRecipeMap } from "./legacyCreationRecipes";

describe("command-line session commands", () => {
  let unregister = () => {};

  beforeEach(() => {
    unregister = () => {};
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText("nui 1", "test");
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    unregister();
    vi.unstubAllGlobals();
  });

  it("fills free-point values, adopts the suggested name on empty Enter, and commits once", () => {
    const focusElementList = vi.fn();

    expect(startCommandLineCreation("freePoint")).toBe(true);
    const started = useCadUiStore.getState().commandLineSession!;
    expect(started.currentStepIndex).toBe(0);

    submitCommandLineInput("12");
    submitCommandLineInput("waist / 2");
    const atName = useCadUiStore.getState().commandLineSession!;
    expect(atName.currentStepIndex).toBe(2);
    expect(atName.nameSuggestion).not.toBe("");

    submitCommandLineInput("");
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 3,
      args: { name: atName.nameSuggestion }
    });

    const pastBeforeConfirm = useCadDocumentStore.getState().past.length;
    expect(confirmCommandLineSession({ focusElementList })).toBe(true);

    const document = useCadDocumentStore.getState();
    expect(document.past).toHaveLength(pastBeforeConfirm + 1);
    expect(document.elements).toHaveLength(1);
    expect(document.elements[0]).toMatchObject({
      type: "freePoint",
      name: atName.nameSuggestion,
      x: 12,
      y: { kind: "expression", expression: "waist / 2" }
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(document.elements[0].id);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(focusElementList).toHaveBeenCalledOnce();
  });

  it("keeps every pre-cutover creation command available through a distinct temporary command-line id", () => {
    for (const commandId of Object.keys(legacyCreationCommandRecipeMap)) {
      const temporaryId = `commandLine${commandId[0].toUpperCase()}${commandId.slice(1)}`;
      expect(commandLineCommandDefinitions).toHaveProperty(temporaryId);
    }
  });

  it("makes an unnamed element only through explicit skip", () => {
    expect(startCommandLineCreation("variable")).toBe(true);
    submitCommandLineInput("3 + 4");
    expect(skipCommandLineStep()).toBe(true);

    const session = useCadUiStore.getState().commandLineSession!;
    expect(session.currentStepIndex).toBe(session.recipe.steps.length);
    expect(session.args).not.toHaveProperty("name");
    expect(confirmCommandLineSession()).toBe(true);
    expect(useCadDocumentStore.getState().elements[0]).toMatchObject({ type: "variable", name: "" });
  });

  it("uses the Source Editor cursor element index once and never follows later state", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "point A = (0, 0)",
      "point B = (10, 0)"
    ].join("\n"), "test");
    const pointB = useCadDocumentStore.getState().elements[1];

    expect(startCommandLineCreation("variable", { currentCursorElementId: () => pointB.id })).toBe(true);
    expect(useCadUiStore.getState().commandLineSession?.insertionIndex).toBe(1);
  });

  it("cancels immediately when an external revision makes the session stale", () => {
    expect(startCommandLineCreation("variable")).toBe(true);
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "test");

    expect(cancelStaleCommandLineSession()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadUiStore.getState().commandErrorMessage).toContain("変更されたため");
  });

  it("replaces only ephemeral canvas/session state and refuses re-entry during composition", () => {
    const calls: string[] = [];
    expect(startCommandLineCreation("freePoint", {
      clearPendingCanvasPointerIntent: () => calls.push("pointer"),
      clearSourceEditorFocusReservation: () => calls.push("focus")
    })).toBe(true);
    submitCommandLineInput("10");
    const pastBefore = useCadDocumentStore.getState().past.length;

    expect(startCommandLineCreation("variable", {
      clearPendingCanvasPointerIntent: () => calls.push("pointer"),
      clearSourceEditorFocusReservation: () => calls.push("focus")
    })).toBe(true);
    expect(calls).toEqual(["pointer", "focus", "pointer", "focus"]);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({ recipe: { type: "variable" }, args: {} });
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore);

    unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => true,
      flush: () => "blocked-composition"
    });
    const session = useCadUiStore.getState().commandLineSession;
    expect(startCommandLineCreation("freePoint", {
      clearPendingCanvasPointerIntent: () => calls.push("unexpected")
    })).toBe(false);
    expect(useCadUiStore.getState().commandLineSession).toBe(session);
    expect(calls).not.toContain("unexpected");
  });

  it("resets a same-command re-entry to its initial session without touching document history", () => {
    expect(startCommandLineCreation("variable")).toBe(true);
    submitCommandLineInput("12");
    const pastBefore = useCadDocumentStore.getState().past.length;

    expect(startCommandLineCreation("variable")).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      recipe: { type: "variable" },
      currentStepIndex: 0,
      args: {}
    });
    expect(useCadDocumentStore.getState().past).toHaveLength(pastBefore);
  });

  it("cancels the session and every integrated pick target together", () => {
    expect(startCommandLineCreation("variable")).toBe(true);
    useCadUiStore.getState().setActivePointPickTarget({ elementId: "pick" as never, parameterKey: "value" as never });

    expect(cancelCommandLineSession()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
  });

  it("does not commit when confirmation flush is blocked by composition", () => {
    expect(startCommandLineCreation("variable")).toBe(true);
    submitCommandLineInput("5");
    skipCommandLineStep();
    const before = useCadDocumentStore.getState().sourceText;
    unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => true,
      flush: () => "blocked-composition"
    });

    expect(confirmCommandLineSession()).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(before);
    expect(useCadUiStore.getState().commandLineSession).not.toBeNull();
  });
});
