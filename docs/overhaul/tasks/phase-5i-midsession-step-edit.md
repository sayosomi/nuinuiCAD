# Phase 5i: コマンドライン途中段階での完了済みステップ編集(B-6解消)

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書 →
> [phase-4-command-line.md](phase-4-command-line.md)(コマンドラインの
> 不変条件)→ 本文書の順で読むこと。
>
> Phase 4レビュー指摘 **B-6** を解消する子タスク(2026-07-16、ユーザー指示で
> Phase 5へ編入)。親文書の不変条件「Phase 4で追加した完了済み値再編集・
> CommandLineBar・補完・pick routingの挙動を変えない」に対する
> **ユーザー承認済みの唯一の例外**であり、変更は本タスクのスコープ内に限る。
> 他のPhase 5子タスクとは編集ファイルが重ならず、いつでも並行実施可
> (5hより先に完了させること)。

## Context

B-6(Phase 4全体レビュー、確認済み): `beginStepEdit` が `sessionCanConfirm`
を要求する(`src/commands/commandLineSession.ts` 109行付近)ため、全ステップ
完了前は完了済み行チップ(aria-label「…を編集」)をクリックしても何も
起きない。途中修正は「戻る」(以降の値破棄)のみ。

一方、全ステップ完了後のチップ編集(d1d2611で追加、ff0b736のB-1修正で
確定分類 `preview` / `not-evaluated` / `invalid` / `missing-input` が整備済み)
は完成している。本タスクはこの既存の隔離draft編集を**途中段階でも**使える
ようにする。

## Goal

セッション途中(未完了ステップが残る状態)でも、完了済みステップのチップから
隔離draft編集を開始でき、確定すると**他の完了済み値を破棄せずに**元の
進行中ステップへ復帰する。

## 確定した設計判断(2026-07-16)

* `beginStepEdit` の条件を「対象ステップが完了済みであること」へ緩和する
  (`sessionCanConfirm` は要求しない)。現在進行中の未完了ステップは
  チップ編集の対象外(すでにアクティブなプロンプトがある)。
* 編集確定は既存 `confirmEditingDraft` の分類(`preview` /
  `not-evaluated` / `invalid` / `missing-input`)をそのまま使う。
  途中段階での確定成功時は、**編集開始前に進行中だったステップ**
  (=最初の未充足ステップ)へ復帰し、他の引数はすべて保持する。
  `invalid` / `missing-input` は既存どおり入力を保持して編集画面に残る。
* 編集の開始・切替・取消・確定の遷移規則は、完了段階の既存編集フローと
  **同一規則**とする(単一draft、チップ切替時の扱いも既存挙動を先に実測して
  ミラーする。途中段階専用の第二の状態機械を作らない)。
* 参照ステップの編集は既存の共有pick経路(仮想target+`parameterKey`)を
  使い、進行中ステップのpick targetとの入替は**1回のsetでアトミック**に行う
  (4bパターン)。取消・確定時は進行中ステップのpick targetを復元する。
  中間状態を観測させず、DOM inert導出とfocus非残留の既存保証を維持する。
* スキップした名前ステップは従来どおりチップが出ない(仕様維持)。作成後の
  命名はPhase 5gのrenameコマンドが正規の手段。
* 文書は不変のまま(途中編集でcommitしない)。Undo履歴・stale cancellation・
  ghost preview規則(偽デフォルト禁止)・選択中要素の暗黙不使用は一切
  変えない。

## Scope

* `src/commands/commandLineSession.ts` — `beginStepEdit` の条件緩和と
  途中復帰の遷移(純粋状態機械側)。
* `src/commands/commandLineSessionCommands.ts` — `startCommandLineStepEdit` /
  `confirmEditingDraft` の途中段階対応(分岐の追加は最小限)。
* `src/components/CommandLineBar.tsx` — チップの活性化(現在無反応の
  途中段階でも編集開始できるUI。無効表示ロジックがあれば除去)。
* 各テストの拡張(下記)。

## Out of Scope

* 未完了ステップのチップ化・名前ステップの後付けチップ。
* 「戻る」の挙動変更(破棄型の後退はそのまま残す)。
* B-5関連(numeric参照ピックのproperty)・補完・pick候補生成。
* レシピ定義・ghost preview判定の変更。

## Existing APIs / files to reuse

* `beginStepEdit` / `cancelStepEdit` / `confirmEditingDraft` /
  `fillCurrentStep`(既存の隔離draft編集一式)。
* `setSessionAndSyncPickTarget`(pick target同期のアトミックset)。
* ff0b736 B-1修正の確定分類とそのテスト(`commandLineGhostPreview.ts` /
  `commandLineSessionCommands.test.ts`)。

## Invariants(このタスク固有の事故防止)

* 途中編集の確定・取消で、編集対象以外の引数が1つも変わらない。
* 途中編集中も文書リビジョンが進んだらstale cancellation(既存仕様)。
* IME composition中は編集開始・確定とも既存ゲートに従う。
* 編集開始→取消で、進行中ステップのプロンプト・pick target・pickカーソルが
  編集前と完全に同一状態へ戻る。
* 完了段階の既存編集フローのテストが1つも変わらずgreen(挙動の上位互換)。

## Edge cases(テスト必須)

* 参照ステップ編集中にCanvasピック→充填→確定→進行中ステップへ復帰。
* 途中編集中にEsc(編集取消のみ。セッションは維持)。
* 途中編集中に作成コマンド再入(既存の「破棄して置換」が編集状態ごと
  適用される)。
* `@stop` 後挿入位置での途中編集確定(B-1修正の `not-evaluated` 分類が
  途中段階でも機能する)。
* 不正値での確定失敗→編集画面残留→修正→確定→復帰。

## Tests

* 純粋遷移(`commandLineSession`): 途中 `beginStepEdit` の可否・復帰先・
  引数保持。
* commands層: 確定分類ごとの途中確定、pick target入替と復元。
* `CommandLineBar` 実DOM: 途中チップのクリック/キーボード起動→編集→確定→
  進行中プロンプト復帰、aria状態。

## Manual verification

* 実アプリで: 3ステップ以上のレシピを途中まで入力→1つ目のチップを編集→
  確定→進行中ステップへ復帰→最後まで完了→1作成=1 Undo。日本語IMEでの
  編集入力。

## Completion criteria

* 途中段階の完了済みチップ編集が上記設計判断どおり動作し、完了段階の
  既存編集テストが無変更でgreen。
* `npm test` / `npm run build` / `npm run lint` green。

## Dependencies

* Phase 4完了(済み)のみ。他のPhase 5子タスク(5a〜5g)と編集ファイルが
  重ならず、いつでも並行可。**5h(ドキュメント更新)より先に完了させる**。

## Handoff to next task

* 5h へ: 途中編集の確定仕様(本文書の設計判断)を文書側へ反映し、親文書の
  backlog表のB-6行を「解消済み」へ更新すること。
