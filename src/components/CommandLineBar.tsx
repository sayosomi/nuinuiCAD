import { useEffect, useLayoutEffect, useRef } from "react";
import {
  cancelCommandLineSession,
  cancelStaleCommandLineSession,
  retreatCommandLineStep,
  skipCommandLineStep,
  submitCommandLineInput
} from "../commands/commandLineSessionCommands";
import { currentStep } from "../commands/commandLineSession";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";

const promptFor = (session: NonNullable<ReturnType<typeof useCadUiStore.getState>["commandLineSession"]>) => {
  const step = currentStep(session);
  if (!step) return "Enterで作成を確定";
  if (step.kind === "name") return "名前を入力（空Enterで候補を採用）";
  return step.prompt;
};

export const CommandLineBar = () => {
  const session = useCadUiStore((state) => state.commandLineSession);
  const sourceRevision = useCadDocumentStore((state) => state.sourceRevision);
  const inputRef = useRef<HTMLInputElement>(null);
  const step = currentStep(session);

  useLayoutEffect(() => {
    if (session) cancelStaleCommandLineSession();
  }, [session, sourceRevision]);

  useEffect(() => {
    if (!session) return;
    if (!inputRef.current) return;
    inputRef.current.value = "";
    inputRef.current.focus();
  }, [session]);

  if (!session) return null;
  const canSkip = step?.kind === "name" || (step?.kind === "number" && step.default !== undefined);
  const placeholder = step?.kind === "name"
    ? session.nameSuggestion
    : step?.kind === "number" && step.default !== undefined
      ? `Enterで ${step.default}`
      : "値または式を入力";

  return (
    <form
      className="command-line-bar"
      aria-label="コマンドライン作成"
      onSubmit={(event) => {
        event.preventDefault();
        submitCommandLineInput(inputRef.current?.value ?? "");
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        cancelCommandLineSession();
      }}
    >
      <span className="command-line-bar-title">{session.recipe.type}</span>
      <span className="command-line-bar-prompt">{promptFor(session)}</span>
      {Object.entries(session.args).map(([key, value]) => (
        <span className="command-line-bar-chip" key={key}>{key}: {typeof value === "object" ? "設定済み" : String(value)}</span>
      ))}
      <input
        ref={inputRef}
        defaultValue=""
        placeholder={placeholder}
        aria-label={promptFor(session)}
      />
      {session.currentStepIndex > 0 ? (
        <button type="button" onClick={() => retreatCommandLineStep()}>戻る</button>
      ) : null}
      {canSkip ? (
        <button type="button" onClick={() => skipCommandLineStep()}>スキップ</button>
      ) : null}
      <kbd>Esc</kbd>
    </form>
  );
};
