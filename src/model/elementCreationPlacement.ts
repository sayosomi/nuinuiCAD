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

/** A semantic insertion target whose parent scope is not inferred from its flat index. */
export type ElementCreationTarget = Pick<
  ElementCreationPlacement,
  "insertionIndex" | "parentGroupId" | "conditionalBranch"
>;

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

/**
 * Resolves a creation target independently from the evaluator cutoff. The
 * target determines group membership; references must remain both earlier than
 * the target and within the manual evaluation boundary.
 */
export const creationPlacementForInsertion = (
  elements: CadElement[],
  insertionIndex: number,
  evaluationLimitIndex: number | undefined,
  groupFoldById?: GroupFoldById
): ElementCreationPlacement => {
  const clampedInsertionIndex = clampEvaluationLimitIndex(elements, insertionIndex);
  const groupStates = groupStateByElementId(elements, groupFoldById);
  const targetGroup = elements
    .map((element, index) => ({ element, index, depth: groupStates.get(element.id)?.depth ?? 0 }))
    .filter(({ element, index }) => (
      isGroupElement(element) &&
      isGroupExpanded(element.id, groupFoldById) &&
      groupContainsInsertionIndex(elements, element.id, index, clampedInsertionIndex)
    ))
    .sort((a, b) => b.depth - a.depth)[0]?.element;

  const parentGroupId = targetGroup?.id;
  const conditionalBranch =
    targetGroup && isConditionalGroupElement(targetGroup)
      ? branchForConditionalGroupInsertion(elements, targetGroup.id, clampedInsertionIndex)
      : undefined;

  return {
    insertionIndex: clampedInsertionIndex,
    referenceElements: evaluatedElements(
      elements,
      Math.min(clampedInsertionIndex, clampEvaluationLimitIndex(elements, evaluationLimitIndex))
    ),
    ...(parentGroupId ? { parentGroupId } : {}),
    ...(conditionalBranch ? { conditionalBranch } : {})
  };
};

/**
 * Uses an anchor-derived parent scope for creation. This deliberately ignores
 * fold state: UI folding must never alter the persisted document structure.
 */
export const creationPlacementForTarget = (
  elements: CadElement[],
  target: ElementCreationTarget,
  evaluationLimitIndex: number | undefined
): ElementCreationPlacement => {
  const insertionIndex = clampEvaluationLimitIndex(elements, target.insertionIndex);
  return {
    insertionIndex,
    referenceElements: evaluatedElements(
      elements,
      Math.min(insertionIndex, clampEvaluationLimitIndex(elements, evaluationLimitIndex))
    ),
    ...(target.parentGroupId ? { parentGroupId: target.parentGroupId } : {}),
    ...(target.conditionalBranch ? { conditionalBranch: target.conditionalBranch } : {})
  };
};

/** Existing divider-based placement for commands whose explicit target is the evaluation boundary. */
export const creationPlacementForEvaluationLimit = (
  elements: CadElement[],
  evaluationLimitIndex: number | undefined,
  groupFoldById?: GroupFoldById
) => {
  const insertionIndex = clampEvaluationLimitIndex(elements, evaluationLimitIndex);
  return creationPlacementForInsertion(elements, insertionIndex, evaluationLimitIndex, groupFoldById);
};

export const applyCreationPlacement = <T extends CadElement>(
  element: T,
  placement: Pick<ElementCreationPlacement, "parentGroupId" | "conditionalBranch">
): T => ({
  ...element,
  ...(placement.parentGroupId ? { parentGroupId: placement.parentGroupId } : {}),
  ...(placement.conditionalBranch ? { conditionalBranch: placement.conditionalBranch } : {})
});
