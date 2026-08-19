import { describe, expect, it, vi } from "vitest";
import { createCanvasTextWidthMeasurer } from "./canvasTextMeasurement";

describe("createCanvasTextWidthMeasurer", () => {
  it("uses the current inherited font family and scales reference-pixel advances to world size", () => {
    const viewport = document.createElement("div");
    const context = {
      font: "",
      measureText: vi.fn(() => ({ width: 240 }))
    } as unknown as CanvasRenderingContext2D;
    const getComputedStyle = vi.fn(() => ({ fontFamily: "Inter, sans-serif" }) as CSSStyleDeclaration);
    const createCanvas = vi.fn(() => ({
      getContext: vi.fn(() => context)
    }) as unknown as HTMLCanvasElement);
    const measure = createCanvasTextWidthMeasurer(() => viewport, {
      createCanvas,
      getComputedStyle
    });

    expect(measure("ABC", 7.5)).toBe(18);
    expect(context.font).toBe("100px Inter, sans-serif");
    expect(getComputedStyle).toHaveBeenCalledWith(viewport);
    expect(createCanvas).toHaveBeenCalledTimes(1);
    expect(context.measureText).toHaveBeenCalledWith("ABC");
  });

  it("returns null when the browser cannot provide a 2D context", () => {
    const viewport = document.createElement("div");
    const measure = createCanvasTextWidthMeasurer(() => viewport, {
      createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
      getComputedStyle: () => ({ fontFamily: "Inter, sans-serif" }) as CSSStyleDeclaration
    });

    expect(measure("ABC", 7.5)).toBeNull();
  });
});
