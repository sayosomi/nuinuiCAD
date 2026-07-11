import { selectedIndexes } from "../model/documentSelection";
import { duplicateElements } from "../model/elementDuplication";
import { protectedElementIdsForDestructiveChange } from "../model/elementLocks";
import {
  adjustEvaluationLimitForDeletion,
  adjustEvaluationLimitForInsertion
} from "../model/evaluationDivider";
import { isConditionalGroupElement, subtreeIdsForElement } from "../model/groups";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { moveBezierHandleByDelta, movePointElementByDelta } from "./geometryEditCommands";
import { getSelectedElement, getSelectedElementIds } from "./commandRuntime";
import {
  addConditionalGroup,
  addElseBranchToSelectedConditionalGroup,
  deleteElseBranchFromSelectedConditionalGroup,
  wrapSelectedElementsInConditionalGroup
} from "./conditionalGroupCommands";
import {
  addForGroup,
  toggleSelectedForGroupGenerated,
  wrapSelectedElementsInForGroup
} from "./forGroupCommands";
import {
  addGroup,
  extendSelectionByOffset,
  groupSelectedElements,
  indentSelectedElements,
  moveElementToInsertionIndex,
  moveElementsToInsertionIndex,
  moveEvaluationDividerByOffset,
  moveEvaluationDividerToEnd,
  moveEvaluationDividerToSelectedElement,
  outdentSelectedElements,
  applyDisplayColorToSelection,
  selectAllElements,
  selectElement,
  selectElementByOffset,
  selectParentGroup,
  setEvaluationLimitIndex,
  toggleElementBooleanProperty,
  toggleElementLocked,
  toggleGroupPrintEnabled,
  toggleSelectedGroupPrintEnabled,
  toggleGroupExpanded,
  toggleSelectedElementsLocked,
  toggleSelectedElementsBooleanProperty,
  ungroupSelectedGroup
} from "./selectionCommands";
import type { Command, CommandId } from "./commandTypes";

const hasSelection = () => getSelectedElementIds().length > 0;

const selectedConditionalGroupHasElseBranch = () => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || !isConditionalGroupElement(selectedElement)) return false;
  const { elements } = useCadDocumentStore.getState();
  return elements.some(
    (element) => element.parentGroupId === selectedElement.id && element.conditionalBranch === "else"
  );
};

export const selectionCommandDefinitions = {
  selectElement: {
    id: "selectElement",
    label: "要素を選択",
    run: (context) => {
      if (!context?.elementId) return;
      selectElement(context.elementId, context.selectionMode);
    }
  },
  selectAllElements: {
    id: "selectAllElements",
    label: "すべての要素を選択",
    palette: { order: 25.5, keywords: ["select", "select all", "all", "全選択", "すべて", "要素"] },
    run: () => selectAllElements()
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
      moveElementToInsertionIndex(
        context.elementId,
        context.insertionIndex,
        context.targetParentGroupId
      );
    }
  },
  setEvaluationLimitIndex: {
    id: "setEvaluationLimitIndex",
    label: "評価区切り線を移動",
    run: (context) => {
      if (context?.evaluationLimitIndex === undefined) return;
      setEvaluationLimitIndex(context.evaluationLimitIndex);
    }
  },
  openSelectionColorPicker: {
    id: "openSelectionColorPicker",
    label: "選択範囲の表示色を一括変更",
    palette: {
      order: 46,
      keywords: ["color", "selection", "batch", "表示色", "色", "選択範囲", "一括"]
    },
    run: () => {
      useCadUiStore.setState({
        showSelectionColorPicker: true,
        showCommandPalette: false
      });
    }
  },
  closeSelectionColorPicker: {
    id: "closeSelectionColorPicker",
    label: "選択範囲の表示色選択を閉じる",
    run: () => useCadUiStore.getState().setShowSelectionColorPicker(false)
  },
  applyDisplayColorToSelection: {
    id: "applyDisplayColorToSelection",
    label: "選択範囲へ表示色を適用",
    run: (context) => applyDisplayColorToSelection(context?.colorId)
  },
  moveEvaluationDividerUp: {
    id: "moveEvaluationDividerUp",
    label: "評価区切り線を上へ",
    palette: { order: 30, keywords: ["evaluation", "divider", "評価", "区切り", "上"] },
    shortcuts: [{ keys: "Shift+Alt+ArrowUp" }],
    run: () => moveEvaluationDividerByOffset(-1)
  },
  moveEvaluationDividerDown: {
    id: "moveEvaluationDividerDown",
    label: "評価区切り線を下へ",
    palette: { order: 31, keywords: ["evaluation", "divider", "評価", "区切り", "下"] },
    shortcuts: [{ keys: "Shift+Alt+ArrowDown" }],
    run: () => moveEvaluationDividerByOffset(1)
  },
  moveEvaluationDividerToSelectedElement: {
    id: "moveEvaluationDividerToSelectedElement",
    label: "評価区切り線を選択要素の下へ",
    palette: { order: 32, keywords: ["evaluation", "divider", "selected", "評価", "区切り", "選択"] },
    run: () => moveEvaluationDividerToSelectedElement()
  },
  moveEvaluationDividerToEnd: {
    id: "moveEvaluationDividerToEnd",
    label: "評価区切り線を末尾へ",
    palette: { order: 33, keywords: ["evaluation", "divider", "end", "評価", "区切り", "末尾", "全件"] },
    run: () => moveEvaluationDividerToEnd()
  },
  groupSelectedElements: {
    id: "groupSelectedElements",
    label: "選択要素をグループ化",
    palette: { order: 34, keywords: ["group", "folder", "グループ", "まとめる"] },
    shortcuts: [{ keys: "Mod+G" }],
    run: (context) => groupSelectedElements(context)
  },
  addGroup: {
    id: "addGroup",
    label: "グループを追加",
    palette: { order: 34.1, keywords: ["group", "folder", "empty", "グループ", "フォルダ", "追加", "空"] },
    run: (context) => addGroup(context)
  },
  addConditionalGroup: {
    id: "addConditionalGroup",
    label: "ifブロックを追加",
    palette: { order: 34.2, keywords: ["if", "condition", "conditional", "条件", "分岐", "追加"] },
    shortcuts: [{ keys: "Alt+I" }],
    run: (context) => addConditionalGroup(context)
  },
  wrapSelectedElementsInConditionalGroup: {
    id: "wrapSelectedElementsInConditionalGroup",
    label: "選択範囲をifで囲む",
    palette: { order: 34.4, keywords: ["if", "wrap", "condition", "条件", "分岐", "囲む"] },
    shortcuts: [{ keys: "Shift+Alt+I" }],
    run: (context) => wrapSelectedElementsInConditionalGroup(context)
  },
  addElseBranchToSelectedConditionalGroup: {
    id: "addElseBranchToSelectedConditionalGroup",
    label: "else枝を追加",
    palette: { order: 34.6, keywords: ["else", "if", "branch", "条件", "分岐", "追加"] },
    run: () => addElseBranchToSelectedConditionalGroup()
  },
  deleteElseBranchFromSelectedConditionalGroup: {
    id: "deleteElseBranchFromSelectedConditionalGroup",
    label: "else枝を削除",
    palette: {
      order: 34.8,
      keywords: ["else", "if", "branch", "条件", "分岐", "削除"],
      isAvailable: selectedConditionalGroupHasElseBranch
    },
    run: () => deleteElseBranchFromSelectedConditionalGroup()
  },
  addForGroup: {
    id: "addForGroup",
    label: "forブロックを追加",
    palette: { order: 34.9, keywords: ["for", "loop", "repeat", "繰り返し", "追加"] },
    shortcuts: [{ keys: "Alt+F" }],
    run: (context) => addForGroup(context)
  },
  wrapSelectedElementsInForGroup: {
    id: "wrapSelectedElementsInForGroup",
    label: "選択範囲をforで囲む",
    palette: { order: 34.95, keywords: ["for", "loop", "wrap", "繰り返し", "囲む"] },
    shortcuts: [{ keys: "Shift+Alt+F" }],
    run: (context) => wrapSelectedElementsInForGroup(context)
  },
  toggleSelectedForGroupGenerated: {
    id: "toggleSelectedForGroupGenerated",
    label: "for生成結果を表示/非表示",
    palette: { order: 34.98, keywords: ["for", "generated", "preview", "生成", "表示"] },
    run: () => toggleSelectedForGroupGenerated()
  },
  ungroupSelectedGroup: {
    id: "ungroupSelectedGroup",
    label: "選択グループを解除",
    palette: { order: 35, keywords: ["ungroup", "group", "解除", "グループ"] },
    shortcuts: [{ keys: "Mod+Shift+G" }],
    run: () => ungroupSelectedGroup()
  },
  toggleGroupExpanded: {
    id: "toggleGroupExpanded",
    label: "グループを開閉",
    palette: { order: 36, keywords: ["group", "expand", "collapse", "開閉", "折り畳み"] },
    shortcuts: [{ keys: "ArrowRight" }],
    run: (context) => toggleGroupExpanded(context?.elementId)
  },
  indentSelectedElements: {
    id: "indentSelectedElements",
    label: "選択要素をインデント",
    palette: { order: 37, keywords: ["indent", "group", "入れ子", "インデント"] },
    shortcuts: [{ keys: "]" }],
    run: () => indentSelectedElements()
  },
  outdentSelectedElements: {
    id: "outdentSelectedElements",
    label: "選択要素をアウトデント",
    palette: { order: 38, keywords: ["outdent", "group", "解除", "アウトデント"] },
    shortcuts: [{ keys: "[" }],
    run: () => outdentSelectedElements()
  },
  selectParentGroup: {
    id: "selectParentGroup",
    label: "親グループを選択",
    palette: { order: 39, keywords: ["parent", "group", "親", "グループ"] },
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
  toggleElementLocked: {
    id: "toggleElementLocked",
    label: "要素のロックを切替",
    run: (context) => toggleElementLocked(context?.elementId)
  },
  toggleGroupPrintEnabled: {
    id: "toggleGroupPrintEnabled",
    label: "グループの印刷する/しないを切替",
    run: (context) => toggleGroupPrintEnabled(context?.elementId)
  },
  toggleSelectedGroupPrintEnabled: {
    id: "toggleSelectedGroupPrintEnabled",
    label: "選択グループの印刷する/しないを切替",
    palette: { order: 41.75, keywords: ["print", "印刷", "group", "グループ"] },
    run: () => toggleSelectedGroupPrintEnabled()
  },
  toggleSelectedElementVisibility: {
    id: "toggleSelectedElementVisibility",
    label: "表示/非表示を切替",
    palette: { order: 40, keywords: ["visibility", "visible", "hide", "show", "表示", "非表示"] },
    shortcuts: [{ keys: "v" }],
    run: () => toggleSelectedElementsBooleanProperty("visible")
  },
  toggleSelectedElementEnabled: {
    id: "toggleSelectedElementEnabled",
    label: "評価する/しないを切替",
    palette: { order: 41, keywords: ["enabled", "active", "evaluate", "評価", "有効", "無効"] },
    shortcuts: [{ keys: "a" }],
    run: () => toggleSelectedElementsBooleanProperty("enabled")
  },
  toggleSelectedElementLocked: {
    id: "toggleSelectedElementLocked",
    label: "ロック/解除を切替",
    palette: { order: 41.5, keywords: ["lock", "unlock", "ロック", "解除", "保護"] },
    run: () => toggleSelectedElementsLocked()
  },
  duplicateSelectedElement: {
    id: "duplicateSelectedElement",
    label: "選択要素を複製",
    palette: { order: 42, keywords: ["duplicate", "copy", "複製", "コピー"] },
    shortcuts: [{ keys: "Mod+D" }],
    run: () => {
      const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
      const selectedIds = getSelectedElementIds();
      const indexes = selectedIndexes(
        elements,
        selectedIds.flatMap((id) => subtreeIdsForElement(elements, id))
      );
      const change = duplicateElements(elements, getSelectedElementIds());
      if (!change) return;
      useCadDocumentStore.getState().commitDocumentChange({
        ...change,
        evaluationLimitIndex: adjustEvaluationLimitForInsertion({
          elements,
          evaluationLimitIndex,
          insertionIndex: (indexes.at(-1) ?? -1) + 1,
          insertedCount: change.selectedElementIds.length
        })
      });
    }
  },
  deleteSelectedElement: {
    id: "deleteSelectedElement",
    label: "選択要素を削除",
    palette: {
      order: 34.7,
      keywords: ["delete", "remove", "削除"],
      isAvailable: hasSelection
    },
    shortcuts: [{ keys: "d / Delete / Backspace" }],
    run: () => {
      const { elements, evaluationLimitIndex } = useCadDocumentStore.getState();
      const selectedIds = new Set(
        getSelectedElementIds().flatMap((id) => subtreeIdsForElement(elements, id))
      );
      const protectedIds = protectedElementIdsForDestructiveChange(elements, selectedIds);
      if (protectedIds.size > 0) {
        useCadUiStore
          .getState()
          .setCommandErrorMessage("ロックされた要素が含まれるため、削除できません。");
        return;
      }
      const indexes = selectedIndexes(elements, [...selectedIds]);
      if (indexes.length === 0) return;
      const index = indexes[0];
      const nextElements = elements.filter((element) => !selectedIds.has(element.id));
      const nextSelectedElementId = nextElements[Math.min(index, nextElements.length - 1)]?.id ?? null;
      useCadDocumentStore.getState().commitDocumentChange({
        elements: nextElements,
        evaluationLimitIndex: adjustEvaluationLimitForDeletion({
          elements,
          evaluationLimitIndex,
          deletedIds: selectedIds
        }),
        selectedElementId: nextSelectedElementId,
        selectedElementIds: nextSelectedElementId ? [nextSelectedElementId] : [],
        selectionAnchorElementId: nextSelectedElementId
      });
    }
  }
} satisfies Partial<Record<CommandId, Command>>;
