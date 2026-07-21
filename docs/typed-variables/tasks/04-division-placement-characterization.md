# 04: DivisionPlacement production characterization

## 1. タイトル

04: DivisionPlacement production characterization

## 2. 目的

union migration前にdistance/ratioの現行production contractをfixtureで固定する。

## 3. 依存タスク

00

## 4. 前提API・型

新APIなし。現行parser/compiler/model/evaluator/serializer/drag/import/clone/IPCをblack-box検証する。

## 5. 対象

distance-only、ratio-only、both、neither、legacy v1/JSON、duplicate、forGroup clone、TS/Rust、drag、serialize。

## 6. 対象外

tagged union実装やbehavior修正。

## 7. 固定仕様

bothはdiagnosticかつcompiler distance、neitherはratio 0.5、serializerはactive側のみ、Rustはdistance以外ratioという現状を記録する。

## 8. 実装方針

各境界に最小fixtureを置き、同一case tableをTS/Rust/serializationへ流す。

## 9. 変更対象ファイル

DSL compiler/serializer tests、drag/duplication/import tests、Rust point evaluator tests、parity fixture。

## 10. 追加・更新するテスト

調査対象すべてをexplicit assertし、既存不正payloadの結果も記録する。

## 11. 互換性条件

test-only。現行behaviorを変更しない。

## 12. performance条件

対象外。

## 13. 完了条件

05が推測なしでmigration mappingを実装できるcharacterization matrixがmainにある。

## 14. 次タスクへの引き継ぎ

05はこのmatrixのobservable resultを変えず内部shapeだけ変更する。

実装時に見つかった、05が把握すべき既存の非対称・層別挙動(修正は行っていない):

- **both指定の「diagnosticかつcompiler distance」は2層に分かれる**。v2フル文書compile
  (`compileDslDocument`/`compileDslToElements`)はexclusivity診断がsource全体にerror
  severityで1件でもあれば即座に`document: null`を返し、`applyArgs`(placementMode選択)へ
  到達しない。「compilerがdistanceを選ぶ」という記述が実際に成立するのは`applyArgs`を
  孤立呼び出しした場合(`dslApplyArgs.test.ts`)だけで、フル文書compileでは両方指定は
  文書全体のcompile失敗として現れる(`dslCompiler.test.ts`のDivisionPlacement
  characterization参照)。
- **legacy v1はv2と非対称**。v2のexclusivity診断(同時に指定できません、error)に対し、
  legacy v1 `withPlacementMode`(`dslCompiler.ts`)はdistanceを先にcheckして無条件に選び、
  診断を一切出さない(`parseLegacyV1Document.test.ts`のDivisionPlacement
  characterization参照)。
- **`lineDivisionPoint`にはdrag handlerが存在しない**。`elementDragTransforms.ts`の
  `movePointElementByDeltaInElements`はこの型をfallback分岐(`return element`)へ通し、
  `didMove`が立たないため呼び出し全体が`null`を返す(他の非対応type、例えば`line`と
  同じ前例パターン)。`divisionPoint`のみ能動field更新のdrag support があり、この非対称は
  現状のまま(`elementDragTransforms.test.ts`参照)。

## 15. PR境界

fixturesだけ。推奨branch slug: `typed-vars/04-placement-characterization`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
