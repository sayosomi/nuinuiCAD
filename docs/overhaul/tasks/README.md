# 実装タスク一覧

全体計画は [`../plan.md`](../plan.md)。各タスクは独立したcoding agentへ
そのまま渡せる自己完結の指示書になっている。**必ず順序どおりに着手し、
各Phaseはアプリが完全に動作する状態で着地させること。**

## 依存関係

```
phase-0-dsl-grammar
  └─ phase-1a-pure-modules
       └─ phase-1b-shadow-text
            └─ phase-1c(親文書: phase-1c-text-canonical。実装は4分割の直列)
                 1c-1-fold-state → 1c-2-preview-elements
                   → 1c-3-canonical-inversion → 1c-4-selection-ui-store
                 └─ phase-1d-nui-format
                      └─ phase-2(親文書: phase-2-codemirror-pane。実装は5分割の直列)
                           2a-codemirror-foundation → 2b-editor-sync-undo
                             → 2c-selection-fold → 2d-diagnostics-keyboard-features
                             → 2e-left-panel-cutover
                             (→ post-cutover-editor-polish: 記録文書)
                           ├─ phase-3(親文書: phase-3-inspector。実装は4分割)┐
                           │    3a-value-span-jump-api                        │並行可
                           │      → (3b-numeric-step-command ∥ 3c-inspector-panel)
                           │      → 3d-form-editor-removal                    │
                           └─ phase-4(親文書: phase-4-command-line。実装は10分割)┘
                                ├─ 4a-1-creation-recipe-core
                                │    ├─ 4a-2-creation-recipe-coverage(4b〜4fと並行可)
                                │    └─ 4b-command-line-session
                                │         → 4c-command-line-bar → 4d-pick-routing
                                │         → 4e-unnamed-promotion → 4f-ghost-preview
                                │         → 4g-creation-cutover(4e+4f+4a-2の後)
                                ├─ 4h-dsl-autocomplete(4a-1〜4g・4iと独立並行可)
                                ├─ 4i-dsl-panel-removal(4a-1〜4g・4hと独立並行可)
                                └─ phase-5(親文書: phase-5-cleanup。実装は10分割。
                                     3と4(=4g+4h+4i)の完了後)
                                     ├─ 5a-dsl-compat-reduction      ┐
                                     ├─ 5b-1-legacy-format-dead-code │相互独立
                                     │    └─ 5b-2-snapshot-mirror-removal
                                     ├─ 5c-command-keyboard-cleanup  │並行可
                                     ├─ 5i-midsession-step-edit(B-6解消)
                                     └─ 5d-rename-analysis           ┘
                                          └─ 5e-rename-command-bridge
                                               ├─ 5f-rename-coverage ┐並行可
                                               └─ 5g-rename-ui       ┘
                                                    └─ 5h-docs-update(5a〜5g・5i全完了後)
```

| タスク | 内容 | 依存 |
|---|---|---|
| [phase-0-dsl-grammar.md](phase-0-dsl-grammar.md) | 文書完全表現のDSL文法(ブロック・無名文・palette/printLayout/`@stop`・トークンスパン) | なし |
| [phase-1a-pure-modules.md](phase-1a-pure-modules.md) | statementReconciler / textPatch(純粋モジュール、アプリ非接続) | 0 |
| [phase-1b-shadow-text.md](phase-1b-shadow-text.md) | 影テキスト維持+dev等価assert(正準はJSONのまま) | 1a |
| [phase-1c-text-canonical.md](phase-1c-text-canonical.md) | **親文書**: 正準反転の全体要件。実装は下記1c-1〜1c-4へ分割(2026-07-10) | 1b |
| [phase-1c-1-fold-state.md](phase-1c-1-fold-state.md) | `expanded`/`elseExpanded` の文書モデル外出し(cadUiStoreへ) | 1b |
| [phase-1c-2-preview-elements.md](phase-1c-2-preview-elements.md) | previewElements分離(previewが正準stateを触らなくなる) | 1c-1 |
| [phase-1c-3-canonical-inversion.md](phase-1c-3-canonical-inversion.md) | 正準反転コア: sourceTextが正・commitText・統合Undo | 1c-2 |
| [phase-1c-4-selection-ui-store.md](phase-1c-4-selection-ui-store.md) | selectionのcadUiStore移動+Phase 1c手動E2E | 1c-3 |
| [phase-1d-nui-format.md](phase-1d-nui-format.md) | `.nui` 保存/読込+レガシーインポータ | 1c-4 |
| [phase-2-codemirror-pane.md](phase-2-codemirror-pane.md) | **親文書**: CodeMirror 6 左ペイン。実装は下記2a〜2eへ分割(2026-07-11) | 1d |
| [phase-2a-codemirror-foundation.md](phase-2a-codemirror-foundation.md) | CMアダプタ・source update protocol・性能baseline | 1d |
| [phase-2b-editor-sync-undo.md](phase-2b-editor-sync-undo.md) | 未commit buffer・中央flush・CM/store Undo統合 | 2a |
| [phase-2c-selection-fold.md](phase-2c-selection-fold.md) | cursor/Canvas選択同期・複数選択・fold | 2b |
| [phase-2d-diagnostics-keyboard-features.md](phase-2d-diagnostics-keyboard-features.md) | dirty diagnostics・評価decorations・keyboard・旧機能移行 | 2c |
| [phase-2e-left-panel-cutover.md](phase-2e-left-panel-cutover.md) | AppLayout切替・LeftPanel削除・性能/E2E | 2d |
| [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md) | **記録文書**: Phase 2e完了後のEditor polish棚卸し(2026-07-12)。Phase 3/4はここを現在仕様の正とする | 2e(完了済み) |
| [phase-3-inspector.md](phase-3-inspector.md) | **親文書**: 読み取り専用インスペクタ+フォーム編集廃止。実装は下記3a〜3dへ分割(2026-07-12) | 2 |
| [phase-3a-value-span-jump-api.md](phase-3a-value-span-jump-api.md) | パラメータ→値spanジャンプAPI(ラベル付き値span・keyマッピング・handle拡張) | 2 |
| [phase-3b-numeric-step-command.md](phase-3b-numeric-step-command.md) | エディタネイティブ数値ステップコマンド(Alt+→/←、stepLevels) | 3a |
| [phase-3c-inspector-panel.md](phase-3c-inspector-panel.md) | 読み取り専用InspectorPanel(3cでは行ナビ・Enterジャンプ・旧UIと一時併存、3dでマウス専用化) | 3a(3bと並行可) |
| [phase-3d-form-editor-removal.md](phase-3d-form-editor-removal.md) | フォーム編集・旧編集モード削除、Inspectorマウス専用化、廃止shortcut除去 | 3b + 3c |
| [phase-3d-command-id-map.md](phase-3d-command-id-map.md) | 3dの旧command ID→新command ID／廃止、および保存済みshortcut移行表 | 3d |
| [phase-4-command-line.md](phase-4-command-line.md) | **親文書**: コマンドライン作図+DSL補完(DslPanel削除)。実装は下記4a-1〜4iへ分割(2026-07-14) | 2 |
| [phase-4a-1-creation-recipe-core.md](phase-4a-1-creation-recipe-core.md) | レシピ共通基盤(代表6型+フォールバック生成+安定API。アプリ非接続) | 2 |
| [phase-4a-2-creation-recipe-coverage.md](phase-4a-2-creation-recipe-coverage.md) | 全作成経路の棚卸し+残り全型のレシピ充足+旧command ID対応表 | 4a-1(4b〜4fと並行可) |
| [phase-4b-command-line-session.md](phase-4b-command-line-session.md) | セッション状態機械(純粋遷移+cadUiStore状態。UIなし) | 4a-1 |
| [phase-4c-command-line-bar.md](phase-4c-command-line-bar.md) | CommandLineBar+セッションコマンド+挿入確定(参照ステップなしレシピ解放) | 4b |
| [phase-4d-command-line-pick-routing.md](phase-4d-command-line-pick-routing.md) | ピック・名前タイプ充填のセッション連携(参照ステップありレシピ解放) | 4c |
| [phase-4e-unnamed-promotion.md](phase-4e-unnamed-promotion.md) | 無名要素の自動昇格(命名+同一Undo行パッチ) | 4d |
| [phase-4f-ghost-preview.md](phase-4f-ghost-preview.md) | セッション中のゴーストプレビュー(previewDocumentChange) | 4d(4eと直列推奨) |
| [phase-4g-creation-cutover.md](phase-4g-creation-cutover.md) | 作成コマンドのセッション起動cutover+旧即時挿入削除 | 4e + 4f + 4a-2 |
| [phase-4h-dsl-autocomplete.md](phase-4h-dsl-autocomplete.md) | エディタ内DSL文脈補完(cmAutocomplete) | 2(4a-1〜4g・4iと独立) |
| [phase-4i-dsl-panel-removal.md](phase-4i-dsl-panel-removal.md) | DslPanel/DslEditor削除 | 2(4a-1〜4g・4hと独立) |
| [phase-5-cleanup.md](phase-5-cleanup.md) | **親文書**: 互換コード削除・リネーム伝播・B-6解消・ドキュメント更新。実装は下記5a〜5iへ分割(2026-07-16)。merge順・review境界は親文書を正とする | 3 + 4(4g+4h+4i) |
| [phase-5a-dsl-compat-reduction.md](phase-5a-dsl-compat-reduction.md) | DSL互換の縮小掃除(`includeIds`+`expanded=`/`elseExpanded=` 削除。`id=`/`parent=`/`branch=` は正式文法として存続) | 5b系・5c・5dと並行可 |
| [phase-5b-1-legacy-format-dead-code.md](phase-5b-1-legacy-format-dead-code.md) | レガシー形式デッドコード削除(`documentMigration.ts`・`documentFormat.ts` 縮小。インポータ維持+roundtrip確認) | 5a・5c・5dと並行可 |
| [phase-5b-2-snapshot-mirror-removal.md](phase-5b-2-snapshot-mirror-removal.md) | change/スナップショット型の `selected*`・`printLayout` ミラー削除+読み手の派生化(Undo・Canvas・印刷回帰) | 5b-1(5eより先にmerge) |
| [phase-5c-command-keyboard-cleanup.md](phase-5c-command-keyboard-cleanup.md) | `data-element-list` matcher削除・`focusElementList` リネーム・retired ID再分類+[確定版対応表](../command-id-map.md)反映 | 5a・5b系・5dと並行可(5gより先にmerge) |
| [phase-5d-rename-analysis.md](phase-5d-rename-analysis.md) | rename参照解析の純粋モジュール(衝突・捕獲・解決先変化の拒否判定+期待パッチ行集合。アプリ非接続)。**完了時review境界1** | 5a・5b系・5cと並行可 |
| [phase-5e-rename-command-bridge.md](phase-5e-rename-command-bridge.md) | renameコマンドcore(flush→解析→拒否 or 1 commit+dev検証。UIなし)。**完了時review境界2** | 5d(+5b-2のmerge先行) |
| [phase-5f-rename-coverage.md](phase-5f-rename-coverage.md) | rename参照形式の統合カバレッジ+不足修正(変更範囲は5d/5eモジュールと関連テスト限定) | 5e(5gと並行可) |
| [phase-5g-rename-ui.md](phase-5g-rename-ui.md) | rename UI接続(専用最小プロンプト+`renameSelectedElement` 登録) | 5e(+5cのmerge先行。5fと並行可) |
| [phase-5i-midsession-step-edit.md](phase-5i-midsession-step-edit.md) | コマンドライン途中段階での完了済みステップ編集(B-6解消。Phase 4挙動不変条件へのユーザー承認済み例外) | なし(全子タスクと並行可。5hより先に完了) |
| [phase-5h-docs-update.md](phase-5h-docs-update.md) | ドキュメント更新(AGENTS.md/ROADMAP.md/docs/dsl.md/対応表確定)。**完了時review境界3(Phase 5全体)** | 5a〜5g・5iすべて |

## 各エージェントへの共通指示

* 着手前に `AGENTS.md` → `docs/overhaul/plan.md` → 自分のタスクファイルの順で
  読むこと。
* タスクの「やってはいけないこと」はスコープ境界。隣のPhaseの作業を
  先取りしない。
* ハンドバック時に報告すること: 完了条件の充足状況、実行したチェック
  (`npm test` / `npm run build` / `npm run lint`、該当時 `test:parity`)、
  スコープ外で発見した問題(修正せず報告のみ)、廃止・変更したコマンドIDの
  対応表(該当Phaseのみ)。
