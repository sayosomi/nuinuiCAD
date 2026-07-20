# 27: Text template TypeScript evaluation

## 1. タイトル

27: Text template TypeScript evaluation

## 2. 目的

TextTemplateAstをTS referenceで評価し、string/number合成とtyped failureを実装する。

## 3. 依存タスク

16, 20, 26

## 4. 前提API・型

`evaluateTextTemplate(ast, scalarEnv, numericContext)` returning text/error。

## 5. 対象

literal segment、string binding、numeric binding/expression、format、poison/undefined error。

## 6. 対象外

Rust parity、generic concat、boolean/choice stringify。

## 7. 固定仕様

number formatは整数そのまま、非整数最大3桁/末尾0除去という現行結果。hole 1つ失敗でtext geometry fail-closed。

## 8. 実装方針

existing TS text evaluatorからregexを外し、26 ASTと16 evaluatorを使う。

## 9. 変更対象ファイル

TS template evaluator、text element evaluator adapter、focused reference tests。

## 10. 追加・更新するテスト

`前身頃を2枚カット`、numeric existing golden、escaped braces、新line escape、poison、multi-hole order。

## 11. 互換性条件

v2 numeric template outputを変えない。

## 12. performance条件

templateをcompile時にparseし、render/evaluationごとに再scanしない。

## 13. 完了条件

TS text geometryがAST経路で全fixtureを通り、Rust未接続でもfeature gate内。

## 14. 次タスクへの引き継ぎ

28が同fixtureをRustへ接続する。

## 15. PR境界

TS template runtimeだけ。推奨branch slug: `typed-vars/27-template-ts`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
