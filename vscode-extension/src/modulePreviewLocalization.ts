import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const modulePreviewTranslationCatalog = {
  "modulePreview.panelTitle": {
    en: "Module Preview",
    ja: "Module Preview"
  },
  "modulePreview.requiresSourceEditor": {
    en: "nuinuiCAD: Open Module Preview requires an active .nui Source Editor.",
    ja: "nuinuiCAD: Module Preview を開くには、アクティブな .nui Source Editor が必要です。"
  },
  "modulePreview.placeCaret": {
    en: "nuinuiCAD: Place the Source Editor caret inside a current Module definition.",
    ja: "nuinuiCAD: 現在の Module 定義の中に Source Editor のキャレットを置いてください。"
  },
  "modulePreview.valuesUnavailable": {
    en: "nuinuiCAD: Module Preview values are unavailable. Reopen the Module Preview panel and try again.",
    ja: "nuinuiCAD: Module Previewの値を利用できません。Module Previewパネルを開き直して、もう一度お試しください。"
  }
} satisfies TranslationCatalog;

export const modulePreviewTranslatorFor = (displayLanguage: string) =>
  createTranslator(modulePreviewTranslationCatalog, resolveLocale(displayLanguage));
