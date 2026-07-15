# Phase 5g: rename UI接続(専用最小プロンプト)

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書 →
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md)
> の順で読むこと。
>
> 依存: 5e。5f と並行可。**5c が先にmergeされていること**
> (`commandTypes.ts` / command定義群の衝突回避)。

## Context

rename UIは**専用最小プロンプト**方式で確定(親文書の確定判断。
CommandLineBar・セッション状態機械には手を入れない)。5eのコマンドレベル
関数(拒否=明確なエラー、1 commit=1 Undo)をキーボードファーストで起動
できるようにする。

## Goal

選択中の単一要素に対して `renameSelectedElement` コマンドで名前入力
プロンプトを開き、Enter確定/Esc取消/衝突時エラー表示+入力継続、を
キーボードのみで完結させる。

## Scope

* 新規コマンド `renameSelectedElement`(CommandId追加・palette登録・
  表示名)。default shortcutは既存bindingとの衝突を
  `shortcutDefaultBindings.ts` で調査して決める(F2相当が空いていれば
  第一候補。form入力除外の原則に従う)。
* 新規最小プロンプトコンポーネント:
  * 既存ダイアログ/ポップオーバー実装(`SelectionColorPickerDialog` 等)の
    パターンを調査し、最も軽い既存様式に合わせる(新しいUIフレームワークや
    汎用プロンプト基盤を作らない)。
  * 表示内容: 対象要素の表示名(修飾名)+名前入力欄(初期値=現在名、
    全選択状態)+エラー表示領域。
  * Enter=5e関数で確定 / Esc=取消。確定成功でプロンプトを閉じ、
    Source Editorへfocus(既存の `focusSourceEditor` 経路)+対象行へ
    ジャンプ(`jumpToElement`)。
  * 拒否時: 5eのエラー(衝突相手・行番号入り)をプロンプト内に表示し、
    入力値を保持したまま継続。プロンプトを閉じない。
  * IME composition対応: composition中のEnterで確定しない(既存guard慣習)。
* 起動条件: 単一要素選択時のみ有効(複数選択・無選択ではcommand error)。
  無名要素にも有効(名前を付ける操作になる)。
* プロンプト表示状態は `cadUiStore` の他のダイアログフラグと同じ流儀で管理。
  開いている間のグローバルshortcut抑止はform入力除外の既存原則に乗せる。

## Out of Scope

* CommandLineBar・コマンドラインセッション・pick routing・補完
  (一切変更しない)。
* 5e関数の内部変更(シグネチャ変更が必要なら5f担当と調整のうえ最小限)。
* Inspectorへのrename UI追加・Source Editor名前span経由の伝播。
* 複数要素の一括rename。

## Existing APIs / files to reuse

* 5eのコマンドレベル関数とエラー通知経路。
* `src/state/cadUiStore.ts` の既存ダイアログフラグ群のパターン。
* `SourceEditorHandle`(`focus` / `jumpToElement`)。
* `src/keyboard/` のshortcut registry・form入力除外機構。
* `elementQualifiedName`(対象の表示名)。

## Invariants(このタスク固有の事故防止)

* キーボードのみで「選択→起動→入力→確定→エディタ復帰」が完結
  (マウスは等価な代替)。
* プロンプト表示中にCanvas・エディタの状態を変えない(開く時点で
  スナップした対象IDを使い、確定時に選択が変わっていたら安全に中止)。
* Escの挙動が予測可能: プロンプトのEscはプロンプトを閉じるだけ
  (pickモードや他のダイアログを巻き込まない)。
* 確定・取消いずれもUndo履歴を汚さない(確定は5e経由の1ステップのみ)。
* commandLineセッション進行中の起動: 新しい特別扱いを足さず、既存の
  仕組みに従った自然な挙動をテストで固定する(セッションを黙って壊さない
  こと。文書コミットが起きればstale cancellationは既存仕様)。

## Edge cases

* 対象要素がrenameプロンプト表示中に(Undo等で)消えた場合 → 確定時に
  明確なエラーで中止。
* dirty buffer中の起動(5eのflushゲートが処理。UI側で二重flushしない)。
* 日本語IMEで名前入力→composition確定→Enterの2段階。
* 空文字・現在名と同一名での確定(no-opとしてUndoを増やさない、または
  明確な拒否。どちらかに確定してテスト固定)。

## Tests

* コマンド発火条件(単一選択のみ・form入力中の抑止)。
* プロンプトのEnter/Esc/エラー継続/IMEの各遷移(実DOM統合テスト。
  `CommandLineBar.test.tsx` の様式を参考に、ただしBar本体には触れない)。
* 確定後のfocus/ジャンプ・Undo 1ステップ。
* shortcut registry整合(新IDがregistry・palette・default bindingに揃う。
  3dパターンの機械検証テストへの追加)。

## Manual verification

* 実アプリで: 要素選択→shortcut→名前入力(日本語IME含む)→Enter→
  参照行が追従・エディタへfocus復帰→Undoで一括復帰。
* 衝突する名前でエラー表示→修正して確定。
* macOS IMEでの入力確認。

## Completion criteria

* 上記テスト・手動確認が完了し、キーボードのみの代表シナリオが最短手数で
  成立。
* test / build / lint green。

## Dependencies

* 5e(+5cのmerge先行)。5fと並行可。

## Handoff to next task

* 5h へ: 新command ID(`renameSelectedElement`)とshortcutを対応表・
  ドキュメントへ反映する旨。
