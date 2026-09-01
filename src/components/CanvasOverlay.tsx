import type { DrawingModifierStroke, ElementId } from "../types/geometry";
import type { ViewportSize } from "./canvasViewport";
import type { ModuleInstanceSelectionFrameOverlay } from "./moduleInstanceSelectionFrame";
import {
  canvasThemeColorForRole,
  canvasThemeCssVariables,
  type CanvasTheme
} from "./canvasTheme";
import type {
  CanvasRectangleMembershipMode,
  ScreenSelectionRectangle
} from "./canvasRectangleSelection";
import type {
  BezierEditingHelperOverlay,
  BezierHandleOverlay,
  CanvasOverlayArc,
  CanvasOverlayCurve,
  CanvasIdentityCandidate,
  CanvasOverlayLine,
  CanvasOverlayOffsetLine,
  CanvasOverlayPoint,
  CanvasOverlayText,
  PointPickCandidate
} from "./DrawingCanvasTypes";

type CanvasOverlayProps = {
  viewportSize: ViewportSize;
  moduleInstanceSelectionFrames?: readonly ModuleInstanceSelectionFrameOverlay[];
  overlayLines: CanvasOverlayLine[];
  overlayArcs: CanvasOverlayArc[];
  overlayCurves: CanvasOverlayCurve[];
  overlayOffsetLines: CanvasOverlayOffsetLine[];
  rectangleSelection?: {
    rectangle: ScreenSelectionRectangle;
    mode: CanvasRectangleMembershipMode;
  } | null;
  overlayPoints: CanvasOverlayPoint[];
  overlayTexts: CanvasOverlayText[];
  overlayIdentityCandidates?: CanvasIdentityCandidate[];
  selectedBezierEditingHelper: BezierEditingHelperOverlay | null;
  selectedBezierHandles: BezierHandleOverlay[];
  overlayPointPickCandidates: PointPickCandidate[];
  selectedElementIdSet: Set<ElementId>;
  draftLinePickElementIds: Set<ElementId>;
  /** Overlay lines that the active line/numeric pick would actually accept. */
  pickCandidateLineIds: Set<ElementId>;
  selectedElementId: ElementId | null;
  canvasTheme: CanvasTheme;
  effectiveDrawingModifierStrokes?: ReadonlyMap<ElementId, DrawingModifierStroke>;
  showCanvasPointNames: boolean;
  showCanvasGeometryNames: boolean;
  showCanvasPoints: boolean;
  isPointPickActive: boolean;
  isNumericReferencePickActive: boolean;
  isLinePickActive: boolean;
  hoveredElementIds: ReadonlySet<ElementId>;
  hoverRepresentativeElementId: ElementId | null;
};

const drawingModifierColor = (stroke: DrawingModifierStroke, canvasTheme: CanvasTheme) =>
  stroke.color.kind === "fixed"
    ? stroke.color.hex
    : canvasThemeColorForRole(canvasTheme, stroke.color.role);

export const CanvasOverlay = ({
  viewportSize,
  moduleInstanceSelectionFrames = [],
  overlayLines,
  overlayArcs,
  overlayCurves,
  overlayOffsetLines,
  rectangleSelection = null,
  overlayPoints,
  overlayTexts,
  overlayIdentityCandidates = [],
  selectedBezierEditingHelper,
  selectedBezierHandles,
  overlayPointPickCandidates,
  selectedElementIdSet,
  draftLinePickElementIds,
  pickCandidateLineIds,
  selectedElementId,
  canvasTheme,
  effectiveDrawingModifierStrokes,
  showCanvasPointNames,
  showCanvasGeometryNames,
  showCanvasPoints,
  isPointPickActive,
  isNumericReferencePickActive,
  isLinePickActive,
  hoveredElementIds,
  hoverRepresentativeElementId
}: CanvasOverlayProps) => {
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
  const pointNamesEnabled = showCanvasPointNames;
  const geometryNamesEnabled = showCanvasGeometryNames;
  const identityCandidatesById = new Map<ElementId, CanvasIdentityCandidate>();
  for (const candidate of overlayIdentityCandidates) {
    if (!candidate.name || !candidate.name.trim() || identityCandidatesById.has(candidate.elementId)) continue;
    const persistent = candidate.kind === "point" ? pointNamesEnabled : geometryNamesEnabled;
    const isPrimarySelected = candidate.elementId === selectedElementId;
    if (persistent || isPrimarySelected || candidate.elementId === hoverRepresentativeElementId) {
      identityCandidatesById.set(candidate.elementId, candidate);
    }
  }

  return (
  <svg
    className="drawing-overlay"
    style={canvasThemeCssVariables(canvasTheme)}
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
          {...pickCandidateAttributes(line.elementId)}
        />
        {draftLinePickMarker(line.elementId, centerOf(points))}
      </g>
    ))}
    {moduleInstanceSelectionFrames.map((frame) => (
      <g
        key={`module-instance-frame-${frame.instanceId}`}
        data-module-instance-selection-frame={frame.instanceId}
        style={{ pointerEvents: "none" }}
      >
        <rect
          x={frame.left}
          y={frame.top}
          width={frame.width}
          height={frame.height}
          fill="none"
          stroke="var(--canvas-selection-outline)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "none" }}
        />
        <text
          x={frame.left + 2}
          y={Math.max(12, frame.top - 4)}
          data-module-instance-selection-label={frame.instanceId}
          fill="var(--canvas-selection)"
          style={{ fontSize: 12, fontWeight: 700, pointerEvents: "none" }}
        >
          {frame.name}
        </text>
      </g>
    ))}
    {selectedBezierEditingHelper ? (
      <polyline
        points={selectedBezierEditingHelper.points.map((point) => `${point.x},${point.y}`).join(" ")}
        className="overlay-bezier-editing-helper"
      />
    ) : null}
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
      const modifierStroke = effectiveDrawingModifierStrokes?.get(text.elementId);
      const documentColor = modifierStroke
        ? drawingModifierColor(modifierStroke, canvasTheme)
        : canvasTheme.foreground;
      const fill = isSelected ? canvasTheme.selection : documentColor;
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
                />
              ) : null}
              <circle
                cx={screen.x}
                cy={screen.y}
                r={isPrimarySelected ? 3.5 : isSelected ? 3.25 : 6}
                className={`overlay-draggable-point ${
                  isSelected ? "overlay-selected-point" : ""
                }`}
              />
            </>
          ) : null}
        </g>
      );
    })}
    {[...identityCandidatesById.values()].map((candidate) => (
      <text
        key={`identity-${candidate.elementId}`}
        className={[
          "overlay-element-identity",
          candidate.elementId === selectedElementId ? "overlay-element-identity-primary-selected" : "",
          hoveredElementIds.has(candidate.elementId) ? "overlay-element-identity-hovered" : ""
        ].filter(Boolean).join(" ")}
        data-element-identity={candidate.elementId}
        x={candidate.representativeScreen.x + 8}
        y={candidate.representativeScreen.y - 8}
        fill="var(--canvas-foreground)"
        style={{ fontSize: 12, pointerEvents: "none" }}
      >
        {candidate.name}
      </text>
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
    {rectangleSelection ? (
      <rect
        className="canvas-rectangle-selection"
        data-canvas-rectangle-selection={rectangleSelection.mode}
        x={rectangleSelection.rectangle.left}
        y={rectangleSelection.rectangle.top}
        width={rectangleSelection.rectangle.right - rectangleSelection.rectangle.left}
        height={rectangleSelection.rectangle.bottom - rectangleSelection.rectangle.top}
        fill="var(--canvas-selection)"
        fillOpacity={0.12}
        stroke="var(--canvas-selection)"
        strokeWidth={1.5}
        strokeDasharray={rectangleSelection.mode === "crossing" ? "6 4" : undefined}
        vectorEffect="non-scaling-stroke"
        style={{ pointerEvents: "none" }}
      />
    ) : null}
  </svg>
  );
};
