# Phase 4d: コマンドラインへのピック・名前タイプ充填ルーティング

> 親文書: [phase-4-command-line.md](phase-4-command-line.md)。着手前に
> `AGENTS.md` → `docs/overhaul/plan.md` → 親文書 → 4a-1〜4c文書 →
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md)
> の順で読むこと。
>
> **注意**: 本タスクはInspector・Source Editor・長行レンズ・テンプレート挿入が
> 共有するpick受理経路に触れる、Phase 4で最も回帰リスクの高いタスクである。
> 既存経路の挙動を1つも変えないこと。

## Context

参照ステップ(point / endpoint / line / lineList)と数値参照ピックを
セッションへ接続する。pick基盤は直近の拡張で「仮想target ID+
`insertionIndex`」をサポート済み(テンプレート挿入が使用中)。コマンド
ラインも**同じ機構の2番目の利用者**になる。候補生成(`pickCandidates`)と
受理判定(`applyPickedPoint/Line/NumericReference`)の別実装を作らない。

## Goal

参照ステップを含むレシピ(`line` / `arcLine` / `offsetLine` 等4a-1の
専用レシピ全部+汎用フォールバック。4a-2完了済みならその追加分も)が
Canvasクリック・キーボードピックカーソル・名前タイプ+補完・
「Enter=選択中を採用」のすべてで充填でき、paletteに解放される。

## Scope

* 仮想target定数(例 `COMMAND_LINE_PICK_TARGET_ID = "__command-line__"`)を
  新設。セッションが参照ステップに進入したら、ステップkindに応じて
  `activePointPickTarget` / `activeLinePickTarget` /
  `activeNumericReferencePickTarget` を
  `{elementId: 仮想ID, parameterKey: ステップkey, insertionIndex}` で設定する
  (テンプレート挿入の `setPickTargetForTemplateInput` と同型)。
* 受理側の横取り: `applyPickedPoint` / `applyPickedLine` /
  `applyPickedNumericReference` / `finishLinePick` の冒頭に、テンプレート
  (`applyTemplatePickedPoint` 等)と同列のコマンドライン分岐を追加し、
  受理値を `fillCurrentStep` へ渡して**文書コミットを行わない**。充填後は
  次ステップへ進み、次も参照ステップなら対応するpick targetを張り替える。
  参照ステップ完了時はpick targetをクリアする。
* lineListステップ: 既存のdraft方式(`draftLineIds`+Mod+Enterの
  `finishLinePick`)をそのまま使い、finish横取りでdraft配列をセッション引数へ
  渡す。draft中の文書は不変(既存不変条件の維持)。
* **複数pick中のDOM inert導出の拡張**: `AppLayout` の `isMultiLinePicking`
  は現在「pick targetの要素が文書に存在し、その定義が
  `lineReferenceList`」で導出しており、文書に存在しない仮想targetでは
  真にならない。コマンドラインのlineListステップ中も同じinert挙動
  (Canvas外領域の無効化)になるよう導出を拡張する。ただし
  **CommandLineBarはinert領域に含めない**(バーはセッションの操作面で
  あり、pick中も入力・キャンセル可能であること)。
* numberステップ中の数値参照ピック(任意開始): バーから既存
  `startNumericReferencePick` 系を仮想target+insertionIndexで開始できる。
  受理は `candidate.property` を確定値とする(既存挙動。上書きしない)。
* 名前タイプ充填: バーの入力欄で参照ステップ中に文字をタイプすると、
  `pickCandidates` の現候補を名前(`elementNames` の修飾名)でフィルタした
  サジェストを出し、Enterで**既存受理経路と同じ関数**を通して充填する
  (candidateの外の要素を名前解決で直接充填しない。大規模文書での
  スケーラブル選択UIの要件)。
* 「Enter=選択中: <名前>」: 現在のCanvas選択要素が候補集合に含まれる場合
  のみ、バーのプロンプトに採用候補として表示し、入力欄が空の状態のEnterで
  採用する。**候補集合外なら表示しない・採用しない**。
* キーボードピックカーソル: 既存の `selectPickCandidateByOffset` /
  `selectPickOptionByOffset` / `applySelectedPickCandidate`(矢印+Enter)が
  仮想targetでもそのまま動くことを確認・不足があれば修正。
* `PickModeStatus` はコマンドラインセッション中は抑制(テンプレート挿入と
  同じ関係。ステータス表示はバーが持つ)。
* **無名要素の除外**: コマンドラインの候補から名前のない要素を除外する
  (昇格(4e)前に参照すると生IDトークンがシリアライズされ再読込で参照切れに
  なるため)。除外はコマンドライン分岐のみに適用し、既存経路の候補は
  変えない。バーに「無名要素は候補外(4eで解放予定)」である旨の説明は
  不要(単に候補に出さない)。
* 参照ステップ入りレシピのpalette解放(暫定command ID追加。4gで吸収)。

## Out of Scope

* 無名要素の自動昇格(4e)。
* ゴーストプレビュー(4f)。
* 既存作成コマンドのcutover(4g)。
* Inspector・Source Editor値span・テンプレート挿入のpick挙動の変更。

## Existing APIs / files to reuse

* `src/model/pickCandidates.ts` — `pickCandidates` /
  `pickSourcePrecedesTarget`(insertionIndex対応済み)。
* `src/commands/pickCommands.ts` — 受理・カーソル移動・draft機構の全部。
* `src/templates/templateInsertionCommands.ts` — 仮想target設定と受理横取りの
  実装見本。
* `src/model/elementNames.ts` — 修飾名(`A.B.C`)解決・表示名。
* `src/components/CanvasOverlay.tsx` / `DrawingCanvas.tsx` — 候補ハイライトと
  ヒットテスト(insertionIndex対応済み。原則無変更で動くはず)。
* `src/state/cadUiStore.ts` — pick target群+`insertionIndex` フィールド。

## Invariants

* **選択中要素の暗黙消費禁止**(本改修の最重要ユーザー要求): 選択は
  「候補として提示+空入力Enterで明示採用」のみ。ピックせず次の入力を
  始めたら選択は一切使われない。
* 候補は文書順で `insertionIndex` より前の要素のみ(既存
  `pickSourcePrecedesTarget` に委譲。独自の順序判定を書かない)。
* draft中(lineList)は文書不変。セッション全体でも、文書コミットは最終
  確定(4cの1回)のみ。
* 既存経路(Inspector pickボタン・Source Editor値span pick・テンプレート
  挿入・計測挿入)の挙動・テストを1つも変えない。
* staleセッション(外部コミット)はpick targetごと明示キャンセル。
* Escはセッションキャンセル(pick状態含む一括クリア)。
* **再入置換とpick状態**(親文書の確定判断): 参照ステップのpick進行中
  (仮想pick target設定済み・lineList draft蓄積中・pickカーソル移動中)に
  別/同一の作成コマンドが発行されたら、4bのセッション開始setterが
  仮想targetのpick状態を含めて全解除してから置換する。旧セッションの
  pick target・draft・カーソルが新セッションに漏れない。draftは文書
  未反映なので破棄してもUndo履歴・文書に影響しない。
* **置換とDOM inert**: lineList draft中の置換では、pick target/draftの
  アトミックなクリアの帰結として**次renderでCanvas外領域のDOM inertが
  必ず解除され、inert領域内(Source Editorペイン・右パネル等)にfocusが
  取り残されない**こと。inertを独立stateとして直接操作して解除する
  実装にしない(導出の一貫性を壊さない)。

## Edge cases

* 参照ステップ→参照ステップの連続(例 `line` レシピの始点→終点)での
  pick target張り替えとpickカーソルのリセット。
* endpointステップ: `lineEndpointReference`(線の端点)を既存の
  endpoint受理経路(`lineEndpointReferenceForPickedAnchor`)で解決する。
* forGroup生成要素のピック(`generatedElementIdForTargetForGroup` の正規化)が
  仮想targetでも既存どおり働くこと。
* 自己参照ガード: 仮想targetは文書に存在しないため既存の自己参照チェックは
  素通りする。挿入予定要素は候補になり得ない(まだ存在しない)ので追加の
  ガードは不要だが、テストで確認する。
* 名前タイプ中の部分一致が0件(サジェスト空)でEnter → 何も充填しない。
* 選択中要素が候補集合外(挿入位置より後・型不適合・無名)→ Enter採用候補と
  して表示されない。

## Tests

* ステップkindごとのルーティング: Canvasクリック相当
  (`applyPickedPoint` 等の直接呼び出し)→ セッション引数充填・文書
  無変更・次ステップ遷移。
* lineList: draft追加/除去→Mod+Enter finish→セッション充填、文書不変。
* numeric: `candidate.property` が確定値になること。
* キーボードピックカーソル(矢印+Enter)での充填。
* 名前タイプ→サジェスト→Enter充填(修飾名含む)。
* **選択が自動消費されないこと**: 選択がある状態でセッション開始→ピック
  せず数値入力や別候補採用→選択要素が引数に現れない。
* 空入力Enterでの選択中採用(候補集合内のときのみ)。
* 無名要素がコマンドライン候補に出ないこと/既存経路の候補には出続けること。
* 再入置換: lineList draft蓄積中に別の作成コマンド→draft・仮想pick
  target・pickカーソルが全解除され、新セッションの最初のステップから
  始まること。文書・Undo履歴不変。
* DOM inert回帰: コマンドラインのlineListステップ進入でCanvas外領域に
  inertが付与され、CommandLineBarには付与されないこと。draft中の
  セッション置換・キャンセル・確定の各経路で次renderにinert属性が残らず、
  inert領域内の要素がfocusを保持していないこと(`document.activeElement`
  レベルのassert)。
* 既存pick経路の回帰スイート無傷(Inspector・テンプレート・計測・
  Source Editor値span pick)。

## Manual verification

* 実アプリで「点Aから角度45°長さ120mmの線」をキーボードのみで:
  palette→line系レシピ→始点(名前タイプ or 矢印ピック or 選択中Enter)→
  数値→数値→名前→確定。マウスクリック経路でも同じ結果になること。
* テンプレート挿入・Inspectorのpickボタンが従来どおり動くこと。

## Completion criteria

* 4a-1の専用レシピ全部+汎用フォールバックがpaletteから完走できる
  (無名要素参照を除く)。
* `npm test` / `npm run build` / `npm run lint` green。既存pickテスト無傷。

## Dependencies

* 4c完了。4a-2・4h・4iと並行可。

## Handoff to next task

* 4eはコマンドライン候補の無名除外を外し、確定時の命名+行パッチを同一
  Undoステップに同梱する。除外を実装した箇所に4e参照のコメントを残すこと。
* 4fはセッション引数が増えるたびに部分要素のプレビューを試みる。充填の
  フック地点(fillCurrentStep呼び出し箇所)を1関数に集約しておくと4fが
  楽になる。
