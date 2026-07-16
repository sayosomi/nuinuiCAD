import { makeNumericExpression } from "../geometry/numericExpressions";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import {
  creationPlacementForEvaluationLimit,
  type ElementCreationPlacement
} from "../model/elementCreationPlacement";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import type { CadElement, ElementId } from "../types/geometry";
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
  /** The completed recipe step being revised without mutating `args`. */
  editingStepIndex: number | null;
  /** `null` is an explicit optional-name removal while editing. */
  editingDraft: CommandLineStepValue | null;
  /** Transient current-prompt pick progress to restore after an isolated edit. */
  editingReturnPickState: CommandLineEditingReturnPickState | null;
  insertionIndex: number;
  startedAtRevision: number;
  nameSuggestion: string;
  error: string | null;
  /** Keeps the completion handoff local to a creation begun from the DSL editor. */
  sourceEditorCreation?: boolean;
};

export type StartCommandLineSessionOptions = {
  insertionIndex: number;
  revision: number;
  elements: CadElement[];
  /** Existing creation-placement data when the caller has already resolved it. */
  placement?: Pick<ElementCreationPlacement, "insertionIndex" | "parentGroupId">;
  sourceEditorCreation?: boolean;
};

export type CommandLineStepValue = CreationArgumentValue | string;

/**
 * The small, non-derivable portion of a current command-line pick that an
 * isolated step edit temporarily replaces. Point/line target identity is
 * reconstructed from `currentStepIndex`; only transient user progress lives
 * here.
 */
export type CommandLineEditingReturnPickState = {
  /** Property selected by an explicit numeric-reference pick, or no active pick. */
  numericReferencePickProperty: NumericMeasurementKey | null;
  /** Unconfirmed multi-line selection owned by the active line-list prompt. */
  lineListDraftLineIds: ElementId[] | null;
  /** Candidate cursor owned by the active command-line reference prompt. */
  activePickCursor: { elementId: ElementId; optionIndex: number } | null;
};

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const cloneStepValue = (value: CommandLineStepValue | null) =>
  Array.isArray(value) ? [...value] : value;

const cloneEditingReturnPickState = (
  value: CommandLineEditingReturnPickState | null | undefined
) => value
  ? {
      ...value,
      lineListDraftLineIds: value.lineListDraftLineIds ? [...value.lineListDraftLineIds] : null,
      activePickCursor: value.activePickCursor ? { ...value.activePickCursor } : null
    }
  : null;

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
  editingStepIndex: null,
  editingDraft: null,
  editingReturnPickState: null,
  insertionIndex: options.insertionIndex,
  startedAtRevision: options.revision,
  nameSuggestion: nameSuggestionFor(recipe, options),
  error: null,
  sourceEditorCreation: options.sourceEditorCreation ?? false
});

const stepIndexFor = (session: CommandLineSession) =>
  session.editingStepIndex ?? session.currentStepIndex;

const keyForStep = (step: CreationStep) => step.kind === "name" ? "name" : step.key;

/** Returns the prompt currently awaiting input, including a dedicated edit target when active. */
export const currentStep = (session: CommandLineSession | null): CreationStep | null =>
  session?.recipe.steps[stepIndexFor(session)] ?? null;

export const isEditingCommandLineStep = (session: CommandLineSession) =>
  session.editingStepIndex !== null;

/** An edit that must return to an unfinished creation prompt when abandoned. */
export const isMidSessionStepEdit = (session: CommandLineSession) =>
  isEditingCommandLineStep(session) && session.currentStepIndex < session.recipe.steps.length;

/** Resolves the draft over confirmed args for preview/validation only. */
export const effectiveCommandLineArgs = (session: CommandLineSession): CreationArgs => {
  if (!isEditingCommandLineStep(session)) return session.args;
  const step = currentStep(session);
  if (!step) return session.args;
  const key = keyForStep(step);
  if (session.editingDraft === null && step.kind === "name") {
    const args = { ...session.args };
    delete args.name;
    return args;
  }
  return { ...session.args, [key]: session.editingDraft as CreationArgumentValue };
};

/** Begins editing one already-completed recipe step without changing confirmed args. */
export const beginStepEdit = (
  session: CommandLineSession,
  stepIndex: number,
  editingReturnPickState: CommandLineEditingReturnPickState | null = null
): CommandLineSession => {
  if (isEditingCommandLineStep(session) || stepIndex < 0 || stepIndex >= session.currentStepIndex) return session;
  const step = session.recipe.steps[stepIndex];
  if (!step) return session;
  const key = keyForStep(step);
  if (!hasOwn(session.args, key)) return session;
  const draft = session.args[key as keyof CreationArgs];
  if (draft === undefined) return session;
  return {
    ...session,
    editingStepIndex: stepIndex,
    editingDraft: cloneStepValue(draft),
    editingReturnPickState: cloneEditingReturnPickState(editingReturnPickState),
    error: null
  };
};

export const setEditingDraft = (
  session: CommandLineSession,
  draft: CommandLineStepValue | null
): CommandLineSession => isEditingCommandLineStep(session)
  ? { ...session, editingDraft: cloneStepValue(draft), error: null }
  : session;

/** Applies a validated edit draft and returns to the completed recipe summary. */
export const commitStepEdit = (session: CommandLineSession): CommandLineSession => {
  if (!isEditingCommandLineStep(session)) return session;
  const args = effectiveCommandLineArgs(session);
  return {
    ...session,
    args,
    editingStepIndex: null,
    editingDraft: null,
    editingReturnPickState: null,
    error: null
  };
};

export const cancelStepEdit = (session: CommandLineSession): CommandLineSession =>
  isEditingCommandLineStep(session)
    ? {
        ...session,
        editingStepIndex: null,
        editingDraft: null,
        editingReturnPickState: null,
        error: null
      }
    : session;

export const withCommandLineSessionError = (session: CommandLineSession, error: string) =>
  ({ ...session, error });

/** Records one explicit value for the current step and advances exactly one step. */
export const fillCurrentStep = (
  session: CommandLineSession,
  value: CommandLineStepValue
): CommandLineSession => {
  const step = currentStep(session);
  if (!step) return session;
  if (isEditingCommandLineStep(session)) return setEditingDraft(session, value);
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
    if (isEditingCommandLineStep(session)) return setEditingDraft(session, null);
    const args = { ...session.args };
    delete args.name;
    return { ...session, args, currentStepIndex: session.currentStepIndex + 1, error: null };
  }
  if (step.kind !== "number" || step.default === undefined) return session;
  if (isEditingCommandLineStep(session)) return setEditingDraft(session, makeNumericExpression(step.default));
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
  if (isEditingCommandLineStep(session)) return session;
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
  !isEditingCommandLineStep(session) &&
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
