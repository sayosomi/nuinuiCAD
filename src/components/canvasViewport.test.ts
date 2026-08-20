import { describe, expect, it } from "vitest";
import {
  constrainedWorldDelta,
  screenToWorld,
  visibleGridStep,
  visibleWorldBounds,
  worldToScreen
} from "./canvasViewport";

describe("canvasViewport", () => {
  const viewport = { panX: 20, panY: -10, zoom: 2 };
  const size = { width: 500, height: 400 };

  it("converts world coordinates to screen coordinates", () => {
    expect(worldToScreen({ x: 10, y: -5 }, size, viewport)).toEqual({
      x: 290,
      y: 200
    });
  });

  it("converts screen coordinates back to world coordinates with the inverse Y-up transform", () => {
    const worldPoint = { x: 10, y: -5 };
    const screenPoint = worldToScreen(worldPoint, size, viewport);

    expect(screenToWorld(screenPoint, size, viewport)).toEqual(worldPoint);
    expect(screenToWorld({ x: 290, y: 200 }, size, viewport)).toEqual({ x: 10, y: -5 });
    expect(screenToWorld(worldToScreen({ x: -12.5, y: 27.25 }, size, viewport), size, viewport)).toEqual({
      x: -12.5,
      y: 27.25
    });
  });

  it("returns visible world bounds", () => {
    expect(visibleWorldBounds(size, viewport)).toEqual({
      minX: -135,
      maxX: 115,
      minY: -105,
      maxY: 95
    });
  });

  it("expands visible grid step until it reaches the minimum screen spacing", () => {
    const options = {
      gridStep: 10,
      majorGridMultiplier: 5,
      minGridSpacingPx: 8
    };

    expect(visibleGridStep(2, options)).toBe(10);
    expect(visibleGridStep(0.5, options)).toBe(50);
    expect(visibleGridStep(0.02, options)).toBe(1250);
  });

  it("constrains drag deltas by axis locks and zoom", () => {
    expect(
      constrainedWorldDelta({
        screenDx: 20,
        screenDy: -10,
        zoom: 2,
        axisLockKeys: { x: false, y: false }
      })
    ).toEqual({ dx: 10, dy: 5 });
    expect(
      constrainedWorldDelta({
        screenDx: 20,
        screenDy: -10,
        zoom: 2,
        axisLockKeys: { x: true, y: false }
      })
    ).toEqual({ dx: 10, dy: 0 });
    expect(
      constrainedWorldDelta({
        screenDx: 20,
        screenDy: -10,
        zoom: 2,
        axisLockKeys: { x: false, y: true }
      })
    ).toEqual({ dx: 0, dy: 5 });
  });
});
