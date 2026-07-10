# Phase 1c-2: previewElements分離(previewが正準stateを触らなくなる)

> 全体計画: `docs/overhaul/plan.md`、親文書: `phase-1c-text-canonical.md` を
> 必ず先に読むこと。AGENTS.md の規則に従うこと。
> Phase 1c は 1c-1 → 1c-2 → 1c-3 → 1c-4 の直列4分割で実装する。
> 本タスクはその第2段(1c-1完了後)。**正準はまだJSONスナップショットのまま**。

## 目的

Canvasドラッグ中のpreviewを、正準state(`elements`)への直接上書きから
独立フィールド `previewElements` へ分離する。1c-3で `sourceText` が正準に
なったとき「ドラッグ中はテキスト・履歴に一切触れない」を構造的に保証する
ための地均し。

安全根拠(調査済み): ドラッグは常にドラッグ開始時スナップショットの
`baseElements` を起点に計算しており(`src/commands/geometryEditCommands.ts:27,73`)、
previewが `state.elements` へ書き込まれることに依存する呼び出し元はない。

## 変更対象

### cadDocumentStore

* 状態に `previewElements: CadElement[] | null` を追加(初期値 null)。
  履歴・dirty・影テキスト・保存に一切関与しない一時状態。
* `previewDocumentChange(change)`(`cadDocumentStore.ts:394`)— **署名維持**。
  `change.elements` だけを `previewElements` にセットする実装へ変更。
  `normalizeSnapshot` は通さない(previewはcommitted要素+deltaの派生で、
  IDも不変のため防衛不要)。現行の非テスト呼び出し元は
  `geometryEditCommands.ts:22,38,68,86` のみで、常に `{elements}` を渡す。
* **全コミット経路(`withShadowCommit` 到達点)・undo/redo・replaceDocument が
  `previewElements: null` をセットする。** no-opコミット(`snapshotEquals` が
  true で `return {}` する経路 `cadDocumentStore.ts:400,407`)でも必ず
  `return { previewElements: null }` としてクリアする(ゼロdeltaドラッグ終了時の
  preview残留を防ぐ)。
* `commitDocumentChangeFromSnapshot`(`cadDocumentStore.ts:404`)は
  「previewが正準を汚した状態から履歴beforeを救う」ための仕組みだったので、
  本Stage以降 `commitDocumentChange` と実質等価になる。**署名は維持**し
  (呼び出し元 `geometryEditCommands.ts:43,91` の書き換え禁止)、内部実装を
  同一に畳んでよい。

### effectiveElements selector と消費者の切替

`previewElements ?? elements` を返すselector(名称例: `effectiveElements`)を
`cadDocumentStore` 側に用意し、**表示・評価系の消費者**を切り替える:

* effective 読みへ切替(現行の「ドラッグ中もライブ更新」挙動を保存する):
  * `src/components/AppLayout.tsx:84` → `useEvaluationEngine` 入力(:122)。
    **評価入力の切替が本丸。**
  * `src/components/DrawingCanvas.tsx:113`(描画・`useCanvasOverlayData`・
    ヒットテスト。ドラッグ開始スナップショット取得 :177,191 は committed 側の
    値を使うことに注意)
  * `src/components/RightPanel.tsx:50` / `src/components/LeftPanel.tsx:236`
  * `src/components/PrintLayoutView.tsx:366,667` /
    `src/components/PrintLayoutPreviewWindow.tsx:126`
* **committed(`elements`)のまま**:
  * コマンド層の `getState().elements` 全箇所(committed文書への操作)
  * `src/components/DslPanel.tsx:150`
  * `GroupTemplateLibraryDialog.tsx:48` / `SelectionColorPickerDialog.tsx:9` /
    `ShortcutHelpOverlay.tsx:33` / `TemplateInsertionPanel.tsx:49`

## 守るべき不変条件

* preview中に `elements` / `past` / `future` / `dirtySinceSave` / 影テキストが
  一切変化しない。
* previewElementsの要素IDはcommitted要素と同一(ドラッグ変換は座標だけを
  変える)。選択・評価キャッシュへの影響なし。
* 既存の preview → commit 分離(1ドラッグ=1履歴エントリ)を維持。
* `commitDocumentChange` / `previewDocumentChange` /
  `commitDocumentChangeFromSnapshot` の署名維持。呼び出し元は無変更。
* 評価境界 `evaluate_document(input)` は無変更(入力の要素配列が
  effective になるだけ)。

## Phase開始時点の前提

* Phase 1c-1 完了済み(fold状態はモデル外)。

## 完了条件

* Canvasドラッグ(実アプリ確認): ドラッグ中リアルタイム追従、確定で
  履歴+1のみ、ゼロdeltaドラッグ・キャンセルでpreview残留なし。
* `npm test` / `npm run build` / `npm run lint` / `npm run test:parity` 成功
  (評価入力に触れるため parity 必須)。
* full suite 10回連続実行でflake未再現を記録。

## 必須テスト

* preview連打が `elements` / `past` / `dirtySinceSave` / 影テキストを
  一切変えないこと。
* commit(通常・no-op両方)/ undo / redo / replaceDocument で
  `previewElements` がクリアされること。
* preview中の評価入力が `effectiveElements` を追うこと
  (`useEvaluationEngine` レベルのテスト)。
* preview → commit で1履歴エントリのみ増えること(既存テストの維持)。

## やってはいけないこと

* 正準反転・commitText・Undo構造変更(1c-3)、selection移動(1c-4)の先取り。
* `previewDocumentChange` に elements 以外のpreview対応を追加すること
  (呼び出し実態がないため。必要になったらそのPhaseで)。
* 呼び出し元コマンド(`geometryEditCommands.ts` ほか)の「ついで」リファクタ。
* 保存形式・拡張子の変更(Phase 1d)。
