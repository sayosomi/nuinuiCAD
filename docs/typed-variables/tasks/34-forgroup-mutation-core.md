# 34: forGroup sequential mutation core

## 1. タイトル

34: forGroup sequential mutation core

## 2. 目的

forGroupのiteration binding、loop-local lifetime、outer let carryをproduction未接続のpure execution algorithmとして確定する。

## 3. 依存タスク

30, 32, 33

## 4. 前提API・型

loop execution plan、iteration frame enter/leave、outer slot carry、generated statement mapping interface。

## 5. 対象

iteration read-only number、per-iteration declarations、outer set、nested if/loop、poison/recovery、final environment。

## 6. 対象外

existing forGroup expansion/generated IDs/evaluation masksへの接続、UI。

## 7. 固定仕様

outer letはiteration間持越し。loop localは毎回再生成/終了時破棄。iteration binding set不可。loop終了後outer final値を維持。

## 8. 実装方針

mock element callbackを受けるscalar-only loop runnerをTSとRustに同じcase tableで実装し、production forGroup codeを触らない。

## 9. 変更対象ファイル

TS/Rust scalar loop core modules、shared loop fixture JSON、pure parity tests。

## 10. 追加・更新するテスト

0/1/N iterations、sum carry、local reset、nested if/loop、poison recovery、iteration target拒否、final value。

## 11. 互換性条件

production未接続。既存forGroup挙動不変。

## 12. performance条件

iteration×body statementsに比例。100/1000 iterationの記録を取り、environment full cloneを禁止。

## 13. 完了条件

35がgeometry expansionへcallback接続するだけのstable coreとparity fixtureがある。

## 14. 次タスクへの引き継ぎ

35はgenerated IDs/rows/masks/evaluation limitと統合する。

## 15. PR境界

pure loop mutation coreだけ。推奨branch slug: `typed-vars/34-forgroup-mutation-core`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
