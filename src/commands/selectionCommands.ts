import {
  elementIdByOffset,
  selectionRangeIds,
  toggleSelectionIds
} from "../model/documentSelection";
import { moveElementsToInsertionIndex as moveDocumentElementsToInsertionIndex } from "../model/documentOrder";
import {
  elementTypeSupportsHiddenActivity,
  nextElementActivity,
  type ElementActivity
} from "../model/elementActivity";
import { createCadElement } from "../model/elementFactory";
import {
  adjustEvaluationLimitForDeletion,
  adjustEvaluationLimitForInsertion,
  clampEvaluationLimitIndex
} from "../model/evaluationDivider";
import {
  descendantIdsForGroup,
  isConditionalGroupElement,
  isGroupElement,
  nearestPreviousGroup,
  subtreeIdsForElement,
  visibleOutlineElements
} from "../model/groups";
import { useCadDocumentStore, type SelectionSnapshot } from "../state/cadDocumentStore";
import {
  selectionEligibleElementIds,
  useCadUiStore
} from "../state/cadUiStore";
import type { CadElement, ElementId } from "../types/geometry";
import type { CommandContext } from "./commandTypes";
import { getSelectedElement, getSelectedElementIds } from "./commandRuntime";
import { commitDocumentChangeAndSelect } from "./commitDocumentChangeAndSelect";
import { focusCanvasAfterCreation } from "./postCreationFocus";

const applyActivityToTargets = (
  elements: CadElement[],
  targetIds: ReadonlySet<ElementId>,
  activity: ElementActivity
): CadElement[] | null => {
  let changed = false;
  const nextElements = elements.map((element) => {
    if (!targetIds.has(element.id)) return element;
    if (activity === "hidden" && !elementTypeSupportsHiddenActivity(element.type)) return element;
    if (element.activity === activity) return element;
    changed = true;
    return { ...element, activity };
  });
  return changed ? nextElements : null;
};

export const cycleElementActivity = (elementId: ElementId | undefined) => {
  const { elements } = useCadDocumentStore.getState();
  const target = elements.find((element) => element.id === elementId);
  if (!target) return;

  const next = nextElementActivity(target.activity, target.type);
  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === elementId ? { ...element, activity: next } : element
    )
  });
};

export const setElementActivity = (elementId: ElementId | undefined, activity: ElementActivity) => {
  if (!elementId) return;
  const { elements } = useCadDocumentStore.getState();
  if (!elements.some((element) => element.id === elementId)) return;

  const nextElements = applyActivityToTargets(elements, new Set([elementId]), activity);
  if (!nextElements) return;
  useCadDocumentStore.getState().commitDocumentChange({ elements: nextElements });
};

export const setElementsActivity = (activity: ElementActivity) => {
  const { elements } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  if (selectedIds.size === 0) return;

  const nextElements = applyActivityToTargets(elements, selectedIds, activity);
  if (!nextElements) return;
  useCadDocumentStore.getState().commitDocumentChange({ elements: nextElements });
};

const clearTransientSelectionUi = () => {
  useCadUiStore.getState().clearPickMode();
};

export type CanvasSelectionMode = "replace" | "toggle" | "range";

const mutateCanvasSelection = (recordHistory: boolean, mutate: () => void) => {
  const before = {
    selectedElementId: useCadUiStore.getState().selectedElementId,
    selectedElementIds: [...useCadUiStore.getState().selectedElementIds],
    selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId
  };
  mutate();
  if (recordHistory) useCadDocumentStore.getState().recordCanvasSelection(before);
};

/** Snapshot used by ephemeral Canvas candidate sessions before their first preview. */
export const canvasSelectionSnapshot = (): SelectionSnapshot => {
  const state = useCadUiStore.getState();
  return {
    selectedElementId: state.selectedElementId,
    selectedElementIds: [...state.selectedElementIds],
    selectionAnchorElementId: state.selectionAnchorElementId
  };
};

export const canvasSelectionForElement = (
  elements: readonly CadElement[],
  selectionBefore: SelectionSnapshot,
  elementId: ElementId,
  selectionMode: CanvasSelectionMode
): SelectionSnapshot | null => {
  const selectableIds = selectionEligibleElementIds(elements);
  if (!selectableIds.has(elementId)) return null;
  const selectableElements = elements.filter((element) => selectableIds.has(element.id));
  const eligibleBeforeIds = selectionBefore.selectedElementIds.filter((id) => selectableIds.has(id));

  if (selectionMode === "replace") {
    return {
      selectedElementId: elementId,
      selectedElementIds: [elementId],
      selectionAnchorElementId: elementId
    };
  }

  if (selectionMode === "toggle") {
    const selection = toggleSelectionIds([...selectableElements], eligibleBeforeIds, elementId);
    if (!selection) return null;
    return {
      selectedElementId: selection.selectedElementId,
      selectedElementIds: selection.selectedElementIds,
      selectionAnchorElementId: selection.selectedElementId
    };
  }

  const anchorId = selectionBefore.selectionAnchorElementId && selectableIds.has(selectionBefore.selectionAnchorElementId)
    ? selectionBefore.selectionAnchorElementId
    : elementId;
  const selectedElementIds = selectionRangeIds([...selectableElements], anchorId, elementId);
  if (selectedElementIds.length === 0) return null;
  return {
    selectedElementId: elementId,
    selectedElementIds,
    selectionAnchorElementId: anchorId
  };
};

/**
 * Applies one overlap candidate from the session baseline through the normal
 * selection command semantics, without creating a history entry.
 */
export const previewCanvasSelection = (
  previousSelection: SelectionSnapshot,
  elementId: ElementId,
  selectionMode: CanvasSelectionMode = "replace"
) => {
  const elements = useCadDocumentStore.getState().elements;
  const selection = canvasSelectionForElement(elements, previousSelection, elementId, selectionMode);
  if (!selection) return;
  useCadUiStore.getState().applySelection(elements, selection);
  clearTransientSelectionUi();
};

/** Commits exactly one ephemeral candidate-session transition to the shared history owner. */
export const finalizeCanvasSelectionSession = (previousSelection: SelectionSnapshot) => {
  useCadDocumentStore.getState().recordCanvasSelection(previousSelection);
};

/** Replace Canvas selection through the shared history owner. Document order remains the default. */
export const replaceCanvasSelection = (
  elementIds: readonly ElementId[],
  primaryElementId?: ElementId,
  recordHistory = false,
  ordering: "document" | "requested" = "document"
) => {
  const elements = useCadDocumentStore.getState().elements;
  const selectableIds = selectionEligibleElementIds(elements);
  const requested = new Set(elementIds);
  const orderedIds = ordering === "requested"
    ? Array.from(requested).filter((id) => selectableIds.has(id))
    : elements
        .filter((element) => requested.has(element.id) && selectableIds.has(element.id))
        .map((element) => element.id);
  if (orderedIds.length === 0) return false;
  const primaryId = primaryElementId && orderedIds.includes(primaryElementId)
    ? primaryElementId
    : orderedIds[0];
  mutateCanvasSelection(recordHistory, () =>
    useCadUiStore.getState().setSelectedElementIds(orderedIds, primaryId)
  );
  clearTransientSelectionUi();
  return true;
};

export const clearCanvasSelection = (recordHistory = false) => {
  mutateCanvasSelection(recordHistory, () => useCadUiStore.getState().clearElementSelection());
  clearTransientSelectionUi();
};

export const selectElementByOffset = (offset: number, recordHistory = false) => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId } = useCadUiStore.getState();
  const selectableIds = selectionEligibleElementIds(elements);
  const selectableOutlineElements = visibleOutlineElements(elements, useCadUiStore.getState().groupFoldById)
    .filter((element) => selectableIds.has(element.id));
  const nextElementId = elementIdByOffset(
    selectableOutlineElements,
    selectedElementId,
    offset
  );
  if (!nextElementId) return;

  mutateCanvasSelection(recordHistory, () => useCadUiStore.getState().setSelectedElementId(nextElementId));
  clearTransientSelectionUi();
};

export const selectAllElements = (recordHistory = false) => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId } = useCadUiStore.getState();
  const selectableIds = selectionEligibleElementIds(elements);
  const allElementIds = elements
    .filter((element) => selectableIds.has(element.id))
    .map((element) => element.id);
  const primaryId =
    selectedElementId && allElementIds.includes(selectedElementId)
      ? selectedElementId
      : allElementIds[0] ?? null;

  mutateCanvasSelection(recordHistory, () => useCadUiStore.getState().setSelectedElementIds(allElementIds, primaryId));
  clearTransientSelectionUi();
};

export const extendSelectionByOffset = (offset: number, recordHistory = false) => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId, selectionAnchorElementId } = useCadUiStore.getState();
  const selectableIds = selectionEligibleElementIds(elements);
  const visibleElements = visibleOutlineElements(elements, useCadUiStore.getState().groupFoldById)
    .filter((element) => selectableIds.has(element.id));
  const nextElementId = elementIdByOffset(visibleElements, selectedElementId, offset);
  if (!nextElementId) return;

  const anchorId = selectionAnchorElementId ?? selectedElementId ?? elements[0]?.id ?? nextElementId;
  mutateCanvasSelection(recordHistory, () => useCadUiStore.getState().setSelectedElementRange(anchorId, nextElementId));
  clearTransientSelectionUi();
};

export const selectElement = (
  elementId: ElementId,
  selectionMode: CanvasSelectionMode = "replace",
  recordHistory = false
) => {
  const { elements } = useCadDocumentStore.getState();
  const previousSelection = canvasSelectionSnapshot();
  const selection = canvasSelectionForElement(elements, previousSelection, elementId, selectionMode);
  if (!selection) return;
  useCadUiStore.getState().applySelection(elements, selection);
  if (recordHistory) useCadDocumentStore.getState().recordCanvasSelection(previousSelection);
  clearTransientSelectionUi();
};

export const moveElementsToInsertionIndex = (elementIds: ElementId[], insertionIndex: number) => {
  moveElementsToInsertionIndexWithParent(elementIds, insertionIndex);
};

const targetParentIsValid = (
  elements: CadElement[],
  movingRootIds: Set<ElementId>,
  targetParentGroupId: ElementId | null | undefined
) => {
  if (targetParentGroupId === undefined || targetParentGroupId === null) return true;
  const targetParent = elements.find((element) => element.id === targetParentGroupId);
  if (!targetParent || !isGroupElement(targetParent)) return false;
  for (const movingId of movingRootIds) {
    if (movingId === targetParentGroupId) return false;
    if (descendantIdsForGroup(elements, movingId).includes(targetParentGroupId)) return false;
  }
  return true;
};

export const moveElementsToInsertionIndexWithParent = (
  elementIds: ElementId[],
  insertionIndex: number,
  targetParentGroupId?: ElementId | null
) => {
  const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
  const { selectedElementId, selectionAnchorElementId } = useCadUiStore.getState();
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const movingRootIds = new Set(
    elements
      .filter(
        (element) =>
          elementIds.includes(element.id) && !hasSelectedAncestor(element, elementsById, new Set(elementIds))
      )
      .map((element) => element.id)
  );
  if (!targetParentIsValid(elements, movingRootIds, targetParentGroupId)) return;

  const expandedElementIds = elementIds.flatMap((id) => subtreeIdsForElement(elements, id));
  const change = moveDocumentElementsToInsertionIndex({
    elements,
    elementIds: expandedElementIds,
    insertionIndex,
    selectedElementId,
    selectionAnchorElementId,
    evaluationLimitIndex
  });
  if (!change && targetParentGroupId === undefined) return;

  const orderedElements = change?.elements ?? elements;
  const movingIndexes = orderedElements
    .map((element, index) => (expandedElementIds.includes(element.id) ? index : -1))
    .filter((index) => index >= 0);
  const firstMovingIndex = movingIndexes[0] ?? -1;
  const lastMovingIndex = movingIndexes.at(-1) ?? -1;
  const orderedElementsById = new Map(orderedElements.map((element) => [element.id, element]));
  const branchContext = [orderedElements[firstMovingIndex - 1], orderedElements[lastMovingIndex + 1]]
    .flatMap((neighbor) => {
      if (!neighbor?.parentGroupId) return [];
      const parent = orderedElementsById.get(neighbor.parentGroupId);
      return parent && isConditionalGroupElement(parent)
        ? [{ parentId: parent.id, branch: neighbor.conditionalBranch ?? ("then" as const) }]
        : [];
    })[0];
  const movingRoots = orderedElements.filter((element) => movingRootIds.has(element.id));
  const nextElements =
    targetParentGroupId === undefined &&
    branchContext &&
    movingRoots.length > 0 &&
    movingRoots.every((element) => element.parentGroupId === branchContext.parentId)
      ? orderedElements.map((element) =>
          movingRootIds.has(element.id)
            ? { ...element, conditionalBranch: branchContext.branch }
            : element
        )
      : targetParentGroupId !== undefined
        ? orderedElements.map((element) =>
            movingRootIds.has(element.id)
              ? {
                  ...element,
                  parentGroupId: targetParentGroupId ?? undefined,
                  conditionalBranch: undefined
                }
              : element
          )
        : orderedElements;

  useCadUiStore.getState().setCommandErrorMessage(null);
  const selection = change ?? {
    selectedElementId,
    selectedElementIds: elementIds,
    selectionAnchorElementId: selectionAnchorElementId ?? elementIds[0] ?? null
  };
  commitDocumentChangeAndSelect(
    {
      evaluationLimitIndex: change?.evaluationLimitIndex,
      elements: nextElements
    },
    selection
  );
};

export const moveElementToInsertionIndex = (
  elementId: ElementId,
  insertionIndex: number,
  targetParentGroupId?: ElementId | null
) => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementIds } = useCadUiStore.getState();
  const elementIds = selectedElementIds.includes(elementId) ? selectedElementIds : [elementId];
  if (selectedElementIds.includes(elementId) || elements.some((element) => element.id === elementId)) {
    moveElementsToInsertionIndexWithParent(elementIds, insertionIndex, targetParentGroupId);
  }
};

export const setEvaluationLimitIndex = (evaluationLimitIndex: number) => {
  const { elements, evaluationLimitIndex: currentIndex } = useCadDocumentStore.getState();
  const nextIndex = clampEvaluationLimitIndex(elements, evaluationLimitIndex);
  // No marker means full evaluation. Moving an implicit boundary to the end
  // must not materialize a new manual stop || an Undo entry.
  if (currentIndex === undefined && nextIndex === elements.length) return;
  if (currentIndex === nextIndex) return;
  useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: nextIndex });
};

export const moveEvaluationDividerByOffset = (offset: number) => {
  const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
  setEvaluationLimitIndex(clampEvaluationLimitIndex(elements, evaluationLimitIndex) + offset);
};

export const moveEvaluationDividerToSelectedElement = () => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId } = useCadUiStore.getState();
  const selectedIndex = elements.findIndex((element) => element.id === selectedElementId);
  if (selectedIndex < 0) return;
  setEvaluationLimitIndex(selectedIndex + 1);
};

export const moveEvaluationDividerToEnd = () => {
  const { elements } = useCadDocumentStore.getState();
  setEvaluationLimitIndex(elements.length);
};

const hasSelectedAncestor = (
  element: CadElement,
  elementsById: Map<ElementId, CadElement>,
  selectedIds: Set<ElementId>
) => {
  let parentId = element.parentGroupId;
  while (parentId) {
    if (selectedIds.has(parentId)) return true;
    parentId = elementsById.get(parentId)?.parentGroupId;
  }
  return false;
};

export const groupSelectedElements = (context?: CommandContext) => {
  const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  if (selectedIds.size === 0) return;

  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const selectedTopLevelElements = elements.filter(
    (element) => selectedIds.has(element.id) && !hasSelectedAncestor(element, elementsById, selectedIds)
  );
  if (selectedTopLevelElements.length === 0) return;

  const firstIndex = elements.findIndex((element) => element.id === selectedTopLevelElements[0].id);
  const parentGroupId = selectedTopLevelElements[0].parentGroupId;
  if (selectedTopLevelElements.some((element) => element.parentGroupId !== parentGroupId)) {
    useCadUiStore
      .getState()
      .setCommandErrorMessage(
        "違う階層の要素はまとめてグループ化できません。ドラッグで同じグループへ入れるか、グループから出してから実行してください。"
      );
    return;
  }

  const group = {
    ...createCadElement("group", elements),
    parentGroupId
  };
  const selectedTopLevelIds = new Set(selectedTopLevelElements.map((element) => element.id));
  const nextElements = [
    ...elements.slice(0, firstIndex),
    group,
    ...elements.slice(firstIndex).map((element) =>
      selectedTopLevelIds.has(element.id)
        ? { ...element, parentGroupId: group.id }
        : element
    )
  ];

  commitDocumentChangeAndSelect({
    elements: nextElements,
    evaluationLimitIndex: adjustEvaluationLimitForInsertion({
      elements,
      evaluationLimitIndex,
      insertionIndex: firstIndex,
      insertedCount: 1
    })
  }, {
    selectedElementId: group.id,
    selectedElementIds: [group.id],
    selectionAnchorElementId: group.id
  });
  useCadUiStore.getState().setCommandErrorMessage(null);
  focusCanvasAfterCreation(context);
};

export const ungroupSelectedGroup = () => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || selectedElement.type !== "group") return;

  const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
  const childIds = new Set(descendantIdsForGroup(elements, selectedElement.id));
  const directChildIds = new Set(
    elements
      .filter((element) => element.parentGroupId === selectedElement.id)
      .map((element) => element.id)
  );
  const nextElements = elements
    .filter((element) => element.id !== selectedElement.id)
    .map((element) =>
      directChildIds.has(element.id)
        ? { ...element, parentGroupId: selectedElement.parentGroupId }
        : element
    );
  const nextSelectedIds = [...childIds].filter((id) =>
    nextElements.some((element) => element.id === id)
  );

  commitDocumentChangeAndSelect({
    elements: nextElements,
    evaluationLimitIndex: adjustEvaluationLimitForDeletion({
      elements,
      evaluationLimitIndex,
      deletedIds: new Set([selectedElement.id])
    })
  }, {
    selectedElementId: nextSelectedIds[0] ?? null,
    selectedElementIds: nextSelectedIds,
    selectionAnchorElementId: nextSelectedIds[0] ?? null
  });
};

export const toggleGroupExpanded = (elementId?: ElementId) => {
  const { elements } = useCadDocumentStore.getState();
  const { selectedElementId } = useCadUiStore.getState();
  const targetId = elementId ?? selectedElementId ?? undefined;
  const target = targetId ? elements.find((element) => element.id === targetId) : null;
  if (!target || !isGroupElement(target)) return;
  useCadUiStore.getState().toggleGroupExpanded(target.id);
};

export const indentSelectedElements = () => {
  const { elements } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  if (selectedIds.size === 0) return;

  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const selectedTopLevel = elements.filter(
    (element) => selectedIds.has(element.id) && !hasSelectedAncestor(element, elementsById, selectedIds)
  );
  if (selectedTopLevel.length === 0) return;

  const targetGroup = nearestPreviousGroup(elements, selectedTopLevel[0].id);
  if (!targetGroup) return;
  const selectedTopLevelIds = new Set(selectedTopLevel.map((element) => element.id));

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      selectedTopLevelIds.has(element.id) ? { ...element, parentGroupId: targetGroup.id } : element
    )
  });
};

export const outdentSelectedElements = () => {
  const { elements } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  if (selectedIds.size === 0) return;

  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const selectedTopLevel = elements.filter(
    (element) => selectedIds.has(element.id) && !hasSelectedAncestor(element, elementsById, selectedIds)
  );
  if (selectedTopLevel.length === 0) return;

  const firstParentId = selectedTopLevel[0].parentGroupId;
  const firstParent = firstParentId ? elementsById.get(firstParentId) : null;
  if (!firstParent || !isGroupElement(firstParent)) return;
  const selectedTopLevelIds = new Set(selectedTopLevel.map((element) => element.id));

  commitDocumentChangeAndSelect({
    elements: elements.map((element) =>
      selectedTopLevelIds.has(element.id)
        ? { ...element, parentGroupId: firstParent.parentGroupId }
        : element
    )
  }, {
    selectionAnchorElementId: selectedTopLevel[0].id
  });
  useCadUiStore.getState().setGroupFold(firstParent.id, { expanded: true });
};

export const selectParentGroup = () => {
  const selected = getSelectedElement();
  if (!selected?.parentGroupId) return;
  selectElement(selected.parentGroupId);
};
