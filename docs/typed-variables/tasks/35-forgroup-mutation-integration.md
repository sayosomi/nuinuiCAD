# 35: forGroup mutation production integration

## 1. タイトル

35: forGroup mutation production integration

## 2. 目的

34 coreをexisting TS/Rust forGroup expansion/evaluationへ接続し、実element/propertyとfinal environmentをproduction gated pathで動かす。

## 3. 依存タスク

34

## 4. 前提API・型

forGroup evaluator scalar frame hooks、generated row/resultのbinding version metadata。

## 5. 対象

template expansion、generated references、active/hidden/disabled/showGenerated、evaluation limit、nested control、final carry。

## 6. 対象外

新しいloop syntax、parallel iteration、Inspector rendering。

## 7. 固定仕様

existing generated ID/row/orderを維持。showGeneratedは表示だけ。disabled/inactive loopはmutationしない。

## 8. 実装方針

既存`forGroupExpansion.ts`/Rust `for_group.rs`へenter/execute/leave hookを追加し、clone payloadへbinding environmentを複製しない。

## 9. 変更対象ファイル

TS/Rust forGroup evaluator/integration、payload/parity/performance fixtures。

## 10. 追加・更新するテスト

34 cases+geometry property、generated rows、disabled/inactive、showGenerated false、nested, evaluation limit, TS/Rust parity。

## 11. 互換性条件

setなしforGroup output byte/semantic parity維持。

## 12. performance条件

250/1000 generated elementsを00 protocolで別測定。baselineとの差とscalingを記録し50へ渡す。

## 13. 完了条件

loop mutation/final valueがTS/Rust一致し、45 Inspectorがfinal結果を安全に利用可能。

## 14. 次タスクへの引き継ぎ

45 runtime Inspector、48/49/50 release gatesへ引き継ぐ。

## 15. PR境界

forGroup production integrationだけ。推奨branch slug: `typed-vars/35-forgroup-mutation`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
