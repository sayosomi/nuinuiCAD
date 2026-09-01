import type {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject
} from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CommandContext } from "../commands/commandTypes";
import {
  cancelCommandLineSession,
  cancelStaleCommandLineSession,
  confirmCommandLineSession,
  activateCommandLineStep,
  clearCommandLineStepValue,
  retreatCommandLineStep,
  skipCommandLineStep,
  skipCommandLineStepsToEnd,
  startCommandLineCreationForRecipe,
  startCommandLinePickForCurrentStep,
  submitCommandLineInput
} from "../commands/commandLineSessionCommands";
import {
  currentStep,
  hasCommandLineStepValue,
  type CommandLineSession
} from "../commands/commandLineSession";
import type { CreationRecipe, CreationStep } from "../commands/creationRecipes";
import {
  activePickCandidates,
  applyPickReference,
  finishLinePick
} from "../commands/pickCommands";
import { commandLineTypedBindingSuggestions } from "../commands/commandLineTypedBindingSuggestions";
import { creationPlacementForTarget } from "../model/elementCreationPlacement";
import {
  rankedReferenceSuggestions,
  referenceSuggestions,
  type ReferenceSuggestion
} from "../model/referenceSuggestions";
import { elementParameterCandidateState } from "../geometry/elementParameterReferenceOptions";
import {
  filteredNumericVariableSuggestions,
  numericVariableSuggestionMatch,
  replaceNumericVariableSuggestionToken
} from "../components/numericVariableSuggestion";
import {
  asNumericVariableReferenceOptions,
  elementParameterSuggestionMatch,
  filteredElementParameterSuggestions
} from "../components/elementParameterSuggestion";
import { NumericVariableSuggestPopover } from "../components/NumericVariableSuggestPopover";
import { commandLineEditingInputValue, commandLineStepLabel, completedCommandLineSteps } from "../components/commandLineProgress";
import { commandLineStepHelp, isCommandLineReferenceStep } from "../components/commandLineBarHelpers";
import { isImeComposingKeyEvent } from "../components/keyboardEventGuards";
import {
  isCommandLineInputComposing,
  setCommandLineInputComposing
} from "../commands/commandLineInputComposition";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";

type VSCodeCreationAssistOverlayProps = {
  canvasFocusRef: RefObject<HTMLDivElement | null>;
  commandContext: CommandContext;
  evaluation: EvaluationResult;
  evaluationIsCurrent?: boolean;
  postCanonicalSourceText: (sourceText: string) => void;
};

const isTextEntryTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable;
};

const isModifierEnter = (event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) =>
  event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;

const stepValueForInput = (
  session: CommandLineSession,
  step: CreationStep | null,
  completedSteps: ReturnType<typeof completedCommandLineSteps>
) => {
  if (!step || (step.kind !== "name" && step.kind !== "number")) return "";
  const currentIndex = session.currentStepIndex;
  const completed = completedSteps.find((item) => item.stepIndex === currentIndex);
  if (completed) return completed.value;
  return commandLineEditingInputValue(session, step);
};

/** VS Code-only presentation for the shared document-end command-line session. */
export const VSCodeCreationAssistOverlay = ({
  canvasFocusRef,
  commandContext,
  evaluation,
  evaluationIsCurrent = true,
  postCanonicalSourceText
}: VSCodeCreationAssistOverlayProps) => {
  const session = useCadUiStore((state) => state.commandLineSession);
  const sourceRevision = useCadDocumentStore((state) => state.sourceRevision);
  const sourceText = useCadDocumentStore((state) => state.sourceText);
  const docText = useCadDocumentStore((state) => state.docText);
  const doc = useCadDocumentStore((state) => state.doc);
  const elements = useCadDocumentStore((state) => state.elements);
  const evaluationLimitIndex = useCadDocumentStore((state) => state.evaluationLimitIndex);
  const activePointPickTarget = useCadUiStore((state) => state.activePointPickTarget);
  const activeNumericReferencePickTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
  const activeLinePickTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const lineListDraftSignature = activeLinePickTarget?.draftLineIds?.join("\0") ?? "";
  const [restartRecipe, setRestartRecipe] = useState<CreationRecipe | null>(null);
  const [inputState, setInputState] = useState({ identity: "", value: "" });
  const [numberSuggestionSelection, setNumberSuggestionSelection] = useState<{
    start: number | null;
    end: number | null;
  }>({ start: null, end: null });
  const [numberSuggestionActiveIndex, setNumberSuggestionActiveIndex] = useState(0);
  const [referenceSuggestionActiveIndex, setReferenceSuggestionActiveIndex] = useState(0);
  const [acceptedReferenceSuggestion, setAcceptedReferenceSuggestion] = useState<{
    identity: string;
    inputValue: string;
    suggestion: ReferenceSuggestion;
  } | null>(null);
  const [dismissedReferenceSuggestion, setDismissedReferenceSuggestion] = useState<{
    identity: string;
    inputValue: string;
  } | null>(null);
  const [dismissedNumberSuggestion, setDismissedNumberSuggestion] = useState<{
    identity: string;
    inputValue: string;
  } | null>(null);
  const [acceptedNumberSuggestion, setAcceptedNumberSuggestion] = useState<{
    identity: string;
    inputValue: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startAgainButtonRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const stepButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const [focusedStepIndex, setFocusedStepIndex] = useState(0);

  const isCanvasOriginSession = session?.sourceInsertionOrigin === "document-end";
  const step = isCanvasOriginSession ? currentStep(session) : null;
  const completedSteps = useMemo(
    () => isCanvasOriginSession && session ? completedCommandLineSteps(session, elements) : [],
    [elements, isCanvasOriginSession, session]
  );
  const completedCurrentStep = completedSteps.find((item) => item.stepIndex === session?.currentStepIndex);
  const stepIdentity = session && isCanvasOriginSession
    ? `${session.startedAtRevision}:${session.currentStepIndex}:${session.editingStepIndex ?? "new"}:${step?.kind ?? "complete"}:${step?.kind === "name" ? completedCurrentStep?.value ?? "" : step?.kind === "number" ? completedCurrentStep?.value ?? "" : activeLinePickTarget?.draftLineIds?.join("\0") ?? ""}`
    : "";
  const existingInputValue = session && isCanvasOriginSession
    ? stepValueForInput(session, step, completedSteps)
    : "";
  const completionCommandContext = useMemo(
    () => ({ ...commandContext, completeCommandLineSession: true, postCanonicalSourceText }),
    [commandContext, postCanonicalSourceText]
  );
  const inputValue = inputState.identity === stepIdentity ? inputState.value : existingInputValue;
  const setInputValue = useCallback(
    (value: string) => setInputState({ identity: stepIdentity, value }),
    [stepIdentity]
  );

  const numberVariableOptions = useMemo(() => {
    if (!session || !isCanvasOriginSession || step?.kind !== "number") return [];
    const typedOptions = commandLineTypedBindingSuggestions({
      session,
      sourceText,
      docText,
      statementMap: doc.statementMap,
      bindingAnalysis: doc.bindingAnalysis,
      elements
    });
    const byExpression = new Map<string, typeof typedOptions[number]>();
    for (const option of typedOptions) byExpression.set(option.expression, option);
    return [...byExpression.values()];
  }, [doc, docText, elements, isCanvasOriginSession, session, sourceText, step]);

  const numberSuggestionMatch = step?.kind === "number" && !isCommandLineInputComposing()
    ? numericVariableSuggestionMatch(inputValue, numberSuggestionSelection.start, numberSuggestionSelection.end)
    : null;
  const visibleNumberVariableSuggestions = numberSuggestionMatch
    ? filteredNumericVariableSuggestions(numberVariableOptions, numberSuggestionMatch.query, null)
    : [];
  const elementParamMatch = step?.kind === "number" && !isCommandLineInputComposing() && !numberSuggestionMatch
    ? elementParameterSuggestionMatch(inputValue, numberSuggestionSelection.start, numberSuggestionSelection.end)
    : null;
  const elementParamPlacement = session && isCanvasOriginSession && step?.kind === "number"
    ? creationPlacementForTarget(elements, session.insertionTarget, evaluationLimitIndex)
    : null;
  const elementParamCandidateState = !elementParamPlacement || !elementParamMatch
    ? null
    : elementParameterCandidateState({
        referenceElements: elementParamPlacement.referenceElements,
        elementToken: elementParamMatch.elementToken,
        currentElement: { parentGroupId: elementParamPlacement.parentGroupId },
        evaluation: {
          computedGeometry: evaluation.computedGeometry,
          effectiveEnabledElementIds: evaluation.effectiveEnabledElementIds,
          errors: evaluation.errors
        }
      }, evaluationIsCurrent);
  const elementParamOptions = elementParamCandidateState?.status === "ready"
    ? elementParamCandidateState.options
    : [];
  const visibleElementParamSuggestions = elementParamMatch
    ? filteredElementParameterSuggestions(elementParamOptions, elementParamMatch.query)
    : [];
  const activeSuggestionMatch = numberSuggestionMatch ?? elementParamMatch;
  const activeSuggestionOptions = numberSuggestionMatch
    ? visibleNumberVariableSuggestions
    : asNumericVariableReferenceOptions(visibleElementParamSuggestions);
  const numberSuggestionsOpen = activeSuggestionOptions.length > 0 && !(
    dismissedNumberSuggestion?.identity === stepIdentity &&
    dismissedNumberSuggestion.inputValue === inputValue
  );
  const acceptedNumberForCurrentInput = acceptedNumberSuggestion?.identity === stepIdentity &&
    acceptedNumberSuggestion.inputValue === inputValue
    ? acceptedNumberSuggestion
    : null;
  const numberSuggestionBlocking = step?.kind === "number" && !!elementParamMatch &&
    !numberSuggestionsOpen && !acceptedNumberForCurrentInput;
  const selectedNumberSuggestionIndex = activeSuggestionOptions.length === 0
    ? 0
    : Math.min(numberSuggestionActiveIndex, activeSuggestionOptions.length - 1);

  const referencePlacement = useMemo(
    () => session && isCanvasOriginSession && isCommandLineReferenceStep(step?.kind)
      ? creationPlacementForTarget(elements, session.insertionTarget, evaluationLimitIndex)
      : null,
    [elements, evaluationLimitIndex, isCanvasOriginSession, session, step?.kind]
  );
  const candidates = useMemo(
    () => {
      void lineListDraftSignature;
      return session && isCanvasOriginSession && isCommandLineReferenceStep(step?.kind)
        ? activePickCandidates(evaluation)
        : [];
    },
    [evaluation, isCanvasOriginSession, lineListDraftSignature, session, step?.kind]
  );
  const suggestions = useMemo(() => {
    if (!session || !isCanvasOriginSession || !isCommandLineReferenceStep(step?.kind)) return [];
    return referenceSuggestions({
      candidates,
      elements: referencePlacement?.referenceElements ?? elements,
      currentElement: { parentGroupId: referencePlacement?.parentGroupId }
    });
  }, [candidates, elements, isCanvasOriginSession, referencePlacement, session, step?.kind]);
  const visibleSuggestions = useMemo(
    () => rankedReferenceSuggestions(suggestions, inputValue, 8),
    [inputValue, suggestions]
  );
  const selectedReferenceSuggestionIndex = visibleSuggestions.length === 0
    ? 0
    : Math.min(referenceSuggestionActiveIndex, visibleSuggestions.length - 1);
  const acceptedReferenceForCurrentInput = acceptedReferenceSuggestion?.identity === stepIdentity &&
    acceptedReferenceSuggestion.inputValue === inputValue
    ? acceptedReferenceSuggestion
    : null;
  const referenceSuggestionsOpen = isCommandLineReferenceStep(step?.kind) &&
    Boolean(inputValue.trim()) && visibleSuggestions.length > 0 &&
    !acceptedReferenceForCurrentInput &&
    !(dismissedReferenceSuggestion?.identity === stepIdentity && dismissedReferenceSuggestion.inputValue === inputValue);

  useLayoutEffect(() => {
    if (isCanvasOriginSession) cancelStaleCommandLineSession();
  }, [isCanvasOriginSession, session, sourceRevision]);

  const confirmAndPersist = useCallback(() => {
    if (!useCadUiStore.getState().commandLineSession) return false;
    return confirmCommandLineSession(completionCommandContext);
  }, [completionCommandContext]);

  const cancelWithRestart = useCallback(() => {
    const current = useCadUiStore.getState().commandLineSession;
    if (!current || current.sourceInsertionOrigin !== "document-end") return false;
    setRestartRecipe(current.recipe);
    setCommandLineInputComposing(false);
    if (!cancelCommandLineSession()) {
      setRestartRecipe(null);
      return false;
    }
    return true;
  }, []);

  const restart = useCallback(() => {
    if (!restartRecipe) return false;
    const started = startCommandLineCreationForRecipe(restartRecipe, commandContext);
    if (started) setRestartRecipe(null);
    return started;
  }, [commandContext, restartRecipe]);

  const dismissRestart = useCallback(() => {
    if (!restartRecipe) return false;
    setRestartRecipe(null);
    setCommandLineInputComposing(false);
    commandContext.focusCanvas?.();
    return true;
  }, [commandContext, restartRecipe]);

  const applyNumberSuggestion = useCallback((option = activeSuggestionOptions[selectedNumberSuggestionIndex]) => {
    if (!activeSuggestionMatch || !option) return false;
    const nextValue = replaceNumericVariableSuggestionToken(inputValue, activeSuggestionMatch, option.expression);
    const nextCursor = activeSuggestionMatch.tokenStart + option.expression.length;
    setInputValue(nextValue);
    setNumberSuggestionActiveIndex(0);
    setDismissedNumberSuggestion({ identity: stepIdentity, inputValue: nextValue });
    setAcceptedNumberSuggestion({ identity: stepIdentity, inputValue: nextValue });
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
      setNumberSuggestionSelection({ start: nextCursor, end: nextCursor });
    });
    return true;
  }, [activeSuggestionMatch, activeSuggestionOptions, inputValue, selectedNumberSuggestionIndex, setInputValue, stepIdentity]);

  const applyReferenceSuggestion = useCallback((suggestion: ReferenceSuggestion) => {
    if (!applyPickReference(suggestion.pickRef, evaluation, completionCommandContext)) return false;
    setInputValue("");
    setReferenceSuggestionActiveIndex(0);
    setAcceptedReferenceSuggestion(null);
    return true;
  }, [completionCommandContext, evaluation, setInputValue]);

  const submitInput = useCallback(() => {
    if (!step) return confirmAndPersist();
    if (isCommandLineReferenceStep(step.kind)) {
      const query = inputValue.trim();
      if (!query) return skipCommandLineStep(completionCommandContext);
      if (acceptedReferenceForCurrentInput) return applyReferenceSuggestion(acceptedReferenceForCurrentInput.suggestion);
      const suggestion = visibleSuggestions[selectedReferenceSuggestionIndex];
      if (!suggestion) return false;
      return applyReferenceSuggestion(suggestion);
    }
    return submitCommandLineInput(inputValue, completionCommandContext);
  }, [acceptedReferenceForCurrentInput, applyReferenceSuggestion, completionCommandContext, confirmAndPersist, inputValue, step, selectedReferenceSuggestionIndex, visibleSuggestions]);

  const closeSuggestionPopup = useCallback(() => {
    if (numberSuggestionsOpen) {
      setDismissedNumberSuggestion({ identity: stepIdentity, inputValue });
      return true;
    }
    if (referenceSuggestionsOpen) {
      setDismissedReferenceSuggestion({ identity: stepIdentity, inputValue });
      return true;
    }
    return false;
  }, [inputValue, numberSuggestionsOpen, referenceSuggestionsOpen, stepIdentity]);

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (
      isImeComposingKeyEvent(event) ||
      isCommandLineInputComposing()
    ) return;
    if (isModifierEnter(event)) {
      event.preventDefault();
      skipCommandLineStepsToEnd(completionCommandContext);
      return;
    }
    if (step?.kind === "number" && numberSuggestionsOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setNumberSuggestionActiveIndex((index) => event.key === "ArrowDown"
          ? (index + 1) % activeSuggestionOptions.length
          : (index - 1 + activeSuggestionOptions.length) % activeSuggestionOptions.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        applyNumberSuggestion();
        return;
      }
    }
    if (step?.kind === "number" && numberSuggestionBlocking && event.key === "Enter") {
      event.preventDefault();
      return;
    }
    if (isCommandLineReferenceStep(step?.kind)) {
      if (referenceSuggestionsOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setReferenceSuggestionActiveIndex((index) => event.key === "ArrowDown"
          ? (index + 1) % visibleSuggestions.length
          : (index - 1 + visibleSuggestions.length) % visibleSuggestions.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        submitInput();
        return;
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submitInput();
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setAcceptedReferenceSuggestion(null);
    setAcceptedNumberSuggestion(null);
    setDismissedReferenceSuggestion((dismissed) =>
      dismissed?.identity === stepIdentity && dismissed.inputValue === nextValue ? dismissed : null
    );
    setDismissedNumberSuggestion((dismissed) =>
      dismissed?.identity === stepIdentity && dismissed.inputValue === nextValue ? dismissed : null
    );
    setReferenceSuggestionActiveIndex(0);
    setNumberSuggestionActiveIndex(0);
    setNumberSuggestionSelection({ start: event.target.selectionStart, end: event.target.selectionEnd });
    setInputValue(nextValue);
  };

  useEffect(() => {
    if (!session && !restartRecipe) setCommandLineInputComposing(false);
  }, [restartRecipe, session]);

  useEffect(() => {
    const viewport = canvasFocusRef.current;
    const dock = dockRef.current;
    const active = isCanvasOriginSession;
    if (!active && !restartRecipe) return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (isImeComposingKeyEvent(event) || isCommandLineInputComposing()) return;
      const target = event.target;
      const inDock = Boolean(dock && target instanceof Node && dock.contains(target));

      if (event.key === "Escape") {
        if (closeSuggestionPopup()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const canvasOwnsPickEscape = target === viewport && (
          activePointPickTarget || activeNumericReferencePickTarget || activeLinePickTarget
        );
        if (canvasOwnsPickEscape) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (active) cancelWithRestart();
        else dismissRestart();
        return;
      }
      if (!active) return;

      if (isModifierEnter(event) && (target === viewport || inDock || isTextEntryTarget(target))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        skipCommandLineStepsToEnd(completionCommandContext);
        return;
      }
      if (
        event.key === "Enter" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey &&
        (target === viewport || inDock || isTextEntryTarget(target))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        startCommandLinePickForCurrentStep(completionCommandContext);
        return;
      }
      if (event.key === "Enter" && target === viewport) {
        const state = useCadUiStore.getState();
        if (state.activePointPickTarget || state.activeNumericReferencePickTarget || state.activeLinePickTarget) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (currentStep(state.commandLineSession)) skipCommandLineStep(completionCommandContext);
        else confirmAndPersist();
      }
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => window.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [activeLinePickTarget, activeNumericReferencePickTarget, activePointPickTarget, canvasFocusRef, cancelWithRestart, closeSuggestionPopup, completionCommandContext, confirmAndPersist, dismissRestart, isCanvasOriginSession, restartRecipe, session, step?.kind]);

  useEffect(() => {
    if (!isCanvasOriginSession) return;
    if (!step) return;
    if (step.kind === "name" || step.kind === "number") {
      inputRef.current?.focus();
      return;
    }
    canvasFocusRef.current?.focus({ preventScroll: true });
  }, [canvasFocusRef, isCanvasOriginSession, session?.currentStepIndex, session?.editingStepIndex, step]);

  useEffect(() => {
    if (!restartRecipe) return;
    startAgainButtonRef.current?.focus();
  }, [restartRecipe]);

  if (session && !isCanvasOriginSession) return null;
  if (!session && !restartRecipe) return null;

  if (!session && restartRecipe) {
    return (
      <section
        ref={dockRef}
        className="vscode-creation-assist-dock vscode-creation-assist-restart"
        aria-label="Creation assist"
        onKeyDown={(event) => {
          if (isImeComposingKeyEvent(event)) return;
          if (event.key === "Enter" && event.target === event.currentTarget) {
            event.preventDefault();
            restart();
          }
        }}
      >
        <div className="vscode-creation-assist-restart-copy">
          <strong>Creation canceled</strong>
          <span>Restart the same recipe from the current document?</span>
        </div>
        <div className="vscode-creation-assist-actions">
          <button ref={startAgainButtonRef} type="button" onClick={restart}>Start again</button>
        </div>
      </section>
    );
  }

  if (!session) return null;
  const isLineList = step?.kind === "lineList";
  const lineListDraftCount = activeLinePickTarget?.draftLineIds?.length ?? 0;
  const stepLabel = commandLineStepLabel(step);
  const inputHelp = commandLineStepHelp(step);
  const activeStepIndex = session.currentStepIndex;
  const focusStepButton = (index: number) => {
    const boundedIndex = Math.max(0, Math.min(index, session.recipe.steps.length - 1));
    setFocusedStepIndex(boundedIndex);
    stepButtonRefs.current.get(boundedIndex)?.focus();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCommandLineInputComposing()) return;
    submitInput();
  };

  return (
    <form
      ref={dockRef as RefObject<HTMLFormElement>}
      className="vscode-creation-assist-dock"
      aria-label="VS Code creation assist"
      onSubmit={handleSubmit}
      onCompositionStart={() => setCommandLineInputComposing(true)}
      onCompositionEnd={() => setCommandLineInputComposing(false)}
    >
      <div className="vscode-creation-assist-header">
        <div className="vscode-creation-assist-title">
          <strong>{session.recipe.type}</strong>
          <span>{step ? `Step ${Math.min(session.currentStepIndex + 1, session.recipe.steps.length)} of ${session.recipe.steps.length}` : "Complete"}</span>
          <span aria-live="polite">{stepLabel}</span>
        </div>
        <div className="vscode-creation-assist-legend" aria-label="Creation assist shortcuts">
          Enter next · Shift+Enter pick · Esc cancel
        </div>
      </div>

      <ol className="vscode-creation-assist-navigator" aria-label="Creation recipe steps">
        {session.recipe.steps.map((recipeStep, index) => {
          const filled = hasCommandLineStepValue(session, index);
          const active = session.currentStepIndex === index;
          const completed = completedSteps.find((item) => item.stepIndex === index);
          return (
            <li key={`${index}-${recipeStep.kind}`}>
              <button
                type="button"
                className={[active ? "is-active" : "", filled ? "is-filled" : ""].filter(Boolean).join(" ")}
                aria-current={active ? "step" : undefined}
                data-filled={filled ? "true" : "false"}
                tabIndex={index === Math.min(focusedStepIndex, session.recipe.steps.length - 1) ? 0 : -1}
                ref={(element) => {
                  if (element) stepButtonRefs.current.set(index, element);
                  else stepButtonRefs.current.delete(index);
                }}
                onClick={() => {
                  setFocusedStepIndex(index);
                  if (useCadUiStore.getState().commandLineSession) activateCommandLineStep(index);
                }}
                onKeyDown={(event) => {
                  if ((event.key === "ArrowLeft" || event.key === "ArrowRight") &&
                    !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
                    event.preventDefault();
                    focusStepButton(index + (event.key === "ArrowRight" ? 1 : -1));
                    return;
                  }
                  if ((event.key === "Enter" || event.key === " ") &&
                    !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
                    event.preventDefault();
                    if (useCadUiStore.getState().commandLineSession) activateCommandLineStep(index);
                  }
                }}
              >
                <span className="vscode-creation-assist-step-number">{index + 1}</span>
                <span className="vscode-creation-assist-step-copy">
                  <strong>{commandLineStepLabel(recipeStep)}</strong>
                  <small>{completed?.value ?? "Not supplied"}</small>
                </span>
                <span
                  className="vscode-creation-assist-step-filled"
                  aria-label={filled ? "Filled" : undefined}
                  data-filled-marker={filled ? "true" : "false"}
                >{filled ? "✓" : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="vscode-creation-assist-body">
        {step ? (
          <div className="vscode-creation-assist-entry">
            <label htmlFor="vscode-creation-assist-input">{stepLabel}</label>
            <span className="vscode-creation-assist-help">{inputHelp}</span>
            {isLineList ? <span className="vscode-creation-assist-selection-count">{lineListDraftCount} selected</span> : null}
            {step.kind === "name" || step.kind === "number" || isCommandLineReferenceStep(step.kind) ? (
              <div className="vscode-creation-assist-input-wrap">
                <input
                  id="vscode-creation-assist-input"
                  ref={inputRef}
                  value={inputValue}
                  aria-label={stepLabel}
                  placeholder={isCommandLineReferenceStep(step.kind) ? "Search candidates" : step.kind === "name" ? "Optional name" : "Value or expression"}
                  onChange={handleInputChange}
                  onKeyDown={handleInputKeyDown}
                  onSelect={(event) => setNumberSuggestionSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                  onClick={(event) => setNumberSuggestionSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                />
                {referenceSuggestionsOpen ? (
                  <ul className="vscode-creation-assist-suggestions" role="listbox" aria-label="Reference candidates">
                    {visibleSuggestions.map((suggestion, index) => (
                      <li key={suggestion.pickRefKey}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={index === selectedReferenceSuggestionIndex}
                          onMouseEnter={() => setReferenceSuggestionActiveIndex(index)}
                          onClick={() => applyReferenceSuggestion(suggestion)}
                        >
                          <strong>{suggestion.displayLabel}</strong>
                          <small>{suggestion.canonicalToken}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {step.kind === "number" ? (
                  <NumericVariableSuggestPopover
                    options={numberSuggestionsOpen ? activeSuggestionOptions : []}
                    activeIndex={selectedNumberSuggestionIndex}
                    onHover={setNumberSuggestionActiveIndex}
                    onApply={applyNumberSuggestion}
                    anchorRef={inputRef}
                    className="vscode-creation-assist-numeric-suggestions"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="vscode-creation-assist-actions">
          {step?.kind === "number" || isCommandLineReferenceStep(step?.kind) ? (
            <button type="button" onClick={() => startCommandLinePickForCurrentStep(completionCommandContext)}>Pick on Canvas</button>
          ) : null}
          {isLineList && Array.isArray(activeLinePickTarget?.draftLineIds) ? (
            <button type="button" onClick={() => finishLinePick(completionCommandContext)}>Finish selection</button>
          ) : null}
          {((step?.kind === "number" || isCommandLineReferenceStep(step?.kind)) && hasCommandLineStepValue(session, session.currentStepIndex)) ? (
            <button type="button" onClick={() => clearCommandLineStepValue()}>Clear</button>
          ) : null}
          <button type="button" disabled={activeStepIndex <= 0} onClick={() => retreatCommandLineStep()}>Back</button>
          <button type="button" onClick={cancelWithRestart}>Cancel</button>
        </div>
      </div>
      {session.error ? <p className="vscode-creation-assist-error" role="alert">{session.error}</p> : null}
    </form>
  );
};
