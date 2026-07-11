# Phase 2c: cursor/Canvas選択同期とgroup fold

> 親文書: [phase-2-codemirror-pane.md](phase-2-codemirror-pane.md)。
> Phase 2b完了後に着手する。まだLeftPanelを置換しない。

## 目的

statementMapを使ったcursor行とCanvas selectionの双方向同期、およびgroup/elseの
fold同期を実装する。同期ループや複数cursorによる意図しない一括編集を防ぐ。

## 複数選択の仕様変更

元のPhase 2仕様は「複数選択=複数CM cursor/行range」だったが、Phase 2では次へ
**明示的に変更する**。

* `selectedElementId`だけをCMの実cursorにする。
* 残りの`selectedElementIds`は非編集のsecondary line decorationsで表示する。
* Canvas複数選択から通常typing、paste、deleteを行ってもprimary cursorだけを編集する。
* CM上でCanvas複数選択を作る操作はline gutterのMod-click(toggle)と
  Shift-click(document-order range)に限定する。
* 通常の文字range選択やCM独自multi-cursor操作はCanvas selectionへ変換しない。

変更理由は、Canvas上の複数選択がテキストの複数箇所同時編集を意味せず、通常入力で
複数行を破壊する危険が高いため。将来multi-cursor編集を入れる場合は別commandとして
明示的に起動する。

## cursor→Canvas

* primary headが要素statement自身の行にある場合だけ、そのelementをprimary選択する。
* 空行、コメント、`}`、`} else {`、palette/view/print等の非要素文ではCanvas選択を
  勝手に変更しない。
* dirty中は最後の同期済みstatement rangesをCM ChangeSetでmapする。新規行は有効な
  commit後にstatementMapへ載るまでelement IDを持たない。
* transaction origin/revisionを使い、Canvas由来cursor moveをCanvasへ書き戻さない。

## Canvas→cursor

* `statementMap.byElementId`でprimary element行へcursorを移し、`scrollIntoView`する。
* secondary elementsは行decorationだけ更新する。
* fold内部のelementへ外部選択が来た場合は祖先groupと該当else branchを先に展開する。
* 無名要素もruntime IDで同期し、名前検索へfallbackしない。
* fatal時はlast-good rangesをchangesでmapした範囲だけ利用し、staleな生行番号を
  現在bufferへ直接適用しない。

## fold source of truth

Phase 2では`cadUiStore.groupFoldById`を唯一の正とし、CM fold stateはprojectionとする。

* CM gutter/keyboard fold操作は直接fold effectだけをdispatchせず、まず
  `setGroupFold` / `toggleGroupExpanded` / `toggleElseExpanded`を呼ぶ。
* store変更subscriberが`foldEffect` / `unfoldEffect`をCMへ反映する。
* mount、reset、source change後はruntime element IDと新statementMapからCM foldを再構築。
* projection transactionにはorigin annotationを付け、storeへ逆流させない。
* divergenceを検出した場合は`groupFoldById`からCM foldを作り直す。
* foldはsession限定、非永続、store Undo対象外のまま。要素消滅時は既存
  `pruneGroupFold`を維持する。
* conditional groupは全体foldとelse-body foldを別rangeとして扱う。

## 必須テスト

* cursor→Canvas、Canvas→cursor、同一行再選択でloopしないこと。
* 無名要素、空行、コメント、閉じbrace、else行、非要素文。
* Canvas複数選択がprimary cursor 1本+secondary decorationsになること。
* secondary選択状態でtypingしてもprimary行だけが変わること。
* gutter Mod-click/Shift-clickによるtoggle/range selection。
* nested group、conditional else、fold内部への外部jump、自動ancestor展開。
* CM fold操作→uiStore→CM projectionの一方向データフロー。
* Undo/Redo、ID継承、要素削除後もfoldが正しいこと。

## やってはいけないこと

* Canvas複数選択を`EditorSelection`の複数実cursorへ無条件変換すること。
* CM fold stateと`groupFoldById`を相互に同格の正としてmergeすること。
* stale statementMapの行番号をdirty/fatal bufferへ直接使うこと。
* foldをsourceText、保存、store Undoへ含めること。

