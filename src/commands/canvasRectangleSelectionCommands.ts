import type { CadElement, ElementId } from "../types/geometry";
import { useCadDocumentStore, type SelectionSnapshot } from "../state/cadDocumentStore";
import { selectionEligibleElementIds, useCadUiStore } from "../state/cadUiStore";
import {
  canvasSelectionSnapshot,
  clearCanvasSelection,
  replaceCanvasSelection
} from "./selectionCommands";

export type CanvasRectangleSelectionUpdateMode = "replace" | "add" | "toggle";

const uniqueIds = (ids: readonly ElementId[]): ElementId[] => [...new Set(ids)];

const rectangleMemberIdsInDocumentOrder = (
  elements: readonly CadElement[],
  memberIds: readonly ElementId[]
): ElementId[] => {
  const selectableIds = selectionEligibleElementIds(elements);
  const requested = new Set(memberIds);
  return elements
    .filter((element) => requested.has(element.id) && selectableIds.has(element.id))
    .map((element) => element.id);
};

export const canvasRectangleSelectionForMembers = (
  elements: readonly CadElement[],
  selectionBefore: SelectionSnapshot,
  memberIds: readonly ElementId[],
  mode: CanvasRectangleSelectionUpdateMode
): SelectionSnapshot | null => {
  const selectableIds = selectionEligibleElementIds(elements);
  const orderedMembers = rectangleMemberIdsInDocumentOrder(elements, memberIds);
  const existingIds = uniqueIds(selectionBefore.selectedElementIds)
    .filter((id) => selectableIds.has(id));

  if (mode === "replace") {
    const primaryId = orderedMembers[0] ?? null;
    return {
      selectedElementId: primaryId,
      selectedElementIds: orderedMembers,
      selectionAnchorElementId: primaryId
    };
  }

  if (orderedMembers.length === 0) return null;

  const existingSet = new Set(existingIds);
  let selectedElementIds: ElementId[];
  if (mode === "add") {
    selectedElementIds = [
      ...existingIds,
      ...orderedMembers.filter((id) => !existingSet.has(id))
    ];
  } else {
    const memberSet = new Set(orderedMembers);
    selectedElementIds = [
      ...existingIds.filter((id) => !memberSet.has(id)),
      ...orderedMembers.filter((id) => !existingSet.has(id))
    ];
  }

  const primaryId =
    selectionBefore.selectedElementId && selectedElementIds.includes(selectionBefore.selectedElementId)
      ? selectionBefore.selectedElementId
      : selectedElementIds[0] ?? null;
  return {
    selectedElementId: primaryId,
    selectedElementIds,
    selectionAnchorElementId: primaryId
  };
};

/** Commits one rectangle result through the shared Canvas selection/history owners. */
export const commitCanvasRectangleSelection = (
  memberIds: readonly ElementId[],
  mode: CanvasRectangleSelectionUpdateMode,
  recordHistory = false
): boolean => {
  const elements = useCadDocumentStore.getState().elements;
  const selectionBefore = canvasSelectionSnapshot();
  const selection = canvasRectangleSelectionForMembers(
    elements,
    selectionBefore,
    memberIds,
    mode
  );
  if (!selection) return false;

  if (mode === "replace") {
    if (selection.selectedElementIds.length === 0) {
      clearCanvasSelection(recordHistory);
      return true;
    }
    return replaceCanvasSelection(
      selection.selectedElementIds,
      selection.selectedElementId ?? undefined,
      recordHistory,
      "requested"
    );
  }

  useCadUiStore.getState().applySelection(elements, selection);
  if (recordHistory) useCadDocumentStore.getState().recordCanvasSelection(selectionBefore);
  useCadUiStore.getState().clearPickMode();
  return true;
};
