import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog,
  type TranslationParameters
} from "./localization";

export const canvasPresentationTranslationCatalog = {
  "canvas.sourceAnchor": {
    en: "nuinuiCAD: Confirm the Source insertion position first. Move the Source caret explicitly and try again.",
    ja: "nuinuiCAD: 先に Source の挿入位置を確定してください。Source でキャレットを明示的に移動してから再試行してください。"
  },
  "canvas.staleSourceAnchor": {
    en: "nuinuiCAD: The Source insertion position is stale. Confirm the caret again in the current Source and retry.",
    ja: "nuinuiCAD: Source の挿入位置が古くなっています。現在の Source でキャレットを再確定してから再試行してください。"
  },
  "canvas.pointer": {
    en: "nuinuiCAD: Place the pointer on the Canvas before running this command.",
    ja: "nuinuiCAD: 実行する前に Canvas 上へポインターを置いてください。"
  },
  "canvas.noActiveCanvas": {
    en: "nuinuiCAD: No active Canvas is available. Open Canvas and try again.",
    ja: "nuinuiCAD: アクティブな Canvas がありません。Canvas を開いてから再試行してください。"
  },
  "canvas.grid.configure.title": {
    en: "Configure Canvas Grid",
    ja: "Canvas グリッドを設定"
  },
  "canvas.grid.configure.placeholder": {
    en: "Select a Canvas grid setting to edit",
    ja: "編集するCanvasグリッド設定を選択"
  },
  "canvas.grid.configure.gridOn": { en: "Grid: On", ja: "グリッド: オン" },
  "canvas.grid.configure.gridOff": { en: "Grid: Off", ja: "グリッド: オフ" },
  "canvas.grid.configure.spacing": { en: "Spacing: {spacing} mm", ja: "間隔: {spacing} mm" },
  "canvas.grid.configure.majorEvery": { en: "Major interval: ×{majorEvery}", ja: "主線間隔: ×{majorEvery}" },
  "canvas.grid.configure.gridSnapOn": { en: "Grid Snap: On", ja: "グリッドスナップ: オン" },
  "canvas.grid.configure.gridSnapOff": { en: "Grid Snap: Off", ja: "グリッドスナップ: オフ" },
  "canvas.grid.configure.resetToDefaults": { en: "Reset to Defaults", ja: "初期値に戻す" },
  "canvas.grid.configure.spacingTitle": { en: "Canvas Grid Spacing", ja: "Canvasグリッド間隔" },
  "canvas.grid.configure.spacingPrompt": {
    en: "Enter a finite spacing value in millimetres greater than 0.",
    ja: "0より大きい有限のグリッド間隔をミリメートル単位で入力してください。"
  },
  "canvas.grid.configure.spacingInvalid": {
    en: "Enter a finite number greater than 0.",
    ja: "0より大きい有限の数値を入力してください。"
  },
  "canvas.grid.configure.majorEveryTitle": { en: "Canvas Grid Major Interval", ja: "Canvasグリッド主線間隔" },
  "canvas.grid.configure.majorEveryPrompt": {
    en: "Enter an integer of at least 1.",
    ja: "1以上の整数を入力してください。"
  },
  "canvas.grid.configure.majorEveryInvalid": {
    en: "Enter an integer of at least 1.",
    ja: "1以上の整数を入力してください。"
  },
  "canvas.sourceOrCanvasRequired": {
    en: "nuinuiCAD: Activate a .nui Source Editor or Canvas before running this command.",
    ja: "nuinuiCAD: 実行する前に .nui の Source Editor または Canvas をアクティブにしてください。"
  },
  "canvas.noBakeTarget": {
    en: "nuinuiCAD: No geometry is available to Bake at the current Source position.",
    ja: "nuinuiCAD: 現在の Source 位置には Bake できるジオメトリがありません。"
  },
  "canvas.matchingOutputPreview": {
    en: "nuinuiCAD: Open Canvas from the matching active Output Preview session.",
    ja: "nuinuiCAD: 対応するアクティブな Output Preview セッションから Canvas を開いてください。"
  },
  "canvas.sourceOrOutputPreview": {
    en: "nuinuiCAD: Activate a .nui Text Editor or Output Preview before running this command.",
    ja: "nuinuiCAD: 実行する前に .nui Text Editor または Output Preview をアクティブにしてください。"
  },
  "canvas.fixedColorContrastWarning": {
    en: "Fixed style color {color} has low contrast against the current Canvas background.",
    ja: "固定Style色 {color} は現在のCanvas背景とのコントラストが低くなっています。"
  }
} satisfies TranslationCatalog;

export type CanvasPresentationKey = keyof typeof canvasPresentationTranslationCatalog;

export const canvasPresentationTextFor = (
  key: CanvasPresentationKey,
  displayLanguage: string,
  parameters?: TranslationParameters
): string => createTranslator(
  canvasPresentationTranslationCatalog,
  resolveLocale(displayLanguage)
)(key, parameters);
