import type {
  CadElement,
  ComputedGeometry,
  ComputedVariable,
  ComputedPoint,
  DependencyError,
  ElementId,
  EvaluationWarning,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import { resolveDerivedPoint } from "../model/pointAnchors";
import { evaluateNumericValue } from "./numericExpressions";
import { isVariableElement, variableIsInScope } from "./variableScope";

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
) => elementsById.get(id)?.name;

export const dependencyError = (
  element: CadElement,
  missingDependencyId: ElementId,
  elementsById: Map<ElementId, CadElement>,
  disabledByGroupId: Map<ElementId, ElementId> = new Map(),
  priorErrors: DependencyError[] = []
): DependencyError => {
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
    elementName: element.name,
    missingDependencyId,
    missingDependencyName,
    message: disabledGroupName
      ? `${element.name} は ${dependencyLabel} を参照していますが、${dependencyLabel} はグループ ${disabledGroupName} により評価OFFです。${disabledGroupName} を評価ONにするか、参照先を変更してください。`
      : dependencyEvaluationFailed
        ? `${element.name} は ${dependencyLabel} を参照していますが、${dependencyLabel} の評価に失敗しているため評価できません。先に ${dependencyLabel} のエラーを解消してください。`
        : `${element.name} は ${dependencyLabel} を参照していますが、${dependencyLabel} はこの要素より後にあるか、存在しません。${dependencyLabel} を ${element.name} より前に移動してください。`
  };
};

export const geometryError = (element: CadElement, message: string): DependencyError => ({
  elementId: element.id,
  elementName: element.name,
  missingDependencyId: element.id,
  missingDependencyName: element.name,
  message
});

export const geometryWarning = (element: CadElement, message: string): EvaluationWarning => ({
  elementId: element.id,
  elementName: element.name,
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
  computedVariables?: Map<ElementId, ComputedVariable>,
  elements?: CadElement[]
) => {
  const result = evaluateNumericValue({
    value,
    computedGeometry,
    elementsById,
    localVariables,
    localVariableNames,
    computedVariables,
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
  computedVariables?: Map<ElementId, ComputedVariable>,
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
    computedVariables,
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
    computedVariables,
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
  computedVariables?: Map<ElementId, ComputedVariable>,
  elements?: CadElement[],
  hasLegacyVariableElements = true
): LocalVariableEvaluation | null => {
  const localVariableValues = new Map<string, number>();
  const localVariableNames = new Map(
    (element.numericVariables ?? []).map((variable) => [variable.id, variable.name])
  );

  // `evaluateElements` determines this once from the source document. A
  // forGroup appends runtime elements as it expands, so repeating this search
  // here would make a pure nui 3 loop pay a growing legacy-variable scan for
  // every generated element. Keep the legacy path byte-for-byte equivalent
  // when a document does contain a `variable` element.
  if (hasLegacyVariableElements && computedVariables && elements) {
    const elementIndex = elements.findIndex((item) => item.id === element.id);
    for (let index = elementIndex - 1; index >= 0; index -= 1) {
      const candidate = elements[index];
      if (!isVariableElement(candidate)) continue;
      if (!variableIsInScope({ variable: candidate, consumer: element, elementsById })) continue;
      const computed = computedVariables.get(candidate.id);
      if (!computed) continue;
      if (!localVariableValues.has(candidate.id)) localVariableValues.set(candidate.id, computed.value);
      if (!localVariableValues.has(candidate.name)) localVariableValues.set(candidate.name, computed.value);
      if (!localVariableNames.has(candidate.id)) localVariableNames.set(candidate.id, candidate.name);
      if (!localVariableNames.has(candidate.name)) localVariableNames.set(candidate.name, candidate.name);
    }
  }

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
      computedVariables,
      elements
    );
    if (value === undefined) return null;
    localVariableValues.set(variable.id, value);
    localVariableValues.set(variable.name, value);
  }

  return { localVariableValues, localVariableNames };
};
