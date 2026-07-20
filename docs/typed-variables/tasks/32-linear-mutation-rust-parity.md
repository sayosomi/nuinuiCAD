# 32: Linear set mutation Rust parity

## 1. タイトル

32: Linear set mutation Rust parity

## 2. 目的

binding version IRとset payloadをRust production gated pathで評価し、31とparityにする。

## 3. 依存タスク

18, 21, 30, 31

## 4. 前提API・型

Rust binding version/current slot/history payload、final scalar results。

## 5. 対象

全type set、source order、poison/recovery、cross-binding current lookup、TS payload conversion。

## 6. 対象外

conditional/forGroup mutation。

## 7. 固定仕様

value/type/issue code/version order/final resultが31と一致。invalid payloadはfail-closed。

## 8. 実装方針

Rust scalars/mutation.rsへlinear walkerを置き、declaration environmentをin-place slot更新する。

## 9. 変更対象ファイル

Rust mutation module/state/payload、TS adapter/eligibility、shared parity fixtures。

## 10. 追加・更新するテスト

31全fixture、malformed target/version、choice payload、poison recovery、desktop command。

## 11. 互換性条件

setなしoutput不変。legacy evaluator path不変。

## 12. performance条件

version数に線形。setごとのenvironment全clone禁止。

## 13. 完了条件

linear mutation shadow mismatchゼロ、control setはまだ未接続。

## 14. 次タスクへの引き継ぎ

33 conditional、34/35 forGroup、48/49 hardeningへ引き継ぐ。

## 15. PR境界

Rust linear mutationだけ。推奨branch slug: `typed-vars/32-linear-mutation-rust`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
