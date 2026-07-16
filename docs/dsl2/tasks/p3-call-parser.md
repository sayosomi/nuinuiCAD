# P3: 要素/コンテナ call parser

種別: 未接続 / 依存: P1, P2

## 目的

論理テキスト 1 statement を v2 文法で解析し、statement 構造(種別・名前・
construction・引数 span・診断)を返す parser を作る。C1 で `dslParser.ts` の
dispatch 先になる。

## 対象範囲

- 新規 `src/dsl/dslCallParser.ts`:
  - 要素文 `<category> [名前] = <construction>( 引数… )`
  - コンテナヘッダ `group 名 [(args)] {` / `if [名] (位置条件 [named…]) {` /
    `for [名] (位置変数 named…) {`(ヘッダ 1 行限定、`{` は行末または次行)
  - `var 名 = 式` 短形式(call 形の `var 名 = construction(...)` は要素文として扱う)
  - `use` 予約(「未対応」診断)
- ユニットテスト。

## 対象外

- 設定文(P4)。compile(P6)。物理行グルーピング(C1 の sourceMap 変更)。
  既存 `dslParser.ts` / `dslTypes.ts` の変更(結果型は本ファイル内に新設し、
  C1 で `DslStatement` へ接続する)。

## 実装要点

- 結果型は既存 `DslStatementBase` に合わせやすい形(name/nameSpan/keywordSpan/
  payloadSpans/attrs 相当+ `category` / `construction` / `opensBlock`)を本ファイルで
  定義する。span はすべて論理オフセット(`DslSpan`)。
- 引数は P2 の `scanCallArgs` で切り、P1 の registry で検証:
  未知 category / 未知 construction(候補列挙)/ category 不一致 / 未知引数(候補
  列挙)/ 重複引数 / 必須引数不足 / 位置引数の重複・非対応位置引数 / `)` 後の余剰
  トークン(ブロック合法位置の `{` を除く)— [plan.md](../plan.md) 確定仕様 1.6。
- `exclusiveGroups`(distance xor ratio)は「両方あり」を診断。「どちらも無し」は
  診断しない(factory デフォルトに任せる)。
- 名前は既存 `formatDslName` / `unquoteDslString` の規約に従う(引用名対応)。
- 診断は statement スコープ(行+span)。パニックせず、可能な限り部分結果を返す。

## テスト

- 全 27 要素型の正常 parse(1 行形式。縦型は論理結合後の形なので同値)。
- コンテナ 3 種(引数あり/なし・名前あり/なし・`{` 行末/次行)。
- `var` 短形式と `var x = pointDistance(...)` call 形の判別。
- 確定仕様 1.6 の全診断がメッセージ・span 付きで出ること。
- `point/offset` と `line/offset` が category で正しく別型に解決されること。
- `use` の予約診断。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。製品コードからの import なし。
- 診断メッセージは日本語で、対象(category / construction / 引数名)と候補を含む。

## 次タスクへの引き継ぎ

- P7 が round-trip の parse 側としてこれを使う。C1 が `dslParser.ts` から dispatch し、
  結果型を `DslStatement` へ写像する。
- (完了時に追記)
