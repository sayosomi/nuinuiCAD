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

## 15. PR境界

literal scannerだけ。推奨branch slug: `typed-vars/09-literal-scanner`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
