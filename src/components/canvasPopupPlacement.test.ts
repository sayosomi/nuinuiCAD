import { describe, expect, it } from "vitest";
import { placeCanvasPopup } from "./canvasPopupPlacement";

describe("Canvas popup placement", () => {
  it("prefers the pointer's lower-right and flips before clamping", () => {
    expect(placeCanvasPopup(
      { x: 100, y: 100 },
      { width: 80, height: 60 },
      { width: 400, height: 300 }
    )).toEqual({ left: 112, top: 112 });

    expect(placeCanvasPopup(
      { x: 380, y: 280 },
      { width: 80, height: 60 },
      { width: 400, height: 300 }
    )).toEqual({ left: 288, top: 208 });
  });

  it("clamps oversized popups to the viewport margin", () => {
    expect(placeCanvasPopup(
      { x: 20, y: 20 },
      { width: 500, height: 400 },
      { width: 300, height: 240 }
    )).toEqual({ left: 8, top: 8 });
  });
});
