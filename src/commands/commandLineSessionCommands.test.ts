import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { referenceAnchor } from "../model/pointAnchors";
import { applyPickedPoint, cancelPointPick } from "./pickCommands";
import { selectElement } from "./selectionCommands";
import {
  cancelCommandLineStepEdit,
  cancelCommandLineSession,
  cancelStaleCommandLineSession,
  confirmCommandLineSession,
  skipCommandLineStep,
  startCommandLineCreation,
  startCommandLineCreationForRecipe,
  startCommandLineStepEdit,
  startCommandLineNumericReferencePick,
  submitCommandLineInput
} from "./commandLineSessionCommands";
import { commandLineCommandDefinitions } from "./commandLineCommandDefinitions";
import type { CreationRecipe } from "./creationRecipes";
import { legacyCreationCommandRecipeMap } from "./legacyCreationRecipes";

describe("command-line session commands", () => {
  let unregister = () => {};

  beforeEach(() => {
    unregister = () => {};
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText("nui 2", "test");
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
    const focusSourceEditor = vi.fn();

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
    expect(confirmCommandLineSession({ focusSourceEditor })).toBe(true);

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
    expect(focusSourceEditor).toHaveBeenCalledOnce();
  });

  it("returns a Source Editor creation to its first generated value", () => {
    const focusSourceEditorParameter = vi.fn();
    expect(startCommandLineCreation("freePoint", { sourceEditorCreation: true })).toBe(true);
    submitCommandLineInput("12");
    submitCommandLineInput("34");
    submitCommandLineInput("");

    expect(confirmCommandLineSession({ focusSourceEditorParameter })).toBe(true);
    const element = useCadDocumentStore.getState().elements[0]!;
    expect(focusSourceEditorParameter).toHaveBeenCalledWith(element.id, "x");
  });

  it("removes every temporary creation command after cutover", () => {
    for (const commandId of Object.keys(legacyCreationCommandRecipeMap)) {
      const temporaryId = `commandLine${commandId[0].toUpperCase()}${commandId.slice(1)}`;
      expect(commandLineCommandDefinitions).not.toHaveProperty(temporaryId);
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

  it("commits an edited value through the ghost validation path without rewinding later args", () => {
    expect(startCommandLineCreation("variable")).toBe(true);
    expect(submitCommandLineInput("3")).toBe(true);
    expect(submitCommandLineInput("変数 A")).toBe(true);
    const completed = useCadUiStore.getState().commandLineSession!;

    expect(startCommandLineStepEdit(0)).toBe(true);
    expect(submitCommandLineInput("12")).toBe(true);

    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: completed.currentStepIndex,
      editingStepIndex: null,
      args: {
        expression: 12,
        name: "変数 A"
      }
    });

    expect(startCommandLineStepEdit(1)).toBe(true);
    expect(submitCommandLineInput("変数 B")).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: completed.currentStepIndex,
      editingStepIndex: null,
      args: { expression: 12, name: "変数 B" }
    });
  });

  it("does not save an empty return-pick state for a completed-session edit", () => {
    expect(startCommandLineCreation("variable")).toBe(true);
    expect(submitCommandLineInput("3")).toBe(true);
    expect(skipCommandLineStep()).toBe(true);

    expect(startCommandLineStepEdit(0)).toBe(true);
    expect(useCadUiStore.getState().commandLineSession?.editingReturnPickState).toBeNull();
  });

  it("keeps missing-input and invalid mid-session edit drafts isolated at the original prompt", () => {
    expect(startCommandLineCreation("freePoint")).toBe(true);
    expect(submitCommandLineInput("3")).toBe(true);
    expect(startCommandLineStepEdit(0)).toBe(true);

    expect(submitCommandLineInput("(")).toBe(false);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 1,
      editingStepIndex: 0,
      editingDraft: { kind: "expression", expression: "(" },
      args: { x: 3 }
    });

    expect(cancelCommandLineStepEdit()).toBe(true);
    expect(submitCommandLineInput("4")).toBe(true);
    expect(startCommandLineStepEdit(0)).toBe(true);
    expect(submitCommandLineInput("(")).toBe(false);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 2,
      editingStepIndex: 0,
      editingDraft: { kind: "expression", expression: "(" },
      args: { x: 3, y: 4 }
    });
  });

  it("confirms a line start-point edit and returns to its unanswered end-point prompt", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 100 y: 0)"
    ].join("\n"), "test");
    const pointA = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;

    expect(startCommandLineCreation("line")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointA.id) });
    expect(startCommandLineStepEdit(0)).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });

    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 1,
      editingStepIndex: null,
      args: { startPoint: referenceAnchor(pointB.id) }
    });
    expect(useCadUiStore.getState().activePointPickTarget).toMatchObject({ parameterKey: "endPoint" });
  });

  it("confirms an edit when only a later defaulted number remains unanswered", () => {
    const recipe: CreationRecipe = {
      type: "angleLengthLine",
      steps: [
        { kind: "point", key: "startPoint", prompt: "始点" },
        { kind: "number", key: "angleDeg", prompt: "角度", default: "0" },
        { kind: "name", autoSuggest: true }
      ]
    };
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 100 y: 0)"
    ].join("\n"), "test");
    const pointA = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;

    expect(startCommandLineCreationForRecipe(recipe)).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointA.id) });
    expect(startCommandLineStepEdit(0)).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });

    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 1,
      editingStepIndex: null,
      args: { startPoint: referenceAnchor(pointB.id) }
    });
  });

  it("never restores an edited session's saved pick progress after stale cancellation or re-entry", () => {
    const source = ["nui 2", "point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 10 y: 0)"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const pointA = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;

    expect(startCommandLineCreation("line")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointA.id) });
    expect(startCommandLineStepEdit(0)).toBe(true);
    useCadDocumentStore.getState().commitText(`${source}\npoint C = coordinate(x: 20 y: 0)`, "test");

    expect(cancelStaleCommandLineSession()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
    expect(useCadUiStore.getState().activeLinePickTarget).toBeNull();
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toBeNull();

    expect(startCommandLineCreation("line")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointA.id) });
    expect(startCommandLineStepEdit(0)).toBe(true);
    expect(startCommandLineCreation("freePoint")).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({ recipe: { type: "freePoint" }, args: {} });
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
    expect(useCadUiStore.getState().activeLinePickTarget).toBeNull();
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toBeNull();
  });

  it("restores an active numeric-reference pick after cancelling a mid-session number edit", () => {
    expect(startCommandLineCreation("freePoint")).toBe(true);
    expect(submitCommandLineInput("3")).toBe(true);
    expect(startCommandLineNumericReferencePick()).toBe(true);
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({ parameterKey: "y" });
    useCadUiStore.setState({
      activeNumericReferencePickTarget: {
        ...useCadUiStore.getState().activeNumericReferencePickTarget!,
        property: "endTangentAngleDeg"
      }
    });

    expect(startCommandLineStepEdit(0)).toBe(true);
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toBeNull();
    expect(cancelCommandLineStepEdit()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 1,
      args: { x: 3 }
    });
    expect(useCadUiStore.getState().activeNumericReferencePickTarget).toMatchObject({
      parameterKey: "y",
      property: "endTangentAngleDeg"
    });
  });

  it("keeps an invalid edit draft and confirmed args when preview validation fails", () => {
    expect(startCommandLineCreation("variable")).toBe(true);
    submitCommandLineInput("3");
    submitCommandLineInput("変数 A");
    expect(startCommandLineStepEdit(0)).toBe(true);

    expect(submitCommandLineInput("(")).toBe(false);

    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 2,
      editingStepIndex: 0,
      editingDraft: { kind: "expression", expression: "(" },
      args: {
        expression: 3,
        name: "変数 A"
      }
    });
    expect(useCadUiStore.getState().commandLineSession?.error).toContain("プレビュー");
  });

  it("abandons an edit draft without changing the completed session", () => {
    expect(startCommandLineCreation("variable")).toBe(true);
    submitCommandLineInput("3");
    submitCommandLineInput("変数 A");
    const completed = useCadUiStore.getState().commandLineSession!;
    expect(startCommandLineStepEdit(0)).toBe(true);
    expect(submitCommandLineInput("12")).toBe(true);

    // Start a second edit and discard it; the first confirmed value remains.
    expect(startCommandLineStepEdit(0)).toBe(true);
    expect(cancelCommandLineStepEdit()).toBe(true);
    expect(useCadUiStore.getState().commandLineSession?.args).toEqual({
      expression: 12,
      name: completed.args.name
    });
  });

  it("promotes directly picked unnamed sources and inserts the new element in one undo entry", () => {
    const source = [
      "nui 2",
      "# このコメントは変えない",
      "point = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 10 y: 0)",
      "point = coordinate(x: 20 y: 0)"
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
    expect(document.sourceText).toContain("point 点 = coordinate(\n  x: 0\n  y: 0\n)");
    expect(document.sourceText).toContain("line = segment(\n  start: 点\n  end: B\n)");
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
      "nui 2",
      "group G {",
      "  point = coordinate(x: 0 y: 0)",
      "}",
      "point B = coordinate(x: 10 y: 0)"
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
    expect(useCadDocumentStore.getState().sourceText).toContain("line = segment(\n  start: G::点\n  end: B\n)");
  });

  it("leaves no provisional promotion behind when a stale session is rejected", () => {
    const source = ["nui 2", "point = coordinate(x: 0 y: 0)", "point B = coordinate(x: 10 y: 0)"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const [unnamed] = useCadDocumentStore.getState().elements.filter((element) => element.name === "");
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;

    expect(startCommandLineCreation("line")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(unnamed.id) });
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });
    expect(skipCommandLineStep()).toBe(true);
    useCadDocumentStore.getState().commitText(`${source}\npoint C = coordinate(x: 20 y: 0)`, "test");

    expect(confirmCommandLineSession()).toBe(false);
    expect(useCadDocumentStore.getState().sourceText).toBe(`${source}\npoint C = coordinate(x: 20 y: 0)`);
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === unnamed.id)?.name).toBe("");
  });

  it("leaves no provisional promotion behind when the final commit is rejected", () => {
    const source = ["nui 2", "point = coordinate(x: 0 y: 0)", "point B = coordinate(x: 10 y: 0)"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const [unnamed] = useCadDocumentStore.getState().elements.filter((element) => element.name === "");
    const pointB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;

    expect(startCommandLineCreation("line")).toBe(true);
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(unnamed.id) });
    applyPickedPoint({ pickedPointAnchor: referenceAnchor(pointB.id) });
    expect(skipCommandLineStep()).toBe(true);
    // initialCadDocumentState() resets state fields only, never store actions,
    // so the stub must be restored here or it leaks into every later test.
    const originalCommitDocumentChange = useCadDocumentStore.getState().commitDocumentChange;
    useCadDocumentStore.setState({
      commitDocumentChange: () => ({ status: "rejected", reason: "invalid-change" })
    });
    try {
      expect(confirmCommandLineSession()).toBe(false);
    } finally {
      useCadDocumentStore.setState({ commitDocumentChange: originalCommitDocumentChange });
    }
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === unnamed.id)?.name).toBe("");
  });

  it("uses the Source Editor cursor element index once and never follows later state", () => {
    useCadDocumentStore.getState().commitText([
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 10 y: 0)"
    ].join("\n"), "test");
    const pointB = useCadDocumentStore.getState().elements[1];

    expect(startCommandLineCreation("variable", { currentCursorElementId: () => pointB.id })).toBe(true);
    expect(useCadUiStore.getState().commandLineSession?.insertionIndex).toBe(1);
  });

  it("cancels immediately when an external revision makes the session stale", () => {
    expect(startCommandLineCreation("freePoint")).toBe(true);
    submitCommandLineInput("12");
    expect(useCadDocumentStore.getState().previewElements).not.toBeNull();
    useCadDocumentStore.getState().commitText("nui 2\npoint A = coordinate(x: 0 y: 0)", "test");

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

  it("confirms a step edit at a post-@stop insertion position where no ghost can exist", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "point A = coordinate(x: 0 y: 0)", "@stop", "point B = coordinate(x: 10 y: 10)", "point C = coordinate(x: 20 y: 20)"].join("\n"),
      "test"
    );
    const cursorElementId = useCadDocumentStore.getState().elements.find((element) => element.name === "C")!.id;
    expect(startCommandLineCreation("freePoint", { currentCursorElementId: () => cursorElementId })).toBe(true);
    submitCommandLineInput("1");
    submitCommandLineInput("2");
    submitCommandLineInput("");
    // The insertion position is outside the evaluator's reach, so no ghost exists.
    expect(useCadDocumentStore.getState().previewElements).toBeNull();

    expect(startCommandLineStepEdit(0)).toBe(true);
    expect(submitCommandLineInput("5")).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      editingStepIndex: null,
      error: null,
      args: { x: 5 }
    });

    const pastBefore = useCadDocumentStore.getState().past.length;
    expect(confirmCommandLineSession()).toBe(true);
    expect(useCadDocumentStore.getState().past.length).toBe(pastBefore + 1);
    expect(useCadDocumentStore.getState().sourceText).toContain("x: 5\n  y: 2");
  });

  it("confirms a step edit inside a disabled group where no ghost can exist", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "group G (enabled: false) {", "point A = coordinate(x: 0 y: 0)", "}"].join("\n"),
      "test"
    );
    const group = useCadDocumentStore.getState().elements.find((element) => element.type === "group")!;
    const cursorElementId = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!.id;
    // Collapsed groups place new elements at the top level; expand G so the
    // insertion really lands inside the disabled group.
    useCadUiStore.getState().setGroupFold(group.id, { expanded: true });
    expect(startCommandLineCreation("freePoint", { currentCursorElementId: () => cursorElementId })).toBe(true);
    submitCommandLineInput("1");
    submitCommandLineInput("2");
    submitCommandLineInput("");
    expect(useCadDocumentStore.getState().previewElements).toBeNull();

    expect(startCommandLineStepEdit(1)).toBe(true);
    expect(submitCommandLineInput("7")).toBe(true);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      editingStepIndex: null,
      error: null,
      args: { x: 1, y: 7 }
    });
  });

  it("still rejects an unparseable edit draft at a position without a ghost", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "point A = coordinate(x: 0 y: 0)", "@stop", "point B = coordinate(x: 10 y: 10)", "point C = coordinate(x: 20 y: 20)"].join("\n"),
      "test"
    );
    const cursorElementId = useCadDocumentStore.getState().elements.find((element) => element.name === "C")!.id;
    expect(startCommandLineCreation("freePoint", { currentCursorElementId: () => cursorElementId })).toBe(true);
    submitCommandLineInput("1");
    submitCommandLineInput("2");
    submitCommandLineInput("");
    expect(startCommandLineStepEdit(0)).toBe(true);

    expect(submitCommandLineInput("(")).toBe(false);

    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      editingStepIndex: 0,
      editingDraft: { kind: "expression", expression: "(" },
      args: { x: 1, y: 2 }
    });
    expect(useCadUiStore.getState().commandLineSession?.error).toContain("プレビュー");
  });

  it("keeps measurement-insert progress through selection changes and session cancel, resetting only on session start", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "point A = coordinate(x: 0 y: 0)", "point B = coordinate(x: 10 y: 0)"].join("\n"),
      "test"
    );
    const elements = useCadDocumentStore.getState().elements;
    const measurementTarget = {
      elementId: elements[0].id,
      parameterKey: "x" as never,
      mode: "distance" as const,
      point1Anchor: referenceAnchor(elements[0].id),
      point2Anchor: null,
      lineId: null,
      displayedExpression: "0",
      selectionStart: null,
      selectionEnd: null
    };
    useCadUiStore.setState({ activeMeasurementInsertTarget: measurementTarget });

    // Selection changes route through clearTransientSelectionUi → clearPickMode.
    selectElement(elements[1].id);
    expect(useCadUiStore.getState().activeMeasurementInsertTarget).toEqual(measurementTarget);

    // Plain pick-mode cancellation never touched the measurement either.
    cancelPointPick();
    expect(useCadUiStore.getState().activeMeasurementInsertTarget).toEqual(measurementTarget);

    // Starting a creation session is the one deliberate full replacement.
    expect(startCommandLineCreation("freePoint")).toBe(true);
    expect(useCadUiStore.getState().activeMeasurementInsertTarget).toBeNull();

    // Cancelling the session (clearPickMode path) leaves a measurement alone.
    useCadUiStore.setState({ activeMeasurementInsertTarget: measurementTarget });
    expect(cancelCommandLineSession()).toBe(true);
    expect(useCadUiStore.getState().activeMeasurementInsertTarget).toEqual(measurementTarget);
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
