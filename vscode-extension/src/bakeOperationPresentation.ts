import type { BakeFailureReason, BakeSkippedTarget } from "../../src/commands/bakeGeometry";
import type { VscodeBakeOperationResult } from "../../src/vscode/protocol";

export const BAKE_SHOW_DETAILS_ACTION = "Show Details";
const MAX_NOTIFICATION_REASON_GROUPS = 3;

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
  showWarningMessage: (message: string, action: string) => Promise<string | undefined>;
  showErrorMessage: (message: string, action: string) => Promise<string | undefined>;
};

const aggregateReasonCodes = (skippedTargets: readonly BakeSkippedTarget[]): string => {
  const counts = new Map<BakeFailureReason["code"], number>();
  for (const target of skippedTargets) {
    counts.set(target.reason.code, (counts.get(target.reason.code) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort(([leftCode, leftCount], [rightCode, rightCount]) =>
    rightCount - leftCount || leftCode.localeCompare(rightCode)
  );
  const visible = entries
    .slice(0, MAX_NOTIFICATION_REASON_GROUPS)
    .map(([code, count]) => `${code} ×${count}`);
  const remainingKinds = entries.length - visible.length;
  if (remainingKinds > 0) visible.push(`ほか${remainingKinds}種類`);
  return visible.join(", ");
};

export const bakeOperationNotificationFor = (
  input: BakeOperationPresentationInput
): BakeOperationNotification | null => {
  const { successfulTargetCount, skippedTargetCount, skippedTargets } = input.summary;
  if (skippedTargetCount === 0) return null;
  const reasons = aggregateReasonCodes(skippedTargets);
  const suffix = reasons ? `（${reasons}）` : "";
  if (successfulTargetCount > 0) {
    return {
      severity: "warning",
      message: `nuinuiCAD: Bake は${successfulTargetCount}件成功し、${skippedTargetCount}件をスキップしました${suffix}。`
    };
  }
  return {
    severity: "error",
    message: `nuinuiCAD: Bake は成功せず、${skippedTargetCount}件をスキップしました${suffix}。`
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

const reasonDetailLines = (reason: BakeFailureReason): string[] => {
  switch (reason.code) {
    case "unsupported-geometry-kind":
      return [`  geometryKind: ${reason.geometryKind}`];
    case "evaluation-failed":
      return reason.diagnostics.length === 0
        ? ["  diagnostics: none"]
        : [
            "  diagnostics:",
            ...reason.diagnostics.map((diagnostic) => `    - ${stableDiagnosticDetail(diagnostic)}`)
          ];
    case "unevaluated":
    case "geometry-unavailable":
      return [];
    case "not-losslessly-representable":
      return [
        `  geometryKind: ${reason.geometryKind}`,
        ...(reason.detail ? [`  detail: ${reason.detail}`] : [])
      ];
  }
};

const skippedTargetLines = (target: BakeSkippedTarget, index: number): string[] => [
  `${index + 1}. ${target.sourceLabel}`,
  `  targetId: ${target.targetId}`,
  `  sourceElementId: ${target.sourceElementId}`,
  `  reason: ${target.reason.code}`,
  ...reasonDetailLines(target.reason)
];

export const formatBakeOperationDetails = (input: BakeOperationPresentationInput): string => {
  const { successfulTargetCount, skippedTargetCount, skippedTargets } = input.summary;
  const lines = [
    `Mode: ${input.mode}`,
    `Successful targets: ${successfulTargetCount}`,
    `Skipped targets: ${skippedTargetCount}`
  ];
  if (skippedTargets.length > 0) {
    lines.push("", "Skipped target details:");
    skippedTargets.forEach((target, index) => {
      lines.push(...skippedTargetLines(target, index));
    });
  }
  return lines.join("\n");
};

export const presentBakeOperationResult = async (
  input: BakeOperationPresentationInput,
  output: BakeOutputTarget,
  notifications: BakeNotificationTarget
): Promise<void> => {
  output.clear();
  output.appendLine(formatBakeOperationDetails(input));

  const notification = bakeOperationNotificationFor(input);
  if (!notification) return;
  const selectedAction = notification.severity === "warning"
    ? await notifications.showWarningMessage(notification.message, BAKE_SHOW_DETAILS_ACTION)
    : await notifications.showErrorMessage(notification.message, BAKE_SHOW_DETAILS_ACTION);
  if (selectedAction === BAKE_SHOW_DETAILS_ACTION) output.show(true);
};
