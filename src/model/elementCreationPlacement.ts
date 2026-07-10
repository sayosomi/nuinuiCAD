import type { CadElement, ConditionalBranch, ElementId } from "../types/geometry";
import type { GroupFoldById } from "./groups";
import { clampEvaluationLimitIndex, evaluatedElements } from "./evaluationDivider";
import {
  descendantIdsForGroup,
  groupStateByElementId,
  isGroupExpanded,
  isConditionalGroupElement,
  isGroupElement
} from "./groups";

export type ElementCreationPlacement = {
  insertionIndex: number;
  referenceElements: CadElement[];
  parentGroupId?: ElementId;
  conditionalBranch?: ConditionalBranch;
};

const lastSubtreeIndex = (
  elements: CadElement[],
  groupId: ElementId,
  fallbackIndex: number
) => {
  const subtreeIds = new Set([groupId, ...descendantIdsForGroup(elements, groupId)]);
  const indexes = elements
    .map((element, index) => (subtreeIds.has(element.id) ? index : -1))
    .filter((index) => index >= 0);
  return indexes.at(-1) ?? fallbackIndex;
};

const groupContainsInsertionIndex = (
  elements: CadElement[],
  groupId: ElementId,
  groupIndex: number,
  insertionIndex: number
) => (
  insertionIndex > groupIndex &&
  insertionIndex <= lastSubtreeIndex(elements, groupId, groupIndex) + 1
);

const branchForConditionalGroupInsertion = (
  elements: CadElement[],
  parentGroupId: ElementId,
  insertionIndex: number
): ConditionalBranch => {
  for (let index = insertionIndex - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element.parentGroupId === parentGroupId) {
      return element.conditionalBranch ?? "then";
    }
  }
  return "then";
};

export const creationPlacementForEvaluationLimit = (
  elements: CadElement[],
  evaluationLimitIndex: number | undefined,
  groupFoldById?: GroupFoldById
): ElementCreationPlacement => {
  const insertionIndex = clampEvaluationLimitIndex(elements, evaluationLimitIndex);
  const groupStates = groupStateByElementId(elements, groupFoldById);
  const targetGroup = elements
    .map((element, index) => ({ element, index, depth: groupStates.get(element.id)?.depth ?? 0 }))
    .filter(({ element, index }) => (
      isGroupElement(element) &&
      isGroupExpanded(element.id, groupFoldById) &&
      groupContainsInsertionIndex(elements, element.id, index, insertionIndex)
    ))
    .sort((a, b) => b.depth - a.depth)[0]?.element;

  const parentGroupId = targetGroup?.id;
  const conditionalBranch =
    targetGroup && isConditionalGroupElement(targetGroup)
      ? branchForConditionalGroupInsertion(elements, targetGroup.id, insertionIndex)
      : undefined;

  return {
    insertionIndex,
    referenceElements: evaluatedElements(elements, insertionIndex),
    ...(parentGroupId ? { parentGroupId } : {}),
    ...(conditionalBranch ? { conditionalBranch } : {})
  };
};

export const applyCreationPlacement = <T extends CadElement>(
  element: T,
  placement: Pick<ElementCreationPlacement, "parentGroupId" | "conditionalBranch">
): T => ({
  ...element,
  ...(placement.parentGroupId ? { parentGroupId: placement.parentGroupId } : {}),
  ...(placement.conditionalBranch ? { conditionalBranch: placement.conditionalBranch } : {})
});
