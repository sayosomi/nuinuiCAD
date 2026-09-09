import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const referencePickTranslationCatalog = {
  "referencePick.noTarget": {
    en: "nuinuiCAD: There is no reference target that can be selected from Canvas at the current Source caret position.",
    ja: "nuinuiCAD: 現在の Source のキャレット位置には、Canvas から選択できる参照先がありません。"
  },
  "referencePick.targetPickerPlaceholder": {
    en: "Choose a Source target to pick from Canvas",
    ja: "Canvas から選択する Source の対象を選んでください"
  },
  "referencePick.emptyTarget": {
    en: "(empty value)",
    ja: "（空の値）"
  }
} satisfies TranslationCatalog;

export const referencePickTranslatorFor = (displayLanguage: string) =>
  createTranslator(referencePickTranslationCatalog, resolveLocale(displayLanguage));
