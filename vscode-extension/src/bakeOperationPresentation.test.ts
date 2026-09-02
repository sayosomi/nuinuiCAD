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
import type { VscodeToExtensionMessage } from "../../src/vscode/protocol";

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

  it("presents Module Preview results through the same structured Bake path", async () => {
    const input = {
      type: "bakeOperationResult",
      surface: "modulePreview",
      mode: "base",
      ...operation(0, [skipped("text Memo", { code: "unsupported-geometry-kind", geometryKind: "text" })], "base")
    } satisfies Extract<VscodeToExtensionMessage, { type: "bakeOperationResult" }>;
    const { output, notifications } = targets();

    await presentBakeOperationResult(input, output, notifications);

    expect(output.appendLine).toHaveBeenCalledWith(expect.stringContaining("Mode: base"));
    expect(notifications.showErrorMessage).toHaveBeenCalledWith(
      "nuinuiCAD: Bake created no targets and skipped 1 (unsupported geometry kind ×1).",
      BAKE_SHOW_DETAILS_ACTION
    );
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
      "nuinuiCAD: Bake created 2 target(s) and skipped 5 (geometry unavailable ×2, evaluation failed ×1, not evaluated ×1, other 1 reason types).",
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
      "nuinuiCAD: Bake created no targets and skipped 1 (cannot be represented exactly ×1).",
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

  it("localizes the same structured result without changing target identity", () => {
    const input = operation(1, [skipped("line A", { code: "geometry-unavailable" })]);
    expect(bakeOperationNotificationFor(input, "ja")).toEqual({
      severity: "warning",
      message: "nuinuiCAD: Bake は 1 件を作成し、1 件をスキップしました (ジオメトリを利用できない ×1)。"
    });
    expect(formatBakeOperationDetails(input, "ja")).toContain("対象の詳細");
    expect(formatBakeOperationDetails(input, "ja")).toContain("target-line A");
  });
});
