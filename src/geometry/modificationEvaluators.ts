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
import {
  arcTangentAngles,
  lineTangentAngles,
  offsetLineEndpointMeasurements,
  offsetSegmentEndForwardAngle,
  offsetSegmentStartForwardAngle
} from "./lineMeasurements";
import { findLineIntersections } from "./lineIntersections";
import { isLineLikeGeometry, type LineLikeGeometry } from "./linePaths";
import {
  dependencyError,
  geometryError,
  getPointAnchorOrError,
  numericError
} from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import {
  cubicPointAt,
  distance as bmDistance,
  projectPointOntoCurve,
  splitBezierLike,
  type CurveProjection
} from "./bezierMath";
import { bestSampleHit, refineOffsetSampleHit, splitOffsetSegment } from "./splitLineEvaluator";

type Point = { x: number; y: number };

type EndpointMoveResult =
  | { geometry: LineLikeGeometry; error?: undefined }
  | { geometry?: undefined; error: string };

const EPSILON = 1e-9;
const TOLERANCE_MM = 0.001;

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
    ...lineTangentAngles(start, end)
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
    y: center.y + Math.sin(angleRad) * radius
  };
};

const angleOfPoint = (center: Point, point: Point) =>
  normalizeDegrees(radiansToDegrees(Math.atan2(point.y - center.y, point.x - center.x)));

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
      ...arcTangentAngles({ startAngleDeg, endAngleDeg, sweepAngleDeg }),
      sweepAngleDeg,
      start: computedPoint(`${arc.elementId}:start`, `${arc.name}.始点`, arcPoint(arc.center, arc.radius, startAngleDeg)),
      end: computedPoint(`${arc.elementId}:end`, `${arc.name}.終点`, arcPoint(arc.center, arc.radius, endAngleDeg)),
      length: Math.max(arc.radius, 0) * Math.abs(degreesToRadians(sweepAngleDeg))
    }
  };
};

const pointOnAngleLine = (point: Point, origin: Point, angleDeg: number) => {
  const angleRad = degreesToRadians(angleDeg);
  const direction = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
  return Math.abs((point.x - origin.x) * direction.y - (point.y - origin.y) * direction.x);
};

const angleBetween = (start: Point, end: Point): number | null => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.hypot(dx, dy) <= EPSILON) return null;
  return normalizeDegrees(radiansToDegrees(Math.atan2(dy, dx)));
};

// Shorten the curve by truncating it at an on-body point (de Casteljau split),
// keeping start->split when moving the end, or split->end when moving the start.
const truncateBezierAtBody = (
  curve: ComputedBezierCurve,
  endpointKey: LineEndpointReference["endpointKey"],
  hit: CurveProjection,
  targetPointId: ElementId | null
): EndpointMoveResult => {
  const original = curve.segments[hit.segmentIndex];
  const split = splitBezierLike(original, hit.localT);

  if (endpointKey === "end") {
    const truncated: ComputedBezierSegment = {
      ...original,
      endPointId: targetPointId,
      control1: split.left.control1,
      control2: split.left.control2,
      end: computedPoint(`${curve.elementId}:end`, `${curve.name}.終点`, split.point)
    };
    const segments = [...curve.segments.slice(0, hit.segmentIndex), truncated];
    const length = segments.reduce((sum, segment) => sum + approximateBezierSegmentLength(segment), 0);
    if (length <= EPSILON) {
      return { error: `${curve.name} の端点移動後の長さが0になるため、変更できません。` };
    }
    const endHandleAngle = angleBetween(split.left.control2, split.point) ?? curve.endHandleAngleDeg;
    const geometry: ComputedBezierCurve = {
      ...curve,
      endPointId: targetPointId,
      segments,
      length,
      endHandleAngleDeg: endHandleAngle,
      endHandleLength: bmDistance(split.left.control2, split.point),
      endTangentAngleDeg: normalizeDegrees(endHandleAngle + 180),
      intermediatePointIds: curve.intermediatePointIds.slice(0, hit.segmentIndex)
    };
    if (hit.segmentIndex === 0) {
      // The truncated segment is also the first segment, so the curve's own
      // start handle (segments[0].control1) shrank along with it.
      const startHandleAngle = angleBetween(original.start, split.left.control1) ?? curve.startHandleAngleDeg;
      geometry.startHandleAngleDeg = startHandleAngle;
      geometry.startHandleLength = bmDistance(original.start, split.left.control1);
      geometry.startTangentAngleDeg = normalizeDegrees(startHandleAngle);
    }
    return { geometry };
  }

  const truncated: ComputedBezierSegment = {
    ...original,
    startPointId: targetPointId,
    control1: split.right.control1,
    control2: split.right.control2,
    start: computedPoint(`${curve.elementId}:start`, `${curve.name}.始点`, split.point)
  };
  const segments = [truncated, ...curve.segments.slice(hit.segmentIndex + 1)];
  const length = segments.reduce((sum, segment) => sum + approximateBezierSegmentLength(segment), 0);
  if (length <= EPSILON) {
    return { error: `${curve.name} の端点移動後の長さが0になるため、変更できません。` };
  }
  const startHandleAngle = angleBetween(split.point, split.right.control1) ?? curve.startHandleAngleDeg;
  const geometry: ComputedBezierCurve = {
    ...curve,
    startPointId: targetPointId,
    segments,
    length,
    startHandleAngleDeg: startHandleAngle,
    startHandleLength: bmDistance(split.point, split.right.control1),
    startTangentAngleDeg: normalizeDegrees(startHandleAngle),
    intermediatePointIds: curve.intermediatePointIds.slice(hit.segmentIndex)
  };
  if (hit.segmentIndex === curve.segments.length - 1) {
    // The truncated segment is also the last segment, so the curve's own end
    // handle (segments[last].control2) shrank along with it.
    const endHandleAngle = angleBetween(split.right.control2, original.end) ?? curve.endHandleAngleDeg;
    geometry.endHandleAngleDeg = endHandleAngle;
    geometry.endHandleLength = bmDistance(split.right.control2, original.end);
    geometry.endTangentAngleDeg = normalizeDegrees(endHandleAngle + 180);
  }
  return { geometry };
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

  // On the curve body: shorten by truncating at the point.
  const hit = projectPointOntoCurve(curve.segments, target);
  if (hit && hit.distance <= TOLERANCE_MM) {
    const globalT = hit.segmentIndex + hit.localT;
    const interior =
      endpointKey === "end" ? globalT > EPSILON : globalT < curve.segments.length - EPSILON;
    if (interior) {
      return truncateBezierAtBody(curve, endpointKey, hit, targetPointId);
    }
    // On the curve body but at (or past) the opposite endpoint: the move
    // would collapse the curve to zero length.
    return { error: `${curve.name} の端点移動後の長さが0になるため、変更できません。` };
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

const analyticOffsetGeometry = (
  line: ComputedOffsetLine,
  segments: ComputedOffsetLineSegment[]
): ComputedOffsetLine | null => {
  if (segments.length === 0) return null;
  return {
    ...line,
    closed: false,
    ...offsetLineEndpointMeasurements(segments),
    segments,
    length: segments.reduce((sum, segment) => sum + segment.length, 0)
  };
};

const offsetZeroLengthError = (name: string): EndpointMoveResult => ({
  error: `${name} の端点移動後の長さが0になるため、変更できません。`
});

// Truncate the offset line at an on-body point (analytic de Casteljau split
// for bezier sub-segments, sweep split for arcs), keeping every other segment
// -- including untouched bezier/arc sub-segments -- byte-for-byte unchanged.
const truncateOffsetAtBody = (
  line: ComputedOffsetLine,
  endpointKey: LineEndpointReference["endpointKey"],
  hit: { segmentIndex: number; localT: number; point: Point }
): EndpointMoveResult => {
  const [left, right] = splitOffsetSegment(line.segments[hit.segmentIndex], hit.localT, hit.point);

  if (endpointKey === "end") {
    const truncated: ComputedOffsetLineSegment = {
      ...left,
      end: computedPoint(`${line.elementId}:end`, `${line.name}.終点`, hit.point)
    };
    const segments = [...line.segments.slice(0, hit.segmentIndex), truncated];
    const geometry = analyticOffsetGeometry(line, segments);
    return geometry ? { geometry } : offsetZeroLengthError(line.name);
  }

  const truncated: ComputedOffsetLineSegment = {
    ...right,
    start: computedPoint(`${line.elementId}:start`, `${line.name}.始点`, hit.point)
  };
  const segments = [truncated, ...line.segments.slice(hit.segmentIndex + 1)];
  const geometry = analyticOffsetGeometry(line, segments);
  return geometry ? { geometry } : offsetZeroLengthError(line.name);
};

// Extend by moving the terminal segment's own endpoint when it is a line, or
// by appending a new straight segment along the analytic endpoint tangent
// when the terminal segment is a bezier/arc sub-segment -- leaving every
// existing segment untouched either way.
const extendOffsetAlongTangent = (
  line: ComputedOffsetLine,
  endpointKey: LineEndpointReference["endpointKey"],
  target: Point
): EndpointMoveResult => {
  if (endpointKey === "start") {
    const first = line.segments[0];
    if (first.kind === "line") {
      const updated: ComputedOffsetLineSegment = {
        ...first,
        start: computedPoint(`${line.elementId}:start`, `${line.name}.始点`, target),
        length: distance(target, first.end)
      };
      const geometry = analyticOffsetGeometry(line, [updated, ...line.segments.slice(1)]);
      return geometry ? { geometry } : offsetZeroLengthError(line.name);
    }
    const anchor = first.start;
    const extension: ComputedOffsetLineSegment = {
      kind: "line",
      start: computedPoint(`${line.elementId}:start`, `${line.name}.始点`, target),
      end: computedPoint(`${line.elementId}:extension:start`, `${line.name}.延長始点`, anchor),
      length: distance(target, anchor)
    };
    const geometry = analyticOffsetGeometry(line, [extension, ...line.segments]);
    return geometry ? { geometry } : offsetZeroLengthError(line.name);
  }

  const last = line.segments.at(-1)!;
  if (last.kind === "line") {
    const updated: ComputedOffsetLineSegment = {
      ...last,
      end: computedPoint(`${line.elementId}:end`, `${line.name}.終点`, target),
      length: distance(last.start, target)
    };
    const geometry = analyticOffsetGeometry(line, [...line.segments.slice(0, -1), updated]);
    return geometry ? { geometry } : offsetZeroLengthError(line.name);
  }
  const anchor = last.end;
  const extension: ComputedOffsetLineSegment = {
    kind: "line",
    start: computedPoint(`${line.elementId}:extension:end`, `${line.name}.延長終点`, anchor),
    end: computedPoint(`${line.elementId}:end`, `${line.name}.終点`, target),
    length: distance(anchor, target)
  };
  const geometry = analyticOffsetGeometry(line, [...line.segments, extension]);
  return geometry ? { geometry } : offsetZeroLengthError(line.name);
};

const moveOffsetEndpoint = (
  line: ComputedOffsetLine,
  endpointKey: LineEndpointReference["endpointKey"],
  target: ComputedPoint
): EndpointMoveResult => {
  if (line.closed) {
    return { error: `${line.name} は閉じた線のため、端点を変更できません。` };
  }
  if (line.segments.length === 0) {
    return { error: `${line.name} は端点方向を決められないため、変更できません。` };
  }

  const { hit } = bestSampleHit(
    target,
    line.segments.map((segment) => ({
      length: segment.length,
      pointAt: (t: number) =>
        segment.kind === "line"
          ? interpolate(segment.start, segment.end, t)
          : segment.kind === "bezier"
            ? cubicPointAt(segment, t)
            : arcPoint(segment.center, Math.max(segment.radius, 0), segment.startAngleDeg + segment.sweepAngleDeg * t)
    }))
  );

  const refinedHit = hit ? refineOffsetSampleHit(target, line.segments, hit) : null;
  if (refinedHit && refinedHit.distanceFromLine <= TOLERANCE_MM) {
    const interior =
      endpointKey === "end"
        ? refinedHit.segmentIndex > 0 || refinedHit.localT > EPSILON
        : refinedHit.segmentIndex < line.segments.length - 1 || refinedHit.localT < 1 - EPSILON;
    if (interior) {
      return truncateOffsetAtBody(line, endpointKey, refinedHit);
    }
    return offsetZeroLengthError(line.name);
  }

  const terminal = endpointKey === "start" ? line.segments[0] : line.segments.at(-1)!;
  const forwardAngle =
    endpointKey === "start" ? offsetSegmentStartForwardAngle(terminal) : offsetSegmentEndForwardAngle(terminal);
  if (forwardAngle === null) {
    return { error: `${line.name} は端点方向を決められないため、変更できません。` };
  }
  const anchor = endpointKey === "start" ? terminal.start : terminal.end;
  const forwardRad = degreesToRadians(forwardAngle);
  const forward = { x: Math.cos(forwardRad), y: Math.sin(forwardRad) };
  const tangentDistance = Math.abs((target.x - anchor.x) * forward.y - (target.y - anchor.y) * forward.x);
  if (tangentDistance > TOLERANCE_MM) {
    return {
      error: `${line.name} の${endpointKey === "start" ? "始点" : "終点"}は、指定点が線上または端点接線の延長上にないため移動できません。`
    };
  }

  return extendOffsetAlongTangent(line, endpointKey, target);
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
