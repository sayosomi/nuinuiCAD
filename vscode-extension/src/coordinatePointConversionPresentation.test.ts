import { describe, expect, it, vi } from "vitest";
import {
  COORDINATE_POINT_CONVERSION_SHOW_DETAILS_ACTION,
  formatCoordinatePointConversionDetails,
  presentCoordinatePointConversionResult,
  type CoordinatePointConversionNotificationTarget,
  type CoordinatePointConversionOutputTarget
} from "./coordinatePointConversionPresentation";
import type { VscodeToExtensionMessage } from "../../src/vscode/protocol";

type Result = Extract<VscodeToExtensionMessage, { type: "coordinatePointConversionResult" }>;

const resultFor = (overrides: Partial<Result> = {}): Result => ({
  type: "coordinatePointConversionResult",
  requestId: 1,
  operationId: 2,
  documentUri: "file:///tmp/pattern.nui",
  documentVersion: 4,
  origin: "canvas",
  status: "applied",
  classification: "partial-success",
  successfulTargetIds: ["good"],
  successfulTargetCount: 1,
  skippedTargets: [{
    targetId: "bad",
    reason: { code: "target-not-eligible", message: "not a coordinate point" }
  }],
  skippedTargetCount: 1,
  mode: "xy",
  ...overrides
});

const targets = () => {
  const output: CoordinatePointConversionOutputTarget = {
    clear: vi.fn(),
    appendLine: vi.fn(),
    show: vi.fn()
  };
  const notifications: CoordinatePointConversionNotificationTarget = {
    showInformationMessage: vi.fn(async () => undefined),
    showWarningMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined)
  };
  return { output, notifications };
};

describe("coordinate point conversion presentation", () => {
  it("preserves planner classification and writes structured details", async () => {
    const { output, notifications } = targets();
    await presentCoordinatePointConversionResult(resultFor(), output, notifications);

    expect(formatCoordinatePointConversionDetails(resultFor())).toContain("Classification: partial-success");
    expect(output.clear).toHaveBeenCalledOnce();
    expect(output.appendLine).toHaveBeenCalledWith(expect.stringContaining("target-not-eligible"));
    expect(notifications.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("1件を変換し、1件をスキップ"),
      COORDINATE_POINT_CONVERSION_SHOW_DETAILS_ACTION
    );
  });

  it("opens details only when the established action is selected", async () => {
    const { output, notifications } = targets();
    vi.mocked(notifications.showErrorMessage).mockResolvedValue(COORDINATE_POINT_CONVERSION_SHOW_DETAILS_ACTION);
    await presentCoordinatePointConversionResult(resultFor({
      status: "rejected",
      classification: "all-skipped",
      successfulTargetIds: [],
      successfulTargetCount: 0
    }), output, notifications);

    expect(notifications.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("適用できませんでした"),
      COORDINATE_POINT_CONVERSION_SHOW_DETAILS_ACTION
    );
    expect(output.show).toHaveBeenCalledWith(true);
  });
});
