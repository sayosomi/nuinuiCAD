import { getDependencyJumpTargets } from "../model/dependencies";
import {
  elementIdByOffset,
  toggleSelectionIds
} from "../model/documentSelection";
import { moveElementsToInsertionIndex as moveDocumentElementsToInsertionIndex } from "../model/documentOrder";
import { createCadElement } from "../model/elementFactory";
import {
  descendantIdsForGroup,
  isGroupElement,
  nearestPreviousGroup,
  subtreeIdsForElement,
  visibleOutlineElements
} from "../model/groups";
import { useCadStore } from "../state/useCadStore";
import type { CadElement, ElementId } from "../types/geometry";
import type { CommandContext } from "./commandTypes";
import { getSelectedElement, getSelectedElementIds } from "./commandRuntime";

export const toggleSelectedElementsBooleanProperty = (property: "visible" | "enabled") => {
  const { elements } = useCadStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  if (selectedIds.size === 0) return;

  useCadStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      selectedIds.has(element.id) ? { ...element, [property]: !element[property] } : element
    )
  });
};

export const toggleElementBooleanProperty = (
  elementId: ElementId | undefined,
  property: "visible" | "enabled"
) => {
  if (!elementId) return;
  const { elements } = useCadStore.getState();
  if (!elements.some((element) => element.id === elementId)) return;

  useCadStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === elementId ? { ...element, [property]: !element[property] } : element
    )
  });
};

export const selectedDependencyJumpTargets = () => {
  const { elements, selectedElementId } = useCadStore.getState();
  const selectedElement = selectedElementId
    ? elements.find((element) => element.id === selectedElementId) ?? null
    : null;
  return getDependencyJumpTargets(selectedElement, elements);
};

const updateDependencyJumpModeAfterSelectionChange = () => {
  const { isDependencyJumpMode } = useCadStore.getState();
  if (!isDependencyJumpMode) return;

  const targets = selectedDependencyJumpTargets();
  useCadStore.setState({
    isDependencyJumpMode: targets.length > 0,
    selectedDependencyJumpIndex: 0
  });
};

export const selectElementByOffset = (offset: number) => {
  const { elements, selectedElementId } = useCadStore.getState();
  const nextElementId = elementIdByOffset(visibleOutlineElements(elements), selectedElementId, offset);
  if (!nextElementId) return;

  useCadStore.getState().setSelectedElementId(nextElementId);
  updateDependencyJumpModeAfterSelectionChange();
};

export const extendSelectionByOffset = (offset: number) => {
  const { elements, selectedElementId, selectionAnchorElementId } = useCadStore.getState();
  const visibleElements = visibleOutlineElements(elements);
  const nextElementId = elementIdByOffset(visibleElements, selectedElementId, offset);
  if (!nextElementId) return;

  const anchorId = selectionAnchorElementId ?? selectedElementId ?? elements[0]?.id ?? nextElementId;
  useCadStore.getState().setSelectedElementRange(anchorId, nextElementId);
  updateDependencyJumpModeAfterSelectionChange();
};

export const selectElement = (elementId: ElementId, selectionMode: CommandContext["selectionMode"] = "replace") => {
  const { elements, selectedElementIds, selectionAnchorElementId } = useCadStore.getState();
  const element = elements.find((item) => item.id === elementId);
  if (!element) return;

  if (selectionMode === "range") {
    useCadStore.getState().setSelectedElementRange(selectionAnchorElementId ?? elementId, elementId);
    updateDependencyJumpModeAfterSelectionChange();
    return;
  }

  if (selectionMode === "toggle") {
    const selection = toggleSelectionIds(elements, selectedElementIds, elementId);
    if (!selection) return;
    useCadStore.getState().setSelectedElementIds(
      selection.selectedElementIds,
      selection.selectedElementId
    );
    updateDependencyJumpModeAfterSelectionChange();
    return;
  }

  useCadStore.getState().setSelectedElementId(elementId);
  updateDependencyJumpModeAfterSelectionChange();
};

export const moveElementsToInsertionIndex = (elementIds: ElementId[], insertionIndex: number) => {
  const { elements, selectedElementId, selectionAnchorElementId } = useCadStore.getState();
  const expandedElementIds = elementIds.flatMap((id) => subtreeIdsForElement(elements, id));
  const change = moveDocumentElementsToInsertionIndex({
    elements,
    elementIds: expandedElementIds,
    insertionIndex,
    selectedElementId,
    selectionAnchorElementId
  });
  if (!change) return;

  useCadStore.getState().commitDocumentChange(change);
};

export const moveElementToInsertionIndex = (elementId: ElementId, insertionIndex: number) => {
  const { elements, selectedElementIds } = useCadStore.getState();
  const elementIds = selectedElementIds.includes(elementId) ? selectedElementIds : [elementId];
  if (selectedElementIds.includes(elementId) || elements.some((element) => element.id === elementId)) {
    moveElementsToInsertionIndex(elementIds, insertionIndex);
  }
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

export const groupSelectedElements = () => {
  const { elements, selectedElementId, selectedElementIds } = useCadStore.getState();
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

  useCadStore.getState().commitDocumentChange({
    elements: nextElements,
    selectedElementId: selectedElementId && selectedElementIds.includes(selectedElementId)
      ? selectedElementId
      : group.id,
    selectedElementIds: selectedTopLevelElements.map((element) => element.id),
    selectionAnchorElementId: selectedTopLevelElements[0].id
  });
};

export const ungroupSelectedGroup = () => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || !isGroupElement(selectedElement)) return;

  const { elements } = useCadStore.getState();
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

  useCadStore.getState().commitDocumentChange({
    elements: nextElements,
    selectedElementId: nextSelectedIds[0] ?? null,
    selectedElementIds: nextSelectedIds,
    selectionAnchorElementId: nextSelectedIds[0] ?? null
  });
};

export const toggleGroupExpanded = (elementId?: ElementId) => {
  const { elements, selectedElementId } = useCadStore.getState();
  const targetId = elementId ?? selectedElementId ?? undefined;
  const target = targetId ? elements.find((element) => element.id === targetId) : null;
  if (!target || !isGroupElement(target)) return;
  const expanded = target.expanded;

  useCadStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.id === target.id ? { ...element, expanded: !expanded } : element
    )
  });
};

export const indentSelectedElements = () => {
  const { elements } = useCadStore.getState();
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

  useCadStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      selectedTopLevelIds.has(element.id) ? { ...element, parentGroupId: targetGroup.id } : element
    )
  });
};

export const outdentSelectedElements = () => {
  const { elements } = useCadStore.getState();
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

  useCadStore.getState().commitDocumentChange({
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
    useCadStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 });
    return;
  }

  const { selectedDependencyJumpIndex } = useCadStore.getState();
  const currentIndex =
    selectedDependencyJumpIndex >= 0 && selectedDependencyJumpIndex < targets.length
      ? selectedDependencyJumpIndex
      : 0;
  const nextIndex = (currentIndex + offset + targets.length) % targets.length;
  useCadStore.setState({ selectedDependencyJumpIndex: nextIndex });
};

export const jumpToSelectedDependencyTarget = () => {
  const targets = selectedDependencyJumpTargets();
  if (targets.length === 0) {
    useCadStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 });
    return;
  }

  const { selectedDependencyJumpIndex } = useCadStore.getState();
  const target = targets[Math.min(Math.max(selectedDependencyJumpIndex, 0), targets.length - 1)];
  if (!target) return;

  useCadStore.getState().setSelectedElementId(target.id);
  const nextTargets = selectedDependencyJumpTargets();
  useCadStore.setState({
    isDependencyJumpMode: nextTargets.length > 0,
    selectedDependencyJumpIndex: 0
  });
};
