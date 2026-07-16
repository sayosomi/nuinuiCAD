# P9: 値 span v2 解決

種別: 未接続 / 依存: P1, P5, P7

## 目的

v2 論理テキスト上でパラメータ → 値 span を解決する registry 駆動実装を作る。
現行 `src/dsl/dslParameterSpans.ts` の 311 行型別 switch の置換先。Alt+←/→・
クリック選択・Canvas ピック・jump-to-parameter が依存する中核。

## 対象範囲

- 新規モジュール(例 `src/dsl/dslParameterSpansV2.ts`):
  - `resolveParameterValueSpan` 互換のシグネチャ(論理テキスト + element +
    parameterKey [+ committedLineText])で v2 形式を解決。
  - 一般則: `argNameForParameter(type, parameterKey)`(P1)で引数キーを引き、
    論理テキスト上のその引数の値 span を返す(P2 スキャナを流用してよい)。
  - 特殊ケースの維持: 要素名 span、`variable:{id}:value`(vars record 内)、
    `intermediate:…`(record 内)、座標の `:x` / `:y` サブ span、
    distance/ratio(placementMode の実在側)、コンテナの位置引数
    (if.condition / for.variable)、`var` 短形式の式 span。
- ユニットテスト。

## 対象外

- 既存 `dslParameterSpans.ts` / `dslValueSpans.ts` / controller の変更(C1 で
  差し替え)。物理 span 射影(既存 projection 層のまま)。

## 実装要点

- 対象テキストは P5 の `serializeElementStatementLogical` 出力(正準 1 行)と、
  非正準の手書き 1 行形式の両方で解決できること(現行も committed/live の
  2 テキストで解決している — `committedLineText` フィンガープリント方式を踏襲)。
- 現行実装の呼び出し規約(戻り値の span 形・見つからない場合の null)を変えない。
  C1 での差し替えを「import 先の変更 + 旧 switch 削除」だけにする。
- record 内サブ span(vars / intermediates)は現行のフィンガープリント一致方式を
  移植する。

## テスト

- 全 27 型 × 全 parameterKey: P7 の正準リテラル上で span が値文字列と一致すること
  (`getParameterDefinitions` の全キーを機械的に回す網羅テスト)。
- 座標サブ span・vars/intermediates record・distance/ratio・コンテナ位置引数・
  `var` 短形式。
- 非正準入力(引数順の入れ替え・余分な空白)でも解決できること。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。製品コードからの import なし。
- 全 parameterKey 網羅テストが green(解決不能キーはゼロ。意図的に span を持たない
  キーがあればテスト内で明示リスト化)。

## 次タスクへの引き継ぎ

- C1 が `dslParameterSpans.ts` の switch を削除し本実装を最終名で配線する。
  モジュール名の「V2」は C1 で除去(リネーム)する。
- (完了時に追記)
