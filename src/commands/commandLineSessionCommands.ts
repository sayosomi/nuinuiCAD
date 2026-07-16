import { makeNumericExpression } from "../geometry/numericExpressions";
import { numericExpressionSyntaxIsValid } from "../geometry/numericExpressionParser";
import { initialNumericReferencePickProperty } from "../geometry/numericReferenceProperties";
import {
  applyCreationPlacement,
  creationPlacementForEvaluationLimit
} from "../model/elementCreationPlacement";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElementType } from "../types/geometry";
import { sourceEditSession } from "../editor/sourceEditSession";
import { isCommandLineInputComposing } from "./commandLineInputComposition";
import { commitDocumentChangeAndSelect } from "./commitDocumentChangeAndSelect";
import {
  beginStepEdit,
  cancelStepEdit,
  commitStepEdit,
  type CommandLineSession,
  currentStep,
  fillCurrentStep,
  insertionIndexForCommandLineSession,
  isEditingCommandLineStep,
  retreatStep,
  sessionCanConfirm,
  sessionIsStale,
  skipCurrentStep,
  startSession,
  withCommandLineSessionError
} from "./commandLineSession";
import {
  creationRecipeForType,
  emitCreationRecipe,
  type CreationRecipe
} from "./creationRecipes";
import { COMMAND_LINE_PICK_TARGET_ID } from "./commandLinePickRouting";
import {
  commandLinePickStateForSession,
  editingReturnPickStateFor
} from "./commandLineSessionPickState";
import { clearCommandLineGhostPreview, syncCommandLineGhostPreview } from "./commandLineGhostPreview";
import { promoteDirectlyReferencedUnnamedElements } from "./commandLineUnnamedPromotion";
import type { CommandContext } from "./commandTypes";

const compositionError = "日本語入力の確定中はコマンドを実行できません。入力を確定してから再操作してください。";
const staleError = "ドキュメントが変更されたため、コマンドライン作成をキャンセルしました。もう一度開始してください。";
const commitError = "コマンドライン作成を文書へ反映できませんでした。もう一度開始してください。";
const editValidationError = "編集値をプレビューできません。値または参照を確認してください。";

const commandLineCompositionIsActive = () =>
  sourceEditSession.isComposing() || isCommandLineInputComposing();

const clearStaleSession = () => {
  const ui = useCadUiStore.getState();
  clearCommandLineGhostPreview();
  ui.clearPickMode();
  ui.setCommandErrorMessage(staleError);
};

/**
 * Updates session progress and every command-line-owned pick field together so
 * observers never see a prompt for one step paired with another step's target.
 */
const setSessionAndSyncPickTarget = (
  session: CommandLineSession,
  restoredPickState: CommandLineSession["editingReturnPickState"] = null
) => {
  useCadUiStore.setState({
    commandLineSession: session,
    ...commandLinePickStateForSession(session, restoredPickState)
  });
  return syncCommandLineGhostPreview(session);
};

/**
 * Keeps command-line reference prompts on the shared virtual-target pick
 * infrastructure.  This only writes ephemeral pick state; it never creates a
 * document mutation while the session is in progress.
 */
export const syncCommandLinePickTarget = (session = useCadUiStore.getState().commandLineSession) => {
  useCadUiStore.setState(commandLinePickStateForSession(session));
};

/**
 * Begins or replaces a command-line creation session through the same
 * virtual-target pick infrastructure used by template insertion.
 */
export const startCommandLineCreationForRecipe = (
  recipe: CreationRecipe,
  context?: CommandContext
) => {
  if (commandLineCompositionIsActive()) {
    useCadUiStore.getState().setCommandErrorMessage(compositionError);
    return false;
  }
  if (sourceEditSession.flush("command") === "blocked-composition") {
    useCadUiStore.getState().setCommandErrorMessage(compositionError);
    return false;
  }
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
  clearCommandLineGhostPreview();
  useCadUiStore.getState().startCommandLineSession(startSession(recipe, {
    insertionIndex,
    revision: document.sourceRevision,
    elements: document.elements,
    placement,
    sourceEditorCreation: context?.sourceEditorCreation
  }));
  syncCommandLinePickTarget();
  useCadUiStore.getState().setCommandErrorMessage(null);
  return true;
};

/**
 * Type-based start helper retained for focused command-line tests and callers
 * that already own an element type. Command cutover must resolve normal
 * command IDs through creationRecipeForLegacyCommand instead.
 */
export const startCommandLineCreation = (type: CadElementType, context?: CommandContext) => {
  const recipe = creationRecipeForType(type);
  return recipe ? startCommandLineCreationForRecipe(recipe, context) : false;
};

/** Cancels the session and all pick state through the established unified path. */
export const cancelCommandLineSession = () => {
  if (commandLineCompositionIsActive()) return false;
  if (!useCadUiStore.getState().commandLineSession) return false;
  clearCommandLineGhostPreview();
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
 * Tier-A shape check for an edit draft at a position the evaluator cannot
 * reach: typed numbers must at least parse as expressions. Reference drafts
 * only ever arrive through the shared pick acceptance paths (already validated
 * against the candidate set) and name drafts are free-form, so both pass.
 */
const editingDraftIsParseable = (draftSession: CommandLineSession) => {
  const step = currentStep(draftSession);
  if (step?.kind !== "number") return true;
  const draft = draftSession.editingDraft;
  if (typeof draft === "number") return Number.isFinite(draft);
  if (draft === null || typeof draft === "string" || Array.isArray(draft)) return false;
  return "kind" in draft && draft.kind === "expression" && numericExpressionSyntaxIsValid(draft.expression);
};

/**
 * Validates an edit draft through the same ghost path as normal creation
 * before copying it into confirmed args. "not-evaluated" (insertion after
 * `@stop`, inside a disabled group, or an inactive conditional branch) is not
 * a rejection: no preview exists there by design, exactly as during initial
 * fill, so the edit only needs the Tier-A shape check. A rejected draft
 * remains isolated in the session so the user can correct it or abandon the
 * edit safely.
 */
const confirmEditingDraft = (draftSession: CommandLineSession) => {
  const status = setSessionAndSyncPickTarget(draftSession);
  const accepted = status === "preview" ||
    (status === "not-evaluated" && editingDraftIsParseable(draftSession));
  if (!accepted) {
    setSessionAndSyncPickTarget(withCommandLineSessionError(draftSession, editValidationError));
    return false;
  }
  setSessionAndSyncPickTarget(commitStepEdit(draftSession), draftSession.editingReturnPickState);
  return true;
};

/**
 * The sole session-argument fill path. Phase 4f will attach partial preview
 * updates here, after the value has been accepted but before final commit.
 */
export const fillCommandLineCurrentStep = (value: Parameters<typeof fillCurrentStep>[1]) => {
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const next = fillCurrentStep(session, value);
  if (next === session) return false;
  return isEditingCommandLineStep(session)
    ? confirmEditingDraft(next)
    : (setSessionAndSyncPickTarget(next), true);
};

/** Opens one completed recipe row for isolated revision. */
export const startCommandLineStepEdit = (stepIndex: number) => {
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const next = beginStepEdit(session, stepIndex, editingReturnPickStateFor(session, useCadUiStore.getState()));
  if (next === session) return false;
  setSessionAndSyncPickTarget(next);
  return true;
};

/** Drops the isolated draft and restores the completed-session summary. */
export const cancelCommandLineStepEdit = () => {
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const restoredPickState = session.editingReturnPickState;
  const next = cancelStepEdit(session);
  if (next === session) return false;
  setSessionAndSyncPickTarget(next, restoredPickState);
  return true;
};

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
      property: initialNumericReferencePickProperty(step.stepLevels)
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
    return skipCommandLineStep();
  }
  return fillCommandLineCurrentStep(makeNumericExpression(input));
};

export const skipCommandLineStep = () => {
  if (commandLineCompositionIsActive()) return false;
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const next = skipCurrentStep(session);
  if (next === session) return false;
  if (isEditingCommandLineStep(session)) return confirmEditingDraft(next);
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
  // The final materialization owns the canonical document; clear the ephemeral
  // candidate first so a rejected bridge call cannot leave a stale ghost.
  clearCommandLineGhostPreview();
  const result = commitDocumentChangeAndSelect({
    elements: [
      ...promotion.elements.slice(0, session.insertionIndex),
      element,
      ...promotion.elements.slice(session.insertionIndex)
    ]
  }, {
    selectedElementId: element.id,
    selectedElementIds: [element.id],
    selectionAnchorElementId: element.id
  });
  if (result.status !== "applied") {
    const ui = useCadUiStore.getState();
    clearCommandLineGhostPreview();
    ui.clearPickMode();
    ui.setCommandErrorMessage(commitError);
    return false;
  }

  clearCommandLineGhostPreview();
  useCadUiStore.getState().clearPickMode();
  const firstEditableStep = session.recipe.steps.find((step) => step.kind !== "name");
  const focusSourceEditor = () => {
    if (session.sourceEditorCreation && firstEditableStep) {
      context?.focusSourceEditorParameter?.(element.id, firstEditableStep.key);
      return;
    }
    context?.focusSourceEditor?.();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusSourceEditor);
  else setTimeout(focusSourceEditor, 0);
  return true;
};
