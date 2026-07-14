# Phase 4i: DslPanel / DslEditor の削除

> 親文書: [phase-4-command-line.md](phase-4-command-line.md)。着手前に
> `AGENTS.md` → `docs/overhaul/plan.md` → 親文書の順で読むこと。
>
> コマンドライン系タスク(4a-1〜4g)とも補完(4h)とも**独立**。いつでも
> 並行実装可。常設Source Editor(Phase 2)が旧「書き出し→編集→適用」
> フローを完全に代替済みであることが削除の根拠であり、4h完了を待つ必要は
> ない。

## Context

フローティングDslPanel(textarea実装のDslEditor+ローカル履歴+
検証/適用ボタン)は、テキスト正準化(Phase 1c)と常設エディタ(Phase 2)で
役目を終えた旧世代UI。plan.mdの削除対象リストに含まれる。

## Goal

DslPanel系のコンポーネント・コマンド・store状態・レイアウト永続化を削除し、
旧「書き出し→適用」フローへの参照が残らない状態にする。

## Scope

削除対象(usage検索で漏れを確認すること):

* `src/components/DslPanel.tsx` + `DslPanel.test.tsx`
* `src/components/DslEditor.tsx` + `DslEditor.test.tsx`
* `src/commands/viewModeCommandDefinitions.ts` の `openDslPanel` /
  `validateDslPanel` / `applyDslPanel` / `closeDslPanel`
* `src/commands/commandTypes.ts` の `CommandContext` 内DslPanel系フィールド
  (`validateDslPanel` / `applyDslPanel` / `closeDslPanel` 等)と
  対応command ID型
* `src/state/cadUiStore.ts` の `showDslPanel` / `DslPanelWindow` /
  `dslPanelWindow` / `dslPanelSourceRequest` / `DEFAULT_DSL_PANEL_WINDOW` と
  各setter
* `src/layout/layoutSettingsStorage.ts` の `dslPanelWindow` 永続化
  (保存済み設定に同キーが残っていても安全に無視して読み込めること)
* `src/components/AppLayout.tsx` のlazy import・表示分岐・レイアウト設定連携
* `src/components/ShortcutHelpOverlay.tsx` の `isDslPanelMode`
* `src/commands/elementContextMenuItems.ts` のDslPanel系メニュー項目
* 保存済みshortcutの読込み正規化: 削除command IDへのbindingを代替先なしで
  除去(3d/4gと同じパターン)

## Out of Scope

* `src/dsl/` のシリアライザ・パーサ(DslPanelが使っていた共通機能は
  正準経路の本体。触らない)。
* `data-element-list` matcher(`shortcutDefaultBindings.ts` /
  `shortcuts.ts`)の削除: DslPanel削除で完全デッドコードになるが、
  post-cutover文書どおり**Phase 5の掃除対象**。報告のみ。
* `focusElementList` 命名のリネーム(Phase 5)。
* コマンドライン・補完(他タスク)。

## Existing APIs / files to reuse

* `src/commands/phase3dCommandRegistry.test.ts` — 廃止command IDの
  registry検証パターン。
* `src/keyboard/` の保存済みbinding正規化機構(3dで実装済み)。

## Invariants

* 削除のみで挙動追加なし。常設Source Editor・保存/読込・Undoは無変更。
* 保存済みレイアウト設定・shortcut設定に旧キーが残っていても起動・読込が
  壊れない(前方互換の読み飛ばし)。
* lazy import削除後のバンドルにDslPanelコードが残らない
  (`npm run build` 後の確認まで必須ではないが、importが残っていないことを
  検索で確認)。

## Edge cases

* `dslPanelSourceRequest`(選択要素をパネルへ書き出す要求)を発行していた
  呼び出し元(context menu等)が残っていないこと。
* レイアウト設定ファイルに `dslPanelWindow` が保存されている既存環境からの
  起動。
* ShortcutHelpOverlayのモードラベル分岐の除去でpickモード表示が壊れない
  こと。

## Tests

* registry・`CommandId` 型・default bindingsからDslPanel系IDが消えたことの
  一括テスト(3dパターン)。
* 保存済みbinding・レイアウト設定の正規化テスト(旧キーが安全に除去/
  無視される)。
* `AppLayout` 統合テストの更新(パネル分岐の削除)。
* 全文検索で `DslPanel` / `dslPanel` 参照ゼロ(コメント・ドキュメント内の
  歴史的言及は除く)。

## Manual verification

* 実アプリ起動→旧パネルを開いていた設定ファイルがある状態でも正常起動。
* command paletteに「DSL」で旧パネル系コマンドが出ない。

## Completion criteria

* 親文書の完了条件「DslPanel系ファイルが削除され、旧『書き出し→適用』
  フローの参照が残っていない」を満たす。
* 削除command ID一覧を報告(4g・Phase 5の対応表に合流させる)。
* `npm test` / `npm run build` / `npm run lint` green。

## Dependencies

* Phase 2完了(済み)のみ。全タスクと並行可。ただし4c(CommandLineBarの
  AppLayout組み込み)と同時進行するとAppLayout.tsxで衝突しうるため、
  同時に走らせる場合はどちらかを先にmergeすること。

## Handoff to next task

* Phase 5へ: `data-element-list` matcher・`focusElementList` リネーム・
  その他DslPanel削除で死んだ周辺コードのリストを申し送る。
