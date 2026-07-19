# 18: Rust typed-expression evaluator parity

## 1. タイトル

18: Rust typed-expression evaluator parity

## 2. 目的

validated typed ASTをRustで評価し、16 TS referenceと完全parityにする。

## 3. 依存タスク

16, 17

## 4. 前提API・型

Rust `evaluate_typed_expression(ast, env)`とtyped error/value result。

## 5. 対象

全operator、short-circuit、numeric function bridge、string/choice equality、poison propagation。

## 6. 対象外

document const/set/control integration、property/template。

## 7. 固定仕様

shared vectorsのvalue、issue code、dependency binding IDが一致する。float comparison toleranceは既存parity規約。

## 8. 実装方針

Rust scalars/expression.rsへpure evaluatorを置き、test fixture JSONをTS/Rust両方で読む。

## 9. 変更対象ファイル

Rust scalars evaluator/tests、shared `test/fixtures/typed-expressions.json`、parity harness。

## 10. 追加・更新するテスト

16全vector、malformedは17で拒否、short-circuit、numeric geometry refs、choice order mismatch。

## 11. 互換性条件

既存numeric evaluatorは残す。production document pathにはまだ接続しない。

## 12. performance条件

AST node線形。ignored microbenchmarkは記録のみ。

## 13. 完了条件

TS/Rust vector差分ゼロで、document stateなしのpure parityが成立。

## 14. 次タスクへの引き継ぎ

21/25/28/32がこのevaluatorをproduction contextへ接続する。

## 15. PR境界

Rust typed-expression evaluatorだけ。推奨branch slug: `typed-vars/18-rust-expression-eval`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
