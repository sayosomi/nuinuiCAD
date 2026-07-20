# 08: Scalar type/value/property capability contracts

## 1. タイトル

08: Scalar type/value/property capability contracts

## 2. 目的

typed binding全体が共有するdiscriminated unionとproperty opt-in metadataを、production未接続の純粋moduleとして定義する。

## 3. 依存タスク

00

## 4. 前提API・型

`ScalarType`、`ScalarValue`、`ScalarEvaluation`、type equality/assignability、choice identity/member、`PropertyBindingCapability`。

## 5. 対象

number/string/boolean/choice contracts、property subset rule、JSON serialization shape、parameter metadata query。

## 6. 対象外

DSL parser、expression、evaluation、actual property runtime。

## 7. 固定仕様

choice identityはoptions+order完全一致。propertyだけsubset assignment。implicit conversionなし。

## 8. 実装方針

`src/scalars/types.ts`とfocused validation moduleを作り、parameterDefinitionsはcapability fieldを宣言できる最小型拡張だけ行う。

## 9. 変更対象ファイル

新規`src/scalars/*` type/validation、parameter definition type、pure tests。

## 10. 追加・更新するテスト

全type equality/assignment matrix、choice order/member/subset、JSON round-trip、invalid payload。

## 11. 互換性条件

既存parameter definition consumerは新field optionalで無変更。

## 12. performance条件

type comparisonはoption数に線形。document全走査を含めない。

## 13. 完了条件

後続taskがstring literalでkind比較せずAPIを利用でき、production importはまだない。

## 14. 次タスクへの引き継ぎ

09/15/17/22が契約をimportする。

## 15. PR境界

contractsだけ。推奨branch slug: `typed-vars/08-scalar-contracts`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
