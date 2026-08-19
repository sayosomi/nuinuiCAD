import { effectiveVisibleElementIds } from "../model/groups";
import { effectiveVisibleElementIdsForProfile, visibilityProfileById } from "../model/visibilityProfiles";
import { runtimeOnlyElementTypes } from "../types/geometry";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierSegment,
  ComputedOffsetLineSegment,
  EvaluationResult,
  VisibilityProfile
} from "../types/geometry";

export type CanvasDrawingBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type MutableBounds = CanvasDrawingBounds | null;

const includePoint = (bounds: MutableBounds, x: number, y: number): MutableBounds => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return bounds;
  const normalizedX = Math.abs(x) < 1e-12 ? 0 : x;
  const normalizedY = Math.abs(y) < 1e-12 ? 0 : y;
  if (!bounds) return { minX: normalizedX, minY: normalizedY, maxX: normalizedX, maxY: normalizedY };
  return {
    minX: Math.min(bounds.minX, normalizedX),
    minY: Math.min(bounds.minY, normalizedY),
    maxX: Math.max(bounds.maxX, normalizedX),
    maxY: Math.max(bounds.maxY, normalizedY)
  };
};

const cubicCoordinateAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const inverse = 1 - t;
  return inverse * inverse * inverse * p0 +
    3 * inverse * inverse * t * p1 +
    3 * inverse * t * t * p2 +
    t * t * t * p3;
};

const cubicDerivativeRoots = (p0: number, p1: number, p2: number, p3: number): number[] => {
  const quadraticA = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
  const quadraticB = 6 * (p0 - 2 * p1 + p2);
  const quadraticC = 3 * (p1 - p0);
  const epsilon = Number.EPSILON * 16;

  if (Math.abs(quadraticA) <= epsilon) {
    if (Math.abs(quadraticB) <= epsilon) return [];
    const root = -quadraticC / quadraticB;
    return root > 0 && root < 1 ? [root] : [];
  }

  const discriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC;
  if (discriminant < 0) return [];
  if (discriminant === 0) {
    const root = -quadraticB / (2 * quadraticA);
    return root > 0 && root < 1 ? [root] : [];
  }

  const squareRoot = Math.sqrt(discriminant);
  return [-1, 1]
    .map((sign) => (-quadraticB + sign * squareRoot) / (2 * quadraticA))
    .filter((root) => root > 0 && root < 1);
};

type CubicSegment = Pick<ComputedBezierSegment, "start" | "control1" | "control2" | "end">;

const includeBezierSegment = (bounds: MutableBounds, segment: CubicSegment): MutableBounds => {
  const candidates = [0, 1,
    ...cubicDerivativeRoots(segment.start.x, segment.control1.x, segment.control2.x, segment.end.x),
    ...cubicDerivativeRoots(segment.start.y, segment.control1.y, segment.control2.y, segment.end.y)
  ];
  return candidates.reduce((current, t) => includePoint(
    current,
    cubicCoordinateAt(segment.start.x, segment.control1.x, segment.control2.x, segment.end.x, t),
    cubicCoordinateAt(segment.start.y, segment.control1.y, segment.control2.y, segment.end.y, t)
  ), bounds);
};

const normalizedDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

const angleIsOnArc = (angleDeg: number, startAngleDeg: number, sweepAngleDeg: number) => {
  if (Math.abs(sweepAngleDeg) >= 360) return true;
  const delta = sweepAngleDeg >= 0
    ? normalizedDegrees(angleDeg - startAngleDeg)
    : normalizedDegrees(startAngleDeg - angleDeg);
  return delta <= Math.abs(sweepAngleDeg) + 1e-9;
};

const includeArc = (
  bounds: MutableBounds,
  arc: Pick<ComputedArcLine, "center" | "radius" | "startAngleDeg" | "sweepAngleDeg">
): MutableBounds => {
  const radius = Math.max(arc.radius, 0);
  if (!Number.isFinite(radius)) return bounds;
  const angles = [arc.startAngleDeg, arc.startAngleDeg + arc.sweepAngleDeg, 0, 90, 180, 270]
    .filter((angle) => Number.isFinite(angle))
    .filter((angle, index, all) => all.indexOf(angle) === index)
    .filter((angle) => angle === arc.startAngleDeg || angle === arc.startAngleDeg + arc.sweepAngleDeg || angleIsOnArc(angle, arc.startAngleDeg, arc.sweepAngleDeg));
  return angles.reduce((current, angle) => {
    const radians = (angle * Math.PI) / 180;
    return includePoint(
      current,
      arc.center.x + Math.cos(radians) * radius,
      arc.center.y + Math.sin(radians) * radius
    );
  }, bounds);
};

const includeOffsetSegment = (bounds: MutableBounds, segment: ComputedOffsetLineSegment): MutableBounds => {
  if (segment.kind === "line") {
    return includePoint(includePoint(bounds, segment.start.x, segment.start.y), segment.end.x, segment.end.y);
  }
  if (segment.kind === "bezier") return includeBezierSegment(bounds, segment);
  return includeArc(bounds, segment);
};

/**
 * Resolves the same activity/profile visibility set used by the production
 * Canvas overlay. Generated for-group geometry inherits its template's
 * profile decision through the evaluator-provided relationship.
 */
export const effectiveCanvasVisibleElementIds = ({
  elements,
  evaluation,
  visibilityProfiles,
  activeVisibilityProfileId
}: {
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
}): Set<string> => {
  const documentElements = [...elements];
  const baseVisibleIds = evaluation.effectiveVisibleElementIds ?? effectiveVisibleElementIds(documentElements);
  const profile = visibilityProfileById([...visibilityProfiles], activeVisibilityProfileId);
  const profileVisibleIds = effectiveVisibleElementIdsForProfile({ elements: documentElements, profile });
  const templateIdByGeneratedId = new Map(
    (evaluation.forGroupGeneratedRows ?? []).map((row) => [row.generatedElementId, row.templateElementId])
  );
  return new Set([...baseVisibleIds].filter((id) =>
    profileVisibleIds.has(templateIdByGeneratedId.get(id) ?? id)
  ));
};

export const visibleCanvasDrawingBounds = ({
  elements,
  evaluation,
  visibilityProfiles,
  activeVisibilityProfileId
}: {
  elements: readonly CadElement[];
  evaluation: EvaluationResult;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string | null;
}): CanvasDrawingBounds | null => {
  const visibleIds = effectiveCanvasVisibleElementIds({
    elements,
    evaluation,
    visibilityProfiles,
    activeVisibilityProfileId
  });
  const elementById = new Map(elements.map((element) => [element.id, element]));
  let bounds: MutableBounds = null;

  for (const geometry of evaluation.computedGeometry.values()) {
    if (!visibleIds.has(geometry.elementId)) continue;
    const element = elementById.get(geometry.elementId);
    if (element && runtimeOnlyElementTypes.has(element.type)) continue;

    switch (geometry.kind) {
      case "point":
        bounds = includePoint(bounds, geometry.x, geometry.y);
        break;
      case "line":
        bounds = includePoint(includePoint(bounds, geometry.start.x, geometry.start.y), geometry.end.x, geometry.end.y);
        break;
      case "arcLine":
        bounds = includeArc(bounds, geometry);
        break;
      case "bezierCurve":
        for (const segment of geometry.segments) bounds = includeBezierSegment(bounds, segment);
        break;
      case "offsetLine":
        for (const segment of geometry.segments) bounds = includeOffsetSegment(bounds, segment);
        break;
      case "text":
        if (geometry.anchor) bounds = includePoint(bounds, geometry.anchor.x, geometry.anchor.y);
        break;
      case "image":
        // Reference images are deliberately excluded from Fit Drawing.
        break;
    }
  }

  return bounds;
};
