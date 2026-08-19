import type { CanvasTextWidthMeasurer } from "../geometry/canvasDrawingBounds";

const REFERENCE_FONT_SIZE_PX = 100;

type CanvasTextMeasurementDependencies = {
  createCanvas?: () => HTMLCanvasElement;
  getComputedStyle?: (element: Element) => CSSStyleDeclaration;
};

/**
 * Creates the browser-side text measurement capability used by Fit Drawing.
 * The viewport's current computed font family is read on every measurement so
 * the offscreen canvas follows the font stack inherited by the SVG overlay.
 */
export const createCanvasTextWidthMeasurer = (
  getCanvasViewport: () => HTMLElement | null,
  dependencies: CanvasTextMeasurementDependencies = {}
): CanvasTextWidthMeasurer => {
  let context: CanvasRenderingContext2D | null | undefined;

  return (text, fontSize) => {
    if (typeof text !== "string" || !Number.isFinite(fontSize) || fontSize <= 0) return null;

    const viewport = getCanvasViewport();
    if (!viewport) return null;

    let fontFamily: string;
    try {
      const computedStyle = (dependencies.getComputedStyle ?? ((element) => window.getComputedStyle(element)))(viewport);
      fontFamily = computedStyle.fontFamily;
    } catch {
      return null;
    }
    if (typeof fontFamily !== "string" || fontFamily.trim().length === 0) return null;

    if (context === undefined) {
      try {
        const canvas = (dependencies.createCanvas ?? (() => document.createElement("canvas")))();
        context = canvas.getContext("2d");
      } catch {
        context = null;
      }
    }
    if (!context) return null;

    try {
      context.font = `${REFERENCE_FONT_SIZE_PX}px ${fontFamily}`;
      const measuredWidth = context.measureText(text).width;
      const width = measuredWidth * fontSize / REFERENCE_FONT_SIZE_PX;
      return Number.isFinite(width) && width >= 0 ? width : null;
    } catch {
      return null;
    }
  };
};
