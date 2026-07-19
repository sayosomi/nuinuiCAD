# 40: set target / invalid-let recovery completion

## 1. タイトル

40: set target / invalid-let recovery completion

## 2. 目的

set固有のtarget/RHS候補とinvalid let recovery workflowを追加する。

## 3. 依存タスク

29, 30, 39

## 4. 前提API・型

set target completion context、recoverable let candidate metadata、RHS expected type projection。

## 5. 対象

visible let target、const/legacy exclusion、invalid let inclusion、RHS literals/refs/choice、same-name dedupe。

## 6. 対象外

Quick Fix actions、version evaluation、qualified target。

## 7. 固定仕様

通常value completionではinvalid binding除外、set targetではinvalid letを回復候補として残す。constは表示しない。

## 8. 実装方針

29 resolution/30 version metadataを正とし、39 generic value candidateをexpected type付きRHSへ再利用する。

## 9. 変更対象ファイル

set completion candidate/context modules、cm adapter/tests。

## 10. 追加・更新するテスト

valid/invalid let、const、shadow、branch/loop scope、choice order、dirty source、RHS context切替。

## 11. 互換性条件

existing completion contextsを奪わない。

## 12. performance条件

39 catalogのfiltered view。追加document scan禁止。

## 13. 完了条件

invalid initializerのletを正常setで回復する入力flowがcompletionから可能。

## 14. 次タスクへの引き継ぎ

41 Quick Fix、44 Alt/cycle UIへ引き継ぐ。

## 15. PR境界

set/recovery completionだけ。推奨branch slug: `typed-vars/40-set-completion`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
