# Phase 3b: エディタネイティブ数値ステップコマンド

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
(または選択中)の値spanが**数値リテラル**のとき、その値を
`parameterDefinitions.ts` の `stepLevels` に従って増減する。1操作=1 store
Undoステップ。

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

* 新規 `src/dsl/dslNumericStep.ts`(命名は実装時に確定可)— 数値リテラル
  判定とstep適用のpure helper。
* 新規 `src/dsl/dslNumericStep.test.ts`。
* `src/commands/commandTypes.ts` / コマンド定義ファイル — 新command ID追加。
* `src/keyboard/shortcutDefaultBindings.ts` — `sourceEditor` scopeへ
  `Alt+ArrowRight` / `Alt+ArrowLeft` を追加。
* `src/editor/sourceEditorController.ts` — コマンド実行本体(バッファ書換+
  即時commit)。lens keymapへの転送は既存 `sourceEditorShortcutKeymap()` 経由で
  自動に乗ること。
* `src/editor/sourceEditorController.test.ts`(または新規テストファイル)。
* `src/keyboard/shortcuts.test.ts` — バインディングと非衝突の検証。

## 実装手順

1. **pure helper**: `(lineText, offset)` から
   * 対象値span(カーソルがspan内、または選択が値spanと一致)を
     `dslValueSpans` 系で特定し、
   * spanの中身が単純数値リテラル(符号・小数を含む)か判定し、
   * `step` を与えると増減後のテキストとカーソル/選択の新位置を返す
   純関数を作る。式・参照・文字列・真偽・色は「対象外」を返す(書き換えない)。
   丸め規則(浮動小数の誤差を出さない固定小数処理)をテストで固定する。
2. **step量の決定**: 3aの `resolveParameterValueSpan` の逆方向(span→
   parameterKey)でParameterDefinitionを特定し、
   `getNumericParameterStep` / `stepLevels` を使う。定義が引けないspan
   (無名のpayload座標等)は既定1mm。
3. **コマンド化**: 新command ID(例: `stepNumericValueUp` /
   `stepNumericValueDown`。最終名称は実装時確定)をコマンド定義へ追加し、
   `sourceEditor` scopeのregistryへ `Alt+→/←` で登録する。既存の
   structural shortcut群と同じ経路(registry→controllerのcompartment)に乗せ、
   **手書きの第二キーマップを作らない**。
4. **controller実行**: composing中は消費してno-op。pick対象がactiveな間は
   fall through(既存structural shortcutと同じゲート)。対象解決は**現在の
   CM行テキスト**基準。書き換えは1つのCM changes dispatchで行い、直後に
   `flush("command")` して**1 store commit=1 Undoステップ**にする。
   dispatchには実ユーザー操作としての `Transaction.userEvent` を与え、
   patch highlightの消灯規則(次の実ユーザー操作で消える)と整合させる。
5. **非対象時のフィードバック**: 数値リテラル以外の上で押された場合は
   文書を変更しない。無反応にするか `commandErrorMessage` を出すかは実装時に
   確定し、テストで固定する。
6. **Line Lens**: lens内カーソルでも同じコマンドが動くこと(lens keymapは
   registry scopeを転送済み。lensの編集はmainへ即dispatchされるので、
   実装がmain docベースなら追加作業は原則不要のはず。テストで保証する)。

## 公開API・型

* 新command ID 2件(shortcut registryが割当の唯一の正)。
* `src/dsl/dslNumericStep.ts` のpure関数群(CM型・store型を含まない)。
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

* 数値リテラル以外を**絶対に書き換えない**(式 `(a+b)`・参照・単位付き等は
  非破壊)。
* 1操作=1 store Undoステップ。CM burst履歴に中間状態を残さない。
* 旧 `incrementSelectedParameter` 系のcommand ID・`parameter` scopeには
  触れない(削除は3d)。

## 必須自動テスト

* pure: 整数・小数・負数・符号反転をまたぐ増減、step 0.1/1/10/100、
  ratio/angleのstepLevels、浮動小数誤差なし(例: 0.1+0.2問題)。
* pure: 式・参照・文字列・真偽・色・keyword上では「対象外」。
* controller: `Alt+→/←` で該当値のみ変わり、store Undo 1回で完全に戻る。
  CM undo depthに残骸がない。
* controller: composing中はno-op。pick中はコマンドが走らない。
* stepLevelsの選択がParameterDefinitionから正しく引ける(3aのマッピング
  経由)。定義が引けないspanは既定1。
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

* 倍率修飾の扱い: 旧parameter scopeは `Shift`=10倍 / `Alt`=0.1倍だったが、
  本コマンドは起動自体にAltを使うため同じ慣行を移せない。`Shift+Alt+→/←` は
  評価区切り移動と衝突するため使えない。stepLevelsの段階切替
  (旧 `[` / `]` 相当)を持ち込むか、単一stepのみで出すかを実装時に決めて
  親文書へ反映する。
* 非対象トークン上でのフィードバック方式(無反応 vs `commandErrorMessage`)。
* command IDの最終名称。

## 次タスクへの引き継ぎ

* 3dは旧 `incrementSelectedParameter` / `decrementSelectedParameter` /
  `increaseSelectedParameterStep` / `decreaseSelectedParameterStep` を削除する
  際、本コマンドを対応表の「新挙動」として記載する。
* 3cのインスペクタヘルプ表示(ショートカットヒント)に本コマンドを含められる。
