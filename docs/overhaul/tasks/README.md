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
                      └─ phase-2-codemirror-pane
                           ├─ phase-3-inspector      ┐ 並行可
                           └─ phase-4-command-line   ┘
                                └─ phase-5-cleanup(3と4の両方の完了後)
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
| [phase-2-codemirror-pane.md](phase-2-codemirror-pane.md) | CodeMirror 6 左ペイン(構成リスト置換) | 1d |
| [phase-3-inspector.md](phase-3-inspector.md) | 読み取り専用インスペクタ+フォーム編集廃止 | 2 |
| [phase-4-command-line.md](phase-4-command-line.md) | コマンドライン作図+DSL補完(DslPanel削除) | 2 |
| [phase-5-cleanup.md](phase-5-cleanup.md) | 互換コード削除・リネーム伝播・ドキュメント更新 | 3 + 4 |

## 各エージェントへの共通指示

* 着手前に `AGENTS.md` → `docs/overhaul/plan.md` → 自分のタスクファイルの順で
  読むこと。
* タスクの「やってはいけないこと」はスコープ境界。隣のPhaseの作業を
  先取りしない。
* ハンドバック時に報告すること: 完了条件の充足状況、実行したチェック
  (`npm test` / `npm run build` / `npm run lint`、該当時 `test:parity`)、
  スコープ外で発見した問題(修正せず報告のみ)、廃止・変更したコマンドIDの
  対応表(該当Phaseのみ)。
