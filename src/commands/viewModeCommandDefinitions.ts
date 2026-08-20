import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { visibleCanvasDrawingBounds } from "../geometry/canvasDrawingBounds";
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

const CANVAS_FIT_PADDING_PX = 32;

const finitePositiveFitZoom = (
  candidateZoom: number,
  centerX: number,
  centerY: number
): number | null => {
  if (!(Number.isFinite(candidateZoom) && candidateZoom > 0)) return null;
  const maxZoomForFinitePan = Math.min(
    centerX === 0 ? Number.POSITIVE_INFINITY : Number.MAX_VALUE / Math.abs(centerX),
    centerY === 0 ? Number.POSITIVE_INFINITY : Number.MAX_VALUE / Math.abs(centerY)
  );
  const zoom = Math.min(candidateZoom, maxZoomForFinitePan);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : null;
};

const fitDrawing = (context?: CommandContext) => {
  const rect = context?.getCanvasViewportRect?.();
  const evaluation = context?.evaluation;
  if (!rect || !evaluation) return;

  const width = rect.width;
  const height = rect.height;
  const availableWidth = width - CANVAS_FIT_PADDING_PX * 2;
  const availableHeight = height - CANVAS_FIT_PADDING_PX * 2;
  if (!(Number.isFinite(availableWidth) && Number.isFinite(availableHeight)) || availableWidth <= 0 || availableHeight <= 0) return;

  const documentState = useCadDocumentStore.getState();
  const uiState = useCadUiStore.getState();
  const elements = effectiveElements(documentState);
  const bounds = visibleCanvasDrawingBounds({
    elements,
    evaluation,
    visibilityProfiles: documentState.visibilityProfiles,
    activeVisibilityProfileId: documentState.activeVisibilityProfileId,
    measureCanvasTextWidth: context?.measureCanvasTextWidth
  });
  if (!bounds) return;

  const drawingWidth = bounds.maxX - bounds.minX;
  const drawingHeight = bounds.maxY - bounds.minY;
  const currentZoom = uiState.canvasViewport.zoom;
  const candidateRatios = [
    drawingWidth > 0 ? availableWidth / drawingWidth : null,
    drawingHeight > 0 ? availableHeight / drawingHeight : null
  ].filter((ratio): ratio is number => ratio !== null);
  const rawCandidateZoom = candidateRatios.length > 0
    ? Math.min(...candidateRatios)
    : currentZoom;
  const candidateZoom = rawCandidateZoom === Number.POSITIVE_INFINITY ? Number.MAX_VALUE : rawCandidateZoom;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const zoom = finitePositiveFitZoom(candidateZoom, centerX, centerY);
  if (zoom === null || !Number.isFinite(centerX) || !Number.isFinite(centerY)) return;

  const panX = -centerX * zoom;
  const panY = centerY * zoom;
  if (!Number.isFinite(panX) || !Number.isFinite(panY)) return;
  uiState.setCanvasViewport({ panX, panY, zoom });
};

export const viewModeCommandDefinitions = {
  undo: {
    id: "undo",
    label: "元に戻す",
    palette: { order: 24, keywords: ["undo", "戻す"] },
    shortcuts: [{ keys: "Mod+Z" }],
    run: (context) => {
      context?.finalizeCanvasInteraction?.();
      if (context?.canvasHistory) {
        context.canvasHistory("undo");
        return;
      }
      if (useCadDocumentStore.getState().undoCanvasSelection()) return;
      useCadDocumentStore.getState().undo();
    }
  },
  redo: {
    id: "redo",
    label: "やり直す",
    palette: { order: 25, keywords: ["redo", "やり直す"] },
    shortcuts: [{ keys: "Mod+Y" }],
    run: (context) => {
      context?.finalizeCanvasInteraction?.();
      if (context?.canvasHistory) {
        context.canvasHistory("redo");
        return;
      }
      if (useCadDocumentStore.getState().redoCanvasSelection()) return;
      useCadDocumentStore.getState().redo();
    }
  },
  zoomInCanvas: {
    id: "zoomInCanvas",
    label: "キャンバスを拡大",
    palette: { order: 21, keywords: ["zoom", "in", "拡大", "キャンバス"] },
    shortcuts: [{ keys: "+ / =" }],
    run: (context) => {
      const state = useCadUiStore.getState();
      const anchor = canvasZoomAnchor(context);
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
      state.resetCanvasViewport();
    }
  },
  fitDrawing: {
    id: "fitDrawing",
    label: "描画全体を表示",
    palette: { order: 23.5, keywords: ["fit", "drawing", "zoom", "canvas", "全体", "描画"] },
    run: (context) => fitDrawing(context)
  },
  toggleCanvasPointNames: {
    id: "toggleCanvasPointNames",
    label: "Toggle Point Names",
    palette: { order: 26, keywords: ["canvas", "point", "label", "name", "点名", "ラベル", "表示", "非表示"] },
    run: () => {
      const { showCanvasPointNames } = useCadUiStore.getState();
      useCadUiStore.getState().setShowCanvasPointNames(!showCanvasPointNames);
    }
  },
  toggleCanvasGeometryNames: {
    id: "toggleCanvasGeometryNames",
    label: "Toggle Geometry Names",
    palette: { order: 26.5, keywords: ["canvas", "geometry", "label", "name", "図形名", "ラベル", "表示", "非表示"] },
    run: () => {
      const { showCanvasGeometryNames } = useCadUiStore.getState();
      useCadUiStore.getState().setShowCanvasGeometryNames(!showCanvasGeometryNames);
    }
  },
  /** Compatibility alias retained for existing host dispatchers and saved commands. */
  toggleCanvasElementNames: {
    id: "toggleCanvasElementNames",
    label: "Toggle Canvas Element Names (Legacy)",
    run: () => {
      const { showCanvasPointNames } = useCadUiStore.getState();
      useCadUiStore.getState().setShowCanvasPointNames(!showCanvasPointNames);
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
