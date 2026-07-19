# 30: Binding version intermediate representation

## 1. タイトル

30: Binding version intermediate representation

## 2. 目的

declaration version0とset後続versionをsource orderで表すevaluation-neutral IRを定義する。

## 3. 依存タスク

29

## 4. 前提API・型

`BindingVersionId`、declare/set version records、predecessor、control owner/scope、read-at-position query。

## 5. 対象

linear version chain、set target ID、poison-capable slot、if/loop control metadata hook。

## 6. 対象外

value evaluation、branch merge、loop carry、UI。

## 7. 固定仕様

各setが新version。参照は実行位置のcurrent version。constはversion0のみ。version IDはstatement identityからstable。

## 8. 実装方針

compiled scalar programからpure version graphを構築し、control semanticsはplaceholder tagでなく明示owner metadataとして保持する。

## 9. 変更対象ファイル

新規`bindingVersions.ts`/types/tests、program builder adapter。

## 10. 追加・更新するテスト

linear chains、multiple bindings、shadowed let、invalid set exclusion、stable IDs、position lookup、control metadata preservation。

## 11. 互換性条件

legacy variablesはversion graphへ入れない。

## 12. performance条件

O(declarations+sets)。lookup tableを構築し、queryごとのchain全走査を避ける。

## 13. 完了条件

31/32/34が同じIRを評価でき、UIがversion IDを参照可能。

## 14. 次タスクへの引き継ぎ

31 TS linear、32 Rust payload、34 loop coreが使用する。

## 15. PR境界

version IRだけ。推奨branch slug: `typed-vars/30-binding-versions`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
