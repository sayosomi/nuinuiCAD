import type { CreationStep } from "../commands/creationRecipes";

export const isCommandLineReferenceStep = (kind: CreationStep["kind"] | undefined) =>
  kind === "point" || kind === "endpoint" || kind === "line" || kind === "lineList";

export const commandLineStepHelp = (step: CreationStep | null) => {
  if (!step) return "入力完了。Enterで作成します。";
  if (step.kind === "name") return "空Enterで候補の名前を採用します。";
  if (step.kind === "point" || step.kind === "endpoint" || step.kind === "line") {
    return "クリック、名前入力、または空Enterで選択中の候補を採用します。";
  }
  if (step.kind === "lineList") return "クリックまたは名前入力で選び、⌘Enterで完了します。";
  return step.default === undefined ? "値または式を入力します。" : `空Enterで ${step.default} を採用します。`;
};
