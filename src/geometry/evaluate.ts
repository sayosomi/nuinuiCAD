import type {
  CadElement,
  ComputedGeometry,
  ComputedPoint,
  DependencyError,
  ElementId,
  NumericValue,
  EvaluationResult
} from "../types/geometry";
import { evaluateNumericValue } from "./numericExpressions";

const isPoint = (
  geometry: ComputedGeometry | undefined
): geometry is ComputedPoint => geometry?.kind === "point";

const findElementName = (
  elementsById: Map<ElementId, CadElement>,
  id: ElementId
) => elementsById.get(id)?.name;

const dependencyError = (
  element: CadElement,
  missingDependencyId: ElementId,
  elementsById: Map<ElementId, CadElement>
): DependencyError => {
  const missingDependencyName = findElementName(elementsById, missingDependencyId);
  const dependencyLabel = missingDependencyName ?? missingDependencyId;

  return {
    elementId: element.id,
    elementName: element.name,
    missingDependencyId,
    missingDependencyName,
    message: `${element.name} は ${dependencyLabel} を参照していますが、${dependencyLabel} はこの要素より後にあるか、存在しません。${dependencyLabel} を ${element.name} より前に移動してください。`
  };
};

const getComputedPointOrError = (
  element: CadElement,
  pointId: ElementId,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[]
) => {
  const point = computedGeometry.get(pointId);
  if (!isPoint(point)) {
    errors.push(dependencyError(element, pointId, elementsById));
    return undefined;
  }

  return point;
};

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;
const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;
const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

const numericError = (
  element: CadElement,
  value: NumericValue,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[]
) => {
  const result = evaluateNumericValue({ value, computedGeometry, elementsById });
  if (result.value !== undefined) return result.value;

  if (result.error) {
    errors.push({
      elementId: element.id,
      elementName: element.name,
      missingDependencyId: result.error.dependencyId,
      missingDependencyName: result.error.dependencyName,
      message: `${element.name} の数値式を評価できません。${result.error.message}`
    });
  }
  return undefined;
};

export const evaluateElements = (elements: CadElement[]): EvaluationResult => {
  const computedGeometry = new Map<ElementId, ComputedGeometry>();
  const errors: DependencyError[] = [];
  const elementsById = new Map(elements.map((element) => [element.id, element]));

  for (const element of elements) {
    if (!element.enabled) {
      continue;
    }

    switch (element.type) {
      case "freePoint": {
        const x = numericError(element, element.x, computedGeometry, elementsById, errors);
        const y = numericError(element, element.y, computedGeometry, elementsById, errors);
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
        const fromPoint = getComputedPointOrError(
          element,
          element.fromPointId,
          computedGeometry,
          elementsById,
          errors
        );
        if (!fromPoint) {
          break;
        }
        const dx = numericError(element, element.dx, computedGeometry, elementsById, errors);
        const dy = numericError(element, element.dy, computedGeometry, elementsById, errors);
        if (dx === undefined || dy === undefined) break;

        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: fromPoint.x + dx,
          y: fromPoint.y + dy
        });
        break;
      }
      case "polarOffsetPoint": {
        const fromPoint = getComputedPointOrError(
          element,
          element.fromPointId,
          computedGeometry,
          elementsById,
          errors
        );
        if (!fromPoint) {
          break;
        }

        const angleDeg = numericError(element, element.angleDeg, computedGeometry, elementsById, errors);
        const distance = numericError(element, element.distance, computedGeometry, elementsById, errors);
        if (angleDeg === undefined || distance === undefined) break;

        const angleRad = degreesToRadians(angleDeg);
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: fromPoint.x + Math.cos(angleRad) * distance,
          y: fromPoint.y - Math.sin(angleRad) * distance
        });
        break;
      }
      case "line": {
        const start = getComputedPointOrError(
          element,
          element.startPointId,
          computedGeometry,
          elementsById,
          errors
        );
        const end = getComputedPointOrError(
          element,
          element.endPointId,
          computedGeometry,
          elementsById,
          errors
        );
        if (!start || !end) {
          break;
        }

        const dx = end.x - start.x;
        const dy = start.y - end.y;
        const length = Math.hypot(dx, dy);
        const startAngleDeg =
          length === 0 ? null : normalizeDegrees(radiansToDegrees(Math.atan2(dy, dx)));
        const endAngleDeg =
          length === 0 ? null : normalizeDegrees(radiansToDegrees(Math.atan2(-dy, -dx)));
        computedGeometry.set(element.id, {
          kind: "line",
          elementId: element.id,
          name: element.name,
          startPointId: element.startPointId,
          endPointId: element.endPointId,
          start,
          end,
          length,
          startAngleDeg,
          endAngleDeg
        });
        break;
      }
    }
  }

  return { computedGeometry, errors };
};
