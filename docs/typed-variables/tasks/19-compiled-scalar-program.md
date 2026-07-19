# 19: Compiled scalar program / stable binding IDs

## 1. タイトル

19: Compiled scalar program / stable binding IDs

## 2. 目的

typed declarationをgeometry elementsから分離したsource-order scalar programへcompileする。

## 3. 依存タスク

13, 15

## 4. 前提API・型

`ScalarProgramStatement`、declaration record、scope/binding/source order、typed initializer、program→IPC JSON。

## 5. 対象

valid const/let declaration lowering、stable binding ID inheritance、analysis view、evaluationLimitとのposition mapping。

## 6. 対象外

set statement/version、actual evaluation、UI、fake CadElement。

## 7. 固定仕様

typed declarationは`elements`へ入れない。Rustへ解決済みIDとtyped ASTだけを渡す。source spanはTS analysis側。

## 8. 実装方針

CompiledDslDocumentへoptional gated `scalarProgram`とbinding analysisを追加し、existing elements projectionを維持する。

## 9. 変更対象ファイル

compiler result/types、new scalar program builder、statement reconciler ID mapping、evaluation input adapter/tests。

## 10. 追加・更新するテスト

order、nested scope IDs、invalid declaration exclusion、stable ID reload、JSON-friendly payload、elements unchanged。

## 11. 互換性条件

v2/legacy var compiled document shapeはexisting consumersに対し同じ。optional fieldは空。

## 12. performance条件

program build O(statements+AST)。11/13 indexを再構築しない。

## 13. 完了条件

20/21がdocument compilerを再parseせずdeclaration programを評価できる。

## 14. 次タスクへの引き継ぎ

20 TS const、21 Rust const、29 set、42 metadata Inspectorが利用する。

## 15. PR境界

compiled declaration programだけ。推奨branch slug: `typed-vars/19-scalar-program`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
