import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedBezierSegment,
  ComputedLine,
  ComputedOffsetLine,
  ComputedOffsetLineSegment,
  ComputedPoint,
  ElementId,
  LineEndpointReference
} from "../types/geometry";
import { anchorReferenceElementId } from "../model/pointAnchors";
import {
  approximateBezierSegmentLength,
  degreesToRadians,
  handlePoint,
  normalizeDegrees,
  radiansToDegrees
} from "./evaluateGeometryPrimitives";
import { findLineIntersections } from "./lineIntersections";
import { isLineLikeGeometry, type LineLikeGeometry } from "./linePaths";
import {
  dependencyError,
  geometryError,
  getPointAnchorOrError,
  numericError
} from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";

type Point = { x: number; y: number };

type EndpointMoveResult =
  | { geometry: LineLikeGeometry; error?: undefined }
  | { geometry?: undefined; error: string };

const EPSILON = 1e-9;
const TOLERANCE_MM = 0.001;
const CURVE_STEPS = 64;
const ARC_STEPS = 64;

const computedPoint = (elementId: ElementId, name: string, point: Point): ComputedPoint => ({
  kind: "point",
  elementId,
  name,
  x: point.x,
  y: point.y
});

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const interpolate = (start: Point, end: Point, t: number): Point => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t
});

const lineAngleDeg = (start: Point, end: Point) => {
  const dx = end.x - start.x;
  const dy = start.y - end.y;
  const length = Math.hypot(dx, dy);
  return length <= EPSILON ? null : normalizeDegrees(radiansToDegrees(Math.atan2(dy, dx)));
};

const lineDistance = (point: Point, start: Point, end: Point) => {
  const lineLength = distance(start, end);
  if (lineLength <= EPSILON) return null;
  return Math.abs(
    (end.x - start.x) * (start.y - point.y) - (start.x - point.x) * (end.y - start.y)
  ) / lineLength;
};

const computedLine = ({
  line,
  start,
  end,
  startPointId,
  endPointId
}: {
  line: ComputedLine;
  start: Point;
  end: Point;
  startPointId: ElementId | null;
  endPointId: ElementId | null;
}): ComputedLine | null => {
  if (distance(start, end) <= EPSILON) return null;
  return {
    ...line,
    startPointId,
    endPointId,
    start: computedPoint(`${line.elementId}:start`, `${line.name}.始点`, start),
    end: computedPoint(`${line.elementId}:end`, `${line.name}.終点`, end),
    length: distance(start, end),
    startAngleDeg: lineAngleDeg(start, end),
    endAngleDeg: lineAngleDeg(end, start)
  };
};

const moveLineEndpoint = (
  line: ComputedLine,
  endpointKey: LineEndpointReference["endpointKey"],
  target: ComputedPoint,
  targetPointId: ElementId | null
): EndpointMoveResult => {
  const distanceFromLine = lineDistance(target, line.start, line.end);
  if (distanceFromLine === null || distanceFromLine > TOLERANCE_MM) {
    return {
      error: `${line.name} の${endpointKey === "start" ? "始点" : "終点"}は、指定点が直線上または延長線上にないため移動できません。`
    };
  }

  const geometry = computedLine({
    line,
    start: endpointKey === "start" ? target : line.start,
    end: endpointKey === "end" ? target : line.end,
    startPointId: endpointKey === "start" ? targetPointId : line.startPointId,
    endPointId: endpointKey === "end" ? targetPointId : line.endPointId
  });
  return geometry
    ? { geometry }
    : { error: `${line.name} の端点移動後の長さが0になるため、変更できません。` };
};

const arcPoint = (center: Point, radius: number, angleDeg: number): Point => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: center.x + Math.cos(angleRad) * radius,
    y: center.y - Math.sin(angleRad) * radius
  };
};

const angleOfPoint = (center: Point, point: Point) =>
  normalizeDegrees(radiansToDegrees(Math.atan2(center.y - point.y, point.x - center.x)));

const signedSweep = (startAngleDeg: number, endAngleDeg: number, preferNegative: boolean) => {
  const positive = normalizeDegrees(endAngleDeg - startAngleDeg);
  return preferNegative && positive > EPSILON ? positive - 360 : positive;
};

const moveArcEndpoint = (
  arc: ComputedArcLine,
  endpointKey: LineEndpointReference["endpointKey"],
  target: ComputedPoint
): EndpointMoveResult => {
  if (arc.radius <= EPSILON) {
    return { error: `${arc.name} は半径が0のため、端点を変更できません。` };
  }
  if (Math.abs(distance(target, arc.center) - arc.radius) > TOLERANCE_MM) {
    return {
      error: `${arc.name} の${endpointKey === "start" ? "始点" : "終点"}は、指定点が円弧の円周上にないため移動できません。`
    };
  }

  const targetAngleDeg = angleOfPoint(arc.center, target);
  const startAngleDeg = endpointKey === "start" ? targetAngleDeg : arc.startAngleDeg;
  const endAngleDeg = endpointKey === "end" ? targetAngleDeg : arc.endAngleDeg;
  const sweepAngleDeg = signedSweep(startAngleDeg, endAngleDeg, arc.sweepAngleDeg < 0);
  if (Math.abs(sweepAngleDeg) <= EPSILON) {
    return { error: `${arc.name} の端点移動後の円弧長が0になるため、変更できません。` };
  }

  return {
    geometry: {
      ...arc,
      startAngleDeg,
      endAngleDeg,
      sweepAngleDeg,
      start: computedPoint(`${arc.elementId}:start`, `${arc.name}.始点`, arcPoint(arc.center, arc.radius, startAngleDeg)),
      end: computedPoint(`${arc.elementId}:end`, `${arc.name}.終点`, arcPoint(arc.center, arc.radius, endAngleDeg)),
      length: Math.max(arc.radius, 0) * Math.abs(degreesToRadians(sweepAngleDeg))
    }
  };
};

const pointOnAngleLine = (point: Point, origin: Point, angleDeg: number) => {
  const angleRad = degreesToRadians(angleDeg);
  const direction = { x: Math.cos(angleRad), y: -Math.sin(angleRad) };
  return Math.abs((point.x - origin.x) * direction.y - (point.y - origin.y) * direction.x);
};

const moveBezierEndpoint = (
  curve: ComputedBezierCurve,
  endpointKey: LineEndpointReference["endpointKey"],
  target: ComputedPoint,
  targetPointId: ElementId | null
): EndpointMoveResult => {
  const first = curve.segments[0];
  const last = curve.segments.at(-1);
  if (!first || !last) {
    return { error: `${curve.name} は区間がないため、端点を変更できません。` };
  }

  const sourcePoint = endpointKey === "start" ? first.start : last.end;
  const angleDeg = endpointKey === "start" ? curve.startHandleAngleDeg : curve.endHandleAngleDeg;
  if (pointOnAngleLine(target, sourcePoint, angleDeg) > TOLERANCE_MM) {
    return {
      error: `${curve.name} の${endpointKey === "start" ? "始点" : "終点"}は、指定点が端点角度の直線上にないため移動できません。`
    };
  }

  const segments = curve.segments.map((segment, index): ComputedBezierSegment => {
    if (endpointKey === "start" && index === 0) {
      const start = computedPoint(`${curve.elementId}:start`, `${curve.name}.始点`, target);
      return {
        ...segment,
        startPointId: targetPointId,
        start,
        control1: handlePoint(start, curve.startHandleAngleDeg, curve.startHandleLength)
      };
    }
    if (endpointKey === "end" && index === curve.segments.length - 1) {
      const end = computedPoint(`${curve.elementId}:end`, `${curve.name}.終点`, target);
      return {
        ...segment,
        endPointId: targetPointId,
        control2: handlePoint(end, curve.endHandleAngleDeg + 180, curve.endHandleLength),
        end
      };
    }
    return segment;
  });

  const length = segments.reduce((sum, segment) => sum + approximateBezierSegmentLength(segment), 0);
  if (length <= EPSILON) {
    return { error: `${curve.name} の端点移動後の長さが0になるため、変更できません。` };
  }

  return {
    geometry: {
      ...curve,
      startPointId: endpointKey === "start" ? targetPointId : curve.startPointId,
      endPointId: endpointKey === "end" ? targetPointId : curve.endPointId,
      segments,
      length
    }
  };
};

type PathSample = {
  point: Point;
  distance: number;
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
    x: a * segment.start.x + b * segment.control1.x + c * segment.control2.x + d * segment.end.x,
    y: a * segment.start.y + b * segment.control1.y + c * segment.control2.y + d * segment.end.y
  };
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

const offsetPoints = (line: ComputedOffsetLine) =>
  line.segments.flatMap((segment, index) => {
    const points = offsetSegmentPoints(segment);
    return index === 0 ? points : points.slice(1);
  });

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
  let best: { distance: number; pointDistance: number; point: Point } | null = null;

  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index];
    const next = samples[index + 1];
    const vector = { x: next.point.x - current.point.x, y: next.point.y - current.point.y };
    const lengthSquared = vector.x * vector.x + vector.y * vector.y;
    if (lengthSquared <= EPSILON) continue;
    const rawT =
      ((target.x - current.point.x) * vector.x + (target.y - current.point.y) * vector.y) /
      lengthSquared;
    const t = Math.min(1, Math.max(0, rawT));
    const projected = interpolate(current.point, next.point, t);
    const pointDistance = distance(projected, target);
    if (!best || pointDistance < best.pointDistance) {
      best = {
        distance: current.distance + (next.distance - current.distance) * t,
        pointDistance,
        point: projected
      };
    }
  }

  return best;
};

const polylineGeometry = ({
  line,
  points
}: {
  line: ComputedOffsetLine;
  points: Point[];
}): ComputedOffsetLine | null => {
  const segments = points.slice(0, -1).flatMap((start, index): ComputedOffsetLineSegment[] => {
    const end = points[index + 1];
    const length = distance(start, end);
    if (length <= EPSILON) return [];
    return [
      {
        kind: "line",
        start: computedPoint(`${line.elementId}:segment-${index}:start`, `${line.name}.区間${index + 1}始点`, start),
        end: computedPoint(`${line.elementId}:segment-${index}:end`, `${line.name}.区間${index + 1}終点`, end),
        length
      }
    ];
  });
  if (segments.length === 0) return null;
  return {
    ...line,
    closed: false,
    segments,
    length: segments.reduce((sum, segment) => sum + segment.length, 0)
  };
};

const tangentLineDistance = (
  samples: PathSample[],
  endpointKey: LineEndpointReference["endpointKey"],
  target: Point
) => {
  if (samples.length < 2) return null;
  const first = samples[0];
  const second = samples[1];
  const last = samples.at(-1)!;
  const beforeLast = samples.at(-2)!;
  return endpointKey === "start"
    ? lineDistance(target, first.point, second.point)
    : lineDistance(target, beforeLast.point, last.point);
};

const moveOffsetEndpoint = (
  line: ComputedOffsetLine,
  endpointKey: LineEndpointReference["endpointKey"],
  target: ComputedPoint
): EndpointMoveResult => {
  if (line.closed) {
    return { error: `${line.name} は閉じた線のため、端点を変更できません。` };
  }
  const points = offsetPoints(line);
  const samples = pathSamples(points);
  if (samples.length < 2) {
    return { error: `${line.name} は端点方向を決められないため、変更できません。` };
  }

  const nearest = nearestDistanceOnPath(samples, target);
  const total = samples.at(-1)!.distance;
  if (nearest && nearest.pointDistance <= TOLERANCE_MM) {
    const trimDistance = Math.min(Math.max(nearest.distance, 0), total);
    const retained =
      endpointKey === "start"
        ? [target, ...samples.filter((sample) => sample.distance > trimDistance + EPSILON).map((sample) => sample.point)]
        : [...samples.filter((sample) => sample.distance < trimDistance - EPSILON).map((sample) => sample.point), target];
    const geometry = polylineGeometry({ line, points: retained });
    return geometry
      ? { geometry }
      : { error: `${line.name} の端点移動後の長さが0になるため、変更できません。` };
  }

  const tangentDistance = tangentLineDistance(samples, endpointKey, target);
  if (tangentDistance === null || tangentDistance > TOLERANCE_MM) {
    return {
      error: `${line.name} の${endpointKey === "start" ? "始点" : "終点"}は、指定点が線上または端点接線の延長上にないため移動できません。`
    };
  }
  const retained = endpointKey === "start" ? [target, ...points] : [...points, target];
  const geometry = polylineGeometry({ line, points: retained });
  return geometry
    ? { geometry }
    : { error: `${line.name} の端点移動後の長さが0になるため、変更できません。` };
};

const moveEndpoint = (
  geometry: LineLikeGeometry,
  endpointKey: LineEndpointReference["endpointKey"],
  target: ComputedPoint,
  targetPointId: ElementId | null
): EndpointMoveResult => {
  if (geometry.kind === "line") {
    return moveLineEndpoint(geometry, endpointKey, target, targetPointId);
  }
  if (geometry.kind === "arcLine") {
    return moveArcEndpoint(geometry, endpointKey, target);
  }
  if (geometry.kind === "bezierCurve") {
    return moveBezierEndpoint(geometry, endpointKey, target, targetPointId);
  }
  return moveOffsetEndpoint(geometry, endpointKey, target);
};

const getLineLikeOrError = (
  element: CadElement,
  endpoint: LineEndpointReference,
  context: ElementEvaluationContext
) => {
  const line = context.computedGeometry.get(endpoint.lineId);
  if (!isLineLikeGeometry(line)) {
    context.errors.push(
      dependencyError(element, endpoint.lineId, context.elementsById, context.disabledByGroupId)
    );
    return null;
  }
  return line;
};

const applyEndpointMoves = (
  element: CadElement,
  moves: Array<{
    endpoint: LineEndpointReference;
    target: ComputedPoint;
    targetPointId: ElementId | null;
  }>,
  context: ElementEvaluationContext
) => {
  const nextGeometry = new Map<ElementId, LineLikeGeometry>();

  for (const move of moves) {
    const current = nextGeometry.get(move.endpoint.lineId) ??
      getLineLikeOrError(element, move.endpoint, context);
    if (!current) return false;

    const moved = moveEndpoint(current, move.endpoint.endpointKey, move.target, move.targetPointId);
    if (moved.error || !moved.geometry) {
      context.errors.push(
        geometryError(element, `${element.name}: ${moved.error ?? "端点を変更できません。"}`)
      );
      return false;
    }
    nextGeometry.set(move.endpoint.lineId, moved.geometry);
  }

  nextGeometry.forEach((geometry, elementId) => {
    context.computedGeometry.set(elementId, geometry);
  });
  return true;
};

const targetPoint = (element: CadElement, point: Point, name: string): ComputedPoint =>
  computedPoint(`${element.id}:target`, name, point);

export const evaluateModificationElement = (
  element: CadElement,
  context: ElementEvaluationContext
) => {
  if (element.type !== "edge" && element.type !== "extendTrim") return false;

  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    localVariables: { localVariableValues, localVariableNames }
  } = context;

  if (element.type === "edge") {
    if (element.endpoint1.lineId === element.endpoint2.lineId) {
      errors.push(
        geometryError(
          element,
          `${element.name} は同じ線を2回参照しているため、エッジを作れません。端点1と端点2に別の線を指定してください。`
        )
      );
      return true;
    }

    const line1 = getLineLikeOrError(element, element.endpoint1, context);
    const line2 = getLineLikeOrError(element, element.endpoint2, context);
    if (!line1 || !line2) return true;

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
    if (intersectionIndex === undefined) return true;
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
          ? `${element.name} は参照線同士の交点を見つけられません。平行線など、延長しても交差しない線はエッジにできません。`
          : `${element.name} の番号 ${intersectionIndex} に対応する交点はありません。交点数は ${intersectionResult.intersections.length} 個です。`;
      errors.push(geometryError(element, message));
      return true;
    }

    const corner = targetPoint(element, intersection, `${element.name}.交点`);
    applyEndpointMoves(
      element,
      [
        { endpoint: element.endpoint1, target: corner, targetPointId: null },
        { endpoint: element.endpoint2, target: corner, targetPointId: null }
      ],
      context
    );
    return true;
  }

  const point = getPointAnchorOrError(
    element,
    element.point,
    "point",
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId
  );
  if (!point) return true;

  applyEndpointMoves(
    element,
    [
      {
        endpoint: element.endpoint,
        target: point,
        targetPointId: anchorReferenceElementId(element.point)
      }
    ],
    context
  );
  return true;
};
