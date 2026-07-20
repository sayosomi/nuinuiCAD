# 23: Standard boolean/choice property runtime

## 1. タイトル

23: Standard boolean/choice property runtime

## 2. 目的

通常evaluation propertyへboolean/choice bindingをTS/Rust縦切りで接続する。

## 3. 依存タスク

21, 22

## 4. 前提API・型

typed property resolver returning expected scalar type、element evaluator adapter。

## 5. 対象

offsetLine.side/closed/suppressTrimWarnings、intersection extensions、copy/move/image mirrorX。

## 6. 対象外

text.text、group.printEnabled、forGroup.showGenerated、activity。

## 7. 固定仕様

対応型だけ。評価失敗/poison/type mismatchなら要素を評価/描画しない。choice optionsはruntime再検証。

## 8. 実装方針

element evaluation前にtyped property sourceをresolved literal値へmaterializeする共通adapterをTS/Rustに作る。

## 9. 変更対象ファイル

new scalar property resolver、TS element evaluation context、Rust element access adapter、focused element tests/parity fixtures。

## 10. 追加・更新するテスト

各対象literal/reference、set前はconst値、poison、choice wrong set、geometry output parity。

## 11. 互換性条件

literal valuesと既存evaluator output不変。対象外propertyは受理しない。

## 12. performance条件

1 property 1 binding lookup。elementごとのprogram再評価禁止。

## 13. 完了条件

全standard対象がTS/Rust shadow一致し、print/control/textに変更なし。

## 14. 次タスクへの引き継ぎ

45 runtime Inspector、48/49 integrated testsが使う。

## 15. PR境界

standard property runtimeだけ。推奨branch slug: `typed-vars/23-property-runtime`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
