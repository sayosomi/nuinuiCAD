import type { CadElement, ComputedPoint } from "../types/geometry";
import { anchorReferenceElementId } from "../model/pointAnchors";
import {
  approximateBezierSegmentLength,
  CIRCLE_EPSILON,
  circleThroughThreePoints,
  degreesToRadians,
  handlePoint,
  normalizeDegrees,
  positiveSweepDegrees
} from "./evaluateGeometryPrimitives";
import { dependencyError, geometryError, getPointAnchorOrError, numericError } from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { arcTangentAngles, lineTangentAngles } from "./lineMeasurements";

export const evaluateLineElement = (element: CadElement, context: ElementEvaluationContext) => {
  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    localVariables: { localVariableValues, localVariableNames }
  } = context;

  switch (element.type) {
      case "line": {
        const start = getPointAnchorOrError(
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
        const end = getPointAnchorOrError(
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
        if (!start || !end) {
          break;
        }

        const dx = end.x - start.x;
        const dy = start.y - end.y;
        const length = Math.hypot(dx, dy);
        const angles = lineTangentAngles(start, end);
        computedGeometry.set(element.id, {
          kind: "line",
          elementId: element.id,
          name: element.name,
          startPointId: anchorReferenceElementId(element.startPoint),
          endPointId: anchorReferenceElementId(element.endPoint),
          start,
          end,
          length,
          ...angles
        });
        break;
      }
      case "angleLengthLine": {
        const start = getPointAnchorOrError(
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
        if (!start) {
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
        const length = numericError(
          element,
          element.length,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (angleDeg === undefined || length === undefined) {
          break;
        }

        const angleRad = degreesToRadians(angleDeg);
        const end: ComputedPoint = {
          kind: "point",
          elementId: `${element.id}:end`,
          name: `${element.name}.終点`,
          x: start.x + Math.cos(angleRad) * length,
          y: start.y + Math.sin(angleRad) * length
        };
        const angles = lineTangentAngles(start, end);
        computedGeometry.set(element.id, {
          kind: "line",
          elementId: element.id,
          name: element.name,
          startPointId: anchorReferenceElementId(element.startPoint),
          endPointId: null,
          start: {
            kind: "point",
            elementId: `${element.id}:start`,
            name: `${element.name}.始点`,
            x: start.x,
            y: start.y
          },
          end,
          length: Math.hypot(end.x - start.x, end.y - start.y),
          ...angles
        });
        break;
      }
      case "commonTangentLine": {
        const firstGeometry = computedGeometry.get(element.firstLineId);
        const secondGeometry = computedGeometry.get(element.secondLineId);
        if (!firstGeometry) {
          errors.push(dependencyError(element, element.firstLineId, elementsById, disabledByGroupId, errors));
        } else if (firstGeometry.kind !== "arcLine") {
          errors.push(geometryError(element, "first に円弧が指定されていません。共通接線には円弧を指定してください。"));
        }
        if (!secondGeometry) {
          errors.push(dependencyError(element, element.secondLineId, elementsById, disabledByGroupId, errors));
        } else if (secondGeometry.kind !== "arcLine") {
          errors.push(geometryError(element, "second に円弧が指定されていません。共通接線には円弧を指定してください。"));
        }
        if (firstGeometry?.kind !== "arcLine" || secondGeometry?.kind !== "arcLine") break;

        const r1 = firstGeometry.radius;
        const r2 = secondGeometry.radius;
        if (!(r1 > CIRCLE_EPSILON)) {
          errors.push(geometryError(element, "first の半径が0以下です。共通接線には半径のある円弧を指定してください。"));
        }
        if (!(r2 > CIRCLE_EPSILON)) {
          errors.push(geometryError(element, "second の半径が0以下です。共通接線には半径のある円弧を指定してください。"));
        }
        if (!(r1 > CIRCLE_EPSILON) || !(r2 > CIRCLE_EPSILON)) break;

        const dx = secondGeometry.center.x - firstGeometry.center.x;
        const dy = secondGeometry.center.y - firstGeometry.center.y;
        const centerDistance = Math.hypot(dx, dy);
        if (centerDistance <= CIRCLE_EPSILON) {
          errors.push(geometryError(
            element,
            Math.abs(r1 - r2) <= CIRCLE_EPSILON
              ? "2つの円が同一円のため、共通接線を1本に決定できません。"
              : "2つの円が同心円のため、共通接線は存在しません。"
          ));
          break;
        }

        const threshold = element.kind === "external" ? Math.abs(r1 - r2) : r1 + r2;
        if (centerDistance < threshold - CIRCLE_EPSILON) {
          errors.push(geometryError(
            element,
            `kind: ${element.kind} の共通接線は存在しません。2つの円の位置・半径または kind を変更してください。`
          ));
          break;
        }
        if (centerDistance <= threshold + CIRCLE_EPSILON) {
          errors.push(geometryError(element, "2つの接点が一致するため、有限長の共通接線として表現できません。2つの円の位置・半径または kind を変更してください。"));
          break;
        }

        const secondRadiusSign = element.kind === "external" ? 1 : -1;
        const cosine = (r1 - secondRadiusSign * r2) / centerDistance;
        const clampedCosine = Math.max(-1, Math.min(1, cosine));
        const sineSquared = 1 - clampedCosine * clampedCosine;
        const sine = Math.sqrt(sineSquared < 0 && sineSquared > -CIRCLE_EPSILON ? 0 : Math.max(0, sineSquared));
        const ux = dx / centerDistance;
        const uy = dy / centerDistance;
        const vx = -uy;
        const vy = ux;
        const sideSign = element.side === "left" ? 1 : -1;
        const nx = clampedCosine * ux + sideSign * sine * vx;
        const ny = clampedCosine * uy + sideSign * sine * vy;
        const start: ComputedPoint = {
          kind: "point",
          elementId: `${element.id}:start`,
          name: `${element.name}.始点`,
          x: firstGeometry.center.x + r1 * nx,
          y: firstGeometry.center.y + r1 * ny
        };
        const end: ComputedPoint = {
          kind: "point",
          elementId: `${element.id}:end`,
          name: `${element.name}.終点`,
          x: secondGeometry.center.x + secondRadiusSign * r2 * nx,
          y: secondGeometry.center.y + secondRadiusSign * r2 * ny
        };
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (length <= CIRCLE_EPSILON) {
          errors.push(geometryError(element, "2つの接点が一致するため、有限長の共通接線として表現できません。2つの円の位置・半径または kind を変更してください。"));
          break;
        }
        const angles = lineTangentAngles(start, end);
        computedGeometry.set(element.id, {
          kind: "line",
          elementId: element.id,
          name: element.name,
          startPointId: null,
          endPointId: null,
          start,
          end,
          length,
          ...angles
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
          localVariableNames,
          disabledByGroupId
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
        const tangentAngles = arcTangentAngles({ startAngleDeg, endAngleDeg, sweepAngleDeg });
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
            y: center.y + Math.sin(startAngleRad) * safeRadius
          },
          end: {
            kind: "point",
            elementId: `${element.id}:end`,
            name: `${element.name}.終点`,
            x: center.x + Math.cos(endAngleRad) * safeRadius,
            y: center.y + Math.sin(endAngleRad) * safeRadius
          },
          radius,
          startAngleDeg,
          endAngleDeg,
          ...tangentAngles,
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
        const tangentAngles = arcTangentAngles({ startAngleDeg, endAngleDeg, sweepAngleDeg });
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
            y: circle.y + Math.sin(startAngleRad) * circle.radius
          },
          end: {
            kind: "point",
            elementId: `${element.id}:end`,
            name: `${element.name}.終点`,
            x: circle.x + Math.cos(endAngleRad) * circle.radius,
            y: circle.y + Math.sin(endAngleRad) * circle.radius
          },
          radius: circle.radius,
          startAngleDeg,
          endAngleDeg,
          ...tangentAngles,
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
            localVariableNames,
            disabledByGroupId
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
          startTangentAngleDeg: normalizeDegrees(startHandleAngleDeg),
          endTangentAngleDeg: normalizeDegrees(endHandleAngleDeg + 180),
          startHandleAngleDeg,
          startHandleLength,
          endHandleAngleDeg,
          endHandleLength
        });
        break;
      }

    default:
      return false;
  }
  return true;
};
