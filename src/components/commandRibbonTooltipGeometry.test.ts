import { describe, expect, it } from "vitest";
import { calculateCommandRibbonTooltipPlacement } from "./commandRibbonTooltipGeometry";

const boundary = { left: 0, top: 0, right: 400, bottom: 300 };

describe("Command Ribbon tooltip geometry", () => {
  it("centers a tooltip below the trigger when there is room", () => {
    expect(
      calculateCommandRibbonTooltipPlacement(
        { left: 100, top: 40, right: 140, bottom: 60 },
        { width: 80, height: 20 },
        boundary
      )
    ).toEqual({ left: 80, top: 66, side: "below" });
  });

  it("flips a tooltip above a trigger near the bottom edge", () => {
    expect(
      calculateCommandRibbonTooltipPlacement(
        { left: 100, top: 260, right: 140, bottom: 280 },
        { width: 80, height: 20 },
        boundary
      )
    ).toEqual({ left: 80, top: 234, side: "above" });
  });

  it("clamps a centered tooltip to the left viewport inset", () => {
    expect(
      calculateCommandRibbonTooltipPlacement(
        { left: 2, top: 40, right: 22, bottom: 60 },
        { width: 100, height: 20 },
        boundary
      ).left
    ).toBe(6);
  });

  it("clamps a centered tooltip to the right viewport inset", () => {
    expect(
      calculateCommandRibbonTooltipPlacement(
        { left: 378, top: 40, right: 398, bottom: 60 },
        { width: 100, height: 20 },
        boundary
      ).left
    ).toBe(294);
  });

  it("uses the boundary inset for both horizontal and vertical placement", () => {
    expect(
      calculateCommandRibbonTooltipPlacement(
        { left: 50, top: 40, right: 70, bottom: 60 },
        { width: 100, height: 20 },
        { left: 50, top: 20, right: 450, bottom: 320 },
        6,
        12
      )
    ).toEqual({ left: 62, top: 66, side: "below" });
  });

  it("chooses the side with more space and clamps when neither side fully fits", () => {
    expect(
      calculateCommandRibbonTooltipPlacement(
        { left: 80, top: 25, right: 120, bottom: 37 },
        { width: 80, height: 70 },
        { left: 0, top: 0, right: 200, bottom: 100 }
      )
    ).toEqual({ left: 60, top: 24, side: "below" });
  });
});
