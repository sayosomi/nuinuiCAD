import { describe, expect, it } from "vitest";
import { candidateWheelDeltaFor } from "./canvasCandidateWheel";

describe("candidateWheelDeltaFor", () => {
  it("accumulates pixel deltas and discards a partial delta when direction reverses", () => {
    const forward = candidateWheelDeltaFor({ remainder: 0, deltaY: 20, deltaMode: 0, viewportHeight: 300 });
    expect(forward).toEqual({ remainder: 20, cycles: 0 });

    const reversed = candidateWheelDeltaFor({ ...forward, deltaY: -1, deltaMode: 0, viewportHeight: 300 });
    expect(reversed).toEqual({ remainder: -1, cycles: 0 });

    expect(candidateWheelDeltaFor({ ...reversed, deltaY: -24, deltaMode: 0, viewportHeight: 300 }))
      .toEqual({ remainder: -1, cycles: -1 });
  });

  it("normalizes line and page deltas before selecting candidates", () => {
    expect(candidateWheelDeltaFor({ remainder: 0, deltaY: 2, deltaMode: 1, viewportHeight: 300 }))
      .toEqual({ remainder: 8, cycles: 1 });
    expect(candidateWheelDeltaFor({ remainder: 0, deltaY: 1, deltaMode: 2, viewportHeight: 300 }))
      .toEqual({ remainder: 12, cycles: 12 });
  });
});
