import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CommandContext } from "../commands/commandTypes";
import {
  isCommandLineInputComposing,
  setCommandLineInputComposing
} from "../commands/commandLineInputComposition";
import {
  cancelCommandLineEscape,
  cancelCommandLineSession,
  cancelCommandLineStepEdit,
  cancelStaleCommandLineSession,
  retreatCommandLineStep,
  skipCommandLineStep,
  startCommandLineStepEdit,
  startCommandLineNumericReferencePick,
  submitCommandLineInput
} from "../commands/commandLineSessionCommands";
import { currentStep, isEditingCommandLineStep } from "../commands/commandLineSession";
import {
  activePickCandidates,
  applyPickReference,
  applySelectedPickCandidate,
  finishLinePick,
  selectPickCandidateByOffset,
  selectPickOptionByOffset
} from "../commands/pickCommands";
import { creationPlacementForEvaluationLimit } from "../model/elementCreationPlacement";
import {
  rankedReferenceSuggestions,
  referenceSuggestions,
  type ReferenceSuggestion
} from "../model/referenceSuggestions";
import { numericVariableReferenceOptionsForPosition } from "../geometry/variableReferenceOptions";
import { elementParameterReferenceOptionsForPosition } from "../geometry/elementParameterReferenceOptions";
import {
  filteredNumericVariableSuggestions,
  numericVariableSuggestionMatch,
  replaceNumericVariableSuggestionToken
} from "./numericVariableSuggestion";
import {
  asNumericVariableReferenceOptions,
  elementParameterSuggestionMatch,
  filteredElementParameterSuggestions
} from "./elementParameterSuggestion";
import { NumericVariableSuggestPopover } from "./NumericVariableSuggestPopover";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import { elementTypeLabels, type EvaluationResult } from "../types/geometry";
import {
  commandLineEditingInputValue,
  commandLineStepLabel,
  completedCommandLineSteps
} from "./commandLineProgress";
import { commandLineStepHelp, isCommandLineReferenceStep } from "./commandLineBarHelpers";

type CommandLineBarProps = {
  commandContext?: CommandContext;
  evaluation?: EvaluationResult;
};

export const CommandLineBar = ({ commandContext, evaluation }: CommandLineBarProps) => {
  const session = useCadUiStore((state) => state.commandLineSession);
  const sourceRevision = useCadDocumentStore((state) => state.sourceRevision);
  const elements = useCadDocumentStore((state) => state.elements);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const activePickCursor = useCadUiStore((state) => state.activePickCursor);
  const lineListDraftSignature = useCadUiStore((state) =>
    state.activeLinePickTarget?.draftLineIds?.join("\0") ?? ""
  );
  const groupFoldById = useCadUiStore((state) => state.groupFoldById);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const progressButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const previousEditingStepIndexRef = useRef<number | null>(null);
  const [inputState, setInputState] = useState({ step: "", value: "" });
  const [numberSuggestionSelection, setNumberSuggestionSelection] =
    useState<{ start: number | null; end: number | null }>({ start: null, end: null });
  const [numberSuggestionActiveIndex, setNumberSuggestionActiveIndex] = useState(0);
  const [referenceSuggestionActiveIndex, setReferenceSuggestionActiveIndex] = useState(0);
  const [referenceInputComposing, setReferenceInputComposing] = useState(false);
  // Tab only reflects a reference candidate into the input. Keep its stable
  // PickRef until the following Enter can use the normal canvas-pick path;
  // never try to recover it from the displayed string.
  const [acceptedReferenceSuggestion, setAcceptedReferenceSuggestion] = useState<{
    stepIdentity: string;
    inputValue: string;
    suggestion: ReferenceSuggestion;
  } | null>(null);
  // Space dismisses a numeric completion and falls through to native text
  // input. Remember that dismissal for this exact value so the popup does not
  // immediately reopen before the browser's input event arrives.
  const [dismissedNumberSuggestion, setDismissedNumberSuggestion] = useState<{
    stepIdentity: string;
    inputValue: string;
  } | null>(null);
  // Numeric variable/parameter candidates use the ordinary numeric submit
  // route after Tab. Track that one accepted replacement explicitly so Enter
  // does not rely on native form submission being forwarded by the webview.
  const [acceptedNumberSuggestion, setAcceptedNumberSuggestion] = useState<{
    stepIdentity: string;
    inputValue: string;
  } | null>(null);
  const [dismissedReferenceSuggestion, setDismissedReferenceSuggestion] = useState<{
    stepIdentity: string;
    inputValue: string;
  } | null>(null);
  const step = currentStep(session);
  const isEditing = session ? isEditingCommandLineStep(session) : false;
  const stepKey = step && step.kind !== "name" ? step.key : null;
  const stepIdentity = session
    ? `${session.startedAtRevision}:${session.currentStepIndex}:${session.editingStepIndex ?? "new"}:${stepKey ?? "name"}:${step?.kind === "lineList" ? lineListDraftSignature : ""}`
    : "";
  const inputValue = inputState.step === stepIdentity
    ? inputState.value
    : session ? commandLineEditingInputValue(session, step) : "";
  const setInputValue = (value: string) => setInputState({ step: stepIdentity, value });
  const numberVariableOptions = useMemo(() => {
    if (!session || step?.kind !== "number") return [];
    const placement = creationPlacementForEvaluationLimit(elements, session.insertionIndex, groupFoldById);
    return numericVariableReferenceOptionsForPosition({
      referenceElements: placement.referenceElements,
      parentGroupId: placement.parentGroupId,
      computedVariables: evaluation?.computedVariables
    });
  }, [session, step, elements, groupFoldById, evaluation]);
  const numberSuggestionMatch = step?.kind === "number" && !isCommandLineInputComposing()
    ? numericVariableSuggestionMatch(inputValue, numberSuggestionSelection.start, numberSuggestionSelection.end)
    : null;
  const visibleNumberVariableSuggestions = numberSuggestionMatch
    ? filteredNumericVariableSuggestions(numberVariableOptions, numberSuggestionMatch.query)
    : [];
  const elementParamMatch = step?.kind === "number" && !isCommandLineInputComposing() && !numberSuggestionMatch
    ? elementParameterSuggestionMatch(inputValue, numberSuggestionSelection.start, numberSuggestionSelection.end)
    : null;
  // Not memoized (unlike numberVariableOptions above): the element token
  // changes on nearly every keystroke while typing the name, so a useMemo
  // boundary here would rarely hit and isn't worth the dependency-tracking
  // overhead (also avoids depending on a value derived from a conditional
  // expression, which the React Compiler can't safely memoize around).
  const elementParamPlacement = session && step?.kind === "number"
    ? creationPlacementForEvaluationLimit(elements, session.insertionIndex, groupFoldById)
    : null;
  const elementParamOptions = !elementParamPlacement || !elementParamMatch
    ? []
    : elementParameterReferenceOptionsForPosition({
        referenceElements: elementParamPlacement.referenceElements,
        elementToken: elementParamMatch.elementToken,
        currentElement: { parentGroupId: elementParamPlacement.parentGroupId },
        evaluation: {
          computedGeometry: evaluation?.computedGeometry ?? new Map(),
          computedVariables: evaluation?.computedVariables ?? new Map(),
          effectiveEnabledElementIds: evaluation?.effectiveEnabledElementIds,
          errors: evaluation?.errors ?? []
        }
      });
  const visibleElementParamSuggestions = elementParamMatch
    ? filteredElementParameterSuggestions(elementParamOptions, elementParamMatch.query)
    : [];
  // Merges the two mutually-exclusive suggestion sources (see
  // dslElementParameterToken.ts for why they can't both match at once) behind
  // one active concept so keyboard nav, the popover, and apply share one path
  // without touching CM's own session lifecycle (this file has no CM
  // involvement) or the @variable code above, which stays unmodified.
  const activeSuggestionMatch = numberSuggestionMatch ?? elementParamMatch;
  const activeSuggestionOptions = numberSuggestionMatch
    ? visibleNumberVariableSuggestions
    : asNumericVariableReferenceOptions(visibleElementParamSuggestions);
  const numberSuggestionsOpen = activeSuggestionOptions.length > 0 && !(
    dismissedNumberSuggestion?.stepIdentity === stepIdentity &&
    dismissedNumberSuggestion.inputValue === inputValue
  );
  const acceptedNumberForCurrentInput =
    acceptedNumberSuggestion?.stepIdentity === stepIdentity &&
    acceptedNumberSuggestion.inputValue === inputValue
      ? acceptedNumberSuggestion
      : null;
  const selectedNumberSuggestionIndex = activeSuggestionOptions.length === 0
    ? 0
    : Math.min(numberSuggestionActiveIndex, activeSuggestionOptions.length - 1);
  const numberSuggestionReplacement = (option = activeSuggestionOptions[selectedNumberSuggestionIndex]) => {
    if (!activeSuggestionMatch || !option) return;
    const nextValue = replaceNumericVariableSuggestionToken(inputValue, activeSuggestionMatch, option.expression);
    return {
      nextValue,
      nextCursor: activeSuggestionMatch.tokenStart + option.expression.length
    };
  };
  const applyNumberVariableSuggestion = (option = activeSuggestionOptions[selectedNumberSuggestionIndex]) => {
    const replacement = numberSuggestionReplacement(option);
    if (!replacement) return;
    const { nextValue, nextCursor } = replacement;
    setInputValue(nextValue);
    setNumberSuggestionActiveIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
      setNumberSuggestionSelection({ start: nextCursor, end: nextCursor });
    });
    return nextValue;
  };
  const referencePlacement = useMemo(
    () => session && isCommandLineReferenceStep(step?.kind)
      ? creationPlacementForEvaluationLimit(elements, session.insertionIndex, groupFoldById)
      : null,
    [elements, groupFoldById, session, step?.kind]
  );
  const candidates = useMemo(
    () => {
      void lineListDraftSignature;
      return session && isCommandLineReferenceStep(step?.kind) ? activePickCandidates(evaluation) : [];
    },
    [evaluation, lineListDraftSignature, session, step?.kind]
  );
  const suggestions = useMemo<ReferenceSuggestion[]>(() => {
    if (!session || !isCommandLineReferenceStep(step?.kind)) return [];
    return referenceSuggestions({
      candidates,
      elements: referencePlacement?.referenceElements ?? elements,
      currentElement: { parentGroupId: referencePlacement?.parentGroupId }
    });
  }, [candidates, elements, referencePlacement, session, step?.kind]);
  const visibleSuggestions = useMemo(() => {
    if (referenceInputComposing) return [];
    return rankedReferenceSuggestions(suggestions, inputValue, 8);
  }, [inputValue, referenceInputComposing, suggestions]);
  const selectedReferenceSuggestionIndex = visibleSuggestions.length === 0
    ? 0
    : Math.min(referenceSuggestionActiveIndex, visibleSuggestions.length - 1);
  const acceptedReferenceForCurrentInput =
    acceptedReferenceSuggestion?.stepIdentity === stepIdentity &&
    acceptedReferenceSuggestion.inputValue === inputValue
      ? acceptedReferenceSuggestion
      : null;
  const referenceSuggestionsOpen =
    isCommandLineReferenceStep(step?.kind) &&
    Boolean(inputValue.trim()) &&
    visibleSuggestions.length > 0 &&
    !acceptedReferenceForCurrentInput &&
    !(dismissedReferenceSuggestion?.stepIdentity === stepIdentity &&
      dismissedReferenceSuggestion.inputValue === inputValue);
  const completedSteps = useMemo(
    () => session ? completedCommandLineSteps(session, elements) : [],
    [elements, session]
  );
  const editingStep = completedSteps.find((item) => item.stepIndex === session?.editingStepIndex) ?? null;

  useLayoutEffect(() => {
    if (session) cancelStaleCommandLineSession();
  }, [session, sourceRevision]);

  useEffect(() => {
    if (!session) return;
    const previousEditingStepIndex = previousEditingStepIndexRef.current;
    previousEditingStepIndexRef.current = session.editingStepIndex;
    if (isEditing || step) {
      inputRef.current?.focus();
      return;
    }
    if (previousEditingStepIndex !== null) {
      const focusTarget = progressButtonRefs.current.get(previousEditingStepIndex) ?? confirmButtonRef.current;
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => focusTarget?.focus());
      else focusTarget?.focus();
      return;
    }
    confirmButtonRef.current?.focus();
  }, [isEditing, session, step]);

  useEffect(() => {
    if (!session) setCommandLineInputComposing(false);
  }, [session]);

  useEffect(() => () => setCommandLineInputComposing(false), []);

  if (!session) return null;
  const canSkip = step?.kind === "name" || (step?.kind === "number" && step.default !== undefined);
  const stepLabel = commandLineStepLabel(step);
  const inputHelp = commandLineStepHelp(step);
  // Mirrors submitReferenceInput's empty-Enter selection adoption exactly: only
  // when no typed query and no pick cursor take precedence, and only when the
  // selected element is in the shared candidate set (never adopted otherwise).
  const selectedAdoptionName = (() => {
    if (!isCommandLineReferenceStep(step?.kind) || isCommandLineInputComposing()) return null;
    if (inputValue.trim() || activePickCursor) return null;
    const selected = candidates.find((candidate) => candidate.elementId === selectedElementId);
    if (!selected) return null;
    return suggestions.find((suggestion) => suggestion.pickRef.candidateElementId === selected.elementId)?.displayLabel ?? null;
  })();
  const placeholder = step?.kind === "name"
    ? session.nameSuggestion
    : step?.kind === "number" && step.default !== undefined
      ? `Enterで ${step.default}`
      : isCommandLineReferenceStep(step?.kind)
        ? "候補名を入力"
        : "値または式を入力";

  const applySuggestion = (suggestion: ReferenceSuggestion) => {
    if (!applyPickReference(suggestion.pickRef, evaluation)) return false;
    setInputValue("");
    setReferenceSuggestionActiveIndex(0);
    setAcceptedReferenceSuggestion(null);
    return true;
  };

  const clearPendingSuggestionState = () => {
    setAcceptedReferenceSuggestion(null);
    setDismissedNumberSuggestion(null);
    setAcceptedNumberSuggestion(null);
    setDismissedReferenceSuggestion(null);
  };

  const submitReferenceInput = () => {
    if (!step || !isCommandLineReferenceStep(step.kind)) return false;
    const query = inputValue.trim();
    if (query) {
      return acceptedReferenceForCurrentInput
        ? applySuggestion(acceptedReferenceForCurrentInput.suggestion)
        : false;
    }
    if (activePickCursor) {
      applySelectedPickCandidate(evaluation);
      setInputValue("");
      return true;
    }
    const selected = candidates.find((candidate) => candidate.elementId === selectedElementId);
    if (!selected) return false;
    const suggestion = suggestions.find((item) => item.pickRef.candidateElementId === selected.elementId);
    if (!suggestion) return false;
    return applySuggestion(suggestion);
  };
  const ownsReferenceKeyboardEvent = (target: EventTarget | null) =>
    target === inputRef.current ||
    (target instanceof Element && target.closest(".command-line-suggestions") !== null);
  const inputValueWithSpace = () => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? inputValue.length;
    const end = input?.selectionEnd ?? start;
    return `${inputValue.slice(0, start)} ${inputValue.slice(end)}`;
  };

  return (
    <form
      className="command-line-bar"
      aria-label="コマンドライン作成"
      onSubmit={(event) => {
        event.preventDefault();
        if (referenceInputComposing || isCommandLineInputComposing()) return;
        if (submitReferenceInput()) return;
        clearPendingSuggestionState();
        submitCommandLineInput(inputValue, commandContext);
      }}
      onKeyDown={(event) => {
        if (
          referenceInputComposing ||
          isImeComposingKeyEvent(event) ||
          event.nativeEvent.isComposing ||
          isCommandLineInputComposing()
        ) return;
        if (step?.kind === "number" && numberSuggestionsOpen) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setNumberSuggestionActiveIndex((index) => (index + 1) % activeSuggestionOptions.length);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setNumberSuggestionActiveIndex((index) => (index - 1 + activeSuggestionOptions.length) % activeSuggestionOptions.length);
            return;
          }
          if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            const replacement = applyNumberVariableSuggestion();
            if (replacement) {
              setDismissedNumberSuggestion({ stepIdentity, inputValue: replacement });
              setAcceptedNumberSuggestion({ stepIdentity, inputValue: replacement });
            }
            return;
          }
          if (event.code === "Space" && !event.metaKey && !event.ctrlKey && !event.altKey) {
            setDismissedNumberSuggestion({ stepIdentity, inputValue: inputValueWithSpace() });
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const replacement = applyNumberVariableSuggestion();
            if (replacement) {
              setDismissedNumberSuggestion({ stepIdentity, inputValue: replacement });
              setAcceptedNumberSuggestion({ stepIdentity, inputValue: replacement });
            }
            return;
          }
        }
        if (step?.kind === "number" && acceptedNumberForCurrentInput && event.key === "Enter") {
          event.preventDefault();
          clearPendingSuggestionState();
          submitCommandLineInput(inputValue, commandContext);
          return;
        }
        const ownsReferenceKeyboard = ownsReferenceKeyboardEvent(event.target);
        if (
          ownsReferenceKeyboard &&
          step?.kind === "lineList" &&
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          clearPendingSuggestionState();
          finishLinePick();
          return;
        }
        if (ownsReferenceKeyboard && referenceSuggestionsOpen) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (visibleSuggestions.length > 0) {
              setReferenceSuggestionActiveIndex((index) => (index + 1) % visibleSuggestions.length);
            }
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (visibleSuggestions.length > 0) {
              setReferenceSuggestionActiveIndex((index) =>
                (index - 1 + visibleSuggestions.length) % visibleSuggestions.length
              );
            }
            return;
          }
          if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            const suggestion = visibleSuggestions[selectedReferenceSuggestionIndex];
            if (suggestion) {
              setInputValue(suggestion.canonicalToken);
              setReferenceSuggestionActiveIndex(0);
              setAcceptedReferenceSuggestion({ stepIdentity, inputValue: suggestion.canonicalToken, suggestion });
            }
            return;
          }
          if (event.code === "Space" && !event.metaKey && !event.ctrlKey && !event.altKey) {
            setDismissedReferenceSuggestion({ stepIdentity, inputValue: inputValueWithSpace() });
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const suggestion = visibleSuggestions[selectedReferenceSuggestionIndex];
            if (suggestion) {
              setInputValue(suggestion.canonicalToken);
              setReferenceSuggestionActiveIndex(0);
              setAcceptedReferenceSuggestion({ stepIdentity, inputValue: suggestion.canonicalToken, suggestion });
            }
            return;
          }
        } else if (ownsReferenceKeyboard && acceptedReferenceForCurrentInput && event.key === "Enter") {
          event.preventDefault();
          applySuggestion(acceptedReferenceForCurrentInput.suggestion);
          return;
        } else if (ownsReferenceKeyboard && (activePickCursor || isCommandLineReferenceStep(step?.kind))) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            selectPickCandidateByOffset(1, evaluation);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            selectPickCandidateByOffset(-1, evaluation);
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            selectPickOptionByOffset(1, evaluation);
            return;
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            selectPickOptionByOffset(-1, evaluation);
            return;
          }
        }
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        clearPendingSuggestionState();
        cancelCommandLineEscape();
      }}
      onCompositionStart={() => {
        setReferenceInputComposing(true);
        setCommandLineInputComposing(true);
      }}
      onCompositionEnd={() => {
        setReferenceInputComposing(false);
        setCommandLineInputComposing(false);
      }}
    >
      <div className="command-line-bar-meta">
        <span className="command-line-bar-title">{elementTypeLabels[session.recipe.type]}</span>
        <span className="command-line-bar-step">{Math.min(session.currentStepIndex + 1, session.recipe.steps.length)} / {session.recipe.steps.length}</span>
        <span className="command-line-bar-status" aria-live="polite">
          {isEditing ? `編集中：${stepLabel}` : step ? `入力中：${stepLabel}` : stepLabel}
        </span>
      </div>
      <div className="command-line-bar-entry">
        {step ? (
          <>
            <label htmlFor="command-line-input">{isEditing ? "編集中" : "入力中"}：{stepLabel}</label>
            {isEditing && editingStep ? <span className="command-line-bar-current-value">現在値：{editingStep.value}</span> : null}
            <span id="command-line-input-help" className="command-line-bar-help">{inputHelp}</span>
            {isCommandLineReferenceStep(step.kind) && !inputValue.trim() ? (
              <span className="command-line-bar-help">
                Canvasで選択できます{step.kind === "lineList" && lineListDraftSignature
                  ? `（選択済み ${lineListDraftSignature.split("\0").length}件）`
                  : ""}
              </span>
            ) : null}
            {selectedAdoptionName ? (
              <span className="command-line-bar-adopt">Enterで選択中を採用：{selectedAdoptionName}</span>
            ) : null}
            <div className="command-line-bar-entry-row">
              <div className="command-line-bar-input-wrap">
                <input
                  id="command-line-input"
                  ref={inputRef}
                  value={inputValue}
                  placeholder={placeholder}
                  aria-label={stepLabel}
                  aria-describedby="command-line-input-help"
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setAcceptedReferenceSuggestion(null);
                    setAcceptedNumberSuggestion(null);
                    setDismissedNumberSuggestion((dismissed) =>
                      dismissed?.stepIdentity === stepIdentity && dismissed.inputValue === nextValue
                        ? dismissed
                        : null
                    );
                    setDismissedReferenceSuggestion((dismissed) =>
                      dismissed?.stepIdentity === stepIdentity && dismissed.inputValue === nextValue
                        ? dismissed
                        : null
                    );
                    if (isCommandLineReferenceStep(step.kind)) {
                      if (nextValue.trim()) useCadUiStore.getState().setActivePickCursor(null);
                      setReferenceSuggestionActiveIndex(0);
                    }
                    setInputValue(nextValue);
                    setNumberSuggestionSelection({ start: event.target.selectionStart, end: event.target.selectionEnd });
                    setNumberSuggestionActiveIndex(0);
                  }}
                  onClick={(event) => setNumberSuggestionSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                  onSelect={(event) => setNumberSuggestionSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                  onKeyUp={(event) => setNumberSuggestionSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                />
                {referenceSuggestionsOpen ? (
                  <ul className="command-line-suggestions" role="listbox" aria-label="参照候補">
                    {visibleSuggestions.map((suggestion, index) => (
                      <li key={suggestion.pickRefKey}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={index === selectedReferenceSuggestionIndex}
                          className={index === selectedReferenceSuggestionIndex ? "active-suggestion" : undefined}
                          onMouseEnter={() => setReferenceSuggestionActiveIndex(index)}
                          onClick={() => applySuggestion(suggestion)}
                        >
                          {suggestion.displayLabel}
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
                    onApply={applyNumberVariableSuggestion}
                  />
                ) : null}
              </div>
              <div className="command-line-bar-actions">
                {step.kind === "number" ? (
                  <button type="button" onClick={() => startCommandLineNumericReferencePick()}>参照値を選択</button>
                ) : null}
                {step.kind === "lineList" ? (
                  <button type="button" onClick={() => { clearPendingSuggestionState(); finishLinePick(); }}>選択を完了</button>
                ) : null}
                {canSkip ? <button type="button" onClick={() => { clearPendingSuggestionState(); skipCommandLineStep(); }}>スキップ</button> : null}
                {isEditing ? (
                  <>
                    <button className="command-line-bar-confirm" type="submit">変更を確定（Enter）</button>
                    <button type="button" onClick={() => { clearPendingSuggestionState(); cancelCommandLineStepEdit(); }}>編集をやめる</button>
                  </>
                ) : session.currentStepIndex > 0 ? <button type="button" onClick={() => { clearPendingSuggestionState(); retreatCommandLineStep(); }}>戻る</button> : null}
                <button type="button" onClick={() => { clearPendingSuggestionState(); cancelCommandLineSession(); }}>キャンセル（Esc）</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="command-line-bar-complete">入力完了。Enterで作成します。</p>
            <div className="command-line-bar-actions">
              <button ref={confirmButtonRef} className="command-line-bar-confirm" type="submit">作成（Enter）</button>
              {session.currentStepIndex > 0 ? <button type="button" onClick={() => { clearPendingSuggestionState(); retreatCommandLineStep(); }}>戻る</button> : null}
              <button type="button" onClick={() => { clearPendingSuggestionState(); cancelCommandLineSession(); }}>キャンセル（Esc）</button>
            </div>
          </>
        )}
      </div>
      {session.error ? <p className="command-line-bar-error" role="alert">{session.error}</p> : null}
      <details className="command-line-bar-progress" open={completedSteps.length > 0}>
        <summary>完了済み {completedSteps.length}項目</summary>
        <ul aria-label="完了済みの入力">
          {completedSteps.map((item) => (
            <li className={item.stepIndex === session.editingStepIndex ? "is-editing" : undefined} key={item.key}>
              <button
                ref={(node) => {
                  if (node) progressButtonRefs.current.set(item.stepIndex, node);
                  else progressButtonRefs.current.delete(item.stepIndex);
                }}
                type="button"
                aria-label={`${item.label}を編集`}
                onClick={() => { clearPendingSuggestionState(); startCommandLineStepEdit(item.stepIndex); }}
              >
                <span>{item.label}</span><span>{item.value}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </form>
  );
};
