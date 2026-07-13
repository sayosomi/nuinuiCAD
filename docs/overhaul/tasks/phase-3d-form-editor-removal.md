# Phase 3d: フォーム型パラメータ編集の廃止(cutover)

> 親文書: [phase-3-inspector.md](phase-3-inspector.md)。
> 着手前に `docs/overhaul/plan.md` →
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md) →
> 3a/3b/3cの各文書の順で読むこと。AGENTS.md の規則に従うこと。
> **3bと3cの両方の完了後に着手。** Phase 3の最終段。

## Context

3cまでで右ペインは「読み取り専用インスペクタ+旧フォーム編集の併存」状態に
ある。値変更の代替経路(ジャンプ→テキスト編集、数値ステップコマンド)は
3a/3bで成立済み。本タスクでフォーム編集UIとパラメータ編集モードを削除し、
「見るのは右ペイン、書くのはDSL」の最終形へcutoverする。

Phase 2eのcutoverと同じ原則: 途中commitでは旧UIが残ってよいが、タスク完了時に
feature flagや二重UIを残さない。

## 目的

* `RightPanel.tsx` をInspectorPanel構成のみへ書き換える。
* フォーム編集系コンポーネントとそのテストを削除する。
* `parameterDefinitions.ts` を縮小する(`directKey` と編集モード配管を削除、
  `label`・`kind`・`stepLevels`・`choiceOptions` 等の宣言情報は残す)。
* パラメータ値編集コマンドとパラメータ編集モードを削除し、ナビゲーション系を
  インスペクタ行フォーカス/カーソルジャンプへ再配線する。
* 廃止command IDの対応表(旧ID→新挙動)をタスク報告に含める。

## 開始時点の前提

* 3a(ジャンプAPI)・3b(数値ステップ)・3c(InspectorPanel併存)完了。
* キーボードでの値変更は「インスペクタ行→Enter→タイプ」と
  「エディタ内 Alt+→/←」の2経路が既に動いている。

## 変更対象ファイル

削除(参照の全数確認後。`rg` で残存参照ゼロを確認すること):

* `src/components/ElementEditor.tsx`
* `src/components/ElementSpecificFields.tsx` と全 `*ElementFields.tsx`
* `src/components/ParameterEditors.tsx` / `NumericParameterEditor.tsx` /
  `PointParameterEditors.tsx` / `ChoiceAndReferenceParameterEditors.tsx` /
  `ColorParameterEditor`(実ファイル名を確認)
* `src/components/ExpressionInsertTray.tsx`
* `src/components/parameterEditorShared.tsx` / `ParameterName.tsx`
  (他所から参照が残る場合は残置し報告)
* 上記の専用テスト・専用CSS

書き換え:

* `src/components/RightPanel.tsx`(+test)— InspectorPanel構成のみへ。
* `src/parameters/parameterDefinitions.ts` — `directKey` フィールドと
  `findParameterByDirectKey` 等の編集モード専用ヘルパを削除。
* `src/commands/parameterCommands.ts` / `parameterCommandDefinitions.ts` /
  `commandTypes.ts` — 値編集コマンド削除、ナビゲーション再配線。
* `src/keyboard/shortcutDefaultBindings.ts` / `shortcuts.ts` —
  `parameter` scope(編集モード)のバインディングテーブル削除・整理。
* `src/state/cadUiStore.ts` — `isParameterEditMode` /
  `selectedParameterKey` / expression insert系など、本タスクで死ぬ配管の削除
  (このタスクが殺すstateはこのタスクで消す。元から死んでいた無関係stateの
  大掃除はPhase 5)。**3cから残る`selectedDependencyJumpIndex`も、旧dependency
  jump経路の参照全数確認後に専用配管・専用テストとともに削除対象とする。**
* `src/components/AppLayout.tsx` — `registerParameterControl` /
  parameter mode props等の除去。
* `src/components/DrawingCanvas.tsx` — 削除コンポーネント由来のprops/参照が
  あれば追随(pick関連は下記確認事項に従う)。

## 実装手順

1. **削除対象の依存マップ作成**: 各削除ファイルへの参照を `rg` で全数列挙し、
   「削除」「InspectorPanel/コマンドへ再配線」「残置(理由)」に分類してから
   着手する。特にpick開始コマンド(下記確認事項)の扱いを先に確定する。
2. **コマンド整理**: 値編集系(`incrementSelectedParameter` /
   `decrementSelectedParameter` / `increaseSelectedParameterStep` /
   `decreaseSelectedParameterStep` / `toggleSelectedParameterValue` /
   `activateSelectedParameter` / `focusSelectedParameterInput` /
   `toggleBooleanParameterByDirectKey` 等)を削除。
   `enterParameterEditMode` / `selectNextParameter` / `selectPreviousParameter`
   / `selectParameterByKey` はインスペクタ行フォーカス/ジャンプへ再配線
   するか廃止し、対応表に記録する。
3. **ユーザーshortcut設定の保護**: 廃止IDは登録から外す。保存済み
   `shortcutSettings` に廃止IDが残っていても読み込み・設定UIが壊れないことを
   テストで保証する。
4. **UI cutover**: RightPanelからElementEditor/ExpressionInsertTrayを外し、
   ファイル削除。CSSの死んだクラスも同時に削除。
5. **`parameterDefinitions.ts` 縮小**: `directKey` 削除。`kind` / `label` /
   `stepLevels` / `choiceOptions` / `emptyInputDefaultValue` 等、3b(数値
   ステップ)・インスペクタ表示・Phase 4のレシピと補完が使う宣言情報は残す。
6. **旧テストの置換**: フォーム編集のテストを、インスペクタ経由・数値
   ステップ経由の等価シナリオへ置換してから削除する(カバレッジの穴を
   作らない)。

## 公開API・型

* 削除・変更されるcommand IDの完全な対応表(旧ID→新挙動/廃止)を
  タスク報告に含める。これが本タスクの主要な「公開API変更」。
* `ParameterDefinition` 型から `directKey` が消える。他フィールドの意味は
  不変。

## 状態とデータフロー

* 文書変更経路は「エディタでのテキスト編集」と「数値ステップコマンド」のみに
  なる。フォーム→`updateElement` 系の経路が消えることで、model patchの
  発生源はCanvas操作・コマンド・エディタ編集に統一される。
* `cadUiStore` からパラメータ編集モード関連stateが消える。インスペクタ行
  フォーカスstate(3c)が唯一の「パラメータ位置」概念になる。

## 守るべき不変条件

全Phase 3子タスク共通:

* `sourceText` が唯一の文書上の正。
* CodeMirror型・importを `src/editor/` と `SourceEditorPane.tsx` の外へ漏らさない。
* selection-only操作はUndo履歴へ追加しない。
* dirty bufferでは現在のCMテキストを基準にする。
* IME composition中にjump・patch・数値変更を実行しない。
* `dslLineValueSpans` 系が「編集可能な値」の唯一の定義。Inspector専用の
  値span解析を作らない。
* main editorとLine Lensで意味論を重複実装しない。
* Phase 4(autocomplete・コマンドライン・DslPanel削除)に触れない。
  **DslPanelは本タスクの削除対象ではない**(フォーム編集とは別系統)。
* Phase 5のハードクリーンアップを先取りしない(削除は本タスクが殺した配管に
  限る)。

本タスク固有:

* キーボードファースト: cutover後も「要素選択→パラメータへ到達→値変更」が
  マウスなしで完結すること(3c+3bの経路)。
* 削除は参照全数確認とテスト置換を伴うこと。「消したら通らなくなったテストを
  消す」で済ませない。

## 必須自動テスト

* 廃止コマンドIDがdispatchされても安全(未登録として無害、または明示の
  no-op+警告)。
* 保存済みshortcut設定に廃止IDが含まれていても読み込みが壊れない。
* インスペクタ+数値ステップだけで全パラメータ種別の値変更が成立する
  E2E的テスト(全27要素型を通す行列は3aのfixtureを再利用)。
* RightPanelに編集用input類が存在しないこと。
* `rg` 相当の静的確認: 削除ファイル・削除コマンドIDへの参照ゼロ
  (テストコード内の文字列参照も含む)。

## 手動確認

macOS Tauri実機で:

* 新規作成→作図→インスペクタでパラメータ確認→ジャンプ編集→数値ステップ→
  保存→再起動→読込、の一連が完走する。
* 日本語IMEでの名前・テキスト要素編集(ジャンプ後の置換入力)。
* ショートカット設定ダイアログに廃止コマンドが現れない。
* Undo/Redoがフォーム時代と同等以上に自然(値変更1操作=1ステップ)。

## 明示的な対象外

* DslPanel・コマンドライン作図・DSL補完(Phase 4)。
* `parameterDefinitions.ts` の全削除(縮小のみ。Phase 4が依存)。
* 死んだ旧stateの網羅的な大掃除・リネーム伝播(Phase 5)。
* Source Editor本体の機能追加。

## 完了条件

* 右ペインが読み取り専用インスペクタのみになり、フォーム編集系ファイルが
  削除されている。
* 全27要素型でジャンプ→編集→commitループと数値ステップが成立
  (Phase 3全体の完了条件)。
* `npm test` / `npm run build` / `npm run lint` 成功。
* 廃止command ID対応表が報告に含まれている。

## 確認事項(実装時に確定して報告)

* **pick開始経路**: `startPointPick` / `startNumericReferencePick` /
  `startLinePick` の現在の**唯一のUI入口は削除対象のフォームエディタ群**
  (`PointParameterEditors` / `NumericParameterEditor` /
  `ChoiceAndReferenceParameterEditors`)にある。Source Editor側にはpickの
  候補navigation/applyはあるが開始UIがない。フォーム削除でこれらのpickが
  到達不能にならないよう、代替の開始経路(候補: インスペクタの参照系
  パラメータ行からのコマンド起動、エディタcontext menu、コマンドパレット)を
  **削除前に**確定すること。「インスペクタは読み取り専用(文書変更はジャンプ先
  編集と数値ステップのみ)」との整合は、pick開始自体は文書を変更しない
  (適用はpickコマンド側)ことを踏まえて親文書の不変条件の解釈を確定し、
  必要なら親文書を更新する。
* `ParameterName.tsx` / `parameterEditorShared.tsx` の残置要否(Inspector
  表示で再利用するなら削除しない)。
* `ExpressionInsertTray` が担っていた計測値挿入(`insertSelectedMeasurement`
  等)の扱い: 廃止して対応表に載せるか、Phase 4のコマンドライン/補完へ
  明示的に先送りするかを確定する。
* `dependencyJump` mode(3cの確認事項で併存を選んだ場合)の最終形。特に
  `selectedDependencyJumpIndex` の全参照を監査し、Inspector navigationの正である
  `activeRowKey`へ統一済みで旧経路が不要なら、state・専用配管・専用テストを完全削除する。

## 次タスクへの引き継ぎ

* Phase 4(コマンドライン+DSL補完)は縮小後の `parameterDefinitions.ts` を
  レシピ・補完データとして使う。縮小時に消したフィールドがPhase 4計画の
  前提と矛盾しないか、`phase-4-command-line.md` を確認して報告する。
* Phase 5は本タスクの「残置(理由)」リストを引き継いでハードクリーン
  アップの対象にする。
* 3cからの明示的引継ぎ: `selectedDependencyJumpIndex` は旧dependency jump互換のため
  残置されている。3dで旧経路の参照がゼロになった時点で削除する。
