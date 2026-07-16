# P1: construction registry

種別: 未接続(製品コードから import しない) / 依存: なし

## 目的

v2 文法の唯一の正となる construction registry を作る。parser・compiler・serializer・
補完・値 span がすべてこの表を読むことで、要素型ごとの分岐 switch を各所から消す
土台になる。

## 対象範囲

- 新規 `src/dsl/dslConstructions.ts` — [plan.md](../plan.md) 確定仕様 3 の
  `DslArgSpec` / `DslConstructionSpec` と lookup(`constructionFor` /
  `constructionForElementType` / `argNameForParameter` / `commonArgSpecs`)。
  データは確定仕様 2 の対応表(全 27 要素型 + コンテナ)を忠実に転記する。
  variable は `expression` / `pointDistance` / `pointAngle` / `pointLineDistance` の
  4 construction(`preset` で `valueMode` を設定)。
- 新規 `src/dsl/dslConstructionsSettings.ts` — color / role / view / printLayout /
  place ヘッダの引数 spec(確定仕様 1.4)。view の role 可視キーは動的なので
  「固定 spec 外のキーを許す」フラグを持たせる。
- 各ファイルのユニットテスト。

## 対象外

- parse / serialize / compile のロジック(P3, P5, P6)。
- 既存コードの変更・import。`parameterDefinitions.ts` の変更(読むだけ)。

## 実装要点

- `(category, construction)` の組が要素型を決める。`point/offset` と `line/offset`、
  `point/polar` と `line/polar` の同名は正当(lookup は category スコープ)。
- 引数の kind(number/reference/…)や step levels は registry に持たせない。
  `parameterKey` 経由で `src/parameters/parameterDefinitions.ts` の
  `findParameterDefinition` を唯一の正とする。
- `special` 引数(vars/varIds/steps/roles/intermediates/id/parent/branch)は
  parameterDefinitions を経由しないことを型で表す。
- `exclusiveGroups: [["distance","ratio"]]` は between / onLine が使う。
- 位置引数(`positional: true`)は if.condition(→ `condition`)と
  for.variable(→ `variableName`)、place のグループ名、color の hex のみ。
- `use` は category として予約だけする(spec なし。P3 が「未対応」診断に使う)。

## テスト

- 全 27 `CadElementType` に spec が存在し、`constructionForElementType` が引ける
  (`elementTypeLabels` のキー集合と突き合わせる網羅テスト)。
- 全 `DslArgSpec` について、`special` があるか、`parameterKey`(または arg 名)が
  そのサンプル要素の `findParameterDefinition` で実在の定義に解決されること。
  サンプル要素は `createCadElement` 系の factory で作る。
- category スコープの同名 construction が独立に解決されること。
- `argNameForParameter` の往復(spec の全引数で arg→key→arg が一致)。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。
- 製品コードからの import なし(テストのみが参照)。
- 対応表(確定仕様 2)との 1:1 一致がテストで担保されている。

## 次タスクへの引き継ぎ

- P3/P4/P5/P6/P9 はこの registry を import する。データの追加・修正が必要になったら
  この registry と plan.md の対応表を同時に更新すること。
- `src/dsl/dslConstructions.ts` は P1 の公開 API を実装済み。`use` は spec を登録して
  おらず、予約語判定用の定数・API も追加していないため、P3 で parser 側だけで予約語
  として扱うこと。
- `src/dsl/dslConstructionsSettings.ts` は color / role / view / printLayout / place の
  settings spec と `settingsSpecFor` を提供する。view の role 可視キーは
  `allowsDynamicArgs` で表現する。
- registry 整合性テストを成立させるため、既存不足だった variable 測定用
  (`point1` / `point2` / `point` / `lineId`) と image 用
  (`sourcePath` / natural size / DPI / pixels-per-mm) の parameter definition を補完した。
  kind と step levels は引き続き `parameterDefinitions.ts` のみが持つ。variable の
  測定 definition は `valueMode` に応じて公開される。image の追加 definition は
  P1 時点では既存 v1 value-span resolver の対象外であることをテストで明示しており、
  P9/C1 で v2 span 解決へ接続すること。
- `npm test` / `npm run build` / `npm run lint` は green。Rust・parity 対象外。
