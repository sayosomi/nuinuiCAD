import type { CreationStep } from "../commands/creationRecipes";

export const isCommandLineReferenceStep = (kind: CreationStep["kind"] | undefined) =>
  kind === "point" || kind === "endpoint" || kind === "line" || kind === "lineList";

export const commandLineStepHelp = (step: CreationStep | null) => {
  if (!step) return "入力完了。Enterで作成します。";
  // Empty Enter's effect differs by mode (blank-advance while progressing
  // normally, adopt the current pick/selection while editing an already-
  // completed step) - see CommandLineBar's mode-scoped hints for the
  // mode-specific claim instead of stating either behavior here.
  if (step.kind === "name") return "空Enterで無名のまま進みます。";
  if (step.kind === "point" || step.kind === "endpoint" || step.kind === "line") {
    return "クリックまたは名前入力で選択します。";
  }
  if (step.kind === "lineList") return "クリックまたは名前入力で選び、⌘Enterで完了します。";
  return step.default === undefined ? "値または式を入力します。" : `空Enterで ${step.default} を採用します。`;
};
