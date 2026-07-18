import type { CadElement, ElementId } from "../types/geometry";

export const clampEvaluationLimitIndex = (elements: CadElement[], index: number | undefined) =>
  Math.min(Math.max(index ?? elements.length, 0), elements.length);

export const evaluatedElements = (elements: CadElement[], evaluationLimitIndex: number | undefined) =>
  elements.slice(0, clampEvaluationLimitIndex(elements, evaluationLimitIndex));

export const adjustEvaluationLimitForInsertion = ({
  elements,
  evaluationLimitIndex,
  insertionIndex,
  insertedCount
}: {
  elements: CadElement[];
  evaluationLimitIndex: number | undefined;
  insertionIndex: number;
  insertedCount: number;
}) => {
  if (evaluationLimitIndex === undefined) return undefined;
  const limit = clampEvaluationLimitIndex(elements, evaluationLimitIndex);
  const clampedInsertionIndex = Math.min(Math.max(insertionIndex, 0), elements.length);
  return limit + (clampedInsertionIndex <= limit ? insertedCount : 0);
};

export const adjustEvaluationLimitForDeletion = ({
  elements,
  evaluationLimitIndex,
  deletedIds
}: {
  elements: CadElement[];
  evaluationLimitIndex: number | undefined;
  deletedIds: Set<ElementId>;
}) => {
  if (evaluationLimitIndex === undefined) return undefined;
  const limit = clampEvaluationLimitIndex(elements, evaluationLimitIndex);
  const deletedBeforeLimit = elements
    .slice(0, limit)
    .filter((element) => deletedIds.has(element.id)).length;
  return limit - deletedBeforeLimit;
};

export const adjustEvaluationLimitForMove = ({
  elements,
  evaluationLimitIndex,
  movingIds,
  insertionIndex
}: {
  elements: CadElement[];
  evaluationLimitIndex: number | undefined;
  movingIds: ElementId[];
  insertionIndex: number;
}) => {
  if (evaluationLimitIndex === undefined) return undefined;
  const limit = clampEvaluationLimitIndex(elements, evaluationLimitIndex);
  const movingIdSet = new Set(movingIds);
  const movingCount = elements.filter((element) => movingIdSet.has(element.id)).length;
  if (movingCount === 0) return limit;

  const clampedInsertionIndex = Math.min(Math.max(insertionIndex, 0), elements.length);
  const movedBeforeLimit = elements
    .slice(0, limit)
    .filter((element) => movingIdSet.has(element.id)).length;
  const movedBeforeInsertion = elements
    .slice(0, clampedInsertionIndex)
    .filter((element) => movingIdSet.has(element.id)).length;
  const remainingLimit = limit - movedBeforeLimit;
  const targetIndex = clampedInsertionIndex - movedBeforeInsertion;
  return remainingLimit + (targetIndex <= remainingLimit ? movingCount : 0);
};
