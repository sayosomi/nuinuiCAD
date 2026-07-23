# 28: Text template Rust production parity

## 1. タイトル

28: Text template Rust production parity

## 2. 目的

compiled TextTemplateAstをRust text evaluatorで評価し、27とparityにする。

## 3. 依存タスク

18, 21, 27

## 4. 前提API・型

Rust template segment payload/types/evaluator、typed text issue codes。

## 5. 対象

string/numeric hole、escape済literal、numeric format、poison/dependency、text geometry output。

## 6. 対象外

template syntax変更、boolean/choice stringify。

## 7. 固定仕様

Rustはsource regex scan/name normalizeをせず、TS compiled ASTとbinding IDを使う。value/error/output parity必須。

## 8. 実装方針

Rust scalars/text.rsを追加し、existing text_evaluator.rsはanchor/font/geometry assemblyへ縮小する。

## 9. 変更対象ファイル

Rust template module/text evaluator、TS IPC conversion/eligibility、shared parity fixtures。

## 10. 追加・更新するテスト

26/27全fixture、malformed payload、escaped braces、Unicode/newline、error binding ID/source remap。

## 11. 互換性条件

nui 3 numeric/string templateのTS/Rust parityを維持する。v2 fixtureやscalar program未使用時の旧output shapeは完了条件にしない。

## 12. performance条件

segment数に線形。textごとのexpression parse禁止。

## 13. 完了条件

TS/Rust text output/error差分ゼロでgated production pathが完成。

## 14. 次タスクへの引き継ぎ

45 Inspector property display、48/49 integrated hardeningへ引き継ぐ。

## 15. PR境界

Rust template runtime/parityだけ。推奨branch slug: `typed-vars/28-template-rust`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
