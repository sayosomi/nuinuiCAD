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
