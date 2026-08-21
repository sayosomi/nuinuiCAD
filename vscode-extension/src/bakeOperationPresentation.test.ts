import { describe, expect, it, vi } from "vitest";
import {
  BAKE_SHOW_DETAILS_ACTION,
  bakeOperationNotificationFor,
  formatBakeOperationDetails,
  presentBakeOperationResult,
  type BakeNotificationTarget,
  type BakeOperationPresentationInput,
  type BakeOutputTarget
} from "./bakeOperationPresentation";

const operation = (
  successfulTargetCount: number,
  skippedTargets: BakeOperationPresentationInput["summary"]["skippedTargets"],
  mode: BakeOperationPresentationInput["mode"] = "current"
): BakeOperationPresentationInput => ({
  status: successfulTargetCount > 0 ? "applied" : "nothing",
  mode,
  summary: {
    successfulTargetCount,
    skippedTargets,
    skippedTargetCount: skippedTargets.length
  }
});

const skipped = (
  sourceLabel: string,
  reason: BakeOperationPresentationInput["summary"]["skippedTargets"][number]["reason"]
): BakeOperationPresentationInput["summary"]["skippedTargets"][number] => ({
  targetId: `target-${sourceLabel}` as never,
  sourceElementId: `source-${sourceLabel}` as never,
  sourceLabel,
  reason
});

const targets = () => {
  const output: BakeOutputTarget = {
    clear: vi.fn(),
    appendLine: vi.fn(),
    show: vi.fn()
  };
  const notifications: BakeNotificationTarget = {
    showWarningMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined)
  };
  return { output, notifications };
};

describe("Bake operation presentation", () => {
  it("keeps an all-success operation silent while replacing the latest detail", async () => {
    const { output, notifications } = targets();
    await presentBakeOperationResult(operation(2, [], "base"), output, notifications);

    expect(output.clear).toHaveBeenCalledOnce();
    expect(output.appendLine).toHaveBeenCalledWith([
      "Mode: base",
      "Successful targets: 2",
      "Skipped targets: 0"
    ].join("\n"));
    expect(notifications.showWarningMessage).not.toHaveBeenCalled();
    expect(notifications.showErrorMessage).not.toHaveBeenCalled();
    expect(output.show).not.toHaveBeenCalled();
  });

  it("warns for partial success with bounded reason-code aggregation and opens details on action", async () => {
    const input = operation(2, [
      skipped("line A", { code: "geometry-unavailable" }),
      skipped("line B", { code: "evaluation-failed", diagnostics: [] }),
      skipped("line C", { code: "geometry-unavailable" }),
      skipped("line D", { code: "unevaluated" }),
      skipped("line E", { code: "unsupported-geometry-kind", geometryKind: "image" })
    ]);
    const { output, notifications } = targets();
    vi.mocked(notifications.showWarningMessage).mockResolvedValue(BAKE_SHOW_DETAILS_ACTION);

    await presentBakeOperationResult(input, output, notifications);

    expect(notifications.showWarningMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Bake は2件成功し、5件をスキップしました（geometry-unavailable ×2, evaluation-failed ×1, unevaluated ×1, ほか1種類）。",
      BAKE_SHOW_DETAILS_ACTION
    );
    expect(notifications.showErrorMessage).not.toHaveBeenCalled();
    expect(output.show).toHaveBeenCalledWith(true);
  });

  it("errors when every structured target is skipped", async () => {
    const input = operation(0, [
      skipped("bezier Curve", {
        code: "not-losslessly-representable",
        geometryKind: "bezierCurve",
        detail: "curve has no representable segments"
      })
    ], "base");
    const { output, notifications } = targets();

    await presentBakeOperationResult(input, output, notifications);

    expect(notifications.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Bake は成功せず、1件をスキップしました（not-losslessly-representable ×1）。",
      BAKE_SHOW_DETAILS_ACTION
    );
    expect(notifications.showWarningMessage).not.toHaveBeenCalled();
    expect(output.show).not.toHaveBeenCalled();
  });

  it("formats target identity, semantic parameters, and evaluation diagnostic detail", () => {
    const input = operation(0, [
      skipped("line Unsupported", { code: "unsupported-geometry-kind", geometryKind: "text" }),
      skipped("line Failed", {
        code: "evaluation-failed",
        diagnostics: [{ elementId: "element-1", message: "missing dependency", code: "dependency-missing" }] as never
      }),
      skipped("line Exact", {
        code: "not-losslessly-representable",
        geometryKind: "offsetLine",
        detail: "closed offset cannot be represented exactly"
      })
    ]);

    expect(formatBakeOperationDetails(input)).toContain("Mode: current");
    expect(formatBakeOperationDetails(input)).toContain("1. line Unsupported");
    expect(formatBakeOperationDetails(input)).toContain("reason: unsupported-geometry-kind");
    expect(formatBakeOperationDetails(input)).toContain("geometryKind: text");
    expect(formatBakeOperationDetails(input)).toContain("2. line Failed");
    expect(formatBakeOperationDetails(input)).toContain('{"elementId":"element-1","message":"missing dependency","code":"dependency-missing"}');
    expect(formatBakeOperationDetails(input)).toContain("detail: closed offset cannot be represented exactly");
  });

  it("returns no new notification for a zero-success zero-structured-skip result", () => {
    expect(bakeOperationNotificationFor(operation(0, []))).toBeNull();
  });
});
