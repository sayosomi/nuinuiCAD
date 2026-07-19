# 22: Typed property reference compile/typecheck

## 1. タイトル

22: Typed property reference compile/typecheck

## 2. 目的

opt-in propertyの値全体`@binding`をcompileし、property metadataに対して型検査する。

## 3. 依存タスク

13, 15, 19

## 4. 前提API・型

`PropertyBindingCapability` registry query、`ScalarValueSource` literal/binding/template、property diagnostic metadata。

## 5. 対象

text.text、offset side、通常boolean、printEnabled、showGeneratedのparse classificationとcompile-time assignment。

## 6. 対象外

runtime evaluation、template hole、activity/identity property。

## 7. 固定仕様

暗黙変換なし。choice propertyだけbinding options subsetを許可。invalid bindingはfail-closed。

## 8. 実装方針

parameterDefinitionsのstable key/kind/optionsを正とし、opt-in fieldで対応propertyを明示する。compiler switchを重複させない。

## 9. 変更対象ファイル

parameter definition types/data、DSL apply/value parser adapter、new property binding compiler/tests。

## 10. 追加・更新するテスト

対象property全網羅、type mismatch、choice subset/order、non-opt-in rejection、exact value span。

## 11. 互換性条件

literal property compile/resultは従来shape/behavior。binding sourceだけgated representation。

## 12. performance条件

property lookupはregistry map。document scan禁止。

## 13. 完了条件

23-26がtyped value sourceを再parseせず受け取れる。

## 14. 次タスクへの引き継ぎ

23 standard、24 print、25 control、26 textが各runtime ownerになる。

## 15. PR境界

property compile/typecheckだけ。推奨branch slug: `typed-vars/22-property-typecheck`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
