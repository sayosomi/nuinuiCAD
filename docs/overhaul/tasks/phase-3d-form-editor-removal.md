# Phase 3d: フォーム型パラメータ編集の廃止とInspector完全移行

> 親文書: [phase-3-inspector.md](phase-3-inspector.md)。
> 着手前に `AGENTS.md` → `docs/overhaul/plan.md` →
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md) →
> 3a/3b/3cの各文書を読むこと。**3bと3cの両方の完了後に着手する。**

## 目的

右ペインを読み取り専用の `InspectorPanel` のみにし、フォーム型編集UI、旧
parameter edit mode、direct key、dependency jump互換を除去する。文書を書き換える
経路はSource Editorの値span編集と `stepSourceValueForward` /
`stepSourceValueBackward` に限定する。Inspectorは値を書き換えず、行の選択、値span
へのジャンプ、参照pickの開始だけを担う。

`ExpressionInsertTray` は削除しない。テンプレート挿入専用ヘルパーとして残し、
RightPanel・フォーム用state・open/close/toggle commandから切り離す。

## 完成後の操作

* `e` はInspectorのパラメーター行、`j` は依存行へフォーカスする。
* Inspector内の ↑/↓ は現在の区分内で行を移動し、`activeRowKey` を唯一の行選択
  stateとする。旧 `selectedDependencyJumpIndex` は使わない。
* `Enter` は選択行に対応するSource Editor値spanへジャンプする。`Esc` は
  直前のCanvasまたはSource Editorへ戻る。
* 参照可能な行は `P` と行内ボタンで `startInspectorParameterPick` を開始する。
  commandには必ず `{ elementId, parameterKey }` を渡し、point / line / numeric
  referenceの既存pick commandへ振り分ける。非対象行は安全なno-opとする。
* `i` は `toggleInspectorPanel` へ付け替える。数値の増減はSource Editor内の
  Alt+→/←だけで行い、フォーム用の左右矢印、`[`/`]`、Space bindingは削除する。

## 実装変更

* `RightPanel` から `ElementEditor` とフォーム用 `ExpressionInsertTray` を外し、
  編集input、入力ref配線、フォーム専用CSSとテストを削除する。
* フォーム編集コンポーネントと、不要になった `parameterEditorShared` の部分を
  削除する。Inspector表示で実利用される共有表示部品だけは残す。
* `InspectorPanel` のhandleを「parameter行へ移動」「dependency行へ移動」「現在の
  区分で前後移動」「行を有効化」「参照pick開始」「終了」に整理する。
* command registryに `focusInspectorParameterRows`、`focusInspectorDependencyRows`、
  `selectNextInspectorRow`、`selectPreviousInspectorRow`、`activateInspectorRow`、
  `exitInspector`、`startInspectorParameterPick`、`toggleInspectorPanel` を追加する。
  旧IDはregistry・palette・default binding・`CommandId` 型に残さない。
* keyboard scopeを `parameter` / `dependencyJump` から `inspector` に置換する。
  `e`、`j`、通常時Enter、Inspector内のEnter/Esc/↑/↓、`P`、`i` の既定bindingを
  新IDへ付け替える。
* `cadUiStore` から `isParameterEditMode`、`selectedParameterKey`、
  `isDependencyJumpMode`、`selectedDependencyJumpIndex`、フォーム用expression insert
  target/input targetを削除する。`showElementInfoPanel` は
  `isInspectorExpanded` へ狭く改名する。
* `parameterDefinitions.ts` から `directKey` と検索・テストを除去する。作成command群が
  設定していた `selectedParameterKey` も除去する。
* テンプレート側はローカル表示stateを正とする。helperを閉じる際はテンプレート用の
  計測・pick stateだけを取消し、`activeMeasurementInsertTarget`、計測挿入、数値参照
  挿入、既存pick commandはテンプレート用途として維持する。

## 保存済みshortcutの移行

対応表は [phase-3d-command-id-map.md](phase-3d-command-id-map.md) を唯一の正とする。
設定はcommand IDでなく `bindingId` を保存しているため、読込時に同表の旧binding
ID→新binding ID対応を適用する。新IDの既存overrideを最優先し、複数の旧bindingが同じ
新bindingへ移る場合は保存順で重複しないchordを併合する。代替先のない廃止ID、未知ID、
不正recordだけを安全に除去する。

移行または除去後の正規化済み設定はlocalStorageとTauri設定に書き戻す。書戻しに失敗
しても、読込済み設定の利用は継続する。

## 守るべき不変条件

* `sourceText` が唯一の文書上の正。Inspectorは直接値を書き換えない。
* `dslLineValueSpans` 系が編集可能な値の唯一の定義であり、Inspector専用の値span解析を
  作らない。
* selection-only操作はUndo履歴へ追加しない。dirty bufferでは現在のCMテキストを基準に
  し、IME composition中にjump・patch・数値変更を実行しない。
* CodeMirror型・importを `src/editor/` と `SourceEditorPane.tsx` の外へ漏らさない。
* Phase 4には触れない。Phase 5まで全面的なAGENTS.md更新や無関係な互換コードの大掃除を
  先取りしない。

## 必須テスト・検証

* registry、palette、shortcut dialog、default bindings、`CommandId` 型から旧IDが消え、
  旧IDのdispatchが未登録として安全に失敗すること。
* 旧shortcut overrideの移行、新ID優先、複数旧bindingの併合、廃止・未知IDの除去、
  移行結果の永続化をlocalStorageとTauri invoke境界で検証する。
* Inspectorの `e` / `j` / Enter / Esc / ↑↓ / `P`、Canvas・Source Editorへの復帰、
  point・line・numeric referenceのpick開始、非対象行のno-opを検証する。
* 既存fixtureで全27要素型についてInspector行→Source Editor値spanジャンプ→編集commit、
  および対象数値でAlt+←/→ステップを検証する。
* テンプレート挿入で参照helper、数値参照、測定挿入、閉じる・取消しが維持され、
  RightPanelに編集input・フォームhelperがないことを検証する。
* `src` とテストコードに削除済みファイル、旧ID、旧stateへの参照が残らないことを静的
  確認する（対応表文書は除外）。`npm test`、`npm run build`、`npm run lint` を実行する。
* macOS TauriでInspector→ジャンプ編集→数値ステップ→保存・再起動・読込、日本語IME編集を
  手動確認する。

## 引き継ぎ

Phase 5でAGENTS.mdを全面更新する。3dでは本タスクと矛盾する「explicit parameter edit
mode / direct key」規則だけを、Inspector行ナビゲーション・Source Editor値span編集・
Source Editor数値ステップを正とする最小置換にとどめる。
