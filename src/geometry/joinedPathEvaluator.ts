import type {
  CadElement,
  ComputedBezierSegment,
  ComputedJoinedPath,
  ComputedOffsetLineSegment,
  ComputedPoint
} from "../types/geometry";
import { dependencyError, geometryError } from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { CIRCLE_EPSILON, approximateBezierSegmentLength } from "./evaluateGeometryPrimitives";
import { offsetLineEndpointMeasurements } from "./lineMeasurements";
import { isLineLikeGeometry } from "./linePaths";
import { reverseLineLikeGeometry } from "./reversePathGeometry";
import type { LineLikeGeometry } from "./linePaths";

const endpointDistance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const endpointsForGeometry = (geometry: LineLikeGeometry): { start: ComputedPoint; end: ComputedPoint } | null => {
  if (geometry.kind === "bezierCurve") {
    const first = geometry.segments[0];
    const last = geometry.segments.at(-1);
    return first && last ? { start: first.start, end: last.end } : null;
  }
  return geometry.start && geometry.end ? { start: geometry.start, end: geometry.end } : null;
};

const segmentsForGeometry = (geometry: LineLikeGeometry): ComputedOffsetLineSegment[] => {
  if (geometry.kind === "line") {
    return [{ kind: "line", start: geometry.start, end: geometry.end, length: geometry.length }];
  }
  if (geometry.kind === "arcLine") {
    return [{
      kind: "arc",
      center: geometry.center,
      start: geometry.start,
      end: geometry.end,
      radius: geometry.radius,
      startAngleDeg: geometry.startAngleDeg,
      sweepAngleDeg: geometry.sweepAngleDeg,
      length: geometry.length
    }];
  }
  if (geometry.kind === "bezierCurve") {
    return geometry.segments.map((segment: ComputedBezierSegment) => ({
      kind: "bezier",
      start: segment.start,
      control1: segment.control1,
      control2: segment.control2,
      end: segment.end,
      length: approximateBezierSegmentLength(segment)
    }));
  }
  return geometry.segments;
};

export const evaluateJoinedPathElement = (element: CadElement, context: ElementEvaluationContext) => {
  if (element.type !== "joinedPath") return false;
  const { computedGeometry, elementsById, errors, disabledByGroupId } = context;
  if (element.pathIds.length === 0) {
    errors.push(geometryError(element, `${element.name} の paths は空にできません。少なくとも1つの path を指定してください。`));
    return true;
  }

  const orientedSources: LineLikeGeometry[] = [];
  for (const pathId of element.pathIds) {
    const source = computedGeometry.get(pathId);
    if (!isLineLikeGeometry(source)) {
      errors.push(dependencyError(element, pathId, elementsById, disabledByGroupId, errors));
      return true;
    }
    const endpoints = endpointsForGeometry(source);
    if (!endpoints) {
      const sourceElement = elementsById.get(pathId);
      errors.push(geometryError(
        element,
        `${element.name} の path「${sourceElement?.name ?? pathId}」には有効な始点または終点がありません。`
      ));
      return true;
    }
    if (orientedSources.length === 0) {
      orientedSources.push(source);
      continue;
    }
    const currentEnd = endpointsForGeometry(orientedSources.at(-1)!)?.end;
    if (!currentEnd) return true;
    if (endpointDistance(endpoints.start, currentEnd) <= CIRCLE_EPSILON) {
      orientedSources.push(source);
    } else if (endpointDistance(endpoints.end, currentEnd) <= CIRCLE_EPSILON) {
      orientedSources.push(reverseLineLikeGeometry(source));
    } else {
      const sourceElement = elementsById.get(pathId);
      errors.push(geometryError(
        element,
        `${element.name} の path「${sourceElement?.name ?? pathId}」は現在の chain end に接続していません。path の順序または向きを確認してください。`
      ));
      return true;
    }
  }

  const segments = orientedSources.flatMap(segmentsForGeometry);
  const first = orientedSources[0];
  const last = orientedSources.at(-1)!;
  const firstEndpoints = endpointsForGeometry(first)!;
  const lastEndpoints = endpointsForGeometry(last)!;
  if (element.closed && endpointDistance(lastEndpoints.end, firstEndpoints.start) > CIRCLE_EPSILON) {
    errors.push(geometryError(
      element,
      `${element.name} は closed: true ですが、最後の path.end が最初の path.start に接続していません。閉じるための線分は自動生成されません。`
    ));
    return true;
  }

  const measurements = offsetLineEndpointMeasurements(segments);
  const geometry: ComputedJoinedPath = {
    kind: "joinedPath",
    elementId: element.id,
    name: element.name,
    pathIds: [...element.pathIds],
    segments,
    closed: element.closed,
    length: segments.reduce((total, segment) => total + segment.length, 0),
    ...measurements
  };
  // Preserve the exact endpoints from the source geometries even when the
  // source contains only degenerate primitives; no snapping is performed.
  geometry.start = firstEndpoints.start;
  geometry.end = lastEndpoints.end;
  computedGeometry.set(element.id, geometry);
  return true;
};
