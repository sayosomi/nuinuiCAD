import type {
  CadElement,
  ComputedBezierSegment,
  ComputedOffsetLine,
  ComputedOffsetLineSegment,
  ElementId
} from "../types/geometry";
import { dependencyError, geometryError, getPointAnchorOrError } from "./evaluationContext";
import { approximateBezierSegmentLength } from "./evaluateGeometryPrimitives";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { angleOfPoint, computedPoint, degreesToRadians, lineLength } from "./offsetPathMath";
import type { Point, SourceSegment } from "./offsetPathTypes";
import {
  connectSourceSegmentGroups,
  sourceEnd,
  sourceSegmentsForGeometry,
  sourceStart
} from "./offsetSourceSegments";
import { isLineLikeGeometry } from "./linePaths";
import { offsetLineEndpointMeasurements } from "./lineMeasurements";

const reflectPointAcrossAxis = ({
  point,
  axisPoint1,
  axisPoint2
}: {
  point: Point;
  axisPoint1: Point;
  axisPoint2: Point;
}): Point | null => {
  const axis = {
    x: axisPoint2.x - axisPoint1.x,
    y: axisPoint2.y - axisPoint1.y
  };
  const axisLengthSquared = axis.x * axis.x + axis.y * axis.y;
  if (axisLengthSquared <= 0) return null;

  const relative = {
    x: point.x - axisPoint1.x,
    y: point.y - axisPoint1.y
  };
  const projectionScale = (relative.x * axis.x + relative.y * axis.y) / axisLengthSquared;
  const projection = {
    x: axis.x * projectionScale,
    y: axis.y * projectionScale
  };

  return {
    x: axisPoint1.x + 2 * projection.x - relative.x,
    y: axisPoint1.y + 2 * projection.y - relative.y
  };
};

const transformedSegment = ({
  segment,
  elementId,
  name,
  index,
  axisPoint1,
  axisPoint2
}: {
  segment: SourceSegment;
  elementId: ElementId;
  name: string;
  index: number;
  axisPoint1: Point;
  axisPoint2: Point;
}): ComputedOffsetLineSegment | null => {
  const transform = (point: Point) => {
    const reflected = reflectPointAcrossAxis({ point, axisPoint1, axisPoint2 });
    return reflected
      ? computedPoint(`${elementId}:${index}`, `${name}.${index + 1}`, reflected)
      : null;
  };

  if (segment.kind === "line") {
    const start = transform(segment.start);
    const end = transform(segment.end);
    if (!start || !end) return null;
    const length = lineLength(start, end);
    return length <= 0 ? null : { kind: "line", start, end, length };
  }

  if (segment.kind === "bezier") {
    const start = transform(segment.start);
    const control1 = reflectPointAcrossAxis({ point: segment.control1, axisPoint1, axisPoint2 });
    const control2 = reflectPointAcrossAxis({ point: segment.control2, axisPoint1, axisPoint2 });
    const end = transform(segment.end);
    if (!start || !control1 || !control2 || !end) return null;
    const bezierSegment: ComputedBezierSegment = {
      startPointId: null,
      endPointId: null,
      start,
      control1,
      control2,
      end
    };
    return {
      kind: "bezier",
      start,
      control1,
      control2,
      end,
      length: approximateBezierSegmentLength(bezierSegment)
    };
  }

  const center = transform(segment.center);
  const start = transform(sourceStart(segment));
  const end = transform(sourceEnd(segment));
  if (!center || !start || !end) return null;
  const startAngleDeg = angleOfPoint(center, start);
  const sweepAngleDeg = -segment.sweepAngleDeg;
  return {
    kind: "arc",
    center,
    start,
    end,
    radius: segment.radius,
    startAngleDeg,
    sweepAngleDeg,
    length: Math.max(segment.radius, 0) * Math.abs(degreesToRadians(sweepAngleDeg))
  };
};

export const evaluateSymmetricCopyLineElement = (
  element: CadElement,
  context: ElementEvaluationContext
) => {
  if (element.type !== "symmetricCopyLine") return false;

  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    localVariables: { localVariableValues, localVariableNames }
  } = context;

  const axisPoint1 = getPointAnchorOrError(
    element,
    element.axisPoint1,
    "axisPoint1",
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId
  );
  const axisPoint2 = getPointAnchorOrError(
    element,
    element.axisPoint2,
    "axisPoint2",
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId
  );
  if (!axisPoint1 || !axisPoint2) return true;
  if (lineLength(axisPoint1, axisPoint2) <= 0) {
    errors.push(geometryError(element, `${element.name} の対称軸は同じ点を2回指定できません。`));
    return true;
  }

  const sourceSegmentGroups: SourceSegment[][] = [];
  let hasMissingBase = false;
  for (const baseLineId of element.baseLineIds) {
    const geometry = computedGeometry.get(baseLineId);
    if (!isLineLikeGeometry(geometry)) {
      errors.push(dependencyError(element, baseLineId, elementsById, disabledByGroupId));
      hasMissingBase = true;
      continue;
    }
    const segments = sourceSegmentsForGeometry(geometry);
    if (segments.length > 0) sourceSegmentGroups.push(segments);
  }
  if (hasMissingBase) return true;
  if (sourceSegmentGroups.length === 0) {
    errors.push(geometryError(element, `${element.name} は基準線から作図できる線分がありません。基準線を指定してください。`));
    return true;
  }

  const sourceSegments = connectSourceSegmentGroups(sourceSegmentGroups, false);
  if (!sourceSegments) {
    errors.push(geometryError(element, `${element.name} の基準線は指定順・指定方向で連続していません。reverse を使うか順序を見直してください。`));
    return true;
  }
  const segments = sourceSegments.flatMap((segment, index) => {
    const transformed = transformedSegment({
      segment,
      elementId: element.id,
      name: element.name,
      index,
      axisPoint1,
      axisPoint2
    });
    return transformed ? [transformed] : [];
  });

  if (segments.length === 0) {
    errors.push(geometryError(element, `${element.name} は基準線から作図できる長さの線分がありません。`));
    return true;
  }

  const geometry: ComputedOffsetLine = {
    kind: "offsetLine",
    elementId: element.id,
    name: element.name,
    baseLineIds: element.baseLineIds,
    ...offsetLineEndpointMeasurements(segments),
    segments,
    closed: false,
    length: segments.reduce((sum, segment) => sum + segment.length, 0)
  };
  computedGeometry.set(element.id, geometry);
  return true;
};
