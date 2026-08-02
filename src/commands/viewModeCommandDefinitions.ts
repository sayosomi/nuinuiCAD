import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { Command, CommandContext, CommandId } from "./commandTypes";
import { resolveSourceCreationInsertion } from "./sourceCreationInsertion";

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
        templateInsertionSourceInsertion: null,
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
    run: (context) => {
      const document = useCadDocumentStore.getState();
      useCadUiStore.setState({
        showGroupTemplateLibrary: true,
        groupTemplateLibraryMode: "insert",
        templateInsertionSourceInsertion: resolveSourceCreationInsertion({
          cursor: context?.currentSourceCursor?.() ?? null,
          sourceRevision: document.sourceRevision,
          elements: document.elements,
          statementMap: document.doc.statementMap
        }),
        showCommandPalette: false
      });
    }
  },
  closeGroupTemplateLibrary: {
    id: "closeGroupTemplateLibrary",
    label: "グループテンプレートを閉じる",
    run: () => useCadUiStore.setState({
      showGroupTemplateLibrary: false,
      templateInsertionSourceInsertion: null
    })
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
  focusSourceEditor: {
    id: "focusSourceEditor",
    label: "Source Editorへフォーカス",
    palette: { order: 40, keywords: ["focus", "source editor", "dsl", "ソースエディタ"] },
    shortcuts: [{ keys: "g" }],
    run: (context) => context?.focusSourceEditor?.()
  },
  focusElementSearch: {
    id: "focusElementSearch",
    label: "要素検索へフォーカス",
    palette: { order: 41, keywords: ["focus", "find", "search", "element", "検索", "要素"] },
    shortcuts: [{ keys: "Mod+F", label: "要素検索へ移動" }],
    run: (context) => context?.focusElementSearch?.()
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
  }
} satisfies Partial<Record<CommandId, Command>>;
