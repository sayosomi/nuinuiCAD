import { createDependencyIndex } from "../model/dependencies";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import type {
  CadElement,
  ComputedGeometry,
  ComputedPoint,
  ElementId,
  EvaluationResult,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import { evaluateNumericValue, isNumericExpression } from "./numericExpressions";

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
};

const formatNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(3).replace(/\.?0+$/, "");

const formatValue = (value: number, path: string) =>
  path.toLowerCase().includes("angle") || path.toLowerCase().endsWith("deg")
    ? `${formatNumber(value)}°`
    : path.endsWith(".x") || path.endsWith(".y")
      ? formatNumber(value)
      : `${formatNumber(value)} mm`;

const elementIndex = (elements: CadElement[], elementId: ElementId) =>
  elements.findIndex((element) => element.id === elementId);

const concreteExpression = (element: CadElement, path: string) => `${element.id}.${path}`;
const displayExpression = (element: CadElement, path: string) => `${element.name}.${path}`;

const pointPathValue = (point: ComputedPoint | null | undefined, path: string) => {
  if (!point) return undefined;
  if (path === "x") return point.x;
  if (path === "y") return point.y;
  return undefined;
};

export const computedNumericReferenceValue = (
  geometry: ComputedGeometry | undefined,
  path: string
): number | undefined => {
  if (!geometry) return undefined;
  if (geometry.kind === "point") return pointPathValue(geometry, path);

  if (geometry.kind === "line") {
    if (path === "length") return geometry.length;
    if (path === "startAngleDeg") return geometry.startAngleDeg ?? undefined;
    if (path === "endAngleDeg") return geometry.endAngleDeg ?? undefined;
    if (path === "startTangentAngleDeg") return geometry.startTangentAngleDeg ?? undefined;
    if (path === "endTangentAngleDeg") return geometry.endTangentAngleDeg ?? undefined;
    if (path.startsWith("startPoint.")) return pointPathValue(geometry.start, path.slice("startPoint.".length));
    if (path.startsWith("endPoint.")) return pointPathValue(geometry.end, path.slice("endPoint.".length));
  }

  if (geometry.kind === "arcLine") {
    if (path === "length") return geometry.length;
    if (path === "radius") return geometry.radius;
    if (path === "startAngleDeg") return geometry.startAngleDeg;
    if (path === "endAngleDeg") return geometry.endAngleDeg;
    if (path === "sweepAngleDeg") return geometry.sweepAngleDeg;
    if (path === "startTangentAngleDeg") return geometry.startTangentAngleDeg;
    if (path === "endTangentAngleDeg") return geometry.endTangentAngleDeg;
    if (path.startsWith("centerPoint.")) return pointPathValue(geometry.center, path.slice("centerPoint.".length));
    if (path.startsWith("startPoint.")) return pointPathValue(geometry.start, path.slice("startPoint.".length));
    if (path.startsWith("endPoint.")) return pointPathValue(geometry.end, path.slice("endPoint.".length));
  }

  if (geometry.kind === "bezierCurve") {
    const start = geometry.segments[0]?.start;
    const end = geometry.segments.at(-1)?.end;
    if (path === "length") return geometry.length;
    if (path === "startTangentAngleDeg") return geometry.startTangentAngleDeg ?? undefined;
    if (path === "endTangentAngleDeg") return geometry.endTangentAngleDeg ?? undefined;
    if (path === "startHandleAngleDeg") return geometry.startHandleAngleDeg;
    if (path === "startHandleLength") return geometry.startHandleLength;
    if (path === "endHandleAngleDeg") return geometry.endHandleAngleDeg;
    if (path === "endHandleLength") return geometry.endHandleLength;
    if (path.startsWith("startPoint.")) return pointPathValue(start, path.slice("startPoint.".length));
    if (path.startsWith("endPoint.")) return pointPathValue(end, path.slice("endPoint.".length));
    const intermediateMatch = path.match(/^intermediatePoints\[(\d+)\]\.(x|y)$/);
    if (intermediateMatch) {
      const point = geometry.segments[Number(intermediateMatch[1]) - 1]?.end;
      return pointPathValue(point, intermediateMatch[2]);
    }
  }

  if (geometry.kind === "offsetLine") {
    if (path === "length") return geometry.length;
    if (path === "startTangentAngleDeg") return geometry.startTangentAngleDeg ?? undefined;
    if (path === "endTangentAngleDeg") return geometry.endTangentAngleDeg ?? undefined;
    if (path.startsWith("startPoint.")) return pointPathValue(geometry.start, path.slice("startPoint.".length));
    if (path.startsWith("endPoint.")) return pointPathValue(geometry.end, path.slice("endPoint.".length));
  }

  if (geometry.kind === "image") {
    if (path === "widthMm") return geometry.widthMm;
    if (path === "heightMm") return geometry.heightMm;
    if (path === "scale") return geometry.scale;
    if (path === "angleDeg") return geometry.angleDeg;
    if (path === "naturalWidthPx") return geometry.naturalWidthPx;
    if (path === "naturalHeightPx") return geometry.naturalHeightPx;
    if (path === "sourceDpi") return geometry.sourceDpi;
    if (path === "targetPixelsPerMm") return geometry.targetPixelsPerMm;
    if (path.startsWith("originPoint.")) return pointPathValue(geometry.origin, path.slice("originPoint.".length));
  }

  if (geometry.kind === "text") {
    if (path === "fontSize") return geometry.fontSize;
    if (path.startsWith("anchorPoint.")) return pointPathValue(geometry.anchor, path.slice("anchorPoint.".length));
  }

  return undefined;
};

const evaluateNumericParameter = (value: NumericValue, context: ResolveContext) => {
  const elementsById = new Map(context.elements.map((element) => [element.id, element]));
  return evaluateNumericValue({
    value,
    computedGeometry: context.evaluation.computedGeometry,
    elementsById,
    computedVariables: context.evaluation.computedVariables,
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
  const variable = context.evaluation.computedVariables.get(element.id);
  if (path === "value" && variable) return variable.value;
  return path.startsWith("params.")
    ? parameterNumericReferenceValue(element, path, context)
    : computedNumericReferenceValue(context.evaluation.computedGeometry.get(element.id), path);
};

const computedPathsForGeometry = (geometry: ComputedGeometry | undefined) => {
  if (!geometry) return [];
  if (geometry.kind === "point") return ["x", "y"];
  if (geometry.kind === "line") {
    return [
      "length",
      "startPoint.x",
      "startPoint.y",
      "endPoint.x",
      "endPoint.y",
      "startAngleDeg",
      "endAngleDeg",
      "startTangentAngleDeg",
      "endTangentAngleDeg"
    ];
  }
  if (geometry.kind === "arcLine") {
    return [
      "length",
      "radius",
      "centerPoint.x",
      "centerPoint.y",
      "startPoint.x",
      "startPoint.y",
      "endPoint.x",
      "endPoint.y",
      "startAngleDeg",
      "endAngleDeg",
      "sweepAngleDeg",
      "startTangentAngleDeg",
      "endTangentAngleDeg"
    ];
  }
  if (geometry.kind === "bezierCurve") {
    return [
      "length",
      "startPoint.x",
      "startPoint.y",
      "endPoint.x",
      "endPoint.y",
      "startTangentAngleDeg",
      "endTangentAngleDeg",
      "startHandleAngleDeg",
      "startHandleLength",
      "endHandleAngleDeg",
      "endHandleLength",
      ...geometry.segments.slice(0, -1).flatMap((_, index) => [
        `intermediatePoints[${index + 1}].x`,
        `intermediatePoints[${index + 1}].y`
      ])
    ];
  }
  if (geometry.kind === "offsetLine") {
    return ["length", "startPoint.x", "startPoint.y", "endPoint.x", "endPoint.y", "startTangentAngleDeg", "endTangentAngleDeg"];
  }
  if (geometry.kind === "image") {
    return ["originPoint.x", "originPoint.y", "widthMm", "heightMm", "scale", "angleDeg", "naturalWidthPx", "naturalHeightPx", "sourceDpi", "targetPixelsPerMm"];
  }
  if (geometry.kind === "text") return ["anchorPoint.x", "anchorPoint.y", "fontSize"];
  return [];
};

const parameterPathsForElement = (element: CadElement) =>
  getParameterDefinitions(element).flatMap((definition) => {
    if (definition.kind === "number") return [`params.${definition.key}`];
    if (definition.kind === "reference") return [`params.${definition.key}.x`, `params.${definition.key}.y`];
    return [];
  });

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
  if (value === undefined) return null;
  const expression = concreteExpression(element, path);
  const shown = displayPrefix ? `${displayPrefix}.${path}` : displayExpression(element, path);
  return {
    id: `${relation}:${expression}`,
    elementId: element.id,
    relation,
    expression,
    displayExpression: shown,
    label: shown,
    detail: element.name,
    valueLabel: formatValue(value, path),
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
  ...computedPathsForGeometry(context.evaluation.computedGeometry.get(element.id)),
  ...parameterPathsForElement(element),
  ...(context.evaluation.computedVariables.has(element.id) ? ["value"] : [])
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
      ...parameterPathsForElement(currentElement)
        .filter((path) => path !== `params.${context.currentParameterKey}`)
        .flatMap((path) => {
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
    { id: "function:pi", relation: "function", expression: "pi", displayExpression: "pi", label: "pi", detail: "円周率", valueLabel: formatNumber(Math.PI), insertable: true },
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
