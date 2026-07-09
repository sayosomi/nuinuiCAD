# Phase 1b: 影テキスト維持 + dev等価assert(正準はまだJSONスナップショット)

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。

## 目的

`cadDocumentStore` の正準状態は現行のJSONスナップショットのまま、全ての文書
コミットで**影のDSLテキスト**を並行維持する。各コミット後、devビルドでは
「影テキストを再パース+再コンパイルした結果 ≡ 現在のモデル」をassertする。

狙い: Phase 1a の行パッチ機構を、実ユーザー操作の全経路(全コマンド・Canvas
ドラッグ・DSLパネル適用・テンプレート挿入)で実戦検証する。バグは文書破損では
なく**dev警告**として顕在化する。ユーザー可視の挙動変更ゼロ。

## 変更対象

* `src/state/cadDocumentStore.ts` — 状態に `shadowText: string` と
  `shadowStatementMap` を追加。`commitDocumentChange` / `updateElement` /
  `renameElement` 等の全コミット経路の末尾で:
  1. Phase 1a の `textPatch` で影テキストへ行スプライス適用
  2. `statementReconciler` でID照合(結果はまだ捨てるが、継承率をassert)
  3. devビルド限定: 影テキストを再コンパイルし現モデルと意味的等価をassert。
     不一致時は console.error + 影テキストの全再生成(自動復旧)で、
     ユーザー操作は止めない。
* `replaceDocument`(ファイル読込)と `undo` / `redo` — 影テキストを
  モデルから全再生成(この2経路のみ全体再シリアライズが正当)。
* 新規 `src/document/shadowTextAssert.ts` — 等価判定(ID無視の意味的等価)と
  dev判定(`import.meta.env.DEV`)のヘルパ。

## 守るべき不変条件

* **正準はJSONスナップショットのまま**。保存・読込・Undo履歴・派生描画は
  一切変えない。影テキストは観測専用。
* assert失敗でユーザー操作をブロックしない(警告+自動復旧)。
* 影維持のコストが編集の体感を落とさないこと(コミット当たり数ms級。
  1000要素で問題が出たら計測結果を報告し、投機的最適化はしない)。
* prodビルドでは等価assert(再コンパイル)を実行しない。行パッチ自体は
  prod でも実行してよい(次Phaseへの地均し)。
* **`expanded` / `elseExpanded`(グループ折りたたみUI状態)は現状互換のまま**。
  これらは `GroupElement` / `ConditionalGroupElement` / `ForGroupElement`
  (`src/types/geometry.ts`)のモデルフィールドとして existing のとおり残し、
  DSLへも現行どおりシリアライズする(`src/dsl/dslSerializer.ts` の
  `commonBaseAttrs`)。保存形式・UI状態の位置は本Phaseでは動かさない方針
  (ユーザー確定、2026-07-09)。影テキストの等価assertはこの現状挙動を前提に
  成立させること — `expanded` を文書モデルから追い出す設計変更は
  Phase 1c の担当(`phase-1c-text-canonical.md` の該当セクション参照)。

## Phase開始時点の前提

* Phase 0(文法)・Phase 1a(`statementReconciler` / `textPatch`)完了済み。
* `commitDocumentChange` 呼び出し元は非テスト13ファイル。**呼び出し元は
  一切変更しない**(ストア内部で吸収する)。

## 完了条件

* 全コマンドテスト・ストアテストが通り、かつテスト実行中の影assertが
  一度も失敗しない(テストでは影assertを常時有効にする)。
* 手動確認: 実アプリで代表操作(要素作成各種・パラメータ編集・Canvasドラッグ・
  グループ操作・DSLパネル適用・テンプレート挿入・Undo/Redo)を行い、
  コンソールに影assert警告が出ないこと。
* `npm test` / `npm run build` / `npm run lint` 成功。

## 必須テスト

* 既存の `cadDocumentStore.test.ts` / `commands.test.ts` 系を、影assert有効で
  全通し(equivalenceの検証は自動的に全ケースに乗る)。
* ランダムコマンド列プロパティテスト: ランダムな一連のストア操作後、
  `parse(shadowText) ≡ model` かつ影テキスト中の手置きコメント行が不変。
* 影テキストにコメント・空行を仕込んだ上で各種コミットを行い、
  当該行が保存されることの明示テスト。
* Undo/Redo 後の影再生成の等価テスト。

## やってはいけないこと

* 保存形式・ファイルI/O・Undo履歴構造・選択状態の場所を変えること
  (それはPhase 1c/1d)。
* `commitDocumentChange` の署名変更や呼び出し元の書き換え。
* assert失敗時に例外でユーザー操作を中断すること。
* 影テキストをUIに表示したり、DSLパネルの入出力に接続すること。
