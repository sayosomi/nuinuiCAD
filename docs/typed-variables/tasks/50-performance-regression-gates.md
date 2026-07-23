# 50: Measured performance regression gates

## 1. タイトル

50: Measured performance regression gates

## 2. 目的

00 protocolでnui 3 binding analysis、TS reference、Rust production、forGroup mutationを独立測定し、再現可能なregression gateを置く。

## 3. 依存タスク

00, 13, 18, 21, 35, 36, 39, 49

## 4. 前提API・型

shared performance fixture generator/statistics/report helper、documented benchmark commands。

## 5. 対象

250/1000 same-shape cases、CPU median/p95/scaling、Rust ignored wall-time benchmark、completion/dependency dense variants。

## 6. 対象外

behavior optimization以外の機能追加、UI manual latency、legacy-only parser/evaluator/bridge性能。

## 7. 固定仕様

CIはfinite correctness、1000 case extreme 5000ms guard、250→1000 median scaling <8xを最低gateとする。絶対fine budgetは00/base branchの5回測定medianと3 MADを記録し、noise envelope外ならprofileして修正してから採用する。

## 8. 実装方針

各領域を別test/command/log prefixにし、parallel Vitest noiseを避けsingle workerで測る。Rust wall timeはrecord-only ignored benchmark。

## 9. 変更対象ファイル

performance test/helper、package scripts、Rust performance tests、docs command table。

## 10. 追加・更新するテスト

fixture correctness、stats helper、each measurement finite、scaling/guard assertions、repeatability log。

## 11. 互換性条件

nui 3で引き続き使うperformance scripts/gatesを維持する。legacy-only性能低下は非blockingで、新しいcompatibility benchmarkを追加しない。

## 12. performance条件

このtask自体がgate。未達をthreshold緩和だけで解消しない。根拠はPRに実測値として残す。

## 13. 完了条件

4領域を個別に悪化判別でき、CI/record-only区分と測定条件が明記。

## 14. 次タスクへの引き継ぎ

51で実機体感を確認し、47の手動migration後に52で全nui 3 gateを再確認する。

## 15. PR境界

performance tests/必要な局所optimizationだけ。推奨branch slug: `typed-vars/50-performance`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
