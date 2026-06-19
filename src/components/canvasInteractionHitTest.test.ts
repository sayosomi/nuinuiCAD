import { describe, expect, it } from "vitest";
import {
  hitTestBezierHandle,
  hitTestPointPickCandidates,
  squaredScreenDistance
} from "./canvasInteractionHitTest";

describe("canvasInteractionHitTest", () => {
  it("calculates squared screen distance", () => {
    expect(squaredScreenDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
  });

  it("returns the backmost matching Bezier handle by iterating from the end", () => {
    const handles = [
      { id: "first", control: { x: 10, y: 10 } },
      { id: "last", control: { x: 12, y: 10 } }
    ];

    expect(hitTestBezierHandle({ x: 11, y: 10 }, handles, 3)?.id).toBe("last");
  });

  it("returns null when no Bezier handle is inside the hit radius", () => {
    expect(
      hitTestBezierHandle({ x: 0, y: 0 }, [{ id: "handle", control: { x: 10, y: 0 } }], 9)
    ).toBeNull();
  });

  it("includes Bezier handle hits exactly on the radius boundary", () => {
    expect(
      hitTestBezierHandle({ x: 0, y: 0 }, [{ id: "handle", control: { x: 3, y: 4 } }], 5)?.id
    ).toBe("handle");
  });

  it("returns point pick candidates from back to front", () => {
    const candidates = [
      { id: "front", screen: { x: 10, y: 10 } },
      { id: "middle", screen: { x: 12, y: 10 } },
      { id: "back", screen: { x: 30, y: 30 } }
    ];

    expect(hitTestPointPickCandidates({ x: 11, y: 10 }, candidates, 3).map((item) => item.id)).toEqual([
      "middle",
      "front"
    ]);
  });

  it("includes point pick hits exactly on the radius boundary", () => {
    expect(
      hitTestPointPickCandidates({ x: 0, y: 0 }, [{ id: "point", screen: { x: 6, y: 8 } }], 10)
        .map((item) => item.id)
    ).toEqual(["point"]);
  });
});
