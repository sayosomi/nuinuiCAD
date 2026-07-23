# 45: Inspector final runtime values / poison recovery

## 1. タイトル

45: Inspector final runtime values / poison recovery

## 2. 目的

全linear/if/forGroup mutationを反映したfinal computed binding valueとproperty参照状態をInspectorへ表示する。

## 3. 依存タスク

23, 24, 25, 28, 35, 42

## 4. 前提API・型

runtime binding presentation: final value/type/version/status/poison/recovered、property consumer rows。

## 5. 対象

all scalar types、final set history summary、poison/recovery、text/property refs、source jump integration。

## 6. 対象外

runtime編集form、full debugger/time-travel、途中version一覧の常時表示。

## 7. 固定仕様

表示値はdocument evaluation完了時のfinal value。forGroup途中値をfinalと誤表示しない。typed sectionはread-only、existing literal parameter操作維持。

## 8. 実装方針

evaluation payloadをpure presentation builderで42 metadataへjoinし、Reactはformat/status/jump dispatchだけ。

## 9. 変更対象ファイル

Inspector presentation builder/component、evaluation adapter/store selector、tests。

## 10. 追加・更新するテスト

no set、linear、branch、loop final、poison、recovery、string/choice format、property `@name` row、literal Inspector regression。

## 11. 互換性条件

nui 3 element/typed binding Inspectorを維持する。missing runtimeは明示unknown/errorで偽値を出さない。legacy variable Inspectorの維持は完了条件にしない。

## 12. performance条件

selected binding/element関連だけjoin。全historyのReact materialize禁止。

## 13. 完了条件

後続taskに暗黙のInspector修正を残さずfinal semanticsを表示できる。

## 14. 次タスクへの引き継ぎ

48/51でdiagnostic navigationとmanual displayを確認する。

## 15. PR境界

Inspector runtime sectionだけ。推奨branch slug: `typed-vars/45-inspector-runtime`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
