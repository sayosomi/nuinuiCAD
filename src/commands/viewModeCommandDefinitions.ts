import { normalizeParameterKey } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { getSelectedElement } from "./commandRuntime";
import {
  jumpToSelectedDependencyTarget,
  selectDependencyJumpTargetByOffset,
  selectedDependencyJumpTargets
} from "./selectionCommands";
import { cancelLinePick, cancelNumericReferencePick, cancelPointPick } from "./pickCommands";
import type { Command, CommandContext, CommandId } from "./commandTypes";

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

export const viewModeCommandDefinitions = {
  undo: {
    id: "undo",
    label: "元に戻す",
    palette: { order: 24, keywords: ["undo", "戻す"] },
    shortcuts: [{ keys: "Mod+Z" }],
    run: () => useCadDocumentStore.getState().undo()
  },
  redo: {
    id: "redo",
    label: "やり直す",
    palette: { order: 25, keywords: ["redo", "やり直す"] },
    shortcuts: [{ keys: "Mod+Y" }],
    run: () => useCadDocumentStore.getState().redo()
  },
  zoomInCanvas: {
    id: "zoomInCanvas",
    label: "キャンバスを拡大",
    palette: { order: 21, keywords: ["zoom", "in", "拡大", "キャンバス"] },
    shortcuts: [{ keys: "+ / =" }],
    run: (context) => useCadUiStore.getState().zoomCanvasViewportAt(1.1, canvasZoomAnchor(context))
  },
  zoomOutCanvas: {
    id: "zoomOutCanvas",
    label: "キャンバスを縮小",
    palette: { order: 22, keywords: ["zoom", "out", "縮小", "キャンバス"] },
    shortcuts: [{ keys: "-" }],
    run: (context) => useCadUiStore.getState().zoomCanvasViewportAt(1 / 1.1, canvasZoomAnchor(context))
  },
  resetCanvasView: {
    id: "resetCanvasView",
    label: "キャンバス表示をリセット",
    palette: { order: 23, keywords: ["zoom", "reset", "pan", "origin", "リセット", "原点", "キャンバス"] },
    shortcuts: [{ keys: "0" }],
    run: () => useCadUiStore.getState().resetCanvasViewport()
  },
  openCommandPalette: {
    id: "openCommandPalette",
    label: "コマンドパレットを開く",
    shortcuts: [{ keys: "/" }],
    run: () => useCadUiStore.getState().setShowCommandPalette(true)
  },
  closeCommandPalette: {
    id: "closeCommandPalette",
    label: "コマンドパレットを閉じる",
    run: () => useCadUiStore.getState().setShowCommandPalette(false)
  },
  openShortcutSettings: {
    id: "openShortcutSettings",
    label: "ショートカット設定を開く",
    palette: { order: 44, keywords: ["shortcut", "settings", "keymap", "ショートカット", "設定", "キー"] },
    run: () => {
      useCadUiStore.setState({
        showShortcutSettings: true,
        showShortcutHelp: false,
        showCommandPalette: false,
        shortcutSettingsError: null
      });
    }
  },
  closeShortcutSettings: {
    id: "closeShortcutSettings",
    label: "ショートカット設定を閉じる",
    run: () => useCadUiStore.getState().setShowShortcutSettings(false)
  },
  focusCanvas: {
    id: "focusCanvas",
    label: "キャンバスへフォーカス",
    palette: { order: 39, keywords: ["focus", "canvas", "キャンバス"] },
    run: (context) => context?.focusCanvas?.()
  },
  focusElementList: {
    id: "focusElementList",
    label: "要素リストへフォーカス",
    palette: { order: 40, keywords: ["focus", "element list", "構成リスト", "要素リスト"] },
    run: (context) => context?.focusElementList?.()
  },
  focusElementSearch: {
    id: "focusElementSearch",
    label: "要素検索へフォーカス",
    palette: { order: 41, keywords: ["focus", "find", "search", "element", "検索", "要素"] },
    shortcuts: [{ keys: "Mod+F", label: "要素検索へ移動" }],
    run: (context) => context?.focusElementSearch?.()
  },
  enterElementListMode: {
    id: "enterElementListMode",
    label: "構成リストモードに入る",
    palette: { order: 42, keywords: ["mode", "element list", "構成リスト", "要素リスト"] },
    shortcuts: [{ keys: "g" }],
    run: (context) => {
      useCadUiStore.setState({
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
    palette: { order: 43, keywords: ["shortcut", "help", "ショートカット", "ヘルプ"] },
    shortcuts: [{ keys: "?" }],
    run: () => {
      const { showShortcutHelp } = useCadUiStore.getState();
      useCadUiStore.getState().setShowShortcutHelp(!showShortcutHelp);
    }
  },
  toggleElementInfoPanel: {
    id: "toggleElementInfoPanel",
    label: "要素詳細を表示/非表示",
    palette: { order: 44, keywords: ["information", "info", "要素詳細", "折り畳み", "表示"] },
    shortcuts: [{ keys: "i" }],
    run: () => {
      const { showElementInfoPanel, isDependencyJumpMode } = useCadUiStore.getState();
      useCadUiStore.setState({
        showElementInfoPanel: !showElementInfoPanel,
        isDependencyJumpMode: showElementInfoPanel ? false : isDependencyJumpMode
      });
    }
  },
  enterDependencyJumpMode: {
    id: "enterDependencyJumpMode",
    label: "親子要素ジャンプモードに入る",
    palette: { order: 45, keywords: ["dependency", "parent", "child", "親子", "ジャンプ"] },
    shortcuts: [{ keys: "j", label: "親子ジャンプモードに入る" }],
    run: () => {
      cancelPointPick();
      cancelNumericReferencePick();
      cancelLinePick();
      const targets = selectedDependencyJumpTargets();
      if (targets.length === 0) return;
      useCadUiStore.setState({
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
    shortcuts: [{ keys: "Escape" }],
    run: () => useCadUiStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 })
  },
  selectNextDependencyJumpTarget: {
    id: "selectNextDependencyJumpTarget",
    label: "次の親子要素を選択",
    shortcuts: [{ keys: "ArrowDown" }],
    run: () => selectDependencyJumpTargetByOffset(1)
  },
  selectPreviousDependencyJumpTarget: {
    id: "selectPreviousDependencyJumpTarget",
    label: "前の親子要素を選択",
    shortcuts: [{ keys: "ArrowUp" }],
    run: () => selectDependencyJumpTargetByOffset(-1)
  },
  jumpToSelectedDependencyTarget: {
    id: "jumpToSelectedDependencyTarget",
    label: "選択中の親子要素へジャンプ",
    shortcuts: [{ keys: "Enter" }],
    run: () => jumpToSelectedDependencyTarget()
  },
  enterParameterEditMode: {
    id: "enterParameterEditMode",
    label: "パラメーター編集モードに入る",
    palette: { order: 46, keywords: ["parameter", "edit", "パラメーター", "編集"] },
    shortcuts: [{ keys: "e", label: "要素設定モードに入る" }, { keys: "Enter" }],
    run: () => {
      const selectedElement = getSelectedElement();
      if (!selectedElement) return;
      useCadUiStore.setState({
        isParameterEditMode: true,
        isDependencyJumpMode: false
      });
      useCadDocumentStore.getState().setSelectedParameterKey(
        normalizeParameterKey(selectedElement, useCadDocumentStore.getState().selectedParameterKey)
      );
    }
  },
  exitParameterEditMode: {
    id: "exitParameterEditMode",
    label: "パラメーター編集モードを終了",
    palette: { order: 47, keywords: ["parameter", "edit", "escape", "パラメーター", "終了"] },
    shortcuts: [{ keys: "Escape" }],
    run: () => useCadUiStore.getState().setParameterEditMode(false)
  }
} satisfies Partial<Record<CommandId, Command>>;
