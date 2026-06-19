import { evaluateElements } from "../geometry/evaluate";
import { addToNumericValue } from "../geometry/numericExpressions";
import { setNumericParameterOrLocalVariable } from "../parameters/parameterAccess";
import type { CadElement, ComputedBezierCurve, ElementId } from "../types/geometry";
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

const movePolarOffsetPointByDelta = ({
  element,
  sourceElements,
  dx,
  dy,
  angleLocked,
  distanceLocked
}: {
  element: Extract<CadElement, { type: "polarOffsetPoint" }>;
  sourceElements: CadElement[];
  dx: number;
  dy: number;
  angleLocked?: boolean;
  distanceLocked?: boolean;
}) => {
  if (angleLocked && distanceLocked) return element;

  const evaluation = evaluateElements(sourceElements);
  const point = evaluation.computedGeometry.get(element.id);
  const fromAnchor = pointAnchorForElement(element);
  const fromPointId = fromAnchor ? anchorReferenceElementId(fromAnchor) : null;
  const fromGeometry = fromPointId ? evaluation.computedGeometry.get(fromPointId) : null;
  const fromPoint =
    fromAnchor?.mode === "derived"
      ? resolveDerivedPoint(
          fromGeometry ?? undefined,
          fromAnchor.pointKey,
          new Map(sourceElements.map((item) => [item.id, item]))
        )
      : fromGeometry;
  if (!isComputedPoint(point) || !isComputedPoint(fromPoint)) return element;

  const currentVector = {
    x: point.x - fromPoint.x,
    y: fromPoint.y - point.y
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
    y: fromPoint.y - target.y
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

export const movePointElementByDeltaInElements = (
  elements: CadElement[],
  elementId: ElementId,
  { dx = 0, dy = 0, angleLocked, distanceLocked }: DragDeltaOptions
) => {
  if (dx === 0 && dy === 0) return null;

  let didMove = false;
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
        sourceElements: elements,
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
  sourceElements,
  role,
  intermediatePointId
}: {
  element: Extract<CadElement, { type: "bezierCurve" }>;
  sourceElements: CadElement[];
  role: BezierHandleRole;
  intermediatePointId?: string;
}): BezierHandleTarget | null => {
  const curve = evaluateElements(sourceElements).computedGeometry.get(element.id);
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
  sourceElements,
  dx,
  dy,
  role,
  intermediatePointId,
  angleLocked,
  distanceLocked
}: {
  element: Extract<CadElement, { type: "bezierCurve" }>;
  sourceElements: CadElement[];
  dx: number;
  dy: number;
  role: BezierHandleRole;
  intermediatePointId?: string;
  angleLocked?: boolean;
  distanceLocked?: boolean;
}) => {
  if (angleLocked && distanceLocked) return element;

  const target = bezierHandleTarget({ element, sourceElements, role, intermediatePointId });
  if (!target) return element;

  const currentVector = {
    x: target.control.x - target.anchor.x,
    y: target.anchor.y - target.control.y
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
    y: target.anchor.y - movedControl.y
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
    distanceLocked
  }: BezierHandleDragDeltaOptions
) => {
  if (dx === 0 && dy === 0) return null;

  let didMove = false;
  const nextElements = elements.map((element) => {
    if (element.id !== elementId || element.type !== "bezierCurve") return element;
    const nextElement = moveBezierHandle({
      element,
      sourceElements: elements,
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
