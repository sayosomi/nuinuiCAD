# Phase 4: コマンドライン作図 + DSL補完(DslPanel削除)

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。
> Phase 3 は完了済み(3d cutoverまで)。本Phaseは Phase 2 の成果物に依存する。
>
> **着手前に必読**: 現在のEditor仕様・再利用API・重複実装禁止リストは
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md)
> を正とする。Inspectorは Phase 3d 完了により**マウス専用**である
> ([phase-3d-form-editor-removal.md](phase-3d-form-editor-removal.md))。
> Phase 3 の責務(Inspector行ナビ・フォーム編集UI)をいかなる形でも復活させない。

> **実装分割(2026-07-14)**: 本Phaseは以下の10タスクへ分割する。本ファイルは
> Phase全体の要件と依存順を定める**親文書**であり、実装時は担当する子タスク
> 文書を正とする。
>
> 1. [phase-4a-1-creation-recipe-core.md](phase-4a-1-creation-recipe-core.md) —
>    レシピ共通基盤(代表6型+フォールバック生成+安定API。アプリ非接続)
> 2. [phase-4a-2-creation-recipe-coverage.md](phase-4a-2-creation-recipe-coverage.md) —
>    全作成経路の棚卸し+残り全型のレシピ充足+旧command ID対応表
>    (4a-1基盤の拡張のみ。4gの前提条件)
> 3. [phase-4b-command-line-session.md](phase-4b-command-line-session.md) —
>    セッション状態機械(純粋遷移+cadUiStore状態。UIなし)
> 4. [phase-4c-command-line-bar.md](phase-4c-command-line-bar.md) —
>    CommandLineBar UI+セッションコマンド+数値/名前ステップ+行スプライス挿入
>    (参照ステップなしレシピのみ解放)
> 5. [phase-4d-command-line-pick-routing.md](phase-4d-command-line-pick-routing.md) —
>    Canvas/キーボードピック・名前タイプ入力のセッション連携
>    (参照ステップありレシピの解放)
> 6. [phase-4e-unnamed-promotion.md](phase-4e-unnamed-promotion.md) —
>    無名要素の自動昇格(命名+同一Undoステップの行パッチ)
> 7. [phase-4f-ghost-preview.md](phase-4f-ghost-preview.md) —
>    セッション中のゴーストプレビュー(previewDocumentChange)
> 8. [phase-4g-creation-cutover.md](phase-4g-creation-cutover.md) —
>    作成コマンドのセッション起動への切替cutover+旧即時挿入経路の削除
> 9. [phase-4h-dsl-autocomplete.md](phase-4h-dsl-autocomplete.md) —
>    エディタ内文脈補完(cmAutocomplete。コマンドラインとは独立)
> 10. [phase-4i-dsl-panel-removal.md](phase-4i-dsl-panel-removal.md) —
>    DslPanel/DslEditor削除(コマンドラインとは独立)
>
> 依存順: **4a-1 → 4b → 4c → 4d → 4e → 4f → 4g**(コマンドライン系直列)。
> **4a-2は4a-1完了後、4b〜4fと並行可**だが4gの前提条件
> (4g依存 = 4e + 4f + 4a-2)。
> **4h と 4i は相互にも他タスクにも独立**で、いつでも並行実装可。
> 4eと4fは変更領域が近い(commandLineSession)ため直列を推奨するが、
> 順序の入替は可。Phase 4完了 = 4g + 4h + 4i の全完了。
> 各子タスクはアプリが完全に動作する状態
> (`npm test` / `npm run build` / `npm run lint` green)で着地する。

## Phase全体の確定判断(2026-07-14、下記の当初スケッチに優先)

* **ピック連携は仮想target方式**: 当初スケッチの
  `{kind: "commandLine", stepIndex}` 判別子は採用しない。テンプレート挿入で
  実証済みの「仮想target ID+`insertionIndex`」機構
  (`cadUiStore` の各pick targetの `insertionIndex`、
  `pickSourcePrecedesTarget` の仮想target対応)をそのまま使う。
  コマンドライン用の仮想ID(例 `__command-line__`)+`parameterKey`=ステップkey
  で既存の `pickCandidates` 候補生成と `applyPickedPoint/Line/NumericReference`
  受理経路を共有し、テンプレート方式と同様に受理側でセッションへ横取り
  ルーティングする。候補生成・受理判定の別実装を作らない。
* **emitは要素モデル+dslSerializer**: レシピの `emit` は手書きのDSL文字列
  組み立てではなく、`createCadElement`+`setParameterValue` で `CadElement` を
  構築し、挿入時に `dslSerializer` で1文シリアライズする。文法の正は
  serializerに一本化する。
* **確定コミットは `commitDocumentChange` ブリッジ経由**: 当初スケッチの
  「`commitText` スプライスを直接書く」は採用しない。`insertionIndex` に
  1要素挿入したelements配列をブリッジへ渡せば、行スプライス・コメント/
  空行保存・1 Undoステップはブリッジの既存保証で成立する(旧作成経路と
  同じ入口。無名昇格の行パッチも同一changeに同梱する)。
* **numericピックは `candidate.property` が確定値**(コミット `a13286c` の
  挙動)。受理時にtargetの `property` で上書きしない。
* **lineReferenceListステップはdraft方式**: pick中は文書不変
  (`draftLineIds`)、Mod+Enterで確定。コマンドラインではdraftを文書へ
  コミットせずセッション引数へ受け渡す(文書コミットは最終確定の1回のみ)。
* **セッションのstale方針**: セッション開始時に文書リビジョンと
  `insertionIndex` を記録し、セッション外由来の文書コミットが起きたら
  セッションを**明示エラーでキャンセル**する(黙って追従・修復しない。
  AGENTS.mdの明示的エラー方針に一致)。
* **挿入位置**: Source Editorのカーソル行が要素文上にあればその文の位置、
  なければ既存の `creationPlacementForEvaluationLimit` による評価区切り
  placementへフォールバック。セッション開始時に確定して以後不変。
* **既存 command ID を維持**: `addFreePoint` 等の作成command IDは4gで
  中身をセッション開始に差し替える(ID・shortcut・palette登録は不変)。
  ユーザーのshortcut設定を壊さない。
* **無名要素のピック候補化は4eまで封鎖**: 昇格実装前に無名要素を参照すると
  生IDトークンがシリアライズされ、再読込で必ず参照切れになる。4dでは
  コマンドライン候補から無名要素を除外し、4eで昇格とセットで解放する。
* **セッション中の作成コマンド再入は「破棄して置換」**(2026-07-14確定):
  セッション中に別の作成shortcut/コマンドが発行されたら、確認ダイアログ
  なしで現在の未確定セッションを破棄し、新しい作成セッションを開始する。
  **同じ**作成shortcutの再実行も、現在セッションをリセットして新規開始する
  (トグルにしない)。置換前に、active pick target群・lineReferenceListの
  pick draft(`draftLineIds`)・保留中のCanvas pointer intent・エディタ
  focus予約(pending focus)を完全に解除してから新セッションを開始する。
  未確定セッションは文書未変更なので、破棄・置換で**Undo履歴を増やさない**。
  IME composition中は開始・置換とも拒否し、既存セッションを維持する
  (既存のflush `"blocked-composition"` ゲートと同じ扱いで、command error
  で通知する)。
* **置換とDOM inertの関係**: 複数pick(lineReferenceList)中は
  `AppLayout` がCanvas外領域(Source Editorペイン・右パネル等)へ実際の
  DOM `inert` 属性を付与している(`isMultiLinePicking` からの導出)。
  これは独立stateとして直接解除する対象では**ない**が、セッション置換が
  旧pick targetとdraftをアトミックに消した結果として、**次renderで
  DOM inertが必ず解除され、inert領域内にfocusが取り残されない**ことを
  4b〜4dと4gの不変条件・回帰テストで保証する。導出条件が偽になる中間
  stateを観測させないこと(4bのアトミックset)が前提。
* **再入shortcutとform入力除外の整合**: 文字入力と衝突するshortcut
  (単キー等)はform入力(バーの入力欄含む)フォーカス中に発火させない
  (既存原則)。**Mod付きなど文字入力と衝突しない作成shortcutは、バー
  入力中でも共通再入経路を通して置換できる**。IME composition中は開始・
  置換とも拒否し、既存セッションを維持する。

## 目的

最短手数の作図フローを2系統実装する:

1. **AutoCAD風コマンドライン**: 作成コマンド発行→必須参照・数値を順に
   プロンプト(Canvasクリック or 名前タイプ+補完)→名前ステップ→Enter確定。
   選択中の要素は「Enterで採用できる候補」としてのみ提示し、勝手に基準に
   しない。
2. **DSL直接タイプ**: エディタ内オートコンプリート(キーワード・参照名・
   属性キー)。

あわせてフローティングDslPanelを削除する(常設エディタが完全に代替)。

## 変更対象(当初スケッチ。上の確定判断と食い違う点は確定判断が正)

* 新規 `src/components/CommandLineBar.tsx` — Canvas下部の常設1行バー。
  表示: 現在コマンド/プロンプト(例 `始点を指定 [クリック / 名前入力 /
  Enter=選択中: BP]`)/補完付き入力/確定済み引数チップ。
* 新規 `src/commands/commandLineSession.ts` — セッション状態機械
  (`cadUiStore` にセッション状態)。Escでキャンセル+ピック状態クリア
  (`clearPickMode`)。
* 新規 `src/commands/creationRecipes.ts` — 要素型ごとの宣言的レシピ:

  ```ts
  type CreationRecipe = {
    type: CadElementType;
    steps: Array<
      | { kind: "point"; key: string; prompt: string; allowCoordinate?: true }
      | { kind: "line"; key: string; prompt: string }
      | { kind: "endpoint"; key: string; prompt: string }
      | { kind: "number"; key: string; prompt: string; default?: string }
      | { kind: "name"; autoSuggest: true }  // Enter=候補採用/タイプ=上書き/スキップ=無名
    >;
    emit: (args) => string; // DSL文1行
  };
  ```

  `parameterDefinitions.ts` の値種別・ラベルと突き合わせるテストを付け、
  乖離を防ぐ。
* `src/commands/pickCommands.ts` + `pickCommandDefinitions.ts` — 既存ピック
  機構の再利用: pick target に `{kind: "commandLine", stepIndex}` 判別子を追加し、
  解決したアンカー/線/数値参照をセッションへルーティング。キーボードピック
  カーソル(`activePickCursor`)はそのまま動くこと。
* `src/commands/creationCommandDefinitions.ts` / `elementCreationCommands.ts` —
  作成コマンドは即時挿入ではなくセッション開始に変更。
  `nameEntryAfterCreation.ts` は削除(名前ステップが代替)。
* 新規 `src/editor/cmAutocomplete.ts` — 文脈補完: 行頭=要素キーワード、
  参照位置=名前空間対応の要素名(`名前.端点` 派生形含む)、属性位置=
  `parameterDefinitions.ts` 由来のキーと `choiceOptions`。
* **挿入位置 = エディタのカーソル行**(=評価順位置)。`commitText` スプライスで
  1 Undoステップ。確定後: 新要素を選択し、カーソルをその行に置く。
* **ゴーストプレビュー**: セッション中、部分文が暫定コンパイル可能なら
  `previewDocumentChange` で表示。不能なら表示しない(偽のデフォルト値で
  コンパイルを通さない)。
* **無名要素の自動昇格**: ピックで無名要素が参照された場合、
  `makeUniqueElementName`(名前空間対応)で命名し、参照行の挿入と同一
  Undoステップでその要素の行もパッチする。
* **削除**: `DslPanel.tsx`(ローカル履歴含む)、`DslEditor.tsx`、DSLパネル系
  コマンド・`cadUiStore` のパネル窓状態。
* レシピは段階投入: 点・線・曲線系を完全実装し、ロングテールは汎用
  `element` フォールバックレシピ(型指定+属性を順に聞く)でカバー。

## 守るべき不変条件

* **選択中要素を暗黙に消費しない**: 候補としての提示+Enter明示採用のみ。
  これは本改修の最重要ユーザー要求。
* キーボードだけで全ステップ完結(名前タイプ+補完、キーボードピック
  カーソル、数値タイプ)。マウス(Canvasクリック)は等価な代替手段。
* 1作成=1 Undoステップ(自動昇格の行パッチも同一ステップに含める)。
* 挿入は行スプライス(コメント・空行・他の行は不変)。
* グローバルショートカットとバーの入力欄の非干渉(フォーム入力除外の原則)。
* Escの挙動が予測可能: セッション中のEscはセッションキャンセルのみ
  (他のモードやダイアログを巻き込まない)。

## Phase開始時点の前提

* Phase 2 完了済み: 常設エディタ・カーソル行・`commitText`・
  `@codemirror/autocomplete` 依存(拡張は未接続)。
* Phase 3 完了済み(3d cutoverまで): `parameterDefinitions.ts` は縮小後の形
  (ラベル・値種別・`stepLevels`・`choiceOptions` が存続)。Inspectorは
  マウス専用で、pick開始ボタン+`parameterPickCommandId` マッピングを持つ。
* pick基盤の直近拡張が完了済み: 仮想target `insertionIndex`
  (テンプレート挿入)、numeric pickの `candidate.property` 確定、
  lineReferenceList draft+Mod+Enter確定、Source Editor値span選択からの
  pick開始(`resolveSourceEditorPickSelection`)。Source Editor/長行レンズ/
  InspectorはこのCanvas pick基盤を共有しており、コマンドラインも同じ基盤に
  乗る(第4の別経路を作らない)。

## 完了条件

* 代表シナリオがキーボードのみ・最短手数で成立:
  「点Aから角度45°長さ120mmの線」= コマンド起動→基点(名前タイプ or
  クリック or Enter採用)→角度タイプ→長さタイプ→名前(Enter=候補/スキップ=
  無名)→確定。
* エディタ内で新規行タイプ時に文脈補完が機能。
* DslPanel系ファイルが削除され、旧「書き出し→適用」フローの参照が残っていない。
* `npm test` / `npm run build` / `npm run lint` 成功。

## 必須テスト

* レシピ状態機械(純粋): 各ステップ遷移・デフォルト採用・スキップ・
  キャンセル・emit行のゴールデンテスト。
* ピックルーティング: Canvasピック/キーボードピック→正しいステップへ充填。
* **選択が自動消費されないこと**の明示テスト(選択がある状態でセッション
  開始→ピックせず次入力→選択は使われない)。
* 無名要素スキップ→後のピックで自動昇格(命名+同一Undoステップ)。
* 補完コンテキスト(行頭・参照位置・属性位置・名前空間内)。
* レシピと `parameterDefinitions.ts` の整合性チェックテスト。
* 挿入位置(カーソル行・グループ内・`@stop` 前後)の行スプライス検証。

## 子タスクへの実行プロンプト(コピーして使う)

共通前置き(全タスク先頭に付ける):

> AGENTS.md → docs/overhaul/plan.md →
> docs/overhaul/tasks/phase-4-command-line.md(親文書)→ 自分のタスク文書の
> 順で読んでから着手すること。タスク文書のOut of Scopeは境界であり、
> 隣のタスクの作業を先取りしない。完了時は完了条件の充足状況・実行した
> チェック・スコープ外の発見(修正せず報告のみ)をハンドバックすること。

| タスク | プロンプト本文 |
| --- | --- |
| 4a-1 | docs/overhaul/tasks/phase-4a-1-creation-recipe-core.md を実装して。純粋モジュールのみでアプリ非接続、挙動変更ゼロで着地し、公開APIを凍結して報告すること。 |
| 4a-2 | docs/overhaul/tasks/phase-4a-2-creation-recipe-coverage.md を実装して。4a-1のAPIは変更禁止(レシピ追加のみ)。旧作成command ID→レシピの全数対応表とその機械検証テストで着地すること。 |
| 4b | docs/overhaul/tasks/phase-4b-command-line-session.md を実装して。状態は誰もセットしない(UI未接続)まま、遷移とstale方針をテストで固定すること。 |
| 4c | docs/overhaul/tasks/phase-4c-command-line-bar.md を実装して。参照ステップなしレシピ(freePoint/variable)のみ解放し、確定はcommitDocumentChangeブリッジ経由で1 Undoにすること。 |
| 4d | docs/overhaul/tasks/phase-4d-command-line-pick-routing.md を実装して。既存pick経路(Inspector/テンプレート/Source Editor)の挙動を1つも変えず、テンプレート挿入と同じ仮想target+insertionIndex方式で横取りすること。選択中要素の暗黙消費禁止が最重要。 |
| 4e | docs/overhaul/tasks/phase-4e-unnamed-promotion.md を実装して。昇格パッチと挿入を1回のcommitDocumentChangeに同梱し、保存→再読込の往復テストまで含めること。 |
| 4f | docs/overhaul/tasks/phase-4f-ghost-preview.md を実装して。previewDocumentChangeのみ使用し、偽のデフォルト値でコンパイルを通さないこと。全終了経路でプレビューが消えることをテストすること。 |
| 4g | docs/overhaul/tasks/phase-4g-creation-cutover.md を実装して。既存command ID・shortcutは不変のまま中身をセッション開始へ差し替え、旧即時挿入経路と暫定IDを削除すること。 |
| 4h | docs/overhaul/tasks/phase-4h-dsl-autocomplete.md を実装して。CM型をsrc/editor/の外へ漏らさず、文脈判定は純粋ヘルパに分離して単体テストすること。 |
| 4i | docs/overhaul/tasks/phase-4i-dsl-panel-removal.md を実装して。削除のみで挙動追加なし。保存済みレイアウト・shortcut設定が残る環境でも壊れないこと。 |

## やってはいけないこと

* 選択中要素の暗黙使用(現行の不満の根源。いかなる「便利化」でも復活させない)。
* 部分文を偽デフォルトで補完してプレビューを無理に出すこと。
* 全26要素型の専用レシピを一度に書こうとすること(点・線・曲線+汎用
  フォールバックで着地し、残りは追補)。
* インスペクタ(Phase 3 の領分)への変更。
* `pickCommands.ts` の既存パラメータ充填経路(インスペクタ経由でない
  ジャンプ編集等)を壊すこと。
