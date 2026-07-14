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
import {
  isValidPickedPointAnchorForTarget,
  parseForGroupGeneratedElementId
} from "./forGroupGeneratedReferences";
import type {
  ActiveLinePickTarget,
  ActiveNumericReferencePickTarget,
  ActivePickCursor,
  ActivePointPickTarget
} from "../state/cadUiStore";
import type { CommandLineSession } from "../commands/commandLineSession";
import {
  commandLinePickAllowsElement,
  commandLinePickNormalizationTargetId,
  commandLineStepForPickTarget
} from "../commands/commandLinePickRouting";

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
  /** Optional context only for the command-line virtual target. Normal targets
   * deliberately retain their candidate set and ordering unchanged. */
  commandLineSession?: CommandLineSession | null;
  commandLinePickParentGroupId?: ElementId;
};

/** A construction may only pick geometry that is available earlier in document
 * order. Virtual targets that are not in the document yet (template insertion,
 * future command-line creation) pass their planned document position as
 * `targetInsertionIndex`; without it an unknown target has no candidates. */
export const pickSourcePrecedesTarget = (
  elements: CadElement[],
  targetElementId: ElementId,
  sourceElementId: ElementId,
  targetInsertionIndex?: number
) => {
  const generated = parseForGroupGeneratedElementId(sourceElementId);
  const normalizedSourceId = generated?.templateElementId ?? sourceElementId;
  const foundTargetIndex = elements.findIndex((element) => element.id === targetElementId);
  const targetIndex = foundTargetIndex >= 0 ? foundTargetIndex : targetInsertionIndex ?? -1;
  const sourceIndex = elements.findIndex((element) => element.id === normalizedSourceId);
  return targetIndex >= 0 && sourceIndex >= 0 && sourceIndex < targetIndex;
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
  activePointPickTarget: ActivePointPickTarget,
  commandLineSession?: CommandLineSession | null,
  commandLinePickParentGroupId?: ElementId
): PickCandidate[] => {
  const targetElement = elements.find((element) => element.id === activePointPickTarget.elementId);
  const targetDefinition = targetElement
    ? getParameterDefinitions(targetElement).find(
        (definition) => definition.key === activePointPickTarget.parameterKey
      )
    : null;
  const commandLineStep = commandLineStepForPickTarget(activePointPickTarget, commandLineSession);
  const isLineEndpointPointPick = commandLineStep?.kind === "endpoint" ||
    targetDefinition?.kind === "lineEndpointReference";
  const normalizationTargetId = commandLinePickNormalizationTargetId(
    activePointPickTarget,
    commandLineSession,
    commandLinePickParentGroupId,
    elements
  );
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const isValidPointCandidate = (anchor: PointAnchor) =>
    isValidPickedPointAnchorForTarget({
      elements,
      targetElementId: normalizationTargetId,
      anchor,
      allowLineEndpoint: isLineEndpointPointPick
    });

  return elements
    .filter((element) =>
      pickSourcePrecedesTarget(
        elements,
        activePointPickTarget.elementId,
        element.id,
        activePointPickTarget.insertionIndex
      ) && commandLinePickAllowsElement({
        elements,
        sourceElementId: element.id,
        target: activePointPickTarget,
        session: commandLineSession
      })
    )
    .map((element) => {
      const selectablePoints = selectablePointsForElement(
        element,
        evaluation.computedGeometry,
        elementsById
      ).filter((point) => isValidPointCandidate(point.anchor));
      const options: PickOption[] = [];

      if (
        !isLineEndpointPointPick &&
        isPointElement(element) &&
        evaluation.computedGeometry.has(element.id) &&
        isValidPointCandidate(referenceAnchor(element.id))
      ) {
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
  evaluation: EvaluationResult,
  activeLinePickTarget: ActiveLinePickTarget,
  commandLineSession?: CommandLineSession | null
): PickCandidate[] => {
  const targetElement = elements.find((element) => element.id === activeLinePickTarget.elementId);
  const parameterValue = activeLinePickTarget.draftLineIds ?? (targetElement
    ? getParameterValue(targetElement, activeLinePickTarget.parameterKey)
    : null);
  const selectedLineIds = new Set<ElementId>(
    Array.isArray(parameterValue)
      ? (parameterValue as unknown[]).filter((id): id is ElementId => typeof id === "string")
      : []
  );

  return elements
    .filter(
      (element) =>
        isLineLikeElement(element) &&
        pickSourcePrecedesTarget(
          elements,
          activeLinePickTarget.elementId,
          element.id,
          activeLinePickTarget.insertionIndex
        ) &&
        commandLinePickAllowsElement({
          elements,
          sourceElementId: element.id,
          target: activeLinePickTarget,
          session: commandLineSession
        }) &&
        evaluation.computedGeometry.has(element.id) &&
        (activeLinePickTarget.draftLineIds !== undefined || !selectedLineIds.has(element.id))
    )
    .map((element) => ({
      elementId: element.id,
      options: [{ kind: "line" as const, label: element.name, lineId: element.id }]
    }));
};

const numericReferenceCandidates = (
  elements: CadElement[],
  evaluation: EvaluationResult,
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget,
  commandLineSession?: CommandLineSession | null
): PickCandidate[] => {
  const targetElement = elements.find((element) => element.id === activeNumericReferencePickTarget.elementId);
  return elements
    .filter((element) =>
      pickSourcePrecedesTarget(
        elements,
        activeNumericReferencePickTarget.elementId,
        element.id,
        activeNumericReferencePickTarget.insertionIndex
      ) && commandLinePickAllowsElement({
        elements,
        sourceElementId: element.id,
        target: activeNumericReferencePickTarget,
        session: commandLineSession
      })
    )
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
    return pointCandidates(
      elements,
      evaluation,
      targets.activePointPickTarget,
      targets.commandLineSession,
      targets.commandLinePickParentGroupId
    );
  }
  if (targets.activeLinePickTarget) {
    return lineCandidates(elements, evaluation, targets.activeLinePickTarget, targets.commandLineSession);
  }
  if (targets.activeNumericReferencePickTarget) {
    return numericReferenceCandidates(
      elements,
      evaluation,
      targets.activeNumericReferencePickTarget,
      targets.commandLineSession
    );
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
