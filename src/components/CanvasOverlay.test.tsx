import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CanvasIdentityCandidate, CanvasOverlayText } from "./DrawingCanvasTypes";
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
        showCanvasPointNames={false}
        showCanvasGeometryNames={false}
        showCanvasPoints={false}
        isPointPickActive={false}
        isNumericReferencePickActive={true}
        isLinePickActive={true}
        hoveredElementIds={new Set()}
        hoverRepresentativeElementId={null}
      />
    );
    const helper = container.querySelector(".overlay-bezier-editing-helper");

    expect(helper).not.toBeNull();
    expect(helper).not.toHaveAttribute("data-line-pick-candidate");
    expect(helper).not.toHaveAttribute("data-numeric-reference-candidate");
  });
});

describe("Canvas identity labels", () => {
  it("shows persistent point names, contextual geometry names, and no duplicate or unnamed labels", () => {
    const candidates: CanvasIdentityCandidate[] = [
      { elementId: "point", name: "Point", kind: "point", representativeScreen: { x: 20, y: 30 } },
      { elementId: "line", name: "Line", kind: "line", representativeScreen: { x: 40, y: 50 } },
      { elementId: "hovered", name: "Hovered", kind: "text", representativeScreen: { x: 60, y: 70 } },
      { elementId: "unnamed", name: null, kind: "image", representativeScreen: { x: 80, y: 90 } },
      { elementId: "line", name: "Line duplicate", kind: "line", representativeScreen: { x: 100, y: 110 } },
      { elementId: "secondary", name: "Secondary", kind: "line", representativeScreen: { x: 120, y: 130 } }
    ];
    const { container, rerender } = render(
      <CanvasOverlay
        viewportSize={{ width: 500, height: 400 }}
        overlayLines={[]}
        overlayArcs={[]}
        overlayCurves={[]}
        overlayOffsetLines={[]}
        overlayPoints={[]}
        overlayTexts={[]}
        overlayIdentityCandidates={candidates}
        selectedBezierEditingHelper={null}
        selectedBezierHandles={[]}
        overlayPointPickCandidates={[]}
        selectedElementIdSet={new Set(["secondary"])}
        draftLinePickElementIds={new Set()}
        pickCandidateLineIds={new Set()}
        selectedElementId={null}
        canvasTheme={LEGACY_CANVAS_THEME}
        showCanvasPointNames={true}
        showCanvasGeometryNames={false}
        showCanvasPoints={false}
        isPointPickActive={false}
        isNumericReferencePickActive={false}
        isLinePickActive={false}
        hoveredElementIds={new Set()}
        hoverRepresentativeElementId={null}
      />
    );

    expect(container.querySelectorAll("[data-element-identity]")).toHaveLength(1);
    expect(container.querySelector("[data-element-identity='point']")).toHaveTextContent("Point");
    expect(container.querySelector("[data-element-identity='line']")).toBeNull();

    rerender(
      <CanvasOverlay
        viewportSize={{ width: 500, height: 400 }}
        overlayLines={[]}
        overlayArcs={[]}
        overlayCurves={[]}
        overlayOffsetLines={[]}
        overlayPoints={[]}
        overlayTexts={[]}
        overlayIdentityCandidates={candidates}
        selectedBezierEditingHelper={null}
        selectedBezierHandles={[]}
        overlayPointPickCandidates={[]}
        selectedElementIdSet={new Set()}
        draftLinePickElementIds={new Set()}
        pickCandidateLineIds={new Set()}
        selectedElementId="line"
        canvasTheme={LEGACY_CANVAS_THEME}
        showCanvasPointNames={false}
        showCanvasGeometryNames={false}
        showCanvasPoints={false}
        isPointPickActive={false}
        isNumericReferencePickActive={false}
        isLinePickActive={false}
        hoveredElementIds={new Set(["line", "hovered"])}
        hoverRepresentativeElementId="hovered"
      />
    );
    expect(container.querySelectorAll("[data-element-identity]")).toHaveLength(2);
    expect(container.querySelector("[data-element-identity='line']")).toHaveTextContent("Line");
    expect(container.querySelector("[data-element-identity='hovered']")).toHaveTextContent("Hovered");
    expect(container.querySelector("[data-element-identity='line']")).toHaveAttribute("x", "48");
    expect(container.querySelector("[data-element-identity='line']")).toHaveAttribute("y", "42");
    expect(container.querySelector("[data-element-identity='line']")).toHaveClass(
      "overlay-element-identity-primary-selected",
      "overlay-element-identity-hovered"
    );
    expect(container.querySelector("[data-element-identity='hovered']")).toHaveClass(
      "overlay-element-identity-hovered"
    );
    expect(container.querySelector("[data-element-identity='secondary']")).toBeNull();
  });
});


describe("Module instance selection frame", () => {
  it("renders the frame and name with the Canvas selection semantic and no pointer target", () => {
    const { container } = render(
      <CanvasOverlay
        viewportSize={{ width: 500, height: 400 }}
        moduleInstanceSelectionFrames={[{
          instanceId: "instance",
          name: "InstanceOne",
          left: 10,
          top: 20,
          width: 120,
          height: 80
        }]}
        overlayLines={[]}
        overlayArcs={[]}
        overlayCurves={[]}
        overlayOffsetLines={[]}
        overlayPoints={[]}
        overlayTexts={[]}
        selectedBezierEditingHelper={null}
        selectedBezierHandles={[]}
        overlayPointPickCandidates={[]}
        selectedElementIdSet={new Set(["instance"])}
        draftLinePickElementIds={new Set()}
        pickCandidateLineIds={new Set()}
        selectedElementId="instance"
        canvasTheme={LEGACY_CANVAS_THEME}
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

    const frame = container.querySelector("[data-module-instance-selection-frame='instance']");
    const rect = frame?.querySelector("rect");
    const label = container.querySelector("[data-module-instance-selection-label='instance']");
    expect(frame).toHaveStyle({ pointerEvents: "none" });
    expect(rect).toHaveAttribute("stroke", "var(--canvas-selection)");
    expect(rect).toHaveStyle({ pointerEvents: "none" });
    expect(label).toHaveTextContent("InstanceOne");
    expect(label).toHaveAttribute("fill", "var(--canvas-selection)");
  });
});
