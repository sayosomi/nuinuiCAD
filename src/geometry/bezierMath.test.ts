import { describe, expect, it } from "vitest";
import { cross, selectBestBezierFeatureCandidate, signedCurvatureAt, solveRealQuadratic } from "./bezierMath";

describe("Bezier shared vector math", () => {
  it("computes the signed 2D cross product", () => {
    expect(cross({ x: 3, y: 2 }, { x: 1, y: 4 })).toBe(10);
  });

  it("computes signed cubic curvature with the shared EPSILON guard", () => {
    const curve = {
      start: { x: 0, y: 0 },
      control1: { x: 0, y: 10 },
      control2: { x: 10, y: 10 },
      end: { x: 10, y: 0 }
    };
    expect(signedCurvatureAt(curve, 0.5)).toBeCloseTo(-900 / 15 ** 3, 12);
    expect(signedCurvatureAt({ ...curve, control1: { x: 0, y: 0 }, control2: { x: 10, y: 0 } }, 0.5)).toBe(0);
  });
});

describe("Bezier quadratic helpers", () => {
  it("solves real quadratic roots in ascending order", () => {
    expect(solveRealQuadratic(1, -3, 2)).toEqual([1, 2]);
    expect(solveRealQuadratic(-1, 3, -2)).toEqual([1, 2]);
  });

  it("handles double, linear, constant, and non-real degenerations", () => {
    expect(solveRealQuadratic(1, -2, 1)).toEqual([1]);
    expect(solveRealQuadratic(0, 2, -4)).toEqual([2]);
    expect(solveRealQuadratic(0, 0, 1)).toEqual([]);
    expect(solveRealQuadratic(1, 0, 1)).toEqual([]);
  });

  it("treats a near-zero discriminant as a double root", () => {
    expect(solveRealQuadratic(1, 2, 1 + 1e-10)).toEqual([-1]);
  });
});

describe("Bezier feature candidate tie-break", () => {
  it("prefers the candidate closest to the center", () => {
    expect(selectBestBezierFeatureCandidate([
      { t: 0, score: 1 },
      { t: 0.6, score: 1 }
    ])).toEqual({ t: 0.6, score: 1 });
  });

  it("prefers the smaller t when center distance is tied", () => {
    expect(selectBestBezierFeatureCandidate([
      { t: 0, score: 1 },
      { t: 1, score: 1 }
    ])).toEqual({ t: 0, score: 1 });
  });
});
