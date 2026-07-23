# 41: Typed variable / version / choice Quick Fixes

## 1. タイトル

41: Typed variable / version / choice Quick Fixes

## 2. 目的

diagnosticから安全な局所修正とnui3 header upgradeを提案する。

## 3. 依存タスク

07, 13, 22, 29, 40

## 4. 前提API・型

plain Quick Fix descriptor/splice、diagnostic code→actions、editor adapter。

## 5. 対象

移行期間限定のheader-only nui2→3 upgrade、missing explicit type skeleton、invalid choice member候補、state conflict片側削除、const target案内。

## 6. 対象外

推測型による自動大規模rewrite、legacy var一括migration、send/side effects。

## 7. 固定仕様

header upgradeは06 spliceだけでbody rewriteしない一時的な手動migration支援とし、Task 52でpre-nui 3 diagnostic/actionとともに削除する。choice候補はmetadata順。意味が一意でないfixは提示しない。

## 8. 実装方針

code-action生成をpure moduleにし、CodeMirror lint actionはplain spliceをdispatchするだけ。

## 9. 変更対象ファイル

diagnostic quick fix module、editor diagnostics adapter、source edit tests。

## 10. 追加・更新するテスト

各action内容/span、1 Undo、conflict no-op、version body preservation、choice options、invalid let recovery link。

## 11. 互換性条件

nui 3 diagnostics/actionsを維持し、save時auto-fixを行わない。legacy Quick Fixの網羅や自動migrationは要求しない。

## 12. performance条件

表示中diagnostic数に比例。全document再compileはaction実行時1回まで。

## 13. 完了条件

確定可能なfixだけが安全なstatement/header spliceで動く。

## 14. 次タスクへの引き継ぎ

48 integrated diagnostics、51 manual E2Eへ引き継ぐ。

## 15. PR境界

Quick Fixだけ。推奨branch slug: `typed-vars/41-quick-fixes`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
