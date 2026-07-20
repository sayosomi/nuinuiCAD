# 04: DivisionPlacement production characterization

## 1. タイトル

04: DivisionPlacement production characterization

## 2. 目的

union migration前にdistance/ratioの現行production contractをfixtureで固定する。

## 3. 依存タスク

00

## 4. 前提API・型

新APIなし。現行parser/compiler/model/evaluator/serializer/drag/import/clone/IPCをblack-box検証する。

## 5. 対象

distance-only、ratio-only、both、neither、legacy v1/JSON、duplicate、forGroup clone、TS/Rust、drag、serialize。

## 6. 対象外

tagged union実装やbehavior修正。

## 7. 固定仕様

bothはdiagnosticかつcompiler distance、neitherはratio 0.5、serializerはactive側のみ、Rustはdistance以外ratioという現状を記録する。

## 8. 実装方針

各境界に最小fixtureを置き、同一case tableをTS/Rust/serializationへ流す。

## 9. 変更対象ファイル

DSL compiler/serializer tests、drag/duplication/import tests、Rust point evaluator tests、parity fixture。

## 10. 追加・更新するテスト

調査対象すべてをexplicit assertし、既存不正payloadの結果も記録する。

## 11. 互換性条件

test-only。現行behaviorを変更しない。

## 12. performance条件

対象外。

## 13. 完了条件

05が推測なしでmigration mappingを実装できるcharacterization matrixがmainにある。

## 14. 次タスクへの引き継ぎ

05はこのmatrixのobservable resultを変えず内部shapeだけ変更する。

## 15. PR境界

fixturesだけ。推奨branch slug: `typed-vars/04-placement-characterization`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
