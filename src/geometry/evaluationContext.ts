import type {
  CadElement,
  ComputedGeometry,
  ComputedPoint,
  DependencyError,
  ElementId,
  EvaluationWarning,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import { elementDisplayName } from "../model/elementNames";
import { resolveDerivedPoint } from "../model/pointAnchors";
import { evaluateNumericValue } from "./numericExpressions";

export type LocalVariableEvaluation = {
  localVariableValues: Map<string, number>;
  localVariableNames: Map<string, string>;
};

export const isPoint = (
  geometry: ComputedGeometry | undefined
): geometry is ComputedPoint => geometry?.kind === "point";

const findElementName = (
  elementsById: Map<ElementId, CadElement>,
  id: ElementId
) => {
  const found = elementsById.get(id);
  return found ? elementDisplayName(found) : undefined;
};

export const dependencyError = (
  element: CadElement,
  missingDependencyId: ElementId,
  elementsById: Map<ElementId, CadElement>,
  disabledByGroupId: Map<ElementId, ElementId> = new Map(),
  priorErrors: DependencyError[] = []
): DependencyError => {
  const elementName = elementDisplayName(element);
  const missingDependencyName = findElementName(elementsById, missingDependencyId);
  const dependencyLabel = missingDependencyName ?? missingDependencyId;
  const disabledGroupId = disabledByGroupId.get(missingDependencyId);
  const disabledGroupName = disabledGroupId ? findElementName(elementsById, disabledGroupId) : null;
  const dependencyEvaluationFailed =
    !disabledGroupName &&
    elementsById.has(missingDependencyId) &&
    priorErrors.some((error) => error.elementId === missingDependencyId);

  return {
    elementId: element.id,
    elementName,
    missingDependencyId,
    missingDependencyName,
    message: disabledGroupName
      ? `${elementName} は ${dependencyLabel} を参照していますが、${dependencyLabel} はグループ ${disabledGroupName} により評価OFFです。${disabledGroupName} を評価ONにするか、参照先を変更してください。`
      : dependencyEvaluationFailed
        ? `${elementName} は ${dependencyLabel} を参照していますが、${dependencyLabel} の評価に失敗しているため評価できません。先に ${dependencyLabel} のエラーを解消してください。`
        : `${elementName} は ${dependencyLabel} を参照していますが、${dependencyLabel} はこの要素より後にあるか、存在しません。${dependencyLabel} を ${elementName} より前に移動してください。`
  };
};

export const geometryError = (element: CadElement, message: string): DependencyError => ({
  elementId: element.id,
  elementName: elementDisplayName(element),
  missingDependencyId: element.id,
  missingDependencyName: elementDisplayName(element),
  message
});

export const geometryWarning = (element: CadElement, message: string): EvaluationWarning => ({
  elementId: element.id,
  elementName: elementDisplayName(element),
  message
});

export const getComputedPointOrError = (
  element: CadElement,
  pointId: ElementId,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[],
  disabledByGroupId?: Map<ElementId, ElementId>
) => {
  const point = computedGeometry.get(pointId);
  if (!isPoint(point)) {
    errors.push(dependencyError(element, pointId, elementsById, disabledByGroupId, errors));
    return undefined;
  }

  return point;
};

export const numericError = (
  element: CadElement,
  value: NumericValue,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[],
  localVariables?: Map<string, number>,
  localVariableNames?: Map<string, string>,
  disabledByGroupId?: Map<ElementId, ElementId>,
  elements?: CadElement[]
) => {
  const result = evaluateNumericValue({
    value,
    computedGeometry,
    elementsById,
    localVariables,
    localVariableNames,
    currentElement: element,
    elements
  });
  if (result.value !== undefined) return result.value;

  if (result.error) {
    const disabledGroupId = disabledByGroupId?.get(result.error.dependencyId);
    const disabledGroupName = disabledGroupId ? findElementName(elementsById, disabledGroupId) : null;
    errors.push({
      elementId: element.id,
      elementName: element.name,
      missingDependencyId: result.error.dependencyId,
      missingDependencyName: result.error.dependencyName,
      message: disabledGroupName
        ? `${element.name} の数値式を評価できません。参照先はグループ ${disabledGroupName} により評価OFFです。${disabledGroupName} を評価ONにするか、数値式を変更してください。`
        : `${element.name} の数値式を評価できません。${result.error.message}`
    });
  }
  return undefined;
};

export const getPointAnchorOrError = (
  element: CadElement,
  anchor: PointAnchor,
  anchorKey: string,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[],
  localVariables?: Map<string, number>,
  localVariableNames?: Map<string, string>,
  disabledByGroupId?: Map<ElementId, ElementId>,
  elements?: CadElement[]
) => {
  if (anchor.mode === "reference") {
    return getComputedPointOrError(
      element,
      anchor.pointId,
      computedGeometry,
      elementsById,
      errors,
      disabledByGroupId
    );
  }

  if (anchor.mode === "derived") {
    const source = computedGeometry.get(anchor.elementId);
    const point = resolveDerivedPoint(source, anchor.pointKey, elementsById);
    if (!point) {
      errors.push(dependencyError(element, anchor.elementId, elementsById, disabledByGroupId, errors));
      return undefined;
    }
    return {
      ...point,
      elementId: `${anchor.elementId}:${anchor.pointKey}`,
      name: `${source!.name}.${anchor.pointKey}`
    };
  }

  const x = numericError(
    element,
    anchor.x,
    computedGeometry,
    elementsById,
    errors,
    localVariables,
    localVariableNames,
    disabledByGroupId,
    elements
  );
  const y = numericError(
    element,
    anchor.y,
    computedGeometry,
    elementsById,
    errors,
    localVariables,
    localVariableNames,
    disabledByGroupId,
    elements
  );
  if (x === undefined || y === undefined) return undefined;

  return {
    kind: "point" as const,
    elementId: `${element.id}:${anchorKey}`,
    name: `${element.name}.${anchorKey}`,
    x,
    y
  };
};

export const evaluateLocalVariables = (
  element: CadElement,
  computedGeometry: Map<ElementId, ComputedGeometry>,
  elementsById: Map<ElementId, CadElement>,
  errors: DependencyError[],
  elements?: CadElement[]
): LocalVariableEvaluation | null => {
  const localVariableValues = new Map<string, number>();
  const localVariableNames = new Map(
    (element.numericVariables ?? []).map((variable) => [variable.id, variable.name])
  );

  for (const variable of element.numericVariables ?? []) {
    const value = numericError(
      element,
      variable.value,
      computedGeometry,
      elementsById,
      errors,
      localVariableValues,
      localVariableNames,
      undefined,
      elements
    );
    if (value === undefined) return null;
    localVariableValues.set(variable.id, value);
    localVariableValues.set(variable.name, value);
  }

  return { localVariableValues, localVariableNames };
};
