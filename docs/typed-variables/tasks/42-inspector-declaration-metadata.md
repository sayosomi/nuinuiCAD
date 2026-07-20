# 42: Inspector typed declaration metadata

## 1. タイトル

42: Inspector typed declaration metadata

## 2. 目的

runtime mutation完成を待たず、typed declarationの静的metadataだけをInspectorへread-only表示する。

## 3. 依存タスク

19

## 4. 前提API・型

binding analysis presentation model: kind/type/raw initializer/binding ID/source statement ID。

## 5. 対象

const/let selection、metadata rows、source jump command hook、invalid declaration marker。

## 6. 対象外

computed/final value、poison/recovery、property reference、literal parameter UI変更。

## 7. 固定仕様

typed rowsはread-only。既存literal parameter編集/操作を削除しない。runtime値placeholderを表示しない。

## 8. 実装方針

Reactへanalysis raw objectを渡さずpure presentation builderを置き、selectionはstatement identityで行う。

## 9. 変更対象ファイル

Inspector presentation types/builder/component、selection adapter/tests。

## 10. 追加・更新するテスト

全declared type、const/let、invalid metadata、selection/source jump intent、existing literal Inspector regression。

## 11. 互換性条件

existing element Inspector behavior維持。

## 12. performance条件

selected bindingだけproject。document全bindingのReact row生成禁止。

## 13. 完了条件

metadata sectionが正確で、後続45が暗黙修正せずruntime sectionを追加できる。

## 14. 次タスクへの引き継ぎ

45は同presentation modelへfinal runtime dataを追加する。

## 15. PR境界

Inspector metadataだけ。推奨branch slug: `typed-vars/42-inspector-metadata`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
