import { makeNumericExpression } from "../geometry/numericExpressions";
import {
  applyCreationPlacement,
  creationPlacementForEvaluationLimit
} from "../model/elementCreationPlacement";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElementType } from "../types/geometry";
import { sourceEditSession } from "../editor/sourceEditSession";
import { isCommandLineInputComposing } from "./commandLineInputComposition";
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
import { creationRecipeForType, emitCreationRecipe } from "./creationRecipes";
import { COMMAND_LINE_PICK_TARGET_ID } from "./commandLinePickRouting";
import { promoteDirectlyReferencedUnnamedElements } from "./commandLineUnnamedPromotion";
import type { CommandContext } from "./commandTypes";

const compositionError = "日本語入力の確定中はコマンドを実行できません。入力を確定してから再操作してください。";
const staleError = "ドキュメントが変更されたため、コマンドライン作成をキャンセルしました。もう一度開始してください。";
const commitError = "コマンドライン作成を文書へ反映できませんでした。もう一度開始してください。";

const commandLineCompositionIsActive = () =>
  sourceEditSession.isComposing() || isCommandLineInputComposing();

const clearStaleSession = () => {
  const ui = useCadUiStore.getState();
  ui.clearPickMode();
  ui.setCommandErrorMessage(staleError);
};

const recipeForCommandLineType = (type: CadElementType) => {
  const recipe = creationRecipeForType(type);
  return recipe;
};

const setSessionAndSyncPickTarget = (session: CommandLineSession) => {
  useCadUiStore.getState().setCommandLineSession(session);
  syncCommandLinePickTarget(session);
};

/**
 * Keeps command-line reference prompts on the shared virtual-target pick
 * infrastructure.  This only writes ephemeral pick state; it never creates a
 * document mutation while the session is in progress.
 */
export const syncCommandLinePickTarget = (session = useCadUiStore.getState().commandLineSession) => {
  const step = currentStep(session);
  const target = step && step.kind !== "number" && step.kind !== "name"
    ? {
        elementId: COMMAND_LINE_PICK_TARGET_ID,
        parameterKey: step.key,
        insertionIndex: session!.insertionIndex
      }
    : null;

  if (step?.kind === "point" || step?.kind === "endpoint") {
    useCadUiStore.setState({
      activePointPickTarget: target,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: null,
      activePickCursor: null
    });
    return;
  }
  if (step?.kind === "line") {
    useCadUiStore.setState({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: target,
      activePickCursor: null
    });
    return;
  }
  if (step?.kind === "lineList") {
    useCadUiStore.setState({
      activePointPickTarget: null,
      activeNumericReferencePickTarget: null,
      activeLinePickTarget: target ? { ...target, draftLineIds: [] } : null,
      activePickCursor: null
    });
    return;
  }
  useCadUiStore.setState({
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activePickCursor: null
  });
};

/**
 * Begins or replaces a command-line creation session.  The temporary callers
 * use the same virtual-target pick infrastructure as template insertion.
 */
export const startCommandLineCreation = (type: CadElementType, context?: CommandContext) => {
  if (commandLineCompositionIsActive()) {
    useCadUiStore.getState().setCommandErrorMessage(compositionError);
    return false;
  }
  if (sourceEditSession.flush("command") === "blocked-composition") {
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
  syncCommandLinePickTarget();
  useCadUiStore.getState().setCommandErrorMessage(null);
  return true;
};

/** Cancels the session and all pick state through the established unified path. */
export const cancelCommandLineSession = () => {
  if (commandLineCompositionIsActive()) return false;
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
  setSessionAndSyncPickTarget(updater(session));
  return true;
};

/**
 * The sole session-argument fill path. Phase 4f will attach partial preview
 * updates here, after the value has been accepted but before final commit.
 */
export const fillCommandLineCurrentStep = (value: Parameters<typeof fillCurrentStep>[1]) =>
  updateSession((session) => fillCurrentStep(session, value));

/** Starts a normal shared numeric-reference pick for the current number prompt. */
export const startCommandLineNumericReferencePick = () => {
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const step = currentStep(session);
  if (step?.kind !== "number") return false;
  useCadUiStore.setState({
    activePointPickTarget: null,
    activeLinePickTarget: null,
    activeNumericReferencePickTarget: {
      elementId: COMMAND_LINE_PICK_TARGET_ID,
      parameterKey: step.key,
      insertionIndex: session.insertionIndex,
      mode: "replace",
      property: "length"
    },
    activePickCursor: null
  });
  return true;
};

/** Applies the current number/name prompt without creating a second React-side state machine. */
export const submitCommandLineInput = (input: string, context?: CommandContext) => {
  if (commandLineCompositionIsActive()) return false;
  const session = useCadUiStore.getState().commandLineSession;
  if (!session) return false;
  if (cancelStaleCommandLineSession()) return false;
  const step = currentStep(session);
  if (!step) return confirmCommandLineSession(context);

  if (step.kind === "name") {
    return fillCommandLineCurrentStep(input === "" ? session.nameSuggestion : input);
  }
  if (step.kind !== "number") return false;
  if (input === "") {
    const skipped = skipCurrentStep(session);
    if (skipped === session) return false;
    setSessionAndSyncPickTarget(skipped);
    return true;
  }
  return fillCommandLineCurrentStep(makeNumericExpression(input));
};

export const skipCommandLineStep = () => {
  if (commandLineCompositionIsActive()) return false;
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const next = skipCurrentStep(session);
  if (next === session) return false;
  setSessionAndSyncPickTarget(next);
  return true;
};

export const retreatCommandLineStep = () =>
  commandLineCompositionIsActive() ? false : updateSession(retreatStep);

/**
 * Materializes a complete session once.  The document bridge owns line
 * splicing, source preservation, and the single undo entry.
 */
export const confirmCommandLineSession = (context?: CommandContext) => {
  if (commandLineCompositionIsActive()) return false;
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
  const promotion = promoteDirectlyReferencedUnnamedElements(session, document.elements);
  // Keep the start-time index authoritative: this placement call derives only
  // its parent/reference context and never chooses a new insertion position.
  const placement = creationPlacementForEvaluationLimit(
    promotion.elements,
    session.insertionIndex,
    useCadUiStore.getState().groupFoldById
  );
  const emitted = emitCreationRecipe(session.recipe, session.args, {
    elements: promotion.elements,
    referenceElements: placement.referenceElements
  });
  const element = applyCreationPlacement(emitted, placement);
  const result = document.commitDocumentChange({
    elements: [
      ...promotion.elements.slice(0, session.insertionIndex),
      element,
      ...promotion.elements.slice(session.insertionIndex)
    ],
    selectedElementId: element.id,
    selectedElementIds: [element.id],
    selectionAnchorElementId: element.id
  });
  if (result.status !== "applied") {
    const ui = useCadUiStore.getState();
    ui.clearPickMode();
    ui.setCommandErrorMessage(commitError);
    return false;
  }

  useCadUiStore.getState().clearPickMode();
  const focusSourceEditor = () => context?.focusElementList?.();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusSourceEditor);
  else setTimeout(focusSourceEditor, 0);
  return true;
};
