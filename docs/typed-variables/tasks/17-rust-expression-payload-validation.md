# 17: Rust typed-expression payload validation

## 1. タイトル

17: Rust typed-expression payload validation

## 2. 目的

TS typed AST JSONをRustが安全に受け取るvalue/type/schema validation層を作る。

## 3. 依存タスク

14, 15

## 4. 前提API・型

Rust `ScalarType`/`ScalarValue`/typed AST serde shape、`validate_typed_expression_payload`、stable issue codes。

## 5. 対象

全node/tag/field、declared/inferred type、choice options/member、binding ID、depth/size validation。

## 6. 対象外

operator評価、document integration、source name resolution。

## 7. 固定仕様

unknown tag/field shape、type annotation不一致、不正choice payloadをfail-closed。Rustはnameを解決しない。

## 8. 実装方針

`src-tauri/src/evaluation/scalars/types.rs`とpayload validatorを新設し、existing `Value` boundaryから明示convertする。

## 9. 変更対象ファイル

新規Rust scalars module/types/validation/tests、EvaluationInputのoptional gated field型。

## 10. 追加・更新するテスト

TS JSON golden decode、malformed payload table、choice mismatch、deep AST guard、unknown binding ID shape。

## 11. 互換性条件

fieldがない既存evaluation inputは従来path。command名不変。

## 12. performance条件

validationはAST sizeに線形。allocation上限/深さguardをtest。

## 13. 完了条件

18がvalidated Rust enumだけを評価でき、生serde Value分岐を持ち込まない。

## 14. 次タスクへの引き継ぎ

18はoperator evaluator、21はprogram/binding environmentを接続する。

## 15. PR境界

Rust payload/types validationだけ。推奨branch slug: `typed-vars/17-rust-expression-payload`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
