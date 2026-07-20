# 47: Import/export and existing .nui compatibility

## 1. タイトル

47: Import/export and existing .nui compatibility

## 2. 目的

v1/legacy JSON/v2/v3のfile boundaryとsave/export policyを固定する。

## 3. 依存タスク

46

## 4. 前提API・型

version-aware open result、legacy importer output version policy、typed document save acceptance。

## 5. 対象

v1→v2、legacy JSON→v2、v2 open/save、v3 open/save、unsupported version、image path/print/palette preservation。

## 6. 対象外

legacy var自動typed migration、v2→v3 automatic upgrade、新file default変更。

## 7. 固定仕様

legacy importersはv2出力。v2 body無変更。v3はlegacy var/flags受理。`.nuinui.json`はimport only。

## 8. 実装方針

existing documentFile/import testsへtyped/version fixturesを追加し、serializer versionをexplicit passする。

## 9. 変更対象ファイル

document file/open/save/import adapters、legacy import tests、round-trip fixtures。

## 10. 追加・更新するテスト

all boundary matrix、cancel/error、source byte preservation、typed v3 reopen、legacy all-element semantic equality。

## 11. 互換性条件

ユーザー明示upgradeなしにheader/bodyを変えない。

## 12. performance条件

file boundaryに追加whole-file passを増やさない。1000 statement open sanity。

## 13. 完了条件

import/export/open/saveのversion matrixが文書化/test化され、activation前のcompat gateになる。

## 14. 次タスクへの引き継ぎ

48/51/52へ引き継ぐ。

## 15. PR境界

document boundary compatibilityだけ。推奨branch slug: `typed-vars/47-import-compat`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
