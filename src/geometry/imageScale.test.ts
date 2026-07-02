import { describe, expect, it } from "vitest";
import { defaultTargetPixelsPerMm, initialImageScale } from "./imageScale";

describe("imageScale", () => {
  it("computes initial scale from source dpi and requested pixels per millimeter", () => {
    expect(initialImageScale(300, 10)).toBeCloseTo(300 / 254);
  });

  it("uses source dpi for the target pixels per millimeter default", () => {
    expect(defaultTargetPixelsPerMm(254)).toBeCloseTo(10);
  });

  it("falls back when source dpi is unavailable", () => {
    expect(defaultTargetPixelsPerMm(null)).toBe(10);
  });
});
