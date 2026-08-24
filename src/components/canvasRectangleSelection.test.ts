import { describe, expect, it } from "vitest";
import {
  canvasRectangleMemberIds,
  screenSelectionRectangleBetween,
  type CanvasRectangleMembershipInput
} from "./canvasRectangleSelection";

const rectangle = { left: 0, top: 0, right: 10, bottom: 10 };
const identity = (elementId: string) => ({ elementId });
const members = (
  mode: CanvasRectangleMembershipInput["mode"],
  input: Omit<CanvasRectangleMembershipInput, "rectangle" | "mode">
) => canvasRectangleMemberIds({ rectangle, mode, ...input });

describe("Canvas rectangle membership", () => {
  it("normalizes drag corners and includes points on the boundary", () => {
    expect(screenSelectionRectangleBetween({ x: 10, y: 8 }, { x: 2, y: 1 })).toEqual({
      left: 2,
      top: 1,
      right: 10,
      bottom: 8
    });

    expect(members("window", {
      points: [
        { point: identity("inside"), screen: { x: 5, y: 5 } },
        { point: identity("boundary"), screen: { x: 10, y: 5 } },
        { point: identity("outside"), screen: { x: 11, y: 5 } }
      ]
    })).toEqual(["inside", "boundary"]);
  });

  it("distinguishes Window containment from Crossing intersection for line paths", () => {
    const input = {
      lines: [
        { line: identity("contained"), start: { x: 1, y: 1 }, end: { x: 9, y: 9 } },
        { line: identity("crossing"), start: { x: -5, y: 5 }, end: { x: 15, y: 5 } },
        { line: identity("touching"), start: { x: -5, y: 10 }, end: { x: 0, y: 10 } },
        { line: identity("outside"), start: { x: -5, y: -5 }, end: { x: -1, y: -1 } }
      ]
    };

    expect(members("window", input)).toEqual(["contained"]);
    expect(members("crossing", input)).toEqual(["contained", "crossing", "touching"]);
  });

  it("uses sampled path geometry rather than a representative point", () => {
    const pathInput = {
      arcs: [{ arc: identity("arc"), points: [{ x: -2, y: 3 }, { x: 5, y: 3 }, { x: 12, y: 3 }] }],
      curves: [{ curve: identity("curve"), points: [{ x: 2, y: 2 }, { x: 8, y: 8 }] }],
      offsetLines: [{ line: identity("offset"), points: [{ x: -2, y: 7 }, { x: 12, y: 7 }] }]
    };

    expect(members("window", pathInput)).toEqual(["curve"]);
    expect(members("crossing", pathInput)).toEqual(["arc", "curve", "offset"]);
  });

  it("handles image polygon containment and crossing when no image corner lies inside", () => {
    const input = {
      images: [
        {
          image: identity("contained-image"),
          corners: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }]
        },
        {
          image: identity("surrounding-image"),
          corners: [{ x: -5, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 15 }, { x: -5, y: 15 }]
        }
      ]
    };

    expect(members("window", input)).toEqual(["contained-image"]);
    expect(members("crossing", input)).toEqual(["contained-image", "surrounding-image"]);
  });

  it("uses the shared text hit bounds for Window and Crossing semantics", () => {
    const input = {
      texts: [
        { text: { ...identity("inside-text"), text: "A" }, screen: { x: 1, y: 1 }, fontSizePx: 5 },
        { text: { ...identity("crossing-text"), text: "AB" }, screen: { x: 9, y: 2 }, fontSizePx: 5 },
        { text: { ...identity("outside-text"), text: "A" }, screen: { x: 20, y: 20 }, fontSizePx: 5 }
      ]
    };

    expect(members("window", input)).toEqual(["inside-text"]);
    expect(members("crossing", input)).toEqual(["inside-text", "crossing-text"]);
  });
});
