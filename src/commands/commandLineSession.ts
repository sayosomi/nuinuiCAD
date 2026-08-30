import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import {
  creationPlacementForEvaluationLimit,
  type ElementCreationPlacement,
  type ElementCreationTarget
} from "../model/elementCreationPlacement";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import type { CadElement, ElementId } from "../types/geometry";
import type {
  CreationArgumentValue,
  CreationArgs,
  CreationRecipe,
  CreationStep
} from "./creationRecipes";
import type { CommandLineInsertionAnchor } from "./commandLineInsertionAnchor";

/**
 * Uncommitted progress through a declarative creation recipe. This state never
 * owns an emit context || a materialized CAD element; those belong to 4c/4f.
 */
export type CommandLineSession = {
  recipe: CreationRecipe;
  args: CreationArgs;
  currentStepIndex: number;
  /** The completed recipe step being revised without mutating `args`. */
  editingStepIndex: number | null;
  /** `null` is an explicit active-argument removal while editing. */
  editingDraft: CommandLineStepValue | null;
  /** Transient current-prompt pick progress to restore after an isolated edit. */
  editingReturnPickState: CommandLineEditingReturnPickState | null;
  /** Semantic target re-resolved for final commit; never commit against this cached index alone. */
  insertionAnchor: CommandLineInsertionAnchor;
  /** Flat position && parent scope are preserved together for all creation paths. */
  insertionTarget: ElementCreationTarget;
  /** Physical source line to preserve when the session started in Source Editor. */
  sourceInsertionLine: number | null;
  /** Stable only while startedAtRevision matches the document; used for session UI && previews. */
  insertionIndex: number;
  startedAtRevision: number;
  nameSuggestion: string;
  error: string | null;
};

export type StartCommandLineSessionOptions = {
  /** Callers creating real sessions must provide this; the derived fallback keeps isolated legacy tests focused. */
  insertionAnchor?: CommandLineInsertionAnchor;
  insertionIndex: number;
  insertionTarget?: ElementCreationTarget;
  sourceInsertionLine?: number | null;
  revision: number;
  elements: CadElement[];
  /** Existing creation-placement data when the caller has already resolved it. */
  placement?: Pick<ElementCreationPlacement, "insertionIndex" | "parentGroupId">;
};

export type CommandLineStepValue = CreationArgumentValue | string;

/**
 * The small, non-derivable portion of a current command-line pick that an
 * isolated step edit temporarily replaces. Point/line target identity is
 * reconstructed from `currentStepIndex`; only transient user progress lives
 * here.
 */
export type CommandLineEditingReturnPickState = {
  /** Property selected by an explicit numeric-reference pick, || no active pick. */
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
 * every call returns a new session && callers replace any existing one.
 */
export const startSession = (
  recipe: CreationRecipe,
  options: StartCommandLineSessionOptions
): CommandLineSession => {
  const insertionAnchor = options.insertionAnchor ?? (
    options.insertionIndex >= options.elements.length
      ? { kind: "documentEnd" as const }
      : options.insertionIndex > 0
        ? { kind: "afterElement" as const, elementId: options.elements[options.insertionIndex - 1].id }
        : { kind: "documentEnd" as const }
  );
  const insertionTarget = options.insertionTarget ?? {
    insertionIndex: options.insertionIndex,
    ...(options.placement?.parentGroupId ? { parentGroupId: options.placement.parentGroupId } : {})
  };
  return {
    recipe,
    args: {},
    currentStepIndex: 0,
    editingStepIndex: null,
    editingDraft: null,
    editingReturnPickState: null,
    insertionAnchor,
    insertionTarget,
    sourceInsertionLine: options.sourceInsertionLine ?? null,
    insertionIndex: options.insertionIndex,
    startedAtRevision: options.revision,
    nameSuggestion: nameSuggestionFor(recipe, options),
    error: null
  };
};

const stepIndexFor = (session: CommandLineSession) =>
  session.editingStepIndex ?? session.currentStepIndex;

const keyForStep = (step: CreationStep) => step.kind === "name" ? "name" : step.key;

/** Returns the prompt currently awaiting input, including a dedicated edit target when active. */
export const currentStep = (session: CommandLineSession | null): CreationStep | null =>
  session?.recipe.steps[stepIndexFor(session)] ?? null;

export const isEditingCommandLineStep = (session: CommandLineSession) =>
  session.editingStepIndex !== null;

/** Returns whether a recipe step has an actual supplied argument value. */
export const hasCommandLineStepValue = (
  session: CommandLineSession,
  stepIndex: number
) => {
  const step = session.recipe.steps[stepIndex];
  if (!step) return false;
  const key = keyForStep(step);
  return hasOwn(session.args, key) && session.args[key as keyof CreationArgs] !== undefined;
};

/** Activates any recipe step without changing the supplied argument values. */
export const activateStep = (
  session: CommandLineSession,
  stepIndex: number
): CommandLineSession => {
  if (
    isEditingCommandLineStep(session) ||
    !Number.isInteger(stepIndex) ||
    stepIndex < 0 ||
    stepIndex > session.recipe.steps.length
  ) return session;
  if (session.currentStepIndex === stepIndex) return session;
  return { ...session, currentStepIndex: stepIndex, error: null };
};

/** An edit that must return to an unfinished creation prompt when abandoned. */
export const isMidSessionStepEdit = (session: CommandLineSession) =>
  isEditingCommandLineStep(session) && session.currentStepIndex < session.recipe.steps.length;

/** Resolves the draft over confirmed args for preview/validation only. */
export const effectiveCommandLineArgs = (session: CommandLineSession): CreationArgs => {
  if (!isEditingCommandLineStep(session)) return session.args;
  const step = currentStep(session);
  if (!step) return session.args;
  const key = keyForStep(step);
  if (session.editingDraft === null) {
    const args = { ...session.args };
    delete args[key as keyof CreationArgs];
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

/** Applies a validated edit draft && returns to the completed recipe summary. */
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

/** Records one explicit value for the current step && advances exactly one step. */
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

/** Skips the current step without fabricating or retaining its argument. */
export const skipCurrentStep = (session: CommandLineSession): CommandLineSession => {
  const step = currentStep(session);
  if (!step) return session;
  if (isEditingCommandLineStep(session)) return setEditingDraft(session, null);
  if (step.kind === "name") {
    const args = { ...session.args };
    delete args.name;
    return { ...session, args, currentStepIndex: session.currentStepIndex + 1, error: null };
  }
  const args = { ...session.args };
  delete args[step.key];
  return { ...session, args, currentStepIndex: session.currentStepIndex + 1, error: null };
};

/** Returns to the preceding step while preserving every supplied argument. */
export const retreatStep = (session: CommandLineSession): CommandLineSession => {
  if (isEditingCommandLineStep(session)) return session;
  if (session.currentStepIndex <= 0) return session;
  return { ...session, currentStepIndex: session.currentStepIndex - 1, error: null };
};

/** Moves directly to final review, preserving supplied values and blank holes. */
export const skipUnfilledStepsToReview = (session: CommandLineSession): CommandLineSession => {
  if (isEditingCommandLineStep(session)) return session;
  const args = { ...session.args };
  let removedUndefinedValue = false;
  for (const step of session.recipe.steps) {
    const key = keyForStep(step);
    if (hasOwn(args, key) && args[key as keyof CreationArgs] === undefined) {
      delete args[key as keyof CreationArgs];
      removedUndefinedValue = true;
    }
  }
  if (!removedUndefinedValue && session.currentStepIndex === session.recipe.steps.length) return session;
  return {
    ...session,
    args,
    currentStepIndex: session.recipe.steps.length,
    error: null
  };
};

/**
 * Checks recipe progress only. Numeric evaluation, referenced-element
 * existence, && runtime value-shape validation remain evaluator concerns.
 * Reaching the end of the recipe is sufficient on its own now: skipCurrentStep
 * advances past every step kind, filled || left blank, so a per-step
 * hasOwn(args, key) check would incorrectly reject a session with legitimate
 * blank (draft) steps. The confirm layer classifies filled vs. blank steps
 * itself to choose between materializing a CadElement && emitting a draft
 * DSL statement.
 */
export const sessionCanConfirm = (session: CommandLineSession) =>
  !isEditingCommandLineStep(session) &&
  session.currentStepIndex >= session.recipe.steps.length;

/** True when a document commit has advanced the existing source revision. */
export const sessionIsStale = (session: CommandLineSession, currentRevision: number) =>
  session.startedAtRevision !== currentRevision;
