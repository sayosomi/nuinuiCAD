# 37: Typed binding rename safety analysis

## 1. タイトル

37: Typed binding rename safety analysis

## 2. 目的

typed declaration renameがscope resolutionを変えないかpure analysisで判定する。

## 3. 依存タスク

36

## 4. 前提API・型

typed rename probe、capture/collision/reference-resolution verdict、affected span list。

## 5. 対象

typed declaration、initializer、set target/RHS、property、template、typed shadow before/after。

## 6. 対象外

source patch/command/UI、qualified rename。

## 7. 固定仕様

same-scope duplicate、typed outer/inner capture・resolution changeを拒否。直接source editはpropagateしない。移行中のlegacy collision supportは拡張せずTask 52で削除する。

## 8. 実装方針

before/after binding catalogを仮想nameで比較し、36 edgeの各reference target ID不変を検証する。

## 9. 変更対象ファイル

document rename analysis/new scalar rename module、property-based/focused tests。

## 10. 追加・更新するテスト

safe rename、same scope collision、typed shadow capture、set/template/property refs、Japanese names、dense graph。legacy collision matrixは追加しない。

## 11. 互換性条件

existing element rename verdictを変えずtyped pathを追加。

## 12. performance条件

1000 bindings/dense refsを00 CPU protocolで記録。whole compiler複数回を最小化。

## 13. 完了条件

38がverdictとexact spansだけでatomic patch可能。

## 14. 次タスクへの引き継ぎ

38 command、41 collision Quick Fix、50 perfへ引き継ぐ。

## 15. PR境界

rename analysisだけ。推奨branch slug: `typed-vars/37-rename-analysis`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
