# Phase 2e 完了ゲート: macOS Tauri 手動E2Eチェックリスト

> 親文書: [phase-2e-left-panel-cutover.md](phase-2e-left-panel-cutover.md)。
> 自動テストとブラウザharness確認では代替できない、実機macOS Tauri +
> 日本語IMEの確認項目。**未実施の項目が残る間はPhase 2eを完了扱いにしない。**

## 対象と目的

Phase 2eでLeftPanelを削除し、SourceEditorPane(CodeMirror)が本番の左ペインに
なった。以下の不変条件を実機で確認する。

* composition(日本語IME変換)中はcommit・外部patch・cursor jump・fold projectionが
  走らない。
* 通常のCanvas編集は該当行だけのCM changesで反映され、cursor・scroll・foldを保持する。
* store履歴が唯一の文書履歴で、commit・store Undo/Redo・reset境界を跨いで古いCM履歴へ
  到達しない。
* 1000行規模でscroll・検索・foldが引っかからない。

## 前提条件

1. `npm run desktop:dev` でTauriアプリを起動する(ブラウザのViteではなく実機)。
2. DevToolsを開き(右クリック→Inspect Element)、Consoleを表示しておく。
3. 全項目共通の確認: uncaught exception、React error overlay、`[shadowText]`系警告が
   出ないこと。
4. 各シナリオは特記がない限り新規文書から始め、結果を末尾の記録表へ記入する。

## シナリオ 1: 日本語IME入力

**手順**

1. Source Editorの行末にcursorを置き、日本語IMEで「肩線」等の要素名を含む行を入力する。
2. 変換候補表示中(未確定)のまま300ms以上待つ。
3. 変換中にCanvasの要素をクリックしてみる。
4. 確定(Enter)後、300ms待つ。
5. text要素(`text`文)でも同じ流れを繰り返す。

**期待結果**

* 変換中はcommitされない(ヘッダの「未保存の変更」が変換確定+300ms後に出る/
  文書が変換途中の文字列で評価されない)。
* 変換中のCanvasクリックでcursor jumpや複数行選択が起きない(確定後に反映される)。
* 確定後の通常commitで構文highlightと評価が正しく更新される。

## シナリオ 2: 1000行文書のscroll・検索・fold

**手順**

1. 1000行規模の`.nui`を開く(なければ `point P0 = (0, 0)` 形式の行を1000行貼り付けて保存)。
2. 端から端まで素早くscrollする。
3. `Cmd+F`で要素検索→遠くの要素名を検索してEnterでjump。
4. group(なければ作る)をfoldし、fold内部の要素をCanvasでクリックする。

**期待結果**

* scrollが引っかからない(数秒固まるようなlong taskがない)。
* 検索jumpでcursor行がscrollIntoViewされ、Canvas選択も同期する。
* fold内部要素へのCanvas選択で祖先groupが自動展開され、該当行が見える。

## シナリオ 3: Canvas dragとdirty flush

**手順**

1. Source Editorで1文字入力し(commit前のdirty状態)、すぐにCanvasの点をdragし始める。
2. dragを続けて離す。
3. DevToolsのConsoleでエラーがないことを確認する。

**期待結果**

* drag開始(pointerdown)時に一度だけdirty textがflushされ、pointermoveごとの
  commitは起きない(dragが滑らかならOK)。
* drag確定でDSLの該当1行だけが書き換わり、editorのcursor・scroll・foldが保持される。
* Undo 1回でdrag全体が1ステップで戻る。

## シナリオ 4: Undo/Redo履歴境界

**手順**

1. burst入力(数文字連続)→`Cmd+Z`(CM Undo)でburst内が戻ることを確認する。
2. 300ms待ってcommit→さらに入力→commit→`Cmd+Z`を複数回押す。
3. `Cmd+Shift+Z`(Redo)を数回押す。
4. 新規作成(reset)後に`Cmd+Z`を押す。

**期待結果**

* commit後のUndoはstore履歴(文書単位)で進み、commit前の古いCM編集断片へ
  到達しない。
* Redoで正しく往復し、選択状態も復元される。
* reset直後のUndoで前文書へ飛ばない(履歴断絶)。

## シナリオ 5: 改行コード保存

**手順**

1. mixed改行(LF/CRLF混在)の`.nui`を用意して開き、**編集せず**上書き保存する。
2. `xxd`等でbyte列が不変なことを確認する。
3. 同じファイルでSource Editorに1文字入力→commit→保存する。

**期待結果**

* 未編集保存はbyte不変。
* 直接編集後の保存はLFへ統一され、statusに改行統一の通知が一度出る。

## シナリオ 6: フルサイクル

**手順**

1. 新規作成→点・線・曲線を作図(コマンドライン/リボン/ショートカット)→保存。
2. アプリを再起動して読込→Undo/Redoを数回。
3. Source Editorで意図的に構文を壊す(fatal編集)→評価がlast-good表示になることを
   確認→修復。

**期待結果**

* 再起動後も文書・fold以外のUI状態が正しく復元され、Undo/Redoが機能する。
* fatal編集中も編集がブロックされず、「評価: last-good」バッジが出る。
* 修復commitでバッジが消え、最新評価に戻る。

## 記録表

| # | シナリオ | 結果 | 気づいた点 |
|---|---|---|---|
| 1 | 日本語IME入力 | 未実施 | |
| 2 | 1000行scroll・検索・fold | 未実施 | |
| 3 | Canvas dragとdirty flush | 未実施 | |
| 4 | Undo/Redo履歴境界 | 未実施 | |
| 5 | 改行コード保存 | 未実施 | |
| 6 | フルサイクル | 未実施 | |

補足: ブラウザharness(Vite dev)では以下を確認済み(2026-07-11、実装セッション):
起動・Source Editor常設表示、Canvas⇄cursor双方向同期、typing→300ms commit→評価反映、
hidden decoration、store Undo(Cmd+Z)、要素検索とjump、context menu、ribbon dock表示と
検索中の順序操作無効化、幅resize(キーボード)+永続化、1001行文書でrendered
DOM行数が常時約46行(viewport外非生成)・scroll中long task 0件。
CDP合成キー入力では検索panelのEnter適用が発火しなかったため(クリック適用は動作)、
シナリオ2で実キーボードのEnter jumpを必ず確認すること。
