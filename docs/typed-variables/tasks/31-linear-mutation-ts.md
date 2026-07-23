# 31: Linear set mutation TypeScript evaluation

## 1. タイトル

31: Linear set mutation TypeScript evaluation

## 2. 目的

control blockを含まないsource-order setをTS reference binding environmentへ接続する。

## 3. 依存タスク

16, 20, 30

## 4. 前提API・型

version-aware TS environment、current/final values、poison/recovery history。

## 5. 対象

全scalar type、multiple set、reference to current version、RHS failure、recovery、final result。

## 6. 対象外

Rust、if/forGroup set、Inspector。

## 7. 固定仕様

set lineより前はold value、後はnew value。失敗setはpoison、正常setで回復。const setは29で除外。

## 8. 実装方針

20 declaration evaluatorへversion IR walkerを追加し、16 evaluatorにcurrent environment snapshotを渡す。

## 9. 変更対象ファイル

TS scalar mutation evaluator/history types/tests、evaluation result adapter。

## 10. 追加・更新するテスト

line before/after、chained sets、cross-binding refs、all types、choice type、poison/use/recover、final value。

## 11. 互換性条件

setのないnui 3 typed documentは20 resultと同じ。legacy pathとのshape/semantic parityは要求しない。

## 12. performance条件

versions+ASTに線形。environment full cloneをsetごとに行わずpersistent/indexed slotsを使う。

## 13. 完了条件

linear fixtureでhistory/final value/errorが決定し、control owner setは未実行として明示除外。

## 14. 次タスクへの引き継ぎ

32 Rust parity、33 conditional、45 Inspector final valueへ進む。

## 15. PR境界

TS linear mutationだけ。推奨branch slug: `typed-vars/31-linear-mutation-ts`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
