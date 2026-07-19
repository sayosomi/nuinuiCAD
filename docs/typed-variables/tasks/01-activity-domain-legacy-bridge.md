# 01: ElementActivity domain / legacy bridge

## 1. タイトル

01: ElementActivity domain / legacy bridge

## 2. 目的

`visible`/`enabled`の組を`visible|hidden|disabled`へ集約し、v2 productionを新内部modelで動かす。

## 3. 依存タスク

00

## 4. 前提API・型

`ElementActivity`、legacy flagsとの双方向変換、`effectiveElementActivity`、evaluate/draw predicatesを公開する。

## 5. 対象

TS/Rust effective state、parent合成、dependency enabled mask、Canvas/print draw mask、v2 serializer mappingを切り替える。

## 6. 対象外

nui3 `state:` parser、gutter/command、locked削除、typed variable。

## 7. 固定仕様

hiddenはevaluateしてdrawしない。disabledは両方しない。parent disabled優先、parent hiddenはdrawだけ抑止。v2 canonicalはplanどおり。

## 8. 実装方針

`src/model/elementActivity.ts`を正にし、既存boolean fieldはlegacy adapter境界へ限定する。Rustに同じtruth tableを置きparity fixtureで固定する。

## 9. 変更対象ファイル

新規activity module、`geometry.ts` adapter、group/evaluation modules、Canvas/print selector、v2 serializer、Rust groups/evaluation。

## 10. 追加・更新するテスト

全legacy flag組合せ、親子合成、hidden dependency利用、disabled dependency error、Canvas/print mask、TS/Rust parity。

## 11. 互換性条件

v2 DSLとIPC外形はこのPRでは維持。既存文書のsourceは変えない。

## 12. performance条件

1000要素state合成で既存baseline比の極端な退行がないことを記録。全要素ごとのancestor再走査を禁止。

## 13. 完了条件

v2 productionが新activity APIだけで評価/描画判断し、旧UIは引き続き動く。

## 14. 次タスクへの引き継ぎ

03はproduction APIへUI接続、07は同型へv3 syntaxをloweringする。

## 15. PR境界

activity内部modelとlegacy bridgeだけ。推奨branch slug: `typed-vars/01-activity-domain`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
