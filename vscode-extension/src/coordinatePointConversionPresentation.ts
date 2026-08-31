import type { VscodeToExtensionMessage } from "../../src/vscode/protocol";

export const COORDINATE_POINT_CONVERSION_SHOW_DETAILS_ACTION = "Show Details";

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

const reasonSummary = (result: CoordinatePointConversionResult): string => {
  const counts = new Map<string, number>();
  for (const target of result.skippedTargets) {
    counts.set(target.reason.code, (counts.get(target.reason.code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([leftCode, leftCount], [rightCode, rightCount]) => rightCount - leftCount || leftCode.localeCompare(rightCode))
    .slice(0, 3)
    .map(([code, count]) => `${code} ×${count}`)
    .join(", ");
};

export const formatCoordinatePointConversionDetails = (result: CoordinatePointConversionResult): string => {
  const lines = [
    `Mode: ${result.mode}`,
    `Origin: ${result.origin}`,
    `Classification: ${result.classification}`,
    `Successful targets: ${result.successfulTargetCount}`,
    `Skipped targets: ${result.skippedTargetCount}`
  ];
  if (result.skippedTargets.length > 0) {
    lines.push("", "Skipped target details:");
    result.skippedTargets.forEach((target, index) => {
      lines.push(
        `${index + 1}. ${target.targetId}`,
        `  reason: ${target.reason.code}`,
        `  message: ${target.reason.message}`
      );
    });
  }
  return lines.join("\n");
};

export const presentCoordinatePointConversionResult = async (
  result: CoordinatePointConversionResult,
  output: CoordinatePointConversionOutputTarget | undefined,
  notifications: CoordinatePointConversionNotificationTarget
): Promise<void> => {
  output?.clear();
  output?.appendLine(formatCoordinatePointConversionDetails(result));
  if (result.status === "canceled") return;

  const reasons = reasonSummary(result);
  const suffix = reasons ? `（${reasons}）` : "";
  if (result.status === "applied" && result.skippedTargetCount === 0) {
    await notifications.showInformationMessage(
      `nuinuiCAD: ${result.successfulTargetCount}件の座標点を変換しました。`
    );
    return;
  }
  if (result.status === "applied" && result.successfulTargetCount > 0) {
    const action = await notifications.showWarningMessage(
      `nuinuiCAD: ${result.successfulTargetCount}件を変換し、${result.skippedTargetCount}件をスキップしました${suffix}。`,
      COORDINATE_POINT_CONVERSION_SHOW_DETAILS_ACTION
    );
    if (action === COORDINATE_POINT_CONVERSION_SHOW_DETAILS_ACTION) output?.show(true);
    return;
  }
  const action = await notifications.showErrorMessage(
    `nuinuiCAD: 座標点変換を適用できませんでした${suffix ? `（${reasons}）` : ""}。`,
    COORDINATE_POINT_CONVERSION_SHOW_DETAILS_ACTION
  );
  if (action === COORDINATE_POINT_CONVERSION_SHOW_DETAILS_ACTION) output?.show(true);
};
