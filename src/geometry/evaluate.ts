import type {
  CadElement,
  ComputedBezierSegment,
  ComputedGeometry,
  ComputedPoint,
  DependencyError,
  ElementId,
  NumericValue,
  EvaluationResult,
  PointAnchor
} from "../types/geometry";
import { evaluateNumericValue } from "./numericExpressions";
import { pointAtDistanceFromEndpoint, isLineLikeGeometry } from "./linePaths";
import { buildOffsetLineGeometry } from "./offsetPaths";
import {
  anchorReferenceElementId,
  pointAnchorForElement,
  resolveDerivedPoint
} from "../model/pointAnchors";

const isPoint = (
  geometry: ComputedGeometry | undefined
): geometry is ComputedPoint => geometry?.kind === "point";

const findElementName = (
  elementsById: Map<ElementId, CadElement>,
  id: ElementId
) => elementsById.get(id)?.name;

const dependencyError = (
  element: CadElement,
  missingDependencyId: ElementId,
  elementsById: Map<ElementId, CadElement>
): DependencyError => {
  const missingDependencyName = findElementName(elementsById, missingDependencyId);
  const dependencyLabel = missingDependencyName ?? missingDependencyId;

  return {
    elementId: element.id,
    elementName: element.name,
    missingDependencyId,
    missingDependencyName,
    message: `${element.name} は ${dependencyLabel} を参照していますが、${dependencyLabel} はこの要素より後にあるか、存在しません。${dependencyLabel} を ${element.name} より前に移動してください。`
  };
};

const geometryError = (element: CadElement, message: string): DependencyError => ({
  elementId: element.id,
  elementName: element.name,
  missingDependencyId: element.id,
  missingDependencyName: element.name,
  message
});

const getComputedPointOrError = (
  element: CadElement,
  pointId: ElementId,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[]
) => {
  const point = computedGeometry.get(pointId);
  if (!isPoint(point)) {
    errors.push(dependencyError(element, pointId, elementsById));
    return undefined;
  }

  return point;
};

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;
const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;
const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;
const positiveSweepDegrees = (startAngleDeg: number, endAngleDeg: number) =>
  normalizeDegrees(endAngleDeg - startAngleDeg);
const CURVE_LENGTH_STEPS = 32;
const CIRCLE_EPSILON = 1e-9;

const circleThroughThreePoints = (
  point1: ComputedPoint,
  point2: ComputedPoint,
  point3: ComputedPoint
) => {
  const denominator =
    2 *
    (point1.x * (point2.y - point3.y) +
      point2.x * (point3.y - point1.y) +
      point3.x * (point1.y - point2.y));

  if (Math.abs(denominator) < CIRCLE_EPSILON) return null;

  const point1Squared = point1.x * point1.x + point1.y * point1.y;
  const point2Squared = point2.x * point2.x + point2.y * point2.y;
  const point3Squared = point3.x * point3.x + point3.y * point3.y;
  const x =
    (point1Squared * (point2.y - point3.y) +
      point2Squared * (point3.y - point1.y) +
      point3Squared * (point1.y - point2.y)) /
    denominator;
  const y =
    (point1Squared * (point3.x - point2.x) +
      point2Squared * (point1.x - point3.x) +
      point3Squared * (point2.x - point1.x)) /
    denominator;
  const radius = Math.hypot(point1.x - x, point1.y - y);

  if (!Number.isFinite(radius) || radius <= CIRCLE_EPSILON) return null;
  return { x, y, radius };
};

const handlePoint = (point: ComputedPoint, angleDeg: number, length: number) => {
  const angleRad = degreesToRadians(angleDeg);
  return {
    x: point.x + Math.cos(angleRad) * length,
    y: point.y - Math.sin(angleRad) * length
  };
};

const cubicPointAt = (
  segment: ComputedBezierSegment,
  t: number
): { x: number; y: number } => {
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

const approximateBezierSegmentLength = (segment: ComputedBezierSegment) => {
  let length = 0;
  let previous: { x: number; y: number } = segment.start;

  for (let step = 1; step <= CURVE_LENGTH_STEPS; step += 1) {
    const next = cubicPointAt(segment, step / CURVE_LENGTH_STEPS);
    length += Math.hypot(next.x - previous.x, next.y - previous.y);
    previous = next;
  }

  return length;
};

const numericError = (
  element: CadElement,
  value: NumericValue,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[],
  localVariables?: Map<string, number>,
  localVariableNames?: Map<string, string>
) => {
  const result = evaluateNumericValue({
    value,
    computedGeometry,
    elementsById,
    localVariables,
    localVariableNames
  });
  if (result.value !== undefined) return result.value;

  if (result.error) {
    errors.push({
      elementId: element.id,
      elementName: element.name,
      missingDependencyId: result.error.dependencyId,
      missingDependencyName: result.error.dependencyName,
      message: `${element.name} の数値式を評価できません。${result.error.message}`
    });
  }
  return undefined;
};

const getPointAnchorOrError = (
  element: CadElement,
  anchor: PointAnchor,
  anchorKey: string,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[],
  localVariables?: Map<string, number>,
  localVariableNames?: Map<string, string>
) => {
  if (anchor.mode === "reference") {
    return getComputedPointOrError(
      element,
      anchor.pointId,
      computedGeometry,
      elementsById,
      errors
    );
  }

  if (anchor.mode === "derived") {
    const source = computedGeometry.get(anchor.elementId);
    const point = resolveDerivedPoint(source, anchor.pointKey, elementsById);
    if (!point) {
      errors.push(dependencyError(element, anchor.elementId, elementsById));
      return undefined;
    }
    return {
      ...point,
      elementId: `${anchor.elementId}:${anchor.pointKey}`,
      name: `${source!.name}.${anchor.pointKey}`
    };
  }

  const x = numericError(
    element,
    anchor.x,
    computedGeometry,
    elementsById,
    errors,
    localVariables,
    localVariableNames
  );
  const y = numericError(
    element,
    anchor.y,
    computedGeometry,
    elementsById,
    errors,
    localVariables,
    localVariableNames
  );
  if (x === undefined || y === undefined) return undefined;

  return {
    kind: "point" as const,
    elementId: `${element.id}:${anchorKey}`,
    name: `${element.name}.${anchorKey}`,
    x,
    y
  };
};

const evaluateLocalVariables = (
  element: CadElement,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[]
) => {
  const localVariableValues = new Map<string, number>();
  const localVariableNames = new Map(
    (element.numericVariables ?? []).map((variable) => [variable.id, variable.name])
  );

  for (const variable of element.numericVariables ?? []) {
    const value = numericError(
      element,
      variable.value,
      computedGeometry,
      elementsById,
      errors,
      localVariableValues,
      localVariableNames
    );
    if (value === undefined) return null;
    localVariableValues.set(variable.id, value);
  }

  return { localVariableValues, localVariableNames };
};

export const evaluateElements = (elements: CadElement[]): EvaluationResult => {
  const computedGeometry = new Map<ElementId, ComputedGeometry>();
  const errors: DependencyError[] = [];
  const elementsById = new Map(elements.map((element) => [element.id, element]));

  for (const element of elements) {
    if (!element.enabled) {
      continue;
    }

    const localVariables = evaluateLocalVariables(
      element,
      computedGeometry,
      elementsById,
      errors
    );
    if (!localVariables) continue;
    const { localVariableValues, localVariableNames } = localVariables;

    switch (element.type) {
      case "freePoint": {
        const x = numericError(
          element,
          element.x,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const y = numericError(
          element,
          element.y,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (x === undefined || y === undefined) break;

        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x,
          y
        });
        break;
      }
      case "offsetPoint": {
        const fromAnchor = pointAnchorForElement(element);
        if (!fromAnchor) break;
        const resolvedFromPoint =
          fromAnchor.mode === "reference"
            ? getComputedPointOrError(
                element,
                fromAnchor.pointId,
                computedGeometry,
                elementsById,
                errors
              )
            : getPointAnchorOrError(
                element,
                fromAnchor,
                "from",
                computedGeometry,
                elementsById,
                errors,
                localVariableValues,
                localVariableNames
              );
        if (!resolvedFromPoint) {
          break;
        }
        const dx = numericError(
          element,
          element.dx,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const dy = numericError(
          element,
          element.dy,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (dx === undefined || dy === undefined) break;

        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: resolvedFromPoint.x + dx,
          y: resolvedFromPoint.y + dy
        });
        break;
      }
      case "polarOffsetPoint": {
        const fromAnchor = pointAnchorForElement(element);
        if (!fromAnchor) break;
        const resolvedFromPoint =
          fromAnchor.mode === "reference"
            ? getComputedPointOrError(
                element,
                fromAnchor.pointId,
                computedGeometry,
                elementsById,
                errors
              )
            : getPointAnchorOrError(
                element,
                fromAnchor,
                "from",
                computedGeometry,
                elementsById,
                errors,
                localVariableValues,
                localVariableNames
              );
        if (!resolvedFromPoint) {
          break;
        }

        const angleDeg = numericError(
          element,
          element.angleDeg,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const distance = numericError(
          element,
          element.distance,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (angleDeg === undefined || distance === undefined) break;

        const angleRad = degreesToRadians(angleDeg);
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: resolvedFromPoint.x + Math.cos(angleRad) * distance,
          y: resolvedFromPoint.y - Math.sin(angleRad) * distance
        });
        break;
      }
      case "divisionPoint": {
        const start = getPointAnchorOrError(
          element,
          element.startPoint,
          "start",
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const end = getPointAnchorOrError(
          element,
          element.endPoint,
          "end",
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (!start || !end) {
          break;
        }

        const vector = {
          x: end.x - start.x,
          y: end.y - start.y
        };
        const length = Math.hypot(vector.x, vector.y);

        if (element.placementMode === "distance") {
          const distance = numericError(
            element,
            element.distance,
            computedGeometry,
            elementsById,
            errors,
            localVariableValues,
            localVariableNames
          );
          if (distance === undefined) break;
          if (length <= CIRCLE_EPSILON) {
            errors.push(
              geometryError(
                element,
                `${element.name} は始点と終点が同じ位置のため、距離方向を決められません。始点と終点を別の位置にしてください。`
              )
            );
            break;
          }
          computedGeometry.set(element.id, {
            kind: "point",
            elementId: element.id,
            name: element.name,
            x: start.x + (vector.x / length) * distance,
            y: start.y + (vector.y / length) * distance
          });
          break;
        }

        const ratio = numericError(
          element,
          element.ratio,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (ratio === undefined) break;

        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: start.x + vector.x * ratio,
          y: start.y + vector.y * ratio
        });
        break;
      }
      case "lineDivisionPoint": {
        const geometry = computedGeometry.get(element.endpoint.lineId);
        if (!isLineLikeGeometry(geometry)) {
          errors.push(dependencyError(element, element.endpoint.lineId, elementsById));
          break;
        }

        const distanceFromEndpoint =
          element.placementMode === "distance"
            ? numericError(
                element,
                element.distance,
                computedGeometry,
                elementsById,
                errors,
                localVariableValues,
                localVariableNames
              )
            : numericError(
                element,
                element.ratio,
                computedGeometry,
                elementsById,
                errors,
                localVariableValues,
                localVariableNames
              );
        if (distanceFromEndpoint === undefined) break;

        const pathDistance =
          element.placementMode === "distance"
            ? distanceFromEndpoint
            : geometry.length * distanceFromEndpoint;
        const point = pointAtDistanceFromEndpoint(
          geometry,
          element.endpoint.endpointKey,
          pathDistance
        );
        if (!point) {
          errors.push(
            geometryError(
              element,
              `${element.name} は参照線から線上位置を作図できません。長さのある線を指定してください。`
            )
          );
          break;
        }

        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: point.x,
          y: point.y
        });
        break;
      }
      case "line": {
        const start = getPointAnchorOrError(
          element,
          element.startPoint,
          "start",
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const end = getPointAnchorOrError(
          element,
          element.endPoint,
          "end",
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (!start || !end) {
          break;
        }

        const dx = end.x - start.x;
        const dy = start.y - end.y;
        const length = Math.hypot(dx, dy);
        const startAngleDeg =
          length === 0 ? null : normalizeDegrees(radiansToDegrees(Math.atan2(dy, dx)));
        const endAngleDeg =
          length === 0 ? null : normalizeDegrees(radiansToDegrees(Math.atan2(-dy, -dx)));
        computedGeometry.set(element.id, {
          kind: "line",
          elementId: element.id,
          name: element.name,
          startPointId: anchorReferenceElementId(element.startPoint),
          endPointId: anchorReferenceElementId(element.endPoint),
          start,
          end,
          length,
          startAngleDeg,
          endAngleDeg
        });
        break;
      }
      case "arcLine": {
        const center = getPointAnchorOrError(
          element,
          element.centerPoint,
          "center",
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (!center) {
          break;
        }

        const radius = numericError(
          element,
          element.radius,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const startAngleDeg = numericError(
          element,
          element.startAngleDeg,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const endAngleDeg = numericError(
          element,
          element.endAngleDeg,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (radius === undefined || startAngleDeg === undefined || endAngleDeg === undefined) {
          break;
        }

        const startAngleRad = degreesToRadians(startAngleDeg);
        const endAngleRad = degreesToRadians(endAngleDeg);
        const safeRadius = radius > 0 ? radius : 0;
        const sweepAngleDeg = positiveSweepDegrees(startAngleDeg, endAngleDeg);
        computedGeometry.set(element.id, {
          kind: "arcLine",
          elementId: element.id,
          name: element.name,
          centerPointId: anchorReferenceElementId(element.centerPoint),
          center,
          start: {
            kind: "point",
            elementId: `${element.id}:start`,
            name: `${element.name}.始点`,
            x: center.x + Math.cos(startAngleRad) * safeRadius,
            y: center.y - Math.sin(startAngleRad) * safeRadius
          },
          end: {
            kind: "point",
            elementId: `${element.id}:end`,
            name: `${element.name}.終点`,
            x: center.x + Math.cos(endAngleRad) * safeRadius,
            y: center.y - Math.sin(endAngleRad) * safeRadius
          },
          radius,
          startAngleDeg,
          endAngleDeg,
          sweepAngleDeg,
          length: safeRadius * degreesToRadians(sweepAngleDeg)
        });
        break;
      }
      case "threePointArcLine": {
        const point1 = getPointAnchorOrError(
          element,
          element.point1,
          "point1",
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const point2 = getPointAnchorOrError(
          element,
          element.point2,
          "point2",
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const point3 = getPointAnchorOrError(
          element,
          element.point3,
          "point3",
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (!point1 || !point2 || !point3) {
          break;
        }

        const startAngleDeg = numericError(
          element,
          element.startAngleDeg,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const endAngleDeg = numericError(
          element,
          element.endAngleDeg,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (startAngleDeg === undefined || endAngleDeg === undefined) {
          break;
        }

        const circle = circleThroughThreePoints(point1, point2, point3);
        if (!circle) {
          errors.push(
            geometryError(
              element,
              `${element.name} は点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。`
            )
          );
          break;
        }

        const startAngleRad = degreesToRadians(startAngleDeg);
        const endAngleRad = degreesToRadians(endAngleDeg);
        const sweepAngleDeg = positiveSweepDegrees(startAngleDeg, endAngleDeg);
        computedGeometry.set(element.id, {
          kind: "arcLine",
          elementId: element.id,
          name: element.name,
          centerPointId: null,
          center: {
            kind: "point",
            elementId: `${element.id}:center`,
            name: `${element.name}.中心点`,
            x: circle.x,
            y: circle.y
          },
          start: {
            kind: "point",
            elementId: `${element.id}:start`,
            name: `${element.name}.始点`,
            x: circle.x + Math.cos(startAngleRad) * circle.radius,
            y: circle.y - Math.sin(startAngleRad) * circle.radius
          },
          end: {
            kind: "point",
            elementId: `${element.id}:end`,
            name: `${element.name}.終点`,
            x: circle.x + Math.cos(endAngleRad) * circle.radius,
            y: circle.y - Math.sin(endAngleRad) * circle.radius
          },
          radius: circle.radius,
          startAngleDeg,
          endAngleDeg,
          sweepAngleDeg,
          length: circle.radius * degreesToRadians(sweepAngleDeg)
        });
        break;
      }
      case "bezierCurve": {
        const start = getPointAnchorOrError(
          element,
          element.startPoint,
          "start",
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const end = getPointAnchorOrError(
          element,
          element.endPoint,
          "end",
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const intermediatePoints = element.intermediatePoints.map((intermediate) =>
          getPointAnchorOrError(
            element,
            intermediate.point,
            `intermediate:${intermediate.id}`,
            computedGeometry,
            elementsById,
            errors,
            localVariableValues,
            localVariableNames
          )
        );
        if (!start || !end || intermediatePoints.some((point) => !point)) {
          break;
        }

        const startHandleAngleDeg = numericError(
          element,
          element.startHandleAngleDeg,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const startHandleLength = numericError(
          element,
          element.startHandleLength,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const endHandleAngleDeg = numericError(
          element,
          element.endHandleAngleDeg,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const endHandleLength = numericError(
          element,
          element.endHandleLength,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        const intermediateHandles = element.intermediatePoints.map((intermediate) => ({
          angleDeg: numericError(
            element,
            intermediate.handleAngleDeg,
            computedGeometry,
            elementsById,
            errors,
            localVariableValues,
            localVariableNames
          ),
          incomingLength: numericError(
            element,
            intermediate.incomingHandleLength,
            computedGeometry,
            elementsById,
            errors,
            localVariableValues,
            localVariableNames
          ),
          outgoingLength: numericError(
            element,
            intermediate.outgoingHandleLength,
            computedGeometry,
            elementsById,
            errors,
            localVariableValues,
            localVariableNames
          )
        }));
        if (
          startHandleAngleDeg === undefined ||
          startHandleLength === undefined ||
          endHandleAngleDeg === undefined ||
          endHandleLength === undefined ||
          intermediateHandles.some(
            (handle) =>
              handle.angleDeg === undefined ||
              handle.incomingLength === undefined ||
              handle.outgoingLength === undefined
          )
        ) {
          break;
        }

        const anchors = [start, ...(intermediatePoints as ComputedPoint[]), end];
        const outgoingHandles = [
          handlePoint(start, startHandleAngleDeg, startHandleLength),
          ...intermediateHandles.map((handle, index) =>
            handlePoint(anchors[index + 1], handle.angleDeg!, handle.outgoingLength!)
          )
        ];
        const incomingHandles = [
          ...intermediateHandles.map((handle, index) =>
            handlePoint(anchors[index + 1], handle.angleDeg! + 180, handle.incomingLength!)
          ),
          handlePoint(end, endHandleAngleDeg + 180, endHandleLength)
        ];
        const segments = anchors.slice(0, -1).map((anchor, index) => ({
          startPointId: anchor.elementId,
          endPointId: anchors[index + 1].elementId,
          start: anchor,
          control1: outgoingHandles[index],
          control2: incomingHandles[index],
          end: anchors[index + 1]
        }));

        computedGeometry.set(element.id, {
          kind: "bezierCurve",
          elementId: element.id,
          name: element.name,
          startPointId: anchorReferenceElementId(element.startPoint),
          endPointId: anchorReferenceElementId(element.endPoint),
          intermediatePointIds: element.intermediatePoints.flatMap((point) =>
            anchorReferenceElementId(point.point) ? [anchorReferenceElementId(point.point)!] : []
          ),
          segments,
          length: segments.reduce(
            (sum, segment) => sum + approximateBezierSegmentLength(segment),
            0
          ),
          startHandleAngleDeg,
          startHandleLength,
          endHandleAngleDeg,
          endHandleLength
        });
        break;
      }
      case "offsetLine": {
        const offset = numericError(
          element,
          element.offset,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (offset === undefined) break;

        const baseGeometries: ComputedGeometry[] = [];
        let hasMissingBase = false;
        for (const baseLineId of element.baseLineIds) {
          const geometry = computedGeometry.get(baseLineId);
          if (!isLineLikeGeometry(geometry)) {
            errors.push(dependencyError(element, baseLineId, elementsById));
            hasMissingBase = true;
            continue;
          }
          baseGeometries.push(geometry);
        }
        if (hasMissingBase) break;

        const result = buildOffsetLineGeometry({
          elementId: element.id,
          name: element.name,
          baseLineIds: element.baseLineIds,
          baseGeometries,
          offset: element.side === "right" ? offset : -offset,
          closed: element.closed
        });
        if (result.error) {
          errors.push(geometryError(element, result.error));
          break;
        }
        if (result.geometry) computedGeometry.set(element.id, result.geometry);
        break;
      }
    }
  }

  return { computedGeometry, errors };
};
