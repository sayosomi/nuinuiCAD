import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const choiceQuickFixTranslationCatalog = {
  "choiceQuickFix.replace": {
    en: "Replace with '{candidate}'",
    ja: "'{candidate}' に置き換え"
  },
  "choiceQuickFix.addDeclaredType": {
    en: "Add a declared type",
    ja: "型注釈を追加"
  },
  "choiceQuickFix.changeCategory": {
    en: "Change category to '{category}'",
    ja: "カテゴリを '{category}' に変更"
  }
} satisfies TranslationCatalog;

export const choiceQuickFixTranslatorFor = (displayLanguage: string) =>
  createTranslator(choiceQuickFixTranslationCatalog, resolveLocale(displayLanguage));
