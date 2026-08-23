import { describe, expect, it } from "vitest";
import { directedSweepDegrees } from "./evaluateGeometryPrimitives";

describe("directedSweepDegrees", () => {
  it("preserves counterclockwise traversal as a positive sweep", () => {
    expect(directedSweepDegrees(15, 155, "counterclockwise")).toBe(140);
    expect(directedSweepDegrees(350, 10, "counterclockwise")).toBe(20);
  });

  it("represents clockwise traversal as the negative complementary sweep", () => {
    expect(directedSweepDegrees(15, 155, "clockwise")).toBe(-220);
    expect(directedSweepDegrees(155, 15, "clockwise")).toBe(-140);
  });

  it("keeps equal angles at canonical zero in either direction", () => {
    expect(directedSweepDegrees(0, 0, "counterclockwise")).toBe(0);
    const clockwise = directedSweepDegrees(0, 0, "clockwise");
    expect(clockwise).toBe(0);
    expect(Object.is(clockwise, -0)).toBe(false);
  });

  it("preserves explicit full turns with the requested sign", () => {
    expect(directedSweepDegrees(0, 360, "counterclockwise")).toBe(360);
    expect(directedSweepDegrees(0, 360, "clockwise")).toBe(-360);
    expect(directedSweepDegrees(720, 0, "counterclockwise")).toBe(360);
    expect(directedSweepDegrees(720, 0, "clockwise")).toBe(-360);
  });
});
