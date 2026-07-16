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
  applySelectedPickCandidate,
  finishLinePick,
  selectPickCandidateByOffset,
  selectPickOptionByOffset
} from "../commands/pickCommands";
import { elementQualifiedName } from "../model/elementNames";
import { creationPlacementForEvaluationLimit } from "../model/elementCreationPlacement";
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

type NameSuggestion = {
  value: string;
  elementId: string;
  optionIndex: number;
};

export const CommandLineBar = ({ commandContext, evaluation }: CommandLineBarProps) => {
  const session = useCadUiStore((state) => state.commandLineSession);
  const sourceRevision = useCadDocumentStore((state) => state.sourceRevision);
  const elements = useCadDocumentStore((state) => state.elements);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const activePickCursor = useCadUiStore((state) => state.activePickCursor);
  const groupFoldById = useCadUiStore((state) => state.groupFoldById);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const progressButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const previousEditingStepIndexRef = useRef<number | null>(null);
  const [inputState, setInputState] = useState({ step: "", value: "" });
  const [numberSuggestionSelection, setNumberSuggestionSelection] =
    useState<{ start: number | null; end: number | null }>({ start: null, end: null });
  const [numberSuggestionActiveIndex, setNumberSuggestionActiveIndex] = useState(0);
  const step = currentStep(session);
  const isEditing = session ? isEditingCommandLineStep(session) : false;
  const stepKey = step && step.kind !== "name" ? step.key : null;
  const stepIdentity = session
    ? `${session.startedAtRevision}:${session.currentStepIndex}:${session.editingStepIndex ?? "new"}:${stepKey ?? "name"}`
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
  const selectedNumberSuggestionIndex = activeSuggestionOptions.length === 0
    ? 0
    : Math.min(numberSuggestionActiveIndex, activeSuggestionOptions.length - 1);
  const applyNumberVariableSuggestion = (option = activeSuggestionOptions[selectedNumberSuggestionIndex]) => {
    if (!activeSuggestionMatch || !option) return;
    const nextValue = replaceNumericVariableSuggestionToken(inputValue, activeSuggestionMatch, option.expression);
    setInputValue(nextValue);
    setNumberSuggestionActiveIndex(0);
    const nextCursor = activeSuggestionMatch.tokenStart + option.expression.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
      setNumberSuggestionSelection({ start: nextCursor, end: nextCursor });
    });
  };
  const candidates = useMemo(
    () => session && isCommandLineReferenceStep(step?.kind) ? activePickCandidates() : [],
    [session, step?.kind]
  );
  const suggestions = useMemo<NameSuggestion[]>(() => {
    if (!session || !isCommandLineReferenceStep(step?.kind)) return [];
    return candidates.flatMap((candidate) => {
      const element = elements.find((item) => item.id === candidate.elementId);
      if (!element) return [];
      const qualifiedName = elementQualifiedName(element, elements);
      return candidate.options.map((option, optionIndex) => ({
        value: candidate.options.length === 1 ? qualifiedName : `${qualifiedName} ${option.label}`,
        elementId: candidate.elementId,
        optionIndex
      }));
    });
  }, [candidates, elements, session, step?.kind]);
  const visibleSuggestions = useMemo(() => {
    const query = inputValue.trim().toLocaleLowerCase();
    if (!query) return suggestions.slice(0, 8);
    return suggestions.filter((item) => item.value.toLocaleLowerCase().includes(query)).slice(0, 8);
  }, [inputValue, suggestions]);
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
    const element = elements.find((item) => item.id === selected.elementId);
    if (!element) return null;
    const qualifiedName = elementQualifiedName(element, elements);
    const option = selected.options[0];
    return selected.options.length === 1 || !option ? qualifiedName : `${qualifiedName} ${option.label}`;
  })();
  const placeholder = step?.kind === "name"
    ? session.nameSuggestion
    : step?.kind === "number" && step.default !== undefined
      ? `Enterで ${step.default}`
      : isCommandLineReferenceStep(step?.kind)
        ? "候補名を入力"
        : "値または式を入力";

  const applySuggestion = (suggestion: NameSuggestion) => {
    useCadUiStore.getState().setActivePickCursor({
      elementId: suggestion.elementId,
      optionIndex: suggestion.optionIndex
    });
    applySelectedPickCandidate();
    setInputValue("");
  };

  const submitReferenceInput = () => {
    if (!step || !isCommandLineReferenceStep(step.kind)) return false;
    const query = inputValue.trim();
    if (query) {
      const exact = suggestions.find((item) => item.value === query);
      const uniquePartial = visibleSuggestions.length === 1 ? visibleSuggestions[0] : null;
      if (!exact && !uniquePartial) return false;
      applySuggestion(exact ?? uniquePartial!);
      return true;
    }
    if (activePickCursor) {
      applySelectedPickCandidate();
      setInputValue("");
      return true;
    }
    const selected = candidates.find((candidate) => candidate.elementId === selectedElementId);
    if (!selected) return false;
    applySuggestion({
      value: "",
      elementId: selected.elementId,
      optionIndex: 0
    });
    return true;
  };

  return (
    <form
      className="command-line-bar"
      aria-label="コマンドライン作成"
      onSubmit={(event) => {
        event.preventDefault();
        if (isCommandLineInputComposing()) return;
        if (submitReferenceInput()) return;
        submitCommandLineInput(inputValue, commandContext);
      }}
      onKeyDown={(event) => {
        if (isImeComposingKeyEvent(event) || isCommandLineInputComposing()) return;
        if (step?.kind === "number" && activeSuggestionOptions.length > 0) {
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
          if (event.key === "Tab" || event.key === "Enter") {
            event.preventDefault();
            applyNumberVariableSuggestion();
            return;
          }
        }
        if (step?.kind === "lineList" && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          finishLinePick();
          return;
        }
        if (activePickCursor || isCommandLineReferenceStep(step?.kind)) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            selectPickCandidateByOffset(1);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            selectPickCandidateByOffset(-1);
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            selectPickOptionByOffset(1);
            return;
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            selectPickOptionByOffset(-1);
            return;
          }
        }
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancelCommandLineEscape();
      }}
      onCompositionStart={() => setCommandLineInputComposing(true)}
      onCompositionEnd={() => setCommandLineInputComposing(false)}
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
                    setInputValue(event.target.value);
                    setNumberSuggestionSelection({ start: event.target.selectionStart, end: event.target.selectionEnd });
                    setNumberSuggestionActiveIndex(0);
                  }}
                  onClick={(event) => setNumberSuggestionSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                  onSelect={(event) => setNumberSuggestionSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                  onKeyUp={(event) => setNumberSuggestionSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                />
                {isCommandLineReferenceStep(step.kind) && visibleSuggestions.length > 0 ? (
                  <ul className="command-line-suggestions" role="listbox" aria-label="参照候補">
                    {visibleSuggestions.map((suggestion) => (
                      <li key={`${suggestion.elementId}:${suggestion.optionIndex}`}>
                        <button type="button" onClick={() => applySuggestion(suggestion)}>{suggestion.value}</button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {step.kind === "number" ? (
                  <NumericVariableSuggestPopover
                    options={activeSuggestionOptions}
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
                {canSkip ? <button type="button" onClick={() => skipCommandLineStep()}>スキップ</button> : null}
                {isEditing ? (
                  <>
                    <button className="command-line-bar-confirm" type="submit">変更を確定（Enter）</button>
                    <button type="button" onClick={() => cancelCommandLineStepEdit()}>編集をやめる</button>
                  </>
                ) : session.currentStepIndex > 0 ? <button type="button" onClick={() => retreatCommandLineStep()}>戻る</button> : null}
                <button type="button" onClick={() => cancelCommandLineSession()}>キャンセル（Esc）</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="command-line-bar-complete">入力完了。Enterで作成します。</p>
            <div className="command-line-bar-actions">
              <button ref={confirmButtonRef} className="command-line-bar-confirm" type="submit">作成（Enter）</button>
              {session.currentStepIndex > 0 ? <button type="button" onClick={() => retreatCommandLineStep()}>戻る</button> : null}
              <button type="button" onClick={() => cancelCommandLineSession()}>キャンセル（Esc）</button>
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
                onClick={() => startCommandLineStepEdit(item.stepIndex)}
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
