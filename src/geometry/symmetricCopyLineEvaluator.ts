import type {
  CadElement,
  ComputedOffsetLine,
  ComputedOffsetLineSegment,
} from "../types/geometry";
import { dependencyError, geometryError, getPointAnchorOrError } from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import type { ComputedGeometryValueOffsetLineSegment } from "./evaluationTypes";
import { computedPoint, lineLength } from "./offsetPathMath";
import { copyPathGeometry, type CopyPathTransform } from "./copyPathGeometry";
import type { SourceSegment } from "./offsetPathTypes";
import {
  connectSourceSegmentGroups,
  sourceSegmentsForGeometry
} from "./offsetSourceSegments";
import { isLineLikeGeometryInput } from "./linePaths";
import { resolveLineGeometryInputAt } from "./lineGeometryInput";
import { offsetLineEndpointMeasurements } from "./lineMeasurements";

const decorateSegment = (
  segment: ComputedGeometryValueOffsetLineSegment,
  elementId: string,
  name: string,
  index: number
): ComputedOffsetLineSegment => {
  const point = (value: { x: number; y: number }) => computedPoint(`${elementId}:${index}`, `${name}.${index + 1}`, value);
  if (segment.kind === "line") return { ...segment, start: point(segment.start), end: point(segment.end) };
  if (segment.kind === "bezier") {
    return {
      ...segment,
      start: point(segment.start),
      control1: segment.control1,
      control2: segment.control2,
      end: point(segment.end)
    };
  }
  return {
    ...segment,
    center: point(segment.center),
    start: point(segment.start),
    end: point(segment.end)
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
    computedGeometryValues,
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
    disabledByGroupId,
    undefined,
    computedGeometryValues
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
    disabledByGroupId,
    undefined,
    computedGeometryValues
  );
  if (!axisPoint1 || !axisPoint2) return true;
  if (lineLength(axisPoint1, axisPoint2) <= 0) {
    errors.push(geometryError(element, `${element.name} の対称軸は同じ点を2回指定できません。`));
    return true;
  }

  const sourceSegmentGroups: SourceSegment[][] = [];
  let hasMissingBase = false;
  for (const [index, baseLineId] of element.baseLineIds.entries()) {
    const geometry = resolveLineGeometryInputAt(context, "baseLineIds", index, baseLineId);
    if (!isLineLikeGeometryInput(geometry)) {
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
  const transform: CopyPathTransform = { kind: "mirror", axis1: axisPoint1, axis2: axisPoint2 };
  const structuralSegments = copyPathGeometry(sourceSegments, transform)?.segments ?? [];
  const segments = structuralSegments.map((segment, index) => decorateSegment(segment, element.id, element.name, index));

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
