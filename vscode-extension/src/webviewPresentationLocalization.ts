import type { VscodeWebviewPresentation } from "../../src/vscode/webviewPresentation";
import { diagnosticTranslationCatalog } from "./diagnosticLocalization";
import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

/**
 * Webview presentation is resolved in the Extension Host and published as
 * plain data. Semantic IDs, routing keys, and source-facing names never use
 * these values.
 */
export const webviewPresentationTranslationCatalog = {
  "canvas.ariaLabel": { en: "CAD drawing canvas", ja: "CAD作図キャンバス" },
  "canvas.candidate.numericReference": { en: "Numeric reference candidates", ja: "数値参照候補" },
  "canvas.candidate.point": { en: "Point candidates", ja: "点選択候補" },
  "canvas.candidate.line": { en: "Line candidates", ja: "線選択候補" },
  "canvas.candidate.overlapSelection": { en: "Overlapping element candidates", ja: "重なった要素の選択候補" },
  "canvas.candidate.overlapNames": { en: "Overlapping element names", ja: "重なった要素の名前" },
  "canvas.candidate.unnamed": { en: "(unnamed)", ja: "(名前なし)" },
  "canvas.axisLock.holdShift": { en: "Hold Shift for ", ja: "Shift を押すと" },
  "canvas.axisLock.horizontal": { en: "Horizontal", ja: "水平" },
  "canvas.axisLock.vertical": { en: "Vertical", ja: "垂直" },
  "canvas.displaySettings": { en: "Canvas display settings", ja: "キャンバス表示設定" },
  "canvas.display.pointNames": { en: "Point names", ja: "点名" },
  "canvas.display.geometryNames": { en: "Geometry names", ja: "図形名" },
  "canvas.display.points": { en: "Points", ja: "点" },
  "canvas.warning": { en: "⚠ {count} errors or warnings", ja: "⚠ エラー/警告 {count} 件" },
  "canvas.scale": { en: "Scale {scale}px/mm", ja: "縮尺 {scale}px/mm" },
  "canvas.ribbon.title": { en: "Canvas Ribbon", ja: "Canvas リボン" },
  "canvas.ribbon.move": { en: "Move {label}", ja: "{label}を移動" },
  "canvas.ribbon.drag": { en: "Drag to move", ja: "ドラッグで移動" },
  "canvas.ribbon.unavailable": { en: "This command is unavailable.", ja: "このコマンドは使用できません。" },
  "canvas.ribbon.command.clearCanvasSelection.label": { en: "Clear selection", ja: "選択を解除" },
  "canvas.ribbon.command.clearCanvasSelection.description": { en: "Clear the current Canvas selection.", ja: "現在のCanvas選択を解除します。" },
  "canvas.ribbon.command.resetCanvasView.label": { en: "Reset view", ja: "表示をリセット" },
  "canvas.ribbon.command.resetCanvasView.description": { en: "Reset Canvas pan and zoom.", ja: "Canvasの移動とズームをリセットします。" },
  "canvas.ribbon.command.fitDrawing.label": { en: "Fit drawing", ja: "図面に合わせる" },
  "canvas.ribbon.command.fitDrawing.description": { en: "Fit the drawing to the Canvas viewport.", ja: "図面をCanvasの表示領域に合わせます。" },
  "canvas.ribbon.command.toggleCanvasPointNames.label": { en: "Point names", ja: "点名" },
  "canvas.ribbon.command.toggleCanvasPointNames.description": { en: "Show or hide Canvas point names.", ja: "Canvasの点名を表示または非表示にします。" },
  "canvas.ribbon.command.toggleCanvasGeometryNames.label": { en: "Geometry names", ja: "図形名" },
  "canvas.ribbon.command.toggleCanvasGeometryNames.description": { en: "Show or hide Canvas geometry names.", ja: "Canvasの図形名を表示または非表示にします。" },
  "canvas.ribbon.command.toggleCanvasPoints.label": { en: "Points", ja: "点" },
  "canvas.ribbon.command.toggleCanvasPoints.description": { en: "Show or hide Canvas points.", ja: "Canvasの点を表示または非表示にします。" },
  "canvas.ribbon.command.editCanvasRibbon.label": { en: "Edit Canvas Ribbon", ja: "Canvas リボンを編集" },
  "canvas.ribbon.command.editCanvasRibbon.description": { en: "Open the VS Code setting for Canvas Ribbon items.", ja: "Canvas リボン項目のVS Code設定を開きます。" },
  "canvas.status.label": { en: "Canvas status", ja: "Canvasの状態" },
  "canvas.status.description": { en: "Current Canvas zoom and pointer position.", ja: "現在のCanvasズームとポインター位置です。" },
  "viewport.status.label": { en: "Viewport status", ja: "表示領域の状態" },
  "viewport.status.description": { en: "Current viewport zoom and pointer position.", ja: "現在の表示領域のズームとポインター位置です。" },
  "viewport.status.zoom": { en: "ZOOM", ja: "ズーム" },
  "viewport.status.x": { en: "X", ja: "X" },
  "viewport.status.y": { en: "Y", ja: "Y" },
  "geometry.undefined": { en: "undefined", ja: "未定義" },
  "geometry.property.length": { en: "Length", ja: "長さ" },
  "geometry.property.startAngleDeg": { en: "Angle from start into path", ja: "始点からパス内部への角度" },
  "geometry.property.endAngleDeg": { en: "Angle from end into path", ja: "終点からパス内部への角度" },
  "geometry.property.radius": { en: "Radius", ja: "半径" },
  "geometry.property.sweepAngleDeg": { en: "Sweep angle", ja: "スイープ角度" },
  "geometry.property.startRadiusAngleDeg": { en: "Angle from center to start", ja: "中心から始点への角度" },
  "geometry.property.endRadiusAngleDeg": { en: "Angle from center to end", ja: "中心から終点への角度" },
  "geometry.property.startHandleAngleDeg": { en: "Start handle angle", ja: "始点ハンドル角度" },
  "geometry.property.startHandleLength": { en: "Start handle length", ja: "始点ハンドル長" },
  "geometry.property.endHandleAngleDeg": { en: "End handle angle", ja: "終点ハンドル角度" },
  "geometry.property.endHandleLength": { en: "End handle length", ja: "終点ハンドル長" },
  "canvas.pending.syntaxError": { en: "Repair the DSL syntax errors before continuing the Canvas operation.", ja: "DSLの構文エラーを修復してからキャンバス操作を実行してください。" },
  "canvas.pending.evaluationFailed": { en: "The Canvas operation could not continue because evaluation failed.", ja: "評価に失敗したためキャンバス操作を続行できませんでした。" },
  "canvas.pending.targetDeleted": { en: "The Canvas operation was canceled because its target was deleted during the update.", ja: "操作対象が更新中に削除されたためキャンバス操作を取り消しました。" },
  "canvas.pending.timeout": { en: "The Canvas operation was canceled because evaluation timed out.", ja: "評価の待機がタイムアウトしたためキャンバス操作を取り消しました。" },
  "canvas.pending.composition": { en: "Canvas operations cannot start while Japanese input is being composed. Finish the input and try again.", ja: "日本語入力の確定中はキャンバス操作を開始できません。入力を確定してから再操作してください。" },

  "output.selector.label": { en: "Output", ja: "出力" },
  "output.selector.noOutputs": { en: "No outputs", ja: "出力なし" },
  "output.kind.print": { en: "Print", ja: "印刷" },
  "output.kind.svg": { en: "SVG", ja: "SVG" },
  "output.ribbon.title": { en: "Output Preview", ja: "出力プレビュー" },
  "output.ribbon.goToSource": { en: "Go to Source", ja: "Sourceへ移動" },
  "output.ribbon.exportTitle": { en: "Output Export", ja: "出力エクスポート" },
  "output.ribbon.exportPdf": { en: "Export PDF", ja: "PDFをエクスポート" },
  "output.ribbon.exportSvg": { en: "Export SVG", ja: "SVGをエクスポート" },
  "output.ribbon.reset": { en: "Reset Output Preview view", ja: "出力プレビューの表示をリセット" },
  "output.ribbon.fit": { en: "Fit Output Preview", ja: "出力プレビューに合わせる" },
  "output.viewportStatus.label": { en: "Output Preview status", ja: "出力プレビューの状態" },
  "output.viewportStatus.description": { en: "Current Output Preview zoom and pointer position.", ja: "現在の出力プレビューのズームとポインター位置です。" },
  "output.evaluating": { en: "Evaluating…", ja: "評価中…" },
  "output.unavailable": { en: "Output Preview unavailable", ja: "出力プレビューを利用できません" },
  "output.goToSource": { en: "Go to Source", ja: "Sourceへ移動" },
  "output.noOutputs": { en: "No print or SVG outputs", ja: "印刷またはSVGの出力がありません" },
  "output.addDeclaration": { en: "Add a print or svg declaration in the Source Editor.", ja: "Source Editorにprintまたはsvg宣言を追加してください。" },
  "output.previewAriaLabel": { en: "Output Preview", ja: "出力プレビュー" },

  "modulePreview.initial": { en: "Open Module Preview from a Module definition in the Source Editor.", ja: "Source EditorのModule定義からModule Previewを開いてください。" },
  "modulePreview.waitingForTarget": { en: "Module Preview is waiting for the exact current target.", ja: "Module Previewは正確な現在の対象を待機しています。" },
  "modulePreview.noValid": { en: "No valid Module Preview is available yet.", ja: "有効なModule Previewはまだありません。" },
  "modulePreview.cannotEvaluate": { en: "Module Preview cannot evaluate the exact current target with the current inputs.", ja: "現在の入力ではModule Previewの正確な現在の対象を評価できません。" },
  "modulePreview.lastGood": { en: "Module Preview is showing the last valid preview for the current target.", ja: "Module Previewは現在の対象の最後に有効だったプレビューを表示しています。" },
  "modulePreview.contextFailed": { en: "Module Preview could not build the current evaluation context.", ja: "Module Previewの現在の評価コンテキストを構築できませんでした。" },
  "modulePreview.targetUnavailable": { en: "Module Preview target is not exact-current and was not rebound.", ja: "Module Previewの対象が正確な現在の状態ではないため、再バインドしませんでした。" },
  "modulePreview.editStale": { en: "Module Preview edit became stale and was rejected.", ja: "Module Previewの編集が古くなったため拒否されました。" },
  "modulePreview.editRejected": { en: "Module Preview edit was rejected.", ja: "Module Previewの編集が拒否されました。" },
  "modulePreview.dragStale": { en: "Module Preview drag state is stale.", ja: "Module Previewのドラッグ状態が古くなっています。" },
  "modulePreview.noWritableOwner": { en: "Module Preview geometry has no writable authored owner.", ja: "Module Previewのジオメトリに書き込み可能な作成元がありません。" },
  "modulePreview.dragTargetUnavailable": { en: "Module Preview drag target is unavailable.", ja: "Module Previewのドラッグ対象を利用できません。" },
  "modulePreview.bakeNotCurrent": { en: "Module Preview Bake was rejected because its state is not exact-current.", ja: "Module Preview Bakeの状態が正確な現在の状態ではないため拒否されました。" },
  "modulePreview.bakeDisabledEvaluationFailed": { en: "Module Preview Bake could not evaluate disabled geometry.", ja: "Module Preview Bakeのdisabledジオメトリを評価できませんでした。" },
  "modulePreview.bakeDisabledTargetsStale": { en: "Module Preview Bake was rejected because its disabled targets became stale.", ja: "Module Preview Bakeのdisabled対象が古くなったため拒否されました。" },
  "modulePreview.empty": { en: "No valid Module Preview", ja: "有効なModule Previewがありません" },

  "modulePreview.parameters.title": { en: "Module Preview Parameters", ja: "Module Previewパラメータ" },
  "modulePreview.parameters.unknownType": { en: "unknown", ja: "不明" },
  "modulePreview.parameters.required": { en: "required", ja: "必須" },
  "modulePreview.parameters.optional": { en: "optional", ja: "任意" },
  "modulePreview.parameters.valueFor": { en: "Value for {name}", ja: "{name}の値" },
  "modulePreview.parameters.pickReferenceFor": { en: "Pick reference for {name}", ja: "{name}の参照を選択" },
  "modulePreview.parameters.pick": { en: "Pick", ja: "選択" },
  "modulePreview.parameters.useDefaultFor": { en: "Use default for {name}", ja: "{name}にデフォルトを使用" },
  "modulePreview.parameters.useDefault": { en: "Use default", ja: "デフォルトを使用" },
  "modulePreview.parameters.target": { en: "Target", ja: "対象" },
  "modulePreview.parameters.context": { en: "Context", ja: "コンテキスト" },
  "modulePreview.parameters.parameter": { en: "Parameter", ja: "パラメータ" },
  "modulePreview.parameters.value": { en: "Value", ja: "値" },
  "modulePreview.parameters.default": { en: "Default", ja: "デフォルト" },
  "modulePreview.parameters.status.current": { en: "Current preview", ja: "現在のプレビュー" },
  "modulePreview.parameters.status.lastGood": { en: "Showing the last valid preview while inputs are invalid.", ja: "入力が不正なため、最後に有効だったプレビューを表示しています。" },
  "modulePreview.parameters.status.noValidPreview": { en: "No valid preview for the current inputs.", ja: "現在の入力に有効なプレビューがありません。" },
  "modulePreview.parameters.unavailable.no-session": { en: "Open Module Preview to edit its parameters.", ja: "Module Previewを開くとパラメータを編集できます。" },
  "modulePreview.parameters.unavailable.not-ready": { en: "Module Preview is loading its exact current target.", ja: "Module Previewは正確な現在の対象を読み込んでいます。" },
  "modulePreview.parameters.unavailable.source-stale": { en: "Module Preview parameters are waiting for the refreshed source.", ja: "Module Previewパラメータは更新されたSourceを待機しています。" },
  "modulePreview.parameters.unavailable.target-unavailable": { en: "The Module Preview target is not available in the current source.", ja: "現在のSourceでModule Previewの対象を利用できません。" },
  "modulePreview.parameters.unavailable.disposed": { en: "The Module Preview panel is no longer available.", ja: "Module Previewパネルは利用できなくなりました。" },
  "modulePreview.parameters.diagnostic.required-value-missing": { en: "Parameter \"{name}\" requires a value.", ja: "パラメータ「{name}」には値が必要です。" },
  "modulePreview.parameters.diagnostic.invalid-expression": { en: "Value for \"{name}\" is not a valid Module argument expression in this context.", ja: "「{name}」の値はこのコンテキストで有効なModule引数式ではありません。" }
} satisfies TranslationCatalog;

const resolvedCatalogFor = (catalog: TranslationCatalog, locale: "ja" | "en"): Record<string, string> => {
  const translator = createTranslator(catalog, locale);
  return Object.fromEntries(Object.keys(catalog).map((key) => [key, translator(key)]));
};

export const webviewPresentationFor = (displayLanguage: string | undefined): VscodeWebviewPresentation => {
  const locale = resolveLocale(typeof displayLanguage === "string" ? displayLanguage : "en");
  return {
    locale,
    strings: resolvedCatalogFor(webviewPresentationTranslationCatalog, locale),
    diagnosticTemplates: resolvedCatalogFor(diagnosticTranslationCatalog, locale)
  };
};
