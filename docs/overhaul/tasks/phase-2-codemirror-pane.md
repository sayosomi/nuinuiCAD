# Phase 2: CodeMirror 6 左ペイン(構成リスト置換)

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。

## 目的

左ペインの構成リスト(LeftPanel)を CodeMirror 6 ベースの常設DSLエディタに
置き換える。テキスト自体が構成ビューになる: 1行=1要素、カーソル行⇄Canvas選択の
双方向同期、グループブロックの折りたたみ、診断波線、要素状態(エラー/無効/
非表示)の行デコレーション。

## 変更対象

* **依存追加**: `@codemirror/state` `view` `language` `autocomplete` `lint`
  `commands` `search`(~150KB min+gz。ユーザー合意済み。これ以外のUI依存を
  足さない)。
* 新規 `src/components/SourceEditorPane.tsx` — CMのReactラッパ。CMのimportは
  `src/editor/` とこのファイルに限定し、他コンポーネントへ漏らさない。
* 新規 `src/editor/cmLanguage.ts` — 既存 `dslHighlight.ts` トークナイザの
  StreamLanguage風ラップ(Lezer文法は書かない)。ブロック情報(パース済み文)
  駆動の `foldService`。
* 新規 `src/editor/cmDecorations.ts` — `doc.diagnostics` を lint ソースへ、
  評価結果から行デコレーション(エラー=ガター赤、disabled=淡色、hidden=
  マーカー。既存 `ElementStatusIcon` のセマンティクスを踏襲)。ビューポート
  限定で計算。
* 新規 `src/editor/cmSelectionSync.ts` — 双方向同期:
  * カーソル行 → `statementMap` 逆引き → 要素選択(`cadUiStore`)。
  * Canvas/検索からの選択 → 該当行へスクロール+カーソル。
  * 複数選択 = 複数カーソル/行レンジ。エコーループ抑制。
* `src/components/AppLayout.tsx` — LeftPanel を SourceEditorPane に差し替え。
  リボンドックはスリムなストリップとして移設(キャンバス縁 or 左ペイン下端)。
* `src/keyboard/` — エディタフォーカス時のモードスコープ追加。
  Esc → Canvasフォーカス。フォーム入力除外の原則(エディタ内では通常のタイプ・
  編集キーが最優先)を維持。
* **削除**: `LeftPanel.tsx`、`ElementListRow.tsx`、`useElementListData.ts`、
  `elementListPointerDrag` / `elementListName` 等リスト専用ヘルパと
  そのテスト。要素検索は既存の検索機構(`elementSearch.ts` 系)を
  エディタ検索/選択ジャンプに接続して代替。

## Undo統合ルール(重要)

* CM自体の履歴は「未コミットのタイピングバースト内」のみ有効。
  アイドル ~300ms / blur / コマンド実行 / 保存 / Canvas操作を境界として
  `commitText` し、境界でCM履歴をフェンス(リセット)する。
* **ストア履歴が唯一の正**。ストアUndo/RedoはCMバッファを置換する。
* 外部パッチ(Canvas編集・コマンドによる行スプライス)は、全文置換ではなく
  正確な `changes` 範囲のCMトランザクションとして適用し、カーソル・
  スクロール位置を保つ。

## 守るべき不変条件

* キーボードファースト: リストで可能だった操作(選択移動・検索・可視/有効
  トグル・削除・複製・評価リミット移動)は全てエディタ+コマンドで可能なこと。
  旧コマンドIDは可能な限り新挙動へ再配線する(対応表をタスク報告に含める)。
* 文書順=評価順=表示順(テキストの行順がそのまま全て)。
* 1000行規模でスクロール・編集・デコレーションが滑らか(CMの仮想描画に任せ、
  デコレーション計算をビューポート外に広げない)。
* 日本語IMEでの入力が安全(composition中にプログラム的なカーソル移動・
  バッファ置換をしない)。
* CMのimportはアダプタ層(`src/editor/` + `SourceEditorPane.tsx`)に隔離。

## Phase開始時点の前提

* Phase 1d 完了済み: `sourceText` 正準・統合Undo・`.nui` 保存・
  `statementMap`(行範囲+属性スパン)・選択状態は `cadUiStore`。
* DslPanel(フローティング)はまだ存在してよい(削除はPhase 4)。

## 完了条件

* 左ペインが常設エディタになり、LeftPanel系ファイルが削除されている。
* カーソル⇄選択の双方向同期・折りたたみ・診断波線・状態デコレーションが動作。
* タイピング→コミット境界→ストアUndo の履歴動作が仕様どおり
  (バースト内はCM、境界後はストア)。
* `npm test` / `npm run build` / `npm run lint` 成功。
* 手動確認(macOS): 日本語IMEで要素名・テキスト要素の入力、1000行文書の
  スクロール、折りたたみ跨ぎの選択同期。確認項目をタスク報告に記録。

## 必須テスト

* 選択同期の両方向(単一・複数・折りたたみ内要素・無名要素)。
* コミット境界のUndoフェンス(バースト内タイプ→境界→ストアUndoで
  バースト全体が1ステップで戻る等、境界仕様の明文化とテスト)。
* 外部パッチ適用でカーソル・スクロールが保持されること。
* デコレーション: エラー/無効/非表示要素の行が正しくマークされること。
* キーボード: エディタフォーカス時のショートカットスコープ、Escでの
  フォーカス遷移、グローバルショートカットとの非干渉。

## やってはいけないこと

* CM関連import・型をアダプタ層の外(コマンド・ストア・他コンポーネント)へ
  漏らすこと。
* Lezer文法の新規作成(StreamLanguageラップで足りる。不足が実証されたら
  報告のみ)。
* 二重履歴(CM履歴とストア履歴の競合)を許すこと。
* インスペクタ(右ペイン)・DslPanel・コマンドライン作図への着手
  (Phase 3/4)。
* リスト機能の「とりあえず両方残す」— LeftPanelは本Phaseで削除しきる。
