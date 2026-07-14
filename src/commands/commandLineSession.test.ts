import { describe, expect, it } from "vitest";
import { creationPlacementForEvaluationLimit } from "../model/elementCreationPlacement";
import { referenceAnchor } from "../model/pointAnchors";
import { sampleElements } from "../sampleData";
import type { CadElement } from "../types/geometry";
import type { CreationRecipe } from "./creationRecipes";
import {
  currentStep,
  fillCurrentStep,
  insertionIndexForCommandLineSession,
  retreatStep,
  sessionCanConfirm,
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
    const placement = creationPlacementForEvaluationLimit(elements, 2, new Map([["group", { expanded: true }]]));
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

  it("chooses a resolved cursor statement index and otherwise uses existing placement", () => {
    const placement = { insertionIndex: 4 };
    expect(insertionIndexForCommandLineSession(2, placement)).toBe(2);
    expect(insertionIndexForCommandLineSession(null, placement)).toBe(4);
    expect(insertionIndexForCommandLineSession(-1, placement)).toBe(4);
  });
});
