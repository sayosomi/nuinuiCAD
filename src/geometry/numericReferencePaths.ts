import { createDependencyIndex } from "../model/dependencies";
import { getParameterValue } from "../parameters/parameterAccess";
import {
  runtimeOnlyElementTypes,
  type CadElement,
  type ComputedGeometry,
  type ElementId,
  type EvaluationResult,
  type NumericValue,
  type PointAnchor
} from "../types/geometry";
import {
  computedReferencePathValue,
  evaluateNumericValue,
  isNumericExpression
} from "./numericExpressions";
import {
  numericGeometryPropertiesForStaticTarget,
  numericGeometryPropertyUnitFor,
  numericGeometryStaticTargetForComputedGeometry,
  numericGeometryStaticTargetForElementInDocument,
  type NumericGeometryStaticTarget
} from "./numericGeometryProperties";
import {
  isSemanticGeometryCandidateAllowed,
  sourceReferenceForElement,
  type ModuleSemanticCandidateContext
} from "../model/moduleSemanticCandidateBoundary";
import { getBuiltinConstantDefinition } from "../scalars/builtinConstants";

export type NumericReferenceCandidate = {
  id: string;
  elementId?: ElementId;
  relation: "self" | "parent" | "child" | "element" | "variable" | "function";
  measurementMode?: "distance" | "angle" | "lineDistance";
  expression: string;
  displayExpression: string;
  label: string;
  detail: string;
  valueLabel: string;
  insertable: boolean;
  disabledReason?: string;
};

type ResolveContext = {
  elements: CadElement[];
  evaluation: EvaluationResult;
  currentElement?: CadElement;
  currentParameterKey?: string;
  moduleSemanticContext?: ModuleSemanticCandidateContext;
};

const formatNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(3).replace(/\.?0+$/, "");

const piDefinition = getBuiltinConstantDefinition("pi");

export const formatValue = (value: number, path: string) => {
  const formatted = formatNumber(value);
  const unit = numericGeometryPropertyUnitFor(path);
  if (unit === "bare") return formatted;
  return unit === "°" ? `${formatted}°` : `${formatted} ${unit}`;
};

const elementIndex = (elements: CadElement[], elementId: ElementId) =>
  elements.findIndex((element) => element.id === elementId);

const concreteExpression = (element: CadElement, path: string, context: ResolveContext) =>
  `${sourceReferenceForElement({
    element,
    targetElementId: context.currentElement?.id ?? "",
    context: context.moduleSemanticContext ?? {},
    property: path
  }) ?? `${element.id}.${path}`}`;
const displayExpression = (element: CadElement, path: string) => `${element.name}.${path}`;

export const computedNumericReferenceValue = (
  geometry: ComputedGeometry | undefined,
  path: string
): number | undefined => computedReferencePathValue(geometry, path);

const evaluateNumericParameter = (value: NumericValue, context: ResolveContext) => {
  const elementsById = new Map(context.elements.map((element) => [element.id, element]));
  return evaluateNumericValue({
    value,
    computedGeometry: context.evaluation.computedGeometry,
    elementsById,
    currentElement: context.currentElement,
    elements: context.elements
  }).value;
};

const pointAnchorValue = (
  anchor: PointAnchor | null,
  axis: "x" | "y",
  context: ResolveContext
) => {
  if (!anchor) return undefined;
  if (anchor.mode === "coordinate") return evaluateNumericParameter(anchor[axis], context);
  const sourceId = anchor.mode === "reference" ? anchor.pointId : anchor.elementId;
  const geometry = context.evaluation.computedGeometry.get(sourceId);
  if (anchor.mode === "reference") return geometry?.kind === "point" ? geometry[axis] : undefined;
  return computedNumericReferenceValue(geometry, `${anchor.pointKey === "center" ? "centerPoint" : `${anchor.pointKey}Point`}.${axis}`);
};

export const parameterNumericReferenceValue = (
  element: CadElement | undefined,
  path: string,
  context: ResolveContext
): number | undefined => {
  if (!element || !path.startsWith("params.")) return undefined;
  const parameterPath = path.slice("params.".length);
  const pointMatch = parameterPath.match(/^(.+)\.(x|y)$/);
  if (pointMatch) {
    const anchor = getParameterValue(element, pointMatch[1]) as PointAnchor | null | undefined;
    return pointAnchorValue(anchor ?? null, pointMatch[2] as "x" | "y", context);
  }
  const value = getParameterValue(element, parameterPath);
  if (typeof value === "number" || isNumericExpression(value as NumericValue)) {
    return evaluateNumericParameter(value as NumericValue, context);
  }
  return undefined;
};

export const numericReferenceValueForPath = (
  element: CadElement | undefined,
  path: string,
  context: ResolveContext
) => {
  if (!element) return undefined;
  return path.startsWith("params.")
    ? parameterNumericReferenceValue(element, path, context)
    : computedNumericReferenceValue(context.evaluation.computedGeometry.get(element.id), path);
};

export const computedPathsForGeometry = (
  geometry: ComputedGeometry | undefined,
  staticTarget?: NumericGeometryStaticTarget | null
) => numericGeometryPropertiesForStaticTarget(
  staticTarget === undefined ? numericGeometryStaticTargetForComputedGeometry(geometry) : staticTarget
);

const candidateForPath = ({
  element,
  path,
  relation,
  context,
  insertable,
  disabledReason,
  displayPrefix
}: {
  element: CadElement;
  path: string;
  relation: NumericReferenceCandidate["relation"];
  context: ResolveContext;
  insertable: boolean;
  disabledReason?: string;
  displayPrefix?: string;
}): NumericReferenceCandidate | null => {
  const value = numericReferenceValueForPath(element, path, context);
  const expression = concreteExpression(element, path, context);
  const shown = displayPrefix ? `${displayPrefix}.${path}` : displayExpression(element, path);
  return {
    id: `${relation}:${expression}`,
    elementId: element.id,
    relation,
    expression,
    displayExpression: shown,
    label: shown,
    detail: element.name,
    valueLabel: value === undefined ? "" : formatValue(value, path),
    insertable,
    disabledReason
  };
};

const candidatesForElement = ({
  element,
  relation,
  context,
  insertable,
  disabledReason,
  displayPrefix
}: {
  element: CadElement;
  relation: NumericReferenceCandidate["relation"];
  context: ResolveContext;
  insertable: boolean;
  disabledReason?: string;
  displayPrefix?: string;
}) => [
  ...(runtimeOnlyElementTypes.has(element.type) ||
    (context.currentElement && context.moduleSemanticContext && !isSemanticGeometryCandidateAllowed({
      candidateElementId: element.id,
      targetElementId: context.currentElement.id,
      context: context.moduleSemanticContext
    }))
    ? []
    : [
        ...computedPathsForGeometry(
          context.evaluation.computedGeometry.get(element.id),
          numericGeometryStaticTargetForElementInDocument(element, context.elements)
        )
      ]),
].flatMap((path) => {
  const candidate = candidateForPath({
    element,
    path,
    relation,
    context,
    insertable,
    disabledReason,
    displayPrefix
  });
  return candidate ? [candidate] : [];
});

export const numericReferenceCandidates = (context: ResolveContext & { query?: string }) => {
  const currentElement = context.currentElement;
  const currentIndex = currentElement ? elementIndex(context.elements, currentElement.id) : -1;
  const dependencyIndex = createDependencyIndex(context.elements);
  const byId = new Map(context.elements.map((element) => [element.id, element]));
  const candidates: NumericReferenceCandidate[] = [];

  if (currentElement) {
    candidates.push(
      ...computedPathsForGeometry(
        context.evaluation.computedGeometry.get(currentElement.id),
        numericGeometryStaticTargetForElementInDocument(currentElement, context.elements)
      ).flatMap((path) => {
        const candidate = candidateForPath({
          element: currentElement,
          path,
          relation: "self",
          context,
          insertable: true,
          displayPrefix: "self"
        });
        return candidate ? [candidate] : [];
      })
    );

    for (const [index, parentId] of (dependencyIndex.parentIdsByElementId.get(currentElement.id) ?? []).entries()) {
      const parent = byId.get(parentId);
      if (!parent) continue;
      candidates.push(
        ...candidatesForElement({
          element: parent,
          relation: "parent",
          context,
          insertable: true,
          displayPrefix: `parents[${index + 1}]`
        })
      );
    }

    for (const [index, childId] of (dependencyIndex.childIdsByElementId.get(currentElement.id) ?? []).entries()) {
      const child = byId.get(childId);
      if (!child) continue;
      candidates.push(
        ...candidatesForElement({
          element: child,
          relation: "child",
          context,
          insertable: false,
          disabledReason: "依存上の子は後続要素になりやすいため式には挿入できません。",
          displayPrefix: `children[${index + 1}]`
        })
      );
    }
  }

  for (const element of context.elements) {
    if (element.id === currentElement?.id) continue;
    const index = elementIndex(context.elements, element.id);
    candidates.push(
      ...candidatesForElement({
        element,
        relation: "element",
        context,
        insertable: currentIndex < 0 || index < currentIndex,
        disabledReason: currentIndex >= 0 && index >= currentIndex ? "この要素より後にあるため参照できません。" : undefined
      })
    );
  }

  candidates.push(
    { id: "function:sqrt", relation: "function", expression: "sqrt()", displayExpression: "sqrt()", label: "sqrt()", detail: "平方根", valueLabel: "", insertable: true },
    { id: `function:${piDefinition.name}`, relation: "function", expression: piDefinition.name, displayExpression: piDefinition.name, label: piDefinition.name, detail: "円周率", valueLabel: formatNumber(piDefinition.value), insertable: true },
    { id: "function:distance", relation: "function", measurementMode: "distance", expression: "距離()", displayExpression: "距離()", label: "距離()", detail: "2点距離", valueLabel: "2点", insertable: true },
    { id: "function:angle", relation: "function", measurementMode: "angle", expression: "角度()", displayExpression: "角度()", label: "角度()", detail: "2点角度", valueLabel: "2点", insertable: true },
    { id: "function:lineDistance", relation: "function", measurementMode: "lineDistance", expression: "点線距離()", displayExpression: "点線距離()", label: "点線距離()", detail: "点と線の距離", valueLabel: "点+線", insertable: true }
  );

  const query = context.query?.trim().toLocaleLowerCase() ?? "";
  return query
    ? candidates.filter((candidate) =>
        `${candidate.label} ${candidate.detail} ${candidate.expression} ${candidate.valueLabel}`.toLocaleLowerCase().includes(query)
      )
    : candidates;
};
