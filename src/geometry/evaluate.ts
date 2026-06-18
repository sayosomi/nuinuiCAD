import type {
  CadElement,
  ComputedGeometry,
  ComputedPoint,
  DependencyError,
  ElementId,
  EvaluationResult
} from "../types/geometry";

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

export const evaluateElements = (elements: CadElement[]): EvaluationResult => {
  const computedGeometry = new Map<ElementId, ComputedGeometry>();
  const errors: DependencyError[] = [];
  const elementsById = new Map(elements.map((element) => [element.id, element]));

  for (const element of elements) {
    if (!element.enabled) {
      continue;
    }

    switch (element.type) {
      case "freePoint":
        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: element.x,
          y: element.y
        });
        break;
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

        computedGeometry.set(element.id, {
          kind: "point",
          elementId: element.id,
          name: element.name,
          x: fromPoint.x + element.dx,
          y: fromPoint.y + element.dy
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

        computedGeometry.set(element.id, {
          kind: "line",
          elementId: element.id,
          name: element.name,
          startPointId: element.startPointId,
          endPointId: element.endPointId,
          start,
          end
        });
        break;
      }
    }
  }

  return { computedGeometry, errors };
};
