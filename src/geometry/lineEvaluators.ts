import type { CadElement, ComputedPoint } from "../types/geometry";
import { anchorReferenceElementId } from "../model/pointAnchors";
import {
  approximateBezierSegmentLength,
  CIRCLE_EPSILON,
  handlePoint,
  normalizeDegrees
} from "./evaluateGeometryPrimitives";
import { dependencyError, geometryError, getPointAnchorOrError, numericError } from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import { lineTangentAngles } from "./lineMeasurements";
import { arcGeometryKernel, commonTangentGeometryKernel, polarLineGeometryKernel, segmentGeometryKernel, throughArcGeometryKernel } from "./geometryValueKernels";
import { resolveLineGeometryInput } from "./lineGeometryInput";

export const evaluateLineElement = (element: CadElement, context: ElementEvaluationContext) => {
  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    computedGeometryValues,
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
          disabledByGroupId,
          undefined,
          computedGeometryValues
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
          disabledByGroupId,
          undefined,
          computedGeometryValues
        );
        if (!start || !end) {
          break;
        }

        const structural = segmentGeometryKernel(start, end);
        computedGeometry.set(element.id, {
          ...structural,
          elementId: element.id,
          name: element.name,
          startPointId: anchorReferenceElementId(element.startPoint),
          endPointId: anchorReferenceElementId(element.endPoint),
          start: { kind: "point", elementId: start.elementId, name: start.name, x: start.x, y: start.y },
          end: { kind: "point", elementId: end.elementId, name: end.name, x: end.x, y: end.y }
        });
        break;
      }
      case "polyline": {
        const minimumPointCount = element.closed ? 3 : 2;
        if (element.points.length < minimumPointCount) {
          errors.push(geometryError(
            element,
            `${element.name} の点数が不足しています。${element.closed ? "閉じた折れ線には3点以上" : "開いた折れ線には2点以上"}の点を指定してください。`
          ));
          break;
        }

        const points = element.points.map((point, index) => getPointAnchorOrError(
          element,
          point,
          `point${index + 1}`,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames,
          disabledByGroupId,
          undefined,
          computedGeometryValues
        ));
        if (points.some((point) => !point)) break;
        const resolvedPoints = points as ComputedPoint[];
        const segments = resolvedPoints.slice(0, -1).map((start, index) => {
          const end = resolvedPoints[index + 1]!;
          return {
            kind: "line" as const,
            start,
            end,
            length: Math.hypot(end.x - start.x, end.y - start.y)
          };
        });
        const first = resolvedPoints[0]!;
        const last = resolvedPoints.at(-1)!;
        if (element.closed && Math.hypot(last.x - first.x, last.y - first.y) > CIRCLE_EPSILON) {
          segments.push({
            kind: "line",
            start: last,
            end: first,
            length: Math.hypot(first.x - last.x, first.y - last.y)
          });
        }
        const nonZero = segments.filter((segment) => segment.length > CIRCLE_EPSILON);
        const startTangentAngleDeg = nonZero[0]
          ? lineTangentAngles(nonZero[0].start, nonZero[0].end).startTangentAngleDeg
          : null;
        const lastNonZero = nonZero.at(-1);
        const endTangentAngleDeg = lastNonZero
          ? lineTangentAngles(lastNonZero.start, lastNonZero.end).endTangentAngleDeg
          : null;
        computedGeometry.set(element.id, {
          kind: "polyline",
          elementId: element.id,
          name: element.name,
          segments,
          closed: element.closed,
          start: first,
          end: element.closed ? first : last,
          length: segments.reduce((sum, segment) => sum + segment.length, 0),
          startTangentAngleDeg,
          endTangentAngleDeg
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
          disabledByGroupId,
          undefined,
          computedGeometryValues
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

        const structural = polarLineGeometryKernel(start, angleDeg, length);
        const end: ComputedPoint = {
          kind: "point",
          elementId: `${element.id}:end`,
          name: `${element.name}.終点`,
          ...structural.end
        };
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
          length: structural.length,
          startAngleDeg: structural.startAngleDeg,
          endAngleDeg: structural.endAngleDeg,
          startTangentAngleDeg: structural.startTangentAngleDeg,
          endTangentAngleDeg: structural.endTangentAngleDeg
        });
        break;
      }
      case "commonTangentLine": {
        const firstGeometry = resolveLineGeometryInput(context, "firstLineId", element.firstLineId);
        const secondGeometry = resolveLineGeometryInput(context, "secondLineId", element.secondLineId);
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

        const result = commonTangentGeometryKernel(firstGeometry, secondGeometry, element.kind, element.side);
        if ("errors" in result) {
          for (const message of result.errors) errors.push(geometryError(element, message));
          break;
        }
        const { line: structural } = result;
        const start: ComputedPoint = {
          kind: "point",
          elementId: `${element.id}:start`,
          name: `${element.name}.始点`,
          ...structural.start
        };
        const end: ComputedPoint = {
          kind: "point",
          elementId: `${element.id}:end`,
          name: `${element.name}.終点`,
          ...structural.end
        };
        computedGeometry.set(element.id, {
          kind: "line",
          elementId: element.id,
          name: element.name,
          startPointId: null,
          endPointId: null,
          start,
          end,
          length: structural.length,
          startAngleDeg: structural.startAngleDeg,
          endAngleDeg: structural.endAngleDeg,
          startTangentAngleDeg: structural.startTangentAngleDeg,
          endTangentAngleDeg: structural.endTangentAngleDeg
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
          disabledByGroupId,
          undefined,
          computedGeometryValues
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
          localVariableNames,
          undefined,
          undefined,
          computedGeometryValues
        );
        const startAngleDeg = numericError(
          element,
          element.startAngleDeg,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames,
          undefined,
          undefined,
          computedGeometryValues
        );
        const endAngleDeg = numericError(
          element,
          element.endAngleDeg,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames,
          undefined,
          undefined,
          computedGeometryValues
        );
        if (radius === undefined || startAngleDeg === undefined || endAngleDeg === undefined) {
          break;
        }

        if (!(radius > 0)) {
          errors.push(geometryError(element, `${element.name} の半径は0より大きい値で指定してください。`));
          break;
        }

        const structural = arcGeometryKernel(
          { x: center.x, y: center.y },
          radius,
          startAngleDeg,
          endAngleDeg,
          element.direction ?? "counterclockwise"
        );
        computedGeometry.set(element.id, {
          ...structural,
          elementId: element.id,
          name: element.name,
          centerPointId: anchorReferenceElementId(element.centerPoint),
          center,
          start: {
            kind: "point",
            elementId: `${element.id}:start`,
            name: `${element.name}.始点`,
            ...structural.start
          },
          end: {
            kind: "point",
            elementId: `${element.id}:end`,
            name: `${element.name}.終点`,
            ...structural.end
          }
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
          , undefined,
          undefined,
          computedGeometryValues
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
          , undefined,
          undefined,
          computedGeometryValues
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

        const structural = throughArcGeometryKernel(
          { x: point1.x, y: point1.y },
          { x: point2.x, y: point2.y },
          { x: point3.x, y: point3.y },
          startAngleDeg,
          endAngleDeg
        );
        if (!structural) {
          errors.push(
            geometryError(
              element,
              `${element.name} は点1・点2・点3から円を作れません。3点が重複しているか、一直線上にあります。別の3点を指定してください。`
            )
          );
          break;
        }
        computedGeometry.set(element.id, {
          kind: "arcLine",
          elementId: element.id,
          name: element.name,
          centerPointId: null,
          center: {
            kind: "point",
            elementId: `${element.id}:center`,
            name: `${element.name}.中心点`,
            x: structural.center.x,
            y: structural.center.y
          },
          start: {
            kind: "point",
            elementId: `${element.id}:start`,
            name: `${element.name}.始点`,
            ...structural.start
          },
          end: {
            kind: "point",
            elementId: `${element.id}:end`,
            name: `${element.name}.終点`,
            ...structural.end
          },
          radius: structural.radius,
          startAngleDeg: structural.startAngleDeg,
          endAngleDeg: structural.endAngleDeg,
          startTangentAngleDeg: structural.startTangentAngleDeg,
          endTangentAngleDeg: structural.endTangentAngleDeg,
          sweepAngleDeg: structural.sweepAngleDeg,
          length: structural.length
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
            disabledByGroupId,
            undefined,
            computedGeometryValues
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
          intermediateSlotIds: element.intermediatePoints.map((point) => point.id),
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
