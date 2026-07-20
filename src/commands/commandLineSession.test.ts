import { describe, expect, it } from "vitest";
import { creationPlacementForTarget } from "../model/elementCreationPlacement";
import { referenceAnchor } from "../model/pointAnchors";
import { sampleElements } from "../sampleData";
import type { CadElement } from "../types/geometry";
import type { CreationRecipe } from "./creationRecipes";
import {
  beginStepEdit,
  cancelStepEdit,
  commitStepEdit,
  currentStep,
  effectiveCommandLineArgs,
  fillCurrentStep,
  isEditingCommandLineStep,
  retreatStep,
  sessionCanConfirm,
  setEditingDraft,
  sessionIsStale,
  skipCurrentStep,
  startSession
} from "./commandLineSession";

const recipe: CreationRecipe = {
  type: "line",
  steps: [
    { kind: "point", key: "startPoint", prompt: "始点" },
    { kind: "number", key: "offset", prompt: "オフセット", default: "12" },
    { kind: "name", autoSuggest: true }
  ]
};

const start = () => startSession(recipe, {
  insertionIndex: 1,
  revision: 7,
  elements: sampleElements
});

describe("commandLineSession", () => {
  it("starts cleanly every time without considering an existing session", () => {
    const first = fillCurrentStep(start(), referenceAnchor("point-a"));
    const restarted = start();

    expect(first.args).toHaveProperty("startPoint");
    expect(restarted).toMatchObject({ args: {}, currentStepIndex: 0, insertionIndex: 1, startedAtRevision: 7 });
    expect(restarted).not.toBe(first);
  });

  it("fills, skips permitted steps, and confirms only completed recipe progress", () => {
    const point = fillCurrentStep(start(), referenceAnchor(""));
    expect(currentStep(point)).toMatchObject({ kind: "number", key: "offset" });
    expect(sessionCanConfirm(point)).toBe(false);

    const withDefault = skipCurrentStep(point);
    expect(withDefault.args).toMatchObject({ offset: 12 });
    expect(currentStep(withDefault)).toEqual({ kind: "name", autoSuggest: true });

    const complete = skipCurrentStep(withDefault);
    expect(complete.args).not.toHaveProperty("name");
    expect(sessionCanConfirm(complete)).toBe(true);
  });

  it("does not revalidate references or numeric values while deciding confirmation", () => {
    const complete = {
      ...start(),
      currentStepIndex: recipe.steps.length,
      args: { startPoint: referenceAnchor("missing-point"), offset: { kind: "expression" as const, expression: "(" } }
    };

    expect(sessionCanConfirm(complete)).toBe(true);
    expect(sessionCanConfirm({ ...complete, args: { offset: 12 } })).toBe(false);
  });

  it("allows only names and defaulted numbers to be skipped", () => {
    const point = start();
    expect(skipCurrentStep(point)).toBe(point);
    const numberWithoutDefault: CreationRecipe = {
      ...recipe,
      steps: [{ kind: "number", key: "offset", prompt: "オフセット" }]
    };
    const session = startSession(numberWithoutDefault, { insertionIndex: 0, revision: 0, elements: [] });
    expect(skipCurrentStep(session)).toBe(session);
  });

  it("retreat discards the returned-to step and all later values", () => {
    const complete = fillCurrentStep(
      fillCurrentStep(
        fillCurrentStep(start(), referenceAnchor("point-a")),
        8
      ),
      "Line A"
    );
    const retreated = retreatStep(complete);
    expect(retreated.currentStepIndex).toBe(2);
    expect(retreated.args).toEqual({ startPoint: referenceAnchor("point-a"), offset: 8 });

    const retreatedAgain = retreatStep(retreated);
    expect(retreatedAgain.currentStepIndex).toBe(1);
    expect(retreatedAgain.args).toEqual({ startPoint: referenceAnchor("point-a") });
    const initial = start();
    expect(retreatStep(initial)).toBe(initial);
  });

  it("keeps an edited draft isolated until it is committed", () => {
    const complete = fillCurrentStep(
      fillCurrentStep(
        fillCurrentStep(start(), referenceAnchor("point-a")),
        8
      ),
      "Line A"
    );
    const editing = beginStepEdit(complete, 1);
    const drafted = setEditingDraft(editing, 24);

    expect(isEditingCommandLineStep(drafted)).toBe(true);
    expect(currentStep(drafted)).toMatchObject({ kind: "number", key: "offset" });
    expect(drafted.currentStepIndex).toBe(recipe.steps.length);
    expect(drafted.args).toEqual(complete.args);
    expect(effectiveCommandLineArgs(drafted)).toEqual({
      startPoint: referenceAnchor("point-a"),
      offset: 24,
      name: "Line A"
    });
    expect(retreatStep(drafted)).toBe(drafted);

    const committed = commitStepEdit(drafted);
    expect(committed).toMatchObject({
      currentStepIndex: recipe.steps.length,
      editingStepIndex: null,
      editingDraft: null,
      args: { startPoint: referenceAnchor("point-a"), offset: 24, name: "Line A" }
    });
  });

  it("edits an already-completed step mid-session and returns to its recorded prompt", () => {
    const partial = fillCurrentStep(start(), referenceAnchor("point-a"));
    const returnPickState = {
      numericReferencePickProperty: null,
      lineListDraftLineIds: null,
      activePickCursor: { elementId: "point-a", optionIndex: 0 }
    };

    const editing = beginStepEdit(partial, 0, returnPickState);
    expect(editing).toMatchObject({
      currentStepIndex: 1,
      editingStepIndex: 0,
      editingReturnPickState: returnPickState
    });
    expect(beginStepEdit(partial, 1)).toBe(partial);

    const committed = commitStepEdit(setEditingDraft(editing, referenceAnchor("point-b")));
    expect(committed).toMatchObject({
      currentStepIndex: 1,
      editingStepIndex: null,
      editingReturnPickState: null,
      args: { startPoint: referenceAnchor("point-b") }
    });
  });

  it("cancels an edit without changing the confirmed argument list", () => {
    const complete = fillCurrentStep(
      fillCurrentStep(
        fillCurrentStep(start(), referenceAnchor("point-a")),
        8
      ),
      "Line A"
    );
    const drafted = setEditingDraft(beginStepEdit(complete, 0), referenceAnchor("point-b"));
    const cancelled = cancelStepEdit(drafted);

    expect(cancelled.args).toEqual(complete.args);
    expect(cancelled.currentStepIndex).toBe(recipe.steps.length);
    expect(cancelled.editingStepIndex).toBeNull();
    expect(cancelled.editingDraft).toBeNull();
  });

  it("uses source revisions only for pure stale detection", () => {
    const session = start();
    expect(sessionIsStale(session, 7)).toBe(false);
    expect(sessionIsStale(session, 8)).toBe(true);
  });

  it("uses existing creation placement to scope unique name suggestions", () => {
    const rootSession = startSession(recipe, {
      insertionIndex: 1,
      revision: 0,
      elements: [{ ...sampleElements[3], name: "直線" }]
    });
    const group: CadElement = {
      id: "group",
      name: "Bodice",
      type: "group",
      visible: true,
      enabled: true
    };
    const existing = { ...sampleElements[0], id: "inside", name: "直線", parentGroupId: "group" };
    const elements = [group, existing];
    const placement = creationPlacementForTarget(elements, {
      insertionIndex: 2,
      parentGroupId: group.id
    }, undefined);
    const session = startSession(recipe, {
      insertionIndex: placement.insertionIndex,
      revision: 0,
      elements,
      placement
    });

    expect(rootSession.nameSuggestion).toBe("直線 2");
    expect(placement.parentGroupId).toBe("group");
    expect(session.nameSuggestion).toBe("直線 2");
  });

});
