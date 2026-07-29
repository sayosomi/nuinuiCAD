# 51: nui 3 typed variable — 手動 Tauri E2E チェックリスト

> 親文書: [51-manual-e2e-docs.md](51-manual-e2e-docs.md)。共通仕様は
> [plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
> 自動テスト(`npm test`、`npm run test:parity` 等)では代替できない、実機
> macOS Tauri での手動確認項目。**未実施の項目が残る間はTask 51を完了扱いに
> しない。エージェント自身がこのチェックリストのmanual項目をpass扱いにしない
> — 各セルはユーザーが実際に操作して記入する。**

## 対象と目的

typed variable(`const`/`let`/`set`)、レキシカルスコープ、text template、
property binding、activity `state:`構文は自動テスト・parityテストで検証済み
だが、実機Tauriアプリで人が操作したことは一度もない。本チェックリストは
Task 47(既存文書の手動migration)着手前の最終手動確認ゲートである。

## 前提条件

1. 各シナリオは **`npm run desktop:dev:rust`**(production Rust-first)と
   **`npm run desktop:dev:parity`**(TS reference/Rust比較)の**両方**で実行する。
   記録表には `結果(Rust-first)` / `結果(parity)` の2列があり、どちらも
   ユーザーが実際に試した上で記入する。「見た目が同じ操作だから片方は省略
   してよい」とエージェントが判断して埋めることはしない。
2. parity modeでは、各シナリオの期待結果に加えて次を必ず確認する:
   **DevTools Consoleに TS/Rust mismatch の throw やエラーログが出ないこと**。
   (parity/shadowモードはTS reference出力とRust出力を毎回比較し、不一致は
   例外またはconsoleエラーとして表面化する。)
3. DevToolsを開き(右クリック→Inspect Element)、Consoleを表示しておく。
   全シナリオ共通の確認事項: uncaught exception、React error overlayが
   出ないこと(parity mismatch以外の一般的な健全性チェックとして)。
4. 各シナリオで使うfixtureは `docs/typed-variables/manual-fixtures/` にある。
   これらは**現在の nui 3 実装が実際に生成する値で検証済み**(コンパイル・
   参照評価の結果を確認してから作成した)。期待結果の数値・文字列は本物の
   評価結果であり、想像や仕様書からの推測ではない。
5. 特記のない限り、各fixtureは新規文書を作り、Source Editorへ内容を貼り付
   けて保存する(またはFile > Openで直接開く)ところから始める。

## F2 typed rename配線(チェックリスト作成後に追加実装)

チェックリスト作成中の事前調査で、`renameTypedBindingWithPropagation`
(Task 38)がproduction UIのどこからも呼ばれていない(F2はCAD要素専用)こと
が判明した。ユーザー指示によりmanual pass開始前に配線を追加した:

* `src/editor/typedRenameTargetAtCursor.ts`(新規、pure関数): cursor位置から
  typed binding(declaration/reference/set target/set RHS参照/property
  binding参照/template hole参照)を解決する。
* `SourceEditorController.currentCursorTypedRenameTargetBindingId()`(新規):
  上記resolverを`typedSemanticMetadataFresh`ゲート付きで呼ぶ。
* `openRenameSelectedElementPrompt`(`selectionCommandDefinitions.ts`):
  F2実行時にcursor位置のtyped bindingを優先し、無ければ既存のCAD要素rename
  (selection起点)へfallbackする。
* `RenameTypedBindingDialog.tsx`(新規、`RenameElementDialog.tsx`と同型):
  新しい名前の入力prompt。既存dialogは変更していない。

回帰testは `src/editor/typedRenameTargetAtCursor.test.ts`(pure resolver、
9件)と `src/editor/sourceEditorController.typedRename.test.ts`(controller/
F2 dispatch、既存4件+新規8件)に追加した。既存のCAD要素rename(F2・選択
based)・`renameTypedBindingWithPropagation`自体の伝播・poison/collision等の
挙動は変更していない。

シナリオ10は下記のとおり通常の期待結果へ更新した(既知failとしての記載は
撤回)。

## Problems と評価状態マーカー

Problems を開く正式な入口は、**Source Editor ヘッダーのファイル名表示の右**に
ある警告三角ボタンである。compile diagnostics、binding issues、scalar runtime
diagnostics があるときは三角の横に件数が表示され、クリックすると Problems
一覧が開く。`✓` は「Problems 対象の診断が0件」の表示であり、disabled 状態や
Inspector の折りたたみ操作ではない。この状態では開く行がないため、クリック
しても一覧は表示されない。

Source Editor 左端の灰色 activity marker は要素の表示/評価状態を切り替える
既存操作であり、診断 UI とは別機能である。一般ジオメトリの評価エラー／警告は
行背景と行頭ラインで示され、本文は該当要素を選択した Inspector の issue 表示で
確認する。`@stop` は DSL 本文と破線で評価区切りを示し、区切りを動かす操作は
既存のショートカット、要素コンテキストメニュー、またはコマンドパレットを使う。

## シナリオ 1: typed declaration(4型)

**fixture**: `nui3-declarations-templates.nui`

**手順**

1. fixtureを開く。
2. `const length: number`、`const label: string`、`const printed: boolean`、
   `const side: choice(right, left)` の4行をそれぞれ選択し、Inspectorの
   宣言メタデータ(kind/type/生の初期化式/binding ID)を確認する。
3. Canvas上のtext要素 `Label` と `Bare` の描画内容を確認する。
4. `point B` と `line AB` をそれぞれ選択し、Inspector の issue 表示で評価
   エラー本文を確認する。Source Editor ヘッダーの Problems ボタンが `✓` の
   ままであることも確認する。

**期待結果**

* `Label` は `{draft} 前身頃 12.346` (末尾に改行)、`Bare` は `前身頃` と
  描画される(実測値。`\{`/`\}` はliteral braceとして表示され、
  `{@label}`/`{@length}` は展開され、numberは既存の最大3桁formatで
  `12.346` になる)。
* Inspectorの宣言セクションは4行それぞれの型・宣言(`const`)・生の初期化式
  を読み取り専用で表示する。
* 文書には **2件の依存エラー** が出る(これはbugではなく仕様どおり):
  `point B = coordinate(x: @length ...)` が `length はこの要素内に存在し
  ません` というエラーになり、`line AB` もB経由で連鎖エラーになる。typed
  numberを座標などの一般numeric属性へ直接使う経路は今回のopt-inプロパティ
  表に含まれておらず(`text.text`/`offsetLine.side`等の指定propertyのみ)、
  意図的に未対応。エラーメッセージと発生行を確認し、「bugではなく既知の
  未対応経路」であることを確認する。これらは一般ジオメトリ評価エラーなので
  Problems には集約されず、`✓` は正常である(気づいた点欄に記録するのは
  構わないが、fail扱いにはしない)。

## シナリオ 2: レキシカルスコープ / shadow(正常系)

**fixture**: `nui3-scope-shadow.nui`

**手順**

1. fixtureを開く。`group Scope` の中の宣言順(`usesOuterBeforeShadow` →
   `const outer: number = 20` → `usesInnerAfterShadow`)を確認する。
2. Canvas上のtext要素 `Inside` と `Outside` を確認する。
3. `group Scope` 内の `outer`(2つ目、value=20)を選択し、外側の
   `const outer: number = 10` とは別のbinding ID・別の宣言行として
   Inspectorに表示されることを確認する。

**期待結果**

* `Inside` は `before=10 after=20` と描画される(グループ内で `outer` が
  宣言される前は外側の10を参照し、宣言後は内側の20へshadowする)。
* `Outside` は `outer=10` と描画される(グループ内側の宣言はグループの
  外へ漏れない)。
* 診断エラーは0件。
* Inspectorで2つの `outer` がそれぞれ独立したbinding(別ID、別行)として
  区別して表示される。

## シナリオ 3: self-initialization / forward-reference 診断

**fixture**: `nui3-scope-diagnostics.nui`

**手順**

1. fixtureを開く(中身: `const selfRef: number = @selfRef` /
   `const usesLater: number = @later` / `const later: number = 5`)。
2. Source Editor ヘッダー右端の警告三角＋`2`の Problems ボタンをクリックして
   一覧を開く。
3. 1件目の診断をクリックし、Source Editorのcursor/選択がジャンプする位置
   を確認する。2件目も同様に確認する。

**期待結果**

* 診断が **正確に2件** 表示される(3件目以降が出ないこと=想定外の診断が
  ないこと):
  1. `code: self-initialization`、対象 `selfRef`、2行目・列25付近
     (`@selfRef` の occurrence)。メッセージ:
     「"selfRef" は自身の初期化式内で自分自身を参照していますが、外側に
     同名のbindingがありません。」
  2. `code: forward-binding-reference`、対象 `later`、3行目・列27付近
     (`@later` の occurrence)。メッセージ:
     「"later" はこの位置より後で宣言されているため、まだ参照できません。」
* この文書は**それでもコンパイルは成功する**(この2件は
  `bindingIssueDiagnostics` — 表示専用・非gating — であり、文書全体を
  fatalにはしない)。Canvasにgeometryは存在しない(このfixtureは
  typed宣言のみ)。
* 診断クリックでSource Editorのcursorが該当token(`@selfRef`
  / `@later`)へジャンプすること。

## シナリオ 4: 補完(completion)

**fixture**: `nui3-declarations-templates.nui` と `nui3-standard-properties.nui`

**手順**

1. `nui3-declarations-templates.nui` の末尾に新しい行を追加し、
   `const x: number = @` まで入力してカーソルを止める
   (自動候補が出ない場合は `Ctrl-Space` / macOSでは `Alt-` ` か `Alt-i`)。
2. 候補一覧に `length`(最内側で有効なbinding)が1件だけ出て、
   同名重複が無いことを確認する。
3. `nui3-standard-properties.nui` を開き、`offset(... side: ` の直後に
   カーソルを置いて補完を呼び出し、`side`(choice)の候補が
   `right`/`left`(宣言順)で出ることを確認する。
4. `text T = label(text: "{@` まで入力し、template hole内の補完で
   string/number bindingが候補に出ることを確認する。
5. set target補完: `nui3-control-mutation.nui` を開き、既存の `set total = `
   の行を複製して `set ` まで入力し、候補に有効な `let`(`flag`/`total`/
   `show`)が出て `if`/`for` block外の `const` が出ないことを確認する。
6. invalid-let recovery補完: 一時的に
   `let broken: number = @broken` (self-initialization相当)を追加し、
   `set b` まで入力して `broken` が回復候補として出ることを確認する
   (追加した行は確認後に元に戻す)。

**期待結果**

* 各文脈で候補が「最内側の1件だけ」「invalid binding除外」
  「choiceは宣言順」というplan.mdの規約どおりに出る。
* set target補完はvisibleな `let` とinvalid `let`回復候補だけを出し、
  `const` を出さない。

## シナリオ 5: text template

**fixture**: `nui3-declarations-templates.nui`(シナリオ1で確認済みの内容
を再利用)

**手順**

1. `Label`/`Bare` の描画内容を再確認する(シナリオ1と同じ実測値)。
2. `text: "\{draft\}..."` の `\{`/`\}` をSource Editorで選択し、
   escapeとして構文highlightされることを確認する。

**期待結果**

* シナリオ1と同じ: `Label` → `{draft} 前身頃 12.346`(改行あり)、
  `Bare` → `前身頃`。
* `\{`/`\}` はliteral braceとして描画され、展開対象にならない。

## シナリオ 6: set / branch(if) / loop(forGroup)

**fixture**: `nui3-control-mutation.nui`

**手順**

1. fixtureを開く。`if Branch (@flag)` は `flag=true` なのでthen節が
   activeであることを確認する。
2. `text Then` と `text Final` の描画内容を確認する。
3. `for Loop (... showGenerated: @show)` で `show=false` の場合、
   ループ内の `text T` と `line Copy` の生成行がCanvasに描画されない
   ことを確認する。
4. `show` の宣言を `let show: boolean = true` に変更して保存し、
   生成行(2件、`i=0,1`)がCanvasに現れることを確認する。

**期待結果**

* `Then` は `3`(`total` 初期値0 → if節で `+3`)。
* `Else` 節は非activeで評価されない(staticな型検査のみ)。
* `Final` は `5`(3 → ループ2回分の `+1` が持ち越されて反映)。
* `show=false` の間はループが**実行はされる**(`total` は加算され続ける)
  が、生成行はCanvasに描画されない。`show=true` にすると生成行が見える
  ようになる(activityとは独立した表示制御)。

## シナリオ 7: runtime diagnostics + source navigation

**fixture**: `nui3-poison-recovery-limit.nui`(および必要ならシナリオ3の
`nui3-scope-diagnostics.nui` を再利用)

**手順**

1. fixtureを開く。`set value = 1 / 0` の後 `set value = 4` で回復する
   流れと、`set mirror = @value` が poison中の値を捕まえる流れを確認する。
2. `text Recovered`/`text Poisoned`/`text AfterStop` の描画を確認する。
3. Source Editor ヘッダー右端の警告三角＋件数の Problems ボタンをクリックし、
   `Poisoned` に対する runtime エラーをクリックして、Source Editorの該当箇所
   へジャンプすることを確認する。
4. Inspectorで `value` と `mirror` のbindingをそれぞれ選択し、
   runtimeセクションのstatus(ok/poisoned)を確認する。

**期待結果**

* `Recovered` → `4`(poisonからの回復後の最終値)。
* `Poisoned` はテキスト評価エラーになる(描画されない/エラーマーカー
  表示)。エラーメッセージ: 「Poisoned のテキストを評価できません。
  テキスト埋め込みに紐づく変数の評価に失敗しました
  (evaluation-divide-by-zero)。」
* `AfterStop` は `@stop` より後なので評価対象外(描画されない)。
* Inspector: `value` は最終status `ok`・値 `4`。`mirror` は
  status `poisoned`(issueCode `evaluation-divide-by-zero`)。
* 診断クリックでSource Editorが該当行へジャンプする。

## シナリオ 8: Inspector(宣言メタデータ + runtime値 + 既存literal regression)

**fixture**: シナリオ1〜7の任意のfixture、加えて既存の `nui 2` 文書
(または新規文書)で通常のnumeric literalパラメータ編集を1件確認する。

**手順**

1. `nui3-declarations-templates.nui` の `const length` を選択し、
   宣言セクション(kind/type/生の初期化式/binding ID)を確認する。
2. `nui3-poison-recovery-limit.nui` の `value`/`mirror` を選択し、
   runtimeセクション(最終値/status/poison/recovery)を確認する
   (シナリオ7の期待結果と一致すること)。
3. 既存の `point`/`line` 要素(nui 2 でも nui 3 でも可)を1件選択し、
   従来どおりのliteral parameter(x/y/color等)がInspectorに表示され、
   編集導線(Source Editor value span jump)が壊れていないことを確認する。

**期待結果**

* typed宣言のInspector行は読み取り専用(編集フォームが出ない)。
* runtimeセクションはシナリオ7で確認した最終値と一致する。
* 既存のliteral parameter Inspector表示・編集導線に regression がない。

## シナリオ 9: Alt step(`Alt+←/→`)

**fixture**: `nui3-declarations-templates.nui`、`nui3-standard-properties.nui`

**手順**

1. `const length: number = 12.3456` の値の上にcursorを置き、
   `Alt+→`/`Alt+←` を押して数値が既存stepで増減することを確認する
   (numberは従来のstep挙動を維持)。
2. `const printed: boolean = true` の値の上で `Alt+→` を押し、
   `true`⇄`false` にtoggleすることを確認する。
3. `nui3-standard-properties.nui` の `const side: choice(right, left) = left`
   の値の上で `Alt+→`/`Alt+←` を押し、`right`/`left` を宣言順で
   wrapすることを確認する。
4. `const label: string = "前身頃"` の値(string literal全体)と、
   `@length` のようなbinding参照全体の上で `Alt+→` を押し、
   **何も変化しないこと**(no-op)を確認する。

**期待結果**

* number: 既存step挙動を維持。
* boolean: 両方向toggle。
* choice: 宣言/property metadata順でwrap。
* string全体・binding参照全体: no-op(誤ってstepしない)。

## シナリオ 10: rename

**fixture**: `nui3-rename-target.nui`

**手順**

1. fixtureを開く。`let 表示ラベル: string = "初期値"` の**宣言名**の上に
   cursorを置き、`F2` を押す。ダイアログで新しい名前(例: `表示テキスト`)
   を入力してEnterで確定する。
2. Undo(`Cmd+Z`)で元に戻す。今度は `text Display` の
   `{@表示ラベル}` occurrence(**参照位置**)にcursorを置き、`F2` を押して
   同じ新名を入力・確定する。
3. Undo(`Cmd+Z`)で元に戻す。今度は `set 表示ラベル = "更新後"` の
   **target名**(`表示ラベル`の部分)にcursorを置き、`F2` を押して同じ
   新名を入力・確定する。
4. 3の結果を保持したまま、CAD要素(`point`/`line`等)を1件Canvasで選択し、
   `F2` を押す(typed binding位置にcursorが無い状態でのCAD要素renameが
   従来どおり動くことの確認)。

**期待結果**

* 手順1〜3のいずれの位置からF2を押しても、同じ結果になる: 宣言
  (`let 表示ラベル` → `let 表示テキスト`)、template hole
  (`{@表示ラベル}` → `{@表示テキスト}`)、`set` target
  (`set 表示ラベル =` → `set 表示テキスト =`)の**3箇所すべて**が1回の
  Undoで書き換わる。
* ダイアログのタイトルは「変数の名前を変更」で、要素renameダイアログ
  (「選択要素の名前を変更」)とは見た目上区別できる。
* 手順4: CAD要素のF2 renameは従来どおり(要素rename dialogが開く)動作し、
  typed rename dialogは開かない。

## シナリオ 11: activity UI(`state:`, gutter/context menu/ribbon)

**fixture**: `nui3-activity-print.nui`

**手順**

1. fixtureを開く。`group Visible`(state省略)、`group Hidden`
   (`state: hidden`)、`group Disabled`(`state: disabled`)の3グループの
   Canvas表示・gutterアイコンを確認する。
2. `group Visible` の行のgutterをクリックし、
   visible→hidden→disabled→visible の順でcycleすることを確認する。
3. 同じ操作をcontext menuと(存在する場合)ribbonから直接指定で行う。
4. 複数選択して同じcommandが適用されること、1操作が1 Undoであることを
   確認する。

**期待結果**

* 初期状態: `Visible`グループの点`A`は表示され評価される。`Hidden`
  グループの点`B`は評価されるが描画されない(evaluatedだがvisibleでない)。
  `Disabled`グループの点`C`は評価も描画もされない(実測: `effectiveVisible`
  に含まれず、`effectiveEnabled`にも含まれない)。
* gutterクリックがvisible→hidden→disabled→visibleの順でcycleする。
* 既定のshortcutは無い(`V`等への自動割当は無い)。
* 複数選択+直接指定が1 Undoで適用される。

## シナリオ 12: nui 3 save → close → reopen

**fixture**: `nui3-control-mutation.nui`(他のfixtureでも可)

**手順**

1. fixtureを開き、保存する(変更を加えず)。
2. アプリを終了して再起動し、同じファイルを開く。
3. Source Editorの内容(comment/空行があれば含め)がbyte単位で不変か、
   意味的に同一かを確認する。
4. 1文字だけ変更してから保存し、再度閉じて開き、変更が保持されている
   ことを確認する。
5. `Then`/`Final` の描画値がシナリオ6と同じであることを確認する。

**期待結果**

* 未編集保存はsource不変(normalizeされない)。
* 直接編集後の保存・再読込で内容が保持され、評価結果もシナリオ6と一致する。

## シナリオ 13: print / print preview

**fixture**: `nui3-activity-print.nui`

**手順**

1. fixtureを開く。Canvas下部の「印刷」ボタン(`.canvas-display-controls`
   の印刷プレビュー切り替え)をクリックする、またはコマンドパレットで
   "print"/"印刷" を検索して `openPrintLayout`/`togglePrintPreviewWindow`
   を実行する。
2. `group Visible`(`printEnabled: true`)と `group NotPrinted`
   (`printEnabled: false`、`@printHidden`)の印刷への出現/非出現を確認する。
3. `group Disabled`(`state: disabled` かつ `printEnabled: true`)を確認する。

**期待結果**

* `Visible`グループは印刷に含まれる(printEnabled trueかつ評価される)。
* `NotPrinted`グループは印刷から除外される(printEnabled false)。
* `Disabled`グループはprintEnabledがtrueでも、disabled activityにより
  そもそも評価されないため、印刷にも何も描画されない
  (printEnabledはactivityとは独立した軸だが、評価されない要素には
  描画するgeometryが存在しない)。

## シナリオ 14: 1000要素文書の体感(typing/completion/pan/Inspector)

**fixture**: `nui3-1000-feel.nui`(既存の1000点生成器の出力に `nui 3` 
ヘッダーと `const offsetY`/`let counter`/`text Summary` の typed prelude、
および `point P0` の `y` を `@offsetY` に束縛したものを追加。詳細はfixture
冒頭を参照。)

**手順**

1. fixtureを開く。
2. 端から端まで素早くpanする。
3. `const offsetY`/`let counter` の行付近で入力・補完を試す
   (`Ctrl-Space` / `Alt-` `/`Alt-i`)。
4. 文書中の任意の点(例: `P500`)をInspectorで選択する。
5. Task 50が記録した既存のbinding analysis/TS reference/forGroup
   performanceのbaseline(`docs/typed-variables/README.md` のTask 36/37/39
   performance recordセクション参照)と比べて、体感で引っかかりが無いかを
   確認する(新しい閾値を作らず、既存記録と比較する体感確認のみ)。

**期待結果**

* pan・typing・completionが数秒固まるようなlong taskを伴わない。
* Inspectorの選択・表示が即座に反映される。
* 体感が既存のperformance record(Task 36/37/39)と大きく乖離しない。

## 記録表

| # | シナリオ | 結果(Rust-first) | 結果(parity) | 気づいた点 |
|---|---|---|---|---|
| 1 | typed declaration(4型) | 未実施 | 未実施 | |
| 2 | レキシカルスコープ/shadow(正常系) | 未実施 | 未実施 | |
| 3 | self-init/forward-reference診断 | 未実施 | 未実施 | |
| 4 | 補完(completion) | 未実施 | 未実施 | |
| 5 | text template | 未実施 | 未実施 | |
| 6 | set/branch(if)/loop(forGroup) | 未実施 | 未実施 | |
| 7 | runtime diagnostics + source navigation | 未実施 | 未実施 | |
| 8 | Inspector(宣言+runtime+既存literal regression) | 未実施 | 未実施 | |
| 9 | Alt step | 未実施 | 未実施 | |
| 10 | rename | 未実施 | 未実施 | |
| 11 | activity UI | 未実施 | 未実施 | |
| 12 | nui 3 save→close→reopen | 未実施 | 未実施 | |
| 13 | print/print preview | 未実施 | 未実施 | |
| 14 | 1000要素文書の体感 | 未実施 | 未実施 | |

各セルは `pass` / `fail` / (ユーザー承認済みの理由付き)`N/A` のいずれかを
ユーザーが記入する。fail行はTask 51の完了条件(全項目pass)を満たすまで、
同じセッション内で再現→focused fix→regression test→再確認のサイクルを回す。
