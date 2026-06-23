import { selectedIndexes } from "../model/documentSelection";
import { subtreeIdsForElement } from "../model/groups";
import { useCadStore } from "../state/useCadStore";
import { moveBezierHandleByDelta, movePointElementByDelta } from "./geometryEditCommands";
import { getSelectedElementIds } from "./commandRuntime";
import {
  extendSelectionByOffset,
  groupSelectedElements,
  indentSelectedElements,
  moveElementToInsertionIndex,
  moveElementsToInsertionIndex,
  outdentSelectedElements,
  selectElement,
  selectElementByOffset,
  selectParentGroup,
  toggleElementBooleanProperty,
  toggleGroupExpanded,
  toggleSelectedElementsBooleanProperty,
  ungroupSelectedGroup
} from "./selectionCommands";
import type { Command, CommandId } from "./commandTypes";

export const selectionCommandDefinitions = {
  selectElement: {
    id: "selectElement",
    label: "要素を選択",
    run: (context) => {
      if (!context?.elementId) return;
      selectElement(context.elementId, context.selectionMode);
    }
  },
  selectNextElement: {
    id: "selectNextElement",
    label: "次の要素を選択",
    run: () => selectElementByOffset(1)
  },
  selectPreviousElement: {
    id: "selectPreviousElement",
    label: "前の要素を選択",
    run: () => selectElementByOffset(-1)
  },
  extendSelectionToNextElement: {
    id: "extendSelectionToNextElement",
    label: "次の要素まで選択",
    run: () => extendSelectionByOffset(1)
  },
  extendSelectionToPreviousElement: {
    id: "extendSelectionToPreviousElement",
    label: "前の要素まで選択",
    run: () => extendSelectionByOffset(-1)
  },
  moveSelectedElementUp: {
    id: "moveSelectedElementUp",
    label: "選択要素を上へ",
    run: () => {
      const { elements } = useCadStore.getState();
      const selectedIds = getSelectedElementIds();
      const movingIds = selectedIds.flatMap((id) => subtreeIdsForElement(elements, id));
      const indexes = selectedIndexes(elements, movingIds);
      if (indexes.length === 0 || indexes[0] <= 0) return;
      moveElementsToInsertionIndex(selectedIds, indexes[0] - 1);
    }
  },
  moveSelectedElementDown: {
    id: "moveSelectedElementDown",
    label: "選択要素を下へ",
    run: () => {
      const { elements } = useCadStore.getState();
      const selectedIds = getSelectedElementIds();
      const movingIds = selectedIds.flatMap((id) => subtreeIdsForElement(elements, id));
      const indexes = selectedIndexes(elements, movingIds);
      const lastIndex = indexes.at(-1) ?? -1;
      if (indexes.length === 0 || lastIndex >= elements.length - 1) return;
      moveElementsToInsertionIndex(selectedIds, lastIndex + 2);
    }
  },
  moveElementToInsertionIndex: {
    id: "moveElementToInsertionIndex",
    label: "要素を指定位置へ移動",
    run: (context) => {
      if (!context?.elementId || context.insertionIndex === undefined) return;
      moveElementToInsertionIndex(context.elementId, context.insertionIndex);
    }
  },
  groupSelectedElements: {
    id: "groupSelectedElements",
    label: "選択要素をグループ化",
    run: () => groupSelectedElements()
  },
  ungroupSelectedGroup: {
    id: "ungroupSelectedGroup",
    label: "選択グループを解除",
    run: () => ungroupSelectedGroup()
  },
  toggleGroupExpanded: {
    id: "toggleGroupExpanded",
    label: "グループを開閉",
    run: (context) => toggleGroupExpanded(context?.elementId)
  },
  indentSelectedElements: {
    id: "indentSelectedElements",
    label: "選択要素をインデント",
    run: () => indentSelectedElements()
  },
  outdentSelectedElements: {
    id: "outdentSelectedElements",
    label: "選択要素をアウトデント",
    run: () => outdentSelectedElements()
  },
  selectParentGroup: {
    id: "selectParentGroup",
    label: "親グループを選択",
    run: () => selectParentGroup()
  },
  movePointElementByDelta: {
    id: "movePointElementByDelta",
    label: "点を移動",
    run: (context) => {
      if (!context) return;
      movePointElementByDelta(context);
    }
  },
  moveBezierHandleByDelta: {
    id: "moveBezierHandleByDelta",
    label: "曲線ハンドルを移動",
    run: (context) => {
      if (!context) return;
      moveBezierHandleByDelta(context);
    }
  },
  toggleElementVisibility: {
    id: "toggleElementVisibility",
    label: "要素の表示/非表示を切替",
    run: (context) => toggleElementBooleanProperty(context?.elementId, "visible")
  },
  toggleElementEnabled: {
    id: "toggleElementEnabled",
    label: "要素の評価する/しないを切替",
    run: (context) => toggleElementBooleanProperty(context?.elementId, "enabled")
  },
  toggleSelectedElementVisibility: {
    id: "toggleSelectedElementVisibility",
    label: "表示/非表示を切替",
    run: () => toggleSelectedElementsBooleanProperty("visible")
  },
  toggleSelectedElementEnabled: {
    id: "toggleSelectedElementEnabled",
    label: "評価する/しないを切替",
    run: () => toggleSelectedElementsBooleanProperty("enabled")
  },
  deleteSelectedElement: {
    id: "deleteSelectedElement",
    label: "選択要素を削除",
    run: () => {
      const { elements } = useCadStore.getState();
      const selectedIds = new Set(
        getSelectedElementIds().flatMap((id) => subtreeIdsForElement(elements, id))
      );
      const indexes = selectedIndexes(elements, [...selectedIds]);
      if (indexes.length === 0) return;
      const index = indexes[0];
      const nextElements = elements.filter((element) => !selectedIds.has(element.id));
      const nextSelectedElementId = nextElements[Math.min(index, nextElements.length - 1)]?.id ?? null;
      useCadStore.getState().commitDocumentChange({
        elements: nextElements,
        selectedElementId: nextSelectedElementId,
        selectedElementIds: nextSelectedElementId ? [nextSelectedElementId] : [],
        selectionAnchorElementId: nextSelectedElementId
      });
    }
  }
} satisfies Partial<Record<CommandId, Command>>;
