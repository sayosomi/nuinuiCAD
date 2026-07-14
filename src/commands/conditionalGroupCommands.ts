import { createCadElement } from "../model/elementFactory";
import {
  applyCreationPlacement,
  creationPlacementForEvaluationLimit
} from "../model/elementCreationPlacement";
import { adjustEvaluationLimitForInsertion } from "../model/evaluationDivider";
import { isConditionalGroupElement } from "../model/groups";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, ElementId } from "../types/geometry";
import type { CommandContext } from "./commandTypes";
import { getSelectedElement, getSelectedElementIds } from "./commandRuntime";
import { focusCanvasAfterCreation } from "./postCreationFocus";

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

export const addConditionalGroup = (
  context?: CommandContext
) => {
  const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
  const placement = creationPlacementForEvaluationLimit(
    elements,
    evaluationLimitIndex,
    useCadUiStore.getState().groupFoldById
  );
  const { insertionIndex } = placement;
  const group = applyCreationPlacement(createCadElement("conditionalGroup", elements), placement);

  useCadDocumentStore.getState().commitDocumentChange({
    elements: [
      ...elements.slice(0, insertionIndex),
      group,
      ...elements.slice(insertionIndex)
    ],
    evaluationLimitIndex: insertionIndex + 1,
    selectedElementId: group.id,
    selectedElementIds: [group.id],
    selectionAnchorElementId: group.id
  });
  focusCanvasAfterCreation(context);
};

export const wrapSelectedElementsInConditionalGroup = (
  context?: CommandContext
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
    ...createCadElement("conditionalGroup", elements),
    parentGroupId
  };
  const selectedTopLevelIds = new Set(selectedTopLevelElements.map((element) => element.id));
  const nextElements: CadElement[] = [
    ...elements.slice(0, firstIndex),
    group,
    ...elements.slice(firstIndex).map((element) =>
      selectedTopLevelIds.has(element.id)
        ? { ...element, parentGroupId: group.id, conditionalBranch: "then" as const }
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
    selectionAnchorElementId: group.id
  });
  focusCanvasAfterCreation(context);
};

export const addElseBranchToSelectedConditionalGroup = () => {
  const { elements } = useCadDocumentStore.getState();
  const selectedIds = new Set(getSelectedElementIds());
  const selected = getSelectedElement();
  if (selected && isConditionalGroupElement(selected)) {
    useCadUiStore.getState().setGroupFold(selected.id, { elseExpanded: true });
    return;
  }

  const selectedElements = elements.filter((element) => selectedIds.has(element.id));
  if (selectedElements.length === 0) return;
  const parentId = selectedElements[0].parentGroupId;
  const parent = parentId ? elements.find((element) => element.id === parentId) : null;
  if (
    !parent ||
    !isConditionalGroupElement(parent) ||
    selectedElements.some((element) => element.parentGroupId !== parent.id)
  ) {
    return;
  }

  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      selectedIds.has(element.id)
          ? { ...element, conditionalBranch: "else" as const }
          : element
    )
  });
  useCadUiStore.getState().setGroupFold(parent.id, { elseExpanded: true });
};

export const deleteElseBranchFromSelectedConditionalGroup = () => {
  const selected = getSelectedElement();
  if (!selected || !isConditionalGroupElement(selected)) return;
  const { elements } = useCadDocumentStore.getState();
  useCadDocumentStore.getState().commitDocumentChange({
    elements: elements.map((element) =>
      element.parentGroupId === selected.id && element.conditionalBranch === "else"
        ? { ...element, conditionalBranch: "then" as const }
        : element
    )
  });
  useCadUiStore.getState().setGroupFold(selected.id, { elseExpanded: false });
};
