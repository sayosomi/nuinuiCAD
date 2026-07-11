# Phase 2a: CodeMirrorアダプタ基盤とsource update protocol

> 親文書: [phase-2-codemirror-pane.md](phase-2-codemirror-pane.md)。
> Phase 1d完了後に着手する。Phase 2の第1段であり、まだLeftPanelを置換しない。

## 目的

CodeMirrorをアプリへ安全に載せる最小アダプタ層を作り、後続StageがReact・Zustand・
CM内部型を混在させず実装できる境界を確定する。source updateを取りこぼさない
revision protocolと、500/1000行の性能baselineもこの段階で固定する。

## 変更対象

* 依存追加: `@codemirror/state`、`view`、`language`、`commands`、`search`、`lint`、
  `autocomplete`。これ以外のUI依存は追加しない。autocompleteの機能実装はPhase 4。
* `src/editor/cmLanguage.ts` — `dslHighlight.ts`のtoken分類をStreamLanguageへ
  適応する。Lezer文法は作らない。
* `src/editor/sourceEditorTypes.ts` — CM型を含まないadapter DTOとtransaction origin。
* `src/editor/sourceUpdateProtocol.ts` — source revisionの順序検証、pending queue、
  gap検出を純粋ロジックとして実装。
* `src/editor/lineSpliceChanges.ts` — `LineSplice[]`を旧CM document座標の変更列へ変換。
* `src/components/SourceEditorPane.tsx` — mount/destroyとimperative handleだけを持つ薄い
  React wrapper。実アプリへの配置は2e。
* canonical storeに単調増加する`sourceRevision`と直近更新metadataを追加する。
  model bridgeのcommitted結果には実際に適用した`LineSplice[]`を含める。

  ```ts
  type SourceUpdate =
    | { revision: number; kind: "editor" }
    | { revision: number; kind: "model-patch"; splices: LineSplice[] }
    | { revision: number; kind: "reset" };
  ```

## source update処理

* Editor controllerはReact effectによる最新値観測ではなく、vanilla Zustandの
  `subscribe`を使う。subscriberはstore更新と同期的に呼ばれる前提で、受け取った
  全`SourceUpdate`をrevision順に即時処理する。
* composition中だけは各updateをEditorローカルqueueへ順番どおり保持し、
  `compositionend`後にdrainする。metadata 1件を後から読み直す方式は禁止。
* `next.revision === appliedRevision + 1`でなければgapと判定する。現在の`sourceText`を
  全文resetし、selection/foldをdomain stateから再構築して`appliedRevision`を追いつかせる。
* unmount中の更新はremount時のrevision gapとしてresetする。通常の連続model patchは
  一件ずつ`changes`適用し、cursor/scrollをmappingする。
* editor自身のcommit updateはrevisionを消費するが、CM documentの再置換はしない。

## 改行/BOM方針

行境界ごとのcodecはPhase 2要件に対して複雑すぎるため作らない。以下を仕様とする。

* editorを開いただけでは`sourceText`へcommitしないため、未編集ファイルのbyte列は不変。
* uniform LFはLF、uniform CRLFは`EditorState.lineSeparator`でCRLFのままround-tripする。
* mixed LF/CRLFまたはlone CRはCM内部ではLFへ正規化し、**最初の直接テキストcommit**で
  source全体もLFへ正規化する。statusに一度だけ「改行をLFへ統一」を表示する。
* model patchはstoreの`LineSplice`を正とするため、直接テキスト編集がない限りmixed
  改行の無関係行を変えない。
* BOMはCM documentの先頭文字としてそのまま保持する。既存parserが診断する場合も
  Phase 2で自動除去しない。

## 性能baseline

* 500/1000行fixtureでEditorState生成、単一transaction、line splice変換を計測する。
* 現行1000要素compile中央値約222msを記録し、CM処理と既存compile処理を別計測する。
* 新規sourceファイルは責務ごとに分割し、原則300行未満にする。

## 完了条件・テスト

* CM import隔離を`rg`で確認できる。
* 連続revisionを同期処理し、composition queueを順序どおりdrainする。
* revision gap、unmount/remount、resetでsourceTextとCMの論理テキストが一致する
  (mixed改行は下記の正規化前表現を比較する)。
* 複数の非連続LineSpliceを全文置換せず適用できる。
* uniform LF/CRLF、mixed正規化、BOM、末尾改行の方針をテストで固定する。
* このStageではAppLayout、LeftPanel、keyboard、selection、foldを変更しない。

## やってはいけないこと

* metadata最新1件をReact render後に読むだけの同期。
* revision gapを無視してpatchを適用すること。
* mixed改行保存のための行単位codecを追加すること。
* SourceEditorPaneを本番左ペインへ置くこと。
