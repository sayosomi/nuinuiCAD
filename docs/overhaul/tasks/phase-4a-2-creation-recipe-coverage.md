# Phase 4a-2: Creation Recipe Coverage(全作成経路の棚卸しとレシピ充足)

> 親文書: [phase-4-command-line.md](phase-4-command-line.md)。着手前に
> `AGENTS.md` → `docs/overhaul/plan.md` → 親文書 →
> [phase-4a-1-creation-recipe-core.md](phase-4a-1-creation-recipe-core.md) →
> 本文書の順で読むこと。

## Context

4a-1で確定したレシピ基盤には代表6型しか載っていない。一方、4g(cutover)は
**現行のすべての要素作成コマンド**をセッション開始へ差し替えて旧経路を
削除する。差し替え時に「対応レシピがない作成コマンド」が1つでも残ると
4gが着地できない。本タスクで現行の作成経路を棚卸しし、残りの全要素型を
4a-1の基盤へ載せ、旧command ID→レシピの対応表を確定する。

**新しい基盤設計は行わない**。4a-1の公開APIへのレシピ追加のみ。API変更が
必要になった場合は実装せず、4a-1への手戻りとして報告すること。

## Goal

4gが参照する「旧作成command ID→要素型→レシピ(専用/フォールバック)」の
完全な対応表と、それを機械検証するテストを確定する。

## Scope

* **棚卸し**: 現行の要素作成入口を列挙する。対象は最低限:
  * `src/commands/creationCommandDefinitions.ts` の全command
    (`addFreePoint` 〜 `addEdge` / `addExtendTrim` 等)
  * `src/commands/elementCreationCommands.ts` の全export
  * context menu・ribbon・Tauriメニューから直接 `addElement` 系を呼ぶ経路
    (usage検索で確認)
  * 除外(親文書の確定判断どおり): `addImage`(ダイアログフロー)、
    `group` / `conditionalGroup` / `forGroup`(構造ブロック)、
    テンプレート挿入、`addNumericVariable` / `addBezierIntermediatePoint`
    等の**既存要素への属性追加**コマンド(要素作成ではない)
* **レシピ追加**: 棚卸しで見つかった全要素型のうち4a-1の代表6型を除く残り
  (`offsetPoint` / `polarOffsetPoint` / `divisionPoint` /
  `lineDivisionPoint` / `intersectionPoint` / `lineTangentOffsetPoint` /
  `angleLengthLine` / `threePointArcLine` / `cornerRadiusArcLine` / `edge` /
  `extendTrim` / `splitLine` / `copyLine` / `symmetricCopyLine` / `move` /
  `symmetricMove` / `text` — 棚卸し結果が正で、この列挙は出発点)について、
  専用レシピを追加するか、フォールバックで十分と判定して**明示的に
  フォールバック指定**する。判定基準: プロンプト文言・ステップ順を
  調整したい型は専用、機械生成で自然な型はフォールバック。
* **対応表**: `creationRecipes.ts`(または隣接モジュール)に
  「旧作成command ID→`CadElementType`→レシピ」の対応を定数として置き、
  4gがそのままimportして使える形にする。
* 追加型ぶんのemitゴールデン・往復テスト(4a-1の自動列挙に載るため、
  追加作業はゴールデン期待値の追加が中心)。

## Out of Scope

* 4a-1の型定義・関数シグネチャ・テスト機構の変更。
* セッション・UI・ピック連携・cutover本体(4b〜4g)。
* store・commands・componentsへの接続(引き続きアプリ非接続、
  挙動変更ゼロ)。
* 新要素型の追加・既存型の属性変更。

## Existing APIs / files to reuse

* 4a-1 `creationRecipes.ts` の公開API一式(凍結済み)。
* `src/commands/creationCommandDefinitions.ts` /
  `elementCreationCommands.ts` — 棚卸しの対象(読むだけ。変更しない)。
* `src/parameters/parameterDefinitions.ts` — 各型のステップ根拠。
* `src/dsl/dslSerializer.ts` / `dslParser.ts` — 往復テスト。

## Invariants

* 4a-1の公開API凍結を守る(追加のみ)。
* 純粋モジュール・アプリ非接続・挙動変更ゼロ(4a-1と同じ)。
* 対応表は**全数**: 4gで削除予定の作成経路に、対応レシピのない
  command IDが存在しないことをテストで機械検証する(手動リスト照合に
  しない)。
* 旧経路の「選択中要素をデフォルト充填する」挙動(`addOffsetLine` の
  選択線採用等)は**レシピへ移植しない**。レシピは常に空から聞く
  (選択の扱いはセッション/UI側の「Enterで明示採用」のみ。親文書の
  最重要不変条件)。

## Edge cases

* `extendTrim` / `edge` / `cornerRadiusArcLine` のようなendpoint参照2つ
  持ちの型のステップ順(線1端点→線2端点の自然な順序)。
* `text` 型: 数値でない `text` 属性はステップ化しない(4a-1の
  フォールバック規則と同じ。本文はジャンプ編集で入れる)。
* `copyLine` / `move` 系のlineList+点2つの複合ステップ列。
* 旧コマンドに対応する型が複数レシピを持つことはない(command ID→型→
  レシピは1:1:1)。

## Tests

* **カバレッジ全数テスト**: 対応表の全command IDが
  `creationCommandDefinitions.ts` の作成command集合と一致し(過不足なし)、
  各エントリのレシピが `creationRecipeForType` で解決できること。
* 追加した専用レシピのparameterDefinitions整合(4a-1の自動列挙で担保)・
  emitゴールデン・serializer往復。
* 明示的フォールバック指定の型が実際にフォールバック生成可能なこと。
* 除外リスト(image / group系 / 属性追加コマンド)が対応表に含まれない
  こと。

## Manual verification

* なし(アプリ非接続)。`npm test` / `npm run build` / `npm run lint` のみ。

## Completion criteria

* **4gで削除予定のすべての作成経路に対応レシピが存在する**(全数テストが
  green)。
* 旧作成command ID→レシピの対応表がコードとして存在し、ハンドバック報告に
  表の写しを含める。
* 4a-1のAPIが無変更のまま(diffで確認)。

## Dependencies

* 4a-1完了。**4b〜4fとは独立に並行可**(同じファイルに触るのは
  `creationRecipes.ts` のみで、4b以降はAPI凍結済みの読み手)。
  4gの前提条件。4h・4iと並行可。

## Handoff to next task

* 4gは本タスクの対応表を使って全作成commandをセッション開始へ差し替える。
  対応表に「専用/フォールバック」の別を残しておくと、4g後のプロンプト
  文言改善(追補)の候補リストになる。
* `angleLengthLine` は専用レシピで `startPoint` と `startPoint:x/y` の重複質問を
  解消しただけである。空文書のfactory既定 `(0, 0)` は、凍結済み
  `emitCreationRecipe` では未入力参照としてクリアされない。**4fは評価結果だけで
  部分プレビュー可否を判定せず、未入力の `startPoint` が原点から有効に見える
  ゴーストを出さないようにすること。** 本タスクでは未解決として扱う。
* 棚卸しで見つかった「作成でも属性追加でもない曖昧な経路」があれば、
  修正せず4gへの申し送りとして報告する。
