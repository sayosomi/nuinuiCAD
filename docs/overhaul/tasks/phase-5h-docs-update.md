# Phase 5h: ドキュメント更新(AGENTS.md / ROADMAP.md / docs/dsl.md / 対応表)

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書 → 5a〜5g・5iの各ハンドバック報告の順で
> 読むこと。
>
> **5a〜5g・5iすべて完了済みの最終タスク**。review境界3は Phase 5 全体レビュー。

## Context

実装系子タスクの完了後、ドキュメントを新アーキテクチャの最終形に合わせる。
コードは変更しない(唯一の例外なし。コードの不整合を見つけたら報告のみ)。

## Goal

AGENTS.md / ROADMAP.md / docs/dsl.md / 対応表 / overhaul文書群が、実装の
現状を正しく記述している状態にする。

## Scope

* **AGENTS.md(差分更新。全面書き換え禁止)**:
  * 保存形式: `.nui` DSLテキスト1ファイルが正準・永続
    (`docs/overhaul/plan.md` と `docs/dsl.md` への参照)。旧JSONは
    レガシーインポータ入力のみ。
  * エディタアーキテクチャ: CodeMirrorアダプタ層の隔離規則(CM型は
    `src/editor/` と `SourceEditorPane.tsx` の外へ出さない)、
    「ファイル全体再シリアライズ禁止・行スプライスのみ」の規則、
    中央flush(`sourceEditSession`)を通す規則。
  * パラメータ編集ポリシー: 読み取り専用インスペクタ+値spanジャンプ+
    コマンドライン作図(フォーム編集UIは廃止済み)。
  * リネームポリシー: 明示コマンドによる伝播(衝突・捕獲は拒否、
    1リネーム=1 Undo)。テキスト直接編集のrenameは伝播しない(dangling
    診断)。
  * 「Source of truth」セクションのファイル一覧を現状へ更新
    (`src/dsl/`・`src/editor/`・`src/document/` の追加、削除済みファイルの
    除去)。既存の製品原則(キーボードファースト・決定論的評価・明示的依存
    エラー・Rust-first・mm・Y-up)は維持。
* **ROADMAP.md(全面書き換え可)**: 現状は刷新前(選択書き出し→`id=` 適用
  フロー)の記述で完全に古い。overhaul完了後の現状と、backlog
  (親文書の「Phase 4レビュー残件ほかの取り扱い」のbacklog行+SVG/PDF・
  タイル印刷等の既存構想)を反映する。
* **docs/dsl.md**: `id=` / `parent=` / `branch=` の位置づけ(正式文法:
  インポータ出力・同一スコープ重名の逃げ道・レコードID)、
  `expanded=` / `elseExpanded=` の削除、rename伝播の対象参照形式と拒否条件
  (5fの確定行列を反映)、無名要素と自動昇格の現仕様。
* **`docs/overhaul/command-id-map.md`**: 5c/5gの結果(リネーム済みID・
  `renameSelectedElement` 追加)を確定反映し、「予定」行が残っていないこと。
* **`docs/overhaul/plan.md` / `tasks/README.md` / Phase 5 親子文書**:
  Phase 5完了の記録(完了日・成果サマリ・逸脱があれば記録)。子文書は既存の
  要件・調査根拠を残し、status / 実装結果 / review結果 / 最終申し送りを追記する。
* フルチェック実行: `npm test` / `npm run test:parity` / `npm run build` /
  `npm run lint` / `npm run desktop:build`(notarization警告は想定内)。
  親文書「完了条件(Phase全体)」のgrep確認も本タスクで実施して報告する。

## Out of Scope

* コード変更(1行も変更しない。テスト・設定含む)。
* AGENTS.mdの製品原則・評価規則の変更。
* 新機能・新方針の追加(記述は実装済みの現状のみ)。

## Existing APIs / files to reuse

* 5a〜5g・5iの各ハンドバック報告(変更点の一次情報)。
* `docs/overhaul/plan.md` の「主な削除対象」「横断リスクと防衛」— 完了状況の
  突き合わせ元。

## Invariants(このタスク固有の事故防止)

* 文書間の相互参照(相対リンク)がすべて実在ファイルを指す。
* AGENTS.mdの記述はコードの現状より先行しない(未実装の理想を書かない)。
* 歴史的記録(phase-3d-command-id-map.md等)は書き換えず、確定版への参照を
  追記するに留める。

## Edge cases

* 5a〜5g・5iで計画から逸脱した実装があった場合: 文書は**実装を正**として記述し、
  逸脱一覧を報告する。

## Tests

* なし(ドキュメントのみ)。フルチェックがgreenであることの確認は実施。

## Manual verification

* 各文書のリンク切れ確認(相対パスの実在)。

## Completion criteria

* 上記文書がすべて更新され、Phase全体の完了条件grepとフルチェックの結果を
  添えて報告。**Phase 5全体レビュー(review境界3)を依頼**。

## Dependencies

* 5a〜5g・5iすべて。

## Handoff to next task

* Phase 5全体レビューへ: 文書同期、検証結果、コード変更なしの確認、既知の
  `resolution-change` 過剰拒否、キャンセル表示の意味差、性能カバレッジ backlog を
  提出する。

## Status / 実装結果（2026-07-16）

**完了。** 本タスクは文書のみを変更した。現行コードを正として、旧 DSL
パネル／JSON 正準保存／フォーム編集／予定状態の command ID を現役記述から除去し、
Phase 5 各子文書へ完了結果を追記した。

## Verification / review 境界 3

相対 Markdown link、command ID 対応表、削除済み source の現役参照、Phase 5 の
依存・完了状態、文書以外の差分なしを確認した。`npm test`、`npm run test:parity`、
`npm run build`、`npm run lint`、`npm run desktop:build` はすべて成功した。

desktop build の notarization 未設定 warning、Vite の chunk-size warning、BigInt の
`TOLERATED_TRANSFORM` 表示は成功を妨げなかった。検証失敗はなく、環境要因による
blocking はない。

## Phase 5 全体レビューへの申し送り

コード修正を要する候補は、絶対パスを serializer が出力できないことによる安全側の
`resolution-change` 拒否、途中編集 Esc と `キャンセル（Esc）` 表示の意味差、
`missing-input` 時の ghost/validation 重複計算である。いずれも本タスクでは修正せず、
ROADMAP と親文書の backlog に残した。
