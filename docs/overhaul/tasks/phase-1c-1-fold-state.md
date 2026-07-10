# Phase 1c-1: fold状態(`expanded` / `elseExpanded`)の文書モデル外出し

> 全体計画: `docs/overhaul/plan.md`、親文書: `phase-1c-text-canonical.md` を
> 必ず先に読むこと。AGENTS.md の規則に従うこと。
> Phase 1c は 1c-1 → 1c-2 → 1c-3 → 1c-4 の直列4分割で実装する。
> 本タスクはその第1段。**正準はまだJSONスナップショットのまま**。

## 目的

グループの折りたたみ表示状態(`expanded` / `elseExpanded`)を文書モデル・
DSL・パラメータ定義から完全に除去し、`cadUiStore` のセッション限りUI状態へ
移す(ユーザー確定 2026-07-09)。これにより:

* DSL正準テキスト(Phase 1c-3以降)にUI状態が混入しない。
* 1c-3 の照合・パッチ対象からfold属性が消え、fixture churnを先に消化できる。

**承認済みの挙動変更(2026-07-10)**: foldトグルは文書コミットでなくなるため
**Undo/Redoの対象外**になり、保存もされない(再起動後のfold復元は非要件)。

## 変更対象

### モデル・DSLからの除去

* `src/types/geometry.ts:326,335-336,345` — `GroupElement.expanded` /
  `ConditionalGroupElement.expanded` / `.elseExpanded` /
  `ForGroupElement.expanded` フィールドを削除。
* `src/model/elementFactory.ts:63,78-79,95` — デフォルト値設定を削除。
* `src/parameters/parameterDefinitions.ts:100,112-113,128` —
  `expanded` / `elseExpanded` のパラメータ定義を削除
  (AGENTS.md「`parameterDefinitions.ts` は縮小して存続」方針)。
* `src/dsl/dslSerializer.ts:187,410-411,420` — `expanded=` / `elseExpanded=` の
  出力を削除。
* `src/dsl/dslCompiler.ts` — 両属性を **deprecated-ignore(warning)** として
  受理する(既存の `parent=` / `branch=` 警告 `dslCompiler.ts:782,785` と同型)。
  古いテキスト・fixtureを読んでもfatalにしない。

### cadUiStore への追加

`src/state/cadUiStore.ts` に追加:

```ts
groupFoldById: ReadonlyMap<ElementId, { expanded?: boolean; elseExpanded?: boolean }>;
setGroupFold(id: ElementId, patch: { expanded?: boolean; elseExpanded?: boolean }): void;
toggleGroupExpanded(id: ElementId): void;
toggleElseExpanded(id: ElementId): void;
pruneGroupFold(existingIds: ReadonlySet<ElementId>): void; // 要素消滅時の掃除
```

* 未登録IDのデフォルトは現行factory値と同じ **`expanded=false` /
  `elseExpanded=true`**(見た目の初期状態を変えない)。
* セッション限り・非永続。Phase 2 で CodeMirror の fold state へ引き継ぐまでの
  暫定置き場(親文書の推奨どおり)。
* `pruneGroupFold` は要素削除を伴うコミットの後処理として呼ぶ
  (呼び忘れてもメモリリーク以外の実害はないが、掃除経路をテストで固定する)。

### 読み書き元の更新

* `src/commands/selectionCommands.ts:507-519` — `toggleGroupExpanded` を
  文書コミット(`commitDocumentChange`)から uiStore アクション呼び出しへ変更。
  **履歴エントリを作らない。**
* `src/commands/selectionCommands.ts:566-571` — outdent の `expanded: true`
  書き込みを、文書コミットに同梱せず uiStore 呼び出しへ分離。
* `src/commands/conditionalGroupCommands.ts:106,125,142` — `elseExpanded`
  書き込みを uiStore へ。
* `src/model/groups.ts:69-72`、`src/model/elementCreationPlacement.ts:63` —
  fold状態の参照を引数化する(純粋関数からuiStoreを直接importしない。
  呼び出し側がfold状態を渡す)。
* コンポーネント: `ElementListRow.tsx`(:58-72, :282-288, :382)、
  `ElementListContextMenu.tsx:115`、`ElementCommonFields.tsx:138-165`、
  `ForGroupElementFields.tsx:67-69`、`LeftPanel.tsx:828,932` —
  `element.expanded` 参照を uiStore 読みへ。
* `ElementCommonFields` / `ForGroupElementFields` のチェックボックスは
  fold用途なら uiStore トグルへ付け替える(パラメータ編集モードの対象からは
  外れる。パラメータ定義削除の帰結)。

### テスト・fixture更新

* `expanded:` fixtureを含む約21テストファイル(`commands.test.ts`、
  `elementFactory.test.ts`、`elementCreationPlacement.test.ts`、
  `elementDuplication.test.ts`、`dependencies.test.ts`、`LeftPanel.test.tsx`、
  `printLayout.test.ts` ほか grep で全数確認すること)。
* `src/document/documentTestGenerators.ts`(property test 生成器)から
  fold属性の生成を除去。
* `dslSerializer.test.ts` / `dslDocument.test.ts` の `expanded=` アサーション。

## 守るべき不変条件

* **`ForGroupElement.showGenerated` は対象外**(似て非なる表示トグル。
  親文書の注意どおり混同しない)。
* foldトグルが `past` / `future` / `dirtySinceSave` / 影テキストを一切変えない。
* fold状態は要素IDキー。以後のStageでも statementReconciler のID継承により
  編集を跨いで安定する(この性質を壊すID再割当を入れない)。
* 影テキスト等価assert(Phase 1b)は全経路でgreenのまま
  (両辺同一シリアライザなので `expanded=` 除去後も等価が保たれるはず。
  破れたらシリアライザ側の除去漏れを疑う)。
* 保存形式(JSON)は不変。保存JSONからも `expanded` / `elseExpanded` は消える
  (モデルフィールドが消えるため)が、読込時に旧JSONの当該キーは黙って無視
  されること(クラッシュ・fatal診断にしない)。

## Phase開始時点の前提

* Phase 0 / 1a / 1b 完了済み。影テキスト機構が全経路で警告ゼロ。
* dangling reference はcompile warningへ降格済み。

## 完了条件

* `expanded` / `elseExpanded` が `CadElement` 型・DSLシリアライザ出力・
  パラメータ定義から消えている。
* foldトグルがUndo履歴に乗らない。
* `npm test` / `npm run build` / `npm run lint` 成功。
* full suite 10回連続実行(`for i in $(seq 1 10); do npm test; done`)で
  flake未再現を記録(失敗時はテスト名・出力を報告のみ。原因確定はしない)。

## 必須テスト

* uiStore fold単体(set / toggle / prune / 未登録IDのデフォルト値)。
* fold操作が履歴・dirty・影テキストを変えないこと。
* `expanded=` を含む旧DSLテキストのcompileがwarning止まり(fatalにならない)。
* 旧JSON(`expanded` キー入り)の読込が成功すること。

## やってはいけないこと

* previewElements分離・正準反転・selection移動(1c-2 / 1c-3 / 1c-4 の先取り)。
* `showGenerated` への変更。
* 保存形式・拡張子の変更(Phase 1d)。
* UIコンポーネントの構成変更(fold参照の付け替えを超えるリファクタ)。
