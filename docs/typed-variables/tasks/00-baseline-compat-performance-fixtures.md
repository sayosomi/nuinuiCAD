# 00: Baseline compatibility / performance fixtures

## 1. タイトル

00: Baseline compatibility / performance fixtures

## 2. 目的

実装前のv2 numeric variable、legacy scope、text numeric interpolation、activity、DivisionPlacement、round-tripと規模別costを実行可能なfixtureで固定する。

## 3. 依存タスク

なし

## 4. 前提API・型

既存`compileDslDocument`、TS `evaluateElements`、Rust `evaluate_document_input`、serializer/patch APIだけを使う。新feature APIは作らない。

## 5. 対象

250/1000要素の同構造source generator、v2 semantic golden、numeric var/measurement/global/group/forGroup/text fixture、測定result formatを追加する。

## 6. 対象外

typed syntaxやproduction behaviorの変更、将来APIのstub、根拠のないperformance gate。

## 7. 固定仕様

warm-up 100回、21 trial、trial内複数run、worker CPU time、median/p95、250→1000 ratioを記録する。Rustは既存ignored benchmarkも記録専用で使う。

## 8. 実装方針

既存reconciler performance testのmeasurement helperを小さなtest helperへ抽出できる場合だけ再利用し、現在のcompiler/evaluatorをblack-box測定する。

## 9. 変更対象ファイル

`test/typedVariablesBaseline.test.ts`、`test/typedVariablesPerformanceBaseline.test.ts`、必要ならtest-only helper、Rust `performance_tests.rs`。

## 10. 追加・更新するテスト

short/long/measurement var、global/group visibility、forward failure、numeric interpolation、save/reload、250/1000 result countをassertする。

## 11. 互換性条件

既存sourceとsnapshotを変更しない。fixture追加だけで全現行test結果を維持する。

## 12. performance条件

絶対閾値は置かず記録専用。finite resultとfixture correctnessだけをCI gateにする。

## 13. 完了条件

fixtureが再現可能で、4測定領域を後続taskが同じformatで追加でき、通常gateがgreen。

## 14. 次タスクへの引き継ぎ

01/04/08/50はこのfixture/measurement protocolを再利用する。

## 15. PR境界

test foundationのみ。推奨branch slug: `typed-vars/00-baseline-fixtures`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
