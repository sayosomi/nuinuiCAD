import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
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
    run: (context) => {
      const state = useCadUiStore.getState();
      const anchor = canvasZoomAnchor(context);
      if (state.showPrintLayout) {
        state.zoomPrintCanvasViewportAt(1.1, anchor);
        return;
      }
      state.zoomCanvasViewportAt(1.1, anchor);
    }
  },
  zoomOutCanvas: {
    id: "zoomOutCanvas",
    label: "キャンバスを縮小",
    palette: { order: 22, keywords: ["zoom", "out", "縮小", "キャンバス"] },
    shortcuts: [{ keys: "-" }],
    run: (context) => {
      const state = useCadUiStore.getState();
      const anchor = canvasZoomAnchor(context);
      if (state.showPrintLayout) {
        state.zoomPrintCanvasViewportAt(1 / 1.1, anchor);
        return;
      }
      state.zoomCanvasViewportAt(1 / 1.1, anchor);
    }
  },
  resetCanvasView: {
    id: "resetCanvasView",
    label: "キャンバス表示をリセット",
    palette: { order: 23, keywords: ["zoom", "reset", "pan", "origin", "リセット", "原点", "キャンバス"] },
    shortcuts: [{ keys: "0" }],
    run: () => {
      const state = useCadUiStore.getState();
      if (state.showPrintLayout) {
        state.resetPrintCanvasViewport();
        return;
      }
      state.resetCanvasViewport();
    }
  },
  openPrintLayout: {
    id: "openPrintLayout",
    label: "印刷レイアウトを開く",
    palette: { order: 28.2, keywords: ["print", "pdf", "layout", "印刷", "PDF", "レイアウト"] },
    run: () => {
      useCadUiStore.setState({
        showPrintLayout: true,
        showCommandPalette: false
      });
    }
  },
  closePrintLayout: {
    id: "closePrintLayout",
    label: "CAD編集に戻る",
    palette: { order: 28.3, keywords: ["canvas", "edit", "戻る", "編集", "CAD"] },
    run: () => useCadUiStore.getState().setShowPrintLayout(false)
  },
  togglePrintPreviewWindow: {
    id: "togglePrintPreviewWindow",
    label: "印刷プレビューを表示/非表示",
    palette: { order: 28.25, keywords: ["print", "preview", "layout", "印刷", "プレビュー", "レイアウト"] },
    run: () => {
      const { showPrintPreviewWindow } = useCadUiStore.getState();
      useCadUiStore.setState({
        showPrintPreviewWindow: !showPrintPreviewWindow,
        showCommandPalette: false
      });
    }
  },
  toggleCanvasElementNames: {
    id: "toggleCanvasElementNames",
    label: "キャンバス要素名を表示/非表示",
    palette: { order: 26, keywords: ["canvas", "label", "name", "要素名", "ラベル", "表示", "非表示"] },
    run: () => {
      const { showCanvasElementNames } = useCadUiStore.getState();
      useCadUiStore.getState().setShowCanvasElementNames(!showCanvasElementNames);
    }
  },
  toggleCanvasPoints: {
    id: "toggleCanvasPoints",
    label: "キャンバス点を表示/非表示",
    palette: { order: 27, keywords: ["canvas", "point", "点", "表示", "非表示"] },
    run: () => {
      const { showCanvasPoints } = useCadUiStore.getState();
      useCadUiStore.getState().setShowCanvasPoints(!showCanvasPoints);
    }
  },
  toggleElementListColorAccents: {
    id: "toggleElementListColorAccents",
    label: "構成リストの色アクセントを表示/非表示",
    palette: {
      order: 28,
      keywords: ["element list", "color", "accent", "構成リスト", "色", "アクセント", "表示", "非表示"]
    },
    run: () => {
      const { showElementListColorAccents } = useCadUiStore.getState();
      useCadUiStore.getState().setShowElementListColorAccents(!showElementListColorAccents);
    }
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
  openPaletteSettings: {
    id: "openPaletteSettings",
    label: "パレットを編集",
    palette: { order: 45, keywords: ["palette", "color", "settings", "パレット", "色", "設定"] },
    run: () => {
      useCadUiStore.setState({
        showPaletteSettings: true,
        showCommandPalette: false
      });
    }
  },
  closePaletteSettings: {
    id: "closePaletteSettings",
    label: "パレット設定を閉じる",
    run: () => useCadUiStore.getState().setShowPaletteSettings(false)
  },
  openVisibilityProfileSettings: {
    id: "openVisibilityProfileSettings",
    label: "表示プロファイルを開く",
    palette: {
      order: 45.2,
      keywords: ["visibility", "profile", "role", "表示", "プロファイル", "ロール", "設定"]
    },
    run: () => {
      useCadUiStore.setState({
        showVisibilityProfileSettings: true,
        showCommandPalette: false
      });
    }
  },
  closeVisibilityProfileSettings: {
    id: "closeVisibilityProfileSettings",
    label: "表示プロファイルを閉じる",
    run: () => useCadUiStore.getState().setShowVisibilityProfileSettings(false)
  },
  openGroupTemplateLibrary: {
    id: "openGroupTemplateLibrary",
    label: "グループテンプレート",
    palette: {
      order: 46.8,
      keywords: ["template", "group", "library", "manage", "テンプレート", "グループ", "管理"]
    },
    run: () => {
      useCadUiStore.setState({
        showGroupTemplateLibrary: true,
        groupTemplateLibraryMode: "manage",
        showCommandPalette: false
      });
    }
  },
  openGroupTemplateInsertion: {
    id: "openGroupTemplateInsertion",
    label: "テンプレートを挿入",
    palette: {
      order: 46.7,
      keywords: ["template", "insert", "group", "テンプレート", "挿入", "グループ"]
    },
    run: () => {
      useCadUiStore.setState({
        showGroupTemplateLibrary: true,
        groupTemplateLibraryMode: "insert",
        showCommandPalette: false
      });
    }
  },
  closeGroupTemplateLibrary: {
    id: "closeGroupTemplateLibrary",
    label: "グループテンプレートを閉じる",
    run: () => useCadUiStore.getState().setShowGroupTemplateLibrary(false)
  },
  openDslPanel: {
    id: "openDslPanel",
    label: "DSLパネル",
    palette: {
      order: 46.6,
      keywords: ["dsl", "script", "text", "作図", "テキスト", "スクリプト"]
    },
    shortcuts: [{ keys: "Mod+Shift+D", label: "選択をDSLで開く" }],
    run: (context) => {
      const selectedElementIds = useCadUiStore.getState().selectedElementIds;
      const requestedElementIds = context?.dslElementIds ?? (
        selectedElementIds.length > 0 ? selectedElementIds : null
      );
      useCadUiStore.setState({
        showDslPanel: true,
        dslPanelSourceRequest: requestedElementIds
          ? { requestId: Date.now(), elementIds: requestedElementIds }
          : useCadUiStore.getState().dslPanelSourceRequest,
        showCommandPalette: false
      });
    }
  },
  exportDslSelection: {
    id: "exportDslSelection",
    label: "選択をDSLへ書き出し",
    shortcuts: [{ keys: "Mod+Shift+E" }],
    run: (context) => context?.exportDslSelection?.()
  },
  validateDslPanel: {
    id: "validateDslPanel",
    label: "DSLを検証",
    shortcuts: [{ keys: "Mod+Shift+Enter" }],
    run: (context) => context?.validateDslPanel?.()
  },
  applyDslPanel: {
    id: "applyDslPanel",
    label: "DSLを適用",
    shortcuts: [{ keys: "Mod+Enter", label: "検証して適用" }],
    run: (context) => context?.applyDslPanel?.()
  },
  closeDslPanel: {
    id: "closeDslPanel",
    label: "DSLパネルを閉じる",
    shortcuts: [{ keys: "Escape" }],
    run: (context) => {
      if (context?.closeDslPanel) {
        context.closeDslPanel();
        return;
      }
      useCadUiStore.getState().setShowDslPanel(false);
    }
  },
  openCommandRibbonSettings: {
    id: "openCommandRibbonSettings",
    label: "コマンドリボンを編集",
    palette: { order: 45.5, keywords: ["ribbon", "toolbar", "command", "button", "リボン", "ツールバー", "コマンド", "ボタン", "設定"] },
    run: () => {
      useCadUiStore.setState({
        showCommandRibbonSettings: true,
        showCommandPalette: false,
        commandRibbonSettingsError: null
      });
    }
  },
  closeCommandRibbonSettings: {
    id: "closeCommandRibbonSettings",
    label: "コマンドリボン設定を閉じる",
    run: () => useCadUiStore.getState().setShowCommandRibbonSettings(false)
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
    run: (context) => context?.focusElementList?.()
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
  toggleInspectorPanel: {
    id: "toggleInspectorPanel",
    label: "インスペクタを表示/非表示",
    palette: { order: 44, keywords: ["information", "info", "inspector", "インスペクタ", "折り畳み", "表示"] },
    shortcuts: [{ keys: "i" }],
    run: () => {
      const { isInspectorExpanded } = useCadUiStore.getState();
      useCadUiStore.getState().setInspectorExpanded(!isInspectorExpanded);
    }
  },
  focusInspectorDependencyRows: {
    id: "focusInspectorDependencyRows",
    label: "インスペクタの親子要素へフォーカス",
    palette: { order: 45, keywords: ["dependency", "parent", "child", "inspector", "親子", "ジャンプ"] },
    shortcuts: [{ keys: "j", label: "親子要素へ移動" }],
    run: (context) => {
      cancelPointPick();
      cancelNumericReferencePick();
      cancelLinePick();
      useCadUiStore.getState().setInspectorExpanded(true);
      context?.focusInspectorDependencyRows?.();
    }
  },
  focusInspectorParameterRows: {
    id: "focusInspectorParameterRows",
    label: "インスペクタのパラメーターへフォーカス",
    palette: { order: 46, keywords: ["parameter", "inspector", "パラメーター", "インスペクタ"] },
    shortcuts: [{ keys: "e", label: "パラメーターへ移動" }, { keys: "Enter" }],
    run: (context) => {
      cancelPointPick();
      cancelNumericReferencePick();
      cancelLinePick();
      useCadUiStore.getState().setInspectorExpanded(true);
      context?.focusInspectorParameterRows?.();
    }
  },
  exitInspector: {
    id: "exitInspector",
    label: "インスペクタを終了",
    shortcuts: [{ keys: "Escape" }],
    run: (context) => context?.exitInspector?.()
  },
  selectNextInspectorRow: {
    id: "selectNextInspectorRow",
    label: "インスペクタの次の行へ",
    shortcuts: [{ keys: "ArrowDown" }],
    run: (context) => context?.moveInspectorRow?.(1) ?? false
  },
  selectPreviousInspectorRow: {
    id: "selectPreviousInspectorRow",
    label: "インスペクタの前の行へ",
    shortcuts: [{ keys: "ArrowUp" }],
    run: (context) => context?.moveInspectorRow?.(-1) ?? false
  },
  activateInspectorRow: {
    id: "activateInspectorRow",
    label: "インスペクタの選択行を開く",
    shortcuts: [{ keys: "Enter" }],
    run: (context) => context?.activateInspectorRow?.() ?? false
  },
  startInspectorParameterPick: {
    id: "startInspectorParameterPick",
    label: "選択パラメーターの参照選択を開始",
    shortcuts: [{ keys: "P" }],
    run: (context) => context?.startInspectorParameterPick?.() ?? false
  }
} satisfies Partial<Record<CommandId, Command>>;
