import { singleLocalVariableReference } from "../geometry/numericExpressions";
import { pointAnchorForElement, referenceAnchor } from "../model/pointAnchors";
import type { CadElement, NumericValue, PointAnchor } from "../types/geometry";

export const supportsNumericVariables = (element: CadElement) =>
  element.type === "freePoint" ||
  element.type === "offsetPoint" ||
  element.type === "polarOffsetPoint" ||
  element.type === "divisionPoint" ||
  element.type === "line" ||
  element.type === "arcLine" ||
  element.type === "threePointArcLine" ||
  element.type === "bezierCurve" ||
  element.type === "offsetLine";

export const parseIntermediateParameterKey = (key: string) => {
  const [, intermediatePointId, field] = key.split(":");
  if (!key.startsWith("intermediate:") || !intermediatePointId || !field) return null;
  return { intermediatePointId, field };
};

export const parseVariableParameterKey = (key: string) => {
  const [, variableId, field] = key.split(":");
  if (!key.startsWith("variable:") || !variableId || field !== "value") return null;
  return { variableId };
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
    (key === "startPoint" || key === "endPoint") &&
    (element.type === "line" || element.type === "bezierCurve" || element.type === "divisionPoint")
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
  return null;
};

export const setPointAnchor = (
  element: CadElement,
  key: string,
  anchor: PointAnchor
): CadElement => {
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
    (element.type === "line" || element.type === "bezierCurve" || element.type === "divisionPoint")
  ) {
    return { ...element, startPoint: anchor };
  }
  if (
    key === "endPoint" &&
    (element.type === "line" || element.type === "bezierCurve" || element.type === "divisionPoint")
  ) {
    return { ...element, endPoint: anchor };
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
  const variable = parseVariableParameterKey(key);
  if (variable) {
    return element.numericVariables?.find((item) => item.id === variable.variableId)?.value;
  }
  const parsed = parseIntermediateParameterKey(key);
  if (parsed && element.type === "bezierCurve") {
    const intermediate = element.intermediatePoints.find(
      (point) => point.id === parsed.intermediatePointId
    );
    return intermediate?.[parsed.field as keyof typeof intermediate];
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
  if (getPointAnchor(element, key)) {
    const anchor = typeof value === "string" ? referenceAnchor(value) : value as PointAnchor;
    return setPointAnchor(element, key, anchor);
  }
  const variable = parseVariableParameterKey(key);
  if (variable) {
    return {
      ...element,
      numericVariables: (element.numericVariables ?? []).map((item) =>
        item.id === variable.variableId ? { ...item, value: value as NumericValue } : item
      )
    };
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
  return { ...element, [key]: value } as CadElement;
};

export const setNumericParameterOrLocalVariable = (
  element: CadElement,
  key: string,
  value: NumericValue
): CadElement => {
  const currentValue = getParameterValue(element, key);
  const variableId = singleLocalVariableReference(currentValue as NumericValue);
  if (variableId) {
    return {
      ...element,
      numericVariables: (element.numericVariables ?? []).map((variable) =>
        variable.id === variableId ? { ...variable, value } : variable
      )
    };
  }
  return setParameterValue(element, key, value);
};
