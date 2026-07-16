# Phase 2: CodeMirror 6 左ペイン(構成リスト置換)

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。

> **実装分割(2026-07-11)**: 本Phaseは以下の5タスクへ直列分割する。本ファイルは
> Phase全体の要件と依存順を定める**親文書**であり、実装時は担当する子タスク
> 文書を正とする。
>
> 1. [phase-2a-codemirror-foundation.md](phase-2a-codemirror-foundation.md) —
>    CodeMirror依存・アダプタ境界・source update protocol・性能baseline
> 2. [phase-2b-editor-sync-undo.md](phase-2b-editor-sync-undo.md) —
>    未commit buffer・中央flush不変条件・store/CM Undo統合
> 3. [phase-2c-selection-fold.md](phase-2c-selection-fold.md) —
>    cursor/Canvas選択同期・複数選択・group/else fold
> 4. [phase-2d-diagnostics-keyboard-features.md](phase-2d-diagnostics-keyboard-features.md) —
>    dirty diagnostics・評価decorations・keyboard scope・LeftPanel機能移行
> 5. [phase-2e-left-panel-cutover.md](phase-2e-left-panel-cutover.md) —
>    AppLayout切替・旧リスト削除・1000行性能・手動E2E
>
> **補遺(2026-07-12)**: Phase 2e完了後、実アプリ検証に基づくpolish(dirty時
> Canvas操作の保留・patch highlight・編集可能旧選択行投影・値span選択/Tab移動等)
> を追加した。現在のEditor仕様は
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md)
> を参照。

## 目的

左ペインの構成リストをCodeMirror 6ベースの常設DSLエディタへ置き換える。
`sourceText`を正準としたまま、タイピング中だけCM bufferが先行できるようにし、
Canvas操作・Undo・selection・fold・diagnosticsを一つの編集体験へ統合する。

## Phase全体の確定判断

* store履歴が唯一の文書履歴。CM履歴は未commit typing burst内だけ利用し、commit、
  store Undo/Redo、文書resetの各境界で**実際にclear**する。`isolateHistory`だけを
  履歴clearの代用にしない。
* model patchはdirtyな旧`sourceText`を基準に実行しない。UI側のflushに加えて、
  store action側がdirty patchを拒否する中央防衛を持つ。
* source updateはvanilla Zustandの同期subscriberで全revisionを順に処理する。
  composition中はローカルqueueへ積み、revision gapは全文resetへfallbackする。
* dirty中のsyntax diagnosticsはCM bufferを再parseして作る。last-good compiler/evaluation
  diagnosticsはchangesでmapし、staleであることを表示する。
* foldの正はPhase 2中も`cadUiStore.groupFoldById`。CM fold stateはそのprojectionであり、
  独立した第二の正にしない。
* **元仕様からの明示的変更**: 「複数Canvas選択=複数CM cursor/range」は採用しない。
  primary elementだけを実cursor、secondary selectionを非編集の行decorationにする。
  Canvas選択だけで意図せず複数行同時編集されることを防ぐ。
* mixed LF/CRLFを行単位で完全保存するcodecは作らない。未編集ファイルとuniform
  LF/CRLFは保存し、mixed改行は最初のCMテキストcommitでLFへ正規化する。Canvas等の
  model patchだけではmixed改行を全文正規化しない。BOMは通常の先頭文字として保持し、
  特別な除去・隠蔽をしない。

## 共通不変条件

* 文書順=評価順=表示順。CM関連import・型は`src/editor/`と
  `SourceEditorPane.tsx`の外へ漏らさない。
* composition中はcommit、外部patch、cursor jump、fold projectionを行わない。
* 通常のmodel patchは正確なCM `changes`で反映し、全文置換しない。全文resetを
  許すのはfile/new document/store Undo/Redo/revision gapだけ。
* Phase 2完了時にはLeftPanelを併存させない。DslPanel、右インスペクタ、parameter
  編集、DSL補完、コマンドラインはPhase 3/4/5の範囲なので触らない。
* 各子タスクは`npm test` / `npm run build` / `npm run lint`をgreenにして着地する。

## Phase完了条件

* 常設SourceEditorPaneがLeftPanelを完全に置換している。
* typing、commit、CM Undo、store Undo/Redoを何度跨いでも古いCM履歴へ到達しない。
* cursor/Canvas選択、複数選択、fold、diagnostics、評価状態、検索、pick、既存commandが
  Source Editor上で動く。
* 500〜1000行でtyping、scroll、外部1行patchが性能予算内に収まる。
* macOS日本語IMEとTauri実アプリE2Eを完了している。
