# Phase 5h: ドキュメント更新(AGENTS.md / ROADMAP.md / docs/dsl.md / 対応表)

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書 → 5a〜5gの各ハンドバック報告の順で
> 読むこと。
>
> **5a〜5gすべての完了後に着手する最終タスク**。完了時にreview境界3
> (Phase 5全体レビュー)。

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
  (親文書の「Phase 5に含めない事項」+SVG/PDF・タイル印刷等の既存構想)を
  反映する。
* **docs/dsl.md**: `id=` / `parent=` / `branch=` の位置づけ(正式文法:
  インポータ出力・同一スコープ重名の逃げ道・レコードID)、
  `expanded=` / `elseExpanded=` の削除、rename伝播の対象参照形式と拒否条件
  (5fの確定行列を反映)、無名要素と自動昇格の現仕様。
* **`docs/overhaul/command-id-map.md`**: 5c/5gの結果(リネーム済みID・
  `renameSelectedElement` 追加)を確定反映し、「予定」行が残っていないこと。
* **`docs/overhaul/plan.md` / `tasks/README.md`**: Phase 5完了の記録
  (完了日・成果サマリ・逸脱があれば記録)。
* フルチェック実行: `npm test` / `npm run test:parity` / `npm run build` /
  `npm run lint` / `npm run desktop:build`(notarization警告は想定内)。
  親文書「完了条件(Phase全体)」のgrep確認も本タスクで実施して報告する。

## Out of Scope

* コード変更(1行も変更しない。テスト・設定含む)。
* AGENTS.mdの製品原則・評価規則の変更。
* 新機能・新方針の追加(記述は実装済みの現状のみ)。

## Existing APIs / files to reuse

* 5a〜5gの各ハンドバック報告(変更点の一次情報)。
* `docs/overhaul/plan.md` の「主な削除対象」「横断リスクと防衛」— 完了状況の
  突き合わせ元。

## Invariants(このタスク固有の事故防止)

* 文書間の相互参照(相対リンク)がすべて実在ファイルを指す。
* AGENTS.mdの記述はコードの現状より先行しない(未実装の理想を書かない)。
* 歴史的記録(phase-3d-command-id-map.md等)は書き換えず、確定版への参照を
  追記するに留める。

## Edge cases

* 5a〜5gで計画から逸脱した実装があった場合: 文書は**実装を正**として記述し、
  逸脱一覧を報告する。

## Tests

* なし(ドキュメントのみ)。フルチェックがgreenであることの確認は実施。

## Manual verification

* 各文書のリンク切れ確認(相対パスの実在)。

## Completion criteria

* 上記文書がすべて更新され、Phase全体の完了条件grepとフルチェックの結果を
  添えて報告。**Phase 5全体レビュー(review境界3)を依頼**。

## Dependencies

* 5a〜5gすべて。

## Handoff to next task

* なし(Phase 5完了)。backlog(B-5・B-6・性能テスト拡充・インポータ削除
  判断)はROADMAP.mdへ引き継がれる。
