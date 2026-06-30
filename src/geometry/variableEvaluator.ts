import type {
  CadElement,
  ComputedGeometry,
  ComputedLine,
  ComputedVariable,
  DependencyError,
  ElementId,
  VariableElement
} from "../types/geometry";
import {
  dependencyError,
  geometryError,
  getPointAnchorOrError,
  numericError
} from "./evaluationContext";
import type { LocalVariableEvaluation } from "./evaluationContext";

const EPSILON = 1e-9;

const normalizeDegrees = (degrees: number) => (degrees + 360) % 360;

const computedLineOrError = (
  element: CadElement,
  lineId: ElementId,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[],
  disabledByGroupId: Map<ElementId, ElementId>
): ComputedLine | undefined => {
  const line = computedGeometry.get(lineId);
  if (line?.kind !== "line") {
    errors.push(dependencyError(element, lineId, elementsById, disabledByGroupId));
    return undefined;
  }
  return line;
};

export const evaluateVariableElement = (
  element: VariableElement,
  {
    computedGeometry,
    computedVariables,
    elementsById,
    errors,
    disabledByGroupId,
    localVariables
  }: {
    computedGeometry: Map<ElementId, ComputedGeometry>;
    computedVariables: Map<ElementId, ComputedVariable>;
    elementsById: Map<ElementId, CadElement>;
    errors: DependencyError[];
    disabledByGroupId: Map<ElementId, ElementId>;
    localVariables: LocalVariableEvaluation;
  }
) => {
  const numeric = (value = element.expression) =>
    numericError(
      element,
      value,
      computedGeometry,
      elementsById,
      errors,
      localVariables.localVariableValues,
      localVariables.localVariableNames,
      disabledByGroupId,
      computedVariables
    );
  const point = (anchor: VariableElement["point1"], key: string) =>
    getPointAnchorOrError(
      element,
      anchor,
      key,
      computedGeometry,
      elementsById,
      errors,
      localVariables.localVariableValues,
      localVariables.localVariableNames,
      disabledByGroupId,
      computedVariables,
      Array.from(elementsById.values())
    );

  let value: number | undefined;

  if (element.valueMode === "expression") {
    value = numeric();
  }

  if (element.valueMode === "pointDistance") {
    const point1 = point(element.point1, "point1");
    const point2 = point(element.point2, "point2");
    if (point1 && point2) value = Math.hypot(point2.x - point1.x, point2.y - point1.y);
  }

  if (element.valueMode === "pointAngle") {
    const point1 = point(element.point1, "point1");
    const point2 = point(element.point2, "point2");
    if (point1 && point2) {
      value = normalizeDegrees(
        Math.atan2(point2.y - point1.y, point2.x - point1.x) * 180 / Math.PI
      );
    }
  }

  if (element.valueMode === "pointLineDistance") {
    const pointValue = point(element.point, "point");
    const line = computedLineOrError(
      element,
      element.lineId,
      computedGeometry,
      elementsById,
      errors,
      disabledByGroupId
    );
    if (pointValue && line) {
      const dx = line.end.x - line.start.x;
      const dy = line.end.y - line.start.y;
      const length = Math.hypot(dx, dy);
      if (length <= EPSILON) {
        errors.push(geometryError(element, `${line.name} は長さ0のため点線距離を計算できません。`));
      } else {
        value = Math.abs(dx * (line.start.y - pointValue.y) - (line.start.x - pointValue.x) * dy) / length;
      }
    }
  }

  if (value === undefined) return;
  computedVariables.set(element.id, {
    kind: "variable",
    elementId: element.id,
    name: element.name,
    value
  });
};
