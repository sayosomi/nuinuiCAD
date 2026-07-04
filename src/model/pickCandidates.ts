import type { NumericMeasurementKey } from "../geometry/numericExpressions";
import {
  numericReferenceGeometrySupportsProperty,
  type NumericReferenceGeometry
} from "../geometry/numericReferenceProperties";
import {
  availableNumericVariableReferenceOptions,
  isVariableReferenceCandidate
} from "../geometry/variableReferenceOptions";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import type {
  CadElement,
  ComputedGeometry,
  ElementId,
  EvaluationResult,
  PointAnchor
} from "../types/geometry";
import {
  isLineLikeElement,
  isPointElement,
  referenceAnchor,
  selectablePointsForElement
} from "./pointAnchors";
import { isValidPickedPointAnchorForTarget } from "./forGroupGeneratedReferences";
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
    }
  | {
      kind: "variableReference";
      label: string;
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

const numericReferenceGeometry = (
  geometry: ComputedGeometry | undefined
): NumericReferenceGeometry | null =>
  geometry?.kind === "line" ||
  geometry?.kind === "arcLine" ||
  geometry?.kind === "bezierCurve" ||
  geometry?.kind === "offsetLine"
    ? geometry
    : null;

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
  const isValidPointCandidate = (anchor: PointAnchor) =>
    isValidPickedPointAnchorForTarget({
      elements,
      targetElementId: activePointPickTarget.elementId,
      anchor,
      allowLineEndpoint: isLineEndpointPointPick
    });

  return elements
    .map((element) => {
      const selectablePoints = selectablePointsForElement(
        element,
        evaluation.computedGeometry,
        elementsById
      ).filter((point) => isValidPointCandidate(point.anchor));
      const options: PickOption[] = [];

      if (!isLineEndpointPointPick && isPointElement(element) && isValidPointCandidate(referenceAnchor(element.id))) {
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
  evaluation: EvaluationResult,
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget
): PickCandidate[] => {
  const targetElement = elements.find((element) => element.id === activeNumericReferencePickTarget.elementId);
  return elements
    .map((element) => {
      const geometry = numericReferenceGeometry(evaluation.computedGeometry.get(element.id));
      const property = activeNumericReferencePickTarget.property;
      const options: PickOption[] =
        geometry &&
        geometry.elementId !== activeNumericReferencePickTarget.elementId &&
        numericReferenceGeometrySupportsProperty(geometry, property)
          ? [
              {
                kind: "numericReference" as const,
                label: property,
                property,
                expression: numericReferenceExpression(geometry, property)
              }
            ]
          : [];
      if (
        targetElement &&
        isVariableReferenceCandidate(element, targetElement, elements, evaluation.computedVariables)
      ) {
        const option = availableNumericVariableReferenceOptions({
          element: targetElement,
          elements,
          parameterKey: activeNumericReferencePickTarget.parameterKey,
          computedVariables: evaluation.computedVariables
        }).find((candidate) => candidate.elementId === element.id);
        if (option) {
          options.push({
            kind: "variableReference",
            label: option.label,
            expression: option.expression
          });
        }
      }
      return { elementId: element.id, options };
    })
    .filter((candidate) => candidate.options.length > 0);
};

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
    return numericReferenceCandidates(elements, evaluation, targets.activeNumericReferencePickTarget);
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
