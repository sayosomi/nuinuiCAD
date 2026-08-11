import { selectedIndexes } from "../model/documentSelection";
import { duplicateElements } from "../model/elementDuplication";
import {
  adjustEvaluationLimitForDeletion,
  adjustEvaluationLimitForInsertion
} from "../model/evaluationDivider";
import { isConditionalGroupElement, subtreeIdsForElement } from "../model/groups";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { moveBezierHandleByDelta, movePointElementByDelta } from "./geometryEditCommands";
import { getSelectedElement, getSelectedElementIds } from "./commandRuntime";
import { commitDocumentChangeAndSelect } from "./commitDocumentChangeAndSelect";
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
  cycleElementActivity,
  setElementActivity,
  setElementsActivity,
  toggleGroupPrintEnabled,
  toggleSelectedGroupPrintEnabled,
  toggleGroupExpanded,
  ungroupSelectedGroup
} from "./selectionCommands";
import { addContainer } from "./containerCreation";
import type { Command, CommandContext, CommandId } from "./commandTypes";
import { applyCreationPlacement, creationPlacementForTarget } from "../model/elementCreationPlacement";
import { createCadElement } from "../model/elementFactory";
import { setParameterValue } from "../parameters/parameterAccess";
import { commitSourceCreationInsertion } from "./sourceCreationCommit";
import { resolveSourceCreationInsertion } from "./sourceCreationInsertion";

const reverseEligible = () => {
  const selected = getSelectedElement();
  if (!selected || getSelectedElementIds().length !== 1) return null;
  if (![
    "line", "angleLengthLine", "arcLine", "threePointArcLine", "cornerRadiusArcLine",
    "bezierCurve", "offsetLine", "splitLine", "copyLine", "symmetricCopyLine"
  ].includes(selected.type)) return null;
  return selected;
};

/** Inserts a `reverse(target: …)` element immediately after the selected
 * line, through the same source-backed creation path every other element
 * creation command uses (see containerCreation.ts's addContainer) - no
 * hand-written statement text. A reversal inside a forGroup is a normal
 * element there like any other; pathReverseEvaluator.ts (TS) and
 * path_reverse_evaluator.rs (Rust) reject it at evaluation time when the
 * target is outside any forGroup that contains the reverse statement.
 * A target inside all of the reverse statement's enclosing forGroups remains
 * valid, including a target declared in the same nested loop. */
const insertReverseAfterSelectedPath = () => {
  const selected = reverseEligible();
  const document = useCadDocumentStore.getState();
  if (!selected || document.doc.majorVersion !== 3 || document.docText !== document.sourceText) {
    useCadUiStore.getState().setCommandErrorMessage("nui 3 の線を1件選択してから実行してください。");
    return false;
  }
  const sourceInsertion = resolveSourceCreationInsertion({
    cursor: {
      sourceRevision: document.sourceRevision,
      line: 0,
      lineCount: document.sourceText.split("\n").length,
      elementId: selected.id
    },
    sourceRevision: document.sourceRevision,
    elements: document.elements,
    statementMap: document.doc.statementMap
  });
  if (!sourceInsertion) {
    useCadUiStore.getState().setCommandErrorMessage("反転の挿入位置を特定できませんでした。");
    return false;
  }
  const placement = creationPlacementForTarget(document.elements, sourceInsertion.insertionTarget, document.evaluationLimitIndex);
  const reversal = applyCreationPlacement(
    setParameterValue(
      createCadElement("pathReverse", document.elements, { referenceElements: placement.referenceElements }),
      "targetLineId",
      selected.id
    ),
    placement
  );
  const sourceCommit = commitSourceCreationInsertion({
    elements: document.elements,
    insertionIndex: placement.insertionIndex,
    insertedElements: [reversal],
    sourceInsertionLine: sourceInsertion.sourceInsertionLine
  });
  if (sourceCommit.result.status !== "applied" || !sourceCommit.selectedElementId) {
    useCadUiStore.getState().setCommandErrorMessage("反転の挿入に失敗しました。");
    return false;
  }
  useCadUiStore.getState().applySelection(useCadDocumentStore.getState().elements, {
    selectedElementId: sourceCommit.selectedElementId,
    selectedElementIds: sourceCommit.insertedElementIds,
    selectionAnchorElementId: sourceCommit.selectedElementId
  });
  useCadUiStore.getState().setCommandErrorMessage(null);
  return true;
};

const hasSelection = () => getSelectedElementIds().length > 0;

const selectedRenameTargetId = () => {
  const selectedIds = getSelectedElementIds();
  if (selectedIds.length !== 1) return null;
  const targetId = selectedIds[0];
  return useCadDocumentStore.getState().elements.some((element) => element.id === targetId)
    ? targetId
    : null;
};

const openRenameElementPrompt = () => {
  const targetId = selectedRenameTargetId();
  if (!targetId) {
    useCadUiStore.getState().setCommandErrorMessage(
      getSelectedElementIds().length === 1
        ? "リネーム対象の要素が見つかりません。もう一度選択してください。"
        : "リネームする要素を1件だけ選択してください。"
    );
    return false;
  }
  useCadUiStore.setState({
    renameElementPromptTargetId: targetId,
    commandErrorMessage: null,
    showCommandPalette: false
  });
  return true;
};

/**
 * F2 dispatch entry point. A typed binding under the Source Editor cursor
 * (declaration/reference/set target/template hole - see
 * typedRenameTargetAtCursor.ts) takes priority over CAD element selection,
 * since the cursor is the more specific signal of what the user is renaming;
 * a typed target only ever comes from `context.currentCursorTypedRenameTargetBindingId`,
 * which is null whenever the cursor is not on a typed construct at all, so
 * ordinary CAD element rename (via Canvas selection or a Source Editor
 * cursor parked on an element statement) is completely unaffected.
 */
const openRenameSelectedElementPrompt = (context?: CommandContext) => {
  const moduleTarget = context?.currentCursorModuleSemanticTarget?.();
  if (moduleTarget) {
    useCadUiStore.setState({
      renameModuleSemanticPromptTarget: moduleTarget,
      commandErrorMessage: null,
      showCommandPalette: false
    });
    return true;
  }
  const typedBindingId = context?.currentCursorTypedRenameTargetBindingId?.();
  if (typedBindingId) {
    useCadUiStore.setState({
      renameTypedBindingPromptTargetId: typedBindingId,
      commandErrorMessage: null,
      showCommandPalette: false
    });
    return true;
  }
  return openRenameElementPrompt();
};

const selectedConditionalGroupHasElseBranch = () => {
  const selectedElement = getSelectedElement();
  if (!selectedElement || !isConditionalGroupElement(selectedElement)) return false;
  const { elements } = useCadDocumentStore.getState();
  return elements.some(
    (element) => element.parentGroupId === selectedElement.id && element.conditionalBranch === "else"
  );
};

export const selectionCommandDefinitions = {
  reverseSelectedPath: {
    id: "reverseSelectedPath",
    label: "選択中の線を反転",
    palette: { order: 39, keywords: ["reverse", "flip", "反転", "線", "曲線"], isAvailable: () => Boolean(reverseEligible()) },
    run: insertReverseAfterSelectedPath
  },
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
    run: (context) => {
      const { elements } = useCadDocumentStore.getState();
      const selectedIds = context?.moveCursorElementOnly && context.elementId
        ? [context.elementId]
        : getSelectedElementIds();
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
    run: (context) => {
      const { elements } = useCadDocumentStore.getState();
      const selectedIds = context?.moveCursorElementOnly && context.elementId
        ? [context.elementId]
        : getSelectedElementIds();
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
  renameSelectedElement: {
    id: "renameSelectedElement",
    label: "選択要素の名前を変更",
    palette: {
      order: 26.5,
      keywords: ["rename", "name", "リネーム", "名前", "変更", "選択要素"],
      isAvailable: () => Boolean(selectedRenameTargetId())
    },
    shortcuts: [{ keys: "F2" }],
    flushPolicy: "editor-owned",
    run: (context) => openRenameSelectedElementPrompt(context)
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
    run: (context) => addContainer("group", context)
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
  cycleElementActivity: {
    id: "cycleElementActivity",
    label: "要素のactivityを切替",
    run: (context) => cycleElementActivity(context?.elementId)
  },
  setElementActivity: {
    id: "setElementActivity",
    label: "要素のactivityを設定",
    run: (context) => {
      if (!context?.activity) return;
      setElementActivity(context.elementId, context.activity);
    }
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
  setSelectedElementsVisible: {
    id: "setSelectedElementsVisible",
    label: "選択要素を表示にする",
    palette: { order: 40, keywords: ["visibility", "visible", "show", "表示"] },
    run: () => setElementsActivity("visible")
  },
  setSelectedElementsHidden: {
    id: "setSelectedElementsHidden",
    label: "選択要素を非表示にする",
    palette: { order: 40.5, keywords: ["visibility", "hidden", "hide", "非表示"] },
    run: () => setElementsActivity("hidden")
  },
  setSelectedElementsDisabled: {
    id: "setSelectedElementsDisabled",
    label: "選択要素を評価しないにする",
    palette: { order: 41, keywords: ["enabled", "disabled", "evaluate", "評価", "無効"] },
    run: () => setElementsActivity("disabled")
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
      commitDocumentChangeAndSelect({
        elements: change.elements,
        evaluationLimitIndex: adjustEvaluationLimitForInsertion({
          elements,
          evaluationLimitIndex,
          insertionIndex: (indexes.at(-1) ?? -1) + 1,
          insertedCount: change.selectedElementIds.length
        })
      }, change);
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
      const indexes = selectedIndexes(elements, [...selectedIds]);
      if (indexes.length === 0) return;
      const index = indexes[0];
      const nextElements = elements.filter((element) => !selectedIds.has(element.id));
      const nextSelectedElementId = nextElements[Math.min(index, nextElements.length - 1)]?.id ?? null;
      commitDocumentChangeAndSelect({
        elements: nextElements,
        evaluationLimitIndex: adjustEvaluationLimitForDeletion({
          elements,
          evaluationLimitIndex,
          deletedIds: selectedIds
        })
      }, {
        selectedElementId: nextSelectedElementId,
        selectedElementIds: nextSelectedElementId ? [nextSelectedElementId] : [],
        selectionAnchorElementId: nextSelectedElementId
      });
    }
  }
} satisfies Partial<Record<CommandId, Command>>;
