import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CanvasOverlayText } from "./DrawingCanvasTypes";
import { CanvasOverlay } from "./CanvasOverlay";

const overlayText = (
  elementId: string,
  text: string,
  fontSizePx: number
): CanvasOverlayText => ({
  text: {
    kind: "text",
    elementId,
    name: elementId,
    text,
    anchor: { kind: "point", elementId: `${elementId}-anchor`, name: "anchor", x: 0, y: 0 },
    fontSize: fontSizePx
  },
  screen: { x: 20, y: 30 },
  fontSizePx
});

const renderOverlay = (overlayTexts: CanvasOverlayText[]) => render(
  <CanvasOverlay
    viewportSize={{ width: 500, height: 400 }}
    overlayLines={[]}
    overlayArcs={[]}
    overlayCurves={[]}
    overlayOffsetLines={[]}
    overlayPoints={[]}
    overlayTexts={overlayTexts}
    selectedBezierHandles={[]}
    overlayPointPickCandidates={[]}
    selectedElementIdSet={new Set()}
    draftLinePickElementIds={new Set()}
    pickCandidateLineIds={new Set()}
    selectedElementId={null}
    elementColors={new Map()}
    showCanvasElementNames={false}
    showCanvasPoints={false}
    isPointPickActive={false}
    isNumericReferencePickActive={false}
    isLinePickActive={false}
  />
);

describe("CanvasOverlay text rendering", () => {
  it("writes evaluated document size to the final SVG node and preserves line placement", () => {
    const { container } = renderOverlay([
      overlayText("size-3", "small", 3),
      overlayText("size-30", "large\nsecond line", 30)
    ]);
    const textNodes = container.querySelectorAll("text.overlay-text");

    expect(textNodes).toHaveLength(2);
    expect(textNodes[0]).toHaveStyle({ fontSize: "3px" });
    expect(textNodes[1]).toHaveStyle({ fontSize: "30px" });
    expect(textNodes[0]).toHaveAttribute("x", "20");
    expect(textNodes[0]).toHaveAttribute("y", "30");
    expect(textNodes[1].querySelectorAll("tspan")[1]).toHaveAttribute("dy", "36");
  });

  it("updates the final SVG font size when Canvas zoom changes", () => {
    const { container, rerender } = renderOverlay([overlayText("label", "text", 3)]);
    const textNode = () => container.querySelector("text.overlay-text");

    expect(textNode()).toHaveStyle({ fontSize: "3px" });

    rerender(
      <CanvasOverlay
        viewportSize={{ width: 500, height: 400 }}
        overlayLines={[]}
        overlayArcs={[]}
        overlayCurves={[]}
        overlayOffsetLines={[]}
        overlayPoints={[]}
        overlayTexts={[overlayText("label", "text", 6)]}
        selectedBezierHandles={[]}
        overlayPointPickCandidates={[]}
        selectedElementIdSet={new Set()}
        draftLinePickElementIds={new Set()}
        pickCandidateLineIds={new Set()}
        selectedElementId={null}
        elementColors={new Map()}
        showCanvasElementNames={false}
        showCanvasPoints={false}
        isPointPickActive={false}
        isNumericReferencePickActive={false}
        isLinePickActive={false}
      />
    );

    expect(textNode()).toHaveStyle({ fontSize: "6px" });
  });
});
