# Phase 4a-1: Creation Recipe Core(レシピ共通基盤)

> 親文書: [phase-4-command-line.md](phase-4-command-line.md)。着手前に
> `AGENTS.md` → `docs/overhaul/plan.md` → 親文書 → 本文書の順で読むこと。

## Context

Phase 4のコマンドライン作図は「作成コマンド→必須参照・数値を順にプロンプト
→名前ステップ→確定」のセッションで動く。そのセッションが消費する宣言的
データ(要素型ごとのステップ列と、引数から要素モデルを組み立てるemit)の
**共通基盤**を先に純粋モジュールとして確定する。本タスクはアプリに一切
接続しない: 挙動変更ゼロで、テストだけで品質を確定できる(Phase 1aと同じ
原理)。

全要素型のカバーは本タスクでは行わない。代表型で基盤とAPIを固め、残りの
型は [phase-4a-2-creation-recipe-coverage.md](phase-4a-2-creation-recipe-coverage.md)
が同じ基盤の上に載せる。**4b以降はこのタスクが確定するAPIに依存する**ため、
型シグネチャとステップ意味論を安定させることが最優先。

## Goal

`src/commands/creationRecipes.ts`(+テスト)を新設し、代表型の専用レシピ・
汎用フォールバック生成・emit・整合テストの仕組みを、4a-2と4bがそのまま
拡張・消費できる安定APIとして確定する。

## Scope

* レシピ型定義(公開API。4a-2/4b/4c/4dが依存する):

  ```ts
  type CreationStep =
    | { kind: "point"; key: ParameterKey; prompt: string }        // reference
    | { kind: "endpoint"; key: ParameterKey; prompt: string }     // lineEndpointReference
    | { kind: "line"; key: ParameterKey; prompt: string }         // lineReference
    | { kind: "lineList"; key: ParameterKey; prompt: string }     // lineReferenceList
    | { kind: "number"; key: ParameterKey; prompt: string; default?: string }
    | { kind: "name"; autoSuggest: true };
  type CreationRecipe = {
    type: CadElementType;
    steps: CreationStep[];
    emit: (args: CreationArgs) => CadElement;
  };
  ```

  `CreationArgs` はステップkey→値(`PointAnchor` / lineEndpoint参照 /
  `ElementId` / `ElementId[]` / `NumericValue` / 名前文字列)のRecord。
* 代表型の専用レシピ(**この6型のみ。追加は4a-2**):
  `freePoint` / `line` / `arcLine` / `bezierCurve` / `offsetLine` /
  `variable`。ステップkindの全種(point / endpoint / line / lineList /
  number / name)がこの6型で少なくとも1回ずつ使われるよう構成を確認し、
  使われないkindがあればテストフィクスチャで補うこと(基盤の検証漏れを
  4a-2へ持ち越さない)。
* 汎用フォールバックレシピ生成: 任意の `CadElementType` について
  `getParameterDefinitions` の必須参照・数値kindからステップ列を機械生成する
  `fallbackCreationRecipe(type)`。
* `emit` は `createCadElement(type, elements, { referenceElements })` で
  デフォルト要素を作り、`setParameterValue` で引数を反映して返す。
  **DSL文字列を手で組み立てない**(シリアライズは挿入側=4cの責務)。
  名前引数が無い場合は無名要素(name空)のまま返す。
* レシピ検索 `creationRecipeForType(type)`(専用→フォールバックの順)と、
  レシピ対象外型の定数(`image` / `group` / `conditionalGroup` /
  `forGroup`)。
* 整合テスト・ゴールデンテストの**仕組み**(4a-2が型を追加したら自動で
  検査対象に入る形。型ごとの手書きテスト列挙に依存しない)。

## Out of Scope

* 残り全要素型の専用レシピ化と旧作成コマンド棚卸し(4a-2)。
* セッション状態機械(4b)、UI(4c)、ピック連携(4d)。
* store・commands・componentsへの接続。既存ファイルの変更は原則なし
  (型のexport追加など最小限は可)。

## Existing APIs / files to reuse

* `src/parameters/parameterDefinitions.ts` — 値kind(`reference` /
  `lineEndpointReference` / `lineReference` / `lineReferenceList` / `number`
  等)・ラベル(promptの既定文言)・`choiceOptions`。
* `src/model/elementFactory.ts` `createCadElement` — デフォルト要素生成。
* `src/parameters/parameterAccess.ts` `setParameterValue`。
* `src/types/geometry.ts` `elementTypeLabels` / `CadElementType`。
* `src/commands/parameterPickCommand.ts` — kind→pickコマンドの既存対応
  (ステップkindの分類と揃える)。
* `src/dsl/dslSerializer.ts` / `dslParser.ts` — 往復テストに使用。

## Required changes

* 新規 `src/commands/creationRecipes.ts` と
  `src/commands/creationRecipes.test.ts` のみ。

## Invariants

* 純粋モジュール: store・React・CodeMirror・Tauri import禁止。ID生成は
  `createCadElement` 経由(メモリの「ID生成器の注入」規約に従い、テストでは
  決定的generatorを注入できる経路を保つ)。
* promptは `parameterDefinitions` のラベルを既定とし、レシピ側での上書きは
  文言のみ(keyやkindを変えない)。
* 必須参照ステップを省略したemitは例外を投げず、参照が空の要素を返す
  (妥当性はセッション側=完了判定の責務。偽のデフォルト参照で埋めない)。
* 公開APIは本タスクで凍結: 4a-2はレシピの**追加のみ**を行い、型・関数
  シグネチャの変更を必要としないこと。変更が必要になった場合は4a-2側で
  実装せず、本タスクへの手戻りとして報告する。

## Edge cases

* `variable` のような参照を持たない型(number+nameのみのレシピ)。
* `offsetLine.baseLineIds` のような複数線(lineList)ステップ。
* `bezierCurve` の中間点など、コマンドラインで聞かない属性(作成後に
  ジャンプ編集で足す前提)がemitのデフォルト値として妥当なこと。
* フォールバック生成で `choice` / `boolean` / `text` kindに遭遇した場合:
  ステップ化せずデフォルト値のままにする(コマンドラインで聞くのは
  参照・数値・名前のみ。それ以外はジャンプ編集で直す)。

## Tests

* **parameterDefinitions整合テスト**: 全登録レシピの全ステップについて、
  keyが当該型の定義に存在し、ステップkindと定義kindが対応表どおりで
  あること。乖離時にどのレシピのどのkeyかが分かるメッセージで落とすこと。
  登録レシピを列挙して自動で回る形にする(4a-2の追加分が無条件で対象に
  入る)。
* **emitゴールデンテスト**: 代表6型それぞれについて、引数→emit要素を
  `dslSerializer` で1文シリアライズした文字列のゴールデン比較。
* **serializer往復テスト**: emit要素のシリアライズ結果を `dslParser` →
  コンパイルで読み戻し、同値の要素になること(名前あり/無名の両方)。
* フォールバック生成: レシピ対象外定数を除く全 `CadElementType` について
  ステップ列が生成でき、必須参照kindが漏れないこと。
* 名前引数あり/なし(無名)のemit挙動。

## Manual verification

* なし(アプリ非接続)。`npm test` / `npm run build` / `npm run lint` のみ。

## Completion criteria

* 上記テストがすべてgreenで、アプリの挙動変更がない(既存テスト無傷)。
* 代表6型のレシピと対象外型の定数が読み取れる。
* 公開API(型・関数シグネチャ)がJSDoc付きで確定し、4a-2/4bが参照すべき
  APIの一覧をハンドバック報告に含める。

## Dependencies

* Phase 2 / Phase 3 完了(済み)。先行子タスクなし。4h・4iと並行可。

## Handoff to next task

* 4a-2は本タスクの基盤の上に残り全型のレシピを載せる(基盤設計の変更
  禁止)。整合テスト・往復テストは自動列挙なので、4a-2はレシピ追加と
  ゴールデン追加だけでよい。
* 4b(セッション状態機械)は `CreationRecipe` / `CreationStep` 型と
  ステップ意味論をそのまま消費する。ステップ順序はレシピ配列順が正。
* emitが返すのは**無名でありうる `CadElement`**。シリアライズと挿入は4c、
  参照先無名要素の昇格は4eの責務。
