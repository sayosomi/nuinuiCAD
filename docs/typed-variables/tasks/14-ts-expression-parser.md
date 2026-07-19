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

numeric arithmetic、comparison、equality、`!`、`&&`、`||`、parentheses、scalar literals、単一`@name` reference。

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

## 15. PR境界

TS expression parser/ASTだけ。推奨branch slug: `typed-vars/14-ts-expression-parser`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
