# 46: nui 3 serializer / round-trip / statement patching

## 1. タイトル

46: nui 3 serializer / round-trip / statement patching

## 2. 目的

各ownerが作ったserializerをversion-aware document persistenceとstatement patchへ統合する。

## 3. 依存タスク

07, 10, 22, 26, 29, 30

## 4. 前提API・型

version-required document/statement serializer facade、typed statement patch mapping、v3 golden matrix。

## 5. 対象

const/let/set/state/property refs/template escapes、comments/blank lines/layout preservation、v2/v3 round-trip。

## 6. 対象外

parser再実装、header upgrade本文rewrite、import policy、feature activation。

## 7. 固定仕様

open/saveだけではnormalizeしない。再生成statementだけcanonical。header spliceは06 API。v2 serializerはv3 syntaxを出さない。

## 8. 実装方針

10/29/07 serializerをregistryへ登録し、existing textPatch/reconcilerにtyped statement identityとrow spansを追加する。

## 9. 変更対象ファイル

dslDocument serializer facade、statement serializer registry、textPatch/reconciler、goldens/tests。

## 10. 追加・更新するテスト

full matrix populated/minimal、comments/vertical label、escaped strings/braces、one-statement patch、Undo、v2 byte preservation。

## 11. 互換性条件

legacy numeric var/element serializer golden不変。whole-file mutation path追加禁止。

## 12. performance条件

1000 mixed statements full serializeとone-statement patchを別測定。patchはdocument sizeに依存しない既存index利用。

## 13. 完了条件

v3 sourceがparse→compile→serialize→compileでsemantic一致し、局所patchがlayout保持。

## 14. 次タスクへの引き継ぎ

47 import boundary、48 E2E、52 activationへ引き継ぐ。

## 15. PR境界

serializer/round-trip/patch統合だけ。推奨branch slug: `typed-vars/46-v3-roundtrip`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
