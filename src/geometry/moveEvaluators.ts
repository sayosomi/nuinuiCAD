import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedBezierSegment,
  ComputedLine,
  ComputedOffsetLine,
  ComputedOffsetLineSegment,
  ComputedPoint,
  ElementId
} from "../types/geometry";
import { elementDisplayName } from "../model/elementNames";
import { dependencyError, geometryError, getPointAnchorOrError, numericError } from "./evaluationContext";
import { approximateBezierSegmentLength } from "./evaluateGeometryPrimitives";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { isLineLikeGeometry, type LineLikeGeometry } from "./linePaths";
import { arcTangentAngles, lineTangentAngles, offsetLineEndpointMeasurements } from "./lineMeasurements";
import { angleOfPoint, degreesToRadians, lineLength, normalizeDegrees, radiansToDegrees } from "./offsetPathMath";
import type { Point } from "./offsetPathTypes";

type TransformPoint = (point: Point) => Point | null;

const lineAngleDeg = (start: Point, end: Point) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return length <= 0 ? null : normalizeDegrees(radiansToDegrees(Math.atan2(dy, dx)));
};

const pointAngleDeg = (start: Point, end: Point) => lineAngleDeg(start, end) ?? 0;

const transformComputedPoint = (
  point: ComputedPoint,
  transform: TransformPoint
): ComputedPoint | null => {
  const transformed = transform(point);
  return transformed ? { ...point, x: transformed.x, y: transformed.y } : null;
};

const moveTransform = ({
  startPoint,
  endPoint,
  angleDeg,
  mirrorX,
  scale
}: {
  startPoint: Point;
  endPoint: Point;
  angleDeg: number;
  mirrorX: boolean;
  scale: number;
}): TransformPoint => {
  const translation = {
    x: endPoint.x - startPoint.x,
    y: endPoint.y - startPoint.y
  };
  const angleRad = degreesToRadians(angleDeg);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  return (point) => {
    const moved = {
      x: point.x + translation.x,
      y: point.y + translation.y
    };
    const mirrored = mirrorX
      ? {
          x: 2 * endPoint.x - moved.x,
          y: moved.y
        }
      : moved;
    const dx = mirrored.x - endPoint.x;
    const dy = mirrored.y - endPoint.y;
    const scaledDx = dx * scale;
    const scaledDy = dy * scale;
    return {
      x: endPoint.x + scaledDx * cos - scaledDy * sin,
      y: endPoint.y + scaledDx * sin + scaledDy * cos
    };
  };
};

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

const transformLine = (line: ComputedLine, transform: TransformPoint): LineLikeGeometry | null => {
  const start = transformComputedPoint(line.start, transform);
  const end = transformComputedPoint(line.end, transform);
  if (!start || !end) return null;
  const length = lineLength(start, end);
  if (length <= 0) return null;
  return {
    ...line,
    start,
    end,
    length,
    ...lineTangentAngles(start, end)
  };
};

const transformArcLine = (
  arc: ComputedArcLine,
  transform: TransformPoint,
  reverseSweep: boolean
): LineLikeGeometry | null => {
  const center = transformComputedPoint(arc.center, transform);
  const start = transformComputedPoint(arc.start, transform);
  const end = transformComputedPoint(arc.end, transform);
  if (!center || !start || !end) return null;
  const radius = lineLength(center, start);
  if (radius <= 0) return null;
  const sweepAngleDeg = reverseSweep ? -arc.sweepAngleDeg : arc.sweepAngleDeg;
  return {
    ...arc,
    center,
    start,
    end,
    radius,
    startAngleDeg: angleOfPoint(center, start),
    endAngleDeg: angleOfPoint(center, end),
    ...arcTangentAngles({
      startAngleDeg: angleOfPoint(center, start),
      endAngleDeg: angleOfPoint(center, end),
      sweepAngleDeg
    }),
    sweepAngleDeg,
    length: radius * Math.abs(degreesToRadians(sweepAngleDeg))
  };
};

const transformBezierSegment = (
  segment: ComputedBezierSegment,
  transform: TransformPoint
): ComputedBezierSegment | null => {
  const start = transformComputedPoint(segment.start, transform);
  const end = transformComputedPoint(segment.end, transform);
  const control1 = transform(segment.control1);
  const control2 = transform(segment.control2);
  if (!start || !end || !control1 || !control2) return null;
  return {
    ...segment,
    start,
    control1,
    control2,
    end
  };
};

const transformBezierCurve = (
  curve: ComputedBezierCurve,
  transform: TransformPoint
): LineLikeGeometry | null => {
  const segments = curve.segments
    .map((segment) => transformBezierSegment(segment, transform))
    .filter((segment): segment is ComputedBezierSegment => Boolean(segment));
  if (segments.length !== curve.segments.length || segments.length === 0) return null;
  const length = segments.reduce((sum, segment) => sum + approximateBezierSegmentLength(segment), 0);
  if (length <= 0) return null;
  const firstSegment = segments[0];
  const lastSegment = segments.at(-1)!;
  return {
    ...curve,
    segments,
    length,
    startHandleAngleDeg: pointAngleDeg(firstSegment.start, firstSegment.control1),
    startHandleLength: lineLength(firstSegment.start, firstSegment.control1),
    endHandleAngleDeg: normalizeDegrees(pointAngleDeg(lastSegment.end, lastSegment.control2) - 180),
    endHandleLength: lineLength(lastSegment.end, lastSegment.control2),
    startTangentAngleDeg: pointAngleDeg(firstSegment.start, firstSegment.control1),
    endTangentAngleDeg: pointAngleDeg(lastSegment.end, lastSegment.control2)
  };
};

const transformOffsetSegment = (
  segment: ComputedOffsetLineSegment,
  transform: TransformPoint,
  reverseSweep: boolean
): ComputedOffsetLineSegment | null => {
  if (segment.kind === "line") {
    const start = transformComputedPoint(segment.start, transform);
    const end = transformComputedPoint(segment.end, transform);
    if (!start || !end) return null;
    const length = lineLength(start, end);
    return length <= 0 ? null : { ...segment, start, end, length };
  }

  if (segment.kind === "bezier") {
    const start = transformComputedPoint(segment.start, transform);
    const end = transformComputedPoint(segment.end, transform);
    const control1 = transform(segment.control1);
    const control2 = transform(segment.control2);
    if (!start || !end || !control1 || !control2) return null;
    const bezierSegment: ComputedBezierSegment = {
      startPointId: null,
      endPointId: null,
      start,
      control1,
      control2,
      end
    };
    return {
      ...segment,
      start,
      control1,
      control2,
      end,
      length: approximateBezierSegmentLength(bezierSegment)
    };
  }

  const center = transformComputedPoint(segment.center, transform);
  const start = transformComputedPoint(segment.start, transform);
  const end = transformComputedPoint(segment.end, transform);
  if (!center || !start || !end) return null;
  const radius = lineLength(center, start);
  if (radius <= 0) return null;
  const sweepAngleDeg = reverseSweep ? -segment.sweepAngleDeg : segment.sweepAngleDeg;
  return {
    ...segment,
    center,
    start,
    end,
    radius,
    startAngleDeg: angleOfPoint(center, start),
    sweepAngleDeg,
    length: radius * Math.abs(degreesToRadians(sweepAngleDeg))
  };
};

const transformOffsetLine = (
  line: ComputedOffsetLine,
  transform: TransformPoint,
  reverseSweep: boolean
): LineLikeGeometry | null => {
  const segments = line.segments
    .map((segment) => transformOffsetSegment(segment, transform, reverseSweep))
    .filter((segment): segment is ComputedOffsetLineSegment => Boolean(segment));
  if (segments.length !== line.segments.length || segments.length === 0) return null;
  return {
    ...line,
    segments,
    ...offsetLineEndpointMeasurements(segments),
    length: segments.reduce((sum, segment) => sum + segment.length, 0)
  };
};

const transformLineLikeGeometry = (
  geometry: LineLikeGeometry,
  transform: TransformPoint,
  reverseOrientation: boolean
): LineLikeGeometry | null => {
  if (geometry.kind === "line") return transformLine(geometry, transform);
  if (geometry.kind === "arcLine") return transformArcLine(geometry, transform, reverseOrientation);
  if (geometry.kind === "bezierCurve") return transformBezierCurve(geometry, transform);
  return transformOffsetLine(geometry, transform, reverseOrientation);
};

const applyTransformToTargets = ({
  element,
  context,
  transform,
  reverseOrientation
}: {
  element: Extract<CadElement, { type: "move" | "symmetricMove" }>;
  context: ElementEvaluationContext;
  transform: TransformPoint;
  reverseOrientation: boolean;
}) => {
  if (element.baseLineIds.length === 0) {
    context.errors.push(geometryError(element, `${elementDisplayName(element)} は対象線が指定されていません。対象線を指定してください。`));
    return;
  }

  const nextGeometry = new Map<ElementId, LineLikeGeometry>();
  for (const baseLineId of element.baseLineIds) {
    const current = nextGeometry.get(baseLineId) ?? context.computedGeometry.get(baseLineId);
    if (!isLineLikeGeometry(current)) {
      context.errors.push(
        dependencyError(element, baseLineId, context.elementsById, context.disabledByGroupId)
      );
      return;
    }

    const transformed = transformLineLikeGeometry(current, transform, reverseOrientation);
    if (!transformed) {
      context.errors.push(geometryError(element, `${elementDisplayName(element)}: ${current.name} を移動できません。`));
      return;
    }
    nextGeometry.set(baseLineId, transformed);
  }

  nextGeometry.forEach((geometry, elementId) => {
    context.computedGeometry.set(elementId, geometry);
  });
};

export const evaluateMoveElement = (element: CadElement, context: ElementEvaluationContext) => {
  if (element.type !== "move" && element.type !== "symmetricMove") return false;

  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    localVariables: { localVariableValues, localVariableNames }
  } = context;

  if (element.type === "move") {
    const startPoint = getPointAnchorOrError(
      element,
      element.startPoint,
      "start",
      computedGeometry,
      elementsById,
      errors,
      localVariableValues,
      localVariableNames,
      disabledByGroupId
    );
    const endPoint = getPointAnchorOrError(
      element,
      element.endPoint,
      "end",
      computedGeometry,
      elementsById,
      errors,
      localVariableValues,
      localVariableNames,
      disabledByGroupId
    );
    const angleDeg = numericError(
      element,
      element.angleDeg,
      computedGeometry,
      elementsById,
      errors,
      localVariableValues,
      localVariableNames,
      disabledByGroupId
    );
    const scale = numericError(
      element,
      element.scale ?? 1,
      computedGeometry,
      elementsById,
      errors,
      localVariableValues,
      localVariableNames,
      disabledByGroupId
    );
    if (!startPoint || !endPoint || angleDeg === undefined || scale === undefined) return true;
    if (scale <= 0) {
      errors.push(geometryError(element, `${elementDisplayName(element)} は倍率が0以下のため移動できません。倍率を正の値にしてください。`));
      return true;
    }

    applyTransformToTargets({
      element,
      context,
      transform: moveTransform({ startPoint, endPoint, angleDeg, mirrorX: element.mirrorX, scale }),
      reverseOrientation: element.mirrorX
    });
    return true;
  }

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
    errors.push(geometryError(element, `${elementDisplayName(element)} の対称軸は同じ点を2回指定できません。`));
    return true;
  }

  applyTransformToTargets({
    element,
    context,
    transform: (point) => reflectPointAcrossAxis({ point, axisPoint1, axisPoint2 }),
    reverseOrientation: true
  });
  return true;
};
