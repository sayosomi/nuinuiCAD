import type { NumericMeasurementKey } from "../geometry/numericExpressions";
import {
  numericReferenceGeometrySupportsProperty,
  type NumericReferenceGeometry
} from "../geometry/numericReferenceProperties";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import {
  runtimeOnlyElementTypes,
  type CadElement,
  type ComputedGeometry,
  type ElementId,
  type EvaluationResult,
  type PointAnchor
} from "../types/geometry";
import {
  isLineLikeElement,
  isPointElement,
  referenceAnchor,
  selectablePointsForGeometry
} from "./pointAnchors";
import {
  isValidPickedPointAnchorForTarget,
  parseForGroupGeneratedElementId
} from "./forGroupGeneratedReferences";
import {
  elementsByIdForPickCandidateGeometries,
  pickCandidateGeometries
} from "./pickCandidateGeometry";
import type {
  ActiveLinePickTarget,
  ActiveNumericReferencePickTarget,
  ActivePickCursor,
  ActivePointPickTarget
} from "../state/cadUiStore";
import type { CommandLineSession } from "../commands/commandLineSession";
import {
  commandLinePointPickTargetIds,
  commandLinePickNormalizationTargetId,
  commandLineStepForPickTarget
} from "../commands/commandLinePickRouting";
import {
  isSemanticGeometryCandidateAllowed,
  sourceReferenceForAnchor,
  sourceReferenceForElement,
  sourceReferenceForRuntimeElement,
  sourceReferenceText,
  type CanonicalGeometrySourceReference,
  type ModuleSemanticCandidateContext
} from "./moduleSemanticCandidateBoundary";

export type PickOption =
  | {
      kind: "point";
      label: string;
      anchor: PointAnchor;
      sourceReference?: CanonicalGeometrySourceReference;
    }
  | {
      kind: "line";
      label: string;
      lineId: ElementId;
      sourceReference?: CanonicalGeometrySourceReference;
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
  /** Document template identity for a runtime forGroup instance. Canvas uses
   * `elementId`; text completion uses this to aggregate by persisted token. */
  referenceElementId?: ElementId;
  options: PickOption[];
};

type PickTargets = {
  activePointPickTarget: ActivePointPickTarget | null;
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null;
  activeLinePickTarget: ActiveLinePickTarget | null;
  /** Optional context only for the command-line virtual target. Normal targets
   * deliberately retain their candidate set && ordering unchanged. */
  commandLineSession?: CommandLineSession | null;
  commandLinePickParentGroupId?: ElementId;
  /** Creation placement / live DSL scope is authoritative when supplied. */
  referenceElements?: readonly CadElement[];
  moduleSemanticContext?: ModuleSemanticCandidateContext;
};

const eligibleReferenceElements = (
  elements: CadElement[],
  referenceElements: readonly CadElement[] | undefined,
  targetElementId: ElementId,
  targetInsertionIndex?: number
) => referenceElements ?? elements.filter((element) =>
  pickSourcePrecedesTarget(elements, targetElementId, element.id, targetInsertionIndex)
);

/** Missing effective-enabled metadata preserves the established computed-
 * geometry fallback. It is intentionally not a fail-closed condition. */
const isEnabledPickSource = (evaluation: EvaluationResult, elementId: ElementId) =>
  evaluation.effectiveEnabledElementIds?.has(elementId) ?? true;

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
  commandLinePickParentGroupId?: ElementId,
  referenceElements?: readonly CadElement[],
  moduleSemanticContext?: ModuleSemanticCandidateContext
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
  const pointPickTargetIds = commandLinePointPickTargetIds({
    target: activePointPickTarget,
    session: commandLineSession,
    parentGroupId: commandLinePickParentGroupId,
    elements
  });
  const eligibleElements = eligibleReferenceElements(
    elements,
    referenceElements,
    activePointPickTarget.elementId,
    activePointPickTarget.insertionIndex
  );
  const geometryCandidates = pickCandidateGeometries({
    elements,
    evaluation,
    referenceElements: eligibleElements,
    normalizationTargetElementId:
      pointPickTargetIds.normalizationTargetElementId ?? activePointPickTarget.elementId
  });
  const elementsById = elementsByIdForPickCandidateGeometries(elements, geometryCandidates);
  const isValidPointCandidate = (anchor: PointAnchor) =>
    isValidPickedPointAnchorForTarget({
      elements,
      ...pointPickTargetIds,
      anchor,
      allowLineEndpoint: isLineEndpointPointPick
    });

  return geometryCandidates
    .filter((candidate) => !moduleSemanticContext || isSemanticGeometryCandidateAllowed({
      candidateElementId: candidate.geometry.elementId,
      targetElementId: activePointPickTarget.elementId,
      context: moduleSemanticContext
    }))
    .filter((candidate) => isEnabledPickSource(evaluation, candidate.geometry.elementId))
    .map((candidate) => {
      const selectablePoints = selectablePointsForGeometry(
        candidate.geometry,
        elementsById
      ).filter((point) => isValidPointCandidate(point.anchor));
      const options: PickOption[] = [];

      if (
        !isLineEndpointPointPick &&
        isPointElement(candidate.templateElement) &&
        candidate.geometry.kind === "point" &&
        isValidPointCandidate(referenceAnchor(candidate.geometry.elementId))
      ) {
        const sourceReference = moduleSemanticContext
          ? sourceReferenceForAnchor({
              anchor: referenceAnchor(candidate.geometry.elementId),
              targetElementId: activePointPickTarget.elementId,
              context: moduleSemanticContext
            })
          : null;
        options.push({
          kind: "point",
          label: candidate.geometry.name,
          anchor: referenceAnchor(candidate.geometry.elementId),
          ...(sourceReference ? { sourceReference } : {})
        });
      } else {
        options.push(
          ...selectablePoints.map((point) => {
            const sourceReference = moduleSemanticContext
              ? sourceReferenceForAnchor({
                  anchor: point.anchor,
                  targetElementId: activePointPickTarget.elementId,
                  context: moduleSemanticContext
                })
              : null;
            return {
              kind: "point" as const,
              label: point.label,
              anchor: point.anchor,
              ...(sourceReference ? { sourceReference } : {})
            };
          })
        );
      }

      return {
        elementId: candidate.geometry.elementId,
        ...(candidate.referenceElementId ? { referenceElementId: candidate.referenceElementId } : {}),
        options
      };
    })
    .filter((candidate) => candidate.options.length > 0);
};

const lineCandidates = (
  elements: CadElement[],
  evaluation: EvaluationResult,
  activeLinePickTarget: ActiveLinePickTarget,
  referenceElements?: readonly CadElement[],
  commandLineSession?: CommandLineSession | null,
  commandLinePickParentGroupId?: ElementId,
  moduleSemanticContext?: ModuleSemanticCandidateContext
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

  const eligibleElements = eligibleReferenceElements(
    elements,
    referenceElements,
    activeLinePickTarget.elementId,
    activeLinePickTarget.insertionIndex
  );
  const normalizationTargetElementId = commandLinePickNormalizationTargetId(
    activeLinePickTarget,
    commandLineSession,
    commandLinePickParentGroupId,
    elements
  );
  return pickCandidateGeometries({
    elements,
    evaluation,
    referenceElements: eligibleElements,
    normalizationTargetElementId
  })
    .filter(
      (candidate) =>
        (!moduleSemanticContext || isSemanticGeometryCandidateAllowed({
          candidateElementId: candidate.geometry.elementId,
          targetElementId: activeLinePickTarget.elementId,
          context: moduleSemanticContext
        })) &&
        isLineLikeElement(candidate.templateElement) &&
        candidate.geometry.kind !== "point" &&
        candidate.geometry.kind !== "image" &&
        candidate.geometry.kind !== "text" &&
        isEnabledPickSource(evaluation, candidate.geometry.elementId) &&
        (activeLinePickTarget.draftLineIds !== undefined ||
          (!selectedLineIds.has(candidate.templateElement.id) &&
            !selectedLineIds.has(sourceReferenceText(sourceReferenceForRuntimeElement({
              runtimeElementId: candidate.templateElement.id,
              targetElementId: activeLinePickTarget.elementId,
              context: moduleSemanticContext ?? {}
            })) ?? "")))
    )
    .map((candidate) => {
      const sourceReference = moduleSemanticContext
        ? sourceReferenceForRuntimeElement({
            runtimeElementId: candidate.templateElement.id,
            targetElementId: activeLinePickTarget.elementId,
            context: moduleSemanticContext
          })
        : null;
      return {
        elementId: candidate.geometry.elementId,
        ...(candidate.referenceElementId ? { referenceElementId: candidate.referenceElementId } : {}),
        options: [{
          kind: "line" as const,
          label: candidate.geometry.name,
          lineId: candidate.geometry.elementId,
          ...(sourceReference ? { sourceReference } : {})
        }]
      };
    });
};

const numericReferenceCandidates = (
  elements: CadElement[],
  evaluation: EvaluationResult,
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget,
  moduleSemanticContext?: ModuleSemanticCandidateContext
): PickCandidate[] => {
  return elements
    .filter((element) => !runtimeOnlyElementTypes.has(element.type))
    .filter((element) => !moduleSemanticContext || isSemanticGeometryCandidateAllowed({
      candidateElementId: element.id,
      targetElementId: activeNumericReferencePickTarget.elementId,
      context: moduleSemanticContext
    }))
    .filter((element) =>
      pickSourcePrecedesTarget(
        elements,
        activeNumericReferencePickTarget.elementId,
        element.id,
        activeNumericReferencePickTarget.insertionIndex
      )
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
                expression: sourceReferenceForElement({
                  element,
                  targetElementId: activeNumericReferencePickTarget.elementId,
                  context: moduleSemanticContext ?? {},
                  property
                }) ?? numericReferenceExpression(geometry, property)
              }
            ]
          : [];
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
      targets.commandLinePickParentGroupId,
      targets.referenceElements,
      targets.moduleSemanticContext
    );
  }
  if (targets.activeLinePickTarget) {
    return lineCandidates(
      elements,
      evaluation,
      targets.activeLinePickTarget,
      targets.referenceElements,
      targets.commandLineSession,
      targets.commandLinePickParentGroupId,
      targets.moduleSemanticContext
    );
  }
  if (targets.activeNumericReferencePickTarget) {
    return numericReferenceCandidates(
      elements,
      evaluation,
      targets.activeNumericReferencePickTarget,
      targets.moduleSemanticContext
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
