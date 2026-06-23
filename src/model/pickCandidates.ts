import type { NumericMeasurementKey } from "../geometry/numericExpressions";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ElementId,
  EvaluationResult,
  PointAnchor
} from "../types/geometry";
import {
  isLineLikeElement,
  isPointElement,
  lineEndpointReferenceForAnchor,
  referenceAnchor,
  selectablePointsForElement
} from "./pointAnchors";
import type {
  ActiveLinePickTarget,
  ActiveNumericReferencePickTarget,
  ActivePickCursor,
  ActivePointPickTarget
} from "../state/cadUiStore";

export type PickOption =
  | {
      kind: "point";
      label: string;
      anchor: PointAnchor;
    }
  | {
      kind: "line";
      label: string;
      lineId: ElementId;
    }
  | {
      kind: "numericReference";
      label: string;
      property: NumericMeasurementKey;
      expression: string;
    };

export type PickCandidate = {
  elementId: ElementId;
  options: PickOption[];
};

type PickTargets = {
  activePointPickTarget: ActivePointPickTarget | null;
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null;
  activeLinePickTarget: ActiveLinePickTarget | null;
};

type NumericReferenceGeometry =
  | ComputedLine
  | ComputedArcLine
  | ComputedBezierCurve
  | ComputedOffsetLine;

const numericReferenceGeometry = (
  geometry: ComputedGeometry | undefined
): NumericReferenceGeometry | null =>
  geometry?.kind === "line" ||
  geometry?.kind === "arcLine" ||
  geometry?.kind === "bezierCurve" ||
  geometry?.kind === "offsetLine"
    ? geometry
    : null;

export const numericReferencePropertiesForGeometry = (
  geometry: NumericReferenceGeometry
): readonly NumericMeasurementKey[] =>
  geometry.kind === "arcLine"
    ? ["length", "startAngleDeg", "endAngleDeg", "startTangentAngleDeg", "endTangentAngleDeg"]
    : ["length", "startTangentAngleDeg", "endTangentAngleDeg"];

const numericReferenceExpression = (
  geometry: NumericReferenceGeometry,
  property: NumericMeasurementKey
) => `${geometry.elementId}.${property}`;

const pointCandidates = (
  elements: CadElement[],
  evaluation: EvaluationResult,
  activePointPickTarget: ActivePointPickTarget
): PickCandidate[] => {
  const targetElement = elements.find((element) => element.id === activePointPickTarget.elementId);
  const targetDefinition = targetElement
    ? getParameterDefinitions(targetElement).find(
        (definition) => definition.key === activePointPickTarget.parameterKey
      )
    : null;
  const isLineEndpointPointPick = targetDefinition?.kind === "lineEndpointReference";
  const elementsById = new Map(elements.map((element) => [element.id, element]));

  return elements
    .map((element) => {
      const selectablePoints = selectablePointsForElement(
        element,
        evaluation.computedGeometry,
        elementsById
      ).filter((point) =>
        isLineEndpointPointPick ? lineEndpointReferenceForAnchor(point.anchor, elements) : true
      );
      const options: PickOption[] = [];

      if (!isLineEndpointPointPick && isPointElement(element)) {
        options.push({
          kind: "point",
          label: element.name,
          anchor: referenceAnchor(element.id)
        });
      } else {
        options.push(
          ...selectablePoints.map((point) => ({
            kind: "point" as const,
            label: point.label,
            anchor: point.anchor
          }))
        );
      }

      return { elementId: element.id, options };
    })
    .filter((candidate) => candidate.options.length > 0);
};

const lineCandidates = (
  elements: CadElement[],
  activeLinePickTarget: ActiveLinePickTarget
): PickCandidate[] => {
  const targetElement = elements.find((element) => element.id === activeLinePickTarget.elementId);
  const parameterValue = targetElement
    ? getParameterValue(targetElement, activeLinePickTarget.parameterKey)
    : null;
  const selectedLineIds = new Set<ElementId>(
    Array.isArray(parameterValue)
      ? (parameterValue as unknown[]).filter((id): id is ElementId => typeof id === "string")
      : []
  );

  return elements
    .filter(
      (element) =>
        isLineLikeElement(element) &&
        element.id !== activeLinePickTarget.elementId &&
        !selectedLineIds.has(element.id)
    )
    .map((element) => ({
      elementId: element.id,
      options: [{ kind: "line" as const, label: element.name, lineId: element.id }]
    }));
};

const numericReferenceCandidates = (
  elements: CadElement[],
  evaluation: EvaluationResult
): PickCandidate[] =>
  elements
    .map((element) => {
      const geometry = numericReferenceGeometry(evaluation.computedGeometry.get(element.id));
      const options = geometry
        ? numericReferencePropertiesForGeometry(geometry).map((property) => ({
            kind: "numericReference" as const,
            label: property,
            property,
            expression: numericReferenceExpression(geometry, property)
          }))
        : [];
      return { elementId: element.id, options };
    })
    .filter((candidate) => candidate.options.length > 0);

export const pickCandidates = (
  elements: CadElement[],
  evaluation: EvaluationResult,
  targets: PickTargets
): PickCandidate[] => {
  if (targets.activePointPickTarget) {
    return pointCandidates(elements, evaluation, targets.activePointPickTarget);
  }
  if (targets.activeLinePickTarget) {
    return lineCandidates(elements, targets.activeLinePickTarget);
  }
  if (targets.activeNumericReferencePickTarget) {
    return numericReferenceCandidates(elements, evaluation);
  }
  return [];
};

export const resolvedPickCursor = (
  candidates: PickCandidate[],
  cursor: ActivePickCursor | null
): ActivePickCursor | null => {
  if (candidates.length === 0) return null;

  const candidateIndex = cursor
    ? candidates.findIndex((candidate) => candidate.elementId === cursor.elementId)
    : -1;
  const candidate = candidates[candidateIndex >= 0 ? candidateIndex : 0];
  const optionIndex = Math.min(Math.max(cursor?.optionIndex ?? 0, 0), candidate.options.length - 1);
  return {
    elementId: candidate.elementId,
    optionIndex
  };
};

export const selectedPickOption = (
  candidates: PickCandidate[],
  cursor: ActivePickCursor | null
) => {
  const resolved = resolvedPickCursor(candidates, cursor);
  if (!resolved) return null;

  const candidate = candidates.find((item) => item.elementId === resolved.elementId);
  const option = candidate?.options[resolved.optionIndex];
  return candidate && option ? { candidate, option, cursor: resolved } : null;
};
