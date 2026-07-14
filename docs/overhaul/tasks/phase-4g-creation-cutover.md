# Phase 4g: 作成コマンドのセッション起動cutover

> 親文書: [phase-4-command-line.md](phase-4-command-line.md)。着手前に
> `AGENTS.md` → `docs/overhaul/plan.md` → 親文書 → 4c/4d/4e/4f文書 →
> [phase-3d-command-id-map.md](phase-3d-command-id-map.md)(cutoverと
> ID対応表の先行例)の順で読むこと。

## Context

4c〜4fでコマンドライン作図は完成しているが、正規の作成コマンド
(`addFreePoint` 等)はまだ旧即時挿入(選択中要素を暗黙に基準へ使い、
固定デフォルトで即コミット)のまま。ユーザーの最大の不満である
「作成時に選択中の要素が勝手に基準にされる」挙動はこの旧経路にある。
本タスクで正規コマンドをセッション開始へ切り替え、旧経路を削除する。

## Goal

すべての要素作成入口(palette・ribbon・context menu・shortcut)が
コマンドラインセッションを開始し、旧即時挿入経路と暫定command IDが消える。

## Scope

* `src/commands/creationCommandDefinitions.ts` の各コマンドの `run` を
  「対応レシピでのセッション開始」に差し替える。**command ID・ラベル・
  palette keywords・shortcut割当は不変**(親文書の確定判断。ユーザー設定を
  壊さない)。対応レシピは**4a-2の対応表(旧command ID→レシピ)を
  importして使う**。表にないIDを手でマッピングしない(表の不足は4a-2への
  手戻りとして報告)。
* 4c/4dで導入した暫定ID(`commandLineAddFreePoint` 等)をregistryから削除し、
  保存済みshortcutの読込み正規化で正規ID(`addFreePoint` 等)へ移行または
  除去する(3dの移行表パターンを踏襲)。
* `src/commands/elementCreationCommands.ts` の旧即時挿入実装
  (`addElement` / `addOffsetLine` / `addSplitLine` 等、選択ベースの
  デフォルト充填を含む一式)を削除する。他所から共有されている純粋ヘルパ
  (`createCadElement`・placement系)は残す。削除前に全usageを確認し、
  テンプレート挿入・画像作成(`addImage`)・グループ作成等の別フローが
  依存していれば、その依存だけ独立ヘルパへ退避する。
* `src/commands/nameEntryAfterCreation.ts` を削除(名前ステップが代替)。
* `addImage`(ダイアログフロー)と `group` / `conditionalGroup` / `forGroup`
  作成、テンプレート挿入は**対象外**(従来どおり)。レシピ対象外の型で
  palette登録が残るもの(text等)は汎用フォールバックレシピのセッションを
  開始する。
* 代表シナリオの統合テスト追加: 「点Aから角度45°長さ120mmの線」を
  コマンドディスパッチのみ(キーボード相当)で完走。

## Out of Scope

* 新レシピの追加(4a-2で全数充足済みの前提。専用/フォールバックの別も
  4a-2の対応表のまま)。
* DslPanel削除(4i)・補完(4h)。
* Phase 5のリネーム・互換削除の先取り。

## Existing APIs / files to reuse

* 4b〜4fのセッション一式。
* `src/keyboard/` の保存済みshortcut正規化機構(3dで実装済みのパターン)。
* `src/commands/commands.ts` のregistry統合テスト
  (`phase3dCommandRegistry.test.ts` が先行例)。

## Invariants

* **選択中要素の暗黙消費がゼロになる**: 旧経路の「選択中の線・点を
  デフォルト充填」はいかなる形でも残さない・復活させない。
* command ID安定: 既存IDの意味は「即時挿入」→「セッション開始」に変わるが、
  IDそのもの・shortcut・palette位置は不変。
* 削除した暫定IDは読込み正規化で安全に処理(未知IDでクラッシュ・警告漏れ
  しない)。
* キーボードのみで全作成フロー完結(shortcut→セッション→確定)。
* **再入=破棄して置換**(親文書の確定判断): 作成shortcut/コマンドの
  発行は、セッション中でも確認ダイアログなしで現在セッションを破棄し
  新規開始する。同じshortcutの連打・再実行も同レシピの初期状態への
  リセット(トグル・拒否にしない)。置換前にactive pick・pick draft・
  保留Canvas pointer intent・focus予約が全解除され(4b/4cで実装済みの
  共通開始経路を通す)、文書未変更のためUndo履歴は増えない。IME
  composition中は開始・置換とも拒否し、既存セッションを維持する。
  cutoverで全shortcutがこの経路に乗ることを確認する。
* **shortcutとform入力除外の整合**(親文書の確定判断): 文字入力と衝突する
  binding(単キー等)はバー入力を含むform入力フォーカス中に発火しない。
  Mod付きなど衝突しない作成shortcutはバー入力中でも共通再入経路で置換
  できる。cutover後の全作成shortcutについて、この分類が既存のform入力
  除外機構(shortcut registry)で正しく判定されることを確認する。
* **置換とDOM inert**: 複数pick draft中のshortcut再入置換では、旧pick
  状態のアトミックなクリアの帰結として次renderでCanvas外領域のDOM inert
  が解除され、inert領域内にfocusが取り残されないこと(4dで実装済みの
  保証がshortcut経由の全入口でも成立することを確認する)。

## Edge cases

* shortcut起動(Canvasフォーカス中)でのセッション開始 → バーへの
  フォーカス移動が自然(入力欄へフォーカス。IME中は開始しない)。
* セッション中(pick進行中・数値入力途中)に別/同一の作成shortcut →
  破棄して置換。破棄された引数・draftが次のセッションへ漏れない。
* 旧テストで `addElement` 直呼びしているものの移行(セッション経由に
  書き換えるか、テスト専用に残さず削除)。

## Tests

* 全作成command IDがセッションを開始することのregistry一括テスト
  (4a-2対応表との全数一致)。
* shortcut再入の置換テスト: セッション中の同一/別shortcut発行で置換・
  pick全解除・Undo履歴長不変・確認UIなし。IME中は開始・置換とも拒否され
  既存セッション無傷。
* shortcut整合テスト: バー入力フォーカス中、文字入力と衝突するbindingは
  発火せず、Mod付き作成shortcutは共通再入経路で置換すること。
* DOM inert回帰テスト: lineList draft中のshortcut再入置換で、次renderに
  inert属性が残らず、inert領域内にfocusが取り残されないこと。
* 選択がある状態で各作成コマンド→引数に選択要素が自動で入らないことの
  明示テスト(最重要不変条件の回帰防止)。
* 暫定IDの除去と保存済みshortcut正規化。
* 代表シナリオ(45°120mm線)のE2E統合テスト。
* `nameEntryAfterCreation` 参照が残っていないこと。

## Manual verification

* 実アプリで主要な作成shortcut・ribbon・context menu・paletteの各入口から
  作図し、選択中要素が勝手に使われないこと、Undo粒度、名前ステップを確認。
* 保存済みのユーザーshortcut設定ファイルがある環境で起動し、作成shortcutが
  従来キーのまま動くこと。
* `npm run desktop:build`(Tauriメニュー等に作成コマンドがあれば動作確認)。

## Completion criteria

* 旧即時挿入経路・暫定ID・`nameEntryAfterCreation.ts` が存在しない。
* command ID対応表(変更なし=同一ID、削除=暫定ID一覧)を報告。
* `npm test` / `npm run build` / `npm run lint` green。

## Dependencies

* 4e・4f完了(コマンドラインがフル機能であること)+**4a-2完了**
  (全作成経路の対応レシピが揃っていること)。4h・4iと並行可。

## Handoff to next task

* Phase 5(cleanup)へ: 旧作成経路の削除で死んだヘルパ・型・テストユーティリティ
  があれば、修正せずリストで申し送る。
* Phase 4完了報告には4h・4iの完了確認を含める(親文書の完了条件)。
