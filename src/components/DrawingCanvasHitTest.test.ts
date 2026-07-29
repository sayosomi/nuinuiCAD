import { describe, expect, it } from "vitest";
import { hitTestCanvasGeometry } from "./DrawingCanvasHitTest";

const textHitTest = (fontSizePx: number) => hitTestCanvasGeometry({
  screen: { x: 20, y: 10 },
  lines: [],
  texts: [{
    text: { elementId: "label", text: "text" },
    screen: { x: 0, y: 0 },
    fontSizePx
  }],
  points: []
});

describe("text Canvas hit testing", () => {
  it("uses the rendered font size for text bounds", () => {
    expect(textHitTest(3)).toBeNull();
    expect(textHitTest(30)).toBe("label");
  });
});
