import type { ElementId } from "../types/geometry";
import type { ViewportSize } from "./canvasViewport";
import type {
  BezierHandleOverlay,
  CanvasOverlayArc,
  CanvasOverlayCurve,
  CanvasOverlayLine,
  CanvasOverlayPoint,
  PointPickCandidate
} from "./DrawingCanvasTypes";

type CanvasOverlayProps = {
  viewportSize: ViewportSize;
  overlayLines: CanvasOverlayLine[];
  overlayArcs: CanvasOverlayArc[];
  overlayCurves: CanvasOverlayCurve[];
  overlayPoints: CanvasOverlayPoint[];
  selectedBezierHandles: BezierHandleOverlay[];
  overlayPointPickCandidates: PointPickCandidate[];
  selectedElementIdSet: Set<ElementId>;
  selectedElementId: ElementId | null;
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
};

export const CanvasOverlay = ({
  viewportSize,
  overlayLines,
  overlayArcs,
  overlayCurves,
  overlayPoints,
  selectedBezierHandles,
  overlayPointPickCandidates,
  selectedElementIdSet,
  selectedElementId,
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive
}: CanvasOverlayProps) => (
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
        data-numeric-reference-candidate={isNumericReferencePickActive ? "true" : undefined}
        data-line-pick-candidate={isLinePickActive ? "true" : undefined}
      />
    ))}
    {overlayCurves.map(({ curve, points }) => (
      <polyline
        key={curve.elementId}
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        className={selectedElementIdSet.has(curve.elementId) ? "overlay-selected-line" : ""}
        data-numeric-reference-candidate={isNumericReferencePickActive ? "true" : undefined}
        data-line-pick-candidate={isLinePickActive ? "true" : undefined}
      />
    ))}
    {overlayArcs.map(({ arc, points }) => (
      <polyline
        key={arc.elementId}
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        className={selectedElementIdSet.has(arc.elementId) ? "overlay-selected-line" : ""}
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
    {overlayPoints.map(({ point, screen }) => (
      <g key={point.elementId}>
        <circle
          cx={screen.x}
          cy={screen.y}
          r={point.elementId === selectedElementId ? 8 : selectedElementIdSet.has(point.elementId) ? 7 : 6}
          className={`overlay-draggable-point ${
            selectedElementIdSet.has(point.elementId) ? "overlay-selected-point" : ""
          } ${isPointPickActive ? "overlay-point-pick-candidate" : ""}`}
        />
        <text x={screen.x + 8} y={screen.y - 8}>
          {point.name}
        </text>
      </g>
    ))}
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
