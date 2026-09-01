import { makeNumericExpression } from "../geometry/numericExpressions";
import { numericExpressionSyntaxIsValid } from "../geometry/numericExpressionParser";
import {
  applyCreationPlacement,
  creationPlacementForTarget
} from "../model/elementCreationPlacement";
import { adjustEvaluationLimitForInsertion } from "../model/evaluationDivider";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElementType } from "../types/geometry";
import { sourceEditSession } from "../editor/sourceEditSession";
import { isCommandLineInputComposing } from "./commandLineInputComposition";
import { commitDocumentChangeAndSelect } from "./commitDocumentChangeAndSelect";
import { focusCanvasAfterCreation } from "./postCreationFocus";
import {
  activateStep,
  beginStepEdit,
  cancelStepEdit,
  clearStepValue,
  commitStepEdit,
  type CommandLineSession,
  currentStep,
  effectiveCommandLineArgs,
  fillCurrentStep,
  isEditingCommandLineStep,
  isMidSessionStepEdit,
  retreatStep,
  sessionCanConfirm,
  sessionIsStale,
  skipUnfilledStepsToEnd,
  skipCurrentStep,
  startSession,
  withCommandLineSessionError
} from "./commandLineSession";
import {
  insertionAnchorForCommandLineCreation,
  resolveCommandLineInsertionAnchor
} from "./commandLineInsertionAnchor";
import {
  blankCreationRecipeStepKeys,
  creationRecipeForType,
  emitCreationRecipe,
  materializeCreationRecipeDraft,
  type CreationRecipe
} from "./creationRecipes";
import {
  commandLineNumericReferencePickTargetFor,
  commandLinePickStateForSession,
  editingReturnPickStateFor
} from "./commandLineSessionPickState";
import {
  clearCommandLineGhostPreview,
  commandLineMissingRequiredStepIndexes,
  syncCommandLineGhostPreview
} from "./commandLineGhostPreview";
import { promoteDirectlyReferencedUnnamedElements } from "./commandLineUnnamedPromotion";
import { commitSourceCreationInsertion } from "./sourceCreationCommit";
import { commitSourceCreationDraftInsertion } from "./sourceCreationDraftCommit";
import {
  resolveDocumentEndSourceCreationInsertion,
  resolveSourceCreationInsertion,
  sourceCreationInsertionUnsafeError
} from "./sourceCreationInsertion";
import {
  commandLineDuplicateNameMessage,
  validateCommandLineElementName
} from "./commandLineNameValidation";
import type { CommandContext } from "./commandTypes";

const compositionError = "日本語入力の確定中はコマンドを実行できません。入力を確定してから再操作してください。";
const staleError = "ドキュメントが変更されたため、コマンドライン作成をキャンセルしました。もう一度開始してください。";
const commitError = "コマンドライン作成を文書へ反映できませんでした。もう一度開始してください。";
const editValidationError = "編集値をプレビューできません。値または参照を確認してください。";
const draftRequiresSourceEditorError =
  "未入力のまま作成するには、Source Editor上のカーソル位置から作成を開始してください。";

const isPickCapableCreationStep = (step: ReturnType<typeof currentStep>) =>
  step?.kind === "point" ||
  step?.kind === "endpoint" ||
  step?.kind === "line" ||
  step?.kind === "lineList";

const commandLineCompositionIsActive = () =>
  sourceEditSession.isComposing() || isCommandLineInputComposing();

const canvasOwnedSourceInsertion = (origin: CommandLineSession["sourceInsertionOrigin"]): boolean =>
  origin === "canvas-retained" || origin === "document-end";

const sourcePositionForElement = (elementId: string) => {
  const document = useCadDocumentStore.getState();
  const info = document.doc.statementMap?.byElementId.get(elementId);
  if (!info) return undefined;
  const lines = document.sourceText.replace(/\r\n/g, "\n").split("\n");
  const line = Math.max(info.range.endLine, info.endLine) - 1;
  if (line < 0 || line >= lines.length) return undefined;
  return { line, character: lines[line]?.length ?? 0 };
};

const clearStaleSession = () => {
  const ui = useCadUiStore.getState();
  clearCommandLineGhostPreview();
  ui.clearPickMode();
  ui.setCommandErrorMessage(staleError);
};

/**
 * Updates session progress && every command-line-owned pick field together so
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
 * Begins || replaces a command-line creation session through the same
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
  const sourceCursor = context?.currentSourceCursor?.() ?? null;
  const canvasRetainedOrigin = context?.sourceCreationOrigin === "canvas-retained";
  if (canvasRetainedOrigin && !sourceCursor) {
    useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
    return false;
  }
  const sourceDocument = useCadDocumentStore.getState();
  const sourceResolution = sourceCursor
    ? resolveSourceCreationInsertion({
        cursor: sourceCursor,
        sourceRevision: sourceDocument.sourceRevision,
        elements: sourceDocument.elements,
        statementMap: sourceDocument.doc.statementMap
      })
    : null;
  if (sourceResolution?.kind === "unsafe") {
    useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
    return false;
  }
  // A dirty editor buffer has no current StatementMap. Do not flush it after a
  // Source target has been observed: doing so would mutate the document before
  // the command can report that its insertion boundary is unsafe.
  if (sourceCursor && sourceEditSession.hasPendingText()) {
    useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
    return false;
  }
  if (sourceEditSession.flush("command") === "blocked-composition") {
    useCadUiStore.getState().setCommandErrorMessage(compositionError);
    return false;
  }
  const document = useCadDocumentStore.getState();
  const cursorElementId = context?.currentCursorElementId?.() ?? null;
  const insertionResolution = sourceResolution?.kind === "safe"
    ? sourceResolution
    : canvasRetainedOrigin
      ? null
      : resolveDocumentEndSourceCreationInsertion({
          sourceText: document.sourceText,
          documentText: document.docText,
          sourceRevision: document.sourceRevision,
          elements: document.elements,
          statementMap: document.doc.statementMap
        });
  if (!insertionResolution) {
    useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
    return false;
  }
  if (insertionResolution.kind !== "safe") {
    useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
    return false;
  }
  const sourceInsertion = insertionResolution.insertion;
  if (sourceInsertion.sourceRevision !== document.sourceRevision) {
    useCadUiStore.getState().setCommandErrorMessage(sourceCreationInsertionUnsafeError);
    return false;
  }
  const sourceInsertionOrigin = canvasRetainedOrigin
    ? "canvas-retained" as const
    : sourceCursor ? "source-cursor" as const : "document-end" as const;
  const insertionAnchor = sourceCursor
    ? insertionAnchorForCommandLineCreation(sourceCursor.elementId ?? cursorElementId)
    : { kind: "documentEnd" as const };
  const insertionTarget = sourceInsertion.insertionTarget;

  // Re-entry ordering is intentional: nothing above mutates UI state, while
  // these three calls remove all pending Canvas/editor handoffs before the
  // store atomically replaces the old command-line && pick state.
  context?.clearPendingCanvasPointerIntent?.();
  context?.clearSourceEditorFocusReservation?.();
  const placement = creationPlacementForTarget(
    document.elements,
    insertionTarget,
    document.evaluationLimitIndex
  );
  clearCommandLineGhostPreview();
  useCadUiStore.getState().startCommandLineSession(startSession(recipe, {
    insertionAnchor,
    insertionIndex: insertionTarget.insertionIndex,
    insertionTarget,
    sourceInsertionLine: sourceInsertion.sourceInsertionLine,
    sourceInsertionOrigin,
    revision: document.sourceRevision,
    elements: document.elements,
    placement
  }));
  syncCommandLinePickTarget();
  useCadUiStore.getState().setCommandErrorMessage(null);
  return true;
};

/**
 * Type-based start helper retained for focused command-line tests && callers
 * that already own an element type. Command cutover must resolve normal
 * command IDs through creationRecipeForLegacyCommand instead.
 */
export const startCommandLineCreation = (type: CadElementType, context?: CommandContext) => {
  const recipe = creationRecipeForType(type);
  return recipe ? startCommandLineCreationForRecipe(recipe, context) : false;
};

/** Cancels the session && all pick state through the established unified path. */
export const cancelCommandLineSession = () => {
  if (commandLineCompositionIsActive()) return false;
  if (!useCadUiStore.getState().commandLineSession) return false;
  clearCommandLineGhostPreview();
  useCadUiStore.getState().clearPickMode();
  return true;
};

/** Applies Escape semantics without changing the explicit session-cancel command. */
export const cancelCommandLineEscape = () => {
  if (commandLineCompositionIsActive()) return false;
  const session = useCadUiStore.getState().commandLineSession;
  if (!session) return false;
  return isMidSessionStepEdit(session)
    ? cancelCommandLineStepEdit()
    : cancelCommandLineSession();
};

/** Detects a document mutation while a session is displayed && rejects rebase/follow behavior. */
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
 * against the candidate set) && name drafts are free-form, so both pass.
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
 * `stop`, inside a disabled group, || an inactive conditional branch) is not
 * a rejection: no preview exists there by design, exactly as during initial
 * fill, so the edit only needs the Tier-A shape check. A global
 * "missing-input" caused exclusively by future prompts is likewise not an
 * edit rejection after the draft-overlaid edited prompt is confirmed present.
 * A rejected draft remains isolated in the session so the user can correct it
 * || abandon the edit safely.
 */
const confirmEditingDraft = (draftSession: CommandLineSession) => {
  const status = setSessionAndSyncPickTarget(draftSession);
  const missingStepIndexes = status === "missing-input"
    ? commandLineMissingRequiredStepIndexes({
        session: draftSession,
        elements: useCadDocumentStore.getState().elements,
        evaluationLimitIndex: useCadDocumentStore.getState().evaluationLimitIndex
      })
    : [];
  const editingStep = currentStep(draftSession);
  const editingArgumentKey = editingStep?.kind === "name" ? "name" : editingStep?.key;
  const editingStepIsIntentionallyBlank = draftSession.editingStepIndex !== null &&
    draftSession.editingDraft === null;
  // Check the draft-overlaid value itself before forgiving any later prompt.
  // An explicit blank is valid even when the ghost reports that this required
  // step is missing; all other drafts must still satisfy the active step.
  const editingStepIsSatisfied = editingStepIsIntentionallyBlank || (
    draftSession.editingStepIndex !== null &&
    editingStep !== null &&
    (editingStep.kind === "name" || (
      draftSession.editingDraft !== null &&
      editingArgumentKey !== undefined &&
      Object.prototype.hasOwnProperty.call(effectiveCommandLineArgs(draftSession), editingArgumentKey)
    )) &&
    !missingStepIndexes.includes(draftSession.editingStepIndex)
  );
  const onlyFutureStepsAreMissing = editingStepIsSatisfied &&
    missingStepIndexes.length > 0 &&
    missingStepIndexes.every((stepIndex) => stepIndex >= draftSession.currentStepIndex);
  const accepted = (editingStepIsIntentionallyBlank && status !== "invalid") ||
    status === "preview" ||
    ((status === "not-evaluated" || (status === "missing-input" && onlyFutureStepsAreMissing)) &&
      editingDraftIsParseable(draftSession));
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
export const fillCommandLineCurrentStep = (
  value: Parameters<typeof fillCurrentStep>[1],
  context?: CommandContext
) => {
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const step = currentStep(session);
  if (step?.kind === "name") {
    const validation = validateCommandLineElementName({
      name: value as string,
      elements: useCadDocumentStore.getState().elements,
      parentGroupId: session.insertionTarget.parentGroupId
    });
    const message = commandLineDuplicateNameMessage(validation);
    if (message) {
      setSessionAndSyncPickTarget(withCommandLineSessionError(session, message));
      return false;
    }
  }
  const next = fillCurrentStep(session, value);
  if (next === session) return false;
  if (isEditingCommandLineStep(session)) return confirmEditingDraft(next);
  setSessionAndSyncPickTarget(next);
  return context?.completeCommandLineSession === true && sessionCanConfirm(next)
    ? confirmCommandLineSession(context)
    : true;
};

/** Activates any recipe step without changing any existing argument value. */
export const activateCommandLineStep = (stepIndex: number) => {
  if (commandLineCompositionIsActive()) return false;
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const next = activateStep(session, stepIndex);
  if (next === session) return false;
  setSessionAndSyncPickTarget(next);
  return true;
};

/** Removes a supplied pick/reference value and reopens that blank step. */
export const clearCommandLineStepValue = (stepIndex?: number) => {
  if (commandLineCompositionIsActive()) return false;
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const targetStepIndex = stepIndex ?? session.currentStepIndex;
  const next = clearStepValue(session, targetStepIndex);
  if (next === session) return false;
  setSessionAndSyncPickTarget(next);
  return true;
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

/** Drops the isolated draft && restores the completed-session summary. */
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
    activeNumericReferencePickTarget: commandLineNumericReferencePickTargetFor(session),
    activePickCursor: null
  });
  return true;
};

/** Enters the shared Canvas pick for the current pick-capable recipe step. */
export const startCommandLinePickForCurrentStep = (context?: CommandContext) => {
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const step = currentStep(session);
  if (step?.kind === "number") {
    if (!startCommandLineNumericReferencePick()) return false;
  } else if (!isPickCapableCreationStep(step)) {
    return false;
  } else {
    syncCommandLinePickTarget(session);
    useCadUiStore.getState().setActivePickCursor(null);
  }
  context?.focusCanvas?.();
  return true;
};

/**
 * Applies the current number/name prompt without creating a second
 * React-side state machine. Blank input always skips the current step
 * (leaving it unnamed / unfilled) regardless of kind - the name step
 * deliberately never falls back to session.nameSuggestion here, so an empty
 * Enter never fabricates a name.
 */
export const submitCommandLineInput = (input: string, context?: CommandContext) => {
  if (commandLineCompositionIsActive()) return false;
  const session = useCadUiStore.getState().commandLineSession;
  if (!session) return false;
  if (cancelStaleCommandLineSession()) return false;
  const step = currentStep(session);
  if (!step) return confirmCommandLineSession(context);

  if (input === "") {
    return skipCommandLineStep(context);
  }
  if (step.kind === "name") {
    return fillCommandLineCurrentStep(input, context);
  }
  if (step.kind !== "number") return false;
  return fillCommandLineCurrentStep(makeNumericExpression(input), context);
};

export const skipCommandLineStep = (context?: CommandContext) => {
  if (commandLineCompositionIsActive()) return false;
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const next = skipCurrentStep(session);
  if (next === session) return false;
  if (isEditingCommandLineStep(session)) return confirmEditingDraft(next);
  setSessionAndSyncPickTarget(next);
  return context?.completeCommandLineSession === true && sessionCanConfirm(next)
    ? confirmCommandLineSession(context)
    : true;
};

export const retreatCommandLineStep = () =>
  commandLineCompositionIsActive() ? false : updateSession(retreatStep);

/** Skips remaining steps and immediately commits the completed recipe. */
export const skipCommandLineStepsToEnd = (context?: CommandContext) => {
  if (commandLineCompositionIsActive()) return false;
  const session = useCadUiStore.getState().commandLineSession;
  if (!session || cancelStaleCommandLineSession()) return false;
  const next = skipUnfilledStepsToEnd(session);
  if (next !== session) setSessionAndSyncPickTarget(next);
  return confirmCommandLineSession(context);
};

/**
 * Materializes a complete session once.  The document bridge owns line
 * splicing, source preservation, && the single undo entry.
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
  const hasPhysicalSourceInsertion = session.sourceInsertionOrigin !== null;
  if (hasPhysicalSourceInsertion && session.sourceInsertionLine === null) {
    clearStaleSession();
    return false;
  }
  const insertionTarget = !hasPhysicalSourceInsertion
    ? resolveCommandLineInsertionAnchor(session.insertionAnchor, document.elements)
    : session.insertionTarget;
  if (insertionTarget === null) {
    clearStaleSession();
    return false;
  }
  const promotion = session.sourceInsertionOrigin !== "source-cursor"
    ? promoteDirectlyReferencedUnnamedElements(session, document.elements)
    : { elements: document.elements, promotedElementIds: [] };
  // The resolved semantic anchor owns the insertion position; placement only
  // derives the parent && reference context for that exact location.
  const placement = creationPlacementForTarget(
    promotion.elements,
    insertionTarget,
    document.evaluationLimitIndex
  );

  // A session with one || more genuinely blank recipe steps (see
  // skipCurrentStep) never becomes a materialized CadElement: it is spliced
  // in as a literal draft DSL statement instead, with `key:` holes for the
  // blank steps. A fully-filled session falls through unchanged below.
  const blankParameterKeys = blankCreationRecipeStepKeys(session.recipe, session.args);
  if (blankParameterKeys.size > 0) {
    // The draft path only ever writes a text splice at a known physical
    // line; the non-anchored fallback commit below is a full CadElement[]
    // diff && has no way to represent a blank field without a sentinel.
    if (!hasPhysicalSourceInsertion) {
      setSessionAndSyncPickTarget(withCommandLineSessionError(session, draftRequiresSourceEditorError));
      return false;
    }
    const draft = materializeCreationRecipeDraft(session.recipe, session.args, {
      elements: promotion.elements,
      referenceElements: placement.referenceElements
    });
    const draftNameValidation = validateCommandLineElementName({
      name: draft.element.name,
      elements: promotion.elements,
      parentGroupId: placement.parentGroupId
    });
    const draftDuplicateNameMessage = commandLineDuplicateNameMessage(draftNameValidation);
    if (draftDuplicateNameMessage) {
      setSessionAndSyncPickTarget(withCommandLineSessionError(session, draftDuplicateNameMessage));
      return false;
    }
    clearCommandLineGhostPreview();
    const draftCommit = commitSourceCreationDraftInsertion({
      elements: promotion.elements,
      sourceInsertionLine: session.sourceInsertionLine!,
      element: draft.element,
      blankParameterKeys: draft.blankParameterKeys,
      parentGroupId: placement.parentGroupId,
      promotedElementIds: promotion.promotedElementIds
    });
    if (draftCommit.result.status !== "applied") {
      const ui = useCadUiStore.getState();
      clearCommandLineGhostPreview();
      ui.clearPickMode();
      ui.setCommandErrorMessage(commitError);
      return false;
    }

    // Unlike a complete creation, a draft never selects anything: it has no
    // materialized element, && any Canvas selection from before this
    // session must be left exactly as it was.
    clearCommandLineGhostPreview();
    useCadUiStore.getState().clearPickMode();
    const draftEndLine = session.sourceInsertionLine! + draftCommit.insertedLineCount - 1;
    const focusSourceEditorAtDraftEnd = () => {
      if (context?.focusSourceEditorAtLineEnd) {
        context.focusSourceEditorAtLineEnd(draftEndLine);
        return;
      }
      context?.focusSourceEditor?.();
    };
    if (canvasOwnedSourceInsertion(session.sourceInsertionOrigin)) {
      focusCanvasAfterCreation(context);
    } else if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusSourceEditorAtDraftEnd);
    else setTimeout(focusSourceEditorAtDraftEnd, 0);
    if (session.sourceInsertionOrigin === "canvas-retained" && context?.canvasCreationRequestId !== undefined) {
      context?.postCanonicalSourceText?.(useCadDocumentStore.getState().sourceText, {
        requestId: context.canvasCreationRequestId,
        nextSourcePosition: {
          line: draftEndLine - 1,
          character: useCadDocumentStore.getState().sourceText.replace(/\r\n/g, "\n").split("\n")[draftEndLine - 1]?.length ?? 0
        }
      });
    } else {
      context?.postCanonicalSourceText?.(useCadDocumentStore.getState().sourceText);
    }
    return true;
  }

  const emitted = emitCreationRecipe(session.recipe, session.args, {
    elements: promotion.elements,
    referenceElements: placement.referenceElements
  });
  const element = applyCreationPlacement(emitted, placement);
  const nameValidation = validateCommandLineElementName({
    name: element.name,
    elements: promotion.elements,
    parentGroupId: placement.parentGroupId
  });
  const duplicateNameMessage = commandLineDuplicateNameMessage(nameValidation);
  if (duplicateNameMessage) {
    setSessionAndSyncPickTarget(withCommandLineSessionError(session, duplicateNameMessage));
    return false;
  }
  // The Canvas presentation that rendered the ghost may already have
  // published eligibility for the eventual element. Document commits
  // invalidate that snapshot synchronously, so retain it only for this
  // Canvas-owned selection handoff.
  const canvasSelectionEligibility = canvasOwnedSourceInsertion(session.sourceInsertionOrigin)
    ? useCadUiStore.getState().canvasSelectionEligibleElementIds
    : undefined;
  const canvasPreviewElementIds = canvasOwnedSourceInsertion(session.sourceInsertionOrigin)
    ? new Set((document.previewElements ?? [])
        .filter((previewElement) => !document.elements.some((element) => element.id === previewElement.id))
        .map((previewElement) => previewElement.id))
    : new Set<string>();
  // The final materialization owns the canonical document; clear the ephemeral
  // candidate first so a rejected bridge call cannot leave a stale ghost.
  clearCommandLineGhostPreview();
  const sourceCommit = hasPhysicalSourceInsertion
    ? commitSourceCreationInsertion({
        elements: promotion.elements,
        insertionIndex: insertionTarget.insertionIndex,
        insertedElements: [element],
        sourceInsertionLine: session.sourceInsertionLine!,
        promotedElementIds: promotion.promotedElementIds
      })
    : null;
  const result = sourceCommit?.result ?? commitDocumentChangeAndSelect({
    elements: [
      ...promotion.elements.slice(0, insertionTarget.insertionIndex),
      element,
      ...promotion.elements.slice(insertionTarget.insertionIndex)
    ],
    evaluationLimitIndex: adjustEvaluationLimitForInsertion({
      elements: document.elements,
      evaluationLimitIndex: document.evaluationLimitIndex,
      insertionIndex: insertionTarget.insertionIndex,
      insertedCount: 1
    })
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

  const selectedElementId = sourceCommit?.selectedElementId ?? element.id;
  if (sourceCommit?.selectedElementId) {
    const canvasSelectionEligibilityForCommit = canvasSelectionEligibility &&
      [...canvasPreviewElementIds].some((id) => canvasSelectionEligibility.has(id))
      ? new Set([...canvasSelectionEligibility, sourceCommit.selectedElementId])
      : canvasSelectionEligibility ?? undefined;
    useCadUiStore.getState().applySelection(useCadDocumentStore.getState().elements, {
      selectedElementId,
      selectedElementIds: sourceCommit.insertedElementIds,
      selectionAnchorElementId: selectedElementId
    }, canvasSelectionEligibilityForCommit);
  }

  clearCommandLineGhostPreview();
  useCadUiStore.getState().clearPickMode();
  const focusSourceEditor = () => {
    if (context?.focusSourceEditorAtElementEnd) {
      context.focusSourceEditorAtElementEnd(selectedElementId);
      return;
    }
    context?.focusSourceEditor?.();
  };
  if (canvasOwnedSourceInsertion(session.sourceInsertionOrigin)) {
    focusCanvasAfterCreation(context);
  } else if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusSourceEditor);
  else setTimeout(focusSourceEditor, 0);
  if (session.sourceInsertionOrigin === "canvas-retained" && context?.canvasCreationRequestId !== undefined) {
    context?.postCanonicalSourceText?.(useCadDocumentStore.getState().sourceText, {
      requestId: context.canvasCreationRequestId,
      insertedElementId: sourceCommit?.selectedElementId ?? selectedElementId,
      nextSourcePosition: sourcePositionForElement(selectedElementId)
    });
  } else {
    context?.postCanonicalSourceText?.(useCadDocumentStore.getState().sourceText);
  }
  return true;
};
