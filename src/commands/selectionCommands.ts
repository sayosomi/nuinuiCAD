import { createDependencyIndex, getDependencyJumpTargets } from "../model/dependencies";
import {
  elementIdByOffset,
  toggleSelectionIds
} from "../model/documentSelection";
import { moveElementsToInsertionIndex as moveDocumentElementsToInsertionIndex } from "../model/documentOrder";
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
import { elementSupportsDisplayColor } from "../palette/colorApplicability";
import { isValidPaletteColorId } from "../palette/palette";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, ElementId } from "../types/geometry";
import type { CommandContext } from "./commandTypes";
import { getSelectedElement, getSelectedElementIds } from "./commandRuntime";
import {
  enterCreatedElementNameEntry,
  type FocusSelectedParameterInput
} from "./nameEntryAfterCreation";

export const toggleSelectedElementsBooleanProperty = (property: "visible" | "enabled") => {
  const { elements } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  if (selectedIds.size === 0) return;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      selectedIds.has(element.id) && !(property === "visible" && element.type === "variable")
        ? { ...element, [property]: !element[property] }
        : element
    )
  });
};

export const toggleElementBooleanProperty = (
  elementId: ElementId | undefined,
  property: "visible" | "enabled"
) => {
  if (!elementId) return;
  const { elements } = useCadDocumentStore.getState();
  if (!elements.some((element) => element.id === elementId)) return;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === elementId && !(property === "visible" && element.type === "variable")
        ? { ...element, [property]: !element[property] }
        : element
    )
  });
};

export const toggleGroupPrintEnabled = (elementId: ElementId | undefined) => {
  if (!elementId) return;
  const { elements } = useCadDocumentStore.getState();
  if (!elements.some((element) => element.id === elementId && element.type === "group")) return;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === elementId && element.type === "group"
        ? { ...element, printEnabled: element.printEnabled !== true }
        : element
    )
  });
};

const elementWithoutColorId = (element: CadElement): CadElement => {
  const rest = { ...element };
  delete rest.colorId;
  return rest as CadElement;
};

export const applyDisplayColorToSelection = (colorId: string | undefined) => {
  const { elements, palette } = useCadDocumentStore.getState();
  if (colorId !== undefined && !isValidPaletteColorId(palette, colorId)) return;

  const selectedIds = new Set(getSelectedElementIds());
  if (selectedIds.size === 0) return;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) => {
      if (!selectedIds.has(element.id) || !elementSupportsDisplayColor(element)) return element;
      return colorId === undefined ? elementWithoutColorId(element) : { ...element, colorId };
    })
  });
};

export const selectedDependencyJumpTargets = () => {
  const { elements, selectedElementId } = useCadDocumentStore.getState();
  const dependencyIndex = createDependencyIndex(elements);
  const selectedElement = selectedElementId
    ? dependencyIndex.elementsById.get(selectedElementId) ?? null
    : null;
  return getDependencyJumpTargets(selectedElement, elements, dependencyIndex);
};

const updateDependencyJumpModeAfterSelectionChange = () => {
  const { isDependencyJumpMode } = useCadUiStore.getState();
  if (!isDependencyJumpMode) return;

  const targets = selectedDependencyJumpTargets();
  useCadUiStore.setState({
    isDependencyJumpMode: targets.length > 0,
    selectedDependencyJumpIndex: 0
  });
};

const clearTransientSelectionUi = () => {
  useCadUiStore.getState().clearPickMode();
  useCadUiStore.getState().setSelectedDependencyJumpIndex(0);
};

export const selectElementByOffset = (offset: number) => {
  const { elements, selectedElementId } = useCadDocumentStore.getState();
  const nextElementId = elementIdByOffset(visibleOutlineElements(elements), selectedElementId, offset);
  if (!nextElementId) return;

  useCadDocumentStore.getState().setSelectedElementId(nextElementId);
  clearTransientSelectionUi();
  updateDependencyJumpModeAfterSelectionChange();
};

export const selectAllElements = () => {
  const { elements, selectedElementId } = useCadDocumentStore.getState();
  const allElementIds = elements.map((element) => element.id);
  const primaryId =
    selectedElementId && allElementIds.includes(selectedElementId)
      ? selectedElementId
      : allElementIds[0] ?? null;

  useCadDocumentStore.getState().setSelectedElementIds(allElementIds, primaryId);
  clearTransientSelectionUi();
  updateDependencyJumpModeAfterSelectionChange();
};

export const extendSelectionByOffset = (offset: number) => {
  const { elements, selectedElementId, selectionAnchorElementId } = useCadDocumentStore.getState();
  const visibleElements = visibleOutlineElements(elements);
  const nextElementId = elementIdByOffset(visibleElements, selectedElementId, offset);
  if (!nextElementId) return;

  const anchorId = selectionAnchorElementId ?? selectedElementId ?? elements[0]?.id ?? nextElementId;
  useCadDocumentStore.getState().setSelectedElementRange(anchorId, nextElementId);
  clearTransientSelectionUi();
  updateDependencyJumpModeAfterSelectionChange();
};

export const selectElement = (elementId: ElementId, selectionMode: CommandContext["selectionMode"] = "replace") => {
  const { elements, selectedElementIds, selectionAnchorElementId } = useCadDocumentStore.getState();
  const element = elements.find((item) => item.id === elementId);
  if (!element) return;

  if (selectionMode === "range") {
    useCadDocumentStore.getState().setSelectedElementRange(selectionAnchorElementId ?? elementId, elementId);
    clearTransientSelectionUi();
    updateDependencyJumpModeAfterSelectionChange();
    return;
  }

  if (selectionMode === "toggle") {
    const selection = toggleSelectionIds(elements, selectedElementIds, elementId);
    if (!selection) return;
    useCadDocumentStore.getState().setSelectedElementIds(
      selection.selectedElementIds,
      selection.selectedElementId
    );
    clearTransientSelectionUi();
    updateDependencyJumpModeAfterSelectionChange();
    return;
  }

  useCadDocumentStore.getState().setSelectedElementId(elementId);
  clearTransientSelectionUi();
  updateDependencyJumpModeAfterSelectionChange();
};

export const moveElementsToInsertionIndex = (elementIds: ElementId[], insertionIndex: number) => {
  const { elements, evaluationLimitIndex, selectedElementId, selectionAnchorElementId } =
    useCadDocumentStore.getState();
  const expandedElementIds = elementIds.flatMap((id) => subtreeIdsForElement(elements, id));
  const change = moveDocumentElementsToInsertionIndex({
    elements,
    elementIds: expandedElementIds,
    insertionIndex,
    selectedElementId,
    selectionAnchorElementId,
    evaluationLimitIndex
  });
  if (!change) return;

  const movingRootIds = new Set(elementIds);
  const movingIndexes = change.elements
    .map((element, index) => (expandedElementIds.includes(element.id) ? index : -1))
    .filter((index) => index >= 0);
  const firstMovingIndex = movingIndexes[0] ?? -1;
  const lastMovingIndex = movingIndexes.at(-1) ?? -1;
  const elementsById = new Map(change.elements.map((element) => [element.id, element]));
  const branchContext = [change.elements[firstMovingIndex - 1], change.elements[lastMovingIndex + 1]]
    .flatMap((neighbor) => {
      if (!neighbor?.parentGroupId) return [];
      const parent = elementsById.get(neighbor.parentGroupId);
      return parent && isConditionalGroupElement(parent)
        ? [{ parentId: parent.id, branch: neighbor.conditionalBranch ?? ("then" as const) }]
        : [];
    })[0];
  const movingRoots = change.elements.filter((element) => movingRootIds.has(element.id));
  const nextElements =
    branchContext &&
    movingRoots.length > 0 &&
    movingRoots.every((element) => element.parentGroupId === branchContext.parentId)
      ? change.elements.map((element) =>
          movingRootIds.has(element.id)
            ? { ...element, conditionalBranch: branchContext.branch }
            : element
        )
      : change.elements;

  useCadDocumentStore.getState().commitDocumentChange({ ...change, elements: nextElements });
};

export const moveElementToInsertionIndex = (elementId: ElementId, insertionIndex: number) => {
  const { elements, selectedElementIds } = useCadDocumentStore.getState();
  const elementIds = selectedElementIds.includes(elementId) ? selectedElementIds : [elementId];
  if (selectedElementIds.includes(elementId) || elements.some((element) => element.id === elementId)) {
    moveElementsToInsertionIndex(elementIds, insertionIndex);
  }
};

export const setEvaluationLimitIndex = (evaluationLimitIndex: number) => {
  const { elements } = useCadDocumentStore.getState();
  const nextIndex = clampEvaluationLimitIndex(elements, evaluationLimitIndex);
  useCadDocumentStore.getState().commitDocumentChange({ evaluationLimitIndex: nextIndex });
};

export const moveEvaluationDividerByOffset = (offset: number) => {
  const { evaluationLimitIndex } = useCadDocumentStore.getState();
  setEvaluationLimitIndex(evaluationLimitIndex + offset);
};

export const moveEvaluationDividerToSelectedElement = () => {
  const { elements, selectedElementId } = useCadDocumentStore.getState();
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

export const groupSelectedElements = (
  focusSelectedParameterInput?: FocusSelectedParameterInput
) => {
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
  if (selectedTopLevelElements.some((element) => element.parentGroupId !== parentGroupId)) return;

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

  useCadDocumentStore.getState().commitDocumentChange({
    elements: nextElements,
    evaluationLimitIndex: adjustEvaluationLimitForInsertion({
      elements,
      evaluationLimitIndex,
      insertionIndex: firstIndex,
      insertedCount: 1
    }),
    selectedElementId: group.id,
    selectedElementIds: [group.id],
    selectionAnchorElementId: group.id,
    selectedParameterKey: "name"
  });
  enterCreatedElementNameEntry(focusSelectedParameterInput);
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

  useCadDocumentStore.getState().commitDocumentChange({
    elements: nextElements,
    evaluationLimitIndex: adjustEvaluationLimitForDeletion({
      elements,
      evaluationLimitIndex,
      deletedIds: new Set([selectedElement.id])
    }),
    selectedElementId: nextSelectedIds[0] ?? null,
    selectedElementIds: nextSelectedIds,
    selectionAnchorElementId: nextSelectedIds[0] ?? null
  });
};

export const toggleGroupExpanded = (elementId?: ElementId) => {
  const { elements, selectedElementId } = useCadDocumentStore.getState();
  const targetId = elementId ?? selectedElementId ?? undefined;
  const target = targetId ? elements.find((element) => element.id === targetId) : null;
  if (!target || !isGroupElement(target)) return;
  const expanded = target.expanded;

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === target.id ? { ...element, expanded: !expanded } : element
    )
  });
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

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      selectedTopLevelIds.has(element.id)
        ? { ...element, parentGroupId: firstParent.parentGroupId }
        : element.id === firstParent.id && isGroupElement(element) && !element.expanded
          ? { ...element, expanded: true }
          : element
    ),
    selectionAnchorElementId: selectedTopLevel[0].id
  });
};

export const selectParentGroup = () => {
  const selected = getSelectedElement();
  if (!selected?.parentGroupId) return;
  selectElement(selected.parentGroupId);
};

export const selectDependencyJumpTargetByOffset = (offset: number) => {
  const targets = selectedDependencyJumpTargets();
  if (targets.length === 0) {
    useCadUiStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 });
    return;
  }

  const { selectedDependencyJumpIndex } = useCadUiStore.getState();
  const currentIndex =
    selectedDependencyJumpIndex >= 0 && selectedDependencyJumpIndex < targets.length
      ? selectedDependencyJumpIndex
      : 0;
  const nextIndex = (currentIndex + offset + targets.length) % targets.length;
  useCadUiStore.setState({ selectedDependencyJumpIndex: nextIndex });
};

export const jumpToSelectedDependencyTarget = () => {
  const targets = selectedDependencyJumpTargets();
  if (targets.length === 0) {
    useCadUiStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 });
    return;
  }

  const { selectedDependencyJumpIndex } = useCadUiStore.getState();
  const target = targets[Math.min(Math.max(selectedDependencyJumpIndex, 0), targets.length - 1)];
  if (!target) return;

  useCadDocumentStore.getState().setSelectedElementId(target.id);
  clearTransientSelectionUi();
  const nextTargets = selectedDependencyJumpTargets();
  useCadUiStore.setState({
    isDependencyJumpMode: nextTargets.length > 0,
    selectedDependencyJumpIndex: 0
  });
};
