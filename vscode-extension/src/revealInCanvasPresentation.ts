import type {
  DslCanvasRevealDegradation,
  DslCanvasRevealFailureReason,
  DslCanvasRevealOwnerFallbackCause,
  DslCanvasRevealRuntimeOmissionCause
} from "../../src/dsl/dslCanvasRevealQuery";
import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog,
  type Translator
} from "./localization";

export type RevealInCanvasHostFailureReason =
  | DslCanvasRevealFailureReason
  | "analysis-unavailable"
  | "canvas-history-busy";

export type RevealInCanvasPresentationOutcome =
  | {
      status: "resolved";
      degradations: readonly DslCanvasRevealDegradation[];
    }
  | {
      status: "failed";
      reason: RevealInCanvasHostFailureReason;
    };

export type RevealInCanvasNotification = {
  severity: "warning" | "error";
  message: string;
};

const revealInCanvasTranslationCatalog = {
  "reveal.failure.source-mismatch": {
    en: "Reveal in Canvas could not run because the Source Editor and Canvas are out of sync.",
    ja: "Source Editor と Canvas の内容が同期していないため、Canvas で表示できませんでした。"
  },
  "reveal.failure.invalid-position": {
    en: "Reveal in Canvas could not use the current caret position.",
    ja: "現在のカーソル位置を Canvas で表示できませんでした。"
  },
  "reveal.failure.no-target": {
    en: "There is no Canvas Reveal target at the current caret position.",
    ja: "現在のカーソル位置には Canvas で表示できる対象がありません。"
  },
  "reveal.failure.no-revealable-runtime-target": {
    en: "No current Canvas geometry can be revealed for this source target.",
    ja: "このソース対象に対応する、現在 Canvas で表示可能なジオメトリがありません。"
  },
  "reveal.failure.analysis-unavailable": {
    en: "Reveal in Canvas is unavailable because source analysis is not ready.",
    ja: "ソース解析の準備ができていないため、Canvas で表示できません。"
  },
  "reveal.failure.canvas-history-busy": {
    en: "Reveal in Canvas is temporarily unavailable while Canvas history is being applied.",
    ja: "Canvas の履歴操作中のため、一時的に Canvas で表示できません。"
  },
  "reveal.warning.owner-fallback.unresolved": {
    en: "The geometry reference {reference} could not be resolved, so its containing geometry was revealed instead.",
    ja: "ジオメトリ参照 {reference} を解決できなかったため、代わりにそれを含むジオメトリを表示しました。"
  },
  "reveal.warning.owner-fallback.ambiguous": {
    en: "The geometry reference {reference} is ambiguous, so its containing geometry was revealed instead.",
    ja: "ジオメトリ参照 {reference} が曖昧なため、代わりにそれを含むジオメトリを表示しました。"
  },
  "reveal.warning.owner-fallback.hidden": {
    en: "The referenced geometry {reference} is hidden, so its containing geometry was revealed instead.",
    ja: "参照先のジオメトリ {reference} が非表示のため、代わりにそれを含むジオメトリを表示しました。"
  },
  "reveal.warning.owner-fallback.disabled": {
    en: "The referenced geometry {reference} is disabled, so its containing geometry was revealed instead.",
    ja: "参照先のジオメトリ {reference} が無効のため、代わりにそれを含むジオメトリを表示しました。"
  },
  "reveal.warning.owner-fallback.profile-excluded": {
    en: "The referenced geometry {reference} is excluded by the active visibility profile, so its containing geometry was revealed instead.",
    ja: "参照先のジオメトリ {reference} が現在の表示プロファイルで除外されているため、代わりにそれを含むジオメトリを表示しました。"
  },
  "reveal.warning.owner-fallback.runtime-target-unavailable": {
    en: "The referenced geometry {reference} has no current runtime target, so its containing geometry was revealed instead.",
    ja: "参照先のジオメトリ {reference} に現在の実行時対象がないため、代わりにそれを含むジオメトリを表示しました。"
  },
  "reveal.warning.partial": {
    en: "Reveal in Canvas showed the available subset; {count} target(s) were omitted: {causes}.",
    ja: "Canvas で表示可能な対象だけを表示しました。{count} 件の対象を除外しました: {causes}。"
  },
  "reveal.cause.hidden": { en: "hidden", ja: "非表示" },
  "reveal.cause.disabled": { en: "disabled", ja: "無効" },
  "reveal.cause.profile-excluded": { en: "excluded by the active visibility profile", ja: "表示プロファイルで除外" },
  "reveal.cause.runtime-target-unavailable": { en: "runtime target unavailable", ja: "実行時対象なし" },
  "reveal.reference.unknown": { en: "the reference", ja: "参照" }
} satisfies TranslationCatalog;

const causeText = (translator: Translator, cause: DslCanvasRevealRuntimeOmissionCause): string =>
  translator(`reveal.cause.${cause}`);

const fallbackText = (
  translator: Translator,
  cause: DslCanvasRevealOwnerFallbackCause,
  referenceText: string | undefined
): string => translator(`reveal.warning.owner-fallback.${cause}`, {
  reference: referenceText ?? translator("reveal.reference.unknown")
});

const degradationText = (translator: Translator, degradation: DslCanvasRevealDegradation): string => {
  if (degradation.kind === "owner-fallback") {
    return fallbackText(translator, degradation.cause, degradation.referenceText);
  }
  return translator("reveal.warning.partial", {
    count: degradation.omittedCount,
    causes: degradation.causes.map((cause) => causeText(translator, cause)).join(", ")
  });
};

/**
 * One command produces at most one notification. Complete success is silent;
 * degraded success aggregates every warning detail; failures produce one Error.
 */
export const revealInCanvasNotificationFor = (
  outcome: RevealInCanvasPresentationOutcome,
  displayLanguage: string
): RevealInCanvasNotification | null => {
  const translator = createTranslator(revealInCanvasTranslationCatalog, resolveLocale(displayLanguage));
  if (outcome.status === "failed") {
    return {
      severity: "error",
      message: translator(`reveal.failure.${outcome.reason}`)
    };
  }
  if (outcome.degradations.length === 0) return null;
  return {
    severity: "warning",
    message: outcome.degradations.map((degradation) => degradationText(translator, degradation)).join(" ")
  };
};
