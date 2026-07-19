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

## 15. PR境界

placement union migrationだけ。推奨branch slug: `typed-vars/05-placement-union`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
