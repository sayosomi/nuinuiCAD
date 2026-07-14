import { makeNumericExpression } from "../geometry/numericExpressions";
import {
  creationPlacementForEvaluationLimit,
  type ElementCreationPlacement
} from "../model/elementCreationPlacement";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import type { CadElement } from "../types/geometry";
import type {
  CreationArgumentValue,
  CreationArgs,
  CreationRecipe,
  CreationStep
} from "./creationRecipes";

/**
 * Uncommitted progress through a declarative creation recipe. This state never
 * owns an emit context or a materialized CAD element; those belong to 4c/4f.
 */
export type CommandLineSession = {
  recipe: CreationRecipe;
  args: CreationArgs;
  currentStepIndex: number;
  insertionIndex: number;
  startedAtRevision: number;
  nameSuggestion: string;
  error: string | null;
};

export type StartCommandLineSessionOptions = {
  insertionIndex: number;
  revision: number;
  elements: CadElement[];
  /** Existing creation-placement data when the caller has already resolved it. */
  placement?: Pick<ElementCreationPlacement, "insertionIndex" | "parentGroupId">;
};

export type CommandLineStepValue = CreationArgumentValue | string;

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const nameSuggestionFor = (recipe: CreationRecipe, options: StartCommandLineSessionOptions) => {
  const placement = options.placement ?? creationPlacementForEvaluationLimit(
    options.elements,
    options.insertionIndex
  );
  const fallbackBaseName = fallbackElementName(recipe.type);
  return makeUniqueElementName({
    elements: options.elements,
    requestedName: fallbackBaseName,
    fallbackBaseName,
    parentGroupId: placement.parentGroupId
  });
};

/**
 * Starts from a clean recipe state. Re-entry is deliberately not considered:
 * every call returns a new session and callers replace any existing one.
 */
export const startSession = (
  recipe: CreationRecipe,
  options: StartCommandLineSessionOptions
): CommandLineSession => ({
  recipe,
  args: {},
  currentStepIndex: 0,
  insertionIndex: options.insertionIndex,
  startedAtRevision: options.revision,
  nameSuggestion: nameSuggestionFor(recipe, options),
  error: null
});

/** Returns the prompt currently awaiting input, or null once the recipe is complete. */
export const currentStep = (session: CommandLineSession | null): CreationStep | null =>
  session?.recipe.steps[session.currentStepIndex] ?? null;

/** Records one explicit value for the current step and advances exactly one step. */
export const fillCurrentStep = (
  session: CommandLineSession,
  value: CommandLineStepValue
): CommandLineSession => {
  const step = currentStep(session);
  if (!step) return session;
  const args: CreationArgs = step.kind === "name"
    ? { ...session.args, name: value as string }
    : { ...session.args, [step.key]: value as CreationArgumentValue };
  return {
    ...session,
    args,
    currentStepIndex: session.currentStepIndex + 1,
    error: null
  };
};

/**
 * Skips only optional name input and number input with a declared default.
 * Name skipping intentionally preserves no fabricated name argument.
 */
export const skipCurrentStep = (session: CommandLineSession): CommandLineSession => {
  const step = currentStep(session);
  if (!step) return session;
  if (step.kind === "name") {
    const args = { ...session.args };
    delete args.name;
    return { ...session, args, currentStepIndex: session.currentStepIndex + 1, error: null };
  }
  if (step.kind !== "number" || step.default === undefined) return session;
  return {
    ...session,
    args: { ...session.args, [step.key]: makeNumericExpression(step.default) },
    currentStepIndex: session.currentStepIndex + 1,
    error: null
  };
};

/**
 * Returns to the preceding step and discards that step plus every later
 * confirmed value, preventing stale arguments from leaking into a re-entry.
 */
export const retreatStep = (session: CommandLineSession): CommandLineSession => {
  if (session.currentStepIndex <= 0) return session;
  const currentStepIndex = session.currentStepIndex - 1;
  const discardedKeys = new Set(
    session.recipe.steps.slice(currentStepIndex).map((step) => step.kind === "name" ? "name" : step.key)
  );
  const args = Object.fromEntries(
    Object.entries(session.args).filter(([key]) => !discardedKeys.has(key))
  ) as CreationArgs;
  return { ...session, args, currentStepIndex, error: null };
};

/**
 * Checks recipe progress only. Numeric evaluation, referenced-element
 * existence, and runtime value-shape validation remain evaluator concerns.
 */
export const sessionCanConfirm = (session: CommandLineSession) =>
  session.currentStepIndex >= session.recipe.steps.length &&
  session.recipe.steps.every((step) => step.kind === "name" || hasOwn(session.args, step.key));

/** True when a document commit has advanced the existing source revision. */
export const sessionIsStale = (session: CommandLineSession, currentRevision: number) =>
  session.startedAtRevision !== currentRevision;

/**
 * Chooses an already-resolved cursor statement index when available, otherwise
 * the insertion index from existing creation-placement logic. No editor types
 * or cursor lookup are introduced here.
 */
export const insertionIndexForCommandLineSession = (
  cursorStatementIndex: number | null | undefined,
  fallbackPlacement: Pick<ElementCreationPlacement, "insertionIndex">
) => (
  Number.isInteger(cursorStatementIndex) && (cursorStatementIndex ?? -1) >= 0
    ? cursorStatementIndex
    : fallbackPlacement.insertionIndex
);
