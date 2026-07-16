# W4: エディタ系テストのリテラル間接化

種別: v1 で配線 / 依存: なし

## 目的

エディタ層のテストに散在する v1 DSL リテラルを、serializer 生成・共有ヘルパ経由に
置き換え、C1 の切替時に自動追従するようにする。C1 セッションの差分量を決める
準備タスク。

## 対象範囲

対象テスト(v1 リテラルを含むもの): `dslValueSpans` / `dslValueStep` /
`dslCompletion*` / `cmAutocomplete` / `sourceEditorController*` /
`sourceEditorPickSelection` / `renameAnalysis*` / `statementReconciler` /
`cadDocumentStore` 系のテストファイル。

- リテラルが**手段**(何かの要素を含む文書が欲しいだけ)のテスト:
  `serializeElementStatement` / `serializeDocumentToDsl` / 既存
  `dslDocumentTestUtils.ts` 経由で要素から文書テキストを生成する形へ書き換える。
  必要なら共有ビルダ(要素配列 → 文書テキスト)を `dslDocumentTestUtils.ts` に
  追加する。
- リテラルが**主題**(構文そのものを検証)のテスト: そのまま残し、行頭に
  マーカーコメント `// dsl2-cutover: v1-literal` を付ける。C1 はこのマーカーを
  grep して書き換え対象を列挙する。

## 対象外

- DSL コア層のテスト(`dslParser` / `dslCompiler` / `dslSerializer` /
  `dslDocument` / `textPatch` — 構文が主題なので C1 で P7 の正準リテラルへ
  書き換える)。テストの検証内容の変更(挙動の意味を変えない純リファクタ)。

## 実装要点

- 生成経由化により、期待値(span 位置・行番号など)がハードコードだと serializer
  出力に依存して壊れやすくなる。期待値も生成テキストから導出する
  (`indexOf` 等)か、意味的な検証(span の中身が値文字列と一致する等)へ寄せる。
- 1 ファイルずつ完結させ、全テスト green を保ったままコミット可能な粒度で進める。
- 書き換えの網羅は grep(`point .* = \(`、`key=`、`->` などの v1 構文パターン)で
  棚卸しし、結果の一覧(ファイル → 生成経由化 or マーカー)を本文書の引き継ぎ欄に
  残す。

## テスト

- 既存テストの検証意図を変えずに全 green(本タスク自体が純テストリファクタ)。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。
- エディタ層テストの v1 リテラルが「生成経由」か「マーカー付き」のどちらかに
  分類済みで、未分類リテラルが grep でゼロ。

## 次タスクへの引き継ぎ

- C1 へ: マーカー付きリテラルの一覧(ファイル・個数)をここに記録する。
  生成経由化したテストは C1 で無修正 green になる見込みだが、期待値導出が
  serializer 出力形に依存する箇所は C1 での確認対象。
- (完了時に追記)
