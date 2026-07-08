# Phase 3: 読み取り専用インスペクタ + フォーム型パラメータ編集の廃止

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。
> Phase 4 と相互独立(並行実装可)。ともに Phase 2 に依存。

## 目的

右ペインを読み取り専用インスペクタに再構築する。「見るのは右ペイン、書くのは
DSL」: パラメータ項目を選ぶとエディタの該当行・該当属性へカーソルジャンプする。
フォーム型のパラメータ編集UI(ElementEditor と *ElementFields 群)と
パラメータ編集モードの値編集を廃止する。

## 変更対象

* 新規 `src/components/InspectorPanel.tsx` — 既存 `ElementInfoPanel.tsx` を核に
  拡張。セクション:
  1. 名前 / 種別 / 状態バッジ(エラー・無効・非表示。既存 `ElementStatusIcon`
     セマンティクス)
  2. 計測値(線長 `lineMeasurements`、座標等 `computedGeometry` 由来)
  3. 当該要素の診断(評価エラー・警告・パース診断)
  4. 依存関係(`src/model/dependencies.ts`、上流・下流の双方向。各行で
     対象要素の行へジャンプ)
  5. パラメータ一覧(ラベル+現在値+式。読み取り専用)
  * 矢印キーで行ナビゲート、Enterでジャンプ(旧パラメータ編集モードの
    「キーボードでパラメータへ到達する」役割を代替)。
* **パラメータ→カーソルジャンプ**: Phase 0 の属性スパン
  (`DslAttribute.valueStart/valueEnd`)+ `statementMap` → SourceEditorPane の
  ジャンプAPI(CM `dispatch({selection})` + フォーカス)。アダプタ層の
  公開APIとして追加し、CM型は漏らさない。
* **数値微調整の代替**: エディタネイティブの数値トークンステップコマンド
  (`Alt+↑/↓`: カーソル下の数値トークンを `parameterDefinitions.ts` の
  `stepLevels` に従って増減し、1コミット=1 Undoステップ)。
* `src/components/RightPanel.tsx` — InspectorPanel 構成へ書き換え。
* `src/parameters/parameterDefinitions.ts` — 縮小: ラベル・値種別・
  `stepLevels`・`choiceOptions` を残し、`directKey` と編集モード配管を削除。
* `src/commands/parameterCommands.ts` — 値編集コマンドを削除。パラメータ
  ナビゲーションコマンドはインスペクタ行フォーカス/カーソルジャンプへ再配線。
* `src/keyboard/` — パラメータ編集モードのバインディングテーブルを整理。
* **削除**: `ElementEditor.tsx`、`ElementSpecificFields.tsx`、全
  `*ElementFields.tsx`、`ParameterEditors.tsx` / `NumericParameterEditor.tsx` /
  `PointParameterEditors` / `ChoiceAndReferenceParameterEditors` /
  `ColorParameterEditor`、`ExpressionInsertTray` とそのテスト。

## 守るべき不変条件

* キーボードファースト: 「要素選択→パラメータへ到達→値変更」が
  マウスなしで完結すること(インスペクタ行ナビ+Enterジャンプ+タイプ、
  または数値ステップコマンド)。
* インスペクタは読み取り専用。文書を変更するのはジャンプ先での
  テキスト編集と数値ステップコマンドのみ。
* ジャンプは正確に該当属性の値スパンを選択する(行頭ではなく)。
* 依存関係表示は明示的(欠落・無効・後方参照の種別を区別。AGENTS.mdルール)。
* 削除するコマンドIDの扱い: ユーザーのショートカット設定が壊れないよう、
  廃止IDは登録から外し、対応表(旧ID→新挙動)をタスク報告に含める。

## Phase開始時点の前提

* Phase 2 完了済み: SourceEditorPane・カーソル同期・アダプタ層のジャンプ
  API基盤・`statementMap` と属性スパンが利用可能。
* 選択状態は `cadUiStore`(Phase 1c)。

## 完了条件

* 右ペインが読み取り専用インスペクタになり、フォーム編集系ファイルが
  削除されている。
* 全26要素型で、インスペクタのパラメータ行からジャンプ→編集→コミットの
  ループが成立。
* 数値ステップコマンドが `stepLevels` を尊重して動作。
* `npm test` / `npm run build` / `npm run lint` 成功。

## 必須テスト

* ジャンプ精度: パラメータ種別(数値・式・参照・選択肢・色・真偽)ごとに
  正しい属性値スパンが選択されること(全要素型を通す行列テスト)。
* インスペクタのキーボードナビゲーション(行移動・Enterジャンプ・Esc復帰)。
* 依存関係行のジャンプと種別表示(欠落・無効・後方)。
* 数値ステップコマンド: stepLevels適用・式トークン上では非破壊(数値
  リテラル以外では何もしないか明確なフィードバック)・Undo1ステップ。
* 廃止コマンドが dispatch されても安全(no-op+警告 or 未登録)なこと。

## やってはいけないこと

* インスペクタへの編集機能(インライン入力欄)の追加。
* `parameterDefinitions.ts` の全削除(縮小して残す。Phase 4 のレシピと
  補完が依存する)。
* コマンドライン作図・DslPanel削除への着手(Phase 4)。
* CM型のアダプタ層外への露出。
