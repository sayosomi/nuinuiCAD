# 29: set syntax / target resolution / serializer

## 1. タイトル

29: set syntax / target resolution / serializer

## 2. 目的

typed declaration parserと重複せず、`set name = expression`の全syntax/span/static target resolutionを所有する。

## 3. 依存タスク

10, 12, 15, 19

## 4. 前提API・型

`DslSetStatement`、target/RHS spans、resolved target binding ID、typed RHS、`serializeSetStatement`。

## 5. 対象

parser、visible let lookup、const/undefined/invalid target diagnostics、RHS typecheck、statement identity、serializer。

## 6. 対象外

binding versions、old/current value、runtime mutation、qualified target。

## 7. 固定仕様

targetは通常bare nameだけ。visibleな最内側let。constはconst-assignment、undefined/legacy/local/iterationはinvalid target。invalid letはrecovery target可。

## 8. 実装方針

10 declaration parserを変更せず独立statement parserを登録し、12/15を利用してresolved analysis recordを作る。

## 9. 変更対象ファイル

新規set parser/analysis/serializer、DSL statement union/reconciler、focused tests。

## 10. 追加・更新するテスト

valid全型、shadow target、const/undefined/legacy/local、RHS mismatch、comments/spans、v2 version error、round-trip。

## 11. 互換性条件

legacy `set`相当syntaxはない。v2では明確なversion diagnostic。

## 12. performance条件

setごとscope lookup+ASTに線形。document逆走査禁止。

## 13. 完了条件

set解析結果がtarget ID+typed RHSを持ち、version/evaluator codeを含まない。

## 14. 次タスクへの引き継ぎ

30がversion IR、40がcompletion、43がspan navigationへ接続する。

## 15. PR境界

set syntax/resolution/serializerだけ。推奨branch slug: `typed-vars/29-set-syntax`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
