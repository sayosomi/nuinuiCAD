# Phase 5e: renameコマンドcore(bridge / Undo接続。UIなし)

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書 →
> [phase-5d-rename-analysis.md](phase-5d-rename-analysis.md)(凍結API)の
> 順で読むこと。
>
> 依存: 5d。**5b-2 が先にmergeされていること**(`cadDocumentStore.ts` 衝突
> 回避)。**本タスク完了時にreview境界2**。

## Context

5dの解析器を実文書変更へ接続する。パッチ生成そのものは既存ブリッジの創発的
性質(名前変更→参照行の再シリアライズ追従)を使い、新しいテキスト書き換え
機構は**作らない**。本タスクの責務は「安全ゲート→解析→拒否 or 1 commit→
検証」の配線と、既存 `renameElement`(自動連番するため方針非互換・
callerはテストのみ)の置換。

## Goal

UIなしで呼べる `renameElementWithPropagation`(名称は実装時に確定)を
実装し、1リネーム=1 `commitDocumentChange`=1 Undoステップ+dev検証つきで
テスト固定する。

## Scope

* コマンドレベル関数(`src/commands/` 配下。UIなし・palette未登録):
  1. `sourceEditSession.flush("command")` を通す。
     `"blocked-composition"` → 実行せず既存のcommand error経路で通知。
  2. クリーンコンパイル要求: flush後の正準テキストがエラー診断なしで
     コンパイルできること(`statementMap` 非null)。fatal/エラー中は明示
     エラーで拒否(黙って古いモデルを使わない)。
  3. 5d `analyzeRename` を実行。`rejected` → 拒否reasonを人間可読エラー
     (行番号・衝突相手入り)で通知し、文書は不変・Undo履歴も不変。
  4. `ok` → 対象要素の `name` だけを差し替えたelementsで**1回の**
     `commitDocumentChange` を発行(4e無名昇格と同じ入口。参照行・
     printLayout `place` はブリッジが追従)。
  5. 確定後: 新規選択は変えず、対象要素を選択のまま維持。
* dev検証(devビルドのみ。1bの影assertと同じ流儀):
  * ブリッジが実際にパッチした行集合 == 5dの `expectedPatchedLines`。
    実パッチ行の取得は `commitModelBridge` が返すsplice情報を
    devで呼び出し元へ露出する最小限の変更で行う(store公開APIは増やさず、
    既存の `modelCommit` 戻り値/dev hookの慣習に合わせる)。
  * コミット後テキストの再コンパイルで「対象以外の全参照の解決先・
    dangling状態が不変」(5dの検証関数を再利用)。
  * 違反時はdev assert(本番では黙って壊さない=コミット自体は解析済みで
    安全側)。
* 旧 `renameElement`(`cadDocumentStore.ts`)の置換:
  * 自動連番(`makeUniqueElementName`)による暗黙リネームは方針非互換。
    callerがテストのみであることを再確認して削除し、テストを新経路の
    仕様(衝突=拒否)へ書き換える。
* `regenerateCanonicalFromModel` フォールバック(bridge `failed` 時の全体
  再シリアライズ)がrename経路で発動した場合の扱いを確認し、**rename では
  フォールバック発動をdev assert違反として扱う**(行スプライスのみの原則。
  発動する入力が見つかったら修正せず5fへ報告)。

## Out of Scope

* UI(プロンプト・palette・shortcut)— 5g。
* 参照形式の統合カバレッジ網羅 — 5f(本タスクは代表ケースの動作確認まで)。
* `textPatch.ts` / serializer / 解析器の挙動変更(不足は報告のみ。
  解析器の修正は5fの領分)。
* テキスト起点rename(DSL行直接編集)への伝播。

## Existing APIs / files to reuse

* `src/editor/sourceEditSession.ts` — 中央flush(post-cutover文書の共通
  ゲート)。
* `src/state/cadDocumentStore.ts` — `commitDocumentChange` /
  `modelCommit` / `commitModelBridge`(`canonicalDocument.ts`)。
* `src/commands/commandLineUnnamedPromotion.ts` +
  `commandLineSessionCommands.ts` — モデルname変更+1 commitの先行実装
  パターン。
* `cadUiStore.commandErrorMessage` — エラー通知の既存経路。

## Invariants(このタスク固有の事故防止)

* 1リネーム=1 Undoステップ。Undoで対象行と全参照行が一括で戻り、選択も
  復元される(`TextSnapshot` 経路)。
* 拒否時は文書・Undo履歴・選択が完全に不変。
* コメント行・空行・無関係な行が不変(行スプライスのみ)。
* dirty bufferを暗黙に破棄しない(flushが正準化する。`guardDocumentMutation`
  の既存拒否コードと二重ゲートにならないよう既存経路を確認)。
* Phase 4系(CommandLineBar・セッション・pick)状態に触れない。
  セッション進行中のrename実行可否は「文書リビジョンが進むためセッションが
  stale cancellationされる」既存挙動に従う(新しい特別扱いを足さない。
  テストで現行挙動を固定)。

## Edge cases(テスト必須)

* dirty buffer上でrename発行 → flush → 成功(live textの参照が対象)。
* IME composition中 → 拒否・文書不変。
* エラー診断のある文書 → 拒否・明確なエラー。
* コマンドラインセッション進行中にrename確定 → セッションはstale
  cancellation(既存挙動)・renameは成立。
* rename直後のUndo→Redo往復でテキスト完全一致。
* 拒否→同名で再実行(状態が残らない)。

## Tests

* 上記Edge cases+代表参照形式(直接参照・式内・place)での
  「参照行だけがパッチされ他の行は不変」の行diffテスト。
* dev検証(パッチ行集合一致・解決先保存)が違反入力でassertすることの
  テスト(検証器をstub/故意破壊して確認)。
* 旧 `renameElement` の削除に伴うstoreテスト更新。

## Manual verification

* devビルドの実アプリでコンソールからの呼び出し等は不要(UIは5g)。
  テストでの担保を報告すればよい。

## Completion criteria

* `renameElementWithPropagation`(確定名)がテストのみから呼ばれる状態で
  実装され、上記テストすべてgreen。旧 `renameElement` が存在しない。
* test / build / lint green。**完了時にreview境界2のレビューを依頼**。

## Dependencies

* 5d(API凍結済み)。merge順: 5b-2 → 本タスク。

## Handoff to next task

* 5f へ: 代表ケースでカバー済みの形式一覧と、未網羅形式・保守側拒否ケース・
  フォールバック発動入力(あれば)の報告。
* 5g へ: コマンドレベル関数のシグネチャとエラー通知経路。
