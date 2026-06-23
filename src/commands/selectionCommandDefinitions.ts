import { selectedIndexes } from "../model/documentSelection";
import { subtreeIdsForElement } from "../model/groups";
import { useCadDocumentStore } from "../state/cadDocumentStore";
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
    palette: { order: 26, keywords: ["select", "next", "次", "要素"] },
    shortcuts: [{ keys: "ArrowDown" }, { keys: "Shift+ArrowDown" }],
    run: () => selectElementByOffset(1)
  },
  selectPreviousElement: {
    id: "selectPreviousElement",
    label: "前の要素を選択",
    palette: { order: 27, keywords: ["select", "previous", "前", "要素"] },
    shortcuts: [{ keys: "ArrowUp" }, { keys: "Shift+ArrowUp" }],
    run: () => selectElementByOffset(-1)
  },
  extendSelectionToNextElement: {
    id: "extendSelectionToNextElement",
    label: "次の要素まで選択",
    shortcuts: [{ keys: "Shift+ArrowDown" }],
    run: () => extendSelectionByOffset(1)
  },
  extendSelectionToPreviousElement: {
    id: "extendSelectionToPreviousElement",
    label: "前の要素まで選択",
    shortcuts: [{ keys: "Shift+ArrowUp" }],
    run: () => extendSelectionByOffset(-1)
  },
  moveSelectedElementUp: {
    id: "moveSelectedElementUp",
    label: "選択要素を上へ",
    palette: { order: 28, keywords: ["move", "up", "上", "並べ替え"] },
    shortcuts: [{ keys: "Mod+ArrowUp / Alt+ArrowUp", label: "選択要素を上へ移動" }],
    run: () => {
      const { elements } = useCadDocumentStore.getState();
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
    palette: { order: 29, keywords: ["move", "down", "下", "並べ替え"] },
    shortcuts: [{ keys: "Mod+ArrowDown / Alt+ArrowDown", label: "選択要素を下へ移動" }],
    run: () => {
      const { elements } = useCadDocumentStore.getState();
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
    palette: { order: 30, keywords: ["group", "folder", "グループ", "まとめる"] },
    shortcuts: [{ keys: "Mod+G" }],
    run: () => groupSelectedElements()
  },
  ungroupSelectedGroup: {
    id: "ungroupSelectedGroup",
    label: "選択グループを解除",
    palette: { order: 31, keywords: ["ungroup", "group", "解除", "グループ"] },
    shortcuts: [{ keys: "Mod+Shift+G" }],
    run: () => ungroupSelectedGroup()
  },
  toggleGroupExpanded: {
    id: "toggleGroupExpanded",
    label: "グループを開閉",
    palette: { order: 32, keywords: ["group", "expand", "collapse", "開閉", "折り畳み"] },
    shortcuts: [{ keys: "ArrowRight" }],
    run: (context) => toggleGroupExpanded(context?.elementId)
  },
  indentSelectedElements: {
    id: "indentSelectedElements",
    label: "選択要素をインデント",
    palette: { order: 33, keywords: ["indent", "group", "入れ子", "インデント"] },
    shortcuts: [{ keys: "]" }],
    run: () => indentSelectedElements()
  },
  outdentSelectedElements: {
    id: "outdentSelectedElements",
    label: "選択要素をアウトデント",
    palette: { order: 34, keywords: ["outdent", "group", "解除", "アウトデント"] },
    shortcuts: [{ keys: "[" }],
    run: () => outdentSelectedElements()
  },
  selectParentGroup: {
    id: "selectParentGroup",
    label: "親グループを選択",
    palette: { order: 35, keywords: ["parent", "group", "親", "グループ"] },
    shortcuts: [{ keys: "ArrowLeft" }],
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
    palette: { order: 36, keywords: ["visibility", "visible", "hide", "show", "表示", "非表示"] },
    shortcuts: [{ keys: "v" }],
    run: () => toggleSelectedElementsBooleanProperty("visible")
  },
  toggleSelectedElementEnabled: {
    id: "toggleSelectedElementEnabled",
    label: "評価する/しないを切替",
    palette: { order: 37, keywords: ["enabled", "active", "evaluate", "評価", "有効", "無効"] },
    shortcuts: [{ keys: "a" }],
    run: () => toggleSelectedElementsBooleanProperty("enabled")
  },
  deleteSelectedElement: {
    id: "deleteSelectedElement",
    label: "選択要素を削除",
    palette: { order: 38, keywords: ["delete", "remove", "削除"] },
    shortcuts: [{ keys: "d / Delete / Backspace" }],
    run: () => {
      const { elements } = useCadDocumentStore.getState();
      const selectedIds = new Set(
        getSelectedElementIds().flatMap((id) => subtreeIdsForElement(elements, id))
      );
      const indexes = selectedIndexes(elements, [...selectedIds]);
      if (indexes.length === 0) return;
      const index = indexes[0];
      const nextElements = elements.filter((element) => !selectedIds.has(element.id));
      const nextSelectedElementId = nextElements[Math.min(index, nextElements.length - 1)]?.id ?? null;
      useCadDocumentStore.getState().commitDocumentChange({
        elements: nextElements,
        selectedElementId: nextSelectedElementId,
        selectedElementIds: nextSelectedElementId ? [nextSelectedElementId] : [],
        selectionAnchorElementId: nextSelectedElementId
      });
    }
  }
} satisfies Partial<Record<CommandId, Command>>;
