import type { BakeFailureReason, BakeSkippedTarget } from "../../src/commands/bakeGeometry";
import type { VscodeBakeOperationResult } from "../../src/vscode/protocol";
import { createTranslator, resolveLocale, type TranslationCatalog } from "./localization";

export const BAKE_SHOW_DETAILS_ACTION = "Show Details";
const MAX_NOTIFICATION_REASON_GROUPS = 3;

const bakeTranslationCatalog = {
  "bake.showDetails": { en: "Show Details", ja: "詳細を表示" },
  "bake.partialSuccess": {
    en: "nuinuiCAD: Bake created {successful} target(s) and skipped {skipped}{suffix}.",
    ja: "nuinuiCAD: Bake は {successful} 件を作成し、{skipped} 件をスキップしました{suffix}。"
  },
  "bake.noSuccess": {
    en: "nuinuiCAD: Bake created no targets and skipped {skipped}{suffix}.",
    ja: "nuinuiCAD: Bake は対象を作成できず、{skipped} 件をスキップしました{suffix}。"
  },
  "bake.otherReasons": { en: "other {count} reason types", ja: "その他 {count} 種類の理由" },
  "bake.details.mode": { en: "Mode", ja: "モード" },
  "bake.details.successfulTargets": { en: "Successful targets", ja: "成功した対象" },
  "bake.details.skippedTargets": { en: "Skipped targets", ja: "スキップした対象" },
  "bake.details.skippedTargetDetails": { en: "Skipped target details", ja: "スキップした対象の詳細" },
  "bake.details.targetId": { en: "targetId", ja: "targetId" },
  "bake.details.sourceElementId": { en: "sourceElementId", ja: "sourceElementId" },
  "bake.details.reason": { en: "reason", ja: "理由" },
  "bake.details.geometryKind": { en: "geometryKind", ja: "ジオメトリの種類" },
  "bake.details.diagnostics": { en: "diagnostics", ja: "診断" },
  "bake.details.none": { en: "none", ja: "なし" },
  "bake.details.detail": { en: "detail", ja: "詳細" },
  "bake.reason.unsupported-geometry-kind": { en: "unsupported geometry kind", ja: "未対応のジオメトリの種類" },
  "bake.reason.evaluation-failed": { en: "evaluation failed", ja: "評価に失敗" },
  "bake.reason.unevaluated": { en: "not evaluated", ja: "未評価" },
  "bake.reason.geometry-unavailable": { en: "geometry unavailable", ja: "ジオメトリを利用できない" },
  "bake.reason.not-losslessly-representable": { en: "cannot be represented exactly", ja: "正確に表現できない" }
} satisfies TranslationCatalog;

const bakeTranslatorFor = (displayLanguage: string) =>
  createTranslator(bakeTranslationCatalog, resolveLocale(displayLanguage));

export const bakeShowDetailsActionFor = (displayLanguage: string): string =>
  bakeTranslatorFor(displayLanguage)("bake.showDetails");

type BakeMode = "current" | "base";

export type BakeOperationPresentationInput = VscodeBakeOperationResult & {
  mode: BakeMode;
};

export type BakeOperationNotification = {
  severity: "warning" | "error";
  message: string;
};

export type BakeOutputTarget = {
  clear: () => void;
  appendLine: (value: string) => void;
  show: (preserveFocus?: boolean) => void;
};

export type BakeNotificationTarget = {
  showWarningMessage: (message: string, action: string) => PromiseLike<string | undefined>;
  showErrorMessage: (message: string, action: string) => PromiseLike<string | undefined>;
};

const aggregateReasonCodes = (
  skippedTargets: readonly BakeSkippedTarget[],
  displayLanguage: string
): string => {
  const translator = bakeTranslatorFor(displayLanguage);
  const counts = new Map<BakeFailureReason["code"], number>();
  for (const target of skippedTargets) {
    counts.set(target.reason.code, (counts.get(target.reason.code) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort(([leftCode, leftCount], [rightCode, rightCount]) =>
    rightCount - leftCount || leftCode.localeCompare(rightCode)
  );
  const visible = entries
    .slice(0, MAX_NOTIFICATION_REASON_GROUPS)
    .map(([code, count]) => `${translator(`bake.reason.${code}`)} ×${count}`);
  const remainingKinds = entries.length - visible.length;
  if (remainingKinds > 0) {
    visible.push(translator("bake.otherReasons", { count: remainingKinds }));
  }
  return visible.join(", ");
};

export const bakeOperationNotificationFor = (
  input: BakeOperationPresentationInput,
  displayLanguage = "en"
): BakeOperationNotification | null => {
  const translator = bakeTranslatorFor(displayLanguage);
  const { successfulTargetCount, skippedTargetCount, skippedTargets } = input.summary;
  if (skippedTargetCount === 0) return null;
  const reasons = aggregateReasonCodes(skippedTargets, displayLanguage);
  const suffix = reasons ? ` (${reasons})` : "";
  if (successfulTargetCount > 0) {
    return {
      severity: "warning",
      message: translator("bake.partialSuccess", {
        successful: successfulTargetCount,
        skipped: skippedTargetCount,
        suffix
      })
    };
  }
  return {
    severity: "error",
    message: translator("bake.noSuccess", { skipped: skippedTargetCount, suffix })
  };
};

const stableDiagnosticDetail = (diagnostic: unknown): string => {
  try {
    const serialized = JSON.stringify(diagnostic);
    return serialized ?? String(diagnostic);
  } catch {
    return String(diagnostic);
  }
};

const reasonDetailLines = (reason: BakeFailureReason, displayLanguage: string): string[] => {
  const translator = bakeTranslatorFor(displayLanguage);
  switch (reason.code) {
    case "unsupported-geometry-kind":
      return [`  ${translator("bake.details.geometryKind")}: ${reason.geometryKind}`];
    case "evaluation-failed":
      return reason.diagnostics.length === 0
        ? [`  ${translator("bake.details.diagnostics")}: ${translator("bake.details.none")}`]
        : [
            `  ${translator("bake.details.diagnostics")}:`,
            ...reason.diagnostics.map((diagnostic) => `    - ${stableDiagnosticDetail(diagnostic)}`)
          ];
    case "unevaluated":
    case "geometry-unavailable":
      return [];
    case "not-losslessly-representable":
      return [
        `  ${translator("bake.details.geometryKind")}: ${reason.geometryKind}`,
        ...(reason.detail ? [`  ${translator("bake.details.detail")}: ${reason.detail}`] : [])
      ];
  }
};

const skippedTargetLines = (
  target: BakeSkippedTarget,
  index: number,
  displayLanguage: string
): string[] => {
  const translator = bakeTranslatorFor(displayLanguage);
  return [
  `${index + 1}. ${target.sourceLabel}`,
  `  ${translator("bake.details.targetId")}: ${target.targetId}`,
  `  ${translator("bake.details.sourceElementId")}: ${target.sourceElementId}`,
  `  ${translator("bake.details.reason")}: ${target.reason.code}`,
  ...reasonDetailLines(target.reason, displayLanguage)
  ];
};

export const formatBakeOperationDetails = (
  input: BakeOperationPresentationInput,
  displayLanguage = "en"
): string => {
  const translator = bakeTranslatorFor(displayLanguage);
  const { successfulTargetCount, skippedTargetCount, skippedTargets } = input.summary;
  const lines = [
    `${translator("bake.details.mode")}: ${input.mode}`,
    `${translator("bake.details.successfulTargets")}: ${successfulTargetCount}`,
    `${translator("bake.details.skippedTargets")}: ${skippedTargetCount}`
  ];
  if (skippedTargets.length > 0) {
    lines.push("", `${translator("bake.details.skippedTargetDetails")}:`);
    skippedTargets.forEach((target, index) => {
      lines.push(...skippedTargetLines(target, index, displayLanguage));
    });
  }
  return lines.join("\n");
};

export const presentBakeOperationResult = async (
  input: BakeOperationPresentationInput,
  output: BakeOutputTarget,
  notifications: BakeNotificationTarget,
  displayLanguage = "en"
): Promise<void> => {
  output.clear();
  output.appendLine(formatBakeOperationDetails(input, displayLanguage));

  const notification = bakeOperationNotificationFor(input, displayLanguage);
  if (!notification) return;
  const showDetailsAction = bakeShowDetailsActionFor(displayLanguage);
  const selectedAction = notification.severity === "warning"
    ? await notifications.showWarningMessage(notification.message, showDetailsAction)
    : await notifications.showErrorMessage(notification.message, showDetailsAction);
  if (selectedAction === showDetailsAction) output.show(true);
};
