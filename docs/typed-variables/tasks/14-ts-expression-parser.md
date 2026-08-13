# 14: TypeScript typed-expression parser / AST

## 1. タイトル

14: TypeScript typed-expression parser / AST

## 2. 目的

scalar initializer/condition/set RHSを表すsource-spanned ASTとoperator precedence parserをproduction未接続で実装する。

## 3. 依存タスク

09, 10

## 4. 前提API・型

JSON-serializable `ScalarExpressionAst`、literal/reference/unary/binary/group nodes、node span、parse diagnostics。

## 5. 対象

numeric arithmetic、comparison、equality、`!`、`&&`、`||`、parentheses、scalar literals、単一`@name` reference、named function call syntax。

named call は `functionName(arg1, arg2)` の形で、callee は bare function name
だけを受け付ける。zero / one / multiple arguments、nested call、通常の typed
expression を使った argument (`max(1 + 2, 3 * 4)`) を構文として扱う。parser は
`functionName` が builtin かどうかを判定せず、`unknownFunction(10)` も parse
成功する。unknown function の resolution、arity、引数型、戻り値型は semantic
phase の後続 task が担当する。将来の user-defined function も同じ call syntax を
使うが、arbitrary callee、first-class function、postfix-call はこの task の対象外。

## 6. 対象外

name resolution、typecheck、evaluation、string concat、qualified reference。

## 7. 固定仕様

precedenceは`!`→算術→比較→equality→`&&`→`||`。choice bare literalはexpected typeなしではunresolved token node。

## 8. 実装方針

既存numeric parserを変更せず、新規`src/scalars/expressionParser.ts`へPratt/precedence parserを置く。09 scannerをliteral tokenに使う。

## 9. 変更対象ファイル

新規expression AST/token/parser modulesとfixture-driven tests。

## 10. 追加・更新するテスト

全operator/precedence、Unicode binding、quotes/escapes、malformed token、missing operand/paren、exact node spans、JSON serialize。

## 11. 互換性条件

legacy NumericValue parserにはimportしない。production未接続。

## 12. performance条件

expression lengthに線形。deep nestingへ明示depth guardを持つ。

## 13. 完了条件

15と17が同じAST schemaを利用でき、parserに型/evaluation分岐がない。

## 14. 次タスクへの引き継ぎ

15がbinding IDとtypeを付与し、17がRust payload schemaを検証する。

実装済みAPI (production未接続):

```ts
// src/scalars/expressionAst.ts
export type ScalarSpan = { readonly start: number; readonly end: number }; // re-exported from literalScanner.ts, not redefined

export type ScalarExpressionAst =
  | { kind: "numberLiteral"; span: ScalarSpan; value: number }
  | { kind: "stringLiteral"; span: ScalarSpan; value: string }        // fully cooked value only
  | { kind: "booleanLiteral"; span: ScalarSpan; value: boolean }
  | { kind: "unresolvedChoiceLiteral"; span: ScalarSpan; raw: string } // Task 15 resolves against an expected choice type
  | { kind: "reference"; span: ScalarSpan; nameSpan: ScalarSpan; name: string } // span includes '@'; nameSpan does not
  | { kind: "call"; span: ScalarSpan; nameSpan: ScalarSpan; name: string; args: readonly ScalarExpressionAst[] }
  | { kind: "unary"; span: ScalarSpan; operator: "!" | "-" | "+"; operand: ScalarExpressionAst }
  | { kind: "binary"; span: ScalarSpan; operator: BinaryOp; left: ScalarExpressionAst; right: ScalarExpressionAst }
  | { kind: "group"; span: ScalarSpan; expression: ScalarExpressionAst }; // span includes both parens

// BinaryOp = "||" | "&&" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/"

export type ScalarExpressionIssueCode =
  | "unexpected-token" | "missing-operand" | "unterminated-group" | "trailing-token"
  | "expression-depth-exceeded" | "chained-comparison-not-supported"
  | "unterminated-string" | "physical-newline-in-string" | "invalid-string-escape"; // last 3 passed through from scanScalarLiteral (09)

export interface ScalarExpressionParseResult {
  readonly ast: ScalarExpressionAst | null;
  readonly diagnostics: readonly ScalarExpressionDiagnostic[]; // { message, span, code }
}

// src/scalars/expressionParser.ts
export const MAX_SCALAR_EXPRESSION_DEPTH = 128;
export const parseScalarExpression: (source: string, span: ScalarSpan) => ScalarExpressionParseResult;
```

呼び出し規約:

- `parseScalarExpression`は`scanScalarLiteral`(09)と同じ絶対offset規約に従う。
  `source`は呼び出し側が保持する完全なlogical text、`span`はその中の対象範囲
  で、返るすべてのnode/diagnostic spanは`source`への絶対offsetである。
  将来の呼び出し(15)は
  `parseScalarExpression(logicalText, declaration.payloadSpans.initializer)`
  の形で10の`DslTypedDeclarationStatement`をそのまま渡せる。
- **結果契約は排他的**: 成功時は`ast`が非null・`diagnostics`が空配列、失敗時は
  `ast`が`null`・`diagnostics`はちょうど1件。両方が同時に存在する状態
  (部分ASTを保持したままdiagnosticも返す等)は一切ない。`trailing-token`も
  他のすべてのcodeと同様に`ast: null`になる。部分ASTやerror recoveryは
  このtaskの対象外であり、必要になった場合は別task側で明示的に設計する
  (今回、当初案にあった「trailing-tokenのときだけ部分ASTを返す」設計は
  ユーザー指示によりこの排他契約へ差し戻した)。
- 内部実装は`ParseFailure`(1つのdiagnosticを運ぶ)を投げ、`parseScalarExpression`
  境界でのみcatchする。生の例外がAPI境界を越えることはない。この構造上、
  parser自身が返すdiagnosticは常に最大1件(tokenizerも最初のエラーで停止する)
  — `diagnostics`が配列型なのは他モジュールとの形状統一のためであり、
  複数エラーの蓄積機構がある訳ではない。
- **precedence/associativity**(loosest→tightest、`src/scalars/expressionParser.ts`の
  `BINARY_PRECEDENCE_TIERS`が単一の定義):
  `||`(chain) → `&&`(chain) → `==`/`!=`(non-chain) → `</<=/>/>=`(non-chain) →
  `+`/`-`(chain) → `*`/`/`(chain) → unary `!`/`-`/`+`(右結合、再帰) → primary。
  比較・equalityは意図的に**非chain**: `1 < 2 < 3`や`1 == 2 == 3`のように
  同階層演算子を連続適用すると`chained-comparison-not-supported`を返す
  (legacy numeric parserの単発比較挙動に合わせた設計判断。ユーザー確認済み)。
  括弧で明示すれば(`(1 < 2) == true`)問題なく解釈できる。
- **depth guard**: 括弧の再帰(`parsePrimary`のgroup分岐)とunary前置の再帰
  (`parseUnary`)にだけ加算する共有counterがあり、`MAX_SCALAR_EXPRESSION_DEPTH`
  (128)を超えると`expression-depth-exceeded`を返す。固定6階層のprecedence
  ladderや同階層chainのwhile-loopはこのcounterを増やさないため、フラットに
  長い式(`1 + 1 + ... `)はネスト深さに関係なくO(1)の追加stack深度で済む
  — 実測でも250→1000演算子でscaling比約4.1倍(ほぼ線形)。**128という定数は
  Node/V8での安全マージンであり、Tauriがbundleするwebview(WebKitGTK/WebView2
  等)の実際のstack余裕は未検証**。この値がTauri環境でも十分安全か、また
  もっと保守的な値にすべきかはproduction接続前(17以降)に別途確認が必要。
- `@name`のUnicode識別子判定は`literalScanner.ts`の`IDENTIFIER_PATTERN`と
  同形の正規表現を`expressionTokenizer.ts`内に別途複製している(import共有
  はしていない)。`literalScanner.ts`自身が`@`と構造記号を自分の識別子判定
  から除外しているのは、この複製が安全に共存できるようにするため。
- 09のliteral scannerはそのまま再利用しており、number/string/boolean/choiceの
  分類ロジックを`expressionTokenizer.ts`側で再実装していない。number literal
  はscanner側で符号なし(`literalScanner.ts`のコメント通り)なので、単項
  `-`/`+`はこのtaskのunary演算子として実装している。

呼び出し側の想定接続:

- **15(TS expression typechecker)**: `unresolvedChoiceLiteral`ノードを
  期待されるchoice型と照合して解決し、各nodeにbinding ID/typeを付与する。
  `reference`ノードの`name`をbinding解決に使う。
- **17(Rust expression payload validation)**: `ScalarExpressionAst`の
  JSON shapeをそのままRust側のdefensive validationスキーマの入力として使う
  (JSON round-trip済みであることをtestで確認済み)。

## 15. PR境界

TS expression parser/ASTだけ。推奨branch slug: `typed-vars/14-ts-expression-parser`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
