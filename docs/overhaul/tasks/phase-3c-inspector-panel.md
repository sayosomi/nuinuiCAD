# Phase 3c: 読み取り専用InspectorPanel

> 親文書: [phase-3-inspector.md](phase-3-inspector.md)。
> 着手前に `docs/overhaul/plan.md` →
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md) →
> [phase-3a-value-span-jump-api.md](phase-3a-value-span-jump-api.md) →
> 本文書の順で読むこと。AGENTS.md の規則に従うこと。
> 3a完了後に着手。3b(数値ステップ)とは並行実装可(変更ファイルが交差しない)。
>
> **3d最終仕様**: 本文書のfocus handle・行ナビ・旧command委譲は
> 3cの一時的な着地状態。3dでInspectorはマウス専用となり、行クリック、
> 行内pickボタン、RightPanel表示のみが残る。現行仕様は3d文書を正とする。

## Context

右ペインは現在 `RightPanel.tsx` = `ElementEditor`(フォーム編集)+
`ExpressionInsertTray` + `ElementInfoPanel`(読み取り専用の計測・依存表示)+
ショートカットヒントの構成。Phase 3の最終形はフォーム編集の全廃だが、
一括で行うとキーボードファースト不変条件が途中で壊れる。そこで本タスクは
**読み取り専用インスペクタを完成させて旧編集UIと一時併存**で着地し、
削除・cutoverは3dへ分離する。

## 目的

`ElementInfoPanel.tsx` を核に `InspectorPanel.tsx` を新設し、RightPanel内の
表示系(ElementInfoPanel)を置き換える。パラメータ一覧行からEnterで
Source Editorの該当値spanへジャンプできる(3aのAPI)。矢印キーで行ナビゲート、
Escでエディタ/キャンバスへ復帰。**インスペクタは読み取り専用**で、文書を
変更するUIを一切持たない。

## 開始時点の前提

* 3a完了: `SourceEditorHandle.jumpToParameterValue(elementId, parameterKey)` と
  `jumpToElement(elementId)` が利用可能。
* 選択状態は `cadUiStore`。依存関係は `src/model/dependencies.ts`
  (`createDependencyIndex` / `getDependencySummary` /
  `getDependencyJumpTargets`)。計測・座標表示は
  `src/components/geometryDisplay.ts` の `*InfoRows` 群。
* パラメータ定義は未縮小の `parameterDefinitions.ts`
  (`getParameterDefinitions` + `getParameterValue`)を読み取り専用で使う。
* 旧 `ElementEditor` / パラメータ編集モードはこのタスク中は現状のまま動き続ける。

## dependency jump移行方針(3cで確定)

* Inspector navigationの正は、InspectorPanelが保持する **`activeRowKey`** とする。
  dependency jumpとparameter navigationで別々の行ナビ状態機械は作らない。
* `selectedDependencyJumpIndex` はInspector navigationの正ではない。ただし3c中に
  旧dependency jump経路が参照する間は互換入口として残し、削除しない。
* 旧command ID (`enterDependencyJumpMode` / 次・前・Enter / Escape) は、Inspectorが
  focus中なら単一のInspector handleへ委譲する。Inspector外では3c互換の旧経路を
  保持する。
* 3dで旧dependency jump経路の参照を全数確認し、不要になった時点で
  `selectedDependencyJumpIndex`、専用配管、専用テストを完全削除する。

## 変更対象ファイル

* 新規 `src/components/InspectorPanel.tsx`(+ `InspectorPanel.test.tsx`)。
* `src/components/RightPanel.tsx` — `ElementInfoPanel` の位置に
  `InspectorPanel` を差し込む(ElementEditor/ExpressionInsertTrayは触らない)。
* `src/components/ElementInfoPanel.tsx` — InspectorPanelへ吸収する場合は
  参照を置換して削除してよい(表示ロジックの二重化を残さない)。
* `src/state/cadUiStore.ts` — `selectedDependencyJumpIndex` は旧経路の互換stateとして
  残す。Inspectorのactive rowをここへ重複保持しない。
* `src/commands/` / `src/keyboard/` — インスペクタ行ナビ・Enterジャンプ・
  Esc復帰をコマンドとして登録(既存 `dependencyJump` scopeとの関係は
  下記確認事項)。
* `src/components/AppLayout.tsx` — props配線(handle受け渡し)。
* `src/styles.css` — インスペクタ行のfocus/選択スタイル。

## 実装手順

1. **セクション構成**: InspectorPanelに以下を実装する。
   1. 名前・種別・状態バッジ(エラー/警告・無効・非表示・ロック)。状態判定は
      Source Editorのstate railと同じ意味論に合わせる(下記確認事項参照。
      判定ロジックを重複実装せず、共有できるpure判定に寄せる)。
   2. 計測値: `geometryDisplay.ts` の `*InfoRows` を再利用(現行
      ElementInfoPanelと同じ)。
   3. 当該要素の診断: `evaluation.errors` / `evaluation.warnings` の該当分+
      storeのパース診断のうち該当行のもの。
   4. 依存関係: 上流(親)・下流(子)の双方向。欠落・未解決は種別を明示
      (AGENTS.mdルール)。各行のクリック/Enterは `selectElement` +
      `jumpToElement` で該当行へ移動。
   5. パラメータ一覧: `getParameterDefinitions` の順にラベル+現在値
      (+式のときは式テキスト)。読み取り専用。行のEnter/クリックで
      `jumpToParameterValue(elementId, definition.key)`。
2. **キーボードナビ**: 新しいshortcutは作らず、既存
   `enterParameterEditMode` / `enterDependencyJumpMode` をInspectorへの入口として
   再利用する。インスペクタにフォーカスがある間、`↑`/`↓` で行移動、
   `Enter` でその行のジャンプ、`Esc` でSource Editor(またはキャンバス)へ
   復帰。行の正はローカル`activeRowKey`、Inspector focus判定はhandleの単一境界と
   し、各commandがDOM queryを重複してはならない。旧パラメータ編集モードの
   「キーボードでパラメータへ到達する」役割を代替するのが狙い。
   * `e` / normal `Enter` はparameter行の先頭へ、`j` はjump可能なdependency行の
     先頭へフォーカスを移す。Inspector内でも`e`/`j`で両区分を切り替えられる。
   * **parameter行のEnter**は`jumpToParameterValue`を呼び、値spanを全選択して
     Source EditorへDOM focusをhandoffする。続くタイプ入力はDSL編集になる。
   * **dependency行のEnter**は対象要素を選択し、Source Editorの対象statement行へ
     cursorだけを移す。**DOM focusはInspectorに維持**するため、続けて`↑`/`↓`で
     dependency行を巡回できる。この非対称性は意図した仕様である。
   * `Esc`はInspectorに入る直前のSource EditorまたはCanvasへ戻る。`↑`/`↓`は端で
     clampし、active rowが要素変更やdynamic parameter/依存行の増減で消えた場合は
     同じ区分の先頭へ決定論的にfallbackする。
3. **RightPanel差し替え**: `ElementInfoPanel` 使用箇所をInspectorPanelへ。
   ElementEditor/ExpressionInsertTray/ショートカットヒントは現状維持。
4. **ジャンプ動作**: パラメータ行Enter→エディタへフォーカスが移り該当値spanが
   全選択→そのままタイプすれば値を置換できる、をE2E的テストで固定する。
   IME composition中のEnterはジャンプしない(3a側guardに乗る)。

## 公開API・型

* `InspectorPanel` のprops(`element` / `elements` / `evaluation` /
  editor handle等。CM型を含まないこと — handleは
  `SourceEditorHandle` 型のみ)。
* インスペクタナビ用のcommand ID(行移動・ジャンプ・復帰。命名は実装時確定、
  registryが割当の正)。

## 状態とデータフロー

* 読み取り: `cadDocumentStore`(elements・diagnostics)、evaluation
  (AppLayoutから渡る現行のprops経路)、`cadUiStore`(要素選択・旧dependency jump互換state)。
* 書き込み: 要素選択と、InspectorPanelローカルの`activeRowKey`、handle経由のジャンプ
  (selection-only)のみ。`selectedParameterKey` / `selectedDependencyJumpIndex`を
  Inspector navigationの正として書き換えない。**文書(sourceText)には一切書かない。**
* ジャンプはdirty bufferでも3aの規則で現在CMテキスト基準に解決される。

## 守るべき不変条件

全Phase 3子タスク共通:

* `sourceText` が唯一の文書上の正。
* CodeMirror型・importを `src/editor/` と `SourceEditorPane.tsx` の外へ
  漏らさない(InspectorはhandleのAPIだけを呼ぶ)。
* selection-only操作はUndo履歴へ追加しない。
* dirty bufferでは現在のCMテキストを基準にする。
* IME composition中にjump・patch・数値変更を実行しない。
* `dslLineValueSpans` 系が「編集可能な値」の唯一の定義。**Inspector専用の
  値span解析を作らない**(Inspectorはspanを一切parseしない。ジャンプ先の
  解決はすべてhandleの中)。
* main editorと旧選択行投影で意味論を重複実装しない。
* Phase 4に触れない。Phase 5を先取りしない。

本タスク固有:

* インスペクタは読み取り専用。インライン入力欄を追加しない。
* 100要素超の文書でも成立するUI(スクロール・検索性・キーボード到達性)。
  巨大な静的リストで参照を選ばせない(AGENTS.md)。
* 旧ElementEditor系の挙動を変えない(併存のまま)。
* SourceEditorControllerからAppLayout固有のInspector handleへ逆向きの配線は追加しない。
  Editorはregistry経由のcommand発火までに留め、focus処理はAppLayout側に閉じる。

## 必須自動テスト

* パラメータ行→Enter→該当値spanが全選択されエディタにフォーカスが移ること
  (数値・式・参照・選択肢・色・真偽の各種別で)。
* 行ナビゲーション(↑↓・端の挙動)・Esc復帰。
* dependency行EnterがSource Editorのcursorを移してもInspector DOM focusを保持し、
  続く↑↓でdependency行を巡回できること。parameter行Enterは対照的にSource Editorへ
  focus handoffすること。
* Inspectorへのfocus移動直後のEnterが旧フォーム編集・pick開始へfallthroughしないこと。
* 依存関係行のジャンプと種別表示(欠落・未解決・エラー保持)。
* 状態バッジがエラー/無効/非表示/ロックを正しく反映。
* インスペクタ内に `input` / `textarea` / `select` /
  `contenteditable` が存在しないこと(読み取り専用の構造的保証)。
* 要素未選択・評価失敗(last-good)・fatal文書時に安全に表示されること。

## 手動確認

* macOS実機: 要素選択→(インスペクタへフォーカス)→行ナビ→Enter→タイプで
  値置換→commit、がマウスなしで完結する。
* 日本語IMEでの値置換(ジャンプ後の全選択に対する変換入力)が正常。
* 3桁要素数の文書でインスペクタがスクロール・応答とも実用的。

## 明示的な対象外

* ElementEditor・*ElementFields・ParameterEditors・ExpressionInsertTrayの
  削除(3d)。
* `parameterDefinitions.ts` の縮小・`directKey` 削除(3d)。
* パラメータ編集モード(`parameter` scope)の変更・削除(3d)。
* 数値ステップコマンド(3b)。
* pick開始経路の再設計(3dの確認事項。本タスクでは触らない)。

## 完了条件

* `npm test` / `npm run build` / `npm run lint` 成功。
* InspectorPanelがRightPanel内で動作し、ジャンプループ
  (選択→行→Enter→編集→commit)が成立。
* 旧編集UIが無傷で併存(挙動不変)。

## 確認事項(実装時に確定して報告)

* **状態バッジの判定共有**: state railの `IndexedLineStatus`
  (`src/editor/sourceEditorEvaluationIndex.ts`)は要素状態のpure判定を
  含むがeditor配下にある。CM型は含まないため、(a) 判定部分を
  `src/model/` のpure helperへ抽出して両者が使う、(b) Inspector側で
  elements+evaluationから同等判定を実装する、のどちらかを選ぶ。(a)を推奨
  (意味論の重複実装禁止)が、editor側リファクタは最小に留めること。
* **dependencyJump modeとの関係**: 上記移行方針どおり、旧IDはInspector handleへ
  委譲する互換入口とし、`selectedDependencyJumpIndex` の削除は3dへ送る。
* Inspectorへのフォーカス移動は新規Mod+Alt+Iを追加せず、既存
  `enterParameterEditMode`(`e` / normal `Enter`)と`enterDependencyJumpMode`(`j`)を
  再利用する。

## 次タスクへの引き継ぎ

* 3dはRightPanelからElementEditor/ExpressionInsertTrayを外し、InspectorPanel
  構成のみへ書き換える。本タスクで残した併存UI・stateの一覧を報告に含め、
  3dの削除対象の照合に使えるようにすること。
* 3dは旧dependency jump経路を全数監査し、参照が消えた時点で
  `selectedDependencyJumpIndex` と専用配管・テストを削除すること。
