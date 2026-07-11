# Phase 2e: Source Editor本番切替・LeftPanel削除・性能/E2E

> 親文書: [phase-2-codemirror-pane.md](phase-2-codemirror-pane.md)。
> Phase 2d完了後に着手する。Phase 2の最終段。

## 目的

完成済みSourceEditorPaneをAppLayoutへ組み込み、LeftPanel系を削除する。全機能の
移行漏れ、履歴境界、500〜1000行性能、日本語IMEを実アプリで検証してPhase 2を閉じる。

## 変更対象

* `AppLayout.tsx`でLeftPanelをSourceEditorPaneへ差し替え、既存の幅resize/storageを
  維持する。
* `focusElementList` / `elementSearchInputRef`等のrefをSource Editor handleへ付け替える。
* palette/view入口、document status、Source検索、ribbon dock、context menuを配置する。
* 以下を削除する: `LeftPanel.tsx`、`ElementListRow.tsx`、`useElementListData.ts`、
  `elementListPointerDrag`、`elementListName`とリスト専用テスト/スタイル。
* Source Editorでも使うcontext menu/status/ribbonロジックは、削除前にSource向けの
  名前・責務へ移す。死んだ`cadUiStore` stateの大掃除はPhase 5まで先取りしない。

## cutover手順

1. SourceEditorPaneを配置し、production treeからLeftPanelを外す。
2. 機能移行表の各項目を実アプリで確認する。
3. `rg`で旧component/helper/styleの参照を全数確認して削除する。
4. 旧LeftPanelテストをSource Editorのbehavior testへ置換する。
5. 性能計測とmacOS/Tauri手動E2Eを行う。

途中commitでは旧UIをproductionに残してよいが、Stage完了時にfeature flagや二重UIを
残してはならない。

## 性能予算

* 500/1000行の単一入力transaction+viewport decoration: median 16ms以下、p95 32ms以下。
* 外部1行model patchのCM反映: median 16ms以下(CAD compile時間を分離計測)。
* 1000要素commit: 現行baseline約222msに対しmedian 300ms以下、かつPhase 2追加処理で
  25%以上悪化させない。
* continuous typing中は300ms timerを更新するだけでcompileしない。
* scroll時にviewport外decorations/widget/React rowsを全生成しない。
* 1000行scroll、fold、selection jumpで長時間taskが連続しないことを実機確認する。
* 予算超過時はprofileしてPhase 2追加処理を修正する。Web WorkerやRust DSL compilerへの
  移行は本Stageで導入しない。

## Source Editor shortcut移行

CodeMirrorで通常のDSL文字入力を妨げないため、旧要素リスト専用の単独`[` / `]`は
Source Editor内では次へ変更する。command IDは変えず、shortcut registryを唯一の正とする。

| 操作 | 旧要素リスト | Source Editor |
| --- | --- | --- |
| 選択要素を移動 | Mod/Alt+Arrow | Mod/Alt+Arrow |
| 評価区切りを移動 | Shift+Alt+Arrow / End | Shift+Alt+Arrow / End |
| インデント/アウトデント | `]` / `[` | Mod+`]` / Mod+`[` |

## 必須自動テスト

* Phase 2a〜2dの全統合テスト。
* typing→commit→Canvas patch→store Undo/Redo→typing→CM Undoを複数周回し、古いCM履歴へ
  到達しないこと。
* 連続model patches、composition queue、revision gap reset。
* dirty patchの中央rejectと、command/Canvas操作開始時flush。
* cursor/Canvas単一・複数選択、fold内部jump、無名要素、fatal編集。
* dirty/current/stale diagnosticsと全状態decorations。
* 旧LeftPanel主要command IDがSource Editorから到達可能であること。
* 500/1000行performance guard。絶対値に加え2a baseline比も報告する。

## 手動E2E

macOS Tauriで以下を確認し、結果をタスク報告へ記録する。

* 日本語IMEで要素名・text要素を入力し、composition途中にcommit/jumpされない。
* 1000行scroll・検索・fold・fold内部Canvas選択。
* Canvas drag開始時にdirty textが一度だけflushされ、pointermoveごとにcommitされない。
* Canvas編集が該当行だけCMへ反映され、cursor/scroll/foldを保持する。
* burst内CM Undo、commit後store Undo/Redo、reset後の履歴断絶。
* mixed改行文書の未編集保存はbyte不変、直接編集後は仕様どおりLFへ統一。
* 新規作成→作図→保存→再起動→読込→Undo/Redo→fatal編集→修復。

## 最終チェック

* `npm test`
* `npm run build`
* `npm run lint`
* 評価payloadを変更した場合のみ`npm run test:parity`
* CM importが`src/editor/`と`SourceEditorPane.tsx`外にないこと。
* LeftPanel系production参照・死んだCSS・専用testが残っていないこと。

## やってはいけないこと

* Source EditorとLeftPanelを完成状態で併存させること。
* 性能予算未達を「CMが仮想化するから」と未計測で受け入れること。
* Phase 3/4/5の削除・補完・inspector変更を同梱すること。
