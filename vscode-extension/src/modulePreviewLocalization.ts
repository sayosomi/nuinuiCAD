import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const modulePreviewTranslationCatalog = {
  "modulePreview.panelTitle": {
    en: "Module Preview",
    ja: "Module プレビュー"
  },
  "modulePreview.requiresSourceEditor": {
    en: "nuinuiCAD: Open Module Preview requires an active .nui Source Editor.",
    ja: "nuinuiCAD: Module Preview を開くには、アクティブな .nui Source Editor が必要です。"
  },
  "modulePreview.placeCaret": {
    en: "nuinuiCAD: Place the Source Editor caret inside a current Module definition.",
    ja: "nuinuiCAD: 現在の Module 定義の中に Source Editor のキャレットを置いてください。"
  }
} satisfies TranslationCatalog;

export const modulePreviewTranslatorFor = (displayLanguage: string) =>
  createTranslator(modulePreviewTranslationCatalog, resolveLocale(displayLanguage));
