import { useMemo } from "react";
import type { CanvasViewport } from "../state/cadUiStore";
import { runtimeOnlyElementTypes } from "../types/geometry";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedImage,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPolyline,
  ComputedPoint,
  ComputedText,
  ElementId,
  EvaluationResult
} from "../types/geometry";
import type { VisibilityProfile } from "../types/geometry";
import {
  canvasPresentationEligibleElementIds,
  effectiveCanvasVisibleElementIds
} from "../geometry/canvasDrawingBounds";
import { imageWorldCorners } from "../geometry/imageGeometry";
import {
  selectablePointsForGeometry
} from "../model/pointAnchors";
import {
  type PickCandidate
} from "../model/pickCandidates";
import { pickRefForOption, pickRefKey } from "../model/pickReferences";
import {
  averageScreenPoints,
  sampleArcLineScreenPoints,
  sampleBezierCurveScreenPoints,
  sampleOffsetLineScreenPoints,
  samplePolylineScreenPoints,
  screenSpaceCumulativeLengthMidpoint,
  textHitBounds
} from "./DrawingCanvasHitTest";
import { type ViewportSize, worldToScreen } from "./canvasViewport";
import type {
  BezierEditingHelperOverlay,
  BezierHandleOverlay,
  CanvasIdentityCandidate,
  CanvasOverlayData
} from "./DrawingCanvasTypes";

const normalizedIdentityName = (name: string | null | undefined): string | null => {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
};

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

const isPolyline = (geometry: unknown): geometry is ComputedPolyline =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "polyline";

const isImage = (geometry: unknown): geometry is ComputedImage =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "image";

const isText = (geometry: unknown): geometry is ComputedText =>
  typeof geometry === "object" && geometry !== null && "kind" in geometry && geometry.kind === "text";

export const useCanvasOverlayData = ({
  evaluation,
  elements,
  selectedElementId,
  pointPickCandidates,
  excludedInteractionElementIds,
  viewportSize,
  canvasViewport,
  visibilityProfiles,
  activeVisibilityProfileId,
  showCanvasPoints = true,
  resolveImageSourceUrl
}: {
  evaluation: EvaluationResult;
  elements: CadElement[];
  selectedElementId: ElementId | null;
  pointPickCandidates: readonly PickCandidate[];
  excludedInteractionElementIds?: ReadonlySet<ElementId>;
  viewportSize: ViewportSize;
  canvasViewport: CanvasViewport;
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string | null;
  showCanvasPoints?: boolean;
  resolveImageSourceUrl: (sourcePath: string) => string;
}): CanvasOverlayData => {
  const visibleElementIds = useMemo(
    () => {
      return effectiveCanvasVisibleElementIds({
        elements,
        evaluation,
        visibilityProfiles,
        activeVisibilityProfileId
      });
    },
    [
      activeVisibilityProfileId,
      elements,
      evaluation,
      visibilityProfiles
    ]
  );
  const selectionEligibleElementIds = useMemo(
    () => canvasPresentationEligibleElementIds({
      elements,
      evaluation,
      visibilityProfiles,
      activeVisibilityProfileId,
      showCanvasPoints
    }),
    [
      activeVisibilityProfileId,
      elements,
      evaluation,
      showCanvasPoints,
      visibilityProfiles
    ]
  );
  const geometries = useMemo(
    () => {
      const elementById = new Map(elements.map((element) => [element.id, element]));
      return Array.from(evaluation.computedGeometry.values()).filter((geometry) => {
        const element = elementById.get(geometry.elementId);
        return !element || !runtimeOnlyElementTypes.has(element.type);
      });
    },
    [elements, evaluation.computedGeometry]
  );
  const lines = useMemo(() => geometries.filter(isLine), [geometries]);
  const arcs = useMemo(() => geometries.filter(isArcLine), [geometries]);
  const curves = useMemo(() => geometries.filter(isBezierCurve), [geometries]);
  const offsetLines = useMemo(() => geometries.filter(isOffsetLine), [geometries]);
  const polylines = useMemo(() => geometries.filter(isPolyline), [geometries]);
  const images = useMemo(() => geometries.filter(isImage), [geometries]);
  const texts = useMemo(() => geometries.filter(isText), [geometries]);
  const points = useMemo(() => geometries.filter(isPoint), [geometries]);
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
  const overlayPolylines = useMemo(
    () =>
      polylines
        .filter((polyline) => visibleElementIds.has(polyline.elementId))
        .map((polyline) => ({
          polyline,
          points: samplePolylineScreenPoints(polyline, (point) =>
            worldToScreen(point, viewportSize, canvasViewport)
          )
        })),
    [canvasViewport, polylines, viewportSize, visibleElementIds]
  );
  const overlayImages = useMemo(
    () =>
      images
        .filter((image) => visibleElementIds.has(image.elementId))
        .map((image) => ({
          image,
          sourceUrl: resolveImageSourceUrl(image.sourcePath),
          corners: imageWorldCorners(image).map((point) =>
            worldToScreen(point, viewportSize, canvasViewport)
          )
        })),
    [canvasViewport, images, resolveImageSourceUrl, viewportSize, visibleElementIds]
  );
  const overlayTexts = useMemo(
    () =>
      texts
        .filter((text) => visibleElementIds.has(text.elementId) && text.anchor)
        .map((text) => ({
          text,
          screen: worldToScreen(text.anchor!, viewportSize, canvasViewport),
          fontSizePx: text.fontSize * canvasViewport.zoom
        })),
    [canvasViewport, texts, viewportSize, visibleElementIds]
  );
  const overlayIdentityCandidates = useMemo<CanvasIdentityCandidate[]>(
    () => [
      ...overlayImages.map(({ image, corners }) => ({
        elementId: image.elementId,
        name: normalizedIdentityName(image.name),
        kind: "image" as const,
        representativeScreen: averageScreenPoints(corners)
      })),
      ...overlayLines.map(({ line, start, end }) => ({
        elementId: line.elementId,
        name: normalizedIdentityName(line.name),
        kind: "line" as const,
        representativeScreen: screenSpaceCumulativeLengthMidpoint([start, end], start)
      })),
      ...overlayArcs.map(({ arc, points, start }) => ({
        elementId: arc.elementId,
        name: normalizedIdentityName(arc.name),
        kind: "arcLine" as const,
        representativeScreen: screenSpaceCumulativeLengthMidpoint(points, start)
      })),
      ...overlayCurves.map(({ curve, points }) => ({
        elementId: curve.elementId,
        name: normalizedIdentityName(curve.name),
        kind: "bezierCurve" as const,
        representativeScreen: screenSpaceCumulativeLengthMidpoint(points, points[0])
      })),
      ...overlayOffsetLines.map(({ line, points }) => ({
        elementId: line.elementId,
        name: normalizedIdentityName(line.name),
        kind: "offsetLine" as const,
        representativeScreen: screenSpaceCumulativeLengthMidpoint(points, points[0])
      })),
      ...overlayPolylines.map(({ polyline, points }) => ({
        elementId: polyline.elementId,
        name: normalizedIdentityName(polyline.name),
        kind: "polyline" as const,
        representativeScreen: screenSpaceCumulativeLengthMidpoint(points, points[0])
      })),
      ...overlayTexts.map(({ text, screen, fontSizePx }) => {
        const bounds = textHitBounds({ text: text.text, screen, fontSizePx });
        return {
          elementId: text.elementId,
          name: normalizedIdentityName(text.name),
          kind: "text" as const,
          representativeScreen: {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2
          }
        };
      }),
      ...overlayPoints.map(({ point, screen }) => ({
        elementId: point.elementId,
        name: normalizedIdentityName(point.name),
        kind: "point" as const,
        representativeScreen: screen
      }))
    ],
    [overlayArcs, overlayCurves, overlayImages, overlayLines, overlayOffsetLines, overlayPoints, overlayPolylines, overlayTexts]
  );
  const overlayPointPickCandidates = useMemo(() => {
    const elementsById = new Map(elements.map((element) => [element.id, element]));
    const acceptedPickRefs = new Set(pointPickCandidates.flatMap((candidate) =>
      candidate.options.flatMap((option) =>
        option.kind === "point" && option.anchor.mode !== "coordinate"
          ? [pickRefKey(pickRefForOption(candidate.elementId, option))]
          : []
      )
    ));
    const sourceReferenceByPickRef = new Map(pointPickCandidates.flatMap((candidate) =>
      candidate.options.flatMap((option) =>
        option.kind === "point" && option.anchor.mode !== "coordinate" && option.sourceReference
          ? [[pickRefKey(pickRefForOption(candidate.elementId, option)), option.sourceReference] as const]
          : []
      )
    ));
    return geometries
      .filter((geometry) => !excludedInteractionElementIds?.has(geometry.elementId))
      .filter((geometry) => visibleElementIds.has(geometry.elementId))
      .flatMap((geometry) =>
        selectablePointsForGeometry(geometry, elementsById)
          .filter((candidate) => candidate.anchor.mode !== "coordinate" && acceptedPickRefs.has(
            pickRefKey(pickRefForOption(geometry.elementId, {
              kind: "point",
              label: candidate.label,
              anchor: candidate.anchor
            }))
          ))
          .map((candidate) => ({
            anchor: candidate.anchor,
            label: candidate.label,
            screen: worldToScreen(candidate.point, viewportSize, canvasViewport),
            ...(sourceReferenceByPickRef.get(pickRefKey(pickRefForOption(geometry.elementId, {
              kind: "point",
              label: candidate.label,
              anchor: candidate.anchor
            }))) ? {
              sourceReference: sourceReferenceByPickRef.get(pickRefKey(pickRefForOption(geometry.elementId, {
                kind: "point",
                label: candidate.label,
                anchor: candidate.anchor
              })))
            } : {})
          }))
      );
  }, [
    canvasViewport,
    elements,
    excludedInteractionElementIds,
    geometries,
    pointPickCandidates,
    viewportSize,
    visibleElementIds
  ]);
  const overlayNumericReferenceCandidates = useMemo(
    () => [
      ...overlayLines.map(({ line, start, end }) => ({ line, start, end })),
      ...overlayArcs.map(({ arc, start, end, points }) => ({ line: arc, start, end, points })),
      ...overlayCurves.map(({ curve, points }) => ({ line: curve, points })),
      ...overlayOffsetLines.map(({ line, points }) => ({ line, points })),
      ...overlayPolylines.map(({ polyline, points }) => ({ line: polyline, points }))
    ],
    [overlayArcs, overlayCurves, overlayLines, overlayOffsetLines, overlayPolylines]
  );
  const selectedBezierEditingHelper = useMemo<BezierEditingHelperOverlay | null>(() => {
    const curveElement = elements.find((element) => element.id === selectedElementId);
    if (!curveElement || curveElement.type !== "bezierCurve" || !visibleElementIds.has(curveElement.id)) {
      return null;
    }

    const preMutationCurve = evaluation.preMutationGeometry?.get(curveElement.id);
    if (preMutationCurve?.kind !== "bezierCurve") return null;
    const finalCurve = evaluation.computedGeometry.get(curveElement.id);
    if (!preMutationCurve || finalCurve?.kind !== "bezierCurve") return null;
    if (JSON.stringify(preMutationCurve) === JSON.stringify(finalCurve)) return null;

    return {
      curve: preMutationCurve,
      points: sampleBezierCurveScreenPoints(preMutationCurve, (point) =>
        worldToScreen(point, viewportSize, canvasViewport)
      )
    };
  }, [canvasViewport, elements, evaluation, selectedElementId, viewportSize, visibleElementIds]);
  const selectedBezierHandles = useMemo(() => {
    const curveElement = elements.find((element) => element.id === selectedElementId);
    if (!curveElement || curveElement.type !== "bezierCurve" || !visibleElementIds.has(curveElement.id)) {
      return [];
    }

    const curve = evaluation.preMutationGeometry?.get(curveElement.id);
    if (curve?.kind !== "bezierCurve") return [];
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
  }, [canvasViewport, elements, evaluation.preMutationGeometry, selectedElementId, viewportSize, visibleElementIds]);

  return {
    lines,
    arcs,
    curves,
    offsetLines,
    polylines,
    images,
    texts,
    points,
    visibleElementIds,
    selectionEligibleElementIds,
    overlayLines,
    overlayPoints,
    overlayArcs,
    overlayCurves,
    overlayOffsetLines,
    overlayPolylines,
    overlayImages,
    overlayTexts,
    overlayIdentityCandidates,
    selectedBezierEditingHelper,
    overlayPointPickCandidates,
    overlayNumericReferenceCandidates,
    selectedBezierHandles
  };
};
