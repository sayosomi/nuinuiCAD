import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const outputPreviewTranslationCatalog = {
  "outputPreview.panelTitle": {
    en: "{document} — Output Preview",
    ja: "{document} — 出力プレビュー"
  },
  "outputPreview.reveal.no-containing-output": {
    en: "nuinuiCAD: No current Output Preview output contains the Source target.",
    ja: "nuinuiCAD: 現在の Output Preview に Source 対象を含む出力がありません。"
  },
  "outputPreview.reveal.evaluation-failed": {
    en: "nuinuiCAD: Output Preview evaluation failed while revealing the Source target.",
    ja: "nuinuiCAD: Source 対象を表示中に Output Preview の評価に失敗しました。"
  },
  "outputPreview.reveal.target-unavailable": {
    en: "nuinuiCAD: The current Source target is no longer available in Output Preview.",
    ja: "nuinuiCAD: 現在の Source 対象を Output Preview で利用できません。"
  },
  "outputPreview.sourceReveal.analysis-unavailable": {
    en: "nuinuiCAD: Output Preview Reveal is unavailable because Source analysis is not ready.",
    ja: "nuinuiCAD: Source 解析の準備ができていないため、Output Preview で表示できません。"
  },
  "outputPreview.sourceReveal.source-mismatch": {
    en: "nuinuiCAD: Output Preview Reveal is unavailable because the Source snapshot is stale.",
    ja: "nuinuiCAD: Source スナップショットが古いため、Output Preview で表示できません。"
  },
  "outputPreview.sourceReveal.invalid-position": {
    en: "nuinuiCAD: Output Preview Reveal is unavailable at the current Source position.",
    ja: "nuinuiCAD: 現在の Source 位置では Output Preview で表示できません。"
  },
  "outputPreview.sourceReveal.no-target": {
    en: "nuinuiCAD: There is no Output Preview target at the current Source position.",
    ja: "nuinuiCAD: 現在の Source 位置には Output Preview の対象がありません。"
  },
  "outputPreview.changed": {
    en: "nuinuiCAD: Output Preview changed. Review the current output and export again.",
    ja: "nuinuiCAD: Output Preview が変更されました。現在の出力を確認して、もう一度エクスポートしてください。"
  },
  "outputPreview.changedWhileSaving": {
    en: "nuinuiCAD: Output Preview changed while the save dialog was open. Export again.",
    ja: "nuinuiCAD: 保存ダイアログの表示中に Output Preview が変更されました。もう一度エクスポートしてください。"
  },
  "outputPreview.saved": {
    en: "nuinuiCAD: Saved {fileName}.",
    ja: "nuinuiCAD: {fileName} を保存しました。"
  },
  "outputPreview.exportFailed": {
    en: "nuinuiCAD: Export failed: {error}",
    ja: "nuinuiCAD: エクスポートに失敗しました: {error}"
  },
  "outputPreview.localFileOnly": {
    en: "Output files can only be saved to a local file path.",
    ja: "出力ファイルはローカルのファイルパスにのみ保存できます。"
  },
  "outputPreview.requiresSourceOrCanvas": {
    en: "nuinuiCAD: Output Preview requires an active .nui Text Editor or Canvas.",
    ja: "nuinuiCAD: Output Preview にはアクティブな .nui Text Editor または Canvas が必要です。"
  },
  "outputPreview.exportOnlyActive": {
    en: "nuinuiCAD: Export Current Output is only available from an active Output Preview.",
    ja: "nuinuiCAD: 現在の出力のエクスポートは、アクティブな Output Preview からのみ実行できます。"
  },
  "outputPreview.noExportableOutput": {
    en: "nuinuiCAD: The active Output Preview has no current exportable output.",
    ja: "nuinuiCAD: アクティブな Output Preview に現在エクスポートできる出力がありません。"
  },
  "outputPreview.exportPdf": {
    en: "Export PDF",
    ja: "PDF をエクスポート"
  },
  "outputPreview.exportSvg": {
    en: "Export SVG",
    ja: "SVG をエクスポート"
  },
  "outputPreview.pdfDocument": {
    en: "PDF document",
    ja: "PDF ドキュメント"
  },
  "outputPreview.svgDocument": {
    en: "SVG document",
    ja: "SVG ドキュメント"
  }
} satisfies TranslationCatalog;

export const outputPreviewTranslatorFor = (displayLanguage: string) =>
  createTranslator(outputPreviewTranslationCatalog, resolveLocale(displayLanguage));
