# 16: TypeScript typed-expression reference evaluator

## 1. タイトル

16: TypeScript typed-expression reference evaluator

## 2. 目的

typed ASTをScalarValueへ評価する純粋reference evaluatorを作る。

## 3. 依存タスク

15

## 4. 前提API・型

`evaluateTypedExpression(ast, environment): ScalarEvaluation`、binding/geometry numeric lookup interface。

## 5. 対象

全初期operator、short-circuit、string/choice equality、numeric function adapter、typed error propagation。

## 6. 対象外

document declaration order、set versions、control flow、Rust。

## 7. 固定仕様

`&&`/`||`はshort-circuit。divide/evaluation failureはtyped error。choice payload typeも比較時に検証。

## 8. 実装方針

environment interfaceへ解決済みbinding ID lookupと既存numeric geometry lookupを注入し、parser/name resolutionを呼ばない。

## 9. 変更対象ファイル

新規`expressionEvaluator.ts`とshared vector tests。

## 10. 追加・更新するテスト

operator vectors、short-circuitで右error非評価、numeric precision、string Unicode、choice equality/mismatch、poison propagation。

## 11. 互換性条件

既存numeric evaluatorを置換しない。typed number function adapterは結果一致testを持つ。

## 12. performance条件

AST node数に線形。shared vectorsの大式sanityを記録。

## 13. 完了条件

TS referenceがparser/typecheckなしでtyped ASTだけを評価し、Rust parity vectorが固定。

## 14. 次タスクへの引き継ぎ

18が同vector、20/27/31がdocument contextを接続する。

## 15. PR境界

TS reference evaluatorだけ。推奨branch slug: `typed-vars/16-ts-expression-eval`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
