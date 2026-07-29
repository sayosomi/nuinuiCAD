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
  CanvasOverlayText,
  PointPickCandidate
} from "./DrawingCanvasTypes";

type CanvasOverlayProps = {
  viewportSize: ViewportSize;
  overlayLines: CanvasOverlayLine[];
  overlayArcs: CanvasOverlayArc[];
  overlayCurves: CanvasOverlayCurve[];
  overlayOffsetLines: CanvasOverlayOffsetLine[];
  overlayPoints: CanvasOverlayPoint[];
  overlayTexts: CanvasOverlayText[];
  selectedBezierHandles: BezierHandleOverlay[];
  overlayPointPickCandidates: PointPickCandidate[];
  selectedElementIdSet: Set<ElementId>;
  draftLinePickElementIds: Set<ElementId>;
  /** Overlay lines that the active line/numeric pick would actually accept. */
  pickCandidateLineIds: Set<ElementId>;
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
  overlayTexts,
  selectedBezierHandles,
  overlayPointPickCandidates,
  selectedElementIdSet,
  draftLinePickElementIds,
  pickCandidateLineIds,
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
  const lineOverlayClass = (elementId: ElementId) =>
    [
      selectedElementIdSet.has(elementId) ? "overlay-selected-line" : "",
      draftLinePickElementIds.has(elementId) ? "overlay-draft-line-pick" : ""
    ].filter(Boolean).join(" ");
  const draftLinePickMarker = (
    elementId: ElementId,
    center: { x: number; y: number }
  ) =>
    draftLinePickElementIds.has(elementId) ? (
      <g className="overlay-draft-line-pick-marker">
        <circle cx={center.x} cy={center.y} r={9} />
        <path d={`M ${center.x - 4} ${center.y} L ${center.x - 1} ${center.y + 3} L ${center.x + 5} ${center.y - 4}`} />
      </g>
    ) : null;
  const centerOf = (points: readonly { x: number; y: number }[]) =>
    points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
  const pickCandidateAttributes = (elementId: ElementId) => ({
    "data-numeric-reference-candidate":
      isNumericReferencePickActive && pickCandidateLineIds.has(elementId) ? "true" : undefined,
    "data-line-pick-candidate":
      isLinePickActive && pickCandidateLineIds.has(elementId) ? "true" : undefined
  });

  return (
  <svg
    className="drawing-overlay"
    viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
    aria-hidden="true"
  >
    {overlayLines.map(({ line, start, end }) => (
      <g key={line.elementId}>
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          className={lineOverlayClass(line.elementId)}
          style={selectedElementIdSet.has(line.elementId) ? selectedLineStyle(line.elementId) : undefined}
          {...pickCandidateAttributes(line.elementId)}
        />
        {draftLinePickMarker(line.elementId, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 })}
      </g>
    ))}
    {overlayCurves.map(({ curve, points }) => (
      <g key={curve.elementId}>
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          className={lineOverlayClass(curve.elementId)}
          style={selectedElementIdSet.has(curve.elementId) ? selectedLineStyle(curve.elementId) : undefined}
          {...pickCandidateAttributes(curve.elementId)}
        />
        {draftLinePickMarker(curve.elementId, centerOf(points))}
      </g>
    ))}
    {overlayArcs.map(({ arc, points }) => (
      <g key={arc.elementId}>
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          className={lineOverlayClass(arc.elementId)}
          style={selectedElementIdSet.has(arc.elementId) ? selectedLineStyle(arc.elementId) : undefined}
          {...pickCandidateAttributes(arc.elementId)}
        />
        {draftLinePickMarker(arc.elementId, centerOf(points))}
      </g>
    ))}
    {overlayOffsetLines.map(({ line, points }) => (
      <g key={line.elementId}>
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          className={lineOverlayClass(line.elementId)}
          style={selectedElementIdSet.has(line.elementId) ? selectedLineStyle(line.elementId) : undefined}
          {...pickCandidateAttributes(line.elementId)}
        />
        {draftLinePickMarker(line.elementId, centerOf(points))}
      </g>
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
    {overlayTexts.map(({ text, screen, fontSizePx }) => {
      const lines = text.text.split(/\r?\n/);
      const isSelected = selectedElementIdSet.has(text.elementId);
      const fill = elementColors.get(text.elementId) ?? "#31322f";
      return (
        <text
          key={text.elementId}
          x={screen.x}
          y={screen.y}
          className={isSelected ? "overlay-selected-text" : "overlay-text"}
          fill={fill}
          style={{ fontSize: fontSizePx }}
          dominantBaseline="text-before-edge"
        >
          {lines.map((line, index) => (
            <tspan key={index} x={screen.x} dy={index === 0 ? 0 : fontSizePx * 1.2}>
              {line}
            </tspan>
          ))}
        </text>
      );
    })}
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
                }`}
                style={isSelected ? selectedPointStyle(point.elementId) : undefined}
              />
            </>
          ) : null}
          {showCanvasElementNames ? (
            <text className="overlay-element-name" x={screen.x + 8} y={screen.y - 8}>
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
