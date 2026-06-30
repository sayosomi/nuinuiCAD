import { evaluateElements } from "../geometry/evaluate";
import {
  isLineLikeGeometry,
  tangentAtPointOnLineLikeGeometry
} from "../geometry/linePaths";
import { addToNumericValue } from "../geometry/numericExpressions";
import { setNumericParameterOrLocalVariable } from "../parameters/parameterAccess";
import type {
  CadElement,
  ComputedBezierCurve,
  ElementId,
  EvaluationResult,
  PointAnchor
} from "../types/geometry";
import {
  anchorReferenceElementId,
  pointAnchorForElement,
  resolveDerivedPoint
} from "./pointAnchors";

export type BezierHandleRole =
  | "start"
  | "end"
  | "intermediateIncoming"
  | "intermediateOutgoing";

type DragDeltaOptions = {
  dx?: number;
  dy?: number;
  angleLocked?: boolean;
  distanceLocked?: boolean;
  baseEvaluation?: EvaluationResult;
};

type BezierHandleDragDeltaOptions = DragDeltaOptions & {
  role: BezierHandleRole;
  intermediatePointId?: string;
};

const isComputedPoint = (geometry: unknown): geometry is { kind: "point"; x: number; y: number } =>
  typeof geometry === "object" &&
  geometry !== null &&
  "kind" in geometry &&
  geometry.kind === "point";

const isComputedBezierCurve = (geometry: unknown): geometry is ComputedBezierCurve =>
  typeof geometry === "object" &&
  geometry !== null &&
  "kind" in geometry &&
  geometry.kind === "bezierCurve";

const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

type DragEvaluationContext = {
  evaluation: EvaluationResult;
  elementsById: Map<ElementId, CadElement>;
};

const dragEvaluationContext = (
  sourceElements: CadElement[],
  baseEvaluation?: EvaluationResult
): DragEvaluationContext => ({
  evaluation: baseEvaluation ?? evaluateElements(sourceElements),
  elementsById: new Map(sourceElements.map((item) => [item.id, item]))
});

const movePolarOffsetPointByDelta = ({
  element,
  context,
  dx,
  dy,
  angleLocked,
  distanceLocked
}: {
  element: Extract<CadElement, { type: "polarOffsetPoint" }>;
  context: DragEvaluationContext;
  dx: number;
  dy: number;
  angleLocked?: boolean;
  distanceLocked?: boolean;
}) => {
  if (angleLocked && distanceLocked) return element;

  const { evaluation, elementsById } = context;
  const point = evaluation.computedGeometry.get(element.id);
  const fromAnchor = pointAnchorForElement(element);
  const fromPointId = fromAnchor ? anchorReferenceElementId(fromAnchor) : null;
  const fromGeometry = fromPointId ? evaluation.computedGeometry.get(fromPointId) : null;
  const fromPoint =
    fromAnchor?.mode === "derived"
      ? resolveDerivedPoint(
          fromGeometry ?? undefined,
          fromAnchor.pointKey,
          elementsById
        )
      : fromGeometry;
  if (!isComputedPoint(point) || !isComputedPoint(fromPoint)) return element;

  const currentVector = {
    x: point.x - fromPoint.x,
    y: point.y - fromPoint.y
  };
  const currentDistance = Math.hypot(currentVector.x, currentVector.y);
  const currentAngleDeg =
    currentDistance === 0
      ? 0
      : normalizeDegrees(radiansToDegrees(Math.atan2(currentVector.y, currentVector.x)));

  const target = {
    x: point.x + dx,
    y: point.y + dy
  };
  const vector = {
    x: target.x - fromPoint.x,
    y: target.y - fromPoint.y
  };

  if (angleLocked) {
    const angleRad = degreesToRadians(currentAngleDeg);
    const unit = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
    const projectedDistance = Math.max(0, vector.x * unit.x + vector.y * unit.y);
    if (projectedDistance === currentDistance) return element;
    return { ...element, distance: projectedDistance };
  }

  if (distanceLocked) {
    if (Math.hypot(vector.x, vector.y) === 0) return element;
    const angleDeg = normalizeDegrees(radiansToDegrees(Math.atan2(vector.y, vector.x)));
    if (angleDeg === currentAngleDeg) return element;
    return { ...element, angleDeg };
  }

  const distance = Math.hypot(vector.x, vector.y);
  const angleDeg =
    distance === 0
      ? currentAngleDeg
      : normalizeDegrees(radiansToDegrees(Math.atan2(vector.y, vector.x)));
  if (distance === currentDistance && angleDeg === currentAngleDeg) return element;
  return {
    ...element,
    distance,
    angleDeg
  };
};

const divisionPointDragTarget = ({
  element,
  context
}: {
  element: Extract<CadElement, { type: "divisionPoint" }>;
  context: DragEvaluationContext;
}) => {
  const { evaluation, elementsById } = context;
  const point = evaluation.computedGeometry.get(element.id);
  const startGeometry = evaluation.computedGeometry.get(
    anchorReferenceElementId(element.startPoint) ?? ""
  );
  const endGeometry = evaluation.computedGeometry.get(
    anchorReferenceElementId(element.endPoint) ?? ""
  );
  const start =
    element.startPoint.mode === "derived"
      ? resolveDerivedPoint(startGeometry ?? undefined, element.startPoint.pointKey, elementsById)
      : startGeometry;
  const end =
    element.endPoint.mode === "derived"
      ? resolveDerivedPoint(endGeometry ?? undefined, element.endPoint.pointKey, elementsById)
      : endGeometry;

  if (!isComputedPoint(point) || !isComputedPoint(start) || !isComputedPoint(end)) return null;
  return { point, start, end };
};

const moveDivisionPointByDelta = ({
  element,
  context,
  dx,
  dy
}: {
  element: Extract<CadElement, { type: "divisionPoint" }>;
  context: DragEvaluationContext;
  dx: number;
  dy: number;
}) => {
  const target = divisionPointDragTarget({ element, context });
  if (!target) return element;

  const baseVector = {
    x: target.end.x - target.start.x,
    y: target.end.y - target.start.y
  };
  const baseLength = Math.hypot(baseVector.x, baseVector.y);
  if (baseLength === 0) return element;

  const movedVector = {
    x: target.point.x + dx - target.start.x,
    y: target.point.y + dy - target.start.y
  };
  const projectedDistance =
    (movedVector.x * baseVector.x + movedVector.y * baseVector.y) / baseLength;

  if (element.placementMode === "distance") {
    return setNumericParameterOrLocalVariable(element, "distance", projectedDistance);
  }

  return setNumericParameterOrLocalVariable(element, "ratio", projectedDistance / baseLength);
};

const computedPointForAnchor = (
  anchor: PointAnchor,
  context: DragEvaluationContext
) => {
  const { evaluation, elementsById } = context;
  const geometry = evaluation.computedGeometry.get(anchorReferenceElementId(anchor) ?? "");
  if (anchor.mode === "derived") {
    return resolveDerivedPoint(geometry ?? undefined, anchor.pointKey, elementsById);
  }
  return geometry;
};

const moveLineTangentOffsetPointByDelta = ({
  element,
  context,
  dx,
  dy,
  angleLocked,
  distanceLocked
}: {
  element: Extract<CadElement, { type: "lineTangentOffsetPoint" }>;
  context: DragEvaluationContext;
  dx: number;
  dy: number;
  angleLocked?: boolean;
  distanceLocked?: boolean;
}) => {
  if (angleLocked && distanceLocked) return element;

  const { evaluation } = context;
  const point = evaluation.computedGeometry.get(element.id);
  const baseLine = evaluation.computedGeometry.get(element.baseLineId);
  const basePoint = computedPointForAnchor(element.basePoint, context);
  if (!isComputedPoint(point) || !isComputedPoint(basePoint) || !isLineLikeGeometry(baseLine)) {
    return element;
  }

  const tangent = tangentAtPointOnLineLikeGeometry(baseLine, basePoint);
  if (!tangent) return element;

  const currentVector = {
    x: point.x - basePoint.x,
    y: point.y - basePoint.y
  };
  const currentDistance = Math.hypot(currentVector.x, currentVector.y);
  const currentAbsoluteAngleDeg =
    currentDistance === 0
      ? tangent.angleDeg
      : normalizeDegrees(radiansToDegrees(Math.atan2(currentVector.y, currentVector.x)));
  const currentRelativeAngleDeg = normalizeDegrees(currentAbsoluteAngleDeg - tangent.angleDeg);
  const target = {
    x: point.x + dx,
    y: point.y + dy
  };
  const vector = {
    x: target.x - basePoint.x,
    y: target.y - basePoint.y
  };

  if (angleLocked) {
    const currentAbsoluteAngleRad = degreesToRadians(currentAbsoluteAngleDeg);
    const currentUnit = {
      x: Math.cos(currentAbsoluteAngleRad),
      y: Math.sin(currentAbsoluteAngleRad)
    };
    const projectedDistance = Math.max(0, vector.x * currentUnit.x + vector.y * currentUnit.y);
    if (projectedDistance === currentDistance) return element;
    return setNumericParameterOrLocalVariable(element, "distance", projectedDistance);
  }

  if (distanceLocked) {
    if (Math.hypot(vector.x, vector.y) === 0) return element;
    const absoluteAngleDeg = normalizeDegrees(radiansToDegrees(Math.atan2(vector.y, vector.x)));
    const relativeAngleDeg = normalizeDegrees(absoluteAngleDeg - tangent.angleDeg);
    if (relativeAngleDeg === currentRelativeAngleDeg) return element;
    return setNumericParameterOrLocalVariable(element, "tangentAngleDeg", relativeAngleDeg);
  }

  const distance = Math.hypot(vector.x, vector.y);
  const absoluteAngleDeg =
    distance === 0
      ? currentAbsoluteAngleDeg
      : normalizeDegrees(radiansToDegrees(Math.atan2(vector.y, vector.x)));
  const relativeAngleDeg = normalizeDegrees(absoluteAngleDeg - tangent.angleDeg);
  if (distance === currentDistance && relativeAngleDeg === currentRelativeAngleDeg) return element;
  const nextElement = setNumericParameterOrLocalVariable(element, "distance", distance);
  return setNumericParameterOrLocalVariable(nextElement, "tangentAngleDeg", relativeAngleDeg);
};

export const movePointElementByDeltaInElements = (
  elements: CadElement[],
  elementId: ElementId,
  { dx = 0, dy = 0, angleLocked, distanceLocked, baseEvaluation }: DragDeltaOptions
) => {
  if (dx === 0 && dy === 0) return null;

  let didMove = false;
  let context: DragEvaluationContext | null = null;
  const getContext = () => {
    context ??= dragEvaluationContext(elements, baseEvaluation);
    return context;
  };
  const nextElements = elements.map((element) => {
    if (element.id !== elementId) return element;

    if (element.type === "freePoint") {
      didMove = true;
      return {
        ...element,
        x: addToNumericValue(element.x, dx),
        y: addToNumericValue(element.y, dy)
      };
    }

    if (element.type === "offsetPoint") {
      didMove = true;
      return {
        ...element,
        dx: addToNumericValue(element.dx, dx),
        dy: addToNumericValue(element.dy, dy)
      };
    }

    if (element.type === "polarOffsetPoint") {
      const nextElement = movePolarOffsetPointByDelta({
        element,
        context: getContext(),
        dx,
        dy,
        angleLocked,
        distanceLocked
      });
      didMove = didMove || nextElement !== element;
      return nextElement;
    }

    if (element.type === "divisionPoint") {
      const nextElement = moveDivisionPointByDelta({
        element,
        context: getContext(),
        dx,
        dy
      });
      didMove = didMove || nextElement !== element;
      return nextElement;
    }

    if (element.type === "lineTangentOffsetPoint") {
      const nextElement = moveLineTangentOffsetPointByDelta({
        element,
        context: getContext(),
        dx,
        dy,
        angleLocked,
        distanceLocked
      });
      didMove = didMove || nextElement !== element;
      return nextElement;
    }

    return element;
  });

  return didMove ? nextElements : null;
};

type BezierHandleTarget = {
  anchor: { x: number; y: number };
  control: { x: number; y: number };
  angleKey: string;
  lengthKey: string;
  storedAngleOffsetDeg: number;
};

const bezierHandleTarget = ({
  element,
  context,
  role,
  intermediatePointId
}: {
  element: Extract<CadElement, { type: "bezierCurve" }>;
  context: DragEvaluationContext;
  role: BezierHandleRole;
  intermediatePointId?: string;
}): BezierHandleTarget | null => {
  const curve = context.evaluation.computedGeometry.get(element.id);
  if (!isComputedBezierCurve(curve) || curve.segments.length === 0) return null;

  if (role === "start") {
    const segment = curve.segments[0];
    return {
      anchor: segment.start,
      control: segment.control1,
      angleKey: "startHandleAngleDeg",
      lengthKey: "startHandleLength",
      storedAngleOffsetDeg: 0
    };
  }

  if (role === "end") {
    const segment = curve.segments.at(-1);
    if (!segment) return null;
    return {
      anchor: segment.end,
      control: segment.control2,
      angleKey: "endHandleAngleDeg",
      lengthKey: "endHandleLength",
      storedAngleOffsetDeg: 180
    };
  }

  const intermediateIndex = element.intermediatePoints.findIndex(
    (point) => point.id === intermediatePointId
  );
  if (intermediateIndex < 0) return null;
  const intermediate = element.intermediatePoints[intermediateIndex];

  if (role === "intermediateIncoming") {
    const segment = curve.segments[intermediateIndex];
    if (!segment) return null;
    return {
      anchor: segment.end,
      control: segment.control2,
      angleKey: `intermediate:${intermediate.id}:handleAngleDeg`,
      lengthKey: `intermediate:${intermediate.id}:incomingHandleLength`,
      storedAngleOffsetDeg: 180
    };
  }

  const segment = curve.segments[intermediateIndex + 1];
  if (!segment) return null;
  return {
    anchor: segment.start,
    control: segment.control1,
    angleKey: `intermediate:${intermediate.id}:handleAngleDeg`,
    lengthKey: `intermediate:${intermediate.id}:outgoingHandleLength`,
    storedAngleOffsetDeg: 0
  };
};

const moveBezierHandle = ({
  element,
  context,
  dx,
  dy,
  role,
  intermediatePointId,
  angleLocked,
  distanceLocked
}: {
  element: Extract<CadElement, { type: "bezierCurve" }>;
  context: DragEvaluationContext;
  dx: number;
  dy: number;
  role: BezierHandleRole;
  intermediatePointId?: string;
  angleLocked?: boolean;
  distanceLocked?: boolean;
}) => {
  if (angleLocked && distanceLocked) return element;

  const target = bezierHandleTarget({ element, context, role, intermediatePointId });
  if (!target) return element;

  const currentVector = {
    x: target.control.x - target.anchor.x,
    y: target.control.y - target.anchor.y
  };
  const currentLength = Math.hypot(currentVector.x, currentVector.y);
  const currentControlAngleDeg =
    currentLength === 0
      ? target.storedAngleOffsetDeg
      : normalizeDegrees(radiansToDegrees(Math.atan2(currentVector.y, currentVector.x)));
  const currentStoredAngleDeg = normalizeDegrees(
    currentControlAngleDeg - target.storedAngleOffsetDeg
  );

  const movedControl = {
    x: target.control.x + dx,
    y: target.control.y + dy
  };
  const movedVector = {
    x: movedControl.x - target.anchor.x,
    y: movedControl.y - target.anchor.y
  };

  if (angleLocked) {
    const angleRad = degreesToRadians(currentControlAngleDeg);
    const unit = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
    const projectedLength = Math.max(0, movedVector.x * unit.x + movedVector.y * unit.y);
    if (projectedLength === currentLength) return element;
    return setNumericParameterOrLocalVariable(element, target.lengthKey, projectedLength);
  }

  const movedLength = Math.hypot(movedVector.x, movedVector.y);
  if (distanceLocked) {
    if (movedLength === 0) return element;
    const controlAngleDeg = normalizeDegrees(radiansToDegrees(Math.atan2(movedVector.y, movedVector.x)));
    const storedAngleDeg = normalizeDegrees(controlAngleDeg - target.storedAngleOffsetDeg);
    if (storedAngleDeg === currentStoredAngleDeg) return element;
    return setNumericParameterOrLocalVariable(element, target.angleKey, storedAngleDeg);
  }

  const controlAngleDeg =
    movedLength === 0
      ? currentControlAngleDeg
      : normalizeDegrees(radiansToDegrees(Math.atan2(movedVector.y, movedVector.x)));
  const storedAngleDeg = normalizeDegrees(controlAngleDeg - target.storedAngleOffsetDeg);
  if (movedLength === currentLength && storedAngleDeg === currentStoredAngleDeg) return element;
  return setNumericParameterOrLocalVariable(
    setNumericParameterOrLocalVariable(element, target.angleKey, storedAngleDeg),
    target.lengthKey,
    movedLength
  );
};

export const moveBezierHandleByDeltaInElements = (
  elements: CadElement[],
  elementId: ElementId,
  {
    dx = 0,
    dy = 0,
    role,
    intermediatePointId,
    angleLocked,
    distanceLocked,
    baseEvaluation
  }: BezierHandleDragDeltaOptions
) => {
  if (dx === 0 && dy === 0) return null;

  let didMove = false;
  const context = dragEvaluationContext(elements, baseEvaluation);
  const nextElements = elements.map((element) => {
    if (element.id !== elementId || element.type !== "bezierCurve") return element;
    const nextElement = moveBezierHandle({
      element,
      context,
      dx,
      dy,
      role,
      intermediatePointId,
      angleLocked,
      distanceLocked
    });
    didMove = nextElement !== element;
    return nextElement;
  });

  return didMove ? nextElements : null;
};
