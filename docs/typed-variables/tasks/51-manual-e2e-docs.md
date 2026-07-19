# 51: Manual Tauri E2E / user documentation

## 1. タイトル

51: Manual Tauri E2E / user documentation

## 2. 目的

feature gate付き完成実装をTauriで手動検証し、DSL/user workflow文書とrepeatable checklistを仕上げる。

## 3. 依存タスク

03, 05, 07, 41, 44, 45, 47, 48, 49, 50

## 4. 前提API・型

新public APIなし。manual checklistとuser-facing DSL examples。

## 5. 対象

declaration、scope/shadow、completion、template、set/branch/loop、Inspector、Alt step、rename、activity UI、save/reopen/import/print。

## 6. 対象外

production activation、新機能、testで再現したbugの未修正放置。

## 7. 固定仕様

canonical exampleは`text ... = label(...)`。qualified scopeは記載しない。existing literal Inspector editingを維持した手順を書く。

## 8. 実装方針

Tauri dev Rust/parity modesでchecklistを実行し、発見bugはowner task相当のfocused fix+automated regressionを同PR内で行う。

## 9. 変更対象ファイル

`docs/dsl.md`、manual E2E checklist、必要なfocused regression tests。計画READMEには実測結果を引継ぎ記載。

## 10. 追加・更新するテスト

automated全gate再実行、manual keyboard/mouse/print/import matrix結果を記録。

## 11. 互換性条件

v2 workflowとlegacy var exampleをcompat sectionに残す。

## 12. performance条件

1000-element fixtureでtyping/completion/pan/Inspectorの体感と50 logを確認。新閾値は作らない。

## 13. 完了条件

manual項目全pass、user docsが実syntaxと一致、activation blockerなし。

## 14. 次タスクへの引き継ぎ

52はこのchecklist結果と全自動gateだけを確認してdefaultを切り替える。

## 15. PR境界

manual hardening/docsだけ。推奨branch slug: `typed-vars/51-manual-e2e`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
