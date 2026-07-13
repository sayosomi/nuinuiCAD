# Phase 3: 読み取り専用インスペクタ + フォーム型パラメータ編集の廃止

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。
> Phase 4 と相互独立(並行実装可)。ともに Phase 2 に依存。
>
> **着手前に必読**: Phase 2e完了後にEditorへpolishが追加されている。現在の
> Editor仕様・再利用API・重複実装禁止リストは
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md)
> を正とする。

> **実装分割(2026-07-12)**: 本Phaseは以下の4タスクへ分割する。本ファイルは
> Phase全体の要件と依存順を定める**親文書**であり、実装時は担当する子タスク
> 文書を正とする。
>
> 1. [phase-3a-value-span-jump-api.md](phase-3a-value-span-jump-api.md) —
>    パラメータ→値spanジャンプAPI(ラベル付き値span・parameterKeyマッピング・
>    `SourceEditorHandle` 拡張。UI変更なし)
> 2. [phase-3b-numeric-step-command.md](phase-3b-numeric-step-command.md) —
>    エディタネイティブ値ステップコマンド(`Alt+→/←`、数値/boolean/choice、
>    1操作=1 Undoステップ)
> 3. [phase-3c-inspector-panel.md](phase-3c-inspector-panel.md) —
>    読み取り専用InspectorPanel(行ナビ・Enterジャンプ・旧編集UIと一時併存)
> 4. [phase-3d-form-editor-removal.md](phase-3d-form-editor-removal.md) —
>    フォーム編集・パラメータ編集モードの削除cutover・廃止command ID対応表
>
> 依存順: **3a → (3b ∥ 3c) → 3d**。3bと3cは変更ファイルが交差しないため
> 並行実装可。3dは3bと3cの両方の完了後。各子タスクはアプリが完全に動作する
> 状態(`npm test` / `npm run build` / `npm run lint` green)で着地する。

## 目的

右ペインを読み取り専用インスペクタに再構築する。「見るのは右ペイン、書くのは
DSL」: パラメータ項目を選ぶとエディタの該当行・該当属性の値spanへカーソル
ジャンプする。フォーム型のパラメータ編集UI(ElementEditor と *ElementFields
群)とパラメータ編集モードの値編集を廃止し、値変更の経路を「ジャンプ先での
テキスト編集」と「数値ステップコマンド」に統一する。

## Phase全体の確定判断

* パラメータ→値spanの解決は `src/dsl/dslValueSpans.ts` の拡張(ラベル付き
  span)+pure マッピングhelperで行い、`SourceEditorHandle` の拡張メソッド
  として公開する。Inspector専用のspan解析・selection実装は作らない。
* parameterKeyとDSL attr名は同一ではない(例: `arcLine.startAngleDeg` →
  `start=`)。マッピングの正は `dslSerializer.ts` の出力形とし、全要素型の
  行列テストで乖離を検出する。
* 値の微調整・切替は `Alt+→/←` を現行割当の正とする。数値は現在のstep、
  booleanは反転、choiceは定義順に循環する。既存のSource Editor
  structural shortcut(Mod/Alt+`↑`/`↓`、Shift+Alt+`↑`/`↓`/End、Mod+`[`/`]`)
  およびTab/Shift+Tabの値span移動とは衝突しない。割当変更時もshortcut
  registryを唯一の正とする。
* cutoverは段階着地: 3cでインスペクタを完成させ旧編集UIと併存、3dで削除。
  Phase 3完了時に二重UIを残さない(Phase 2eと同じ原則)。
* 状態バッジはSource Editor state railと同じ意味論(エラー・無効・非表示・
  ロック)。判定ロジックは重複実装せず共有に寄せる(方式は3cで確定)。

## 共通不変条件(全子タスク)

* `sourceText` が唯一の文書上の正。
* CodeMirror型・importを `src/editor/` と `SourceEditorPane.tsx` の外へ漏らさない。
* selection-only操作(ジャンプ・選択)は `Transaction.addToHistory.of(false)`
  でUndo履歴へ追加しない。
* dirty bufferでは現在のCMテキスト(行単独reparse)を基準にする。
* IME composition中にjump・patch・数値変更を実行しない。
* `dslLineValueSpans` 系が「編集可能な値」の唯一の定義。
* main editorとLine Lensで意味論を重複実装しない。
* キーボードファースト: 「要素選択→パラメータへ到達→値変更」がマウスなしで
  完結する状態を、どの子タスクの着地時点でも壊さない。
* インスペクタは読み取り専用。文書を変更するのはジャンプ先でのテキスト編集と
  数値ステップコマンドのみ。
* 依存関係表示は明示的(欠落・無効・後方参照の種別を区別。AGENTS.mdルール)。
* 廃止するコマンドIDは登録から外し、対応表(旧ID→新挙動)をタスク報告に
  含める。ユーザーのショートカット設定を壊さない。
* Phase 4(コマンドライン作図・DSL補完・DslPanel削除)に着手しない。
* Phase 5のハードクリーンアップを先取りしない。
* `parameterDefinitions.ts` は縮小して残す(全削除しない。Phase 4のレシピと
  補完が依存)。

## Phase開始時点の前提

* Phase 2完了済み: SourceEditorPane・カーソル同期・
  `SourceEditorHandle.jumpToElement`・`statementMap` と属性スパンが利用可能。
* Phase 2e完了後のpolish(post-cutover文書参照)も完了済み: 値span解析
  (`dslValueSpans`)・値全体selection・Tab移動・dirty span解決・
  selection-only Undo除外・IME guardは再利用する。
* 選択状態は `cadUiStore`(Phase 1c)。

## Phase完了条件

* 右ペインが読み取り専用インスペクタになり、フォーム編集系ファイルが削除
  されている。
* 全要素型(現在27種。`elementTypeLabels` が正)で、インスペクタのパラメータ
  行からジャンプ→編集→コミットのループが成立。
* 値ステップコマンドが現在の数値step・boolean・choiceを正しく扱う。
* 廃止command ID対応表が報告されている。
* `npm test` / `npm run build` / `npm run lint` 成功。

## Phase横断の確認事項(子タスクで確定し報告)

* **pick開始経路**(3dで確定): `startPointPick` / `startNumericReferencePick`
  / `startLinePick` の現在の唯一のUI入口は削除対象のフォームエディタ群にある。
  代替経路を削除前に確定する(詳細は3d文書)。
* 数値ステップの倍率修飾/段階切替の扱い(3bで確定)。
* `dependencyJump` modeのインスペクタ行ナビへの吸収可否(3cで確定)。
* `ExpressionInsertTray` の計測値挿入ワークフローの扱い(3dで確定)。
