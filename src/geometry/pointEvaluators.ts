import type { CadElement, ComputedBezierCurve, ComputedBezierSegment, NumericValue } from "../types/geometry";
import { pointAnchorForElement } from "../model/pointAnchors";
import { degreesToRadians, normalizeDegrees360 } from "../scalars/angleMath";
import {
  cross,
  cubicDerivativeAt,
  cubicPointAt,
  dot,
  EPSILON,
  projectPointOntoCurve,
  selectBestBezierFeatureCandidate,
  signedCurvatureAt,
  solveRealQuadratic
} from "./bezierMath";
import { CIRCLE_EPSILON } from "./evaluateGeometryPrimitives";
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

const bezierExtremePointAt = (
  segment: ComputedBezierSegment,
  direction: { x: number; y: number }
) => {
  const derivativeProjection = (t: number) => dot(cubicDerivativeAt(segment, t), direction);
  const f0 = derivativeProjection(0);
  const fHalf = derivativeProjection(0.5);
  const f1 = derivativeProjection(1);
  const c = f0;
  const a = 2 * (f1 + f0 - 2 * fHalf);
  const b = f1 - f0 - a;
  const candidates = [0, 1].map((t) => ({
    t,
    score: dot(cubicPointAt(segment, t), direction)
  }));

  for (const root of solveRealQuadratic(a, b, c)) {
    if (root > 0 && root < 1) {
      candidates.push({
        t: root,
        score: dot(cubicPointAt(segment, root), direction)
      });
    }
  }

  if (Math.abs(f0) <= EPSILON && Math.abs(fHalf) <= EPSILON && Math.abs(f1) <= EPSILON) {
    candidates.push({
      t: 0.5,
      score: dot(cubicPointAt(segment, 0.5), direction)
    });
  }

  const selected = selectBestBezierFeatureCandidate(candidates);
  return cubicPointAt(segment, selected?.t ?? 0.5);
};

const bezierBulgePointAt = (segment: ComputedBezierSegment) => {
  const chord = {
    x: segment.end.x - segment.start.x,
    y: segment.end.y - segment.start.y
  };
  const chordLength = Math.hypot(chord.x, chord.y);
  if (chordLength <= EPSILON) return null;

  const derivativeCross = (t: number) => cross(chord, cubicDerivativeAt(segment, t));
  const q0 = derivativeCross(0);
  const qHalf = derivativeCross(0.5);
  const q1 = derivativeCross(1);
  const c = q0;
  const a = 2 * (q1 + q0 - 2 * qHalf);
  const b = q1 - q0 - a;
  const scoreAt = (t: number) =>
    Math.abs(cross(chord, {
      x: cubicPointAt(segment, t).x - segment.start.x,
      y: cubicPointAt(segment, t).y - segment.start.y
    })) / chordLength;
  const candidates = [] as { t: number; score: number }[];

  for (const root of solveRealQuadratic(a, b, c)) {
    if (root > 0 && root < 1) candidates.push({ t: root, score: scoreAt(root) });
  }
  if (Math.abs(q0) <= EPSILON && Math.abs(qHalf) <= EPSILON && Math.abs(q1) <= EPSILON) {
    candidates.push({ t: 0.5, score: scoreAt(0.5) });
  }

  const selected = selectBestBezierFeatureCandidate(candidates);
  return cubicPointAt(segment, selected?.t ?? 0.5);
};

type CurveSide = "convex" | "concave";
type CurveSideFrame = {
  tangent: { x: number; y: number };
  normal: { x: number; y: number };
};

const curveSideFrameAt = (
  segment: ComputedBezierSegment,
  t: number,
  curveSide: CurveSide
): CurveSideFrame | null => {
  const first = cubicDerivativeAt(segment, t);
  const speed = Math.hypot(first.x, first.y);
  if (speed <= EPSILON) return null;

  const curvature = signedCurvatureAt(segment, t);
  if (!Number.isFinite(curvature) || Math.abs(curvature) <= EPSILON) return null;

  const tangent = { x: first.x / speed, y: first.y / speed };
  const leftNormal = { x: -tangent.y, y: tangent.x };
  const concaveSign = curvature > 0 ? 1 : -1;
  const concaveNormal = {
    x: concaveSign * leftNormal.x,
    y: concaveSign * leftNormal.y
  };
  return {
    tangent,
    normal: curveSide === "concave"
      ? concaveNormal
      : { x: -concaveNormal.x, y: -concaveNormal.y }
  };
};

const curveSidePoint = (
  curve: ComputedBezierCurve,
  basePoint: { x: number; y: number },
  curveSide: unknown,
  distance: number
): { point: { x: number; y: number } } | { error: string } => {
  if (curveSide !== "convex" && curveSide !== "concave") {
    return { error: "curveSide は convex または concave で指定してください。" };
  }

  const projection = projectPointOntoCurve(curve.segments, basePoint);
  if (!projection || projection.distance > 0.001) {
    return { error: "curveSide の基準点は基準ベジェ曲線上にありません。基準曲線上の点を指定してください。" };
  }

  const samples = [{ segmentIndex: projection.segmentIndex, localT: projection.localT }];
  if (projection.localT <= EPSILON && projection.segmentIndex > 0) {
    samples.unshift({ segmentIndex: projection.segmentIndex - 1, localT: 1 });
  } else if (projection.localT >= 1 - EPSILON && projection.segmentIndex + 1 < curve.segments.length) {
    samples.push({ segmentIndex: projection.segmentIndex + 1, localT: 0 });
  }

  const frames = samples.map(({ segmentIndex, localT }) =>
    curveSideFrameAt(curve.segments[segmentIndex], localT, curveSide)
  );
  if (frames.some((frame) => frame === null)) {
    return { error: "curveSide を決定する接線または曲率が不定義です。" };
  }

  const [first, second] = frames as [CurveSideFrame, ...CurveSideFrame[]];
  if (second) {
    const tangentMismatch = Math.hypot(first.tangent.x - second.tangent.x, first.tangent.y - second.tangent.y);
    const normalMismatch = Math.hypot(first.normal.x - second.normal.x, first.normal.y - second.normal.y);
    if (tangentMismatch > EPSILON || normalMismatch > EPSILON) {
      return { error: "curveSide の基準点がベジェ曲線の曖昧な内部 join にあります。corner または不一致の曲率側は指定できません。" };
    }
  }

  return {
    point: {
      x: basePoint.x + first.normal.x * distance,
      y: basePoint.y + first.normal.y * distance
    }
  };
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
        if (!baseLine) {
          errors.push(dependencyError(element, element.baseLineId, elementsById, disabledByGroupId));
          break;
        }
        if (element.curveSide === undefined && !isLineLikeGeometry(baseLine)) {
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
          const result = curveSidePoint(baseLine, basePoint, element.curveSide, distance);
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

        if (!isLineLikeGeometry(baseLine)) {
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
      case "bezierExtremePoint": {
        const source = computedGeometry.get(element.baseLineId);
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
        const point = bezierExtremePointAt(source.segments[segmentIndex], {
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
        const source = computedGeometry.get(element.baseLineId);
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

        const point = bezierBulgePointAt(segment);
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
