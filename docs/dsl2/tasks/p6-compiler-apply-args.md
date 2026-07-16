# P6: compiler 引数適用(applyArgs)

種別: 未接続 / 依存: P1, P2

## 目的

スキャン済み引数列を registry 経由で `CadElement` へ適用する純関数 `applyArgs` を
作る。現行 `dslCompiler.ts` の型別 `applyStatement` 分岐と `parameterAlias` の置換先。

## 対象範囲

- 新規モジュール(例 `src/dsl/dslApplyArgs.ts`):
  - `applyArgs(element, spec, args, resolvers)` — `ScannedArg[]`(P2)+
    `DslConstructionSpec`(P1)を受け、既存の値解決を使って要素へ書き込む。
  - `resolvers` は既存 `src/dsl/dslReferences.ts`(`resolveId` / `resolveAnchor` /
    `resolveEndpoint`)と数値式正規化(`geometry/numericExpressions`)への薄い
    注入点。既存関数を import して使う(未接続方針に反しない: 呼ぶだけで既存
    コードは変えない)。
- ユニットテスト。

## 対象外

- statement 走査・名前索引・ブロック文脈・ID 割当(現行 `compileDslToElements` の
  骨格は C1 で維持)。設定文の適用(C1)。`dslCompiler.ts` の変更(C1)。

## 実装要点

- 引数値の kind 判定は `findParameterDefinition(element, parameterKey).kind` →
  既存 `setParameterValue` 経由。現行 `applyCommonAttributes` の kind 分岐を参考に
  するが、`key=value` 属性名ではなく registry の `parameterKey` で引く。
- `special` 引数の適用: `vars`/`varIds`(local variable ID remap 含む、現行
  `remapLocalVariableReferences` 相当を流用)、`steps`(`numericParameterSteps`)、
  `roles`(group `visibilityRoleIds`)、`intermediates`(record → 
  `intermediatePoints`)、`id`/`parent`/`branch`(要素へは書かず呼び出し側へ返す —
  ID 割当と親子は compile 骨格の責務)。
- `preset`(variable の `valueMode` 等)は適用前に上書き。
- `exclusiveGroups`: 存在した側で `placementMode` を設定(現行
  `withPlacementMode` 相当)。
- 位置引数: spec の `positional` スロットへ写像(if.condition → `condition`、
  for.variable → `variableName`)。
- 未解決参照は現行流儀(raw トークン + warning)を踏襲する。

## テスト

- 全 27 型: P1 のサンプル要素に対し、対応表の全引数を適用して期待フィールドに
  なること(populated / minimal)。
- special 引数それぞれ(vars の ID remap、steps、roles、intermediates)。
- distance/ratio の placementMode 決定。variable 4 construction の preset。
- 数値式・`@変数`・座標・endpoint・参照リスト・choice・boolean の kind 別適用。
- 未解決参照の warning 経路。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。製品コードへの変更なし。
- `applyArgs` は入出力の明確な純関数(要素はコピーして返すか、現行
  `setParameterValue` の流儀に合わせる — 現行に合わせて選び、テストで固定する)。

## 次タスクへの引き継ぎ

- P7 が round-trip の compile 側に使う。C1 で `dslCompiler.ts` の `applyStatement`
  分岐群と `parameterAlias` を削除しこれに配線する。`id`/`parent`/`branch` の
  受け渡し形は C1 実装者が読む前提で明記しておくこと。
- `src/dsl/dslApplyArgs.ts` は `applyArgs(element, spec, args, resolvers)` を公開する。
  戻り値はコピーされた `element`、statement スコープの diagnostics、C1 が所有する
  `metadata` (`id` / raw `parent` token / `branch`)である。ID割当・ブロック親子の優先規則は
  このモジュールでは適用しない。
- `DslApplyArgsResolvers` は名前索引、数値式コンテキスト、visibility roles、intermediate ID
  factoryを受ける。参照解決・数値正規化は差し替え可能で、既定は既存
  `dslReferences` / `numericExpressions` と同じ挙動である。`vars` と `varIds` はソース順に
  かかわらず local-variable ID remap 後の結果になる。
- 全constructionの populated/minimal、special引数、parameter kind、exclusive placement、
  positional引数、未解決参照warningを `dslApplyArgs.test.ts` で固定した。既存live compiler・
  parser・serializer・Rust・評価payloadからは未接続である。
- `npm test` / `npm run build` / `npm run lint` を green で確認した。Rust・parity対象外。
