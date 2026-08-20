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
  ComputedPoint,
  ComputedText,
  ElementId,
  EvaluationResult
} from "../types/geometry";
import type { VisibilityProfile } from "../types/geometry";
import { effectiveCanvasVisibleElementIds } from "../geometry/canvasDrawingBounds";
import { imageWorldCorners } from "../geometry/imageGeometry";
import {
  selectablePointsForGeometry
} from "../model/pointAnchors";
import {
  type PickCandidate
} from "../model/pickCandidates";
import { pickRefForOption, pickRefKey } from "../model/pickReferences";
import {
  sampleArcLineScreenPoints,
  sampleBezierCurveScreenPoints,
  sampleOffsetLineScreenPoints
} from "./DrawingCanvasHitTest";
import { type ViewportSize, worldToScreen } from "./canvasViewport";
import type {
  BezierEditingHelperOverlay,
  BezierHandleOverlay,
  CanvasOverlayData
} from "./DrawingCanvasTypes";

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
      ...overlayOffsetLines.map(({ line, points }) => ({ line, points }))
    ],
    [overlayArcs, overlayCurves, overlayLines, overlayOffsetLines]
  );
  const selectedBezierEditingHelper = useMemo<BezierEditingHelperOverlay | null>(() => {
    const curveElement = elements.find((element) => element.id === selectedElementId);
    if (!curveElement || curveElement.type !== "bezierCurve" || !visibleElementIds.has(curveElement.id)) {
      return null;
    }

    const preMutationCurve = evaluation.preMutationBezierGeometry?.get(curveElement.id);
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

    const curve = evaluation.preMutationBezierGeometry?.get(curveElement.id);
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
  }, [canvasViewport, elements, evaluation.preMutationBezierGeometry, selectedElementId, viewportSize, visibleElementIds]);

  return {
    lines,
    arcs,
    curves,
    offsetLines,
    images,
    texts,
    points,
    visibleElementIds,
    overlayLines,
    overlayPoints,
    overlayArcs,
    overlayCurves,
    overlayOffsetLines,
    overlayImages,
    overlayTexts,
    selectedBezierEditingHelper,
    overlayPointPickCandidates,
    overlayNumericReferenceCandidates,
    selectedBezierHandles
  };
};
