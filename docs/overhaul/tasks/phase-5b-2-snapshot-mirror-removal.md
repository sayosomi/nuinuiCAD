# Phase 5b-2: スナップショット型の selected* ・ printLayout ミラー削除

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書の順で読むこと。
>
> **5b-1 完了後に着手**(`documentFormat.ts` が重なる)。5a / 5c / 5d とは
> 並行可。**5e より先にmergeすること**(`cadDocumentStore.ts` が重なる)。

## Context

選択状態はPhase 1c-4で `cadUiStore` へ移動し、Undo履歴はPhase 1c-3で
テキストスナップショット(`TextSnapshot = {text, selectionElementIds,
cursorLine}`)に統合済み。しかし in-memory の change/スナップショット型には
旧世代の冗長が残っている:

* `CadDocumentSnapshot = DslDocumentData & CadDocumentSelectionSnapshot &
  { printLayout: PrintLayout }`(`documentFormat.ts`)。
  `CadDocumentSelectionSnapshot` は `selectedElementId` /
  `selectedElementIds` / `selectionAnchorElementId`。
* これらは `.nui` には一切出ない(`nuiFormat.ts` 参照ゼロ)が、
  `docToLegacySnapshot`(`cadDocumentStore.ts`)が生成し、
  `previewDocumentChange` / `commitDocumentChange` のchange型・
  `CadHistorySnapshot`(`useCadStore.ts`)に混在している。
* `printLayout`(単数)ミラーはactive printLayoutの複製で、読み手は
  `printSvgExport.ts` / `printPdfExport.ts` / `PrintLayoutView.tsx` /
  `DrawingCanvas.tsx`。正は `printLayouts` + `activePrintLayoutId`。

## Goal

change/スナップショット型から `selected*` フィールドと `printLayout`
ミラーを削除し、読み手をactive printLayout派生(セレクタ/ヘルパ)へ移行する。
`.nui` 形式・Undo挙動・選択挙動・印刷出力は一切変えない。

## Scope

* 型の再構成:
  * `CadDocumentSelectionSnapshot` の削除(`documentFormat.ts` /
    `cadUiStore.ts` のimport含む)。
  * `CadDocumentSnapshot` から `selected*` と `printLayout` ミラーを除去
    (実質 `DslDocumentData` +必要最小限へ。型の置き場所も含めて整理し、
    レガシーパース専用の型と in-memory change型を分離してよい)。
  * `docToLegacySnapshot` の縮小 or 改名(選択状態の合成を削除)。
  * `previewDocumentChange` / `commitDocumentChange` のchange型から
    `selected*` / `printLayout` を除去し、呼び出し元を追従(まず全calleを
    列挙し、`selected*` を渡している箇所がないかを実測すること)。
  * `CadHistorySnapshot`(`useCadStore.ts`)の残骸整理(現行のUndo正は
    `TextSnapshot`。`CadHistorySnapshot` 自体が死んでいれば削除)。
* 読み手の派生化:
  * active printLayoutを返すセレクタ/純粋ヘルパを1つ定め(既存があるか
    `src/print/printLayout.ts` を先に確認)、`printSvgExport` /
    `printPdfExport` / `PrintLayoutView` / `DrawingCanvas` の
    `doc.printLayout` 読み出しを置換する。
  * ミラーの更新経路(commit時の複製生成)を削除。

## Out of Scope

* 選択状態の仕様変更(`cadUiStore` の選択挙動はそのまま)。
* 印刷レイアウトの機能変更・UI変更。
* レガシーインポータ・`documentFormat.ts` のパース面(5b-1で確定済み)。
* rename系(5d〜5g)のコード。

## Existing APIs / files to reuse

* `src/print/printLayout.ts` — printLayout関連の純粋ヘルパの置き場。
* `src/state/cadUiStore.ts` — 選択状態の正(変更しない、参照のみ)。
* Undo履歴の正: `cadDocumentStore.ts` の `TextSnapshot` past/future。

## Invariants(このタスク固有の事故防止)

* `.nui` 出力・入力が1文字も変わらない。
* Undo/Redoで選択が復元される挙動が不変(`TextSnapshot.selectionElementIds`
  経路。既存テストがgreenのまま)。
* 印刷SVG/PDF出力が同一文書で不変(既存スナップショット/ゴールデンテスト
  があれば流用、なければ代表文書での出力一致テストを追加)。
* Canvasのドラッグ・プレビュー(`previewDocumentChange`)挙動不変。
* 型の削除で「コンパイルは通るが実行時にundefinedを読む」残骸を作らない
  (grepで `\.printLayout\b`(単数)と `selectedElementId` のsnapshot経由
  読み出しがゼロであることを確認)。

## Edge cases

* printLayoutが1つもない文書・activeが指す先が消えた文書での読み手の挙動
  (現行ミラーのフォールバックと同一に保つ。現行挙動を先に実測すること)。
* Undo直後にprint preview/exportを行うケース(派生セレクタがrecompile後の
  docから正しく引けること)。

## Tests

* Undo/Redo選択復元の既存テストgreen。
* print export出力の不変テスト。
* change型から `selected*` を渡すコードが型エラーになること(型レベルで
  保証されるなら専用テスト不要)。
* store系既存テスト(canonical / shadow / sourceUpdate / editorSession)の
  無退行。

## Manual verification

* 実アプリで: 作図→Undo/Redo(選択が戻る)→print preview表示→
  SVG/PDF export→Canvasドラッグ、の一連が正常。

## Completion criteria

* `CadDocumentSelectionSnapshot` と `printLayout` ミラーが型・生成・読み手の
  全経路から消え、上記Invariantsのテストがすべてgreen。
* test / build / lint green(評価・payloadに触れた場合は `test:parity` も)。

## Dependencies

* 5b-1(直列)。5a / 5c / 5d と並行可。**5eより先にmerge**。

## Handoff to next task

* 5e へ: `cadDocumentStore.ts` のchange型の最終形(rename bridgeが使う
  `commitDocumentChange` の引数形)を申し送る。
* 5h へ: plan.md「主な削除対象」のスナップショット項が完了した旨。
