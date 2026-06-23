import type {
  CadElement,
  ComputedArcLine,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedOffsetLineSegment,
  ComputedPoint,
  ElementId,
  LineEndpointReference
} from "../types/geometry";
import { isLineLikeGeometry } from "./linePaths";
import { findLineIntersections } from "./lineIntersections";
import {
  degreesToRadians,
  normalizeDegrees,
  radiansToDegrees
} from "./evaluateGeometryPrimitives";
import { dependencyError, geometryError, numericError } from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { arcTangentAngles, offsetLineEndpointMeasurements } from "./lineMeasurements";

type Point = { x: number; y: number };

type PathSample = {
  point: Point;
  distance: number;
};

const CURVE_STEPS = 96;
const ARC_STEPS = 96;
const EPSILON = 1e-7;

const computedPoint = (elementId: ElementId, name: string, point: Point): ComputedPoint => ({
  kind: "point",
  elementId,
  name,
  x: point.x,
  y: point.y
});

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

const normalize = (point: Point): Point | null => {
  const length = Math.hypot(point.x, point.y);
  if (length <= EPSILON) return null;
  return { x: point.x / length, y: point.y / length };
};

const pointAt = (start: Point, direction: Point, amount: number): Point => ({
  x: start.x + direction.x * amount,
  y: start.y + direction.y * amount
});

const samePoint = (a: Point, b: Point) => distance(a, b) <= EPSILON;

const angleOfPoint = (center: Point, point: Point) =>
  normalizeDegrees(radiansToDegrees(Math.atan2(center.y - point.y, point.x - center.x)));

const signedSweep = (startAngleDeg: number, endAngleDeg: number, direction: "cw" | "ccw") => {
  const positive = normalizeDegrees(endAngleDeg - startAngleDeg);
  return direction === "ccw" ? positive : positive - 360;
};

const cubicPointAt = (
  segment: { start: Point; control1: Point; control2: Point; end: Point },
  t: number
): Point => {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;

  return {
    x:
      a * segment.start.x +
      b * segment.control1.x +
      c * segment.control2.x +
      d * segment.end.x,
    y:
      a * segment.start.y +
      b * segment.control1.y +
      c * segment.control2.y +
      d * segment.end.y
  };
};

const arcPoint = (center: Point, radius: number, angleDeg: number): Point => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: center.x + Math.cos(angleRad) * radius,
    y: center.y - Math.sin(angleRad) * radius
  };
};

const sampleArc = (arc: ComputedArcLine) => {
  const stepCount = Math.max(1, Math.ceil((Math.abs(arc.sweepAngleDeg) / 360) * ARC_STEPS));
  return Array.from({ length: stepCount + 1 }, (_, index) =>
    arcPoint(
      arc.center,
      Math.max(arc.radius, 0),
      arc.startAngleDeg + (arc.sweepAngleDeg * index) / stepCount
    )
  );
};

const offsetSegmentPoints = (segment: ComputedOffsetLineSegment) => {
  if (segment.kind === "line") return [segment.start, segment.end];
  if (segment.kind === "bezier") {
    return Array.from({ length: CURVE_STEPS + 1 }, (_, index) =>
      cubicPointAt(segment, index / CURVE_STEPS)
    );
  }
  const stepCount = Math.max(1, Math.ceil((Math.abs(segment.sweepAngleDeg) / 360) * ARC_STEPS));
  return Array.from({ length: stepCount + 1 }, (_, index) =>
    arcPoint(
      segment.center,
      Math.max(segment.radius, 0),
      segment.startAngleDeg + (segment.sweepAngleDeg * index) / stepCount
    )
  );
};

const geometryPoints = (geometry: ComputedGeometry): Point[] => {
  if (geometry.kind === "line") return [geometry.start, geometry.end];
  if (geometry.kind === "arcLine") return sampleArc(geometry);
  if (geometry.kind === "bezierCurve") {
    return geometry.segments.flatMap((segment, segmentIndex) => {
      const points = Array.from({ length: CURVE_STEPS + 1 }, (_, index) =>
        cubicPointAt(segment, index / CURVE_STEPS)
      );
      return segmentIndex === 0 ? points : points.slice(1);
    });
  }
  if (geometry.kind === "offsetLine") {
    return geometry.segments.flatMap((segment, segmentIndex) => {
      const points = offsetSegmentPoints(segment);
      return segmentIndex === 0 ? points : points.slice(1);
    });
  }
  return [];
};

const pathSamples = (points: Point[]): PathSample[] => {
  const samples: PathSample[] = [];
  let accumulated = 0;
  points.forEach((point, index) => {
    if (index > 0) accumulated += distance(points[index - 1], point);
    samples.push({ point, distance: accumulated });
  });
  return samples;
};

const nearestDistanceOnPath = (samples: PathSample[], target: Point) => {
  let best: { distance: number; pointDistance: number } | null = null;

  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index];
    const next = samples[index + 1];
    const vector = { x: next.point.x - current.point.x, y: next.point.y - current.point.y };
    const lengthSquared = vector.x * vector.x + vector.y * vector.y;
    if (lengthSquared <= EPSILON) continue;
    const t = Math.min(
      1,
      Math.max(
        0,
        ((target.x - current.point.x) * vector.x + (target.y - current.point.y) * vector.y) /
          lengthSquared
      )
    );
    const projected = {
      x: current.point.x + vector.x * t,
      y: current.point.y + vector.y * t
    };
    const pointDistance = distance(projected, target);
    if (!best || pointDistance < best.pointDistance) {
      best = {
        distance: current.distance + (next.distance - current.distance) * t,
        pointDistance
      };
    }
  }

  return best;
};

const endpointPoint = (
  geometry: ComputedGeometry,
  endpointKey: LineEndpointReference["endpointKey"]
): Point | null => {
  if (geometry.kind === "line" || geometry.kind === "arcLine") {
    return endpointKey === "start" ? geometry.start : geometry.end;
  }
  if (geometry.kind === "bezierCurve") {
    const segment = endpointKey === "start" ? geometry.segments[0] : geometry.segments.at(-1);
    return segment ? (endpointKey === "start" ? segment.start : segment.end) : null;
  }
  if (geometry.kind === "offsetLine") {
    const segment = endpointKey === "start" ? geometry.segments[0] : geometry.segments.at(-1);
    return segment ? (endpointKey === "start" ? segment.start : segment.end) : null;
  }
  return null;
};

const endpointInwardDirection = (
  samples: PathSample[],
  endpointKey: LineEndpointReference["endpointKey"]
) => {
  if (samples.length < 2) return null;
  if (endpointKey === "start") {
    return normalize({
      x: samples[1].point.x - samples[0].point.x,
      y: samples[1].point.y - samples[0].point.y
    });
  }
  const last = samples.at(-1)!;
  const beforeLast = samples.at(-2)!;
  return normalize({
    x: beforeLast.point.x - last.point.x,
    y: beforeLast.point.y - last.point.y
  });
};

const rayDirectionForEndpoint = ({
  geometry,
  endpoint,
  corner,
  samples
}: {
  geometry: ComputedGeometry;
  endpoint: LineEndpointReference;
  corner: Point;
  samples: PathSample[];
}) => {
  const selectedEndpoint = endpointPoint(geometry, endpoint.endpointKey);
  if (!selectedEndpoint) return null;
  const fromCornerToEndpoint = normalize({
    x: selectedEndpoint.x - corner.x,
    y: selectedEndpoint.y - corner.y
  });
  if (fromCornerToEndpoint) return fromCornerToEndpoint;
  return endpointInwardDirection(samples, endpoint.endpointKey);
};

const tangentPointDistance = ({
  samples,
  endpoint,
  tangentPoint
}: {
  samples: PathSample[];
  endpoint: LineEndpointReference;
  tangentPoint: Point;
}) => {
  const nearest = nearestDistanceOnPath(samples, tangentPoint);
  if (!nearest || nearest.pointDistance > 0.25) return null;
  const total = samples.at(-1)?.distance ?? 0;
  if (endpoint.endpointKey === "start") {
    return nearest.distance < -EPSILON || nearest.distance > total + EPSILON ? null : nearest.distance;
  }
  return nearest.distance < -EPSILON || nearest.distance > total + EPSILON ? null : nearest.distance;
};

const polylineSegments = ({
  elementId,
  name,
  points
}: {
  elementId: ElementId;
  name: string;
  points: Point[];
}): ComputedOffsetLineSegment[] =>
  points.slice(0, -1).flatMap((start, index) => {
    const end = points[index + 1];
    const length = distance(start, end);
    if (length <= EPSILON) return [];
    return [
      {
        kind: "line" as const,
        start: computedPoint(`${elementId}:trim-${index + 1}:start`, `${name}.区間${index + 1}始点`, start),
        end: computedPoint(`${elementId}:trim-${index + 1}:end`, `${name}.区間${index + 1}終点`, end),
        length
      }
    ];
  });

const trimmedPolylineGeometry = ({
  geometry,
  endpoint,
  tangentPoint
}: {
  geometry: ComputedGeometry;
  endpoint: LineEndpointReference;
  tangentPoint: Point;
}): ComputedOffsetLine | null => {
  const samples = pathSamples(geometryPoints(geometry));
  if (samples.length < 2) return null;
  const nearest = nearestDistanceOnPath(samples, tangentPoint);
  if (!nearest || nearest.pointDistance > 0.25) return null;
  const total = samples.at(-1)!.distance;
  const trimDistance = Math.min(Math.max(nearest.distance, 0), total);
  const retainedSamples =
    endpoint.endpointKey === "start"
      ? [tangentPoint, ...samples.filter((sample) => sample.distance > trimDistance + EPSILON).map((sample) => sample.point)]
      : [...samples.filter((sample) => sample.distance < trimDistance - EPSILON).map((sample) => sample.point), tangentPoint];
  if (retainedSamples.length < 2) return null;
  const segments = polylineSegments({
    elementId: geometry.elementId,
    name: geometry.name,
    points: retainedSamples
  });
  if (segments.length === 0) return null;
  return {
    kind: "offsetLine",
    elementId: geometry.elementId,
    name: geometry.name,
    baseLineIds: [],
    ...offsetLineEndpointMeasurements(segments),
    segments,
    closed: false,
    length: segments.reduce((sum, segment) => sum + segment.length, 0)
  };
};

const trimmedLineGeometry = (
  geometry: ComputedLine,
  endpoint: LineEndpointReference,
  tangentPoint: Point
): ComputedLine | null => {
  const start = endpoint.endpointKey === "start" ? tangentPoint : geometry.start;
  const end = endpoint.endpointKey === "end" ? tangentPoint : geometry.end;
  const dx = end.x - start.x;
  const dy = start.y - end.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return null;
  return {
    ...geometry,
    start: computedPoint(`${geometry.elementId}:start`, `${geometry.name}.始点`, start),
    end: computedPoint(`${geometry.elementId}:end`, `${geometry.name}.終点`, end),
    length,
    startAngleDeg: normalizeDegrees(radiansToDegrees(Math.atan2(dy, dx))),
    endAngleDeg: normalizeDegrees(radiansToDegrees(Math.atan2(-dy, -dx)))
  };
};

const updateTrimmedGeometry = ({
  computedGeometry,
  endpoint,
  tangentPoint
}: {
  computedGeometry: Map<ElementId, ComputedGeometry>;
  endpoint: LineEndpointReference;
  tangentPoint: Point;
}) => {
  const geometry = computedGeometry.get(endpoint.lineId);
  if (!geometry || !isLineLikeGeometry(geometry)) return false;

  if (geometry.kind === "line") {
    const trimmed = trimmedLineGeometry(geometry, endpoint, tangentPoint);
    if (!trimmed) return false;
    computedGeometry.set(endpoint.lineId, trimmed);
    return true;
  }

  const trimmed = trimmedPolylineGeometry({ geometry, endpoint, tangentPoint });
  if (!trimmed) return false;
  computedGeometry.set(endpoint.lineId, trimmed);
  return true;
};

const cornerRadiusGeometry = ({
  element,
  corner,
  direction1,
  direction2,
  radius
}: {
  element: CadElement;
  corner: Point;
  direction1: Point;
  direction2: Point;
  radius: number;
}) => {
  const unit1 = normalize(direction1);
  const unit2 = normalize(direction2);
  if (!unit1 || !unit2) return null;
  const clampedDot = Math.min(1, Math.max(-1, dot(unit1, unit2)));
  const angle = Math.acos(clampedDot);
  if (angle <= EPSILON || Math.abs(Math.PI - angle) <= EPSILON) return null;

  const tangentDistance = radius / Math.tan(angle / 2);
  const bisector = normalize({ x: unit1.x + unit2.x, y: unit1.y + unit2.y });
  if (!bisector) return null;
  const centerDistance = radius / Math.sin(angle / 2);
  const center = pointAt(corner, bisector, centerDistance);
  const tangent1 = pointAt(corner, unit1, tangentDistance);
  const tangent2 = pointAt(corner, unit2, tangentDistance);
  const startAngleDeg = angleOfPoint(center, tangent1);
  const endAngleDeg = angleOfPoint(center, tangent2);
  const direction = cross(
    { x: tangent1.x - center.x, y: tangent1.y - center.y },
    { x: tangent2.x - center.x, y: tangent2.y - center.y }
  ) > 0 ? "cw" : "ccw";
  const sweepAngleDeg = signedSweep(startAngleDeg, endAngleDeg, direction);

  return {
    kind: "arcLine" as const,
    elementId: element.id,
    name: element.name,
    centerPointId: null,
    center: computedPoint(`${element.id}:center`, `${element.name}.中心点`, center),
    start: computedPoint(`${element.id}:start`, `${element.name}.始点`, tangent1),
    end: computedPoint(`${element.id}:end`, `${element.name}.終点`, tangent2),
    radius,
    startAngleDeg,
    endAngleDeg,
    ...arcTangentAngles({ startAngleDeg, endAngleDeg, sweepAngleDeg }),
    sweepAngleDeg,
    length: radius * Math.abs(degreesToRadians(sweepAngleDeg))
  };
};

export const evaluateCornerRadiusArcLineElement = (
  element: CadElement,
  context: ElementEvaluationContext
) => {
  if (element.type !== "cornerRadiusArcLine") return false;

  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    localVariables: { localVariableValues, localVariableNames }
  } = context;

  if (element.endpoint1.lineId === element.endpoint2.lineId) {
    errors.push(
      geometryError(
        element,
        `${element.name} は同じ線を2回参照しているため、角R円弧線を作図できません。端点1と端点2に別の線を指定してください。`
      )
    );
    return true;
  }

  const line1 = computedGeometry.get(element.endpoint1.lineId);
  const line2 = computedGeometry.get(element.endpoint2.lineId);
  if (!isLineLikeGeometry(line1)) {
    errors.push(dependencyError(element, element.endpoint1.lineId, elementsById, disabledByGroupId));
    return true;
  }
  if (!isLineLikeGeometry(line2)) {
    errors.push(dependencyError(element, element.endpoint2.lineId, elementsById, disabledByGroupId));
    return true;
  }

  const radius = numericError(
    element,
    element.radius,
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId
  );
  const intersectionIndex = numericError(
    element,
    element.intersectionIndex,
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId
  );
  if (radius === undefined || intersectionIndex === undefined) return true;
  if (radius <= 0) {
    errors.push(geometryError(element, `${element.name} の半径は0より大きい値で指定してください。`));
    return true;
  }
  if (!Number.isInteger(intersectionIndex) || intersectionIndex < 0) {
    errors.push(geometryError(element, `${element.name} の番号は0以上の整数で指定してください。`));
    return true;
  }

  const intersectionResult = findLineIntersections(line1, line2, { useExtensions: true });
  if (intersectionResult.error) {
    errors.push(geometryError(element, intersectionResult.error));
    return true;
  }
  const intersection = intersectionResult.intersections[intersectionIndex];
  if (!intersection) {
    const message =
      intersectionResult.intersections.length === 0
        ? `${element.name} は参照線同士の交点を見つけられません。端点1・端点2を確認してください。`
        : `${element.name} の番号 ${intersectionIndex} に対応する交点はありません。交点数は ${intersectionResult.intersections.length} 個です。`;
    errors.push(geometryError(element, message));
    return true;
  }

  const corner = { x: intersection.x, y: intersection.y };
  const samples1 = pathSamples(geometryPoints(line1));
  const samples2 = pathSamples(geometryPoints(line2));
  const direction1 = rayDirectionForEndpoint({
    geometry: line1,
    endpoint: element.endpoint1,
    corner,
    samples: samples1
  });
  const direction2 = rayDirectionForEndpoint({
    geometry: line2,
    endpoint: element.endpoint2,
    corner,
    samples: samples2
  });
  if (!direction1 || !direction2) {
    errors.push(
      geometryError(
        element,
        `${element.name} は参照端点から接線方向を決められません。長さのある線端点を指定してください。`
      )
    );
    return true;
  }

  const arc = cornerRadiusGeometry({
    element,
    corner,
    direction1,
    direction2,
    radius
  });
  if (!arc) {
    errors.push(
      geometryError(
        element,
        `${element.name} は指定した2線から角R円弧線を作図できません。平行または一直線上ではない2線を指定してください。`
      )
    );
    return true;
  }

  const tangentDistance1 = tangentPointDistance({
    samples: samples1,
    endpoint: element.endpoint1,
    tangentPoint: arc.start
  });
  const tangentDistance2 = tangentPointDistance({
    samples: samples2,
    endpoint: element.endpoint2,
    tangentPoint: arc.end
  });
  if (tangentDistance1 === null || tangentDistance2 === null) {
    errors.push(
      geometryError(
        element,
        `${element.name} は指定半径が大きすぎるか、接点が参照線上にありません。半径を小さくするか、端点を変更してください。`
      )
    );
    return true;
  }

  if (
    !updateTrimmedGeometry({
      computedGeometry,
      endpoint: element.endpoint1,
      tangentPoint: arc.start
    }) ||
    !updateTrimmedGeometry({
      computedGeometry,
      endpoint: element.endpoint2,
      tangentPoint: arc.end
    })
  ) {
    errors.push(
      geometryError(
        element,
        `${element.name} は元線を接点までトリムできません。参照線に長さが残る半径を指定してください。`
      )
    );
    return true;
  }

  computedGeometry.set(element.id, arc);
  if (samePoint(arc.start, arc.end)) {
    errors.push(geometryError(element, `${element.name} の始点と終点が同じ位置です。`));
  }
  return true;
};
