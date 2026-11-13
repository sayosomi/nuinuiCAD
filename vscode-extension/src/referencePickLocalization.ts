import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const referencePickTranslationCatalog = {
  "referencePick.sourceChanged": {
    en: "nuinuiCAD: Source changed. Select a current caret or range and start Reference Pick again before confirming insertion.",
    ja: "nuinuiCAD: Sourceが変更されました。現在のキャレットまたは範囲を選び、Reference Pickを再実行して挿入先を確認してください。"
  },
  "referencePick.canvasUnavailable": {
    en: "nuinuiCAD: Canvas is unavailable. Open Canvas for this file, evaluate geometry, and start Reference Pick again.",
    ja: "nuinuiCAD: Canvasを利用できません。このファイルのCanvasを開いて図形を評価し、Reference Pickを再実行してください。"
  },
  "referencePick.noTarget": {
    en: "nuinuiCAD: There is no reference target that can be selected from Canvas at the current Source caret position.",
    ja: "nuinuiCAD: 現在の Source のキャレット位置には、Canvas から選択できる参照先がありません。"
  },
  "referencePick.candidateUnavailable": {
    en: "nuinuiCAD: Canvas references are unavailable. Complete or evaluate independent geometry, open Canvas, then start Pick again.",
    ja: "nuinuiCAD: Canvas参照を利用できません。独立した図形を完成・評価し、Canvasを開いてPickを再実行してください。"
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
