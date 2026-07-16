# Phase 5b-1: レガシー文書形式のデッドコード削除

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書の順で読むこと。
>
> 5a / 5c / 5d と相互独立・並行可。**5b-2 は本タスク完了後**
> (`documentFormat.ts` が重なるため直列)。

## Context

`.nui` 正準化(Phase 1d)以降、旧 `.nuinui.json` はレガシーインポータ
(`legacyImport.ts`)専用の入力形式になった。調査の結果:

* `src/document/documentMigration.ts`(`migrateDocumentToYUp`)は importer
  ゼロの完全なデッドコード。
* `src/document/documentFormat.ts` は現役だが、インポータが実際に使うのは
  `parseCadDocumentFile` と `LEGACY_CAD_DOCUMENT_EXTENSION` のみ。
  パース結果のうち `selected*` / `printLayout` ミラーはインポータが読まない
  (`legacyImport.ts` は elements / palette / visibilityRoles /
  visibilityProfiles / activeVisibilityProfileId / printLayouts /
  activePrintLayoutId / evaluationLimitIndex だけを使う)。
* ただし `CadDocumentSnapshot` / `CadDocumentSelectionSnapshot` 型と
  `docToLegacySnapshot` は in-memory の change/history 型として
  `cadDocumentStore` / `cadUiStore` が現役利用している。**これらの再構成は
  5b-2 の領分**であり、本タスクでは触らない。

## Goal

レガシー文書形式まわりの「誰も呼ばないコード」を削除し、
`documentFormat.ts` をインポータ+in-memory型が実際に使う面へ縮小する。
レガシーインポータの動作は完全に維持する。

## Scope

* `src/document/documentMigration.ts` の削除(念のため着手時に importer
  ゼロを再確認すること)。
* `documentFormat.ts` の縮小:
  * export のうち、src/(テスト以外)から参照されていないものを削除。
  * レガシーJSONパースのうち、インポータも in-memory 型も使っていない
    フィールドの処理を削除できるかを**使用箇所の実測で**判定する。
    `selected*` / `printLayout` ミラーの**型定義と `docToLegacySnapshot`
    は5b-2の対象なので残す**(パース側での取り込みが完全に未使用と実証
    できた場合のみパース側を先に落としてよい)。
  * schemaVersion受理(5/4/3)はインポータの入力互換なので変えない。
* レガシーインポートのroundtripテストの確認・追加: 代表的なレガシーJSON
  (重複名・非連続グループ・image要素を含む)→ `importLegacyCadDocument` →
  `parseDsl` 診断ゼロ → 要素数・名前・親子・printLayouts一致。既存テストが
  あれば流用し、なければこのタスクで追加する。

## Out of Scope

* change/スナップショット型(`CadDocumentSnapshot` /
  `CadDocumentSelectionSnapshot`)の再構成、`selected*` / `printLayout`
  ミラーの型削除、読み手の派生化 — すべて**5b-2**。
* `legacyImport.ts` 自体の変更(出力形式・命名規則・image path処理)。
* `documentFile.ts` の読み込みフロー変更。

## Existing APIs / files to reuse

* `src/document/legacyImport.ts` — 実際の使用面の正。
* `src/document/documentFile.ts:157` 付近 — インポータ呼び出し経路。

## Invariants(このタスク固有の事故防止)

* レガシーインポータの入出力が1バイトも変わらない(roundtripテストで固定)。
* `.nui` の保存・読込(`nuiFormat.ts`)に触れない。
* 削除は「importer実測ゼロ」を確認したもののみ。推測で消さない。
* `cadDocumentStore` / `cadUiStore` / `useCadStore` は編集しない
  (5b-2とのmerge衝突防止)。

## Edge cases

* schemaVersion 3/4 のレガシーJSONが引き続きインポートできること。
* image要素を含むレガシーJSONのパス変換(`imagePathForDocument`)が不変。

## Tests

* インポートroundtripテスト(上記)。
* `documentMigration` 参照ゼロのgrep確認。
* 既存の `documentFormat` 系テストの追従更新(削除したexportの分のみ)。

## Manual verification

* 実アプリで旧 `.nuinui.json` を1つインポートし、要素・印刷レイアウトが
  表示されること(手元にサンプルがなければテストroundtripで代替可と報告)。

## Completion criteria

* `documentMigration.ts` が存在しない。`documentFormat.ts` に「テスト以外の
  参照がないexport」が残っていない(5b-2対象の型は除く)。
* roundtripテストを含め test / build / lint green。

## Dependencies

* なし(Phase 4完了のみ)。5a / 5c / 5d と並行可。

## Handoff to next task

* 5b-2へ: `documentFormat.ts` に残した `selected*` / `printLayout` ミラー
  関連の型・関数の一覧と、それぞれの現役caller(store/UI/印刷)を申し送る。

## Status / 実装結果（2026-07-16）

**完了。** `src/document/documentMigration.ts` は削除済みで、
`documentFormat.ts` は legacy JSON の parse/import 面だけを保持する。保存先は
`.nui` のままで、`.nuinui.json` は `importLegacyCadDocument` を通る入力だけである。

## Review 結果・最終申し送り

legacy import の roundtrip を維持した。選択状態・単数 print layout ミラーの
in-memory 整理は 5b-2 で完了しており、本タスクの範囲外だった形式変更はない。
