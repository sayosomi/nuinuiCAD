import type { CadElement, NumericValue, PointAnchor } from "../types/geometry";
import type { CadDocumentSnapshot } from "../state/cadDocumentStore";

const negateNumericValue = (value: NumericValue): NumericValue => {
  if (typeof value === "number") {
    return Object.is(value, -0) || value === 0 ? 0 : -value;
  }
  return {
    ...value,
    expression: `-(${value.expression})`
  };
};

const migratePointAnchorToYUp = (anchor: PointAnchor): PointAnchor => {
  if (anchor.mode !== "coordinate") return anchor;
  return {
    ...anchor,
    y: negateNumericValue(anchor.y)
  };
};

const migrateElementToYUp = (element: CadElement): CadElement => {
  switch (element.type) {
    case "freePoint":
      return { ...element, y: negateNumericValue(element.y) };
    case "offsetPoint":
      return { ...element, dy: negateNumericValue(element.dy) };
    case "divisionPoint":
      return {
        ...element,
        startPoint: migratePointAnchorToYUp(element.startPoint),
        endPoint: migratePointAnchorToYUp(element.endPoint)
      };
    case "lineTangentOffsetPoint":
      return { ...element, basePoint: migratePointAnchorToYUp(element.basePoint) };
    case "splitLine":
      return { ...element, splitPoint: migratePointAnchorToYUp(element.splitPoint) };
    case "extendTrim":
      return { ...element, point: migratePointAnchorToYUp(element.point) };
    case "line":
      return {
        ...element,
        startPoint: migratePointAnchorToYUp(element.startPoint),
        endPoint: migratePointAnchorToYUp(element.endPoint)
      };
    case "arcLine":
      return { ...element, centerPoint: migratePointAnchorToYUp(element.centerPoint) };
    case "threePointArcLine":
      return {
        ...element,
        point1: migratePointAnchorToYUp(element.point1),
        point2: migratePointAnchorToYUp(element.point2),
        point3: migratePointAnchorToYUp(element.point3)
      };
    case "bezierCurve":
      return {
        ...element,
        startPoint: migratePointAnchorToYUp(element.startPoint),
        intermediatePoints: element.intermediatePoints.map((point) => ({
          ...point,
          point: migratePointAnchorToYUp(point.point)
        })),
        endPoint: migratePointAnchorToYUp(element.endPoint)
      };
    case "copyLine":
    case "move":
      return {
        ...element,
        startPoint: migratePointAnchorToYUp(element.startPoint),
        endPoint: migratePointAnchorToYUp(element.endPoint)
      };
    case "symmetricCopyLine":
    case "symmetricMove":
      return {
        ...element,
        axisPoint1: migratePointAnchorToYUp(element.axisPoint1),
        axisPoint2: migratePointAnchorToYUp(element.axisPoint2)
      };
    case "variable":
      return {
        ...element,
        point1: migratePointAnchorToYUp(element.point1),
        point2: migratePointAnchorToYUp(element.point2),
        point: migratePointAnchorToYUp(element.point)
      };
    default:
      return element;
  }
};

export const migrateDocumentToYUp = (document: CadDocumentSnapshot): CadDocumentSnapshot => ({
  ...document,
  elements: document.elements.map(migrateElementToYUp)
});
