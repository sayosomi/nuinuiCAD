import { useMemo } from "react";
import type { CanvasViewport } from "../state/useCadStore";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  ElementId,
  EvaluationResult
} from "../types/geometry";
import { effectiveVisibleElementIds } from "../model/groups";
import {
  lineEndpointReferenceForAnchor,
  selectablePointsForGeometry
} from "../model/pointAnchors";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import type { ActivePointPickTarget } from "../state/useCadStore";
import {
  sampleArcLineScreenPoints,
  sampleBezierCurveScreenPoints,
  sampleOffsetLineScreenPoints
} from "./DrawingCanvasHitTest";
import { type ViewportSize, worldToScreen } from "./canvasViewport";
import type { BezierHandleOverlay, CanvasOverlayData } from "./DrawingCanvasTypes";

const isPoint = (geometry: unknown): geometry is ComputedPoint =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "point";

const isLine = (geometry: unknown): geometry is ComputedLine =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "line";

const isArcLine = (geometry: unknown): geometry is ComputedArcLine =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "arcLine";

const isBezierCurve = (geometry: unknown): geometry is ComputedBezierCurve =>
  typeof geometry === "object" &&
  geometry !== null &&
  "kind" in geometry &&
  geometry.kind === "bezierCurve";

const isOffsetLine = (geometry: unknown): geometry is ComputedOffsetLine =>
  typeof geometry === "object" &&
  geometry !== null &&
  "kind" in geometry &&
  geometry.kind === "offsetLine";

export const useCanvasOverlayData = ({
  evaluation,
  elements,
  selectedElementId,
  activePointPickTarget,
  viewportSize,
  canvasViewport
}: {
  evaluation: EvaluationResult;
  elements: CadElement[];
  selectedElementId: ElementId | null;
  activePointPickTarget: ActivePointPickTarget | null;
  viewportSize: ViewportSize;
  canvasViewport: CanvasViewport;
}): CanvasOverlayData => {
  const visibleElementIds = useMemo(
    () => evaluation.effectiveVisibleElementIds ?? effectiveVisibleElementIds(elements),
    [elements, evaluation.effectiveVisibleElementIds]
  );
  const geometries = useMemo(
    () => Array.from(evaluation.computedGeometry.values()),
    [evaluation.computedGeometry]
  );
  const lines = useMemo(() => geometries.filter(isLine), [geometries]);
  const arcs = useMemo(() => geometries.filter(isArcLine), [geometries]);
  const curves = useMemo(() => geometries.filter(isBezierCurve), [geometries]);
  const offsetLines = useMemo(() => geometries.filter(isOffsetLine), [geometries]);
  const points = useMemo(() => geometries.filter(isPoint), [geometries]);
  const activePointPickTargetElement = activePointPickTarget
    ? elements.find((element) => element.id === activePointPickTarget.elementId)
    : null;
  const activePointPickTargetDefinition = activePointPickTargetElement && activePointPickTarget
    ? findParameterDefinition(activePointPickTargetElement, activePointPickTarget.parameterKey)
    : null;
  const isLineEndpointPointPick =
    activePointPickTargetDefinition?.kind === "lineEndpointReference";
  const overlayLines = useMemo(
    () =>
      lines
        .filter((line) => visibleElementIds.has(line.elementId))
        .map((line) => ({
          line,
          start: worldToScreen(line.start, viewportSize, canvasViewport),
          end: worldToScreen(line.end, viewportSize, canvasViewport)
        })),
    [canvasViewport, lines, viewportSize, visibleElementIds]
  );
  const overlayPoints = useMemo(
    () =>
      points
        .filter((point) => visibleElementIds.has(point.elementId))
        .map((point) => ({
          point,
          screen: worldToScreen(point, viewportSize, canvasViewport)
        })),
    [canvasViewport, points, viewportSize, visibleElementIds]
  );
  const overlayArcs = useMemo(
    () =>
      arcs
        .filter((arc) => visibleElementIds.has(arc.elementId))
        .map((arc) => ({
          arc,
          start: worldToScreen(arc.start, viewportSize, canvasViewport),
          end: worldToScreen(arc.end, viewportSize, canvasViewport),
          points: sampleArcLineScreenPoints(arc, (point) =>
            worldToScreen(point, viewportSize, canvasViewport)
          )
        })),
    [arcs, canvasViewport, viewportSize, visibleElementIds]
  );
  const overlayCurves = useMemo(
    () =>
      curves
        .filter((curve) => visibleElementIds.has(curve.elementId))
        .map((curve) => ({
          curve,
          points: sampleBezierCurveScreenPoints(curve, (point) =>
            worldToScreen(point, viewportSize, canvasViewport)
          )
        })),
    [canvasViewport, curves, viewportSize, visibleElementIds]
  );
  const overlayOffsetLines = useMemo(
    () =>
      offsetLines
        .filter((line) => visibleElementIds.has(line.elementId))
        .map((line) => ({
          line,
          points: sampleOffsetLineScreenPoints(line, (point) =>
            worldToScreen(point, viewportSize, canvasViewport)
          )
        })),
    [canvasViewport, offsetLines, viewportSize, visibleElementIds]
  );
  const overlayPointPickCandidates = useMemo(() => {
    const elementsById = new Map(elements.map((element) => [element.id, element]));
    return geometries
      .filter((geometry) => visibleElementIds.has(geometry.elementId))
      .flatMap((geometry) =>
        selectablePointsForGeometry(geometry, elementsById)
          .filter((candidate) =>
            !isLineEndpointPointPick ||
            lineEndpointReferenceForAnchor(candidate.anchor, elements)
          )
          .map((candidate) => ({
            anchor: candidate.anchor,
            label: candidate.label,
            screen: worldToScreen(candidate.point, viewportSize, canvasViewport)
          }))
      );
  }, [
    canvasViewport,
    elements,
    geometries,
    isLineEndpointPointPick,
    viewportSize,
    visibleElementIds
  ]);
  const overlayNumericReferenceCandidates = useMemo(
    () => [
      ...overlayLines.map(({ line, start, end }) => ({ line, start, end })),
      ...overlayArcs.map(({ arc, start, end, points }) => ({ line: arc, start, end, points })),
      ...overlayCurves.map(({ curve, points }) => ({ line: curve, points })),
      ...overlayOffsetLines.map(({ line, points }) => ({ line, points }))
    ],
    [overlayArcs, overlayCurves, overlayLines, overlayOffsetLines]
  );
  const selectedBezierHandles = useMemo(() => {
    const curveElement = elements.find((element) => element.id === selectedElementId);
    if (!curveElement || curveElement.type !== "bezierCurve" || !visibleElementIds.has(curveElement.id)) {
      return [];
    }

    const curve = curves.find((item) => item.elementId === curveElement.id);
    if (!curve || curve.segments.length === 0) return [];

    const handles: BezierHandleOverlay[] = [];
    const firstSegment = curve.segments[0];
    handles.push({
      id: `${curve.elementId}:start`,
      curveId: curve.elementId,
      role: "start",
      anchor: worldToScreen(firstSegment.start, viewportSize, canvasViewport),
      control: worldToScreen(firstSegment.control1, viewportSize, canvasViewport)
    });

    curveElement.intermediatePoints.forEach((point, index) => {
      const incomingSegment = curve.segments[index];
      const outgoingSegment = curve.segments[index + 1];
      if (incomingSegment) {
        handles.push({
          id: `${curve.elementId}:${point.id}:incoming`,
          curveId: curve.elementId,
          role: "intermediateIncoming",
          intermediatePointId: point.id,
          anchor: worldToScreen(incomingSegment.end, viewportSize, canvasViewport),
          control: worldToScreen(incomingSegment.control2, viewportSize, canvasViewport)
        });
      }
      if (outgoingSegment) {
        handles.push({
          id: `${curve.elementId}:${point.id}:outgoing`,
          curveId: curve.elementId,
          role: "intermediateOutgoing",
          intermediatePointId: point.id,
          anchor: worldToScreen(outgoingSegment.start, viewportSize, canvasViewport),
          control: worldToScreen(outgoingSegment.control1, viewportSize, canvasViewport)
        });
      }
    });

    const lastSegment = curve.segments.at(-1);
    if (lastSegment) {
      handles.push({
        id: `${curve.elementId}:end`,
        curveId: curve.elementId,
        role: "end",
        anchor: worldToScreen(lastSegment.end, viewportSize, canvasViewport),
        control: worldToScreen(lastSegment.control2, viewportSize, canvasViewport)
      });
    }

    return handles;
  }, [canvasViewport, curves, elements, selectedElementId, viewportSize, visibleElementIds]);

  return {
    lines,
    arcs,
    curves,
    offsetLines,
    points,
    visibleElementIds,
    overlayLines,
    overlayPoints,
    overlayArcs,
    overlayCurves,
    overlayOffsetLines,
    overlayPointPickCandidates,
    overlayNumericReferenceCandidates,
    selectedBezierHandles,
    isLineEndpointPointPick
  };
};
