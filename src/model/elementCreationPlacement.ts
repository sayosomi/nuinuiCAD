import type { CadElement, ConditionalBranch, ElementId } from "../types/geometry";
import { clampEvaluationLimitIndex, evaluatedElements } from "./evaluationDivider";
import {
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

const parentPath = (element: CadElement | undefined, byId: Map<ElementId, CadElement>) => {
  const path: ElementId[] = [];
  let parentId = element?.parentGroupId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent || !isGroupElement(parent)) break;
    path.unshift(parent.id);
    parentId = parent.parentGroupId;
  }
  return path;
};

const sharedPath = (left: readonly ElementId[], right: readonly ElementId[]) => {
  const result: ElementId[] = [];
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) break;
    result.push(left[index]);
  }
  return result;
};

/**
 * Resolves the structural scope at a bare flat index without consulting UI
 * folding. Anchored creation uses creationPlacementForTarget instead; this
 * fallback only adopts a scope that exists on both sides of the boundary, ||
 * immediately after a group header before its first child.
 */
const parentGroupAtInsertionIndex = (elements: CadElement[], insertionIndex: number) => {
  if (insertionIndex <= 0 || insertionIndex >= elements.length) return undefined;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const previous = elements[insertionIndex - 1];
  const next = elements[insertionIndex];
  const nextPath = parentPath(next, byId);
  if (previous && isGroupElement(previous) && nextPath.at(-1) === previous.id) return previous.id;
  return sharedPath(parentPath(previous, byId), nextPath).at(-1);
};

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
 * the target && within the manual evaluation boundary.
 */
export const creationPlacementForInsertion = (
  elements: CadElement[],
  insertionIndex: number,
  evaluationLimitIndex: number | undefined
): ElementCreationPlacement => {
  const clampedInsertionIndex = clampEvaluationLimitIndex(elements, insertionIndex);
  const parentGroupId = parentGroupAtInsertionIndex(elements, clampedInsertionIndex);
  const targetGroup = parentGroupId
    ? elements.find((element) => element.id === parentGroupId && isGroupElement(element))
    : undefined;

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
  evaluationLimitIndex: number | undefined
) => {
  const insertionIndex = clampEvaluationLimitIndex(elements, evaluationLimitIndex);
  return creationPlacementForInsertion(elements, insertionIndex, evaluationLimitIndex);
};

export const applyCreationPlacement = <T extends CadElement>(
  element: T,
  placement: Pick<ElementCreationPlacement, "parentGroupId" | "conditionalBranch">
): T => ({
  ...element,
  ...(placement.parentGroupId ? { parentGroupId: placement.parentGroupId } : {}),
  ...(placement.conditionalBranch ? { conditionalBranch: placement.conditionalBranch } : {})
});
