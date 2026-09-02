import type {
  InlineModulePlan,
  InlineModuleRejectCode,
  InlineModuleRejection,
  InlineModuleKnownSkipCode
} from "../../src/document/inlineModulePlanner";
import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const inlineModuleTranslationCatalog = {
  "inlineModule.source.noTarget": {
    en: "nuinuiCAD: No authored Module instance is selected at the current Source position.",
    ja: "nuinuiCAD: 現在の Source 位置に、インライン化する authored Module instance が選択されていません。"
  },
  "inlineModule.requiresCurrentTarget": {
    en: "nuinuiCAD: Inline Module requires a current Source or Canvas target.",
    ja: "nuinuiCAD: Inline Module には現在の Source または Canvas の対象が必要です。"
  },
  "inlineModule.canvas.noTarget": {
    en: "nuinuiCAD: No concrete Module instance is selected on the current Canvas.",
    ja: "nuinuiCAD: 現在の Canvas に、インライン化する具体的な Module instance が選択されていません。"
  },
  "inlineModule.sourceOrCanvasChanged": {
    en: "nuinuiCAD: Source or Canvas state changed. No changes were made; run Inline Module again.",
    ja: "nuinuiCAD: Source または Canvas の状態が変更されたため、変更しませんでした。Inline Module をもう一度実行してください。"
  },
  "inlineModule.sourceChangedBeforeApply": {
    en: "nuinuiCAD: Source changed before Inline Module could be applied. No changes were made.",
    ja: "nuinuiCAD: Inline Module を適用する前に Source が変更されたため、変更しませんでした。"
  },
  "inlineModule.noChanges": {
    en: "nuinuiCAD: Inline Module made no changes.",
    ja: "nuinuiCAD: Inline Module で変更はありませんでした。"
  },
  "inlineModule.rejection.stale-semantic-snapshot": {
    en: "Inline Module could not use the current Source semantics. Run the command again.",
    ja: "Inline Module で現在の Source の意味解析を利用できませんでした。コマンドをもう一度実行してください。"
  },
  "inlineModule.rejection.invalid-target": {
    en: "The selected Module instance is no longer available. Run the command again.",
    ja: "選択した Module instance を利用できなくなりました。コマンドをもう一度実行してください。"
  },
  "inlineModule.rejection.unsafe-source-span": {
    en: "Inline Module could not identify a safe current Source range. No changes were made.",
    ja: "安全な現在の Source 範囲を特定できなかったため、変更しませんでした。"
  },
  "inlineModule.rejection.unsafe-rewrite": {
    en: "Inline Module could not prove that the Source rewrite is safe. No changes were made.",
    ja: "Source の書き換えが安全であることを証明できなかったため、変更しませんでした。"
  },
  "inlineModule.summary.one": {
    en: "nuinuiCAD: Inlined one Module instance.",
    ja: "nuinuiCAD: Module instance を1件インライン化しました。"
  },
  "inlineModule.summary.many": {
    en: "nuinuiCAD: Inlined {count} Module instances.",
    ja: "nuinuiCAD: Module instance を{count}件インライン化しました。"
  },
  "inlineModule.summary.skipped": {
    en: "Skipped {count}: {reasons}.",
    ja: "{count}件をスキップしました: {reasons}。"
  },
  "inlineModule.skip.non-local-target": {
    en: "imported target",
    ja: "インポートされた対象"
  },
  "inlineModule.skip.not-module-instance": {
    en: "not a Module instance",
    ja: "Module instance ではない対象"
  },
  "inlineModule.skip.unresolved-callee": {
    en: "unresolved Module",
    ja: "解決できない Module"
  },
  "inlineModule.skip.hidden-excluded": {
    en: "hidden instance excluded",
    ja: "非表示の instance を除外"
  },
  "inlineModule.skip.disabled-excluded": {
    en: "disabled instance excluded",
    ja: "無効な instance を除外"
  },
  "inlineModule.skip.parameter-lowering-required": {
    en: "parameter conversion is required",
    ja: "パラメータ変換が必要"
  }
} satisfies TranslationCatalog;

export const inlineModuleTranslatorFor = (displayLanguage: string) =>
  createTranslator(inlineModuleTranslationCatalog, resolveLocale(displayLanguage));

export const inlineModuleRejectionMessageFor = (
  rejection: Pick<InlineModuleRejection, "code">,
  displayLanguage: string
): string => inlineModuleTranslatorFor(displayLanguage)(
  `inlineModule.rejection.${rejection.code as InlineModuleRejectCode}`
);

export const inlineModuleSummaryFor = (plan: InlineModulePlan, displayLanguage: string): string => {
  const translator = inlineModuleTranslatorFor(displayLanguage);
  const inlined = plan.targets.filter((target) => target.status === "inlined").length;
  const skipped = plan.targets.filter((target) => target.status === "skipped");
  const summary = translator(
    inlined === 1 ? "inlineModule.summary.one" : "inlineModule.summary.many",
    { count: inlined }
  );
  if (skipped.length === 0) return summary;
  const reasons = [...new Set(skipped.map((target) => target.code))]
    .map((code) => translator(`inlineModule.skip.${code as InlineModuleKnownSkipCode}`))
    .join(", ");
  return `${summary} ${translator("inlineModule.summary.skipped", {
    count: skipped.length,
    reasons
  })}`;
};
