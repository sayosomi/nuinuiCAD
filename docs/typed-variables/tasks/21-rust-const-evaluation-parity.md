# 21: Rust const/let initializer evaluation parity

## 1. タイトル

21: Rust const/let initializer evaluation parity

## 2. 目的

scalar declaration programをRust production engineのgated pathで評価し、20とparityにする。

## 3. 依存タスク

18, 19, 20

## 4. 前提API・型

Rust binding environment/computed scalar payload、TS payload conversion、eligibility/parity support。

## 5. 対象

version0 declaration order、geometry numeric refs、poison/issues、computed scalar order、IPC result。

## 6. 対象外

set/control/property/template activation。

## 7. 固定仕様

20とvalue/type/issue/order一致。payload options/typeを毎binding検証。Rust-first command名不変。

## 8. 実装方針

Rust scalars/bindings.rsを追加し、main evaluation loopのgated pre/post pointsへprogram statementを接続する。

## 9. 変更対象ファイル

Rust evaluation input/state/payload/scalars bindings、TS payload adapters/eligibility、parity tests。

## 10. 追加・更新するテスト

20全cases、malformed payload、missing binding/geometry、effective enabled、desktop command serialization。

## 11. 互換性条件

scalarProgramなしはexisting outputと同じ。legacy computedVariables untouched。

## 12. performance条件

250/1000 Rust wall-timeをignored benchmarkで記録し、通常CIはcorrectnessのみ。

## 13. 完了条件

declaration-onlyv3 fixtureでTS/Rust shadow mismatchゼロ。

## 14. 次タスクへの引き継ぎ

23-25/28/32がproduction scalar environmentを使う。

## 15. PR境界

Rust declaration integrationだけ。推奨branch slug: `typed-vars/21-rust-const-eval`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
