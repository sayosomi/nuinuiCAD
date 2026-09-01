import type {
  CadElement,
  ComputedBezierSegment,
  ComputedOffsetLine,
  ComputedOffsetLineSegment,
  ElementId
} from "../types/geometry";
import { dependencyError, geometryError, getPointAnchorOrError, numericError } from "./evaluationContext";
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

const transformPoint = ({
  point,
  translation,
  mirrorX,
  rotationCenter,
  angleRad,
  scale
}: {
  point: Point;
  translation: Point;
  mirrorX: boolean;
  rotationCenter: Point;
  angleRad: number;
  scale: number;
}): Point => {
  const moved = {
    x: point.x + translation.x,
    y: point.y + translation.y
  };
  const mirrored = mirrorX
    ? {
        x: 2 * rotationCenter.x - moved.x,
        y: moved.y
      }
    : moved;
  const dx = mirrored.x - rotationCenter.x;
  const dy = mirrored.y - rotationCenter.y;
  const scaledDx = dx * scale;
  const scaledDy = dy * scale;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  return {
    x: rotationCenter.x + scaledDx * cos - scaledDy * sin,
    y: rotationCenter.y + scaledDx * sin + scaledDy * cos
  };
};

const transformedSegment = ({
  segment,
  elementId,
  name,
  index,
  translation,
  mirrorX,
  rotationCenter,
  angleRad,
  scale
}: {
  segment: SourceSegment;
  elementId: ElementId;
  name: string;
  index: number;
  translation: Point;
  mirrorX: boolean;
  rotationCenter: Point;
  angleRad: number;
  scale: number;
}): ComputedOffsetLineSegment | null => {
  const transform = (point: Point) =>
    computedPoint(
      `${elementId}:${index}`,
      `${name}.${index + 1}`,
      transformPoint({ point, translation, mirrorX, rotationCenter, angleRad, scale })
    );

  if (segment.kind === "line") {
    const start = transform(segment.start);
    const end = transform(segment.end);
    const length = lineLength(start, end);
    return length <= 0 ? null : { kind: "line", start, end, length };
  }

  if (segment.kind === "bezier") {
    const start = transform(segment.start);
    const control1 = transform(segment.control1);
    const control2 = transform(segment.control2);
    const end = transform(segment.end);
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
  const radius = lineLength(center, start);
  const startAngleDeg = angleOfPoint(center, start);
  const sweepAngleDeg = mirrorX
    ? -segment.sweepAngleDeg
    : segment.sweepAngleDeg;
  return {
    kind: "arc",
    center,
    start,
    end,
    radius,
    startAngleDeg,
    sweepAngleDeg,
    length: radius * Math.abs(degreesToRadians(sweepAngleDeg))
  };
};

export const evaluateCopyLineElement = (element: CadElement, context: ElementEvaluationContext) => {
  if (element.type !== "copyLine") return false;

  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    localVariables: { localVariableValues, localVariableNames }
  } = context;

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
    localVariableNames
  );
  const scale = numericError(
    element,
    element.scale ?? 1,
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames
  );
  if (!startPoint || !endPoint || angleDeg === undefined || scale === undefined) return true;
  if (scale <= 0) {
    errors.push(geometryError(element, `${element.name} は倍率が0以下のためコピーできません。倍率を正の値にしてください。`));
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
  const translation = {
    x: endPoint.x - startPoint.x,
    y: endPoint.y - startPoint.y
  };
  const angleRad = degreesToRadians(angleDeg);
  const segments = sourceSegments.flatMap((segment, index) => {
    const transformed = transformedSegment({
      segment,
      elementId: element.id,
      name: element.name,
      index,
      translation,
      mirrorX: element.mirrorX,
      rotationCenter: endPoint,
      angleRad,
      scale
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
