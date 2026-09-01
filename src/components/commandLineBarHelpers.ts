import type { CreationStep } from "../commands/creationRecipes";

export const isCommandLineReferenceStep = (kind: CreationStep["kind"] | undefined) =>
  kind === "point" || kind === "endpoint" || kind === "line" || kind === "lineList";

export const commandLineStepHelp = (step: CreationStep | null) => {
  if (!step) return "入力完了。";
  // Empty Enter's effect differs by mode (blank-advance while progressing
  // normally, adopt the current pick/selection while editing an already-
  // completed step) - see CommandLineBar's mode-scoped hints for the
  // mode-specific claim instead of stating either behavior here.
  if (step.kind === "name") return "空Enterで無名のまま進みます。";
  if (step.kind === "point" || step.kind === "endpoint" || step.kind === "line") {
    return "クリックまたは名前入力で選択します。";
  }
  if (step.kind === "lineList") return "クリックまたは名前入力で選び、選択完了ボタンで確定します。";
  return "空Enterで未指定のまま次へ進みます。";
};
