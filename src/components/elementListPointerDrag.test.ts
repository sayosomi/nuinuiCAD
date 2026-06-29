import { describe, expect, it } from "vitest";
import { elementListAutoScrollDelta } from "./elementListPointerDrag";

const rect = {
  top: 100,
  bottom: 300
};

describe("elementListAutoScrollDelta", () => {
  it("returns negative scroll near the top edge", () => {
    expect(elementListAutoScrollDelta(rect, 124)).toBe(-9);
  });

  it("returns positive scroll near the bottom edge", () => {
    expect(elementListAutoScrollDelta(rect, 276)).toBe(9);
  });

  it("returns zero away from the edges", () => {
    expect(elementListAutoScrollDelta(rect, 200)).toBe(0);
  });

  it("clamps scroll outside the container", () => {
    expect(elementListAutoScrollDelta(rect, 40)).toBe(-18);
    expect(elementListAutoScrollDelta(rect, 360)).toBe(18);
  });
});
