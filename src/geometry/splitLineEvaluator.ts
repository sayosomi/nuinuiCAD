import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedBezierSegment,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedOffsetLineSegment,
  ComputedPoint,
  ElementId
} from "../types/geometry";
import { anchorReferenceElementId } from "../model/pointAnchors";
import { approximateBezierSegmentLength, degreesToRadians, normalizeDegrees, radiansToDegrees } from "./evaluateGeometryPrimitives";
import { dependencyError, geometryError, getPointAnchorOrError } from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { isLineLikeGeometry } from "./linePaths";
import { arcTangentAngles, lineTangentAngles } from "./lineMeasurements";
import { cubicPointAt, distance, interpolate, refineBezierProjection, splitBezierLike, type Point } from "./bezierMath";
import { projectPointOntoOffsetSegment } from "./offsetSegmentProjection";

const TOLERANCE_MM = 0.001;
const EPSILON = 1e-9;
const CURVE_STEPS = 32;

const computedPoint = (elementId: ElementId, name: string, point: Point): ComputedPoint => ({
  kind: "point",
  elementId,
  name,
  x: point.x,
  y: point.y
});

const computedLine = ({
  elementId,
  name,
  start,
  end,
  startPointId,
  endPointId
}: {
  elementId: ElementId;
  name: string;
  start: ComputedPoint;
  end: ComputedPoint;
  startPointId: ElementId | null;
  endPointId: ElementId | null;
}): ComputedLine => ({
  kind: "line",
  elementId,
  name,
  startPointId,
  endPointId,
  start,
  end,
  length: distance(start, end),
  ...lineTangentAngles(start, end)
});

const arcPoint = (center: Point, radius: number, angleDeg: number): Point => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: center.x + Math.cos(angleRad) * radius,
    y: center.y + Math.sin(angleRad) * radius
  };
};

const arcGeometry = ({
  elementId,
  name,
  center,
  centerPointId,
  radius,
  startAngleDeg,
  sweepAngleDeg
}: {
  elementId: ElementId;
  name: string;
  center: ComputedPoint;
  centerPointId: ElementId | null;
  radius: number;
  startAngleDeg: number;
  sweepAngleDeg: number;
}): ComputedArcLine => {
  const endAngleDeg = startAngleDeg + sweepAngleDeg;
  return {
    kind: "arcLine",
    elementId,
    name,
    centerPointId,
    center,
    start: computedPoint(`${elementId}:start`, `${name}.始点`, arcPoint(center, radius, startAngleDeg)),
    end: computedPoint(`${elementId}:end`, `${name}.終点`, arcPoint(center, radius, endAngleDeg)),
    radius,
    startAngleDeg,
    endAngleDeg,
    ...arcTangentAngles({ startAngleDeg, endAngleDeg, sweepAngleDeg }),
    sweepAngleDeg,
    length: Math.max(radius, 0) * Math.abs(degreesToRadians(sweepAngleDeg))
  };
};

const projectedPoint = (point: Point, start: Point, end: Point) => {
  const vector = { x: end.x - start.x, y: end.y - start.y };
  const lengthSquared = vector.x * vector.x + vector.y * vector.y;
  if (lengthSquared <= EPSILON) return null;
  const rawT = ((point.x - start.x) * vector.x + (point.y - start.y) * vector.y) / lengthSquared;
  const t = Math.min(1, Math.max(0, rawT));
  const projection = interpolate(start, end, t);
  return {
    rawT,
    t,
    projection,
    distance: distance(point, projection)
  };
};

const splitLineGeometry = (
  line: ComputedLine,
  splitPoint: ComputedPoint,
  splitLineId: ElementId,
  splitLineName: string,
  splitPointId: ElementId | null
) => {
  const projection = projectedPoint(splitPoint, line.start, line.end);
  if (!projection || projection.distance > TOLERANCE_MM || projection.rawT < -EPSILON || projection.rawT > 1 + EPSILON) {
    return null;
  }
  if (projection.t <= TOLERANCE_MM / Math.max(line.length, TOLERANCE_MM) || projection.t >= 1 - TOLERANCE_MM / Math.max(line.length, TOLERANCE_MM)) {
    return "endpoint" as const;
  }

  const split = computedPoint(splitPoint.elementId, splitPoint.name, projection.projection);
  return {
    near: computedLine({
      elementId: line.elementId,
      name: line.name,
      start: line.start,
      end: split,
      startPointId: line.startPointId,
      endPointId: splitPointId
    }),
    far: computedLine({
      elementId: splitLineId,
      name: splitLineName,
      start: split,
      end: line.end,
      startPointId: splitPointId,
      endPointId: line.endPointId
    })
  };
};

const signedArcProgress = (startAngleDeg: number, sweepAngleDeg: number, pointAngleDeg: number) =>
  sweepAngleDeg >= 0
    ? normalizeDegrees(pointAngleDeg - startAngleDeg)
    : -normalizeDegrees(startAngleDeg - pointAngleDeg);

const splitArcGeometry = (
  arc: ComputedArcLine,
  splitPoint: ComputedPoint,
  splitLineId: ElementId,
  splitLineName: string
) => {
  if (arc.radius <= EPSILON || Math.abs(arc.sweepAngleDeg) <= EPSILON) return null;
  const radiusDistance = distance(splitPoint, arc.center);
  if (Math.abs(radiusDistance - arc.radius) > TOLERANCE_MM) return null;

  const pointAngleDeg = normalizeDegrees(radiansToDegrees(Math.atan2(splitPoint.y - arc.center.y, splitPoint.x - arc.center.x)));
  const progress = signedArcProgress(arc.startAngleDeg, arc.sweepAngleDeg, pointAngleDeg);
  const t = progress / arc.sweepAngleDeg;
  const projected = arcPoint(arc.center, arc.radius, arc.startAngleDeg + progress);
  if (t < -EPSILON || t > 1 + EPSILON || distance(projected, splitPoint) > TOLERANCE_MM) return null;
  if (t <= TOLERANCE_MM / Math.max(arc.length, TOLERANCE_MM) || t >= 1 - TOLERANCE_MM / Math.max(arc.length, TOLERANCE_MM)) {
    return "endpoint" as const;
  }

  return {
    near: arcGeometry({
      elementId: arc.elementId,
      name: arc.name,
      center: arc.center,
      centerPointId: arc.centerPointId,
      radius: arc.radius,
      startAngleDeg: arc.startAngleDeg,
      sweepAngleDeg: progress
    }),
    far: arcGeometry({
      elementId: splitLineId,
      name: splitLineName,
      center: arc.center,
      centerPointId: arc.centerPointId,
      radius: arc.radius,
      startAngleDeg: arc.startAngleDeg + progress,
      sweepAngleDeg: arc.sweepAngleDeg - progress
    })
  };
};

export type SampleHit = {
  segmentIndex: number;
  localT: number;
  distanceFromStart: number;
  distanceFromLine: number;
  point: Point;
};

export const bestSampleHit = (
  splitPoint: Point,
  segments: Array<{ length: number; pointAt: (t: number) => Point }>
): { hit: SampleHit | null; totalLength: number } => {
  let totalLength = 0;
  let best: SampleHit | null = null;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const samplePoints = Array.from({ length: CURVE_STEPS + 1 }, (_, index) => ({
      t: index / CURVE_STEPS,
      point: segment.pointAt(index / CURVE_STEPS)
    }));
    let segmentDistance = 0;
    for (let index = 0; index < samplePoints.length - 1; index += 1) {
      const start = samplePoints[index];
      const end = samplePoints[index + 1];
      const sampleLength = distance(start.point, end.point);
      const projection = projectedPoint(splitPoint, start.point, end.point);
      if (projection && projection.rawT >= -EPSILON && projection.rawT <= 1 + EPSILON) {
        const localT = start.t + (end.t - start.t) * projection.t;
        const candidate = {
          segmentIndex,
          localT,
          distanceFromStart: totalLength + segmentDistance + sampleLength * projection.t,
          distanceFromLine: projection.distance,
          point: projection.projection
        };
        if (!best || candidate.distanceFromLine < best.distanceFromLine) best = candidate;
      }
      segmentDistance += sampleLength;
    }
    totalLength += segment.length;
  }
  return { hit: best, totalLength };
};

export const refineOffsetSampleHit = (
  point: Point,
  segments: ComputedOffsetLineSegment[],
  hit: SampleHit
): SampleHit | null => {
  const segment = segments[hit.segmentIndex];
  if (!segment) return null;
  const refined = projectPointOntoOffsetSegment(point, segment, hit.localT);
  if (!refined) return null;
  return {
    ...hit,
    localT: refined.localT,
    point: refined.point,
    distanceFromLine: refined.distance
  };
};

const computedBezierSegment = (segment: ComputedBezierSegment, start: ComputedPoint, end: ComputedPoint): ComputedBezierSegment => ({
  ...segment,
  start,
  end
});

const splitBezierCurveGeometry = (
  curve: ComputedBezierCurve,
  splitPoint: ComputedPoint,
  splitLineId: ElementId,
  splitLineName: string,
  splitPointId: ElementId | null
) => {
  const { hit, totalLength } = bestSampleHit(
    splitPoint,
    curve.segments.map((segment) => ({
      length: approximateBezierSegmentLength(segment),
      pointAt: (t: number) => cubicPointAt(segment, t)
    }))
  );
  if (!hit) return null;
  const original = curve.segments[hit.segmentIndex];
  const refinedHit = refineBezierProjection(original, splitPoint, hit.localT);
  if (refinedHit.distanceFromLine > TOLERANCE_MM) return null;
  if (hit.distanceFromStart <= TOLERANCE_MM || hit.distanceFromStart >= totalLength - TOLERANCE_MM) {
    return "endpoint" as const;
  }

  const split = splitBezierLike(original, refinedHit.localT);
  const splitComputedPoint = computedPoint(splitPoint.elementId, splitPoint.name, split.point);
  const left = computedBezierSegment(split.left, original.start, splitComputedPoint);
  const right = computedBezierSegment(split.right, splitComputedPoint, original.end);
  const nearSegments = [...curve.segments.slice(0, hit.segmentIndex), left];
  const farSegments = [right, ...curve.segments.slice(hit.segmentIndex + 1)];
  return {
    near: {
      ...curve,
      segments: nearSegments,
      endPointId: splitPointId,
      intermediatePointIds: curve.intermediatePointIds.slice(0, hit.segmentIndex),
      length: nearSegments.reduce((sum, segment) => sum + approximateBezierSegmentLength(segment), 0)
    },
    far: {
      ...curve,
      elementId: splitLineId,
      name: splitLineName,
      startPointId: splitPointId,
      intermediatePointIds: curve.intermediatePointIds.slice(hit.segmentIndex),
      segments: farSegments,
      length: farSegments.reduce((sum, segment) => sum + approximateBezierSegmentLength(segment), 0)
    }
  };
};

const offsetSegmentLength = (segment: ComputedOffsetLineSegment) =>
  segment.kind === "line"
    ? distance(segment.start, segment.end)
    : segment.kind === "bezier"
      ? approximateBezierSegmentLength({
          startPointId: null,
          endPointId: null,
          start: computedPoint("start", "start", segment.start),
          control1: segment.control1,
          control2: segment.control2,
          end: computedPoint("end", "end", segment.end)
        })
      : Math.max(segment.radius, 0) * Math.abs(degreesToRadians(segment.sweepAngleDeg));

export const splitOffsetSegment = (segment: ComputedOffsetLineSegment, t: number, splitPoint: Point): [ComputedOffsetLineSegment, ComputedOffsetLineSegment] => {
  if (segment.kind === "line") {
    return [
      { ...segment, end: computedPoint(segment.end.elementId, segment.end.name, splitPoint), length: distance(segment.start, splitPoint) },
      { ...segment, start: computedPoint(segment.start.elementId, segment.start.name, splitPoint), length: distance(splitPoint, segment.end) }
    ];
  }
  if (segment.kind === "bezier") {
    const split = splitBezierLike(segment, t);
    return [
      {
        kind: "bezier",
        start: segment.start,
        control1: split.left.control1,
        control2: split.left.control2,
        end: computedPoint(segment.end.elementId, segment.end.name, split.point),
        length: offsetSegmentLength({ kind: "bezier", start: segment.start, control1: split.left.control1, control2: split.left.control2, end: computedPoint(segment.end.elementId, segment.end.name, split.point), length: 0 })
      },
      {
        kind: "bezier",
        start: computedPoint(segment.start.elementId, segment.start.name, split.point),
        control1: split.right.control1,
        control2: split.right.control2,
        end: segment.end,
        length: offsetSegmentLength({ kind: "bezier", start: computedPoint(segment.start.elementId, segment.start.name, split.point), control1: split.right.control1, control2: split.right.control2, end: segment.end, length: 0 })
      }
    ];
  }
  const sweep = segment.sweepAngleDeg * t;
  return [
    {
      ...segment,
      sweepAngleDeg: sweep,
      end: computedPoint(segment.end.elementId, segment.end.name, splitPoint),
      length: Math.max(segment.radius, 0) * Math.abs(degreesToRadians(sweep))
    },
    {
      ...segment,
      start: computedPoint(segment.start.elementId, segment.start.name, splitPoint),
      startAngleDeg: segment.startAngleDeg + sweep,
      sweepAngleDeg: segment.sweepAngleDeg - sweep,
      length: Math.max(segment.radius, 0) * Math.abs(degreesToRadians(segment.sweepAngleDeg - sweep))
    }
  ];
};

const splitOffsetLineGeometry = (
  line: ComputedOffsetLine,
  splitPoint: ComputedPoint,
  splitLineId: ElementId,
  splitLineName: string
) => {
  const { hit, totalLength } = bestSampleHit(
    splitPoint,
    line.segments.map((segment) => ({
      length: segment.length,
      pointAt: (t: number) =>
        segment.kind === "line"
          ? interpolate(segment.start, segment.end, t)
          : segment.kind === "bezier"
            ? cubicPointAt(segment, t)
            : arcPoint(segment.center, segment.radius, segment.startAngleDeg + segment.sweepAngleDeg * t)
    }))
  );
  if (!hit) return null;
  const refinedHit = refineOffsetSampleHit(splitPoint, line.segments, hit);
  if (!refinedHit || refinedHit.distanceFromLine > TOLERANCE_MM) return null;
  if (hit.distanceFromStart <= TOLERANCE_MM || hit.distanceFromStart >= totalLength - TOLERANCE_MM) {
    return "endpoint" as const;
  }

  const [left, right] = splitOffsetSegment(
    line.segments[refinedHit.segmentIndex],
    refinedHit.localT,
    refinedHit.point
  );
  const nearSegments = [...line.segments.slice(0, refinedHit.segmentIndex), left];
  const farSegments = [right, ...line.segments.slice(refinedHit.segmentIndex + 1)];
  return {
    near: {
      ...line,
      closed: false,
      segments: nearSegments,
      length: nearSegments.reduce((sum, segment) => sum + segment.length, 0)
    },
    far: {
      ...line,
      elementId: splitLineId,
      name: splitLineName,
      closed: false,
      segments: farSegments,
      length: farSegments.reduce((sum, segment) => sum + segment.length, 0)
    }
  };
};

const splitGeometry = (
  geometry: ComputedGeometry,
  splitPoint: ComputedPoint,
  splitLineId: ElementId,
  splitLineName: string,
  splitPointId: ElementId | null
) => {
  if (geometry.kind === "line") return splitLineGeometry(geometry, splitPoint, splitLineId, splitLineName, splitPointId);
  if (geometry.kind === "arcLine") return splitArcGeometry(geometry, splitPoint, splitLineId, splitLineName);
  if (geometry.kind === "bezierCurve") return splitBezierCurveGeometry(geometry, splitPoint, splitLineId, splitLineName, splitPointId);
  if (geometry.kind === "offsetLine") return splitOffsetLineGeometry(geometry, splitPoint, splitLineId, splitLineName);
  return null;
};

export const evaluateSplitLineElement = (element: CadElement, context: ElementEvaluationContext) => {
  if (element.type !== "splitLine") return false;
  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    localVariables: { localVariableValues, localVariableNames }
  } = context;

  const baseGeometry = computedGeometry.get(element.baseLineId);
  if (!isLineLikeGeometry(baseGeometry)) {
    errors.push(dependencyError(element, element.baseLineId, elementsById, disabledByGroupId));
    return true;
  }

  const splitPoint = getPointAnchorOrError(
    element,
    element.splitPoint,
    "splitPoint",
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId
  );
  if (!splitPoint) return true;

  const result = splitGeometry(
    baseGeometry,
    splitPoint,
    element.id,
    element.name,
    anchorReferenceElementId(element.splitPoint)
  );
  if (!result) {
    errors.push(
      geometryError(
        element,
        `${element.name} の点は基準線上にありません。延長線上ではなく、基準線の上にある点を指定してください。`
      )
    );
    return true;
  }
  if (result === "endpoint") {
    errors.push(
      geometryError(
        element,
        `${element.name} の点は基準線の端点です。線を2つに分割するため、基準線の途中にある点を指定してください。`
      )
    );
    return true;
  }

  computedGeometry.set(element.baseLineId, result.near);
  computedGeometry.set(element.id, result.far);
  return true;
};
