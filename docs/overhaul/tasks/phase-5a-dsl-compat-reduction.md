# Phase 5a: DSL互換の縮小掃除(includeIds + expanded=/elseExpanded=)

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書の順で読むこと。
>
> 5b-1 / 5b-2 / 5c / 5d と相互独立・並行可。同時進行時は本タスクを先に
> mergeする(親文書のmerge順)。

## Context

当初のPhase 5は `id=` / `parent=` / `branch=` のDSL互換削除を掲げていたが、
調査でこれらが現役文法(インポータ出力・同一スコープ重名の逃げ道・レコードID)
であることが判明し、削除は取りやめになった(親文書「前提修正1」)。
残る真の互換残骸は次の2つだけであり、本タスクで削除する:

1. `SerializeDslOptions.includeIds`(`dslTypes.ts`)— flat書き出しで `id=` を
   省略するオプション。現在のcallerはテスト2ファイルのみ
   (`dslSerializer.test.ts` / `dslParameterSpans.test.ts`)。正準経路
   (`documentDslRefs` / `textPatch`)は使っていない。
2. `expanded=` / `elseExpanded=` 属性の互換受理+非推奨警告
   (`dslCompiler.ts` 854行付近)— Phase 1c-1で折りたたみ状態を文書モデル外へ
   出した際の移行期互換。

## Goal

上記2つを削除し、`src/dsl/` から移行期互換コードをなくす。DSL文法・
シリアライズ出力・インポータ・補完の挙動は変えない。

## Scope

* `SerializeDslOptions.includeIds` の削除:
  * `dslTypes.ts` の型定義から削除。
  * `dslSerializer.ts` の `flatRefs` は常に `id=` を出力する形へ固定。
  * caller側テスト(`dslSerializer.test.ts` の「serializes without ids」、
    `dslParameterSpans.test.ts` の `{ includeIds: true }` 指定)を追従更新。
    「id=なしflat出力」をテストしていたケースは削除するか、正準経路
    (`documentDslRefs`)のスナップショットに置き換える。
* `expanded=` / `elseExpanded=` 互換の削除:
  * まず現状の未知属性の扱い(診断の有無・文言)を調査すること。
  * `dslCompiler.ts` の専用受理+`非推奨です` 警告を削除し、未知属性として
    既存の標準的な扱いへ合流させる。既存に未知属性診断がなければ、この2属性の
    ための特別扱いは残さず単に削除する(黙って無視される一般属性と同じ扱い。
    独自の新診断カテゴリを発明しない)。
  * 対応するテスト(警告文言をassertしているもの)を更新。

## Out of Scope

* `id=` / `parent=` / `branch=` の受理・コンパイル・シリアライズ挙動
  (親文書「前提修正1」により存続)。
* レガシーインポータ(`legacyImport.ts`)と `preserveElementOrder` /
  `flatRefs` の出力内容。
* 重名 `@変数` 補完(`dslVariableCompletionCandidates.ts`)を含む補完系。
* role / view / printLayout / palette 文のレコード `id=`。
* DSL文法の変更・新診断カテゴリの追加。

## Existing APIs / files to reuse

* `src/dsl/dslSerializer.ts` — `flatRefs` / `documentDslRefs` の役割分担
  コメント(B-7修正済み)を正とする。
* `src/dsl/dslCompiler.ts` — 属性処理ループの既存パターン。

## Invariants(このタスク固有の事故防止)

* インポータのroundtripが不変: 「レガシーJSON → `importLegacyCadDocument` →
  パース診断ゼロ → 要素・palette・printLayoutsが一致」の既存テストが
  そのままgreenであること(なければこのタスクで追加せず5b-1に委ねる。
  既存があるかをまず確認)。
* `serializeElementsToDsl` のデフォルト出力(id=付きflat)が1文字も変わらない
  こと(既存スナップショットテストで担保)。
* `.nui` 正準出力(`documentDslRefs` 経由)が1文字も変わらないこと。
* 補完・値span・textPatch のテストが無変更でgreenであること(これらのモジュール
  を編集しない)。

## Edge cases

* 開発中に保存された `.nui` に `expanded=` が残っている場合の読み込み:
  削除後は警告なしで無視される(または未知属性の既存診断)。製品は本番
  未投入のため破壊的変更は許容(AGENTS.md)。挙動をテストで固定すること。
* `includeIds` を `false` で呼んでいた外部コードがないことをgrepで最終確認
  (`includeIds` 参照ゼロ)。

## Tests

* `expanded=` / `elseExpanded=` 付きテキストのコンパイル結果(無視される・
  警告が出ない)のテスト更新。
* flat書き出しのスナップショット(id=付き)不変。
* grep完了条件: `includeIds` がsrc/以下でゼロ。

## Manual verification

* 不要(UIに触れない)。`npm test` / `npm run build` / `npm run lint` のみ。

## Completion criteria

* `SerializeDslOptions.includeIds` と `expanded=` / `elseExpanded=` 互換
  コードが削除され、上記Invariantsのテストがすべてgreen。
* 親文書の検証コマンド(test / build / lint)green。DSL側の変更のみのため
  `test:parity` は評価・payload に触れた場合のみ。

## Dependencies

* なし(Phase 4完了のみ)。5b系・5c・5dと並行可。

## Handoff to next task

* 5h(ドキュメント)へ: docs/dsl.md に「`id=` / `parent=` / `branch=` は
  正式文法(インポータ出力・重名逃げ道)」「`expanded=` 系は削除済み」を
  反映する必要がある旨を申し送る。

## Status / 実装結果（2026-07-16）

**完了。** `SerializeDslOptions.includeIds` は削除され、flat serializer は常に
`id=` を出力する。`expanded=` / `elseExpanded=` の専用互換・警告も除去済みで、
折りたたみ状態は DSL 正準文書に含めない。`id=` / `parent=` / `branch=` は
レガシーインポータと文書文法の現役属性として変更していない。

## Review 結果・最終申し送り

serializer、parameter span、文書 roundtrip の既存テストで正準出力を確認した。
以後この文書の Scope は実装予定ではなく完了時の境界記録として読むこと。
