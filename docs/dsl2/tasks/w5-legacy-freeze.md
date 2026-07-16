# W5: v1 パイプラインの凍結コピー

種別: v1 で配線(コピーのみ・製品経路は未接続) / 依存: なし

## 目的

C1 で live の v1 parser/compiler が削除される前に、v1 文書を読むためのコードを
`src/document/legacyDsl/` へ凍結コピーしておく。F1(open 時変換)の材料。

## 対象範囲

- 新規 `src/document/legacyDsl/` — 現行ファイルの凍結コピー:
  `dslParser.ts`、`dslCompiler.ts`、`dslTokens.ts`、`logicalStatementSourceMap.ts`、
  `dslReferences.ts`、`dslReferenceTokens.ts`、`dslTypes.ts`、および import 閉包上
  必要な最小限の DSL 層ヘルパ。共有してよいもの(`src/types/geometry.ts`、
  `src/parameters/parameterDefinitions.ts`、`src/geometry/numericExpressions` 等、
  v2 移行で変わらないモジュール)はコピーせず import のまま。
- facade `src/document/legacyDsl/parseLegacyV1Document.ts` —
  `parseLegacyV1Document(source): { elements, palette, visibilityRoles/Profiles,
  printLayouts, evaluationLimitIndex, diagnostics }`(現行 `compileDslDocument` 相当
  の結果。戻り値型は v2 で変わらない既存の document data 型に合わせる)。
- fixture `src/dsl/__fixtures__/sample.v1.nui` — 現行 `sample.nui` のコピー
  (C1 で `sample.nui` が v2 化された後も v1 テスト入力として残すため)。
- 凍結コピーの動作テスト(sample.v1.nui を parse+compile して要素数・代表
  フィールドを検証)。

## 対象外

- open 境界への配線・変換 UI(F1)。凍結コピーの改善・リファクタ(凍結物は
  以後触らない。lint 除外が必要なら設定で明示)。

## 実装要点

- コピーは C1 の**前**に行うこと(C1 後は live から v1 コードが消える)。
- 凍結コピー内の相対 import をディレクトリ内で自己完結させる。live の
  `src/dsl/` から import しない(C1 で変わるため)。
- ファイル冒頭に「凍結コピー。編集禁止。削除条件は docs/dsl2/tasks/f4 参照」の
  コメントを付ける。
- コピーした v1 dslTypes と live の型の衝突を避けるため、facade 以外を
  ディレクトリ外へ export しない。

## テスト

- `parseLegacyV1Document(sample.v1.nui)` が live の現行 parse+compile と同一の
  要素列(deep-equal)を返すこと(このテストは C1 後、live 側が v2 になったら
  「凍結側単独の期待値固定」に書き換える — C1 の対象として明記)。
- v1 の全糖衣形・`element type=`・継続行・`parent=` fallback を含む入力の parse。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。
- 製品経路(open/save)は未接続のまま。
- 凍結ディレクトリが live `src/dsl/` に依存していない(import 検査)。

## 次タスクへの引き継ぎ

- C1 へ: live との等価テストの書き換え(上記)。
- F1 が facade を open 境界へ配線する。F4 が削除条件成立後にディレクトリごと消す。
- (完了時に追記)
