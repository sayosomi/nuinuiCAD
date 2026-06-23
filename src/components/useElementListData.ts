import { useMemo } from "react";
import { elementSearchResults } from "../model/elementSearch";
import {
  descendantIdsForGroup,
  effectiveEnabledElementIds,
  effectiveVisibleElementIds,
  groupStateByElementId,
  isGroupElement,
  visibleOutlineElements
} from "../model/groups";
import {
  isPointElement,
  isLineLikeElement,
  lineEndpointReferenceForAnchor,
  selectablePointsForElement
} from "../model/pointAnchors";
import {
  pickCandidates,
  resolvedPickCursor
} from "../model/pickCandidates";
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
  EvaluationResult
} from "../types/geometry";
import type {
  ActiveLinePickTarget,
  ActiveNumericReferencePickTarget,
  ActivePickCursor,
  ActivePointPickTarget
} from "../state/cadUiStore";

export type NumericReferenceGeometry = ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;

const isComputedLine = (geometry: ComputedGeometry | undefined): geometry is ComputedLine =>
  geometry?.kind === "line";

const isComputedArcLine = (geometry: ComputedGeometry | undefined): geometry is ComputedArcLine =>
  geometry?.kind === "arcLine";

const isComputedBezierCurve = (
  geometry: ComputedGeometry | undefined
): geometry is ComputedBezierCurve => geometry?.kind === "bezierCurve";

const isComputedOffsetLine = (
  geometry: ComputedGeometry | undefined
): geometry is ComputedOffsetLine => geometry?.kind === "offsetLine";

export const useElementListData = ({
  elements,
  evaluation,
  elementSearchQuery,
  elementSearchCursorId,
  elementSearchPickableOnly,
  activePointPickTarget,
  activeNumericReferencePickTarget,
  activeLinePickTarget,
  activePickCursor
}: {
  elements: CadElement[];
  evaluation: EvaluationResult;
  elementSearchQuery: string;
  elementSearchCursorId: ElementId | null;
  elementSearchPickableOnly: boolean;
  activePointPickTarget: ActivePointPickTarget | null;
  activeNumericReferencePickTarget: ActiveNumericReferencePickTarget | null;
  activeLinePickTarget: ActiveLinePickTarget | null;
  activePickCursor: ActivePickCursor | null;
}) => {
  const errorElementIds = new Set(evaluation.errors.map((error) => error.elementId));
  const warningElementIds = new Set(evaluation.warnings.map((warning) => warning.elementId));
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const outlineElements = visibleOutlineElements(elements);
  const isSearchActive = elementSearchQuery.trim().length > 0;
  const rawSearchResults = useMemo(
    () => elementSearchResults(elements, elementSearchQuery),
    [elements, elementSearchQuery]
  );
  const groupStates = groupStateByElementId(elements);
  const effectiveVisibleIds = evaluation.effectiveVisibleElementIds ?? effectiveVisibleElementIds(elements);
  const effectiveEnabledIds = evaluation.effectiveEnabledElementIds ?? effectiveEnabledElementIds(elements);
  const descendantIdsByGroupId = new Map(
    elements
      .filter(isGroupElement)
      .map((element) => [element.id, descendantIdsForGroup(elements, element.id)])
  );
  const activePointPickTargetElement = activePointPickTarget
    ? elements.find((element) => element.id === activePointPickTarget.elementId)
    : null;
  const activePointPickTargetDefinition = activePointPickTargetElement && activePointPickTarget
    ? getParameterDefinitions(activePointPickTargetElement).find(
        (definition) => definition.key === activePointPickTarget.parameterKey
      )
    : null;
  const isLineEndpointPointPick =
    activePointPickTargetDefinition?.kind === "lineEndpointReference";
  const activeLinePickTargetElement = activeLinePickTarget
    ? elements.find((element) => element.id === activeLinePickTarget.elementId)
    : null;
  const activeLinePickParameterValue =
    activeLinePickTargetElement && activeLinePickTarget
      ? getParameterValue(activeLinePickTargetElement, activeLinePickTarget.parameterKey)
      : null;
  const activeLinePickSelectedLineIds = new Set<ElementId>(
    Array.isArray(activeLinePickParameterValue)
      ? (activeLinePickParameterValue as unknown[]).filter(
          (id): id is ElementId => typeof id === "string"
        )
      : []
  );
  const candidateList = pickCandidates(elements, evaluation, {
    activePointPickTarget,
    activeNumericReferencePickTarget,
    activeLinePickTarget
  });
  const candidateByElementId = new Map(
    candidateList.map((candidate) => [candidate.elementId, candidate])
  );
  const selectedPickCursor = resolvedPickCursor(candidateList, activePickCursor);
  const selectablePointOptions = (element: CadElement) => {
    const rawSelectablePoints = selectablePointsForElement(
      element,
      evaluation.computedGeometry,
      elementsById
    );
    return isLineEndpointPointPick
      ? rawSelectablePoints.filter((point) =>
          lineEndpointReferenceForAnchor(point.anchor, elements)
        )
      : rawSelectablePoints;
  };
  const numericReferenceGeometry = (elementId: ElementId) => {
    const geometry = evaluation.computedGeometry.get(elementId);
    return isComputedLine(geometry) ||
      isComputedArcLine(geometry) ||
      isComputedBezierCurve(geometry) ||
      isComputedOffsetLine(geometry)
      ? geometry
      : null;
  };
  const isSearchPickableElement = (element: CadElement) => {
    if (activeLinePickTarget) {
      return (
        isLineLikeElement(element) &&
        element.id !== activeLinePickTarget.elementId &&
        !activeLinePickSelectedLineIds.has(element.id)
      );
    }
    if (activeNumericReferencePickTarget) {
      return numericReferenceGeometry(element.id) !== null;
    }
    if (activePointPickTarget) {
      return (!isLineEndpointPointPick && isPointElement(element)) || selectablePointOptions(element).length > 0;
    }
    return true;
  };
  const searchResults = rawSearchResults.filter(
    (result) => !elementSearchPickableOnly || isSearchPickableElement(result.element)
  );
  const displayedElements = isSearchActive ? searchResults.map((result) => result.element) : outlineElements;
  const searchResultByElementId = new Map(searchResults.map((result) => [result.element.id, result]));
  const activeSearchCursorId =
    isSearchActive && searchResults.some((result) => result.element.id === elementSearchCursorId)
      ? elementSearchCursorId
      : searchResults[0]?.element.id ?? null;
  const groupIssueCounts = (elementId: ElementId) => {
    const descendantIds = descendantIdsByGroupId.get(elementId) ?? [];
    return {
      childCount: descendantIds.length,
      errorCount: descendantIds.filter((id) => errorElementIds.has(id)).length,
      warningCount: descendantIds.filter((id) => warningElementIds.has(id)).length
    };
  };
  const getRowData = (element: CadElement) => {
    const index = elements.findIndex((item) => item.id === element.id);
    const searchResult = searchResultByElementId.get(element.id);
    const groupState = groupStates.get(element.id);
    const groupIssues = isGroupElement(element) ? groupIssueCounts(element.id) : null;
    const selectablePoints = selectablePointOptions(element);
    const referenceGeometry = numericReferenceGeometry(element.id);
    const isPointPickCandidate =
      activePointPickTarget &&
      ((!isLineEndpointPointPick && isPointElement(element)) || selectablePoints.length > 0);
    const isNumericReferenceCandidate =
      Boolean(activeNumericReferencePickTarget) && referenceGeometry !== null;
    const isLinePickCandidate =
      Boolean(activeLinePickTarget) &&
      isLineLikeElement(element) &&
      element.id !== activeLinePickTarget?.elementId &&
      !activeLinePickSelectedLineIds.has(element.id);

    return {
      index,
      searchParentGroupNames: searchResult?.parentGroupNames ?? [],
      depth: groupState?.depth ?? 0,
      hiddenByGroup: Boolean(groupState?.hiddenByGroupId),
      disabledByGroup: Boolean(groupState?.disabledByGroupId),
      isEffectivelyVisible: effectiveVisibleIds.has(element.id),
      isEffectivelyEnabled: effectiveEnabledIds.has(element.id),
      groupIssues,
      hasError: errorElementIds.has(element.id) || Boolean(groupIssues?.errorCount),
      hasWarning: warningElementIds.has(element.id) || Boolean(groupIssues?.warningCount),
      selectablePoints,
      referenceGeometry,
      isPointPickCandidate: Boolean(isPointPickCandidate),
      isNumericReferenceCandidate,
      isLinePickCandidate,
      pickCandidate: candidateByElementId.get(element.id),
      selectedPickOptionIndex:
        selectedPickCursor?.elementId === element.id ? selectedPickCursor.optionIndex : -1,
      isSearchPickable: isSearchPickableElement(element)
    };
  };

  return {
    rawSearchResults,
    searchResults,
    displayedElements,
    activeSearchCursorId,
    selectedPickCursor,
    isSearchActive,
    isLineEndpointPointPick,
    activeLinePickSelectedLineIds,
    selectablePointOptions,
    numericReferenceGeometry,
    isSearchPickableElement,
    getRowData
  };
};
