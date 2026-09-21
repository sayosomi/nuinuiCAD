import type { NumericMeasurementKey } from "../geometry/numericExpressions";
import {
  numericReferenceGeometrySupportsProperty,
  type NumericReferenceGeometry
} from "../geometry/numericReferenceProperties";
import {
  constructionForElementType,
  dslRequiredValueTypeOf,
  dslValueTypeForParameterDefinition,
  getParameterDefinitions,
  getParameterValue,
  isDslGeometryValueType,
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOfConstruction,
  moduleGeometryInterfaceTypeOfElement
} from "@nuinuicad/nui-language";
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
  pickCandidateGeometries,
  type PickCandidateGeometry
} from "./pickCandidateGeometry";
import type {
  ActiveLinePickTarget,
  ActiveNumericReferencePickTarget,
  ActivePickCursor,
  ActivePointPickTarget
} from "../state/cadUiStore";
import type { PickModeDraftEntry } from "./pickModeSession";
import type { CommandLineSession } from "../commands/commandLineSession";
import { creationParameterDefinitionFor } from "../commands/creationRecipes";
import {
  commandLinePointPickTargetIds,
  commandLinePickNormalizationTargetId,
  commandLineStepForPickTarget
} from "../commands/commandLinePickRouting";
import {
  isSemanticGeometryCandidateAllowed,
  sourceReferenceForRootTemplate,
  sourceReferenceForElement,
  sourceReferenceForRuntimeElement,
  sourceReferenceText,
  type CanonicalGeometrySourceReference,
  type ModuleSemanticCandidateContext
} from "./moduleSemanticCandidateBoundary";
import { elementQualifiedNameParts } from "@nuinuicad/nui-language";
import {
  numericGeometryStaticTargetForElementInDocument,
  numericGeometryStaticTargetForModuleInterface
} from "../geometry/numericGeometryProperties";

type StaticGeometryInterface = "point" | "line" | "path";

const staticGeometryInterfaceForParameter = (
  definition: ReturnType<typeof getParameterDefinitions>[number] | undefined
): StaticGeometryInterface | null => {
  const valueType = dslRequiredValueTypeOf(dslValueTypeForParameterDefinition(definition));
  return isDslGeometryValueType(valueType) ? valueType.kind : null;
};

const expectedLinePickInterface = (
  targetElement: CadElement | undefined,
  target: ActiveLinePickTarget,
  commandLineStep: ReturnType<typeof commandLineStepForPickTarget>,
  commandLineSession?: CommandLineSession | null
): StaticGeometryInterface | null => {
  const definition = targetElement
    ? getParameterDefinitions(targetElement).find((candidate) => candidate.key === target.parameterKey)
    : commandLineStep && commandLineSession
      ? (() => {
          try {
            return creationParameterDefinitionFor(commandLineSession.recipe.type, commandLineStep.key);
          } catch {
            return undefined;
          }
        })()
      : undefined;
  return staticGeometryInterfaceForParameter(definition);
};

const staticGeometryInterfaceForCandidate = (
  candidate: PickCandidateGeometry,
  moduleSemanticContext?: ModuleSemanticCandidateContext
): StaticGeometryInterface | null => {
  const origin = moduleSemanticContext?.moduleMaterialization?.originByRuntimeElementId.get(candidate.templateElement.id);
  if (origin?.kind === "moduleBody") {
    const declaration = moduleSemanticContext?.sourceLexicalNamespace?.allDeclarations.find(
      (entry) => entry.statementId === origin.sourceStatementId
    );
    if (declaration?.kind === "geometry") {
      return moduleGeometryInterfaceTypeOfElement(declaration.statement);
    }
  }
  try {
    const construction = constructionForElementType(candidate.templateElement.type);
    return moduleGeometryInterfaceTypeOfConstruction(construction.category, construction);
  } catch {
    return null;
  }
};

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
  /** Explicit Pick session draft; absent means ordinary suggestion/candidate mode. */
  pickModeDraft?: readonly PickModeDraftEntry[];
  /** Optional context only for the command-line virtual target. Normal targets
   * deliberately retain their candidate set && ordering unchanged. */
  commandLineSession?: CommandLineSession | null;
  commandLinePickParentGroupId?: ElementId;
  /** Creation placement / live DSL scope is authoritative when supplied. */
  referenceElements?: readonly CadElement[];
  moduleSemanticContext?: ModuleSemanticCandidateContext;
};

const sourceReferenceForCandidate = ({
  candidate,
  elements,
  targetElementId,
  context,
  pointKey
}: {
  candidate: Pick<PickCandidateGeometry, "templateElement" | "generatedOccurrenceIndex">;
  elements: readonly CadElement[];
  targetElementId: ElementId;
  context?: ModuleSemanticCandidateContext;
  pointKey?: string;
}): CanonicalGeometrySourceReference | null => {
  if (candidate.generatedOccurrenceIndex !== undefined) {
    const materialized = context
      ? sourceReferenceForRuntimeElement({
          runtimeElementId: candidate.templateElement.id,
          targetElementId,
          context,
          occurrenceIndex: candidate.generatedOccurrenceIndex,
          ...(pointKey ? { pointKey } : {})
        })
      : null;
    return materialized ?? sourceReferenceForRootTemplate({
      templatePath: elementQualifiedNameParts(candidate.templateElement, [...elements]),
      occurrenceIndex: candidate.generatedOccurrenceIndex,
      ...(pointKey ? { pointKey } : {})
    });
  }
  if (!context) return null;
  return sourceReferenceForRuntimeElement({
    runtimeElementId: candidate.templateElement.id,
    targetElementId,
    context,
    ...(pointKey ? { pointKey } : {})
  });
};

const sourceReferenceSelectionKeys = (reference: CanonicalGeometrySourceReference | null) => {
  const text = sourceReferenceText(reference);
  return text ? [text, text.slice(1)] : [];
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
  geometry?.kind === "offsetLine" ||
  geometry?.kind === "joinedPath" ||
  geometry?.kind === "polyline"
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
      candidateElementId: candidate.templateElement.id,
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
        const sourceReference = sourceReferenceForCandidate({
          candidate,
          elements,
          targetElementId: activePointPickTarget.elementId,
          context: moduleSemanticContext
        });
        options.push({
          kind: "point",
          label: candidate.geometry.name,
          anchor: referenceAnchor(candidate.geometry.elementId),
          ...(sourceReference ? { sourceReference } : {})
        });
      } else {
        options.push(
          ...selectablePoints.map((point) => {
            const sourceReference = sourceReferenceForCandidate({
              candidate,
              elements,
              targetElementId: activePointPickTarget.elementId,
              context: moduleSemanticContext,
              ...(point.anchor.mode === "derived" ? { pointKey: point.anchor.pointKey } : {})
            });
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
  pickModeDraft: readonly PickModeDraftEntry[] | undefined,
  referenceElements?: readonly CadElement[],
  commandLineSession?: CommandLineSession | null,
  commandLinePickParentGroupId?: ElementId,
  moduleSemanticContext?: ModuleSemanticCandidateContext
): PickCandidate[] => {
  const targetElement = elements.find((element) => element.id === activeLinePickTarget.elementId);
  const commandLineStep = commandLineStepForPickTarget(activeLinePickTarget, commandLineSession);
  const expectedGeometryInterface = expectedLinePickInterface(
    targetElement,
    activeLinePickTarget,
    commandLineStep,
    commandLineSession
  );
  const parameterValue = pickModeDraft
    ?.filter((entry): entry is Extract<PickModeDraftEntry, { kind: "line" }> => entry.kind === "line")
    .map((entry) => entry.lineId) ?? (targetElement
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
          candidateElementId: candidate.templateElement.id,
          targetElementId: activeLinePickTarget.elementId,
          context: moduleSemanticContext
        })) &&
        isLineLikeElement(candidate.templateElement) &&
        candidate.geometry.kind !== "point" &&
        candidate.geometry.kind !== "image" &&
        candidate.geometry.kind !== "text" &&
        (expectedGeometryInterface === null || (() => {
          const actualGeometryInterface = staticGeometryInterfaceForCandidate(candidate, moduleSemanticContext);
          return actualGeometryInterface === null || isModuleGeometryInterfaceAssignable(
            actualGeometryInterface,
            expectedGeometryInterface
          );
        })()) &&
        isEnabledPickSource(evaluation, candidate.geometry.elementId) &&
        (pickModeDraft !== undefined ||
          (!selectedLineIds.has(candidate.templateElement.id) &&
            sourceReferenceSelectionKeys(sourceReferenceForCandidate({
              candidate,
              elements,
              targetElementId: activeLinePickTarget.elementId,
              context: moduleSemanticContext
            })).every((key) => !selectedLineIds.has(key))))
    )
    .map((candidate) => {
      const sourceReference = sourceReferenceForCandidate({
        candidate,
        elements,
        targetElementId: activeLinePickTarget.elementId,
        context: moduleSemanticContext
      });
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
      const origin = moduleSemanticContext?.moduleMaterialization?.originByRuntimeElementId.get(element.id);
      const sourceDeclaration = origin?.kind === "moduleBody"
        ? moduleSemanticContext?.sourceLexicalNamespace?.allDeclarations.find(
            (declaration) => declaration.statementId === origin.sourceStatementId
          )
        : undefined;
      const moduleInterface = sourceDeclaration?.kind === "geometry"
        ? moduleGeometryInterfaceTypeOfElement(sourceDeclaration.statement)
        : null;
      const staticTarget = moduleInterface
        ? numericGeometryStaticTargetForModuleInterface(moduleInterface)
        : numericGeometryStaticTargetForElementInDocument(element, elements);
      const options: PickOption[] =
        geometry &&
        geometry.elementId !== activeNumericReferencePickTarget.elementId &&
        numericReferenceGeometrySupportsProperty(geometry, property, staticTarget)
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
      targets.pickModeDraft,
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

export const pickCursorForCandidateOffset = (
  candidates: PickCandidate[],
  cursor: ActivePickCursor | null,
  offset: number
): ActivePickCursor | null => {
  if (candidates.length === 0) return null;
  const currentIndex = cursor
    ? candidates.findIndex((candidate) => candidate.elementId === cursor.elementId)
    : -1;
  const nextIndex = currentIndex < 0
    ? offset > 0 ? 0 : candidates.length - 1
    : (currentIndex + offset + candidates.length) % candidates.length;
  const candidate = candidates[nextIndex];
  if (!candidate) return null;
  return {
    elementId: candidate.elementId,
    optionIndex: Math.min(cursor?.optionIndex ?? 0, candidate.options.length - 1)
  };
};

export const pickCursorForOptionOffset = (
  candidates: PickCandidate[],
  cursor: ActivePickCursor | null,
  offset: number
): ActivePickCursor | null => {
  const selected = selectedPickOption(candidates, cursor);
  if (!selected) return null;
  const optionCount = selected.candidate.options.length;
  return {
    elementId: selected.candidate.elementId,
    optionIndex: (selected.cursor.optionIndex + offset + optionCount) % optionCount
  };
};
