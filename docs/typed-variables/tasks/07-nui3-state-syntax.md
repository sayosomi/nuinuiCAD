# 07: nui 3 state syntax

## 1. タイトル

07: nui 3 state syntax

## 2. 目的

production ElementActivityへnui3 `state:` syntaxを接続する。

## 3. 依存タスク

01, 06

## 4. 前提API・型

construction common arg metadataへv3-only `state`、`element-state-conflict` diagnostic。

## 5. 対象

parse/apply/serialize/span/completion metadataのstate handlingとlegacy flags bridge。

## 6. 対象外

activity UI、typed variable、activity variable binding。

## 7. 固定仕様

v3 state valuesはvisible/hidden/disabled。state+visible/enabled混在はfail-closed。v2 stateはversion error。v3 visibleはstate省略。

## 8. 実装方針

parserはraw args競合を先に診断し、成功時だけ01 converterへloweringする。serializerはversion contextでv2/v3 mappingを選ぶ。

## 9. 変更対象ファイル

construction registry/common args、call parser/apply args、serializer、span/completion metadata、goldens。

## 10. 追加・更新するテスト

3値、mixed conflict exact spans、v2拒否、v3 legacy flags、open/save無変更、regenerated canonical。

## 11. 互換性条件

v3はlegacy flagsを受理。v2 outputは01 mappingのまま。

## 12. performance条件

arg validationの定数cost。専用benchmark不要。

## 13. 完了条件

v2/v3 round-tripとconflict diagnosticがgreen、UIに依存しない。

## 14. 次タスクへの引き継ぎ

41はconflict/version Quick Fix、46は全v3 round-tripへ統合する。

## 15. PR境界

state DSLだけ。推奨branch slug: `typed-vars/07-state-syntax`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
