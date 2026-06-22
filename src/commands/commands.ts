import { useCadStore } from "../state/useCadStore";
import { selectedIndexes } from "../model/documentSelection";
import { subtreeIdsForElement } from "../model/groups";
import { normalizeParameterKey } from "../parameters/parameterDefinitions";
import { filterCommandPaletteItems as filterPaletteItems, paletteCommandIds, paletteKeywords } from "./commandPalette";
import {
  getSelectedElement,
  getSelectedElementIds,
  selectedParameterDefinition
} from "./commandRuntime";
import {
  addElement,
  addIntersectionPoint,
  addLineDivisionPoint,
  addLineTangentOffsetPoint,
  addOffsetLine
} from "./elementCreationCommands";
import { moveBezierHandleByDelta, movePointElementByDelta } from "./geometryEditCommands";
import {
  addBezierIntermediatePoint,
  addNumericVariable,
  applyParameterDirectKey,
  cycleReferenceParameter,
  deleteBezierIntermediatePoint,
  deleteNumericVariable,
  selectParameterByOffset,
  setSelectedPointAnchorMode,
  toggleBooleanParameter,
  toggleBooleanParameterByDirectKey,
  toggleSelectedParameterValue,
  toggleSelectedPointAnchorMode,
  updateNumericParameter,
  updateSelectedNumericParameterStep
} from "./parameterCommands";
import {
  applyNumericExpressionReference,
  applyPickedLine,
  applyPickedNumericReference,
  applyPickedPoint,
  applySelectedPickCandidate,
  cancelLinePick,
  cancelNumericReferencePick,
  cancelPointPick,
  selectPickCandidateByOffset,
  selectPickOptionByOffset,
  startLinePick,
  startNumericReferencePick,
  startPointPick
} from "./pickCommands";
import {
  extendSelectionByOffset,
  groupSelectedElements,
  indentSelectedElements,
  jumpToSelectedDependencyTarget,
  moveElementToInsertionIndex,
  moveElementsToInsertionIndex,
  outdentSelectedElements,
  selectDependencyJumpTargetByOffset,
  selectElement,
  selectElementByOffset,
  selectParentGroup,
  selectedDependencyJumpTargets,
  toggleElementBooleanProperty,
  toggleGroupExpanded,
  toggleSelectedElementsBooleanProperty,
  ungroupSelectedGroup
} from "./selectionCommands";
import type { Command, CommandContext, CommandId } from "./commandTypes";
export type { BezierHandleRole, Command, CommandContext, CommandId } from "./commandTypes";
const canvasZoomAnchor = (context?: CommandContext) => {
  const rect = context?.getCanvasViewportRect?.();
  if (!rect) return undefined;
  return {
    x: rect.width / 2,
    y: rect.height / 2,
    width: rect.width,
    height: rect.height
  };
};

export const commands: Record<CommandId, Command> = {
  undo: {
    id: "undo",
    label: "元に戻す",
    run: () => useCadStore.getState().undo()
  },
  redo: {
    id: "redo",
    label: "やり直す",
    run: () => useCadStore.getState().redo()
  },
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
  applyNumericExpressionReference: {
    id: "applyNumericExpressionReference",
    label: "数値参照式を採用",
    run: (context) => applyNumericExpressionReference(context)
  },
  startNumericReferencePick: {
    id: "startNumericReferencePick",
    label: "数値選択モードに入る",
    run: () => startNumericReferencePick()
  },
  applyPickedNumericReference: {
    id: "applyPickedNumericReference",
    label: "選択した数値を設定",
    run: (context) => applyPickedNumericReference(context)
  },
  cancelNumericReferencePick: {
    id: "cancelNumericReferencePick",
    label: "数値選択をキャンセル",
    run: () => cancelNumericReferencePick()
  },
  selectNextPickCandidate: {
    id: "selectNextPickCandidate",
    label: "次の選択候補へ",
    run: () => selectPickCandidateByOffset(1)
  },
  selectPreviousPickCandidate: {
    id: "selectPreviousPickCandidate",
    label: "前の選択候補へ",
    run: () => selectPickCandidateByOffset(-1)
  },
  selectNextPickOption: {
    id: "selectNextPickOption",
    label: "行内の次の候補へ",
    run: () => selectPickOptionByOffset(1)
  },
  selectPreviousPickOption: {
    id: "selectPreviousPickOption",
    label: "行内の前の候補へ",
    run: () => selectPickOptionByOffset(-1)
  },
  applySelectedPickCandidate: {
    id: "applySelectedPickCandidate",
    label: "選択候補を確定",
    run: () => applySelectedPickCandidate()
  },
  startPointPick: {
    id: "startPointPick",
    label: "点を選択して参照に設定",
    run: () => startPointPick()
  },
  applyPickedPoint: {
    id: "applyPickedPoint",
    label: "選択した点を参照に設定",
    run: (context) => applyPickedPoint(context)
  },
  cancelPointPick: {
    id: "cancelPointPick",
    label: "点選択をキャンセル",
    run: () => cancelPointPick()
  },
  startLinePick: {
    id: "startLinePick",
    label: "線を選択して基準線に追加",
    run: () => startLinePick()
  },
  applyPickedLine: {
    id: "applyPickedLine",
    label: "選択した線を基準線に追加",
    run: (context) => applyPickedLine(context)
  },
  cancelLinePick: {
    id: "cancelLinePick",
    label: "線選択をキャンセル",
    run: () => cancelLinePick()
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
  },
  addFreePoint: {
    id: "addFreePoint",
    label: "free point を追加",
    run: () => addElement("freePoint")
  },
  addOffsetPoint: {
    id: "addOffsetPoint",
    label: "offset point を追加",
    run: () => addElement("offsetPoint")
  },
  addPolarOffsetPoint: {
    id: "addPolarOffsetPoint",
    label: "polar offset point を追加",
    run: () => addElement("polarOffsetPoint")
  },
  addDivisionPoint: {
    id: "addDivisionPoint",
    label: "点間分点を追加",
    run: () => addElement("divisionPoint")
  },
  addLineDivisionPoint: {
    id: "addLineDivisionPoint",
    label: "線上分点を追加",
    run: () => addLineDivisionPoint()
  },
  addIntersectionPoint: {
    id: "addIntersectionPoint",
    label: "交点を追加",
    run: () => addIntersectionPoint()
  },
  addLineTangentOffsetPoint: {
    id: "addLineTangentOffsetPoint",
    label: "線上オフセット点を追加",
    run: () => addLineTangentOffsetPoint()
  },
  addLine: {
    id: "addLine",
    label: "line を追加",
    run: () => addElement("line")
  },
  addArcLine: {
    id: "addArcLine",
    label: "円弧線を追加",
    run: () => addElement("arcLine")
  },
  addThreePointArcLine: {
    id: "addThreePointArcLine",
    label: "三点円弧線を追加",
    run: () => addElement("threePointArcLine")
  },
  addBezierCurve: {
    id: "addBezierCurve",
    label: "Bezier curve を追加",
    run: () => addElement("bezierCurve")
  },
  addOffsetLine: {
    id: "addOffsetLine",
    label: "オフセット線を追加",
    run: () => addOffsetLine()
  },
  addNumericVariable: {
    id: "addNumericVariable",
    label: "共通変数を追加",
    run: () => addNumericVariable()
  },
  deleteNumericVariable: {
    id: "deleteNumericVariable",
    label: "共通変数を削除",
    run: (context) => deleteNumericVariable(context?.variableId)
  },
  addBezierNumericVariable: {
    id: "addBezierNumericVariable",
    label: "曲線の共通変数を追加",
    run: () => addNumericVariable()
  },
  deleteBezierNumericVariable: {
    id: "deleteBezierNumericVariable",
    label: "曲線の共通変数を削除",
    run: (context) => deleteNumericVariable(context?.variableId)
  },
  addBezierIntermediatePoint: {
    id: "addBezierIntermediatePoint",
    label: "曲線の中間点を追加",
    run: () => addBezierIntermediatePoint()
  },
  deleteBezierIntermediatePoint: {
    id: "deleteBezierIntermediatePoint",
    label: "曲線の中間点を削除",
    run: (context) => deleteBezierIntermediatePoint(context?.intermediatePointId)
  },
  zoomInCanvas: {
    id: "zoomInCanvas",
    label: "キャンバスを拡大",
    run: (context) => useCadStore.getState().zoomCanvasViewportAt(1.1, canvasZoomAnchor(context))
  },
  zoomOutCanvas: {
    id: "zoomOutCanvas",
    label: "キャンバスを縮小",
    run: (context) => useCadStore.getState().zoomCanvasViewportAt(1 / 1.1, canvasZoomAnchor(context))
  },
  resetCanvasView: {
    id: "resetCanvasView",
    label: "キャンバス表示をリセット",
    run: () => useCadStore.getState().resetCanvasViewport()
  },
  openCommandPalette: {
    id: "openCommandPalette",
    label: "コマンドパレットを開く",
    run: () => useCadStore.setState({ showCommandPalette: true })
  },
  closeCommandPalette: {
    id: "closeCommandPalette",
    label: "コマンドパレットを閉じる",
    run: () => useCadStore.setState({ showCommandPalette: false })
  },
  focusCanvas: {
    id: "focusCanvas",
    label: "キャンバスへフォーカス",
    run: (context) => context?.focusCanvas?.()
  },
  focusElementList: {
    id: "focusElementList",
    label: "要素リストへフォーカス",
    run: (context) => context?.focusElementList?.()
  },
  focusElementSearch: {
    id: "focusElementSearch",
    label: "要素検索へフォーカス",
    run: (context) => context?.focusElementSearch?.()
  },
  enterElementListMode: {
    id: "enterElementListMode",
    label: "構成リストモードに入る",
    run: (context) => {
      useCadStore.setState({
        isParameterEditMode: false,
        isDependencyJumpMode: false,
        selectedDependencyJumpIndex: 0
      });
      context?.focusElementList?.();
    }
  },
  toggleShortcutHelp: {
    id: "toggleShortcutHelp",
    label: "ショートカット一覧を表示/非表示",
    run: () => {
      const { showShortcutHelp } = useCadStore.getState();
      useCadStore.setState({ showShortcutHelp: !showShortcutHelp });
    }
  },
  toggleElementInfoPanel: {
    id: "toggleElementInfoPanel",
    label: "要素詳細を表示/非表示",
    run: () => {
      const { showElementInfoPanel } = useCadStore.getState();
      useCadStore.setState({
        showElementInfoPanel: !showElementInfoPanel,
        isDependencyJumpMode: showElementInfoPanel ? false : useCadStore.getState().isDependencyJumpMode
      });
    }
  },
  enterDependencyJumpMode: {
    id: "enterDependencyJumpMode",
    label: "親子要素ジャンプモードに入る",
    run: () => {
      cancelPointPick();
      cancelNumericReferencePick();
      cancelLinePick();
      const targets = selectedDependencyJumpTargets();
      if (targets.length === 0) return;
      useCadStore.setState({
        showElementInfoPanel: true,
        isParameterEditMode: false,
        isDependencyJumpMode: true,
        selectedDependencyJumpIndex: 0
      });
    }
  },
  exitDependencyJumpMode: {
    id: "exitDependencyJumpMode",
    label: "親子要素ジャンプモードを終了",
    run: () => useCadStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 })
  },
  selectNextDependencyJumpTarget: {
    id: "selectNextDependencyJumpTarget",
    label: "次の親子要素を選択",
    run: () => selectDependencyJumpTargetByOffset(1)
  },
  selectPreviousDependencyJumpTarget: {
    id: "selectPreviousDependencyJumpTarget",
    label: "前の親子要素を選択",
    run: () => selectDependencyJumpTargetByOffset(-1)
  },
  jumpToSelectedDependencyTarget: {
    id: "jumpToSelectedDependencyTarget",
    label: "選択中の親子要素へジャンプ",
    run: () => jumpToSelectedDependencyTarget()
  },
  enterParameterEditMode: {
    id: "enterParameterEditMode",
    label: "パラメーター編集モードに入る",
    run: () => {
      const selectedElement = getSelectedElement();
      if (!selectedElement) return;
      useCadStore.setState({
        isParameterEditMode: true,
        isDependencyJumpMode: false,
        selectedParameterKey: normalizeParameterKey(
          selectedElement,
          useCadStore.getState().selectedParameterKey
        )
      });
    }
  },
  exitParameterEditMode: {
    id: "exitParameterEditMode",
    label: "パラメーター編集モードを終了",
    run: () => useCadStore.setState({ isParameterEditMode: false })
  },
  selectNextParameter: {
    id: "selectNextParameter",
    label: "次のパラメーターを選択",
    run: () => selectParameterByOffset(1)
  },
  selectPreviousParameter: {
    id: "selectPreviousParameter",
    label: "前のパラメーターを選択",
    run: () => selectParameterByOffset(-1)
  },
  selectParameterByKey: {
    id: "selectParameterByKey",
    label: "キーでパラメーターを選択",
    run: (context) =>
      applyParameterDirectKey(context?.parameterDirectKey, context?.focusSelectedParameterInput)
  },
  incrementSelectedParameter: {
    id: "incrementSelectedParameter",
    label: "選択パラメーターを増やす",
    run: (context) => updateNumericParameter(1, context)
  },
  decrementSelectedParameter: {
    id: "decrementSelectedParameter",
    label: "選択パラメーターを減らす",
    run: (context) => updateNumericParameter(-1, context)
  },
  increaseSelectedParameterStep: {
    id: "increaseSelectedParameterStep",
    label: "増減単位を大きくする",
    run: () => updateSelectedNumericParameterStep(1)
  },
  decreaseSelectedParameterStep: {
    id: "decreaseSelectedParameterStep",
    label: "増減単位を小さくする",
    run: () => updateSelectedNumericParameterStep(-1)
  },
  cycleSelectedReferenceForward: {
    id: "cycleSelectedReferenceForward",
    label: "参照パラメーターを次へ",
    run: () => cycleReferenceParameter(1)
  },
  cycleSelectedReferenceBackward: {
    id: "cycleSelectedReferenceBackward",
    label: "参照パラメーターを前へ",
    run: () => cycleReferenceParameter(-1)
  },
  toggleSelectedParameterValue: {
    id: "toggleSelectedParameterValue",
    label: "選択パラメーターを切替",
    run: () => toggleSelectedParameterValue()
  },
  toggleSelectedPointAnchorMode: {
    id: "toggleSelectedPointAnchorMode",
    label: "点指定方法を切替",
    run: (context) => toggleSelectedPointAnchorMode(context)
  },
  setSelectedPointAnchorReferenceMode: {
    id: "setSelectedPointAnchorReferenceMode",
    label: "点指定を既存点にする",
    run: (context) => setSelectedPointAnchorMode("reference", context)
  },
  setSelectedPointAnchorCoordinateMode: {
    id: "setSelectedPointAnchorCoordinateMode",
    label: "点指定を座標にする",
    run: (context) => setSelectedPointAnchorMode("coordinate", context)
  },
  toggleSelectedBooleanParameter: {
    id: "toggleSelectedBooleanParameter",
    label: "真偽値パラメーターを切替",
    run: () => toggleBooleanParameter()
  },
  toggleBooleanParameterByDirectKey: {
    id: "toggleBooleanParameterByDirectKey",
    label: "キーに対応する真偽値パラメーターを切替",
    run: (context) => toggleBooleanParameterByDirectKey(context?.parameterDirectKey)
  },
  activateSelectedParameter: {
    id: "activateSelectedParameter",
    label: "選択パラメーターを実行",
    run: (context) => {
      const definition = selectedParameterDefinition();
      if (definition?.kind === "reference") {
        startPointPick();
        return;
      }
      if (definition?.kind === "lineReferenceList") {
        startLinePick();
        return;
      }
      if (definition?.kind === "lineReference") {
        startLinePick();
        return;
      }
      if (definition?.kind === "lineEndpointReference") {
        startPointPick();
        return;
      }
      if (definition?.kind === "number") {
        startNumericReferencePick();
        return;
      }
      context?.focusSelectedParameterInput?.();
    }
  },
  focusSelectedParameterInput: {
    id: "focusSelectedParameterInput",
    label: "選択パラメーターの入力欄へフォーカス",
    run: (context) => commands.activateSelectedParameter.run(context)
  }
};

export const dispatchCommand = (commandId: CommandId, context?: CommandContext) => {
  commands[commandId].run(context);
};

export { paletteCommandIds, paletteKeywords } from "./commandPalette";
export type { CommandPaletteItem } from "./commandPalette";

export const commandPaletteItems = paletteCommandIds.map((commandId) => ({
  commandId,
  label: commands[commandId].label,
  keywords: paletteKeywords[commandId] ?? []
}));

export const filterCommandPaletteItems = (query: string) => filterPaletteItems(commandPaletteItems, query);
