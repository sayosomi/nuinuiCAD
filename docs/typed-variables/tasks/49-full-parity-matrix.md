# 49: Full TS/Rust scalar parity matrix

## 1. タイトル

49: Full TS/Rust scalar parity matrix

## 2. 目的

declaration/property/template/set/control/loopを組み合わせたdocument fixtureでTS/Rust output全体を比較するrelease gateを作る。

## 3. 依存タスク

21, 23, 24, 25, 28, 32, 35, 48

## 4. 前提API・型

existing `test:parity` harnessのtyped scalar fixture supportとnormalization。

## 5. 対象

computed scalars、geometry、errors/warnings、evaluated/effective masks、generated rows、final values、activity/print interactions。

## 6. 対象外

新behavior実装、performance、manual UI。

## 7. 固定仕様

shadow mismatchはbug。deliberate Rust-first差分はplan/fixture変更なしに許可しない。

## 8. 実装方針

focused fixture filesをfeature組合せmatrixへ集約し、巨大1fixtureだけにしない。Rust eligibilityはreferenced formsも判定する。

## 9. 変更対象ファイル

`test/evaluationParity.test.ts` adapters、typed fixture directory、Rust/TS payload normalization tests。

## 10. 追加・更新するテスト

happy/error/mixed legacy/typed、nested control、all property types、text escape、poison recovery、activity/print。

## 11. 互換性条件

existing parity fixtures/result normalization維持。

## 12. performance条件

parity command時間は記録するがbehavior evaluator benchmarkと混ぜない。

## 13. 完了条件

`npm run test:parity`でtyped matrix差分ゼロ、unsupported fallback漏れなし。

## 14. 次タスクへの引き継ぎ

50 performance、51 manual、52 activationの必須gate。

## 15. PR境界

parity fixture/harnessだけ。推奨branch slug: `typed-vars/49-parity-matrix`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
