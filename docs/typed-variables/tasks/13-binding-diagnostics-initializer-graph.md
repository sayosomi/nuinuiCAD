# 13: Binding diagnostics / initializer graph

## 1. タイトル

13: Binding diagnostics / initializer graph

## 2. 目的

binding resolution結果からinitializer dependency graph、SCC cycle、order diagnosticsとexact source issuesを生成する。

## 3. 依存タスク

12

## 4. 前提API・型

`analyzeBindings`、binding/reference records、diagnostic codes、initializer graph/SCC output。

## 5. 対象

undefined、forward、self、duplicate、cycle分類、invalid binding status、source span mapping。

## 6. 対象外

expression型diagnostic、evaluation、property/set/rename。

## 7. 固定仕様

cycle SCCはgeneric forwardより優先してcycleを各bindingへ報告。invalid bindingは通常completion除外用statusを持つ。

## 8. 実装方針

12 resultからgraphを作りTarjan/Kosarajuをpure moduleで実装、message formattingとanalysis dataを分離する。

## 9. 変更対象ファイル

新規`bindingAnalysis.ts`、`bindingDiagnostics.ts`、tests/fixtures。

## 10. 追加・更新するテスト

self、2/3-node cycle、forward chain、undefined、duplicate、outer shadow、複数issue span、deterministic order。

## 11. 互換性条件

legacy numeric evaluation結果は変更しない。analysis未接続。

## 12. performance条件

O(bindings+refs)。250/1000 CPU median/p95とscalingを00 protocolで記録。

## 13. 完了条件

const evaluatorがname/order/cycleを再判定せずvalid binding listを受け取れる。

## 14. 次タスクへの引き継ぎ

19がcompiled program、36がdependency graph、41がQuick Fixを使う。

## 15. PR境界

binding diagnostics/graphだけ。推奨branch slug: `typed-vars/13-binding-diagnostics`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
