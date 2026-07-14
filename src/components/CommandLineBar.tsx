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

const promptFor = (session: NonNullable<ReturnType<typeof useCadUiStore.getState>["commandLineSession"]>) => {
  const step = currentStep(session);
  if (!step) return "Enterで作成を確定";
  if (step.kind === "name") return "名前を入力（空Enterで候補を採用）";
  if (step.kind === "point" || step.kind === "endpoint" || step.kind === "line") {
    return `${step.prompt}（クリック / 名前入力 / 空Enterで選択中を採用）`;
  }
  if (step.kind === "lineList") return `${step.prompt}（クリック / 名前入力、⌘Enterで完了）`;
  return step.prompt;
};

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

export const CommandLineBar = ({ commandContext }: CommandLineBarProps) => {
  const session = useCadUiStore((state) => state.commandLineSession);
  const sourceRevision = useCadDocumentStore((state) => state.sourceRevision);
  const elements = useCadDocumentStore((state) => state.elements);
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const activePickCursor = useCadUiStore((state) => state.activePickCursor);
  const inputRef = useRef<HTMLInputElement>(null);
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

  useLayoutEffect(() => {
    if (session) cancelStaleCommandLineSession();
  }, [session, sourceRevision]);

  useEffect(() => {
    if (!session) return;
    inputRef.current?.focus();
  }, [session]);

  useEffect(() => {
    if (!session) setCommandLineInputComposing(false);
  }, [session]);

  useEffect(() => () => setCommandLineInputComposing(false), []);

  if (!session) return null;
  const canSkip = step?.kind === "name" || (step?.kind === "number" && step.default !== undefined);
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
      <span className="command-line-bar-title">{elementTypeLabels[session.recipe.type]}</span>
      <span className="command-line-bar-prompt">{promptFor(session)}</span>
      {Object.entries(session.args).map(([key, value]) => (
        <span className="command-line-bar-chip" key={key}>{key}: {typeof value === "object" ? "設定済み" : String(value)}</span>
      ))}
      <div className="command-line-bar-input-wrap">
        <input
          ref={inputRef}
          value={inputValue}
          placeholder={placeholder}
          aria-label={promptFor(session)}
          onChange={(event) => setInputValue(event.target.value)}
        />
        {isReferenceStep(step?.kind) && visibleSuggestions.length > 0 ? (
          <ul className="command-line-suggestions" role="listbox" aria-label="参照候補">
            {visibleSuggestions.map((suggestion) => (
              <li key={`${suggestion.elementId}:${suggestion.optionIndex}`}>
                <button type="button" onClick={() => applySuggestion(suggestion)}>{suggestion.value}</button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {step?.kind === "number" ? (
        <button type="button" onClick={() => startCommandLineNumericReferencePick()}>参照値を選択</button>
      ) : null}
      {session.currentStepIndex > 0 ? (
        <button type="button" onClick={() => retreatCommandLineStep()}>戻る</button>
      ) : null}
      {canSkip ? (
        <button type="button" onClick={() => skipCommandLineStep()}>スキップ</button>
      ) : null}
      <kbd>{step?.kind === "lineList" ? "⌘↵ 完了 / Esc" : "Esc"}</kbd>
    </form>
  );
};
