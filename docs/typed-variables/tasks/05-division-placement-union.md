# 05: DivisionPlacement tagged union migration

## 1. タイトル

05: DivisionPlacement tagged union migration

## 2. 目的

`placementMode`とinactive fieldをtagged unionへ置換し、不可能な内部状態を型で排除する。

## 3. 依存タスク

04

## 4. 前提API・型

`DivisionPlacement = {kind:"distance"|"ratio"; value: NumericValue}`。division elementは`placement`を持つ。

## 5. 対象

types/factory/compiler/serializer/parameter access/dependency/evaluator/drag/duplication/forGroup/import/IPC parityを一括migrationする。

## 6. 対象外

DSL syntax変更、distance/ratio同時指定許可、typed choice binding。

## 7. 固定仕様

04 matrixを維持。legacy JSONのdistance modeはdistance、それ以外はratio。active value欠落はdiagnosticで既定補正しない。

## 8. 実装方針

compat conversionをdocument/import boundaryに限定し、production consumerをunion exhaustive switchへ変更する。

## 9. 変更対象ファイル

geometry types、factory、DSL apply/serialize、parameter/dependency、TS/Rust evaluators、drag/import/parity tests。

## 10. 追加・更新するテスト

04全fixture、exhaustive typecheck、inactive valueが存在しないこと、round-trip、desktop payload。

## 11. 互換性条件

DSLは同じ。old JSON import mappingのみ追加。

## 12. performance条件

payload sizeが増えないこと。専用benchmark不要。

## 13. 完了条件

productionにplacementMode分岐が残らず、04 matrixと全quality gateがgreen。

## 14. 次タスクへの引き継ぎ

typed variable計画と独立。51/52は完了だけをrelease条件に使う。

実装時の判断(04 matrixの観測結果は変えていない):

- **`getParameterValue`はinactive側の値を返さない**。`distance`/`ratio`キーはそれぞれ
  `placement.kind`が一致する場合だけ値を返し、不一致側は既存APIの欠損表現(`undefined`)を
  返す。明示的な`setParameterValue(el,"distance"|"ratio",v)`はkindをそのキーへ切り替える。
  04はこの読み出し経路を固定していなかったため、新規に決めた挙動。
- **missing/garbage `placement.kind`のratio fallbackは単一のdecode関数へ集約**。TSは
  `pointEvaluators.ts`内の`decodeDivisionPlacement`、Rustは新規`division_placement.rs`の
  `decode_division_placement`が唯一の非exhaustive fallback箇所。各evaluatorはこの結果を
  exhaustiveに分岐するだけで、`kind !== "distance"`の文字列比較を個別に持たない。
- **legacy JSON importで active valueが欠落している場合はdiagnostic(Error)**。
  `elementNormalization.ts`の`withDivisionPlacement`が変換の唯一の場所であり、
  distance modeでdistance欠落、ratio/不明modeでratio欠落のときは既定値へ補正せず
  `parseCadDocumentFile`経由でthrowする(`documentFormat.test.ts`参照)。
- **凍結ファイル`src/document/legacyDsl/dslCompiler.ts`を機械的に変更した**。
  `docs/dsl2/tasks/f4-legacy-removal.md`の凍結は削除条件の話であり、共有型の変更に
  追従するための無挙動変更(`withPlacementMode`の出力shape変更のみ)は対象外と判断した。
- **desktop IPC payloadに旧3 fieldが残らないこと、union化後もpayload sizeが旧shape以下で
  あることをfixtureで固定した**(`elementFactory.test.ts`)。

## 15. PR境界

placement union migrationだけ。推奨branch slug: `typed-vars/05-placement-union`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
