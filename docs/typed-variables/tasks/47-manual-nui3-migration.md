# 47: Existing document manual nui 3 migration / verification

## 1. タイトル

47: Existing document manual nui 3 migration / verification

## 2. 目的

現存するユーザー文書を漏れなくinventory化し、復元可能な原本を確保して手動でnui 3へ更新し、nui 3 production経路で正常動作を確認する。

## 3. 依存タスク

51

## 4. 前提API・型

Task 46のnui 3 serializer/open/save/reopen経路、Task 48の位置付きdiagnostic、Task 49〜51で検証済みのRust-first evaluationとmanual checklist。

## 5. 対象

唯一のユーザーが所有する全`.nui`/`.nuinui.json`/pre-nui 3文書のinventory、原本backup、手動source修正、文書単位のopen/compile/evaluate/save/reopen/期待geometry確認、完了記録。

## 6. 対象外

自動migration tool、wizard、bulk converter、transparent fallback、legacy parser/serializer強化、repository内のlegacy compatibility fixtureの移行。

## 7. 固定仕様

各文書は編集前sourceへ戻せる状態を先に確保する。diagnosticの位置から人が修正し、意味が一意でない箇所を自動推測しない。inventoryの網羅性は唯一のユーザーが確認する。repository内の旧fixture/goldenはユーザー文書として移行せずTask 52で削除する。

## 8. 実装方針

既知のdocument保存場所、recent/open履歴、ユーザー指定directoryを照合してinventoryを固定する。各rowにoriginal location、backup、migration status、nui 3 header/legacy構文除去、open/compile/Rust evaluate/save/reopen、期待結果のcheckを記録し、1文書ずつ完了させる。

## 9. 変更対象ファイル

ユーザー文書本体、復元用backup、privacyを損なわないmigration inventory/checklist。product code、parser、importer、serializerは変更しない。

## 10. 追加・更新するテスト

自動compatibility matrixは追加しない。各実文書へTask 51のnui 3 checklistを適用し、位置diagnostic、手動修正、save/reopen、期待geometryを記録する。

## 11. 互換性条件

旧形式のround-trip、意味・visibility parity、旧importer outputは完了条件にしない。crash/source確認不能、source破壊・消失、位置情報不足、保存前sourceへ復元不能だけをmigration blockerとする。

## 12. performance条件

legacy-only性能は測定しない。更新済み文書がTask 50のnui 3 gate内で通常利用できることだけを確認する。

## 13. 完了条件

ユーザー確認済みinventoryの全documentがnui 3へ手動更新され、nui 3専用経路でopen/compile/Rust-first evaluate/save/reopenし、期待結果を満たす。未移行文書が0件で、Task 52がlegacy codeを削除できる。

## 14. 次タスクへの引き継ぎ

52へ完了inventoryと確認結果を渡し、legacy compatibility codeの全削除を許可する。

## 15. PR境界

existing document manual migrationとverification recordだけ。推奨branch slug: `typed-vars/47-manual-nui3-migration`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
