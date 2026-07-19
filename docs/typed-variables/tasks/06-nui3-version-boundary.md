# 06: nui 3 version boundary / header splice

## 1. タイトル

06: nui 3 version boundary / header splice

## 2. 目的

v2互換を保ったままv2/v3を同じcompiler facadeで識別し、feature gateとheader-only upgrade土台を作る。

## 3. 依存タスク

00

## 4. 前提API・型

`DslMajorVersion = 2|3`、version-aware parse/serialize context、`buildNuiMajorVersionSplice(source,3)`。

## 5. 対象

version validation、serializer version引数、feature requirement diagnostic helper、header splice/Undo command core。typed syntax自体は追加しない。

## 6. 対象外

state/const/let/set parser、Quick Fix UI、新規document default変更。

## 7. 固定仕様

v2 open/save本文不変。upgradeはheader 1 splice、本文byte保持、1 Undo。v1/legacy importerはv2出力。

## 8. 実装方針

hardcoded `DSL_VERSION`をsupported set/current-new-document defaultへ分離し、全serializer callerに明示versionを渡す。

## 9. 変更対象ファイル

`dslDocument.ts`、`nuiVersion.ts`、document open/save/serializer adapters、source edit command/test。

## 10. 追加・更新するテスト

v2/v3 validation、unsupported version、duplicate header、comments/BOM、header-only splice、Undo、serializer明示version。

## 11. 互換性条件

新規document defaultはまだ2。既存v2 behavior不変。

## 12. performance条件

header scan/spliceはsource先頭だけ。whole-file parse/serialize禁止。

## 13. 完了条件

07/10がversion contextへsyntaxを登録でき、v2 regressionがgreen。

## 14. 次タスクへの引き継ぎ

07はstate syntax、10はtyped declaration、41はQuick Fix UIを追加する。

## 15. PR境界

version plumbingだけ。推奨branch slug: `typed-vars/06-nui3-boundary`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
