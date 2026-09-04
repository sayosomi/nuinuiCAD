import type { VscodeToExtensionMessage } from "../../src/vscode/protocol";
import { createTranslator, resolveLocale, type TranslationCatalog } from "./localization";

export const COORDINATE_POINT_CONVERSION_SHOW_DETAILS_ACTION = "Show Details";

export const coordinatePointConversionTranslationCatalog = {
  "coordinatePointConversion.showDetails": { en: "Show Details", ja: "詳細を表示" },
  "coordinatePointConversion.applied": {
    en: "nuinuiCAD: Converted {count} coordinate point(s).",
    ja: "nuinuiCAD: 座標点を {count} 件変換しました。"
  },
  "coordinatePointConversion.partial": {
    en: "nuinuiCAD: Converted {successful} coordinate point(s) and skipped {skipped}{suffix}.",
    ja: "nuinuiCAD: 座標点を {successful} 件変換し、{skipped} 件をスキップしました{suffix}。"
  },
  "coordinatePointConversion.failed": {
    en: "nuinuiCAD: Could not apply coordinate-point conversion{suffix}.",
    ja: "nuinuiCAD: 座標点の変換を適用できませんでした{suffix}。"
  },
  "coordinatePointConversion.otherReasons": { en: "other reasons", ja: "その他の理由" },
  "coordinatePointConversion.details.mode": { en: "Mode", ja: "モード" },
  "coordinatePointConversion.details.origin": { en: "Origin", ja: "開始元" },
  "coordinatePointConversion.details.classification": { en: "Classification", ja: "分類" },
  "coordinatePointConversion.details.successfulTargets": { en: "Successful targets", ja: "成功した対象" },
  "coordinatePointConversion.details.skippedTargets": { en: "Skipped targets", ja: "スキップした対象" },
  "coordinatePointConversion.details.skippedTargetDetails": { en: "Skipped target details", ja: "スキップした対象の詳細" },
  "coordinatePointConversion.details.reason": { en: "reason", ja: "理由" },
  "coordinatePointConversion.details.message": { en: "message", ja: "メッセージ" },
  "coordinatePointConversion.reason.stale-source": { en: "source is stale", ja: "Source が古い" },
  "coordinatePointConversion.reason.target-not-found": { en: "target not found", ja: "対象が見つからない" },
  "coordinatePointConversion.reason.target-not-eligible": { en: "target is not eligible", ja: "対象が変換対象外" },
  "coordinatePointConversion.reason.target-not-evaluated": { en: "target is not evaluated", ja: "対象が未評価" },
  "coordinatePointConversion.reason.base-not-candidate": { en: "base point is not a candidate", ja: "基準点が候補外" },
  "coordinatePointConversion.reason.base-is-target": { en: "base point is a target", ja: "基準点が変換対象自身" },
  "coordinatePointConversion.reason.base-not-evaluated": { en: "base point is not evaluated", ja: "基準点が未評価" },
  "coordinatePointConversion.reason.source-rewrite-failed": { en: "source rewrite failed", ja: "Source の書き換えに失敗" },
  "coordinatePointConversion.reason.revalidation-failed": { en: "revalidation failed", ja: "再検証に失敗" },
  "coordinatePointConversion.picker.pickCanvas": { en: "$(location) Pick base point on Canvas", ja: "$(location) Canvas で基準点を選択" },
  "coordinatePointConversion.picker.description": { en: "Switch to visual base-point picking", ja: "Canvas の基準点選択に切り替え" },
  "coordinatePointConversion.picker.legalCandidate": { en: "Legal shared base point", ja: "全対象に共通する基準点" },
  "coordinatePointConversion.picker.xyPlaceholder": { en: "Select a shared base point for XY offset", ja: "XY オフセットの共通基準点を選択" },
  "coordinatePointConversion.picker.anglePlaceholder": { en: "Select a shared base point for angle-distance offset", ja: "角度・距離オフセットの共通基準点を選択" },
  "coordinatePointConversion.source.noTarget": {
    en: "nuinuiCAD: No coordinate point can be converted at the Source Editor cursor position.",
    ja: "nuinuiCAD: Source Editor のカーソル位置に変換できる coordinate point がありません。"
  },
  "coordinatePointConversion.revalidation.canvasTargetUnavailable": {
    en: "Canvas conversion targets could not be resolved against the current Extension Host evaluation. Try the command again.",
    ja: "Canvasの変換対象を現在のExtension Host評価へ再解決できません。コマンドをもう一度実行してください。"
  },
  "coordinatePointConversion.revalidation.canvasTargetChanged": {
    en: "The Canvas conversion target selection changed. Try the command again.",
    ja: "Canvasの変換対象選択が変化しました。コマンドをもう一度実行してください。"
  },
  "coordinatePointConversion.revalidation.documentChanged": {
    en: "The current document, Source, or selection changed. Try the command again.",
    ja: "現在の文書、Source、または選択が変化しました。コマンドをもう一度実行してください。"
  },
  "coordinatePointConversion.revalidation.staleEvaluation": {
    en: "The current document or evaluation result is stale. Try the command again.",
    ja: "現在の文書または評価結果が古くなっています。コマンドをもう一度実行してください。"
  },
  "coordinatePointConversion.revalidation.evaluationUnavailable": {
    en: "The current document or evaluation result could not be obtained. Try the command again.",
    ja: "現在の文書または評価結果を取得できませんでした。コマンドをもう一度実行してください。"
  },
  "coordinatePointConversion.revalidation.baseNotCandidate": {
    en: "The selected base point is not a current legal shared candidate. Try the command again.",
    ja: "選択した基準点は現在の合法な共有候補ではありません。コマンドをもう一度実行してください。"
  },
  "coordinatePointConversion.revalidation.canvasSelectionMappingFailed": {
    en: "The conversion result could not be mapped to the current Canvas selection. Try the command again.",
    ja: "変換結果をCanvasの現在の選択へ対応付けできません。コマンドをもう一度実行してください。"
  },
  "coordinatePointConversion.revalidation.canvasOpenedStale": {
    en: "The current document changed before Canvas could open. Try the command again.",
    ja: "Canvasを開く前に現在の文書が変化しました。コマンドをもう一度実行してください。"
  }
} satisfies TranslationCatalog;

export const coordinatePointConversionTranslatorFor = (displayLanguage: string) =>
  createTranslator(coordinatePointConversionTranslationCatalog, resolveLocale(displayLanguage));

export const coordinatePointConversionShowDetailsActionFor = (displayLanguage: string): string =>
  coordinatePointConversionTranslatorFor(displayLanguage)("coordinatePointConversion.showDetails");

type CoordinatePointConversionResult = Extract<
  VscodeToExtensionMessage,
  { type: "coordinatePointConversionResult" }
>;

export type CoordinatePointConversionOutputTarget = {
  clear: () => void;
  appendLine: (value: string) => void;
  show: (preserveFocus?: boolean) => void;
};

export type CoordinatePointConversionNotificationTarget = {
  showInformationMessage: (message: string) => PromiseLike<string | undefined>;
  showWarningMessage: (message: string, action: string) => PromiseLike<string | undefined>;
  showErrorMessage: (message: string, action: string) => PromiseLike<string | undefined>;
};

const reasonSummary = (result: CoordinatePointConversionResult, displayLanguage: string): string => {
  const translator = coordinatePointConversionTranslatorFor(displayLanguage);
  const counts = new Map<string, number>();
  for (const target of result.skippedTargets) {
    counts.set(target.reason.code, (counts.get(target.reason.code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([leftCode, leftCount], [rightCode, rightCount]) => rightCount - leftCount || leftCode.localeCompare(rightCode))
    .slice(0, 3)
    .map(([code, count]) => `${translator(`coordinatePointConversion.reason.${code}`)} ×${count}`)
    .join(", ");
};

export const formatCoordinatePointConversionDetails = (
  result: CoordinatePointConversionResult,
  displayLanguage = "en"
): string => {
  const translator = coordinatePointConversionTranslatorFor(displayLanguage);
  const lines = [
    `${translator("coordinatePointConversion.details.mode")}: ${result.mode}`,
    `${translator("coordinatePointConversion.details.origin")}: ${result.origin}`,
    `${translator("coordinatePointConversion.details.classification")}: ${result.classification}`,
    `${translator("coordinatePointConversion.details.successfulTargets")}: ${result.successfulTargetCount}`,
    `${translator("coordinatePointConversion.details.skippedTargets")}: ${result.skippedTargetCount}`
  ];
  if (result.skippedTargets.length > 0) {
    lines.push("", `${translator("coordinatePointConversion.details.skippedTargetDetails")}:`);
    result.skippedTargets.forEach((target, index) => {
      lines.push(
        `${index + 1}. ${target.targetId}`,
        `  ${translator("coordinatePointConversion.details.reason")}: ${target.reason.code}`,
        `  ${translator("coordinatePointConversion.details.message")}: ${translator(`coordinatePointConversion.reason.${target.reason.code}`)}`
      );
    });
  }
  return lines.join("\n");
};

export const presentCoordinatePointConversionResult = async (
  result: CoordinatePointConversionResult,
  output: CoordinatePointConversionOutputTarget | undefined,
  notifications: CoordinatePointConversionNotificationTarget,
  displayLanguage = "en"
): Promise<void> => {
  output?.clear();
  output?.appendLine(formatCoordinatePointConversionDetails(result, displayLanguage));
  if (result.status === "canceled") return;

  const translator = coordinatePointConversionTranslatorFor(displayLanguage);
  const reasons = reasonSummary(result, displayLanguage);
  const suffix = reasons ? ` (${reasons})` : "";
  const showDetailsAction = coordinatePointConversionShowDetailsActionFor(displayLanguage);
  if (result.status === "applied" && result.skippedTargetCount === 0) {
    await notifications.showInformationMessage(
      translator("coordinatePointConversion.applied", { count: result.successfulTargetCount })
    );
    return;
  }
  if (result.status === "applied" && result.successfulTargetCount > 0) {
    const action = await notifications.showWarningMessage(
      translator("coordinatePointConversion.partial", {
        successful: result.successfulTargetCount,
        skipped: result.skippedTargetCount,
        suffix
      }),
      showDetailsAction
    );
    if (action === showDetailsAction) output?.show(true);
    return;
  }
  const action = await notifications.showErrorMessage(
    translator("coordinatePointConversion.failed", { suffix }),
    showDetailsAction
  );
  if (action === showDetailsAction) output?.show(true);
};
