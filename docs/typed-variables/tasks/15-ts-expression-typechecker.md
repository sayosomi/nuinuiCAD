# 15: TypeScript typed-expression typechecker

## 1. タイトル

15: TypeScript typed-expression typechecker

## 2. 目的

ASTと解決済みbindingから型を決定し、演算/代入/choice規則を静的診断する。

## 3. 依存タスク

12, 14

## 4. 前提API・型

`typecheckScalarExpression(ast, context)`、typed AST、expected/actual diagnostics、choice assignability helper利用。

## 5. 対象

全operator matrix、declaration expected type、string/choice equality、reference binding ID付与、invalid binding伝播。

## 6. 対象外

AST評価、property/set接続、runtime payload validation。

## 7. 固定仕様

implicit conversionなし。stringはequalityのみ。choice equalityは完全一致。property subset ruleは22だけで適用。

## 8. 実装方針

08 type APIと12 resolution結果を入力にし、source nameをtyped AST内のstable binding IDへ置換する。

## 9. 変更対象ファイル

新規`expressionTypecheck.ts`、typed AST types、diagnostic tests。

## 10. 追加・更新するテスト

valid/invalid operator cross product、number comparison→boolean、logical、choice identity/order、poisoned/invalid ref、exact span。

## 11. 互換性条件

legacy numeric expression typecheckは変更しない。typed numberから既存geometry numeric refsを使うadapterだけ契約化する。

## 12. performance条件

AST node数に線形。type equality option比較以外のdocument走査禁止。

## 13. 完了条件

16/17/19/22/29が再型検査せずtyped ASTを受け取れる。

## 14. 次タスクへの引き継ぎ

16はreference評価、17はpayload defensive validationを実装する。

## 15. PR境界

TS typecheckerだけ。推奨branch slug: `typed-vars/15-ts-expression-typecheck`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
