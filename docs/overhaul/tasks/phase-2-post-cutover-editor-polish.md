# Phase 2補遺: Phase 2e完了後のSource Editor polish(記録文書)

> 親文書: [phase-2-codemirror-pane.md](phase-2-codemirror-pane.md) /
> [phase-2e-left-panel-cutover.md](phase-2e-left-panel-cutover.md)。
>
> これは実装計画ではなく**記録文書**である(2026-07-12作成)。Phase 2e完了
> コミット(`a08d447`)以降、Phase 3着手前までに追加されたSource Editor関連の
> polish実装を棚卸しし、Phase 3/4がそのまま前提にできる「現在のEditor仕様」を
> 固定する。Phase 2e本体の当初計画は書き換えていない。挙動の正は常にコードと
> テストであり、本文書と食い違う場合はコードを正とすること。

## 目的

Phase 2eのcutover後、実アプリ検証で見つかった退行の修正と操作性polishを
複数コミットで追加した。これらはどのPhase文書にも属さない後付け実装なので、
Phase 3(インスペクタ)が古い前提で重複実装や衝突する割当をしないよう、
ここに現在仕様として集約する。

## Phase 2e以降に追加された機能(コミット順)

| コミット | 内容 |
| --- | --- |
| `1756401` | dirty時Canvas click/dragの保留・再解決(pending Canvas pointer intent状態機械)。command error表示の復旧。pickable-only検索フィルタの復旧。structural shortcutのshortcut registry経由化 |
| `7df14cb` | 保留gestureの解決をpointerdown位置のhit testに固定(最新座標はdrag deltaのみ)。stale/in-flight評価時は常にdefer。pointer capture ledger導入 |
| `71f35ee` | DocumentDiagnosticsのbadge+popover化。state rail gutter(表示/有効/ロック/印刷トグル、`@stop`評価区切り操作)。generated rows widget。model patch時のviewport/cursor安定化(未フォーカス時はdeferred cursor snapshot) |
| `c75a058` | Canvas要素選択のgesture確定後にSource Editorへフォーカスhandoff(空クリック・pan・reference pick・pointer cancelでは移動しない) |
| `23d1570` | Canvas/Commandによるmodel patchのSource Editor/Line Lens内ハイライト(DSL token粒度diff、削除は行内zero-widthマーカー、次の実ユーザー操作まで持続) |
| `1f5ab6e` | pick検索統合テストの安定化(テストのみ) |
| `feda986` | 選択行Line Lensの編集可能化(内包CMは入力面のみ、正は常にmain editor) |
| `315125f` | 編集可能な値spanのシングルクリック全選択(main+lens)。純粋モジュール `src/dsl/dslValueSpans.ts` 新設 |
| `4da0731` | Tab/Shift+Tabによる値span循環移動(main+lens、非element文は対象外) |

## 現在の操作仕様

### Canvas選択とSource Editor cursorの同期

* Canvas選択→`cadUiStore.selectedElementId`→controllerが該当statement行頭へ
  cursor投影+scroll(`projectPrimaryCursor`)。editor側cursor移動→
  `elementIdAtCursor`で逆方向に選択発行。`publishingCanvasSelection`フラグと
  `canvasCursorOrigin` annotationでループを遮断する。
* 通常のCanvas要素選択は、gestureが確定した時点(単純クリックはpointerup、
  point/Bezier dragはmove commit後)でSource Editorへフォーカスを渡す
  (`scheduleEditorFocus` / `resolveEditorFocusReservation`)。空クリック・pan・
  reference pick・pointer cancelはフォーカスを移さない。
* Canvas選択が新しいcursor位置を投影するとき、未フォーカスmodel patchが残した
  deferred cursor snapshotは破棄され、後のfocus()で古い位置へ戻らない。

### dirty flush後のCanvas click/drag保留と再解決

`src/components/pendingCanvasPointer.ts` の純粋状態機械+`DrawingCanvas.tsx` の
resolution effect。

* Canvas pointerdownはまず中央flush(`sourceEditSession.flush("canvas-pointerdown")`)。
  flushが起きた場合、既にintentが待機中の場合、または描画中のevaluationが
  現在のcompiled documentを反映していない場合(`evaluationStateIsCurrentFor`が
  偽)は、hit testせずintentとして保留する。
* intentは入力の意図(座標・修飾キー・revision・期限)のみを保持し、staleな
  renderのhit test結果は一切持ち越さない。`staleTargetHint`は削除検出専用。
* fresh evaluationが揃った時点で**pointerdown位置で**hit testし直して解決する。
  最新座標はdrag deltaにのみ寄与するため、dirty dragはblank上でdropしても
  押下した要素を動かす。
* 終端条件: fatal(`docText !== sourceText`)、評価失敗、期限超過、対象要素の
  削除 → intentを取り消し`commandErrorMessage`で通知。source revisionが進んだ
  だけならretargetして待機継続。新しいgestureは待機中intentを常に置換する。
* pointer captureは`createCanvasPointerCaptureLedger`が一元管理し、gesture終了
  時に必ず解放する(panは対象外)。

### Canvas/Command操作によるDSL変更位置の表示(patch highlight)

`src/editor/sourceEditorPatchHighlight.ts`。

* model patch適用時、行spliceをDSL token粒度でdiff(`statementReconciler`の
  `diffTexts`を再利用)し、実際に変化した値だけを`cm-patch-highlight-range`で
  マークする。行全体削除は行ハイライト、行内のみの削除はzero-widthマーカー。
* ハイライトはtimerではなく「次の実ユーザー操作」(`Transaction.userEvent`を
  持つtransaction)まで持続する。controller自身のhousekeeping dispatchでは
  消えない。Line Lensにも行ローカル座標へ変換して同じ内容を表示する。

### 編集可能な値spanの抽出(source of truth)

`src/dsl/dslValueSpans.ts` — **クリック選択・Tab移動・Line Lensの3者すべてが
この一つの定義を使う。**

* `dslLineValueSpans(lineText)`: 1行を単独でreparseし、element文の
  payload span+属性値spanを行内オフセットのsource順で返す。行を単独parseする
  ため、bufferがdirtyでも文書がfatalでも常にliveなテキストを反映する。
* 対象外: 非element文(`nui`/`role`/`view`/`color`/`printLayout`/`place`/
  `layoutVar`/`atStop`等)、parse errorのある行、blank/comment/閉じ括弧行。
  block開始行(末尾`{`)は合成closeで補ってreparseし、自身の属性値は対象に残す。
* `findDslValueSpanAt(spans, offset)`: 半開区間`[start, end)`での所属判定。
* `adjacentDslValueSpan(spans, pos, direction)`: 前後の値spanを循環で返す。

### 値spanのclick選択

* main editor: `mouseup`で、修飾キーなし・単一の空cursorに収束したクリック
  だけを対象に、cursor位置の値spanを全選択する。drag選択・Mod-click複数選択・
  CM undo履歴は乱さない(`addToHistory: false`)。
* Line Lens: 同じ判定をlens自身のdocument(=投影行そのもの、offset 0起点)で
  行い、selection-only dispatchが既存のlens→main投影で外へ伝わる。

### Tab/Shift+Tabによる値span循環移動

* main editor: 選択が単一行内にあり、その行に値spanがあるときだけ、隣の値span
  へ選択を移す(循環)。spanが無い行・複数行選択では`false`を返し、Tabは通常の
  indentへfallthroughする。
* Line Lens: `navigateLensValueSpan`が同じ`dslValueSpans`関数群で動く。lensの
  IME判定はCM自身の`view.compositionStarted`(main側`protocol.composing`は
  lensのDOM subtreeを観測しないため)。
* IME composition中はTabを完全に消費する(値移動もindentもしない)。

### Line Lens(選択行の編集投影)

* 長い選択行がviewport幅を超えるときだけ表示される浮動投影で、Phase 2e後に
  **編集可能**になった。内包CodeMirrorは入力面にすぎず、全編集は即座に
  main editorへdispatchされる(`input.lens` userEvent)。正は常にmain editor。
* patch highlight・値click選択・Tab移動・editor-wide command(Undo/Redo/保存/
  検索/fold/pick/Escape/structural shortcut)をmain editorと同一挙動で提供する。

### Source Editor structural shortcut

shortcut registryの`sourceEditor` scope(`src/keyboard/shortcutDefaultBindings.ts`)
が唯一の正。controllerはregistryから`KeyBinding`を生成し、設定変更時に
compartmentでreconfigureする。手書きの第二キーマップは存在しない。

### 評価区切り・state rail

* 評価区切り(`@stop`)はSh​ift+Alt+Arrow/Endのcommandに加え、gutterの区切り
  クリック(`setEvaluationLimitIndex`)でも移動できる。
* state rail gutterから表示(`toggleElementVisibility`)・有効
  (`toggleElementEnabled`)・ロック(`toggleElementLocked`)・グループ印刷
  (`toggleGroupPrintEnabled`)をトグルできる。

### 検索・pick・pickable-only

* `SourceSearchPanel`(React、CM import禁止境界の外側)がelement検索
  (名前/ID/型/role)とtext検索(CM search panelへ委譲)を提供。
* pick対象選択中は「pickable のみ」フィルタが`handle.pickCandidateElementIds()`
  で候補を絞る。検索Enterからのpick適用は`handle.applyPickCandidate`が
  flush→fresh候補で再解決してから適用する。
* pick navigation(Arrow/Enter/Escape)はcontroller keymapがcommandへ委譲。

### command error表示

`cadUiStore.commandErrorMessage`を`SourceEditorPane`ヘッダに`role="alert"`で
表示する。pending pointerの終端エラーとIME中のCanvas操作拒否も同じ経路。

## 共通基盤とsource of truth

| 関心事 | source of truth |
| --- | --- |
| 編集可能な値の判定・span境界・隣接移動 | `src/dsl/dslValueSpans.ts`(`dslLineValueSpans` / `findDslValueSpanAt` / `adjacentDslValueSpan`) |
| element⇔statement行の対応 | `src/editor/statementRangeIndex.ts`(`statementRanges` / `elementIdAtCursor`) |
| structural shortcut割当 | shortcut registry `sourceEditor` scope |
| dirtyテキストの中央flush | `src/editor/sourceEditSession.ts`(`flush(reason)` → `"clean" | "flushed" | "blocked-composition"`) |
| dirty時Canvas gestureの保留 | `src/components/pendingCanvasPointer.ts` |
| model patchハイライト | `src/editor/sourceEditorPatchHighlight.ts` |
| CM型の境界 | `src/editor/` と `SourceEditorPane.tsx` の外へCM型を漏らさない。外部は`SourceEditorHandle`のみ |

**selection-only transactionのUndo除外**: cursor/選択だけを動かすdispatchは
必ず`Transaction.addToHistory.of(false)`を付ける。値click選択・Tab移動・
Canvas cursor投影・secondary selection・fold投影はすべてこの規則に従っており、
Undoスタックを汚さない。

## keyboard対応表(Source Editor内)

registry管理(`sourceEditor` scope、設定で変更可):

| 操作 | 割当 |
| --- | --- |
| 選択要素を上/下へ移動 | Mod+↑/↓ または Alt+↑/↓ |
| 評価区切りを上/下/末尾へ | Shift+Alt+↑/↓/End |
| 選択要素をアウトデント/インデント | Mod+`[` / Mod+`]` |

controller keymap(固定):

| 操作 | 割当 |
| --- | --- |
| Undo / Redo | Mod+Z / Mod+Y・Mod+Shift+Z(store/CM履歴を状況で切替) |
| 保存 | Mod+S(flush後に`saveDocument`) |
| pick候補・option移動 / 適用 | ↑↓←→ / Enter(pick対象があるときのみ消費) |
| fold(cursor位置) | Ctrl+Shift+`[` / `]`(mac: Mod+Alt+`[` / `]`) |
| fold(全体) | Ctrl+Alt+`[` / `]` |
| 値spanの循環移動 | Tab / Shift+Tab(値spanのある単一行内のみ。それ以外はindent/outdentへfallthrough) |
| 検索・pick・search panelの解除等 | Escape |
| text検索 | Mod+F(searchKeymap) |

Line Lensは上記のeditor-wide command一式+Tab/Shift+Tabのlens版を同じ割当で
提供する。**Tab/Shift+Tabが値移動に使われている**点は、Phase 3以降が新しい
shortcutを割り当てる際の衝突チェック対象に含めること。

## IME composition中の挙動

* main editor: `sourceUpdateProtocol`の`composing`が正。composition中は
  commit/flushをブロック(`"blocked-composition"`)し、外部updateはqueueへ、
  Undo/Redo・structural shortcut・Tab値移動・fold・Escapeは消費して何もしない。
  decoration更新は`pendingDecorationRefresh`で遅延する。compositionend時に
  queueを排出し、必要ならflushする。
* Line Lens: lens内のcompositionはCM自身の`view.compositionStarted`で判定する。
* Canvas: composition中のpointerdownはflushが`"blocked-composition"`を返し、
  操作を開始せずcommand errorで「入力を確定してから再操作」と通知する。
* controllerのdestroyはcomposition中に到達しない設計(app側close guard)。
  到達した場合はdevビルドでconsole.errorする。

## dirty / fatal / stale evaluation時の安全規則

* **model patchはdirty `sourceText`を基準に実行しない**(Phase 2からの中央
  防衛は不変)。Canvas gestureはpointerdownで必ずflushする。
* fatal(`docText !== sourceText`)中はCanvas操作を開始しない: 保留intentは
  terminal error、値spanは行単独parseなので表示・選択は安全に動き続ける。
* stale/in-flight evaluationに対するhit testは行わない。保留intentのみが
  fresh evaluationで再解決される。
* dirty中のdiagnosticsはCM bufferの再parse+stale baselineの層状表示
  (Phase 2dの仕組みを継続)。評価decorationsはlast-good評価を保持し、
  ヘッダに「評価: last-good」を表示する(`isLastGood`)。
* 値span抽出はerror診断のある行に対してspanを返さない(部分parseのspanを
  クリック選択に使わない)。

## Main Source EditorとLine Lensの共通点・相違点

| 観点 | Main Source Editor | Line Lens |
| --- | --- | --- |
| 文書の正 | 正準(store `sourceText`+CM buffer) | 投影のみ。全編集を即mainへdispatch |
| 値span定義 | `dslValueSpans`(行offsetを`line.from`で変換) | 同じ`dslValueSpans`(doc全体が1行なので変換不要) |
| 値click選択 | `handleValueClick`(controller) | `handleValueClick`(lens、同一ロジックのview違い) |
| Tab値移動 | `navigateValueSpan` | `navigateLensValueSpan` |
| IME判定 | `protocol.composing` | `view.compositionStarted` |
| keymap | controller keymap+registry scope | mainのeditor-wide commandを転送する`lineLensKeymap`+同registry scope |
| patch highlight | `patchHighlightField`本体 | mainのfieldを行ローカルへ変換して表示 |
| Undo履歴 | CM履歴(burst内)+store履歴 | 自前履歴なし(mainへ委譲) |

controllerとlensのclick/Tabハンドラは薄いview配線が2箇所にあるが、値の判定・
span境界・循環順序はすべて`dslValueSpans`に一本化されており、仕様の重複実装は
ない。

## Phase 3が再利用すべきAPI・helper

* **`SourceEditorHandle`**(`src/editor/sourceEditorTypes.ts`): `focus` /
  `jumpToElement`(statement行頭へのジャンプ)/ pick・検索API。Phase 3の
  「パラメータ→値spanジャンプ」は**このhandleの拡張メソッド**として追加し、
  controller内部で`statementRanges`+`dslLineValueSpans`を使って実装する。
  CM型はhandleの外へ出さない。
* **`dslValueSpans`関数群**: Inspector行と属性値の対応付け・ジャンプ先span
  決定に使う。live buffer上のdirtyな行でも正しいのはこのモジュールだけ。
* **selection-only transaction規則**: ジャンプ・選択は
  `Transaction.addToHistory.of(false)`で行い、Undoへ入れない。
* **IME guard**: main側は`protocol.composing`、lens側は
  `view.compositionStarted`。Phase 3の新コマンドも同じゲートを通すこと。
* **`sourceEditSession.flush`**: 文書を変更するコマンドは実行前に中央flushを
  通し、`"blocked-composition"`なら実行しない。
* **`statementRangeIndex`**: elementId→行範囲。Inspector行からのジャンプは
  statementMapを再parseせずこのindexを使う。

## Phase 3で重複実装してはいけないもの

* 編集可能な値spanの**別解析**(Inspector専用のattribute span parserを
  作らない。`dslValueSpans`か、必要ならその拡張に一本化する)。
* 値全体selectionの別実装(click選択と同じselection dispatch経路を使う)。
* Source EditorとLine Lensの値移動の別実装(Tab移動が既にある)。
* dirty buffer上での現在span解決の別実装(行単独reparseが既に規範)。
* selection-only transactionのUndo除外の独自方式。
* IME composition guardの独自実装。
* shortcut registryを迂回した手書きキーマップ。

## 未完了事項・申し送り

* `data-element-list`を参照する`isElementListTarget` matcherが
  `shortcutDefaultBindings.ts` / `shortcuts.ts`の`normal` scopeに残っている。
  LeftPanel削除後は実質デッドコード(DslPanelにのみ同属性が残る)。挙動には
  無害のためPhase 5の掃除対象。
* `focusElementList` command IDと`CommandContext.focusElementList`は現在
  Source Editorのfocusを意味する(命名だけが旧世代)。リネームはPhase 5。
* `parameter` scopeのshortcut群(`incrementSelectedParameter`等)はPhase 3で
  パラメータ編集モードごと整理される予定の旧配管であり、本文書の対象外。
