# Phase 4f: セッション中のゴーストプレビュー

> 親文書: [phase-4-command-line.md](phase-4-command-line.md)。着手前に
> `AGENTS.md` → `docs/overhaul/plan.md` → 親文書 → 4c/4d/4e文書の順で読むこと。

## Context

セッション中、確定済み引数だけで要素が成立するなら、Canvasに暫定表示して
「この確定で何ができるか」を見せたい。ドラッグ編集で実証済みの
`previewDocumentChange`(履歴なし・`previewElements` のみ設定)を使う。
**部分文が暫定コンパイル可能な場合のみ**表示し、偽のデフォルト値で無理に
コンパイルを通さない(親文書の禁止事項)。

**4a-2からの引き継ぎ**: `angleLengthLine` は専用レシピにより
`startPoint:x/y` の重複質問を除いたが、空文書で未入力の `startPoint` は
凍結済み `emitCreationRecipe` を通すとfactory既定の座標 `(0, 0)` のまま残る。
したがって、評価が成功したことだけを根拠にゴーストを出してはならない。

## Goal

参照・数値ステップが充填されるたびに、4a-1 `emitCreationRecipe` で組み立てた部分要素を
`insertionIndex` に挿入したelements配列で `previewDocumentChange` を発行し、
評価が成立すればゴースト表示、しなければ非表示にする。キャンセル・確定・
staleで必ず消える。

## Scope

* セッションの充填フック(4dで集約済みの地点)にプレビュー更新を追加:
  1. 現在の `args` と、現在の `elements`・挿入位置より前の
     `referenceElements` から作る `CreationEmitContext` で
     `emitCreationRecipe` を呼ぶ(名前なしのまま)。
  2. 必須参照がまだ空のステップが要素の評価に必要な場合はプレビューを
     出さない。特に `angleLengthLine.startPoint` はfactory座標既定を評価成功と
     誤認してはならない。必要ならセッションの充填状態を使ってこの未入力を
     判定し、評価結果だけに委ねない。
  3. 成立する場合のみ `previewDocumentChange({elements: 挿入済み配列})`。
* プレビュークリア: キャンセル・確定・staleキャンセル・参照ステップの
  引数変更(再発行)・セッション終了時。既存のドラッグプレビューと同じ
  クリア経路(`previewElements` を戻す既存API)を使う。
* ゴーストの見た目: 既存のプレビュー描画(ドラッグ中表示)と同じ経路に
  乗せる。専用の描画スタイルが既にあるならそれを使い、新しい描画層を
  作らない。最低限「確定前の要素だと分かる」こと(既存スタイル踏襲で可)。

## Out of Scope

* プレビュー中の評価パフォーマンス最適化(既存のドラッグプレビューと同じ
  コストを許容)。
* ピック候補ハイライトの変更(既存のまま)。
* プレビュー要素へのヒットテスト・スナップ(プレビューは表示のみ。
  候補にならない)。

## Existing APIs / files to reuse

* `src/state/cadDocumentStore.ts` `previewDocumentChange` — 履歴・テキスト
  非関与のプレビュー経路(plan.mdの変更入口3)。
* 描画側の `previewElements ?? doc.elements` フォールバック(既存)。
* 4a-1 `emitCreationRecipe` / `CreationEmitContext` / 4bセッション状態。
* `src/geometry/evaluate.ts`(TS参照評価)— プレビュー成立判定に使う場合は
  ドラッグプレビューが現在使っている評価経路と同じものを使うこと
  (新しい評価呼び出しパターンを作らない)。

## Invariants

* プレビューは正準状態(`sourceText`・Undo履歴)に一切触れない。
* **ピック候補は確定済み文書からのみ生成**: プレビュー要素が候補集合・
  ヒットテストに混入しない。
* 偽のデフォルト値で評価を通さない: 欠落参照のある部分要素は表示しない
  (欠落を0や原点で埋めるコードを書かない)。
* プレビューの消し忘れゼロ: セッションが終わる全経路(確定・Esc・stale・
  ウィンドウ間の状態リセット)でクリアされる。

## Edge cases

* number/nameのみのレシピ(freePoint等): 最初の数値充填時点から
  プレビュー可能。
* 参照が全部埋まる前でも評価が成立する型(オプショナル参照)は成立時点で
  表示する。
* 無名要素参照を含む引数(4e)でのプレビュー: 実行時IDのまま評価に通す
  (シリアライズを経ないため昇格不要)。
* プレビュー中に外部コミット(stale)→ セッションキャンセルと同時に
  プレビューも消える。
* `@stop` より後ろへの挿入予定: プレビューも評価区切りの既存意味論に従う
  (区切り後なら評価されず表示もされない。特別扱いしない)。

## Tests

* 充填の進行に応じたプレビューの出現/非出現(欠落参照あり→なし)。
* キャンセル・確定・staleの各終了経路で `previewElements` がnullに戻る。
* プレビュー中の候補集合・ヒットテストにプレビュー要素が含まれない。
* Undo履歴がプレビューで汚れない(履歴長不変)。

## Manual verification

* 実アプリ: line系レシピで始点を充填した時点では非表示(終点欠落)、
  終点充填で線がゴースト表示、数値変更で追従、Escで消える。
  ドラッグプレビュー(既存)との併存で表示が壊れない。

## Completion criteria

* 代表レシピでゴーストが「成立時のみ」表示され、全終了経路で消える。
* `npm test` / `npm run build` / `npm run lint` green。

## Dependencies

* 4d完了(4eと直列推奨だが順序入替は可)。4h・4iと並行可。

## Handoff to next task

* 4g(cutover)は旧即時挿入コマンドを置き換える際、「作成直後から要素が
  見える」という旧フローの利点がゴーストプレビューで代替されていることを
  前提にする。
