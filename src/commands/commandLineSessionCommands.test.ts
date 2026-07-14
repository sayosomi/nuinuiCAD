import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { referenceAnchor } from "../model/pointAnchors";
import { applyPickedPoint } from "./pickCommands";
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

  it("promotes directly picked unnamed sources and inserts the new element in one undo entry", () => {
    const source = [
      "nui 1",
      "# このコメントは変えない",
      "point = (0, 0)",
      "point B = (10, 0)",
      "point = (20, 0)"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const documentBefore = useCadDocumentStore.getState();
    const unnamed = documentBefore.elements.filter((element) => element.name === "");
    const pointB = documentBefore.elements.find((element) => element.name === "B")!;
    const pastBefore = documentBefore.past.length;

    expect(startCommandLineCreation("line")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(unnamed[0].id) });
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });
    expect(skipCommandLineStep()).toBe(true);
    expect(confirmCommandLineSession()).toBe(true);

    const document = useCadDocumentStore.getState();
    const promoted = document.elements.find((element) => element.id === unnamed[0].id)!;
    const inserted = document.elements.find((element) => element.type === "line")!;
    expect(document.past).toHaveLength(pastBefore + 1);
    expect(promoted.name).toBe("点");
    expect(document.elements.find((element) => element.id === unnamed[1].id)?.name).toBe("");
    expect(inserted.startPoint).toEqual(referenceAnchor(promoted.id));
    expect(document.sourceText).toContain("# このコメントは変えない");
    expect(document.sourceText).toContain("point 点 = (0, 0)");
    expect(document.sourceText).toContain("line = 点 -> B");
    expect(document.sourceText).not.toContain(promoted.id);

    const reloaded = compileDslDocument(document.sourceText);
    const reloadedPromoted = reloaded.document?.elements.find((element) => element.name === "点");
    const reloadedLine = reloaded.document?.elements.find((element) => element.type === "line");
    expect(reloaded.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(reloadedLine?.startPoint).toEqual(referenceAnchor(reloadedPromoted!.id));

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === unnamed[0].id)?.name).toBe("");
  });

  it("uses the promoted group-scoped name when serializing a root-level reference", () => {
    const source = [
      "nui 1",
      "group G {",
      "  point = (0, 0)",
      "}",
      "point B = (10, 0)"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const unnamed = useCadDocumentStore.getState().elements.find((element) => element.name === "")!;
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;

    expect(startCommandLineCreation("line")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(unnamed.id) });
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });
    expect(skipCommandLineStep()).toBe(true);
    expect(confirmCommandLineSession()).toBe(true);

    expect(useCadDocumentStore.getState().elements.find((element) => element.id === unnamed.id)?.name).toBe("点");
    expect(useCadDocumentStore.getState().sourceText).toContain("line = G::点 -> B");
  });

  it("leaves no provisional promotion behind when a stale session is rejected", () => {
    const source = ["nui 1", "point = (0, 0)", "point B = (10, 0)"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const [unnamed] = useCadDocumentStore.getState().elements.filter((element) => element.name === "");
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;

    expect(startCommandLineCreation("line")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(unnamed.id) });
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });
    expect(skipCommandLineStep()).toBe(true);
    useCadDocumentStore.getState().commitText(`${source}\npoint C = (20, 0)`, "test");

    expect(confirmCommandLineSession()).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(`${source}\npoint C = (20, 0)`);
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === unnamed.id)?.name).toBe("");
  });

  it("leaves no provisional promotion behind when the final commit is rejected", () => {
    const source = ["nui 1", "point = (0, 0)", "point B = (10, 0)"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const [unnamed] = useCadDocumentStore.getState().elements.filter((element) => element.name === "");
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;

    expect(startCommandLineCreation("line")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(unnamed.id) });
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });
    expect(skipCommandLineStep()).toBe(true);
    useCadDocumentStore.setState({
      commitDocumentChange: () => ({ status: "rejected", reason: "invalid-change" })
    });

    expect(confirmCommandLineSession()).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === unnamed.id)?.name).toBe("");
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
    expect(startCommandLineCreation("freePoint")).toBe(true);
    submitCommandLineInput("12");
    expect(useCadDocumentStore.getState().previewElements).not.toBeNull();
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "test");

    expect(cancelStaleCommandLineSession()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadUiStore.getState().commandErrorMessage).toContain("変更されたため");
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
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
    expect(useCadDocumentStore.getState().previewElements).toBeNull();

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
    expect(startCommandLineCreation("freePoint")).toBe(true);
    expect(submitCommandLineInput("12")).toBe(true);
    expect(useCadDocumentStore.getState().previewElements).not.toBeNull();
    useCadUiStore.getState().setActivePointPickTarget({ elementId: "pick" as never, parameterKey: "value" as never });

    expect(cancelCommandLineSession()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
    expect(useCadDocumentStore.getState().previewElements).toBeNull();
    expect(useCadDocumentStore.getState().previewEvaluationLimitIndex).toBeNull();
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
