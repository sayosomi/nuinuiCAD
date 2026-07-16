# P5: registry 駆動 serializer

種別: 未接続 / 依存: P1

## 目的

`CadElement` → v2 正準形(縦型ブロック+論理 1 行)を registry 駆動で出力する
serializer を作る。現行 `dslSerializer.ts` の 27 分岐 switch の置換先。

## 対象範囲

- 新規 `src/dsl/dslSerializeElement.ts`:
  - `SerializedStatement`(header / args / close — [plan.md](../plan.md) 確定仕様 3)
  - `serializeElementStatementBlock(element, refs)`
  - `serializeElementStatementLogical(element, refs)`(正準 1 行結合)
  - コンテナヘッダ(group/if/for、位置引数を含む 1 行形)と `var` 短形式の出力
- ユニットテスト。

## 対象外

- 設定文・文書全体・ブロック木(`layoutElementTree` は C1)。既存
  `dslSerializer.ts` の変更(`DslSerializerRefs`・`flatRefs`・`documentDslRefs` は
  import して流用する。refs は既存 export であり未接続方針に反しない)。

## 実装要点

- registry(P1)の args 順に、要素の実値を `refs.numeric/anchor/endpoint/token` で
  文字列化して `args: [{key, text}]` を作る。省略規則は現行 `commonBaseAttrs` と
  同方針(非デフォルト時のみ)。`exclusiveGroups` は `placementMode` の実値側だけを
  出す(between/onLine)。
- 共通引数の正準順は確定仕様 1.2(locked → visible → enabled → color → steps →
  vars → [varIds, id] → roles → parent/branch)。`refs.includeRecordIds` /
  flat か document かの差も現行の `flatRefs`/`documentDslRefs` の意味を踏襲する。
- `vars` / `steps` は `[k: v; …]`(`: ` 正準・`;` 区切り)、`intermediates` は現行
  record 形式のまま。
- 無名要素は名前を空にする(`point = coordinate(`)。
- `var` 式モードかつ共通属性が全デフォルト → 短形式 `var 名 = 式`
  (`args: []`, `close: null`)。それ以外の variable は call 形。
- コンテナは `header` に全体(`group 名 (args)` / `if 名 (条件 …)` /
  `for 名 (i from: … …)`)を持ち `close: null`。`{` は付けない(ブロック木側 = C1 が
  付与する)。

## テスト

- 全 27 型: populated サンプル(全フィールド非デフォルト)と minimal サンプル
  (デフォルトのみ)の block / logical 出力のスナップショット的検証。
- 共通属性の省略規則と正準順。flat refs と document refs の差(id/parent/branch)。
- 無名・引用が必要な名前・負数式・record 類。
- コンテナ 3 種と `var` 短形式/call 形の切り替わり。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。製品コードからの import なし
  (既存 refs 型の import は可)。

## 次タスクへの引き継ぎ

- P7 が round-trip の serialize 側に、P8 が `SerializedStatement` に、P9 が span 解決
  対象テキストに使う。C1 で `dslSerializer.ts` の旧 switch を削除しこれに差し替える。
- (完了時に追記)
