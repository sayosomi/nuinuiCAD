# 24: group.printEnabled typed runtime

## 1. タイトル

24: group.printEnabled typed runtime

## 2. 目的

`group.printEnabled`へboolean bindingを接続し、activityとは独立したprint stateとして評価する。

## 3. 依存タスク

21, 22

## 4. 前提API・型

effective print-enabled resolver using scalar environment。

## 5. 対象

print layout group inclusion、print preview/export mask、poison/error、TS/Rust parity。

## 6. 対象外

activity state、forGroup showGenerated、通常geometry property。

## 7. 固定仕様

hidden/disabled activityとは別軸。printEnabled falseはprintだけ除外しCanvas/evaluationに影響しない。

## 8. 実装方針

print selection pipelineにtyped resolverを注入し、activity compose関数へfieldを追加しない。

## 9. 変更対象ファイル

print layout/evaluation modules、parameter capability、Rust/TS print state payload or adapter、tests。

## 10. 追加・更新するテスト

true/false/ref、hidden+print combinations、disabled、poison、profiles/layouts、TS/Rust parity。

## 11. 互換性条件

nui 3 literal `printEnabled` behaviorを維持する。legacy JSON/DSL round-tripは対象外で、互換fixtureやadapterを追加しない。

## 12. performance条件

print traversal中のbinding lookupだけ。別全document passを追加しない。

## 13. 完了条件

print state truth tableがactivityとは独立してgreen。

## 14. 次タスクへの引き継ぎ

45 Inspector/51 manual print E2Eへ引き継ぐ。

## 15. PR境界

printEnabled runtimeだけ。推奨branch slug: `typed-vars/24-print-enabled`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
