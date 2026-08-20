import { pointAnchorForElement, referenceAnchor } from "../model/pointAnchors";
import type { CadElement, NumericValue, PointAnchor } from "../types/geometry";

export const parseIntermediateParameterKey = (key: string) => {
  const [, intermediatePointId, field] = key.split(":");
  if (!key.startsWith("intermediate:") || !intermediatePointId || !field) return null;
  return { intermediatePointId, field };
};

export const parseAnchorCoordinateParameterKey = (key: string) => {
  const parts = key.split(":");
  const axis = parts.at(-1);
  if (axis !== "x" && axis !== "y") return null;
  const anchorKey = parts.slice(0, -1).join(":");
  if (!anchorKey) return null;
  return { anchorKey, axis };
};

export const getPointAnchor = (element: CadElement, key: string): PointAnchor | null => {
  const parsed = parseIntermediateParameterKey(key);
  if (parsed && element.type === "bezierCurve" && parsed.field === "point") {
    return element.intermediatePoints.find((point) => point.id === parsed.intermediatePointId)?.point ?? null;
  }
  if (
    key === "startPoint" &&
    (element.type === "line" ||
      element.type === "angleLengthLine" ||
      element.type === "bezierCurve" ||
      element.type === "divisionPoint" ||
      element.type === "copyLine" ||
      element.type === "move")
  ) {
    return element.startPoint;
  }
  if (
    key === "endPoint" &&
    (element.type === "line" ||
      element.type === "bezierCurve" ||
      element.type === "divisionPoint" ||
      element.type === "copyLine" ||
      element.type === "move")
  ) {
    return element.endPoint;
  }
  if (
    (key === "axisPoint1" || key === "axisPoint2") &&
    (element.type === "symmetricCopyLine" || element.type === "symmetricMove")
  ) {
    return element[key];
  }
  if (key === "centerPoint" && element.type === "arcLine") {
    return element.centerPoint;
  }
  if (
    (key === "point1" || key === "point2" || key === "point3") &&
    element.type === "threePointArcLine"
  ) {
    return element[key];
  }
  if (key === "fromPoint" && (element.type === "offsetPoint" || element.type === "polarOffsetPoint")) {
    return pointAnchorForElement(element);
  }
  if (key === "basePoint" && element.type === "lineTangentOffsetPoint") {
    return element.basePoint;
  }
  if (key === "splitPoint" && element.type === "splitLine") {
    return element.splitPoint;
  }
  if (key === "point" && element.type === "extendTrim") {
    return element.point;
  }
  if (key === "originPoint" && element.type === "image") {
    return element.originPoint;
  }
  if (key === "anchor" && element.type === "text") {
    return element.anchor;
  }
  return null;
};

export const setPointAnchor = (
  element: CadElement,
  key: string,
  anchor: PointAnchor | null
): CadElement => {
  if (!anchor && key === "anchor" && element.type === "text") {
    return { ...element, anchor: null };
  }
  if (!anchor) return element;
  const parsed = parseIntermediateParameterKey(key);
  if (parsed && element.type === "bezierCurve" && parsed.field === "point") {
    return {
      ...element,
      intermediatePoints: element.intermediatePoints.map((point) =>
        point.id === parsed.intermediatePointId ? { ...point, point: anchor } : point
      )
    };
  }
  if (
    key === "startPoint" &&
    (element.type === "line" ||
      element.type === "angleLengthLine" ||
      element.type === "bezierCurve" ||
      element.type === "divisionPoint" ||
      element.type === "copyLine" ||
      element.type === "move")
  ) {
    return { ...element, startPoint: anchor };
  }
  if (
    key === "endPoint" &&
    (element.type === "line" ||
      element.type === "bezierCurve" ||
      element.type === "divisionPoint" ||
      element.type === "copyLine" ||
      element.type === "move")
  ) {
    return { ...element, endPoint: anchor };
  }
  if (key === "axisPoint1" && (element.type === "symmetricCopyLine" || element.type === "symmetricMove")) {
    return { ...element, axisPoint1: anchor };
  }
  if (key === "axisPoint2" && (element.type === "symmetricCopyLine" || element.type === "symmetricMove")) {
    return { ...element, axisPoint2: anchor };
  }
  if (key === "centerPoint" && element.type === "arcLine") {
    return { ...element, centerPoint: anchor };
  }
  if (
    (key === "point1" || key === "point2" || key === "point3") &&
    element.type === "threePointArcLine"
  ) {
    return { ...element, [key]: anchor };
  }
  if (key === "fromPoint" && element.type === "offsetPoint") {
    return {
      ...element,
      fromPoint: anchor,
      fromPointId: anchor.mode === "reference" ? anchor.pointId : undefined
    };
  }
  if (key === "fromPoint" && element.type === "polarOffsetPoint") {
    return {
      ...element,
      fromPoint: anchor,
      fromPointId: anchor.mode === "reference" ? anchor.pointId : undefined
    };
  }
  if (key === "basePoint" && element.type === "lineTangentOffsetPoint") {
    return { ...element, basePoint: anchor };
  }
  if (key === "splitPoint" && element.type === "splitLine") {
    return { ...element, splitPoint: anchor };
  }
  if (key === "point" && element.type === "extendTrim") {
    return { ...element, point: anchor };
  }
  if (key === "originPoint" && element.type === "image") {
    return { ...element, originPoint: anchor };
  }
  if (key === "anchor" && element.type === "text") {
    return { ...element, anchor };
  }
  return element;
};

export const getParameterValue = (element: CadElement, key: string) => {
  const anchorCoordinate = parseAnchorCoordinateParameterKey(key);
  if (anchorCoordinate) {
    const anchor = getPointAnchor(element, anchorCoordinate.anchorKey);
    return anchor?.mode === "coordinate"
      ? anchor[anchorCoordinate.axis as "x" | "y"]
      : undefined;
  }
  const anchor = getPointAnchor(element, key);
  if (anchor) return anchor;
  const parsed = parseIntermediateParameterKey(key);
  if (parsed && element.type === "bezierCurve") {
    const intermediate = element.intermediatePoints.find(
      (point) => point.id === parsed.intermediatePointId
    );
    return intermediate?.[parsed.field as keyof typeof intermediate];
  }
  if (
    (element.type === "divisionPoint" || element.type === "lineDivisionPoint") &&
    (key === "placementMode" || key === "distance" || key === "ratio")
  ) {
    if (key === "placementMode") return element.placement.kind;
    return element.placement.kind === key ? element.placement.value : undefined;
  }
  return element[key as keyof CadElement];
};

export const setParameterValue = (
  element: CadElement,
  key: string,
  value: unknown
): CadElement => {
  const anchorCoordinate = parseAnchorCoordinateParameterKey(key);
  if (anchorCoordinate) {
    const anchor = getPointAnchor(element, anchorCoordinate.anchorKey);
    if (!anchor || anchor.mode !== "coordinate") return element;
    return setPointAnchor(element, anchorCoordinate.anchorKey, {
      ...anchor,
      [anchorCoordinate.axis]: value as NumericValue
    });
  }
  if (getPointAnchor(element, key) || (element.type === "text" && key === "anchor")) {
    const anchor = value === null
      ? null
      : typeof value === "string"
        ? referenceAnchor(value)
        : value as PointAnchor;
    return setPointAnchor(element, key, anchor);
  }
  const parsed = parseIntermediateParameterKey(key);
  if (parsed && element.type === "bezierCurve") {
    return {
      ...element,
      intermediatePoints: element.intermediatePoints.map((point) =>
        point.id === parsed.intermediatePointId ? { ...point, [parsed.field]: value } : point
      )
    };
  }
  if (
    (element.type === "divisionPoint" || element.type === "lineDivisionPoint") &&
    (key === "distance" || key === "ratio")
  ) {
    return { ...element, placement: { kind: key, value: value as NumericValue } };
  }
  if (key === "colorId" && value === undefined) {
    const rest = { ...element };
    delete rest.colorId;
    return rest as CadElement;
  }
  return { ...element, [key]: value } as CadElement;
};

export const setNumericParameterOrLocalVariable = (
  element: CadElement,
  key: string,
  value: NumericValue
): CadElement => {
  return setParameterValue(element, key, value);
};
