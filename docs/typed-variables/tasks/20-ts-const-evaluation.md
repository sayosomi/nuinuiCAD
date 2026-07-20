# 20: TypeScript const/let initializer evaluation

## 1. タイトル

20: TypeScript const/let initializer evaluation

## 2. 目的

source order、scope、dependency graphを使ってtyped declaration initializerをTS referenceで評価する。

## 3. 依存タスク

16, 19

## 4. 前提API・型

`evaluateScalarDeclarations(program, geometryContext)`、binding environment、computed/poison results。

## 5. 対象

const/let version0、prior binding refs、numeric geometry refs、invalid/cycle exclusion、computed order。

## 6. 対象外

set、if/loop mutation、Rust、property。

## 7. 固定仕様

initializer failureはtyped poison。forward/self/cycleは13 issueを使い再判定しない。後方geometry依存は既存order error。

## 8. 実装方針

19 valid programを1 passし、16 evaluatorへenvironmentを渡す。computed resultはbinding ID key map。

## 9. 変更対象ファイル

新規declaration evaluator、TS evaluation adapter/payload conversion、focused tests。

## 10. 追加・更新するテスト

全type literals/refs、outer initializer、geometry measurement、poison、order、hidden/disabled dependencyとの関係。

## 11. 互換性条件

legacy computedVariables mapは維持し、typed resultを別mapに追加する。

## 12. performance条件

program+ASTに線形。250/1000 reference測定を記録。

## 13. 完了条件

TS referenceでdeclaration final version0が得られ、property/set未接続で完結。

## 14. 次タスクへの引き継ぎ

21がRust、27がtemplate、31がsetを接続する。

## 15. PR境界

TS declaration evaluationだけ。推奨branch slug: `typed-vars/20-ts-const-eval`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
