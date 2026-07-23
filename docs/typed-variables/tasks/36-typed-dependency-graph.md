# 36: Typed binding/property/template dependency graph

## 1. タイトル

36: Typed binding/property/template dependency graph

## 2. 目的

typed initializer、set RHS、property binding、template holeを既存dependency modelへ統合する。

## 3. 依存タスク

13, 22, 26, 29, 30

## 4. 前提API・型

typed dependency edge kinds、binding/statement/element endpoints、direct/recursive queries、error navigation records。

## 5. 対象

typed declaration refs、version refs、property consumer、text template、missing/invalid/late/disabled reasons。

## 6. 対象外

rename mutation、completion、runtime evaluation。

## 7. 固定仕様

document orderを隠すsort/repair禁止。set version edgeはそのpositionのcurrent bindingへ向く。重複edgeはkind+targetでdedupe。

## 8. 実装方針

13/22/26/30のanalysis recordsをgeneric walkerへ流し、existing geometry dependency functionsへadapterを追加する。

## 9. 変更対象ファイル

model dependencies/new scalar dependency module、presentation/Inspector queries、tests。

## 10. 追加・更新するテスト

各typed edge kind、recursive count、cycles、missing/late/poison、1000 dense refs。legacy/typed mixed matrixは追加しない。

## 11. 互換性条件

nui 3 geometry dependency output/orderを維持する。legacy-only edge差は非blocking。

## 12. performance条件

O(statements+refs+edges)。1000 dense fixture CPU measurement、consumer queryの全再解析禁止。

## 13. 完了条件

rename/diagnostics/UIがsource再scanせずtyped edgesを取得できる。

## 14. 次タスクへの引き継ぎ

37 rename analysis、48 diagnostics、50 perfが利用する。

## 15. PR境界

dependency graphだけ。推奨branch slug: `typed-vars/36-dependency-graph`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
