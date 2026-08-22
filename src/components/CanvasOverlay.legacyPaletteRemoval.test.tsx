import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DrawingModifierStroke } from "../types/geometry";
import { CanvasOverlay } from "./CanvasOverlay";
import type { CanvasOverlayText } from "./DrawingCanvasTypes";
import { LEGACY_CANVAS_THEME } from "./canvasTheme";

const overlayText = (elementId: string): CanvasOverlayText => ({
  text: {
    kind: "text",
    elementId,
    name: elementId,
    text: "hello",
    anchor: {
      kind: "point",
      elementId: `${elementId}-anchor`,
      name: "anchor",
      x: 0,
      y: 0
    },
    fontSize: 12
  },
  screen: { x: 20, y: 30 },
  fontSizePx: 12
});

const renderText = (effectiveDrawingModifierStrokes?: ReadonlyMap<string, DrawingModifierStroke>) => {
  const canvasTheme = {
    ...LEGACY_CANVAS_THEME,
    foreground: "#112233",
    warning: "#aabbcc"
  };
  const screen = render(
    <CanvasOverlay
      viewportSize={{ width: 500, height: 400 }}
      overlayLines={[]}
      overlayArcs={[]}
      overlayCurves={[]}
      overlayOffsetLines={[]}
      overlayPoints={[]}
      overlayTexts={[overlayText("label")]}
      selectedBezierEditingHelper={null}
      selectedBezierHandles={[]}
      overlayPointPickCandidates={[]}
      selectedElementIdSet={new Set()}
      draftLinePickElementIds={new Set()}
      pickCandidateLineIds={new Set()}
      selectedElementId={null}
      canvasTheme={canvasTheme}
      effectiveDrawingModifierStrokes={effectiveDrawingModifierStrokes}
      showCanvasPointNames={false}
      showCanvasGeometryNames={false}
      showCanvasPoints={false}
      isPointPickActive={false}
      isNumericReferencePickActive={false}
      isLinePickActive={false}
      hoveredElementIds={new Set()}
      hoverRepresentativeElementId={null}
    />
  );
  return screen.container.querySelector("text.overlay-text");
};

describe("CanvasOverlay legacy Palette removal", () => {
  it("uses the Canvas theme foreground for unmodified text", () => {
    expect(renderText()).toHaveAttribute("fill", "#112233");
  });

  it("preserves a fixed Drawing Modifier color", () => {
    const stroke: DrawingModifierStroke = {
      widthPx: 1,
      style: "solid",
      color: { kind: "fixed", hex: "#445566" }
    };

    expect(renderText(new Map([["label", stroke]]))).toHaveAttribute("fill", "#445566");
  });

  it("resolves a Drawing Modifier theme role through the Canvas theme", () => {
    const stroke: DrawingModifierStroke = {
      widthPx: 1,
      style: "solid",
      color: { kind: "themeRole", role: "warning" }
    };

    expect(renderText(new Map([["label", stroke]]))).toHaveAttribute("fill", "#aabbcc");
  });
});
