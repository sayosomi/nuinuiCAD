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
