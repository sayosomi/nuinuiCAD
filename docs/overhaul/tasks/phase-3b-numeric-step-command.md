# Phase 3b: エディタネイティブ値ステップコマンド

> 親文書: [phase-3-inspector.md](phase-3-inspector.md)。
> 着手前に `docs/overhaul/plan.md` →
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md) →
> [phase-3a-value-span-jump-api.md](phase-3a-value-span-jump-api.md) →
> 本文書の順で読むこと。AGENTS.md の規則に従うこと。
> 3a完了後に着手。3c(インスペクタ)とは並行実装可(変更ファイルが交差しない)。

## Context

現行のパラメータ編集モードは `←`/`→` で選択パラメータの数値を
`stepLevels` に従い増減できる(`incrementSelectedParameter` /
`decrementSelectedParameter`、`parameter` scope)。Phase 3dでパラメータ編集
モードとフォーム編集を削除するため、その前に**同等以上のキーボード数値操作**を
Source Editorネイティブに用意する。これがないまま3dを実施すると
キーボードファースト不変条件(要素選択→パラメータ→値変更がマウスなしで完結)
が一時的に壊れる。

## 目的

Source Editor(およびLine Lens)で `Alt+→` / `Alt+←` により、カーソル位置
(または選択中)の値spanを変更する。数値リテラルは現在の
`getNumericParameterStep`で増減し、booleanは反転、choiceは
`choiceOptions`順に左右へ循環する。1操作=1 store Undoステップ。

`Alt+→/←` は現行割当の正であり、既存のSource Editor structural shortcut
(Mod/Alt+`↑`/`↓`、Shift+Alt+`↑`/`↓`/End、Mod+`[`/`]`)およびTab/Shift+Tabの
値span移動とは衝突しない。割当を変える場合もshortcut registryを唯一の正とする。

## 開始時点の前提

* 3a完了: ラベル付き値span(`dslLineLabeledValueSpans`)と
  `resolveParameterValueSpan`(parameterKey⇔DSL keyマッピング)が利用可能。
* `getNumericParameterStep` / `getNumericParameterStepLevels` /
  `defaultNumericParameterStep`(=1mm)は `parameterDefinitions.ts` に現存し、
  3dの縮小後も残る(縮小対象は `directKey` と編集モード配管のみ)。
* 中央flush(`sourceEditSession.flush`)とIME guardはpost-cutover polish文書の
  とおり。

## 変更対象ファイル

* 新規 `src/dsl/dslValueStep.ts`—3aの逆引き結果に対する数値/boolean/choice
  のpure変更helper。
* 新規 `src/dsl/dslValueStep.test.ts`。
* `src/commands/commandTypes.ts` / コマンド定義ファイル — 新command ID追加。
* `src/keyboard/shortcutDefaultBindings.ts` — `sourceEditor` scopeへ
  `Alt+ArrowRight` / `Alt+ArrowLeft` を追加。
* `src/editor/sourceEditorController.ts` — コマンド実行本体(バッファ書換+
  即時commit)。lens keymapへの転送は既存 `sourceEditorShortcutKeymap()` 経由で
  自動に乗ること。
* `src/editor/sourceEditorController.test.ts`(または新規テストファイル)。
* `src/keyboard/shortcuts.test.ts` — バインディングと非衝突の検証。

## 実装手順

1. **pure helper**: 3aの`resolveParameterTargetAt(lineText, element, selection,
   context)`を唯一のtarget/span解決に使う。3b側で値span再走査、parameter
   mapping、複合座標・dynamic record解析を作らない。caretはspan内、非empty
   selectionはtarget全体との一致時だけ許可する。numberは固定小数演算、booleanは
   反転、choiceは`choiceOptions`循環とする。その他は対象外。
2. **step量の決定**: numberは既存の`getNumericParameterStep`が返す現在stepを
   そのまま使う。stepLevelsの段階切替・倍率修飾は追加しない。3aが証明した
   synthetic座標子など定義が引けない数値spanだけ既定1mmを使う。
3. **コマンド化**: `stepSourceValueForward` / `stepSourceValueBackward`を
   コマンド定義へ追加し、
   `sourceEditor` scopeのregistryへ `Alt+→/←` で登録する。既存の
   structural shortcut群と同じ経路(registry→controllerのcompartment)に乗せ、
   **手書きの第二キーマップを作らない**。palette掲載のために空の`normal`
   bindingを追加せず、設定対象は`sourceEditor` scopeだけとする。
4. **controller実行**: composing中は消費してno-op。pick対象がactiveな間は
   fall through(既存structural shortcutと同じゲート)。対象解決は**現在の
   CM行テキスト**基準。書き換えは1つのCM changes dispatchで行い、直後に
   `flush("command")` して**1 store commit=1 Undoステップ**にする。通常の
   `dispatchCommand`の事前flushは新commandだけ明示的に抑止し、他commandの
   既存挙動は変えない。
   dispatchには実ユーザー操作としての `Transaction.userEvent` を与え、
   patch highlightの消灯規則(次の実ユーザー操作で消える)と整合させる。
5. **非対象時のフィードバック**: 対象外では文書も`commandErrorMessage`も
   変更せず`false`を返し、通常のOption+左右操作へfall throughする。
6. **Line Lens**: lens内カーソルでも同じコマンドが動くこと(lens keymapは
   registry scopeを転送済み。lensのselection更新は既存adapterが同じ同期call
   stackでmainへ投影することをテストで固定し、値解決・書換えはmain docで一度
   だけ行う。shortcut設定変更時もmain editorと同時にregistry由来keymapへ
   再構成する。lens IMEは`view.compositionStarted`で消費する)。

## 公開API・型

* 新command ID 2件(shortcut registryが割当の唯一の正)。
* `src/dsl/dslValueStep.ts` のpure関数群(CM型・store型を含まない)。
* `SourceEditorHandle` の変更は不要(エディタ内コマンドのみ)。追加が必要に
  なった場合はCM型を漏らさないこと。

## 状態とデータフロー

* 入力: CM live doc(dirtyならdirtyテキストが基準)、`statementRangeIndex`
  (行→element)、`parameterDefinitions`(stepLevels)。
* 出力: CM changes dispatch → 即時 `flush("command")` → `commitText` →
  store履歴1ステップ+re-evaluate。store Undo 1回で元の値へ戻る。
* flushが `"blocked-composition"` を返す状況は先頭のcomposing guardで
  到達不能にする。

## 守るべき不変条件

全Phase 3子タスク共通:

* `sourceText` が唯一の文書上の正。
* CodeMirror型・importを `src/editor/` と `SourceEditorPane.tsx` の外へ漏らさない。
* selection-only操作はUndo履歴へ追加しない(本コマンドの文書変更自体は
  通常のcommitとして履歴に入る。変更後の選択位置調整を別の履歴エントリに
  しない)。
* dirty bufferでは現在のCMテキストを基準にする。
* IME composition中にjump・patch・数値変更を実行しない。
* `dslLineValueSpans` 系が「編集可能な値」の唯一の定義。数値ステップ用の
  別span解析を作らない。
* main editorとLine Lensで意味論を重複実装しない。
* Phase 4に触れない。Phase 5を先取りしない。

本タスク固有:

* number / boolean / choice以外を**絶対に書き換えない**(式 `(a+b)`・参照・
  単位付き・文字列等は非破壊)。
* 1操作=1 store Undoステップ。CM burst履歴に中間状態を残さない。
* 旧 `incrementSelectedParameter` 系のcommand ID・`parameter` scopeには
  触れない(削除は3d)。

## 必須自動テスト

* pure: 整数・小数・負数・符号反転をまたぐ増減、現在step 0.1/1/10/100、
  ratio/angleのconfigured step、浮動小数誤差なし(例: 0.1+0.2問題)。
* pure: boolean反転、choice循環、式・参照・文字列・色・keyword上では「対象外」。
* controller: `Alt+→/←` で該当値のみ変わり、store Undo 1回で完全に戻る。
  CM undo depthに残骸がない。
* controller: composing中はno-op。pick中はコマンドが走らない。
* 3aの`resolveParameterTargetAt`経由でParameterDefinitionを引き、定義が
  引けない数値spanは既定1となること。
* binding: `Alt+→/←` が `sourceEditor` scopeに登録され、既存binding
  (Tab/Shift+Tab、Mod/Alt+↑↓、Shift+Alt+系、Mod+[/])と衝突しない。
* Line Lens内カーソルからの実行。

## 手動確認

* macOS実機: Alt+→/← の連打で値が滑らかに増減し、Undo1回で1ステップ戻る。
* 日本語IME変換中にAlt+→/←を押しても文書が変わらない。
* patch highlightや評価decorationが操作後に正しく更新される。

## 明示的な対象外

* 旧parameterコマンド・`parameter` scope・フォームエディタの削除(3d)。
* インスペクタUI(3c)。
* `stepLevels` の値自体の変更・追加。
* 選択中パラメータ概念(`selectedParameterKey`)への依存(本コマンドは
  カーソル位置ベース。旧概念の整理は3d)。

## 完了条件

* `npm test` / `npm run build` / `npm run lint` 成功。
* 上記テストがgreen。旧パラメータ編集モードは無傷で共存している。
* 新コマンドがコマンドパレット/ショートカット設定UIに正しく表示される。

## 確認事項(実装時に確定して報告)

* 単一current-stepのみ。倍率修飾・stepLevels段階切替は追加しない。
* 非対象はエラーなしでfall throughする。
* command IDは`stepSourceValueForward` / `stepSourceValueBackward`。
* 現行DSLは`steps=[key:value]`で`numericParameterSteps`を保存しており、Phase
  0/1d文書の「非永続」方針と食い違う。3bでは既存getterを尊重し、保存先の整理は
  本タスクに含めない。

## 次タスクへの引き継ぎ

* 3dは旧 `incrementSelectedParameter` / `decrementSelectedParameter` /
  `increaseSelectedParameterStep` / `decreaseSelectedParameterStep` を削除する
  際、本コマンドを対応表の「新挙動」として記載する。
* 3cのインスペクタヘルプ表示(ショートカットヒント)に本コマンドを含められる。
