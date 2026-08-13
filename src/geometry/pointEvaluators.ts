import type { CadElement, NumericValue } from "../types/geometry";
import { pointAnchorForElement } from "../model/pointAnchors";
import { CIRCLE_EPSILON, degreesToRadians } from "./evaluateGeometryPrimitives";
import { dependencyError, geometryError, getComputedPointOrError, getPointAnchorOrError, numericError } from "./evaluationContext";
import { pointAtDistanceFromEndpoint, isLineLikeGeometry, tangentAtPointOnLineLikeGeometry } from "./linePaths";
import { findLineIntersections } from "./lineIntersections";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";

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
      elements
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
      elements
    );

  switch (element.type) {
      case "freePoint": {
        const x = evaluateNumber(element.x);
        const y = evaluateNumber(element.y);
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

        const angleRad = degreesToRadians(angleDeg);
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: resolvedFromPoint.x + Math.cos(angleRad) * distance,
          y: resolvedFromPoint.y + Math.sin(angleRad) * distance
        });
        break;
      }
      case "divisionPoint": {
        const start = evaluatePointAnchor(element.startPoint, "start");
        const end = evaluatePointAnchor(element.endPoint, "end");
        if (!start || !end) {
          break;
        }

        const vector = {
          x: end.x - start.x,
          y: end.y - start.y
        };
        const length = Math.hypot(vector.x, vector.y);

        const placement = decodeDivisionPlacement(element.placement);
        if (placement.value === undefined) break;

        if (placement.kind === "distance") {
          const distance = evaluateNumber(placement.value);
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

        const ratio = evaluateNumber(placement.value);
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

        const line1 = computedGeometry.get(element.line1Id);
        const line2 = computedGeometry.get(element.line2Id);
        if (!isLineLikeGeometry(line1)) {
          errors.push(dependencyError(element, element.line1Id, elementsById, disabledByGroupId));
          break;
        }
        if (!isLineLikeGeometry(line2)) {
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
        const baseLine = computedGeometry.get(element.baseLineId);
        if (!isLineLikeGeometry(baseLine)) {
          errors.push(dependencyError(element, element.baseLineId, elementsById, disabledByGroupId));
          break;
        }

        const basePoint = evaluatePointAnchor(element.basePoint, "basePoint");
        if (!basePoint) break;

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
        const distance = evaluateNumber(element.distance);
        if (tangentAngleDeg === undefined || distance === undefined) break;

        const angleRad = degreesToRadians(tangent.angleDeg + tangentAngleDeg);
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: basePoint.x + Math.cos(angleRad) * distance,
          y: basePoint.y + Math.sin(angleRad) * distance
        });
        break;
      }

    default:
      return false;
  }
  return true;
};
