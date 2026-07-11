# Phase 2d: diagnostics・評価decorations・keyboard・旧機能移行

> 親文書: [phase-2-codemirror-pane.md](phase-2-codemirror-pane.md)。
> Phase 2c完了後に着手する。SourceEditorを本番配置できる機能水準まで完成させるが、
> AppLayout切替と旧ファイル削除は2eで行う。

## 目的

dirty bufferを含むdiagnostics、評価状態の行decorations、editor keyboard scopeを
実装し、LeftPanel削除で失われる操作をSource Editor上のcommand/gutter/searchへ移す。

## diagnosticsの二層化

dirty中はCM documentとsourceTextが異なるため、store diagnosticsのspanをそのまま
使わない。

* CM buffer変更後50ms以内を目安に`parseDsl(bufferText)`を実行し、現在bufferに対する
  syntax diagnosticsを作る。composition中は実行せず、終了後に再parseする。
* compiler/reference diagnosticsは最後にcommit済みのsourceに属するため、dirty中は
  CM ChangeSetでrangeをmapして`stale`表示する。syntax diagnosticsと重複するfatalは
  現在buffer側を優先する。
* commit完了後はstoreのcompiler diagnosticsへ切り替え、stale表示を解除する。
* fatal commit中はlast-good evaluation decorationsをchangesでmapし、「評価はlast-good」
  と明示する。stale statementMapの行番号から再生成しない。
* `DslDiagnostic`にend spanがない場合、columnから該当token末尾、判定不能なら行末までを
  lint rangeとする。

## 評価・要素状態decorations

viewport/`visibleRanges`内だけを装飾する。

* evaluation error=赤gutter+行背景、warning=黄gutter。
* disabled/ancestor-disabled、hidden/ancestor-hidden、condition inactive、評価limit外を
  区別した淡色/markerで示す。
* locked、print enabled、element colorは既存ElementStatusIcon/row accentの意味を踏襲。
* `@stop`行へ評価区切りmarkerを置き、既存評価limit commandへ接続する。
* for-group generated rowsは編集テキストへ混ぜず、該当行の読み取り専用widgetにする。

## keyboard scope

* editor targetではwindow captureのglobal shortcutを先にdispatchしない。CM keymapを優先。
* 通常文字、矢印、Delete、copy/paste、Mod+F等の編集操作を奪わない。
* Mod+Z/Redoは2bのdirty判定でCM/storeへ振り分け、Mod+Sはflush後保存する。
* Esc優先順位: IME composition中は無処理 → CM検索/補助panelを閉じる → pick等の
  一時modeをcancel → flushしてCanvasへfocus。
* `focusElementList`と`enterElementListMode`はSource Editor focusへ、
  `focusElementSearch`はSource検索へ再配線する。旧command IDは削除しない。

## LeftPanel機能移行

| 現行機能 | Source Editorでの移行先 |
|---|---|
| filename / dirty / document diagnostics | editor header/status + lint |
| palette / visibility profile入口 | editor toolbar |
| 名前・ID・型・role検索 | 既存`elementSearchResults`を使うSource検索panel |
| text検索 | CodeMirror search。同一panelから切替可能 |
| pickable filter / pick候補 | candidate line decorations + 既存pick commands |
| visibility/enabled/locked/print | gutter marker + line context menu + command palette |
| 評価区切り | `@stop` marker + 既存evaluation commands |
| group/else fold | 2cのCM projection |
| drag reorder | text cut/paste + 既存move command/Alt+Arrow |
| duplicate/delete/group/context menu | Source行context menu + command palette/ribbon |
| for generated preview | 読み取り専用line widget |
| bottom ribbon dock | Source pane下端のdock |

* 旧`ElementListContextMenu`はSource行用の汎用command menuへ改名・縮小してよい。
* pick modeでは候補行を選び、Enterで既存apply commandを実行する。Escはcancel。
* 検索結果jumpは2cのCanvas→cursor経路を使い、独自selection実装を増やさない。

## 必須テスト

* dirty bufferで追加・移動・削除したsyntax errorのlint rangeが現在位置に合うこと。
* dirty→commit、fatal→修復でstale/current diagnosticsが正しく切り替わること。
* evaluation error/warning/disabled/hidden/locked/limit/condition decoration。
* viewport外を行単位React componentやdecorationsで全生成しないこと。
* editor focus中のtyping、Mod+F、Mod+S、Undo/Redo、Esc、global shortcut競合。
* 検索、pick、各toggle、評価limit、context menu、generated preview、ribbon dock。
* 旧command IDと新しいfocus/検索動作の対応表をテスト・タスク報告へ含める。

## やってはいけないこと

* dirty中にstore diagnosticsのline/columnを無変換で表示すること。
* 1000行全体のReact row componentを復活させること。
* editor内の通常編集キーより単一文字アプリshortcutを優先すること。
* Phase 3 inspector、Phase 4補完/コマンドライン、DslPanel削除を先取りすること。

