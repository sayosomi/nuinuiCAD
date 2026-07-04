import type { CSSProperties } from "react";
import type { ElementId } from "../types/geometry";
import type { ViewportSize } from "./canvasViewport";
import type {
  BezierHandleOverlay,
  CanvasOverlayArc,
  CanvasOverlayCurve,
  CanvasOverlayLine,
  CanvasOverlayOffsetLine,
  CanvasOverlayPoint,
  PointPickCandidate
} from "./DrawingCanvasTypes";

type CanvasOverlayProps = {
  viewportSize: ViewportSize;
  overlayLines: CanvasOverlayLine[];
  overlayArcs: CanvasOverlayArc[];
  overlayCurves: CanvasOverlayCurve[];
  overlayOffsetLines: CanvasOverlayOffsetLine[];
  overlayPoints: CanvasOverlayPoint[];
  selectedBezierHandles: BezierHandleOverlay[];
  overlayPointPickCandidates: PointPickCandidate[];
  selectedElementIdSet: Set<ElementId>;
  selectedElementId: ElementId | null;
  elementColors: Map<ElementId, string>;
  showCanvasElementNames: boolean;
  showCanvasPoints: boolean;
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
};

export const CanvasOverlay = ({
  viewportSize,
  overlayLines,
  overlayArcs,
  overlayCurves,
  overlayOffsetLines,
  overlayPoints,
  selectedBezierHandles,
  overlayPointPickCandidates,
  selectedElementIdSet,
  selectedElementId,
  elementColors,
  showCanvasElementNames,
  showCanvasPoints,
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive
}: CanvasOverlayProps) => {
  const transparentElementColor = (elementId: ElementId, alpha: number) => {
    const color = elementColors.get(elementId) ?? "#31322f";
    const match = /^#([0-9a-fA-F]{6})$/.exec(color);
    if (!match) return color;
    const hex = match[1];
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgb(${red} ${green} ${blue} / ${alpha})`;
  };
  const selectedLineStyle = (elementId: ElementId): CSSProperties | undefined =>
    isNumericReferencePickActive || isLinePickActive
      ? undefined
      : { stroke: transparentElementColor(elementId, 0.3) };
  const selectedPointStyle = (elementId: ElementId): CSSProperties | undefined =>
    isPointPickActive
      ? undefined
      : {
          fill: "transparent",
          stroke: transparentElementColor(elementId, 0.8)
        };
  const selectedPointGlowStyle = (
    elementId: ElementId,
    isPrimarySelected: boolean
  ): CSSProperties | undefined =>
    isPointPickActive
      ? undefined
      : {
          stroke: transparentElementColor(elementId, isPrimarySelected ? 0.34 : 0.24),
          filter: `drop-shadow(0 0 ${isPrimarySelected ? 4 : 3}px ${transparentElementColor(
            elementId,
            isPrimarySelected ? 0.55 : 0.38
          )})`
        };

  return (
  <svg
    className="drawing-overlay"
    viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
    aria-hidden="true"
  >
    {overlayLines.map(({ line, start, end }) => (
      <line
        key={line.elementId}
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        className={selectedElementIdSet.has(line.elementId) ? "overlay-selected-line" : ""}
        style={selectedElementIdSet.has(line.elementId) ? selectedLineStyle(line.elementId) : undefined}
        data-numeric-reference-candidate={isNumericReferencePickActive ? "true" : undefined}
        data-line-pick-candidate={isLinePickActive ? "true" : undefined}
      />
    ))}
    {overlayCurves.map(({ curve, points }) => (
      <polyline
        key={curve.elementId}
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        className={selectedElementIdSet.has(curve.elementId) ? "overlay-selected-line" : ""}
        style={selectedElementIdSet.has(curve.elementId) ? selectedLineStyle(curve.elementId) : undefined}
        data-numeric-reference-candidate={isNumericReferencePickActive ? "true" : undefined}
        data-line-pick-candidate={isLinePickActive ? "true" : undefined}
      />
    ))}
    {overlayArcs.map(({ arc, points }) => (
      <polyline
        key={arc.elementId}
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        className={selectedElementIdSet.has(arc.elementId) ? "overlay-selected-line" : ""}
        style={selectedElementIdSet.has(arc.elementId) ? selectedLineStyle(arc.elementId) : undefined}
        data-numeric-reference-candidate={isNumericReferencePickActive ? "true" : undefined}
        data-line-pick-candidate={isLinePickActive ? "true" : undefined}
      />
    ))}
    {overlayOffsetLines.map(({ line, points }) => (
      <polyline
        key={line.elementId}
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        className={selectedElementIdSet.has(line.elementId) ? "overlay-selected-line" : ""}
        style={selectedElementIdSet.has(line.elementId) ? selectedLineStyle(line.elementId) : undefined}
        data-numeric-reference-candidate={isNumericReferencePickActive ? "true" : undefined}
        data-line-pick-candidate={isLinePickActive ? "true" : undefined}
      />
    ))}
    {selectedBezierHandles.map((handle) => (
      <g key={handle.id} className="overlay-bezier-handle">
        <line
          x1={handle.anchor.x}
          y1={handle.anchor.y}
          x2={handle.control.x}
          y2={handle.control.y}
          className="overlay-bezier-handle-line"
        />
        <circle
          cx={handle.control.x}
          cy={handle.control.y}
          r={5}
          className="overlay-bezier-handle-point"
        />
      </g>
    ))}
    {overlayPoints.map(({ point, screen }) => {
      const isSelected = selectedElementIdSet.has(point.elementId);
      const isPrimarySelected = point.elementId === selectedElementId;
      const shouldShowPoint = showCanvasPoints || isSelected || isPointPickActive;
      return (
        <g key={point.elementId}>
          {shouldShowPoint ? (
            <>
              {isSelected && !isPointPickActive ? (
                <circle
                  cx={screen.x}
                  cy={screen.y}
                  r={isPrimarySelected ? 9 : 7.5}
                  className="overlay-selected-point-glow"
                  style={selectedPointGlowStyle(point.elementId, isPrimarySelected)}
                />
              ) : null}
              <circle
                cx={screen.x}
                cy={screen.y}
                r={isPrimarySelected ? 3.5 : isSelected ? 3.25 : 6}
                className={`overlay-draggable-point ${
                  isSelected ? "overlay-selected-point" : ""
                } ${isPointPickActive ? "overlay-point-pick-candidate" : ""}`}
                style={isSelected ? selectedPointStyle(point.elementId) : undefined}
              />
            </>
          ) : null}
          {showCanvasElementNames ? (
            <text x={screen.x + 8} y={screen.y - 8}>
              {point.name}
            </text>
          ) : null}
        </g>
      );
    })}
    {isPointPickActive
      ? overlayPointPickCandidates.map((candidate, index) => (
          <circle
            key={`${candidate.label}-${index}`}
            cx={candidate.screen.x}
            cy={candidate.screen.y}
            r={7}
            className="overlay-derived-point-pick-candidate"
          />
        ))
      : null}
  </svg>
  );
};
