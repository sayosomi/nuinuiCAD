# Phase 4c: CommandLineBar + セッションコマンド + 挿入確定

> 親文書: [phase-4-command-line.md](phase-4-command-line.md)。着手前に
> `AGENTS.md` → `docs/overhaul/plan.md` → 親文書 → 4a-1/4b文書 →
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md)
> の順で読むこと。

## Context

4bまでで状態機械は完成しているが誰も起動しない。本タスクでCanvas下部の
常設1行バーとセッション操作コマンドを実装し、**参照ステップを含まない
レシピ(`freePoint` / `variable` 等)だけ**をキーボードのみでE2E成立させる。
参照ステップ(point/line等)を含むレシピの解放はピック連携(4d)後。

## Goal

コマンドパレットからセッションを開始し、数値タイプ→名前ステップ→Enter確定
→1 Undoステップで文書に1行挿入され、新要素が選択されエディタカーソルが
その行に乗る、という最短手数フローを成立させる。

## Scope

* 新規 `src/components/CommandLineBar.tsx` — Canvas下部の常設1行バー。
  セッションなし時は非表示(または空きプレースホルダ。左右パネルの
  レイアウトを壊さない)。表示内容: 現在コマンド名/プロンプト/確定済み
  引数チップ/入力欄/エラー(stale等)。
* セッションコマンド(command registry+palette登録):
  * 型別の暫定開始コマンド(例 `commandLineAddFreePoint`、
    `commandLineAddVariable`。**参照ステップなしレシピのみ**)。
    ラベル例「コマンドラインで free point を作成」。
    ※これらのIDは4gで正規の `addFreePoint` 等へ吸収し削除される暫定IDで
    あることをJSDocに明記する。
  * `cancelCommandLineSession`(Esc相当)/ `confirmCommandLineSession`。
* バーの入力挙動:
  * numberステップ: 数値・式をタイプ→Enterで充填(式の妥当性検証は
    しない。評価エラーは既存の診断が出す)。default付きは空Enterで
    default採用。
  * nameステップ: `nameSuggestion` をプレースホルダ表示。Enter=候補採用、
    タイプ=上書き、空のままEnterまたは明示スキップ操作=無名。
  * 最終ステップ完了後のEnter=確定。
  * Esc=セッションキャンセル(既存の一括pickクリアも呼ぶ。他のモード・
    ダイアログを巻き込まない)。
* **セッション中の作成コマンド再入=破棄して置換**(親文書の確定判断):
  セッション表示中に別の(または同じ)作成コマンドが発行されたら、確認
  ダイアログを出さずに現在セッションを破棄して新規開始する。開始コマンドの
  実装は共通の1関数に集約し、次の順で行う:
  1. IME composition中なら何もしない(新セッションを開始せず、既存
     セッションも破棄しない。command errorで「入力を確定してから再操作」を
     通知する既存パターン)。
  2. 保留中のCanvas pointer intentとエディタfocus予約を解除する。
  3. storeのセッション開始setter(4b)を呼ぶ。setterがactive pick target
     群・pick draft・pickカーソルのクリアと置換をアトミックに行う。
  破棄・置換は文書未変更のためUndo履歴に触れない。
* 確定処理(コマンド実装側、Reactに置かない):
  1. `sourceEditSession.flush("command-line-confirm")` を通す
     (`"blocked-composition"` なら実行しない)。
  2. staleチェック(`sessionIsStale`)。staleなら明示エラーでキャンセル。
  3. 4a-1 `emitCreationRecipe(session.recipe, session.args, context)` で
     `CadElement` を構築する。`context` は現在の `elements`、挿入位置より前の
     `referenceElements`、必要時のID生成器から作る。既存の
     `commitDocumentChange`(ブリッジ)へ「`insertionIndex` に1要素挿入した
     elements配列+選択」を渡す。**手書きのcommitTextスプライスを
     実装しない**(行スプライス・コメント保存・1 Undoはブリッジの既存保証)。
  4. セッションをクリアし、Source Editorへフォーカス+カーソルを新要素行へ
     (既存の選択→カーソル投影機構に任せ、独自スクロール処理を書かない)。
* セッション開始時の `insertionIndex` 確定: Source Editorカーソル行の要素文
  (`statementRangeIndex` / `SourceEditorHandle` 経由)があればその位置、
  なければ `creationPlacementForEvaluationLimit`(4bのヘルパ)。
* stale監視: セッション表示中に外部コミットを検出したらバーへエラー表示し
  キャンセル(4bの方針どおり。黙って追従しない)。

## Out of Scope

* 参照ステップのpick・名前タイプ充填(4d)。参照ステップを含むレシピは
  paletteに出さない。
* ゴーストプレビュー(4f)・無名昇格(4e)。
* 既存 `addFreePoint` 等のcutover(4g)。旧即時挿入コマンドはそのまま動く。
* DslPanel関連(4i)。

## Existing APIs / files to reuse

* 4a-1 `creationRecipes` / 4b `commandLineSession` + storeセッション状態
  (開始setterの置換意味論含む)。
* `src/state/cadDocumentStore.ts` `commitDocumentChange`(ブリッジ)。
* `src/editor/sourceEditSession.ts` `flush(reason)`。
* `src/editor/statementRangeIndex.ts` + `SourceEditorHandle`(カーソル行→
  文index。CM型を外に出さない境界を守る)。
* `src/commands/` の既存command定義パターン(`creationCommandDefinitions.ts`
  参照)とcommand palette登録。
* `src/components/PickModeStatus.tsx` — バーとの表示責務の切り分けの参考
  (テンプレート挿入が自前パネルを持つ場合にPickModeStatusを抑制している
  のと同じ関係になる。実際の抑制は4d)。

## Invariants

* **選択中要素を暗黙に消費しない**。4c時点のレシピ(number/name)は選択と
  無関係だが、バーが選択状態を読んで何かを自動充填する実装を入れないこと。
* バーの入力欄はform入力: **文字入力と衝突するshortcut(単キー等)は
  form入力フォーカス中に発火させない**(既存の除外原則)。ただし
  **Mod付きなど文字入力と衝突しない作成shortcutは、バー入力中でも共通
  再入経路を通して置換できる**(親文書の確定判断)。バー表示中も
  Canvas・エディタの既存ショートカットは非干渉。
* セッション置換後、inert領域内にfocusが取り残されないこと: 置換の共通
  開始経路はfocusの行き先(バー入力欄)を必ず確定させ、旧pick状態の
  クリアにより次renderでDOM inert(`AppLayout` 導出)が解除される
  (親文書の確定判断。lineList pick中の置換を実際に演習するのは4d)。
* 1作成=1 Undoステップ。挿入以外の行(コメント・空行・他要素)は不変。
* コマンド実装はcommands層に置き、Reactコンポーネントへビジネスロジックを
  置かない(AGENTS.md)。
* IME composition中に確定を実行しない(flushのblocked-compositionゲート)。
* Escの効果はセッションキャンセルのみで予測可能。

## Edge cases

* 空文書(要素0)でのセッション開始と挿入(insertionIndex=0)。
* グループ内カーソル位置での開始 → グループ内へ挿入され、名前候補が
  そのスコープで一意。
* `@stop`(評価区切り)より後ろへの挿入: 挿入は成功し、評価されない要素と
  して既存の診断・表示に従う(特別扱いしない)。
* セッション中の保存(Mod+S)・Undo: 文書コミットが起きればstaleキャンセル。
* dirtyバッファでのセッション開始: 開始時にもflushを通し、
  blocked-compositionなら開始しない。
* 数値入力途中で別の作成コマンドを発行 → 入力内容ごと破棄され新セッション
  になる(確認なし)。同じコマンドの再実行 → 同レシピの初期状態へリセット。
* バーの入力欄にフォーカスがある状態での作成shortcut:
  * 文字入力と衝突するbinding(単キー等)→ 発火しない(form入力除外)。
    この場合の置換はpalette・ribbon等のコマンド発行経路から起きる。
  * Mod付き等、文字入力と衝突しないbinding → バー入力中でも発火し、
    共通再入経路で置換する(同一shortcutの再実行=リセットを含む)。
  * IME composition中 → 開始・置換とも拒否し、既存セッションと入力内容を
    維持する(command errorで通知)。

## Tests

* コマンドディスパッチ: 開始→number充填→name採用/上書き/スキップ→確定の
  一連をstore経由で検証(1 Undoステップ、挿入位置、選択、無名要素)。
* stale時の確定拒否+セッションキャンセル+エラー文言。
* Escキャンセルでセッション・pick状態が全クリアされること。
* 再入置換: セッション進行中に別/同一の開始コマンド→引数が残らず新規
  開始、Undo履歴長不変、確認UIが出ないこと。IME中の開始コマンド→既存
  セッション無傷+エラー通知。
* shortcut整合: バー入力フォーカス中、文字入力と衝突するbindingが発火
  しないこと/Mod付き作成shortcutが共通再入経路で置換すること(同一
  shortcut再実行のリセット含む)。
* 置換後にDOM inert属性が残らず、inert領域内(Source Editorペイン・
  右パネル)にfocusが取り残されないこと(コンポーネントレベルの回帰
  テスト。lineList pick中の本格的な演習は4d)。
* insertionIndex決定(カーソル行あり/なし)の統合テスト。
* バー入力フォーカス中にグローバルショートカットが発火しないこと
  (既存のform-input除外テストのパターンを流用)。
* 既存の旧作成コマンド(`addFreePoint` 等)が無変更で通ること(回帰)。

## Manual verification

* 実アプリ(`npm run desktop:dev` またはVite dev)で:
  palette→「コマンドラインで free point を作成」→X・Yタイプ→名前Enter採用
  →確定、がキーボードのみで完了する。Undo1回で行ごと消える。
  カーソルが新要素行に乗る。Escでいつでも中断できる。
* macOS日本語IMEで名前ステップに日本語名を入力できる。

## Completion criteria

* number/nameのみのレシピがキーボードだけで最短手数E2E成立。
* `npm test` / `npm run build` / `npm run lint` green。
* 旧作成フロー・pick基盤・エディタ挙動に回帰がない。

## Dependencies

* 4b完了。4a-2・4h・4iと並行可。

## Handoff to next task

* 4dは参照ステップ進入時に仮想pick target(insertionIndex付き)を設定し、
  受理値を `fillCurrentStep` へルーティングして、参照ステップ入りレシピを
  paletteに解放する。バーのプロンプト表示は4dで
  「クリック / 名前入力 / Enter=選択中: <名前>」形式に拡張される。
* 暫定command ID一覧(4gで吸収対象)をハンドバック報告に含めること。
