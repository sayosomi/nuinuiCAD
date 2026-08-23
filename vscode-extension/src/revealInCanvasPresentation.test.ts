import { describe, expect, it } from "vitest";
import { revealInCanvasNotificationFor } from "./revealInCanvasPresentation";

describe("revealInCanvasNotificationFor", () => {
  it("keeps complete Reveal success silent", () => {
    expect(revealInCanvasNotificationFor({ status: "resolved", degradations: [] }, "ja")).toBeNull();
  });

  it("localizes full failures and falls back to English for unsupported locales", () => {
    expect(revealInCanvasNotificationFor({ status: "failed", reason: "no-target" }, "ja-JP"))
      .toEqual({
        severity: "error",
        message: "現在のカーソル位置には Canvas で表示できる対象がありません。"
      });
    expect(revealInCanvasNotificationFor({ status: "failed", reason: "canvas-history-busy" }, "fr"))
      .toEqual({
        severity: "error",
        message: "Reveal in Canvas is temporarily unavailable while Canvas history is being applied."
      });
  });

  it("distinguishes source-analysis unavailability from an ordinary no-target caret", () => {
    expect(revealInCanvasNotificationFor({ status: "failed", reason: "analysis-unavailable" }, "en"))
      .toEqual({
        severity: "error",
        message: "Reveal in Canvas is unavailable because source analysis is not ready."
      });
  });

  it("presents a current-runtime failure without inventing a fallback", () => {
    expect(revealInCanvasNotificationFor({
      status: "failed",
      reason: "no-revealable-runtime-target"
    }, "en")).toEqual({
      severity: "error",
      message: "No current Canvas geometry can be revealed for this source target."
    });
  });

  it("reports semantic owner fallback as one Warning", () => {
    const notification = revealInCanvasNotificationFor({
      status: "resolved",
      degradations: [{ kind: "owner-fallback", cause: "ambiguous", referenceText: "@Source::Public" }]
    }, "en-US");

    expect(notification).toEqual({
      severity: "warning",
      message: "The geometry reference @Source::Public is ambiguous, so its containing geometry was revealed instead."
    });
  });

  it("aggregates partial and fallback degradation into one localized notification", () => {
    const notification = revealInCanvasNotificationFor({
      status: "resolved",
      degradations: [
        { kind: "owner-fallback", cause: "hidden", referenceText: "@input" },
        { kind: "partial-targets", omittedCount: 2, causes: ["disabled", "profile-excluded"] }
      ]
    }, "ja");

    expect(notification).not.toBeNull();
    expect(notification?.severity).toBe("warning");
    expect(notification?.message).toContain("@input");
    expect(notification?.message).toContain("2 件");
    expect(notification?.message).toContain("無効");
    expect(notification?.message).toContain("表示プロファイルで除外");
  });
});
