# Phase 2b: 未commit buffer・中央flush・Undo統合

> 親文書: [phase-2-codemirror-pane.md](phase-2-codemirror-pane.md)。
> Phase 2a完了後に着手する。まだLeftPanelを置換せず、adapter統合テストで完成させる。

## 目的

CM documentを短命な未commit bufferとしてsourceTextへ接続し、store Undoを唯一の
文書履歴として維持する。古いsourceTextを基準にmodel patchが走らないことを
UI実装の注意事項ではなく中央の不変条件として保証する。

## 未commit bufferとcommit境界

* CMのuser `docChanged`でdirty burstを開始し、最後の入力から約300ms後に
  `commitText(nextText, "editor")`を1回だけ呼ぶ。
* blur、保存/close/open、アプリcommand開始、Canvas等のmodel interaction開始も
  commit境界。Canvas境界はliteralな`pointermove`ではなく、drag/click操作の
  **pointerdownまたはkeyboard操作開始前**とする。
* composition中はcommitしない。`compositionend`後にtimerを再開する。
* fatal textもsourceTextへcommitして履歴化し、last-good modelで上書きしない。

## 中央のmodel mutation防衛

`src/editor/sourceEditSession.ts`にCM非依存の同期registryを作る。

```ts
type SourceEditSession = {
  hasPendingText(): boolean;
  isComposing(): boolean;
  flush(reason: FlushReason): "clean" | "flushed" | "blocked-composition";
};
```

* command dispatcherとCanvas操作開始はmodelを読む前に`flush`する。これは通常動線。
* それだけに依存せず、`commitDocumentChange`、`commitDocumentChangeFromSnapshot`、
  `previewDocumentChange`のstore action自身も`hasPendingText`を検査する。
* action到達時にdirtyだった場合、同期flush後でも引数`change`は旧modelから計算済みの
  可能性があるため、**そのpatchを適用せずreject**する。呼び出し側へboolean/resultを返し、
  command errorを表示する。暗黙retryはしない。
* composition中はflushもmodel patchも拒否する。IME確定後にユーザー操作を再実行する。
* したがってmodel patchが実行される条件は「action entry時点でeditor clean」だけ。
  これをstore単体テストで固定する。
* save/dirty確認は`sourceEditSession.flush`後にstateを再取得する。flush前に取得した
  `sourceText`を保存してはならない。

## CM履歴とstore履歴

`isolateHistory`は履歴イベントの結合境界でありclearではない。Phase 2では次を行う。

* dirty中のMod+Z/RedoだけCM history commandへ送る。clean時はstore Undo/Redoへ送る。
* editor commit成功後、store Undo/Redo反映後、file/new document/reset後に
  `clearCmHistory`を必ず実行する。
* `clearCmHistory`はhistoryを専用Compartmentに置き、空extensionへのreconfigureと
  新しい`history()` extensionへのreconfigureを別transactionで行う。完了後に
  `undoDepth===0 && redoDepth===0`をdev/testで確認する。
* external patch transactionは`Transaction.addToHistory=false`。`isolateHistory`は
  burst結合防止として併用してよいが、clearの代用にしない。
* clearはtext、selection、fold、scrollを変えない。もしCompartment方式でこの条件を
  満たせないことが実証された場合のみ、selection/scroll/foldを退避して
  `EditorState.create`で再生成するfallbackを使う。

## cursor snapshot

* `cadUiStore`に`sourceCursorLine: number | null`を追加する。
* `TextSnapshot.cursorLine`はprimary selectionからの推測ではなくこの値を保存する。
* store Undo/Redoはselection IDsとcursor lineを同時に復元し、その後CM履歴をclearする。

## 必須テスト

* typing burst→CM Undo→再typing→commit→store Undo→store Redo。
* burst A commit→burst B→CM UndoでBだけ戻る→store UndoでAが戻る。
* commit→store Undo→新規typing→CM Undoを複数回行ってもcommit前の古いCM履歴へ
  到達しない。
* store Undo→Redo→reset→typing→CM Undoでもreset前履歴へ到達しない。
* commit/Undo/Redo/reset直後の`undoDepth`と`redoDepth`が0。
* dirty状態でstore model actionを直接呼ぶとflush後もpatchはrejectされる。
* command dispatcher経由では先にflushされ、最新modelを基準にpatchが1回だけ適用される。
* Canvas pointermoveだけではflushせず、pointerdown操作開始でflushする。
* composition中のtimer、external mutation、Undo、cursor移動が保留/拒否される。
* saveとunsaved guardがflush後のstateを再取得する。

## やってはいけないこと

* `isolateHistory`だけで古い履歴を到達不能とみなすこと。
* store action内でdirtyをflushした直後、旧model由来の引数patchを適用すること。
* 全pointermoveでflushすること。
* 全呼び出し元が正しくflushすると仮定し、store側防衛を省くこと。

