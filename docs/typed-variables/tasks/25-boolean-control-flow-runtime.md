# 25: Boolean condition / forGroup showGenerated runtime

## 1. タイトル

25: Boolean condition / forGroup showGenerated runtime

## 2. 目的

完成済みtyped boolean expressionをconditional controlとforGroup showGeneratedへ接続する。

## 3. 依存タスク

18, 21, 22

## 4. 前提API・型

typed control boolean resolver、condition/showGenerated issue mapping。

## 5. 対象

typed conditionalGroup condition、forGroup showGenerated binding、TS/Rust effective masks/generated presentation。

## 6. 対象外

set side effects、forGroup mutation carry、printEnabled。

## 7. 固定仕様

typed conditionはbooleanのみ。showGeneratedは生成結果表示だけを制御しiteration実行を止めない。移行中のlegacy numeric truth adapterは拡張せず、差異をblockingにせず、Task 52で削除する。

## 8. 実装方針

expression parser/evaluatorを再実装せず18/21 environmentへcontrol owner IDを渡す。

## 9. 変更対象ファイル

conditional/forGroup TS evaluators、Rust mod/for_group、control payload/parity tests。

## 10. 追加・更新するテスト

boolean literal/ref/comparison/logical、poison、inactive branch masks、showGenerated falseでもiteration count保持。legacy-only truth matrixは追加しない。

## 11. 互換性条件

nui 3 literal `showGenerated` semanticsを維持する。legacy numeric condition parityは完了条件にしない。

## 12. performance条件

conditionはgroup entryごと1回、showGeneratedはloopごと1回評価。iterationごとの再parse禁止。

## 13. 完了条件

control-flow typed booleanとshowGeneratedがTS/Rust一致し、mutationはまだない。

## 14. 次タスクへの引き継ぎ

33はactive branch set、34/35はloop mutationを接続する。

## 15. PR境界

boolean control valuesだけ。推奨branch slug: `typed-vars/25-boolean-control-flow`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
