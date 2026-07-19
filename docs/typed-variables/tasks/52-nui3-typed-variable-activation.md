# 52: nui 3 typed-variable production activation

## 1. タイトル

52: nui 3 typed-variable production activation

## 2. 目的

全gate完了後、typed declaration/set/property/control/templateをproduction compiler/evaluator/UIへ正式接続し、新規document defaultをnui3へ変更する。

## 3. 依存タスク

01, 02, 03, 05, 07, 23, 24, 25, 28, 35, 38, 41, 44, 45, 47, 48, 49, 50, 51

## 4. 前提API・型

live compiler/evaluation adapterのfeature gate removal、新document version default 3。

## 5. 対象

production import wiring、dead gate削除、new document/template version、release checklist実行。

## 6. 対象外

追加feature、legacy removal、automatic v2 migration、qualified reference。

## 7. 固定仕様

既存v2 open/save不変。legacy import v2。explicit v3と新規documentだけtyped feature。Rust-first production。

## 8. 実装方針

中間taskで完成済みのgated modulesをfacadeへ接続し、activation PRでparser/evaluatorを再実装しない。

## 9. 変更対象ファイル

DSL/evaluation/document/editor facade、new document/template defaults、feature gate cleanup、smoke tests。

## 10. 追加・更新するテスト

全npm/Rust/parity/desktop build、new v3 document、existing v2、header upgrade、manual 51 checklist smoke。

## 11. 互換性条件

numeric var/legacy scope/save goldenが00と47で一致することをmerge条件にする。

## 12. performance条件

50 gateを同commitで再実行。activation wiringの追加退行があればmergeしない。

## 13. 完了条件

production Tauriで全初期scopeが利用可能、gate/dead fallbackなし、全check green。

## 14. 次タスクへの引き継ぎ

実装完了。qualified reference、concat等は別計画として起票する。

## 15. PR境界

activation wiring/default changeだけ。推奨branch slug: `typed-vars/52-activation`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
