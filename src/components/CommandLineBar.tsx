import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CommandContext } from "../commands/commandTypes";
import {
  isCommandLineInputComposing,
  setCommandLineInputComposing
} from "../commands/commandLineInputComposition";
import {
  cancelCommandLineSession,
  cancelStaleCommandLineSession,
  retreatCommandLineStep,
  skipCommandLineStep,
  startCommandLineNumericReferencePick,
  submitCommandLineInput
} from "../commands/commandLineSessionCommands";
import { currentStep } from "../commands/commandLineSession";
import type { CreationStep } from "../commands/creationRecipes";
import {
  activePickCandidates,
  applySelectedPickCandidate,
  finishLinePick,
  selectPickCandidateByOffset,
  selectPickOptionByOffset
} from "../commands/pickCommands";
import { elementQualifiedName } from "../model/elementNames";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import { elementTypeLabels } from "../types/geometry";
import { commandLineStepLabel, completedCommandLineSteps } from "./commandLineProgress";

type CommandLineBarProps = {
  commandContext?: CommandContext;
};

type NameSuggestion = {
  value: string;
  elementId: string;
  optionIndex: number;
};

const isReferenceStep = (kind: CreationStep["kind"] | undefined) =>
  kind === "point" || kind === "endpoint" || kind === "line" || kind === "lineList";

const helpForStep = (step: CreationStep | null) => {
  if (!step) return "入力完了。Enterで作成します。";
  if (step.kind === "name") return "空Enterで候補の名前を採用します。";
  if (step.kind === "point" || step.kind === "endpoint" || step.kind === "line") {
    return "クリック、名前入力、または空Enterで選択中の候補を採用します。";
  }
  if (step.kind === "lineList") return "クリックまたは名前入力で選び、⌘Enterで完了します。";
  return step.default === undefined ? "値または式を入力します。" : `空Enterで ${step.default} を採用します。`;
};

export const CommandLineBar = ({ commandContext }: CommandLineBarProps) => {
  const session = useCadUiStore((state) => state.commandLineSession);
  const sourceRevision = useCadDocumentStore((state) => state.sourceRevision);
  const elements = useCadDocumentStore((state) => state.elements);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const activePickCursor = useCadUiStore((state) => state.activePickCursor);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [inputState, setInputState] = useState({ step: "", value: "" });
  const step = currentStep(session);
  const stepKey = step && step.kind !== "name" ? step.key : null;
  const stepIdentity = session ? `${session.startedAtRevision}:${session.currentStepIndex}:${stepKey ?? "name"}` : "";
  const inputValue = inputState.step === stepIdentity ? inputState.value : "";
  const setInputValue = (value: string) => setInputState({ step: stepIdentity, value });
  const candidates = useMemo(
    () => session && isReferenceStep(step?.kind) ? activePickCandidates() : [],
    [session, step?.kind]
  );
  const suggestions = useMemo<NameSuggestion[]>(() => {
    if (!session || !isReferenceStep(step?.kind)) return [];
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

  useLayoutEffect(() => {
    if (session) cancelStaleCommandLineSession();
  }, [session, sourceRevision]);

  useEffect(() => {
    if (!session) return;
    if (step) inputRef.current?.focus();
    else confirmButtonRef.current?.focus();
  }, [session, step]);

  useEffect(() => {
    if (!session) setCommandLineInputComposing(false);
  }, [session]);

  useEffect(() => () => setCommandLineInputComposing(false), []);

  if (!session) return null;
  const canSkip = step?.kind === "name" || (step?.kind === "number" && step.default !== undefined);
  const stepLabel = commandLineStepLabel(step);
  const inputHelp = helpForStep(step);
  const placeholder = step?.kind === "name"
    ? session.nameSuggestion
    : step?.kind === "number" && step.default !== undefined
      ? `Enterで ${step.default}`
      : isReferenceStep(step?.kind)
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
    if (!step || !isReferenceStep(step.kind)) return false;
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
        if (step?.kind === "lineList" && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          finishLinePick();
          return;
        }
        if (activePickCursor || isReferenceStep(step?.kind)) {
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
        cancelCommandLineSession();
      }}
      onCompositionStart={() => setCommandLineInputComposing(true)}
      onCompositionEnd={() => setCommandLineInputComposing(false)}
    >
      <div className="command-line-bar-meta">
        <span className="command-line-bar-title">{elementTypeLabels[session.recipe.type]}</span>
        <span className="command-line-bar-step">{Math.min(session.currentStepIndex + 1, session.recipe.steps.length)} / {session.recipe.steps.length}</span>
        <span className="command-line-bar-status" aria-live="polite">{step ? `入力中：${stepLabel}` : stepLabel}</span>
      </div>
      <div className="command-line-bar-entry">
        {step ? (
          <>
            <label htmlFor="command-line-input">入力中：{stepLabel}</label>
            <span id="command-line-input-help" className="command-line-bar-help">{inputHelp}</span>
            <div className="command-line-bar-entry-row">
              <div className="command-line-bar-input-wrap">
                <input
                  id="command-line-input"
                  ref={inputRef}
                  value={inputValue}
                  placeholder={placeholder}
                  aria-label={stepLabel}
                  aria-describedby="command-line-input-help"
                  onChange={(event) => setInputValue(event.target.value)}
                />
                {isReferenceStep(step.kind) && visibleSuggestions.length > 0 ? (
                  <ul className="command-line-suggestions" role="listbox" aria-label="参照候補">
                    {visibleSuggestions.map((suggestion) => (
                      <li key={`${suggestion.elementId}:${suggestion.optionIndex}`}>
                        <button type="button" onClick={() => applySuggestion(suggestion)}>{suggestion.value}</button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="command-line-bar-actions">
                {step.kind === "number" ? (
                  <button type="button" onClick={() => startCommandLineNumericReferencePick()}>参照値を選択</button>
                ) : null}
                {canSkip ? <button type="button" onClick={() => skipCommandLineStep()}>スキップ</button> : null}
                {session.currentStepIndex > 0 ? <button type="button" onClick={() => retreatCommandLineStep()}>戻る</button> : null}
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
      <details className="command-line-bar-progress" open={completedSteps.length > 0}>
        <summary>完了済み {completedSteps.length}項目</summary>
        <ul aria-label="完了済みの入力">
          {completedSteps.map((item) => (
            <li key={item.key}><span>{item.label}</span><span>{item.value}</span></li>
          ))}
        </ul>
      </details>
    </form>
  );
};
