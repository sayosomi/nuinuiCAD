# P2: 引数スキャナ

種別: 未接続 / 依存: なし

## 目的

論理テキスト(1 行に結合された statement)から call 引数列を切り出す純粋スキャナを
作る。v2 の「引数境界は depth 0 の `identifier:`+空白」規則の唯一の実装点。

## 対象範囲

- 新規 `src/dsl/dslArgScanner.ts` — [plan.md](../plan.md) 確定仕様 3 の
  `ScannedArg` / `scanCallArgs`。
- ユニットテスト。

## 対象外

- statement 種別の判定・registry 照合(P3)。物理行との対応付け(既存 projection
  層の仕事)。record 内部(`vars` / `steps` / `intermediates`)の解釈(P6)。

## 実装要点

- 入力は論理テキストと call 範囲(開き `(` の直後〜対応する `)` の直前の `DslSpan`)。
- 先頭の位置引数: 最初の depth 0 `key:` 境界までのトークン列を `key: null` の
  `ScannedArg` として返す(空なら位置引数なし)。位置引数が正当かは呼び出し側
  (P3)が registry で判定する。
- `key:` 認識は「裸識別子 + `:` + (空白または値開始)」。quote-aware・depth-aware
  (`()` / `[]` ネスト)。既存 `src/dsl/dslTokens.ts` の `splitDslTerms` /
  `lastIndexOfDslOutsideQuotes` 等を流用できるなら流用し、足りなければ depth 追跡
  ヘルパを dslTokens.ts に足すのではなく本ファイル内に閉じる(未接続方針)。
- value は次の depth 0 `key:` 境界または call 終端まで。前後空白を除いた span を持つ。
- エラー: 空の値(`key:` の直後に境界)、`:` の後の空白欠落、key の重複はここでは
  検出しない(重複は P3 が registry 文脈で診断)。span 付きで返す。

## テスト

- 縦型相当(値に空白を含む式 `@幅 * 2`)/ 1 行形式 / 混在。
- 位置引数のみ・位置引数+named・named のみ。
- ネスト値: `(0, 0)`、`[AB, CD]`、`[高さ: 10; 幅: @x * 2]`(record 内 `:` が
  境界と誤認されないこと)、引用文字列内の `(` `:` `#`。
- 修飾参照 `前身頃::交点`・派生点 `AB.end` が値として無傷で通ること。
- 空値エラーの span。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。製品コードからの import なし。
- スキャナは論理テキストのみに依存する純関数(状態・IO なし)。

## 次タスクへの引き継ぎ

- P3(call parser)と P6(applyArgs)が `ScannedArg` を消費する。
- `scanCallArgs` は `callSpan` を開き `(` の直後から対応する `)` の直前までの半開区間として扱う。`keySpan` はコロンを含まず、`valueSpan` は前後空白を除く。
- `key: value` のコロン後空白不足は回復的に named 引数として返したうえでエラーにする。空値は次の引数キーまたは call 終端のゼロ幅 span にエラーを付ける。重複キーと registry 文脈での検証は引き続き P3 の責務。
- 新規スキャナは未接続であり、テスト以外の既存製品コードから import していない。
