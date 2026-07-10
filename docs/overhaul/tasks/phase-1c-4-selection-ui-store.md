# Phase 1c-4: selection状態の cadUiStore 移動(Phase 1c 完結)

> 全体計画: `docs/overhaul/plan.md`、親文書: `phase-1c-text-canonical.md` を
> 必ず先に読むこと。AGENTS.md の規則に従うこと。
> Phase 1c は 1c-1 → 1c-2 → 1c-3 → 1c-4 の直列4分割で実装する。
> 本タスクは最終段。1c-3(正準反転)完了後、TextSnapshotが既にselectionを
> 運んでいるため、**格納場所の移動だけでUndo復元は無傷**。

## 目的

`selectedElementId` / `selectedElementIds` / `selectionAnchorElementId` /
`selectedParameterKey` を文書ストアの暫定フィールドから `cadUiStore` へ移動し、
文書状態とUI状態の分離を完成させる。本タスクの完了をもって Phase 1c 全体の
完了条件を照合する。

## 変更対象

### フィールド移動

* `src/state/cadDocumentStore.ts` — selection 4フィールドと4 setter
  (`setSelectedElementId` / `setSelectedElementIds` / `setSelectedElementRange` /
  `setSelectedParameterKey`、現行 :334-393)を削除。
* `src/state/cadUiStore.ts` — 4フィールドと4 setterを受け入れ。要素存在
  フィルタは docストアの `doc.document.elements` を `getState()` 参照で行う
  (現行setterの正規化ロジックを維持)。

### facade / routing

* `src/state/useCadStore.ts` — `splitState`(:43-59、キーの所属先routing)と
  `facadeActions`(:62-90、`clearPickMode` 同梱のラッパ)を新配置へ更新。
  facade利用側のコードは無変更で通ること。

### ブリッジの selection キー吸収

`commitDocumentChange` の change に selection キーを含める呼び出し元が3系統
ある(`DslPanel.tsx:344-346`、`selectionCommandDefinitions.ts:407-416`、
`selectionCommands.ts:319,441,566`)。**署名維持**のため、ブリッジがchangeから
selectionキーを分離し、文書コミット成功後に uiStore へ書く(呼び出し元無変更。
selectionのみのchangeは履歴を作らない)。

### 読み書き経路の更新(調査済み全数)

* コマンド層: `commandRuntime.ts:7-56`、`selectionCommands.ts`(:132-225ほか)、
  `selectionCommandDefinitions.ts`(:51-416)、`parameterCommands.ts`。
* コンポーネント: `RightPanel.tsx:51-52`、`DrawingCanvas.tsx:115-116`、
  `DslPanel.tsx:155`、`AppLayout.tsx:142`、`useCanvasOverlayData.ts:67-75`、
  ほか `selectedElement` / `selectedParameterKey` のgrep一致箇所を全数更新。
* 保存境界: `docToLegacySnapshot` のselection引数は uiStore から読む
  (JSON形式のselectionフィールドは形式互換のため当面残す。除去はPhase 1d)。

### selection正規化の新しい家

旧 `normalizeSnapshot` の選択スクラブ相当を uiStore の
`reconcileSelectionWithElements(elements)` として実装し、
全コミット・undo/redo・読込の後処理として呼ぶ(1c-1の `pruneGroupFold` と
同じフックポイント)。undo/redoのselection復元(TextSnapshot →
existing IDフィルタ → primary=先頭 / anchor=先頭 / parameterKey再正規化)の
書き込み先を uiStore に差し替える。

## 一括移動時の挙動保証

* **存在しないIDの除去**: `reconcileSelectionWithElements` が毎コミット後に
  実行される(削除コマンド自身の次選択計算
  `selectionCommandDefinitions.ts:407` は維持)。
* **Undo/Redoでのselection復元**: TextSnapshot.selectionElementIds(1c-3から
  格納済み)を uiStore へ書き戻す。
* **ID reconciliation後のselection維持**: 1行編集・リネームundo等は
  reconcilerがIDを継承するため選択は自然に生存。
* **preview中のselection**: previewElementsはcommitted要素とID同一のため無影響。
* selection変更は履歴エントリを作らない(現行どおり)。

## Phase開始時点の前提

* Phase 1c-1 / 1c-2 / 1c-3 完了済み。TextSnapshotがselectionを運び、
  undo/redoがdocストア内の暫定フィールドへ書き戻している。

## 完了条件

* selection 4フィールドが `cadUiStore` に在り、docストアから消えている。
* `npm test` / `npm run build` / `npm run lint` / `npm run test:parity` 成功。
* full suite 10回連続実行でflake未再現を記録(失敗時は報告のみ)。
* **Phase 1c 全体の手動E2Eチェックリスト(下記)を人間が実施できる状態で
  ハンドバックする**(親文書の完了条件と併せて照合)。

## 必須テスト

* 要素削除で選択が正しく落ちる/1行編集・Undoで選択が生き残る(ID照合の帰結)。
* 選択変更が履歴・dirty・sourceTextを変えないこと。
* facade routing(`useCadStore.setState` 経由のselectionキー)の後方互換。
* ブリッジのselectionキー吸収(DslPanel適用・削除コマンドで選択が
  従来どおり遷移すること)。

## Phase 1c 手動E2Eチェックリスト(人間が実施)

devビルドで実施。**全項目共通の確認**: consoleに `[shadowText]` /
等価assert / reconcile警告が出ないこと(warning診断の表示は除く)。
広範囲のUI自動操作をcoding agentに行わせない方針のため、本リストは
人間向けの簡潔な手順書である。

| # | 操作 | 期待結果 |
|---|---|---|
| 1 | 新規作成→点・線・曲線を各1作成 | 各作成が1 Undoエントリ。要素が描画される |
| 2 | 要素をrename | Undo 1回で戻り、**選択が維持される** |
| 3 | パラメータ編集(数値/式) | 値反映。Undo 1回で戻る |
| 4 | Canvasで点をドラッグ | ドラッグ中リアルタイム追従・確定でUndo 1エントリのみ増加 |
| 5 | ドラッグ中にキャンセル(ゼロdelta終了) | 元位置へ戻り、Undoエントリ増加なし |
| 6 | group作成→折りたたみトグル→ungroup | foldトグルはUndoに乗らない。group/ungroupは各1エントリ |
| 7 | DslPanelでexport→編集→apply | 1 Undoエントリ。選択がapply結果に追従 |
| 8 | palette色追加・visibility profile切替・print layout変更 | 各1 Undoエントリ |
| 9 | 参照先要素を削除(dangling作成) | 参照元が依存エラー表示。文書は消えない。consoleはwarning診断のみ(fatalなし) |
| 10 | 9の削除をUndo(参照先復元) | エラーが自動回復。選択・IDが維持される |
| 11 | 保存→アプリ再起動→読込 | 意味的に同一の文書。dirtyクリーン。Undo履歴は空 |
| 12 | 読込直後にUndo/Redo連打(空履歴) | 何も起きない・クラッシュしない |
| 13 | 変更→保存せず閉じる | 未保存ガードのダイアログが出る |
| 14 | 20回程度連続編集→Undo全戻し→Redo全進み | 各ステップで選択が随伴復元される |

## やってはいけないこと

* ファイル形式・拡張子の変更(Phase 1d)。CodeMirror導入(Phase 2)。
* LeftPanel置換等のUIコンポーネント構成変更(Phase 2以降)。
* 呼び出し元13ファイルの「ついで」リファクタ(selection読み書きの
  付け替えを超える変更)。
* JSON保存からのselectionフィールド除去(形式変更はPhase 1d)。
