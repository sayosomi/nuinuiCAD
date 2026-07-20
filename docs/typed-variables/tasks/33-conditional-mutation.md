# 33: Conditional branch mutation TS/Rust

## 1. タイトル

33: Conditional branch mutation TS/Rust

## 2. 目的

ifのactive branch内setを逐次実行し、branch後のouter letへcarryする。

## 3. 依存タスク

25, 32

## 4. 前提API・型

conditional version execution plan、branch-local scope lifetime、post-if environment。

## 5. 対象

then/else active selection、outer set、branch local declaration/set、nested conditional、poison/recovery、TS/Rust parity。

## 6. 対象外

forGroup iteration、qualified outer access。

## 7. 固定仕様

両branchを静的検査するがruntimeはactive側のみ。branch local bindingは外へ漏れず、outer let更新だけ残る。

## 8. 実装方針

25 control resultで30 version recordsをfilterし、同じexecution planをTS/Rust shared fixturesで検証する。

## 9. 変更対象ファイル

TS/Rust scalar control mutation modules、conditional evaluator adapters、parity tests。

## 10. 追加・更新するテスト

then/else carry、inactive error非実行、static error保持、nested branch、local shadow、poison/recovery。

## 11. 互換性条件

setのないconditional output/masksは25と同じ。

## 12. performance条件

active statementsだけ評価。branchごとのdocument clone禁止。

## 13. 完了条件

conditional mutationのfinal environmentがTS/Rust一致し、loopを含まないcaseで完結。

## 14. 次タスクへの引き継ぎ

34がloop body内/周辺の同じsemanticsを再利用する。

## 15. PR境界

conditional mutationだけ。推奨branch slug: `typed-vars/33-conditional-mutation`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
