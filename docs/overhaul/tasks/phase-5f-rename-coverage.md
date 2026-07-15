# Phase 5f: rename参照形式の統合カバレッジ + 不足修正

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書 → 5d/5e文書とそのハンドバック報告の順で
> 読むこと。
>
> 依存: 5e。5g と並行可。

## Context

5dで解析器、5eでコマンドcoreが完成している。本タスクは**実装タスク**であり、
全参照形式の統合カバレッジ(エンドツーエンド: rename実行→行diff→再コンパイル
→Undo)を追加し、**そこで判明した不足の修正まで**を担当する。

## Goal

参照形式マトリクスの統合テストを固定し、発見された解析・伝播の不足を
5d/5eモジュール内で修正する。

## Scope

* 統合カバレッジ行列(各ケースで「参照行だけがパッチされ、他の行
  (コメント・空行・無関係文)はテキスト完全一致で不変」+「1 Undoで全行
  一括復帰」+「再コンパイルで解決先保存」を検証):
  1. 直接参照(anchor `at=` 等の点・線参照)
  2. `名前.start` / `名前.end` / `名前.pointKey` 派生参照
  3. 式内参照: `@変数名`(グループ変数のスコープ込み)・
     `要素名.parameterKey`・`要素名:key` 形・関数引数形
  4. 名前空間修飾: `グループ::名前`・絶対 `::` パス・shadowing環境下の
     最短トークン再出力
  5. printLayout `place` のグループ参照
  6. グループ自体のrename: 子孫要素への修飾名参照・`place`・
     別グループからの参照の一括追従
  7. **不変であるべきもの**: `roles=[roleId]`・view/role行(ID参照)・
     既存dangling参照(生トークン維持)・行末コメント・明示 `id=` 属性
  8. 拒否系: 同一スコープ衝突・捕獲(dangling同綴り)・shadowingによる
     解決先変化・不正名
  9. 無名要素への命名(rename経由)と、その後の参照・保存→再読込roundtrip
* 5eからの申し送り(保守側拒否ケース・フォールバック発動入力・未網羅形式)を
  すべて統合テスト化し、期待挙動(拒否 or 成功)を確定する。
* 判明した不足の修正: **変更可能範囲は5d/5eで追加したrename解析・bridge
  モジュールと、その関連テストに限定**。
* 1,000要素文書でのrename実行(解析+コミット)perf assert
  (既存の緩い上限パターン)。

## Out of Scope

* rename解析・bridgeモジュール**以外**への変更(`textPatch.ts` /
  `dslSerializer.ts` / `elementNames.ts` / store / UI / CommandLineBar /
  補完)。これらに根本原因がある不足を見つけた場合は**修正せず報告**し、
  rename側で安全に拒否できるならその拒否をテスト固定する。
* UI(5g)・ドキュメント(5h)。
* 新しい参照形式・文法の追加。

## Existing APIs / files to reuse

* 5dの `analyzeRename` と検証関数、5eのコマンドレベル関数(凍結API)。
* `src/document/documentTestGenerators.ts` — プロパティテスト生成器
  (renameケースの拡張はrename関連テスト内に閉じる)。
* 既存の行diff検証パターン(`textPatch.test.ts` の比較手法)。

## Invariants(このタスク固有の事故防止)

* 公開APIの互換を維持(5d/5eの凍結APIに破壊的変更が必要になった場合は
  実施前に報告して指示を仰ぐ)。
* 修正が他機能のテストを1つでも赤にしたら、それはスコープ超過のサイン。
  巻き戻して報告する。
* 「解析器を緩めて通す」方向の修正は、解決先保存の検証がその形式を完全に
  カバーしている場合のみ許可(保守側拒否の解除には必ず対応する統合テストを
  付ける)。

## Edge cases

上記Scopeの行列がそのままedge caseリスト。特に:

* 同名要素が祖先・子孫スコープに併存する文書でのrename前後の最短トークン
  変化(参照行の表記が `名前` → `グループ::名前` へ変わるのは正しい追従で
  あり、行diffの期待値に含める)。
* renameにより**参照側の行の表記だけ**が変わり解決先は不変、のケースを
  「成功」として固定(過剰拒否の回帰防止)。

## Tests

* 上記すべて(本タスクの成果物はほぼテスト+限定修正)。

## Manual verification

* 実アプリ確認は5gのE2Eに委ねる(本タスクはヘッドレスで完結)。

## Completion criteria

* 参照形式行列の統合テストが全形式を網羅してgreen。
* 5eからの申し送りケースがすべて挙動確定(成功 or 拒否)している。
* 修正はrename解析・bridgeモジュールと関連テストのみ(git diffで確認)。
* test / build / lint green。

## Dependencies

* 5e。5gと並行可(ファイル重複なし想定。5gがrenameコマンド関数の
  シグネチャを変える場合は先に調整)。

## Handoff to next task

* 5h へ: 確定した拒否条件一覧・カバレッジ行列(docs/dsl.md のrename節と
  AGENTS.mdの記述の材料)。
