import type { CadElement, NumericValue } from "../types/geometry";
import { pointAnchorForElement } from "../model/pointAnchors";
import { degreesToRadians, normalizeDegrees360 } from "../scalars/angleMath";
import { EPSILON } from "./bezierMath";
import { dependencyError, geometryError, getComputedPointOrError, getPointAnchorOrError, numericError } from "./evaluationContext";
import { pointAtDistanceFromEndpoint, isLineLikeGeometryInput, tangentAtPointOnLineLikeGeometry } from "./linePaths";
import { findLineIntersections } from "./lineIntersections";
import { resolveLineGeometryInput } from "./lineGeometryInput";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import {
  bezierBulgePointGeometryKernel,
  bezierExtremePointGeometryKernel,
  coordinateGeometryKernel,
  curveSidePointGeometryKernel,
  divisionPointGeometryKernel,
  polarPointGeometryKernel,
  tangentOffsetPointFromTangentGeometryKernel
} from "./geometryValueKernels";

/**
 * The only place a divisionPoint/lineDivisionPoint's placement is read leniently:
 * a missing || unrecognized `kind` falls back to the ratio interpretation, matching
 * the Rust reference evaluator's identical fallback (see division_placement.rs).
 * Every other consumer can assume `element.placement.kind` is already well-formed.
 */
const decodeDivisionPlacement = (
  placement: unknown
): { kind: "distance" | "ratio"; value: NumericValue | undefined } => {
  const record = placement as { kind?: unknown; value?: NumericValue } | null | undefined;
  return record?.kind === "distance"
    ? { kind: "distance", value: record.value }
    : { kind: "ratio", value: record?.value };
};

export const evaluatePointElement = (element: CadElement, context: ElementEvaluationContext) => {
  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    elements,
    localVariables: { localVariableValues, localVariableNames }
    , computedGeometryValues
  } = context;
  const evaluateNumber = (value: Parameters<typeof numericError>[1]) =>
    numericError(
      element,
      value,
      computedGeometry,
      elementsById,
      errors,
      localVariableValues,
      localVariableNames,
      disabledByGroupId,
      elements,
      computedGeometryValues
    );
  const evaluatePointAnchor = (anchor: Parameters<typeof getPointAnchorOrError>[1], key: string) =>
    getPointAnchorOrError(
      element,
      anchor,
      key,
      computedGeometry,
      elementsById,
      errors,
      localVariableValues,
      localVariableNames,
      disabledByGroupId,
      elements,
      computedGeometryValues
    );

  switch (element.type) {
      case "freePoint": {
        const x = evaluateNumber(element.x);
        const y = evaluateNumber(element.y);
        if (x === undefined || y === undefined) break;

        const structural = coordinateGeometryKernel(x, y);
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          ...structural
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
                errors,
                disabledByGroupId
              )
            : evaluatePointAnchor(fromAnchor, "from");
        if (!resolvedFromPoint) {
          break;
        }
        const dx = evaluateNumber(element.dx);
        const dy = evaluateNumber(element.dy);
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
                errors,
                disabledByGroupId
              )
            : evaluatePointAnchor(fromAnchor, "from");
        if (!resolvedFromPoint) {
          break;
        }

        const angleDeg = evaluateNumber(element.angleDeg);
        const distance = evaluateNumber(element.distance);
        if (angleDeg === undefined || distance === undefined) break;

        const end = polarPointGeometryKernel(resolvedFromPoint, angleDeg, distance);
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          ...end
        });
        break;
      }
      case "divisionPoint": {
        const start = evaluatePointAnchor(element.startPoint, "start");
        const end = evaluatePointAnchor(element.endPoint, "end");
        if (!start || !end) {
          break;
        }

        const placement = decodeDivisionPlacement(element.placement);
        if (placement.value === undefined) break;

        if (placement.kind === "distance") {
          const distance = evaluateNumber(placement.value);
          if (distance === undefined) break;
          const point = divisionPointGeometryKernel(start, end, { kind: "distance", value: distance });
          if (!point) {
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
            x: point.x,
            y: point.y
          });
          break;
        }

        const ratio = evaluateNumber(placement.value);
        if (ratio === undefined) break;

        const point = divisionPointGeometryKernel(start, end, { kind: "ratio", value: ratio });
        if (!point) break;
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: point.x,
          y: point.y
        });
        break;
      }
      case "lineDivisionPoint": {
        const geometry = resolveLineGeometryInput(context, "endpoint", element.endpoint.lineId);
        if (!isLineLikeGeometryInput(geometry)) {
          errors.push(dependencyError(element, element.endpoint.lineId, elementsById, disabledByGroupId));
          break;
        }

        const placement = decodeDivisionPlacement(element.placement);
        if (placement.value === undefined) break;
        const distanceFromEndpoint = evaluateNumber(placement.value);
        if (distanceFromEndpoint === undefined) break;

        const pathDistance =
          placement.kind === "distance"
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
      case "intersectionPoint": {
        if (element.line1Id === element.line2Id) {
          errors.push(
            geometryError(
              element,
              `${element.name} は同じ線を2回参照しているため、交点を作図できません。線1と線2に別の線を指定してください。`
            )
          );
          break;
        }

        const line1 = resolveLineGeometryInput(context, "line1Id", element.line1Id);
        const line2 = resolveLineGeometryInput(context, "line2Id", element.line2Id);
        if (!isLineLikeGeometryInput(line1)) {
          errors.push(dependencyError(element, element.line1Id, elementsById, disabledByGroupId));
          break;
        }
        if (!isLineLikeGeometryInput(line2)) {
          errors.push(dependencyError(element, element.line2Id, elementsById, disabledByGroupId));
          break;
        }

        const intersectionIndex = evaluateNumber(element.intersectionIndex);
        if (intersectionIndex === undefined) break;
        if (!Number.isInteger(intersectionIndex) || intersectionIndex < 0) {
          errors.push(
            geometryError(
              element,
              `${element.name} の番号は0以上の整数で指定してください。`
            )
          );
          break;
        }

        const result = findLineIntersections(line1, line2, {
          useExtensions: element.useExtensions
        });
        if (result.error) {
          errors.push(geometryError(element, result.error));
          break;
        }
        const intersection = result.intersections[intersectionIndex];
        if (!intersection) {
          const message =
            result.intersections.length === 0
              ? `${element.name} は参照線同士の交点を見つけられません。線1・線2または延長設定を確認してください。`
              : `${element.name} の番号 ${intersectionIndex} に対応する交点はありません。交点数は ${result.intersections.length} 個です。`;
          errors.push(geometryError(element, message));
          break;
        }

        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: intersection.x,
          y: intersection.y
        });
        break;
      }
      case "lineTangentOffsetPoint": {
        const baseLine = resolveLineGeometryInput(context, "baseLineId", element.baseLineId);
        if (!baseLine) {
          errors.push(dependencyError(element, element.baseLineId, elementsById, disabledByGroupId));
          break;
        }
        if (element.curveSide === undefined && !isLineLikeGeometryInput(baseLine)) {
          errors.push(dependencyError(element, element.baseLineId, elementsById, disabledByGroupId));
          break;
        }

        const basePoint = evaluatePointAnchor(element.basePoint, "basePoint");
        if (!basePoint) break;

        const distance = evaluateNumber(element.distance);
        if (distance === undefined) break;

        if (element.curveSide !== undefined) {
          if (!baseLine || baseLine.kind !== "bezierCurve") {
            errors.push(
              geometryError(
                element,
                `${element.name} の curveSide はベジェ曲線の計算結果にのみ指定できます。`
              )
            );
            break;
          }
          if (distance < 0) {
            errors.push(geometryError(element, `${element.name} の curveSide の距離は0以上で指定してください。`));
            break;
          }
          const result = curveSidePointGeometryKernel(baseLine, basePoint, element.curveSide, distance);
          if ("error" in result) {
            errors.push(geometryError(element, `${element.name}: ${result.error}`));
            break;
          }
          computedGeometry.set(element.id, {
            kind: "point",
            elementId: element.id,
            name: element.name,
            ...result.point
          });
          break;
        }

        if (!isLineLikeGeometryInput(baseLine)) {
          errors.push(dependencyError(element, element.baseLineId, elementsById, disabledByGroupId));
          break;
        }

        const tangent = tangentAtPointOnLineLikeGeometry(baseLine, basePoint);
        if (!tangent) {
          errors.push(
            geometryError(
              element,
              `${element.name} の基準点は基準線上にありません。基準線上の点を指定してください。`
            )
          );
          break;
        }

        const tangentAngleDeg = evaluateNumber(element.tangentAngleDeg);
        if (tangentAngleDeg === undefined) break;

        const point = tangentOffsetPointFromTangentGeometryKernel(basePoint, tangent.angleDeg, tangentAngleDeg, distance);
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          ...point
        });
        break;
      }
      case "bezierExtremePoint": {
        const source = resolveLineGeometryInput(context, "baseLineId", element.baseLineId);
        if (!source) {
          errors.push(dependencyError(element, element.baseLineId, elementsById, disabledByGroupId, errors));
          break;
        }
        if (source.kind !== "bezierCurve") {
          errors.push(
            geometryError(
              element,
              `${element.name} の参照先はベジェ曲線の計算結果ではありません。ベジェ曲線を指定してください。`
            )
          );
          break;
        }

        const segmentIndex = evaluateNumber(element.segmentIndex);
        if (segmentIndex === undefined) break;
        if (!Number.isFinite(segmentIndex)) {
          errors.push(geometryError(element, `${element.name} の区間番号は有限の数値で指定してください。`));
          break;
        }
        if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
          errors.push(geometryError(element, `${element.name} の区間番号は0以上の整数で指定してください。`));
          break;
        }
        if (segmentIndex >= source.segments.length) {
          errors.push(
            geometryError(
              element,
              `${element.name} の区間番号 ${segmentIndex} に対応する区間がありません。区間数は ${source.segments.length} 個です。`
            )
          );
          break;
        }

        const directionDeg = evaluateNumber(element.directionDeg);
        if (directionDeg === undefined) break;
        if (!Number.isFinite(directionDeg)) {
          errors.push(geometryError(element, `${element.name} の方向は有限の数値で指定してください。`));
          break;
        }

        const normalizedDirection = degreesToRadians(normalizeDegrees360(directionDeg));
        const point = bezierExtremePointGeometryKernel(source.segments[segmentIndex], {
          x: Math.cos(normalizedDirection),
          y: Math.sin(normalizedDirection)
        });
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: point.x,
          y: point.y
        });
        break;
      }
      case "bezierBulgePoint": {
        const source = resolveLineGeometryInput(context, "baseLineId", element.baseLineId);
        if (!source) {
          errors.push(dependencyError(element, element.baseLineId, elementsById, disabledByGroupId, errors));
          break;
        }
        if (source.kind !== "bezierCurve") {
          errors.push(
            geometryError(
              element,
              `${element.name} の参照先はベジェ曲線の計算結果ではありません。ベジェ曲線を指定してください。`
            )
          );
          break;
        }

        const segmentIndex = evaluateNumber(element.segmentIndex);
        if (segmentIndex === undefined) break;
        if (!Number.isFinite(segmentIndex)) {
          errors.push(geometryError(element, `${element.name} の区間番号は有限の数値で指定してください。`));
          break;
        }
        if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
          errors.push(geometryError(element, `${element.name} の区間番号は0以上の整数で指定してください。`));
          break;
        }
        if (segmentIndex >= source.segments.length) {
          errors.push(
            geometryError(
              element,
              `${element.name} の区間番号 ${segmentIndex} に対応する区間がありません。区間数は ${source.segments.length} 個です。`
            )
          );
          break;
        }

        const segment = source.segments[segmentIndex];
        const chordLength = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
        if (chordLength <= EPSILON) {
          errors.push(
            geometryError(
              element,
              `${element.name} の選択区間は始点と終点が一致しているため、膨らみの基準線を定義できません。`
            )
          );
          break;
        }

        const point = bezierBulgePointGeometryKernel(segment);
        if (!point) break;
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: point.x,
          y: point.y
        });
        break;
      }

    default:
      return false;
  }
  return true;
};
