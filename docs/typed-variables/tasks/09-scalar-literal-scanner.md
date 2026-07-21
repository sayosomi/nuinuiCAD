# 09: Scalar literal scanner / string escapes

## 1. タイトル

09: Scalar literal scanner / string escapes

## 2. 目的

typed declaration/expression/templateが共有するliteral tokenizationとexact spansを実装する。

## 3. 依存タスク

08

## 4. 前提API・型

`scanScalarLiteral(source, span)`、string raw/cooked value、escape spans、boolean/choice/number token result。

## 5. 対象

single/double quote、全8 escape、raw newline拒否、unknown escape diagnostic、true/false予約、bare choice token。

## 6. 対象外

declaration grammar、operators、template hole解析。

## 7. 固定仕様

serializer canonicalは別taskだがscannerはround-trip可能なraw/cooked情報を返す。`\{`/`\}`を失わない。

## 8. 実装方針

既存generic DSL term splitterを変更せず、value span内専用scannerを新moduleに置く。

## 9. 変更対象ファイル

新規`src/scalars/literalScanner.ts`とtests。必要ならDSL span type adapter。

## 10. 追加・更新するテスト

quotes、各escape、Unicode、日本語、unknown escape exact span、physical newline、unterminated string、reserved boolean。

## 11. 互換性条件

legacy v2 text unquote behaviorは変更しない。scannerはnui3 typed positionsだけで使用。

## 12. performance条件

入力lengthに線形。長いstring property fixtureを追加。

## 13. 完了条件

10/14/26が同じscannerを利用でき、escape仕様がfixture化。

## 14. 次タスクへの引き継ぎ

10はinitializer literal、14はexpression token、26はtemplate raw stringを接続する。

実装済みAPI (`src/scalars/literalScanner.ts`、production未接続):

```ts
export interface ScalarSpan { readonly start: number; readonly end: number; }

export const scanScalarLiteral: (source: string, span: ScalarSpan) => ScalarLiteralScanResult;
// ScalarLiteralScanResult =
//   | ScalarStringLiteralToken  { kind:"string", span, quote:'"'|"'", raw, cooked, escapes }
//   | ScalarNumberLiteralToken  { kind:"number", span, raw, value }
//   | ScalarBooleanLiteralToken { kind:"boolean", span, raw:"true"|"false", value }
//   | ScalarChoiceLiteralToken  { kind:"choice", span, raw }
//   | ScalarLiteralScanError    { kind:"error", issueCode, span, message }
//
// ScalarStringEscape = { span, raw, cooked } — one entry per \\ \" \' \n \r \t \{ \}
// occurrence, absolute offsets into `source`. issueCode ∈
// "unterminated-string" | "physical-newline-in-string" | "invalid-string-escape"
// | "invalid-literal-token" (the last is scanner-local, not in plan.md's
// diagnostic catalog — callers remap it to a context-specific code).
```

呼び出し規約:

- `scanScalarLiteral`は例外を投げない。常にresultを返す(discriminated union)。
- `span.start`から1 tokenだけ読む。`span.end`を超えて読まない。呼び出し側が
  既に切り出した"value span"やexpressionのtoken位置を渡す。空白/演算子の
  スキップは呼び出し側の責務(scannerは最初の文字だけで種別を判定する)。
- `ScalarStringLiteralToken.raw`はquote内側の生テキスト(escape未処理)。
  `quote + raw + quote === source.slice(span.start, span.end)`が常に成立する
  (round-trip)。`cooked`は完全unescape済み。`escapes`のspanは`source`への
  絶対offset。
- number tokenは`/^\d+(?:\.\d+)?|^\.\d+/`(符号・指数なし、
  `numericExpressionParser.ts`と同形)。`Number.isFinite`を満たさない場合は
  `number` tokenではなく、一致した桁全体のspanを持つ`invalid-literal-token`
  errorを返す(fail-closed)。
- bare word tokenは`/^[\p{L}_][\p{L}\p{N}_]*/u`(Unicode/日本語対応、DSLの
  `isBareDslIdentifierChar`より狭く、`@`と構造記号を含まない)。`"true"`/
  `"false"`は常に`boolean`、それ以外は`choice`候補。choice optionsへの
  membership検証は呼び出し側(10/15)の責務。
- `src/dsl`への依存なし。`ScalarSpan`は`DslSpan`(`{start,end}`)と構造的に
  互換なので、既存の値をそのまま渡せる — 専用adapterは不要だった。

呼び出し側の想定接続:

- 10 (typed declaration): string/boolean/choiceのinitializer literalをこの
  scannerでtoken化する。number initializerは既存numeric expression経路を
  引き続き使う(このscannerのnumber tokenは主に14向け)。
- 14 (TS expression parser): 独自のtokenizerがoperator/`@name`/括弧を
  処理し、literalの開始位置でだけ`scanScalarLiteral`へ委譲する。
- 26 (text template analysis): `label(text: ...)`のraw quoted sourceに対して
  文字列全体を1回scanし、返ってきた`escapes`から`\{`/`\}`の位置を得て、
  それ以外の未escape`{`/`}`だけをhole区切りとして扱う。

## 15. PR境界

literal scannerだけ。推奨branch slug: `typed-vars/09-literal-scanner`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
