import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CanvasOverlayText } from "./DrawingCanvasTypes";
import { CanvasOverlay } from "./CanvasOverlay";
import { LEGACY_CANVAS_THEME } from "./canvasTheme";
import type { ComputedBezierCurve } from "../types/geometry";

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
    selectedBezierEditingHelper={null}
    selectedBezierHandles={[]}
    overlayPointPickCandidates={[]}
    selectedElementIdSet={new Set()}
    draftLinePickElementIds={new Set()}
    pickCandidateLineIds={new Set()}
    selectedElementId={null}
    canvasTheme={LEGACY_CANVAS_THEME}
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
        selectedBezierEditingHelper={null}
        selectedBezierHandles={[]}
        overlayPointPickCandidates={[]}
        selectedElementIdSet={new Set()}
        draftLinePickElementIds={new Set()}
        pickCandidateLineIds={new Set()}
        selectedElementId={null}
        canvasTheme={LEGACY_CANVAS_THEME}
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

  it("scopes selection, pick, and Bezier presentation colors from CanvasTheme", () => {
    const theme = {
      ...LEGACY_CANVAS_THEME,
      selection: "#selection",
      pickCandidate: "#pick",
      bezierHandleLine: "#handle-line",
      bezierHandlePoint: "#handle-point"
    };
    const { container } = render(
      <CanvasOverlay
        viewportSize={{ width: 500, height: 400 }}
        overlayLines={[]}
        overlayArcs={[]}
        overlayCurves={[]}
        overlayOffsetLines={[]}
        overlayPoints={[]}
        overlayTexts={[]}
        selectedBezierEditingHelper={null}
        selectedBezierHandles={[]}
        overlayPointPickCandidates={[]}
        selectedElementIdSet={new Set()}
        draftLinePickElementIds={new Set()}
        pickCandidateLineIds={new Set()}
        selectedElementId={null}
        canvasTheme={theme}
        elementColors={new Map()}
        showCanvasElementNames={false}
        showCanvasPoints={false}
        isPointPickActive={false}
        isNumericReferencePickActive={false}
        isLinePickActive={false}
      />
    );
    const style = container.querySelector(".drawing-overlay")?.getAttribute("style") ?? "";

    expect(style).toContain("--canvas-selection: #selection");
    expect(style).toContain("--canvas-pick-candidate: #pick");
    expect(style).toContain("--canvas-bezier-handle-line: #handle-line");
    expect(style).toContain("--canvas-bezier-handle-point: #handle-point");
  });

  it("renders the pre-mutation helper without making it a pick candidate", () => {
    const helperCurve: ComputedBezierCurve = {
      kind: "bezierCurve",
      elementId: "curve",
      name: "Curve",
      startPointId: null,
      endPointId: null,
      intermediatePointIds: [],
      segments: [],
      length: 0,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null,
      startHandleAngleDeg: 0,
      startHandleLength: 0,
      endHandleAngleDeg: 0,
      endHandleLength: 0
    };
    const { container } = render(
      <CanvasOverlay
        viewportSize={{ width: 500, height: 400 }}
        overlayLines={[]}
        overlayArcs={[]}
        overlayCurves={[]}
        overlayOffsetLines={[]}
        overlayPoints={[]}
        overlayTexts={[]}
        selectedBezierEditingHelper={{ curve: helperCurve, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }}
        selectedBezierHandles={[]}
        overlayPointPickCandidates={[]}
        selectedElementIdSet={new Set()}
        draftLinePickElementIds={new Set()}
        pickCandidateLineIds={new Set(["curve"])}
        selectedElementId={null}
        canvasTheme={LEGACY_CANVAS_THEME}
        elementColors={new Map()}
        showCanvasElementNames={false}
        showCanvasPoints={false}
        isPointPickActive={false}
        isNumericReferencePickActive={true}
        isLinePickActive={true}
      />
    );
    const helper = container.querySelector(".overlay-bezier-editing-helper");

    expect(helper).not.toBeNull();
    expect(helper).not.toHaveAttribute("data-line-pick-candidate");
    expect(helper).not.toHaveAttribute("data-numeric-reference-candidate");
  });
});
