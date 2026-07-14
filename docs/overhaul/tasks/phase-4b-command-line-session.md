# Phase 4b: コマンドラインセッション状態機械(commandLineSession)

> 親文書: [phase-4-command-line.md](phase-4-command-line.md)。着手前に
> `AGENTS.md` → `docs/overhaul/plan.md` → 親文書 →
> [phase-4a-1-creation-recipe-core.md](phase-4a-1-creation-recipe-core.md) →
> 本文書の順で読むこと。

## Context

4a-1のレシピ基盤を消費するセッション(現在ステップ・確定済み引数・挿入位置・
開始時文書リビジョン)を、純粋な遷移関数群+`cadUiStore` の状態として実装
する。UIとピック連携は後続タスク。テンプレート挿入
(`src/templates/templateInsertionMode.ts` + `ActiveTemplateInsertion`)が
同型の先行例なので、状態の持ち方・進行判定のスタイルを踏襲する。

## Goal

`src/commands/commandLineSession.ts`(純粋モジュール)と `cadUiStore` の
セッション状態を新設し、開始→ステップ充填→スキップ→キャンセル→完了判定の
全遷移をテストで固定する。

## Scope

* セッション型(例):

  ```ts
  type CommandLineSession = {
    recipe: CreationRecipe;
    args: CreationArgs;              // 確定済みステップ値
    currentStepIndex: number;
    insertionIndex: number;          // 開始時に確定、以後不変
    startedAtRevision: number;       // 開始時の文書リビジョン
    nameSuggestion: string;          // nameステップのEnter採用候補
    error: string | null;
  };
  ```
* 純粋遷移関数: `startSession(recipe, {insertionIndex, revision, elements})` /
  `fillCurrentStep(session, value)` / `skipCurrentStep(session)`(スキップ可は
  nameとdefault付きnumberのみ)/ `retreatStep(session)`(1つ戻る。引数は
  破棄)/ `sessionCanConfirm(session)` / `currentStep(session)`。
* stale判定: `sessionIsStale(session, currentRevision)`。**staleなセッションは
  遷移せず明示エラーでキャンセルする方針**(親文書の確定判断)。判定に使う
  リビジョンは `cadDocumentStore` の既存の単調な文書リビジョン(なければ
  `sourceText` 同一性)を正とし、新しいリビジョン機構を発明しない。
* nameステップの候補生成: `withCreatedElementName` / `makeUniqueElementName`
  (`src/model/elementNames.ts`、名前空間対応)を使い、挿入位置のスコープで
  一意な候補を出す。
* `insertionIndex` の決定ヘルパ(純粋): カーソル行の文index(あれば)→
  `creationPlacementForEvaluationLimit` フォールバック。カーソル行の解決は
  呼び出し側(4c)が `statementRangeIndex` で行い、ここは選択ロジックのみ。
* `cadUiStore` に `commandLineSession: CommandLineSession | null` と
  setter(既存pick target群と同じ流儀)を追加。`clearPickMode` 相当の一括
  クリア(既存の全pickクリア処理)にセッションも含める。
* セッションは `CreationRecipe` と `CreationArgs` のみを保持し、
  `CreationEmitContext`・要素生成は保持しない。文書文脈は確定/プレビュー時の
  呼び出し側(4c/4f)が渡す。
* **再入=置換の意味論**(親文書の確定判断): `startSession` は既存
  セッションの有無を問わず常に新しいセッションを返す純粋関数とする
  (「既存があれば拒否/マージ」の分岐を持たない)。storeレイヤの
  セッション開始setterは、既存セッションの破棄と同時に
  active pick target群・`draftLineIds` を含むpick状態・`activePickCursor`
  をアトミックにクリアしてから新セッションを置く(1回の `set` で行い、
  中間状態を観測させない)。保留中のCanvas pointer intent・エディタfocus
  予約の解除は、storeの外にある機構のためコマンド層(4c)の責務とし、
  本タスクではsetterのJSDocに要件として明記する。置換は文書・Undo履歴に
  一切触れない。
  なお複数pick中にCanvas外へ付与されるDOM `inert`(`AppLayout` が
  `isMultiLinePicking` から導出)は直接解除する対象ではなく、この
  アトミックなクリアの帰結として次renderで解除される(親文書の確定判断)。
  setterが導出条件の偽化を1回のsetで保証することが、その前提になる。

## Out of Scope

* UI(CommandLineBar)・コマンド登録・キーボード(4c)。
* ピック受理のルーティング・仮想pick target(4d)。
* previewDocumentChange(4f)、無名昇格(4e)。
* 文書へのコミット。**本タスク完了時点でも挙動変更ゼロ**(状態は誰も
  セットしない)。

## Existing APIs / files to reuse

* 4a-1 `creationRecipes.ts` の型・`creationRecipeForType`(公開APIは
  凍結済み。4a-2のレシピ追加とは独立に進められる)。
* `src/templates/templateInsertionMode.ts` — 進行判定・入力充填のスタイル見本
  (コードは共有しなくてよいが、命名と分離の粒度を揃える)。
* `src/model/elementNames.ts` — `makeUniqueElementName` /
  `withCreatedElementName` / 名前空間解決。
* `src/model/elementCreationPlacement.ts` —
  `creationPlacementForEvaluationLimit`。
* `src/state/cadUiStore.ts` — pick target群のsetterパターン、
  既存の一括pickクリア処理。

## Invariants

* 遷移関数は純粋(storeを読まない・書かない)。store書き込みはsetter経由の
  薄い層のみ。
* **選択中要素を状態機械が読まない**: 「選択中をEnterで採用」はUI側(4c/4d)が
  明示的に `fillCurrentStep` を呼ぶ形でのみ実現する。セッション自体は
  selectionを知らない。
* `insertionIndex` と `startedAtRevision` は開始後に書き換えない(staleは
  キャンセルのみ、追従・再計算をしない)。
* スキップ済みnameステップ=無名要素として完了できる。偽の名前を
  自動発番して埋めない(昇格は参照された時=4eの責務)。

## Edge cases

* ステップ0個のレシピは存在しない前提だが、nameのみのレシピ(将来)でも
  遷移が壊れないこと。
* `retreatStep` を先頭で呼ぶ/`skipCurrentStep` をスキップ不可ステップで
  呼ぶ → no-op(例外にしない)。
* default付きnumberステップのスキップはdefault値の採用として `args` に入る。
* 同名要素が挿入位置スコープに既にある場合のnameSuggestion一意性。
* 開始直後にstale(開始処理と外部コミットの競合)→ 最初の遷移で検出し
  キャンセルできること。
* セッション進行中(引数充填済み・pick draftあり)の `startSession` →
  前セッションの引数・draftが一切残らない完全な初期状態になる。同じ
  レシピでの再開始(リセット)も同様。

## Tests

* 各遷移のテーブルテスト(充填・スキップ・戻り・キャンセル・完了判定)。
* stale検出: 開始時リビジョンと異なるリビジョンでの遷移要求が
  キャンセル+エラー文言を返すこと。
* nameSuggestionの名前空間スコープ一意性(トップレベル/グループ内)。
* `insertionIndex` 決定ヘルパ: カーソル行あり/なし/非element行の各分岐。
* storeレイヤ: セッション開始setterが既存セッション・全pick target・
  `draftLineIds`・`activePickCursor` を1回の `set` でクリアして置換する
  こと。一括pickクリアにセッションが含まれること。
* 置換がUndo履歴・文書状態に影響しないこと(履歴長不変のassert)。
* 置換直後のstoreの状態から、DOM inertの導出条件
  (`isMultiLinePicking` 相当: lineReferenceList pick targetの存在)が
  偽になること(コンポーネントを介さないstateレベルのassert。DOM側の
  回帰テストは4c/4d)。

## Manual verification

* なし(状態は未接続)。`npm test` / `npm run build` / `npm run lint`。

## Completion criteria

* 上記テストgreen・挙動変更ゼロ。
* セッションの全ライフサイクルが純粋関数として文書化(JSDoc)されている。

## Dependencies

* 4a-1完了。4a-2・4h・4iと並行可。

## Handoff to next task

* 4cは `startSession` / `fillCurrentStep` / `skipCurrentStep` /
  `sessionCanConfirm` をUIとコマンドから呼び、確定時に
  `emitCreationRecipe(recipe, args, CreationEmitContext)`→シリアライズ→
  行スプライスを実装する。
* 4dは参照ステップ(`point` / `endpoint` / `line` / `lineList`)進入時の
  pick target設定と、受理値の `fillCurrentStep` ルーティングを実装する。
