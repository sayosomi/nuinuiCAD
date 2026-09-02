import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const geometryReferenceRetargetTranslationCatalog = {
  "geometryReferenceRetarget.placeCaret": {
    en: "nuinuiCAD: Place the Source caret on an exact geometry reference to replace it.",
    ja: "nuinuiCAD: 置き換える正確なジオメトリ参照に Source のキャレットを置いてください。"
  },
  "geometryReferenceRetarget.noCandidate": {
    en: "nuinuiCAD: No compatible geometry replacement is available for this reference.",
    ja: "nuinuiCAD: この参照に対応する置換候補がありません。"
  },
  "geometryReferenceRetarget.pickerPlaceholder": {
    en: "Select replacement geometry",
    ja: "置き換えるジオメトリを選択"
  },
  "geometryReferenceRetarget.geometryDescription": {
    en: "{type} geometry",
    ja: "{type} ジオメトリ"
  },
  "geometryReferenceRetarget.referencePath": {
    en: "Reference path: {paths}",
    ja: "参照パス: {paths}"
  },
  "geometryReferenceRetarget.referencePaths": {
    en: "Reference paths: {paths}",
    ja: "参照パス: {paths}"
  },
  "geometryReferenceRetarget.sourceChangedWhileChoosing": {
    en: "nuinuiCAD: Source changed while choosing a replacement. No changes were made.",
    ja: "nuinuiCAD: 置換候補の選択中に Source が変更されたため、変更しませんでした。"
  },
  "geometryReferenceRetarget.textMismatch": {
    en: "nuinuiCAD: The current Source text no longer matches the planned replacement. No changes were made.",
    ja: "nuinuiCAD: 現在の Source が計画した置換内容と一致しないため、変更しませんでした。"
  },
  "geometryReferenceRetarget.sourceChangedBeforeApply": {
    en: "nuinuiCAD: Source changed before the replacement could be applied. No changes were made.",
    ja: "nuinuiCAD: 置換を適用する前に Source が変更されたため、変更しませんでした。"
  },
  "geometryReferenceRetarget.applyFailed": {
    en: "nuinuiCAD: VS Code could not apply the geometry-reference replacement. No changes were made.",
    ja: "nuinuiCAD: VS Code がジオメトリ参照の置換を適用できなかったため、変更しませんでした。"
  },
  "geometryReferenceRetarget.failure.stale-source": {
    en: "Source changed while replacing geometry references. Run the command again.",
    ja: "ジオメトリ参照の置換中に Source が変更されました。コマンドをもう一度実行してください。"
  },
  "geometryReferenceRetarget.failure.unavailable-semantics": {
    en: "Current Source semantics are unavailable. Fix the current Source diagnostics and try again.",
    ja: "現在の Source の意味解析を利用できません。Source の診断を修正してから再試行してください。"
  },
  "geometryReferenceRetarget.failure.invalid-target": {
    en: "The current caret is no longer on a geometry reference. Run the command again.",
    ja: "現在のキャレットがジオメトリ参照上にありません。コマンドをもう一度実行してください。"
  },
  "geometryReferenceRetarget.failure.incomplete-references": {
    en: "The geometry references could not be fully identified. No changes were made.",
    ja: "ジオメトリ参照を完全に特定できなかったため、変更しませんでした。"
  },
  "geometryReferenceRetarget.failure.candidate-not-found": {
    en: "The selected geometry is no longer an available replacement. Run the command again.",
    ja: "選択したジオメトリが置換候補として利用できなくなりました。コマンドをもう一度実行してください。"
  },
  "geometryReferenceRetarget.failure.incompatible-candidate": {
    en: "The selected geometry is not compatible with every reference. Choose another candidate.",
    ja: "選択したジオメトリがすべての参照に対応していません。別の候補を選択してください。"
  },
  "geometryReferenceRetarget.failure.unreachable-candidate": {
    en: "The selected geometry cannot be referenced from every occurrence. Choose another candidate.",
    ja: "選択したジオメトリをすべての出現箇所から参照できません。別の候補を選択してください。"
  },
  "geometryReferenceRetarget.failure.proposed-source-verification-failed": {
    en: "The proposed Source edit failed semantic verification. No changes were made.",
    ja: "提案した Source の変更を意味検証できなかったため、変更しませんでした。"
  },
  "geometryReferenceRetarget.failure.default": {
    en: "The geometry-reference replacement could not be verified. No changes were made.",
    ja: "ジオメトリ参照の置換を検証できなかったため、変更しませんでした。"
  }
} satisfies TranslationCatalog;

export const geometryReferenceRetargetTranslatorFor = (displayLanguage: string) =>
  createTranslator(geometryReferenceRetargetTranslationCatalog, resolveLocale(displayLanguage));
