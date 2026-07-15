# Phase 5c: command / keyboard 掃除 + 確定版command ID対応表の反映

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書 →
> [../command-id-map.md](../command-id-map.md)(確定版対応表)の順で読むこと。
>
> 5a / 5b系 / 5d と相互独立・並行可。**5g より先にmergeすること**
> (`commandTypes.ts` / command定義群が重なる)。

## Context

4iからの明示的な残件と、Phase 3d/4gで実装済みの正規化機構の最終整理:

* `data-element-list` matcher(`shortcuts.ts` の `isElementListTarget`、
  `shortcutDefaultBindings.ts` の同関数+`elementListAltArrowMatch`)は
  LeftPanel/DslPanel削除により実DOMに対象属性が存在せず**常時false**。
  分岐は配線されたまま残っている。
* `focusElementList`(CommandId+`CommandContext.focusElementList`)と
  `enterElementListMode` は現在Source Editorのfocusを意味する
  (`AppLayout.tsx` で `sourceEditorRef.current?.focus()`)。命名だけが旧世代。
* retired ID正規化は `shortcutSettingsStorage.ts`(`retiredCommandIds` 37 id
  +`legacyBindingIdMap`+正規化・書き戻し)に実装済み。DSL panel系5 idが
  `phase4iDslPanelRemoval.test.ts` と重複定義されている。
* 対応表は `docs/overhaul/tasks/phase-3d-command-id-map.md`・4a-2のコード内
  テーブル・4g/4i報告に分散していたため、確定版
  `docs/overhaul/command-id-map.md` を新設済み(本タスクで「予定(5c)」行を
  確定させる)。

## Goal

死んだmatcher・旧命名を取り除き、コマンドIDの現役/retired/完全削除を
**実コードから**再分類して、確定版対応表と実装・テストを一致させる。
既存のmigration・正規化を1つも壊さない。

## Scope

* `data-element-list` matcherの削除:
  * `isElementListTarget` と `[data-element-list]` セレクタ、
    `elementListAltArrowMatch` を削除し、常時false前提で分岐を単純化
    (`shortcuts.ts` / `shortcutDefaultBindings.ts`)。
  * 単純化の結果、**有効なbindingの発火条件が1つも変わらない**ことを
    テストで固定(alt+Arrow系・Enter/space guardの現行挙動スナップショット)。
* 旧命名のリネーム:
  * `focusElementList` → `focusSourceEditor`(CommandId・
    `CommandContext.focusElementList`・全caller: `AppLayout.tsx` /
    `DrawingCanvas.tsx` / `commandLineSessionCommands.ts` /
    `viewModeCommandDefinitions.ts`)。新ID名の衝突がないことを先に確認。
  * `enterElementListMode` の再分類: 実コードでの役割(既定binding `g` で
    Source Editorへfocus)を確認し、`focusSourceEditor` への統合か
    `enterSourceEditorMode` 等へのリネームかを、既存commandの役割分担
    (palette表示名・binding scope)に照らして決める。**保存済みshortcutは
    `legacyBindingIdMap` へ旧→新binding IDを追加して移行**する(3dパターン)。
* retired IDリストのsingle source化:
  * `phase4iDslPanelRemoval.test.ts` のリテラル重複を
    `shortcutSettingsStorage.ts`(または共有定数)からのimportへ一本化。
    enforcementテストの検証力を落とさないこと(「registryに存在しない」
    assertは維持)。
* 再分類の棚卸し:
  * `CommandId` 型・registry・palette・default bindings・
    `retiredCommandIds` / `legacyBindingIdMap` を突き合わせ、
    (a) 現役、(b) retired(設定から安全除去)、(c) 移行(旧→新binding)、の
    分類が確定版対応表と一致することを機械検証するテストを追加または更新。
  * 分類が対応表と食い違う場合は**実コードを正**として対応表
    (`docs/overhaul/command-id-map.md`)を更新する。
* 対応表の「予定(5c)」行を確定ステータスへ更新。

## Out of Scope

* 新規コマンドの追加(5gの `renameSelectedElement` は本タスクでは触れない)。
* コマンドの挙動変更(focus先・binding chordの変更。リネームと死コード削除
  のみ)。
* CommandLineBar・補完・pick routing。

## Existing APIs / files to reuse

* `src/keyboard/shortcutSettingsStorage.ts` —
  `normalizeShortcutSettingsWithStatus` / `legacyBindingIdMap` /
  `retiredCommandIds`(3dで実装済みの正規化・書き戻し機構)。
* `src/commands/phase3dCommandRegistry.test.ts` /
  `phase4iDslPanelRemoval.test.ts` / `phase4gCreationCutover.test.ts` —
  enforcementテストのパターン。

## Invariants(このタスク固有の事故防止)

* 既存の保存済みshortcut移行(3d/4gの `legacyBindingIdMap` 行)を削除・変更
  しない。追加のみ。
* 正規化の書き戻し失敗が読込を妨げない現行挙動を維持。
* **未知コマンドIDを含むshortcut設定が安全に無視される**ことの明示テスト
  (Phase 5全体の完了条件。既存テストがあれば流用し、なければ追加)。
* リネーム後、旧 `focusElementList` binding IDを含む保存済み設定が新IDへ
  移行されること(テスト)。
* default bindingの実効チョード集合(scope×chord×command)がリネーム以外で
  不変であることのスナップショット比較。

## Edge cases

* 旧binding IDと新binding IDの両方が保存済み設定に存在する場合(新IDの
  既存overrideを優先する3dの併合規則に従う)。
* `g` バインドがform入力focus中に発火しない既存原則の維持。

## Tests

* 上記Invariants各項。
* registry・`CommandId` 型・default bindingsから旧ID(`focusElementList` 等)
  が消えたことの一括テスト(3dパターン)。
* 対応表との機械突き合わせ(retired集合・移行mapが表の行と一致)。

## Manual verification

* 実アプリで `g`(または再分類後のbinding)でSource Editorへfocusが移る。
* 旧設定ファイル(旧binding ID入り)がある状態で起動→正常動作+設定が
  正規化される。

## Completion criteria

* grepで `data-element-list` / `focusElementList` /
  `enterElementListMode`(旧名)がsrc/からゼロ(対応表・歴史的文書は除く)。
* `docs/overhaul/command-id-map.md` の「予定(5c)」行が確定済みに更新され、
  機械検証テストと一致。
* test / build / lint green。

## Dependencies

* なし(Phase 4完了のみ)。5a / 5b系 / 5d と並行可。**5gより先にmerge**。

## Handoff to next task

* 5g へ: `CommandContext` の最終形(リネーム後のfocus関数名)。
* 5h へ: 対応表の確定内容(ドキュメント整合パスで参照)。
