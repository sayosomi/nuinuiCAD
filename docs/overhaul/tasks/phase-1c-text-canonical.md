# Phase 1c: 正準反転 — sourceTextが正・統合Undo・選択状態のUIストア移動

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。

## 目的

Phase 1b で実戦検証済みの影テキストを**正準**に反転する。以後、
`sourceText` が文書の唯一の真実、コンパイル済みモデルは派生キャッシュとなる。
同時にUndo履歴をテキストベースの一本に統合し、選択状態を文書ストアから
`cadUiStore` へ移動する。保存形式はまだJSON(保存時に `doc` からスナップ
ショットを生成)。

## 変更対象

* `src/state/cadDocumentStore.ts` — 書き換え:

  ```ts
  type CadDocumentState = {
    sourceText: string;                    // 正準
    doc: CompiledDocument;                 // 派生(elements, palette, roles,
                                           // profiles, printLayouts,
                                           // evaluationLimitIndex,
                                           // statementMap, diagnostics)
    previewElements: CadElement[] | null;  // ドラッグ中のみ・履歴非関与
    past: TextSnapshot[]; future: TextSnapshot[];
      // TextSnapshot = {text, selectionElementIds, cursorLine}
    currentFilePath: string | null;
    dirtySinceSave: boolean;
  };
  ```

  * 変更入口3つ: `commitText(nextText, origin)`(履歴push→再パース→ID照合→
    再コンパイル)、`commitDocumentChange(change)`(**署名維持のブリッジ**:
    差分→行パッチ→`commitText` 相当。1履歴push)、
    `previewDocumentChange(change)`(`previewElements` のみ)。
  * 履歴上限 **200**。`snapshotEquals` 相当は「テキスト同一」判定に置換。
  * dev限定assert(1bのもの)は「コミット後に再コンパイル≡意図モデル」として
    存続させる。
* `src/state/cadUiStore.ts` — `selectedElementId` / `selectedElementIds` /
  `selectionAnchorElementId` / `selectedParameterKey` を受け入れ。選択正規化
  (存在しないIDの除去)は要素変化時にここで行う。
* 選択状態の読み書き元の一括更新(grepで `snapshot.selected` /
  `state.selectedElement` 系を全数洗い出すこと。コマンド群・パネル群に散在)。
* `src/document/documentFile.ts` — 保存: `doc` から従来形状のスナップショットを
  組み立ててJSON化(形式不変)。読込: JSONパース→文書シリアライザでDSLテキスト
  生成→`commitText`。
* `src/components/` の描画・評価入力 — `previewElements ?? doc.elements` を
  読むよう参照先を更新(`AppLayout.tsx` ほか)。
* `src/state/unsavedChangesGuard.ts` 等、dirty判定・履歴参照箇所。

## 守るべき不変条件

* **`commitDocumentChange` / `previewDocumentChange` の署名維持**。非テスト
  13ファイルの呼び出し元はコンパイル・動作とも無変更で通ること。
* Undoは一本: どの経路(コマンド・ドラッグ確定・DSLパネル適用)の変更も
  1コミット=1履歴エントリ。Undo/Redoで選択とカーソル行も復元される。
* ドラッグ中は `previewElements` のみ更新(テキスト・履歴に触れない)。
  確定時に1行パッチ+1履歴エントリ(既存の preview/commit 分離を保つ)。
* コメント・空行・文書順はモデル経由編集で不変(行スプライスのみ)。
* 評価境界 `evaluate_document(input)` と評価キャッシュは実行時IDで従来どおり
  動作(照合器がIDを継承するため)。Rust変更なし。
* 保存ファイル形式(JSON)は不変。旧アプリで読める必要はないが、この時点で
  形式を変えない(1dの仕事)。
* DSLパネル・LeftPanel・RightPanel等の既存UIは従来どおり動作すること。

## 意図した一時制約: 保存→読込でのテキスト整形の非保存

本Phaseでは正準は `sourceText` だが保存はJSON経由のため、
**保存→読込のラウンドトリップで `sourceText` はシリアライザ出力に正規化され、
コメント・空行・手書き整形は残らない**。これは意図した一時制約であり、
Phase 1d(`.nui` テキスト保存)で解消される。

実害がない理由と運用上の扱い:

* 本Phase時点では**生テキストを編集するUIが存在しない**(常設エディタは
  Phase 2 で、Phase 2 は 1d 完了に依存する)。`commitText` の呼び出し元は
  ファイル読込のみで、コメント等がユーザー操作で `sourceText` に入る経路が
  ない。よって失われるものは実際には発生しない。
* コメント・空行の保存性テスト(下記)は、テストコードが `commitText` で
  直接注入して検証する(セッション内のモデル経由編集では保存されることの
  確認)。保存→読込を跨いだ保存性のテストは **Phase 1d の完了条件**であり、
  本Phaseでは要求しない。
* この制約を理由に Phase 2 を 1d より先に着地させないこと(依存順序は
  `tasks/README.md` のとおり)。

## 引き継ぎ事項: `expanded` / `elseExpanded`(折りたたみUI状態)の文書モデルからの分離

**ユーザー確定(2026-07-09)**: グループの折りたたみ表示状態は編集UIの状態であり、
最終的な `.nui` 正準文書には含めない。Phase 1a/1b は現状互換のまま
(`expanded`/`elseExpanded` を要素モデルのフィールドとして持ち、DSLへも
シリアライズする)実装済み。本Phaseで文書モデルから追い出すこと。

現状の実装箇所(2026-07-09時点):

* モデル: `GroupElement.expanded` / `ConditionalGroupElement.expanded` /
  `ConditionalGroupElement.elseExpanded` / `ForGroupElement.expanded`
  (`src/types/geometry.ts:326,335,336,345`)。
* パラメータ定義: `src/parameters/parameterDefinitions.ts:100,112,128`
  (`key: "expanded"` / `"elseExpanded"`、`kind: "boolean"`)経由で
  `applyCommonAttributes` の汎用属性ループがDSL↔モデルを変換している
  (dslCompiler側に特別扱いのコードはない)。
* シリアライズ: `src/dsl/dslSerializer.ts:179,402,412`
  (`commonBaseAttrs`/各コンテナ型の行組み立て)。`flatRefs` と
  `documentDslRefs` の両方から呼ばれるため、DSLパネルの一時エクスポートにも
  文書グラマーの正準テキストにも `expanded=`/`elseExpanded=` が現れる。
* UI読み書き箇所(モデルの `.expanded` を直接参照): `LeftPanel.tsx`,
  `ElementListRow.tsx`, `ElementListContextMenu.tsx`,
  `ElementCommonFields.tsx`, `ForGroupElementFields.tsx`,
  `model/groups.ts`, `model/elementCreationPlacement.ts`,
  `commands/selectionCommands.ts`。

Phase 1c で行うこと:

1. `expanded`/`elseExpanded` を `CadElement` モデル(`src/types/geometry.ts`)
   から削除し、折りたたみ状態は要素IDをキーとするマップとして
   `cadUiStore`(または将来のエディタ側 fold state。Phase 2 でCodeMirrorへ
   移行するまでの暫定置き場として `cadUiStore` が妥当)へ移す。選択状態を
   同じPhaseで `cadUiStore` へ移動する作業(本ファイル冒頭の変更対象)と
   足並みを揃えられるため、二度手間にならない。
2. `parameterDefinitions.ts` から `expanded`/`elseExpanded` の定義を削除
   (AGENTS.mdの「`parameterDefinitions.ts` は縮小して存続」方針に沿う)。
3. `dslSerializer.ts` の `commonBaseAttrs` および各コンテナ型の行組み立てから
   `expanded=`/`elseExpanded=` の出力を削除し、DSLパーサ側が読んでも無視される
   よう(または非推奨属性として扱うか)整理する。これにより最終的な `.nui`
   テキストは折りたたみ状態を一切含まなくなる。
4. 上記UI読み書き箇所を新しい状態置き場からの読み書きに更新する。
5. 影響するテストフィクスチャ(`dslSerializer.test.ts` / `dslDocument.test.ts`
   等、`expanded=`/`elseExpanded=` を含む既存アサーション)を更新する。

**注意**: `ForGroupElement.showGenerated` は似て非なるフラグ(生成された行を
表示するかどうかの表示トグル)であり、今回のユーザー指示の対象ではない。
混同して一緒に移動しないこと(対象は折りたたみ状態=`expanded`/`elseExpanded`
のみ)。

## Phase開始時点の前提

* Phase 0 / 1a / 1b 完了済み。影テキスト機構が全経路で警告ゼロで動いている。
* DSLパネルの適用は `commitDocumentChange` 経由なのでブリッジで自然に動くが、
  パネル独自のローカルテキスト履歴はそのまま残してよい(削除はPhase 4)。

## 完了条件

* 正準反転後、既存テストが全て通る(モデル結果の後方互換をフィクスチャで確認)。
* 実アプリのエンドツーエンド動線が成立:
  新規作成→作図→保存→再起動→読込→Undo/Redo→Canvasドラッグ→DSLパネル適用。
* Undo/Redoで選択・カーソル行が復元される。
* 履歴が200件でキャップされる。
* `expanded` / `elseExpanded` が `CadElement` モデルとDSL正準テキストから
  除去され、`cadUiStore`(またはエディタ側 fold state)へ移動している
  (上記「引き継ぎ事項」参照)。
* `npm test` / `npm run build` / `npm run lint` 成功。評価入力の変更があるため
  `npm run test:parity` も実行。

## 必須テスト

* ブリッジ等価スイート: 既存コマンドテストをリプレイし、モデル結果が
  書き換え前のフィクスチャと一致、かつ毎ステップ `parse(sourceText) ≡ doc`。
* テキスト編集(`commitText`)とモデル編集(ブリッジ)を交互に行う混在
  Undo/Redoシーケンス。
* Canvasドラッグ相当(preview連打→commit)で履歴が1件だけ増えること。
* コメント・空行を含むテキストに対するモデル経由編集の保存性。
* 選択状態: 要素削除で選択が正しく落ちる/1行編集・Undoで選択が生き残る
  (ID照合の帰結)。
* 保存→読込ラウンドトリップ(JSON経由)で意味的等価。
* 履歴キャップ、`dirtySinceSave` の遷移。

## やってはいけないこと

* ファイル形式・拡張子の変更(Phase 1d)。
* UIコンポーネントの構成変更(LeftPanel置換等はPhase 2以降)。
* 呼び出し元13ファイルの「ついで」リファクタ。ブリッジで吸収しきれない箇所が
  見つかった場合は、最小限の変更に留め、タスク報告に明記する。
* パフォーマンス問題への投機的対応。再パース+再コンパイルが1000要素で
  10msを超える実測が出た場合のみ、statementMapベースの文単位メモ化を検討し、
  まず計測結果を報告する。
* 「ファイル全体を再シリアライズ」するコードパスの追加(読込・Undo復元を除く)。
