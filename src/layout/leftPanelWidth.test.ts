import { describe, expect, it } from "vitest";
import {
  MIN_LEFT_PANEL_WIDTH,
  clampStoredLeftPanelWidth,
  clampVisibleLeftPanelWidth,
  maximumVisibleLeftPanelWidth
} from "./leftPanelWidth";

describe("leftPanelWidth", () => {
  it("leaves room for the fixed Inspector and usable Canvas on wide screens", () => {
    expect(maximumVisibleLeftPanelWidth(1280)).toBe(600);
    expect(maximumVisibleLeftPanelWidth(1440)).toBe(760);
    expect(maximumVisibleLeftPanelWidth(1920)).toBe(1240);
  });

  it("keeps a saved preference while temporarily constraining its visible width", () => {
    const savedWideWidth = clampStoredLeftPanelWidth(1200);
    expect(clampVisibleLeftPanelWidth(savedWideWidth, 1280)).toBe(600);
    expect(clampVisibleLeftPanelWidth(savedWideWidth, 1920)).toBe(1200);
  });

  it("does not let narrow viewports reduce the editor below its readable minimum", () => {
    expect(maximumVisibleLeftPanelWidth(960)).toBe(MIN_LEFT_PANEL_WIDTH);
  });
});
