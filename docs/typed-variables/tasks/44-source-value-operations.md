# 44: Source Editor boolean/choice value operations and picker boundaries

## 1. タイトル

44: Source Editor boolean/choice value operations and picker boundaries

## 2. 目的

typed literalへAlt stepを追加し、reference/string/picker/Canvasの境界を明確に保つ。

## 3. 依存タスク

39, 40, 43

## 4. 前提API・型

plain `TypedValueEdit`、boolean toggle、choice ordered cycle、source transaction adapter。

## 5. 対象

declaration/set/propertyのboolean/choice literal、Alt+←/→、long-press/Undo、picker candidate routing、Canvas非対象test。

## 6. 対象外

string編集UI、binding referenceの値変更、activity shortcut、Inspector form化。

## 7. 固定仕様

boolean literalは両方向toggle。choiceはmetadata順wrap。numberは既存step。stringと`@binding`全体はstep対象外。scalar bindingをCanvas pickerで選ばせない。

## 8. 実装方針

43 exact spanと39/40 metadataからpure replacementを作り、既存editorTransaction ownership内でcommitする。

## 9. 変更対象ファイル

DSL typed value step module、SourceEditorController adapter/keymap tests、picker/Canvas regression tests。

## 10. 追加・更新するテスト

all contexts、choice order/wrap、boolean、reference/string no-op、1 Undo/long press、input focus、geometry picker維持。

## 11. 互換性条件

既存numeric Alt step、F2 rename、geometry picker/Canvas selectionを維持。

## 12. performance条件

1操作はselected spanだけ。document serialize/scan禁止。

## 13. 完了条件

keyboard operationがsource text spliceで安全に動き、対象外入力を奪わない。

## 14. 次タスクへの引き継ぎ

48 diagnostics/51 manual E2E/52 activationへ引き継ぐ。

## 15. PR境界

typed value operationsと境界回帰だけ。推奨branch slug: `typed-vars/44-source-value-ops`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
