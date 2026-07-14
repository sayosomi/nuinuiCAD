import { makeNumericExpression } from "../geometry/numericExpressions";
import {
  applyCreationPlacement,
  creationPlacementForEvaluationLimit
} from "../model/elementCreationPlacement";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElementType } from "../types/geometry";
import { sourceEditSession } from "../editor/sourceEditSession";
import {
  type CommandLineSession,
  currentStep,
  fillCurrentStep,
  insertionIndexForCommandLineSession,
  retreatStep,
  sessionCanConfirm,
  sessionIsStale,
  skipCurrentStep,
  startSession
} from "./commandLineSession";
import { creationRecipeForType, emitCreationRecipe, type CreationRecipe } from "./creationRecipes";
import type { CommandContext } from "./commandTypes";

const compositionError = "日本語入力の確定中はコマンドを実行できません。入力を確定してから再操作してください。";
const staleError = "ドキュメントが変更されたため、コマンドライン作成をキャンセルしました。もう一度開始してください。";

const clearStaleSession = () => {
  const ui = useCadUiStore.getState();
  ui.clearPickMode();
  ui.setCommandErrorMessage(staleError);
};

const isReferenceFreeRecipe = (recipe: CreationRecipe) =>
  recipe.steps.every((step) => step.kind === "number" || step.kind === "name");

const recipeForCommandLineType = (type: CadElementType) => {
  const recipe = creationRecipeForType(type);
  if (!recipe || !isReferenceFreeRecipe(recipe)) return null;
  return recipe;
};

/**
 * Begins or replaces a command-line creation session.  The temporary callers
 * are intentionally limited to reference-free recipes until Phase 4d routes
 * reference prompts through Canvas/source picking.
 */
export const startCommandLineCreation = (type: CadElementType, context?: CommandContext) => {
  if (sourceEditSession.isComposing()) {
    useCadUiStore.getState().setCommandErrorMessage(compositionError);
    return false;
  }
  const recipe = recipeForCommandLineType(type);
  if (!recipe) return false;

  const document = useCadDocumentStore.getState();
  const cursorElementId = context?.currentCursorElementId?.() ?? null;
  const cursorStatementIndex = cursorElementId
    ? document.elements.findIndex((element) => element.id === cursorElementId)
    : null;
  const fallbackPlacement = creationPlacementForEvaluationLimit(
    document.elements,
    document.evaluationLimitIndex,
    useCadUiStore.getState().groupFoldById
  );
  const insertionIndex = insertionIndexForCommandLineSession(cursorStatementIndex, fallbackPlacement);
  if (insertionIndex === null || insertionIndex === undefined) return false;

  // Re-entry ordering is intentional: nothing above mutates UI state, while
  // these three calls remove all pending Canvas/editor handoffs before the
  // store atomically replaces the old command-line and pick state.
  context?.clearPendingCanvasPointerIntent?.();
  context?.clearSourceEditorFocusReservation?.();
  const placement = creationPlacementForEvaluationLimit(
    document.elements,
    insertionIndex,
    useCadUiStore.getState().groupFoldById
  );
  useCadUiStore.getState().startCommandLineSession(startSession(recipe, {
    insertionIndex,
    revision: document.sourceRevision,
    elements: document.elements,
    placement
  }));
  useCadUiStore.getState().setCommandErrorMessage(null);
  return true;
};

/** Cancels the session and all pick state through the established unified path. */
export const cancelCommandLineSession = () => {
  if (!useCadUiStore.getState().commandLineSession) return false;
  useCadUiStore.getState().clearPickMode();
  return true;
};

/** Detects a document mutation while a session is displayed and rejects rebase/follow behavior. */
export const cancelStaleCommandLineSession = () => {
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || !sessionIsStale(session, useCadDocumentStore.getState().sourceRevision)) return false;
  clearStaleSession();
  return true;
};

const updateSession = (updater: (session: CommandLineSession) => CommandLineSession) => {
  const session = useCadUiStore.getState().commandLineSession;
  if (!session) return false;
  if (cancelStaleCommandLineSession()) return false;
  useCadUiStore.getState().setCommandLineSession(updater(session));
  return true;
};

/** Applies the current number/name prompt without creating a second React-side state machine. */
export const submitCommandLineInput = (input: string, context?: CommandContext) => {
  const session = useCadUiStore.getState().commandLineSession;
  if (!session) return false;
  if (cancelStaleCommandLineSession()) return false;
  const step = currentStep(session);
  if (!step) return confirmCommandLineSession(context);

  if (step.kind === "name") {
    return updateSession((current) => fillCurrentStep(current, input === "" ? current.nameSuggestion : input));
  }
  if (step.kind !== "number") return false;
  if (input === "") {
    const skipped = skipCurrentStep(session);
    if (skipped === session) return false;
    useCadUiStore.getState().setCommandLineSession(skipped);
    return true;
  }
  return updateSession((current) => fillCurrentStep(current, makeNumericExpression(input)));
};

export const skipCommandLineStep = () => {
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const next = skipCurrentStep(session);
  if (next === session) return false;
  useCadUiStore.getState().setCommandLineSession(next);
  return true;
};

export const retreatCommandLineStep = () => updateSession(retreatStep);

/**
 * Materializes a complete session once.  The document bridge owns line
 * splicing, source preservation, and the single undo entry.
 */
export const confirmCommandLineSession = (context?: CommandContext) => {
  const flushResult = sourceEditSession.flush("command-line-confirm");
  if (flushResult === "blocked-composition") {
    useCadUiStore.getState().setCommandErrorMessage(compositionError);
    return false;
  }
  const session = useCadUiStore.getState().commandLineSession;
  if (!session) return false;
  if (cancelStaleCommandLineSession()) return false;
  if (!sessionCanConfirm(session)) return false;

  const document = useCadDocumentStore.getState();
  // Keep the start-time index authoritative: this placement call derives only
  // its parent/reference context and never chooses a new insertion position.
  const placement = creationPlacementForEvaluationLimit(
    document.elements,
    session.insertionIndex,
    useCadUiStore.getState().groupFoldById
  );
  const emitted = emitCreationRecipe(session.recipe, session.args, {
    elements: document.elements,
    referenceElements: placement.referenceElements
  });
  const element = applyCreationPlacement(emitted, placement);
  const result = document.commitDocumentChange({
    elements: [
      ...document.elements.slice(0, session.insertionIndex),
      element,
      ...document.elements.slice(session.insertionIndex)
    ],
    selectedElementId: element.id,
    selectedElementIds: [element.id],
    selectionAnchorElementId: element.id
  });
  if (result.status !== "applied") return false;

  useCadUiStore.getState().clearPickMode();
  const focusSourceEditor = () => context?.focusElementList?.();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusSourceEditor);
  else setTimeout(focusSourceEditor, 0);
  return true;
};
