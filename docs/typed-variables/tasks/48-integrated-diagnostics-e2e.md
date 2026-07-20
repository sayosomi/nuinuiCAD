# 48: Integrated typed diagnostics / exact-span E2E

## 1. タイトル

48: Integrated typed diagnostics / exact-span E2E

## 2. 目的

parser/analysis/runtimeから返る全typed issueを一貫したcode/span/message/navigationとして統合する。

## 3. 依存タスク

23, 24, 25, 28, 32, 35, 36, 38, 41, 44, 45, 47

## 4. 前提API・型

stable typed diagnostic schema、Rust issue→TS span remap、editor/Inspector navigation payload。

## 5. 対象

plan記載全code、multiple errors、fail-closed element/property、Quick Fix link、gutter/Inspector marker。

## 6. 対象外

新diagnostic種類、parity/performance/manual validation。

## 7. 固定仕様

expected/actual type、binding/statement/element/property IDを可能な限り含む。runtime RustはID、TS adapterがexact spanを付与。

## 8. 実装方針

各subsystem issueを中央schemaへadaptし、message formatterとeditor presentationを分離する。

## 9. 変更対象ファイル

diagnostic types/adapters/editor extension/Inspector presentation、integration fixtures/tests。

## 10. 追加・更新するテスト

全code table、source exact offsets、multi-error deterministic order、runtime poison/recovery、navigation/Quick Fix、invalid geometry omitted。

## 11. 互換性条件

existing dependency diagnostics message/IDsを不要に変えない。

## 12. performance条件

issue mappingはissues+span indexに線形。errorごとのsource parse禁止。

## 13. 完了条件

diagnostic matrixが欠落なくgreenで、49 parity fixtureへstable expected payloadを渡せる。

## 14. 次タスクへの引き継ぎ

49はvalueだけでなくissues/masksも比較、51はmanual navigationを確認する。

## 15. PR境界

diagnostic integration/hardeningだけ。推奨branch slug: `typed-vars/48-diagnostics-e2e`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
