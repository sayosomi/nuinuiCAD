# Phase 5: ハードクリーンアップ + リネーム伝播(親文書)

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。
> Phase 2・3・4 すべての完了後に着手する(2026-07-15時点で完了済み。
> Phase 4レビュー指摘 B-1〜B-4・B-7 は `ff0b736` で修正済み)。
>
> **実装分割(2026-07-15)**: 本Phaseは以下の9タスクへ分割する。本ファイルは
> Phase全体の要件・確定判断・依存順を定める**親文書**であり、実装時は担当する
> 子タスク文書を正とする。共通要件(検証コマンド・報告様式・AGENTS.md遵守)は
> 本文書と `tasks/README.md` に置き、子文書には重複記載しない。
>
> 1. [phase-5a-dsl-compat-reduction.md](phase-5a-dsl-compat-reduction.md) —
>    DSL互換の縮小掃除(`includeIds` 削除+`expanded=`/`elseExpanded=` 互換削除)
> 2. [phase-5b-1-legacy-format-dead-code.md](phase-5b-1-legacy-format-dead-code.md) —
>    レガシー文書形式のデッドコード削除(`documentMigration.ts` 削除+
>    `documentFormat.ts` 縮小。インポータは維持)
> 3. [phase-5b-2-snapshot-mirror-removal.md](phase-5b-2-snapshot-mirror-removal.md) —
>    change/スナップショット型の `selected*`・`printLayout` ミラー削除+
>    読み手の派生化
> 4. [phase-5c-command-keyboard-cleanup.md](phase-5c-command-keyboard-cleanup.md) —
>    command/keyboard掃除(`data-element-list`・`focusElementList` リネーム・
>    retired ID再分類+確定版対応表反映)
> 5. [phase-5d-rename-analysis.md](phase-5d-rename-analysis.md) —
>    rename参照解析の純粋モジュール(アプリ非接続)
> 6. [phase-5e-rename-command-bridge.md](phase-5e-rename-command-bridge.md) —
>    renameコマンドcore(flush→解析→拒否 or 1 commit+dev検証。UIなし)
> 7. [phase-5f-rename-coverage.md](phase-5f-rename-coverage.md) —
>    rename参照形式の統合カバレッジ+判明した不足の修正(5d/5eモジュール内限定)
> 8. [phase-5g-rename-ui.md](phase-5g-rename-ui.md) —
>    rename UI接続(専用最小プロンプト+コマンド登録)
> 9. [phase-5h-docs-update.md](phase-5h-docs-update.md) —
>    ドキュメント更新(AGENTS.md / ROADMAP.md / docs/dsl.md / 対応表確定。最終)
>
> 依存順: **5a ∥ (5b-1 → 5b-2) ∥ 5c ∥ 5d** は相互独立で並行可。
> rename系は **5d → 5e → (5f ∥ 5g)** の直列+末端並行。
> **5h は全タスク完了後の最終タスク**。
> merge順・review境界は後述の専用節を正とする。
> 各子タスクはアプリが完全に動作する状態
> (`npm test` / `npm run build` / `npm run lint` green)で着地する。

## Phase全体の確定判断(2026-07-15。当初のPhase 5スケッチに優先)

当初の本文書は Phase 0 時点のスケッチであり、Phase 1〜4 の実装で前提が複数
崩れている。現行コード調査に基づき以下を確定する。

### 前提修正1: `id=` / `parent=` / `branch=` は削除しない(正式文法として存続)

当初の「DSL互換の削除」対象だったが、調査で以下が判明したため**削除を取りやめ、
正式文法として文書化する**(ユーザー確認済み 2026-07-15):

* レガシーインポータの出力自体が flat mode(`legacyImport.ts:53` →
  `serializeDocumentToDsl(…, { preserveElementOrder: true })` → `flatRefs`)で
  全要素に `id=` を付け、`parent=` / `branch=` と生ID参照で元の評価順を保持する
  (`legacyImport.ts:51-52` のコメントに明記)。当初の前提「インポータ出力に
  含まれていないことを確認してから削除」は成立しない。
* 明示 `id=` はコンパイル時に実行時要素IDとして最優先採用され
  (`dslCompiler.ts` の `compileDslToElements`)、同一スコープ重名の正式な
  逃げ道(`dslParser.ts` の `reportDuplicateNames` が `id=` 保持文を重複エラー
  から除外)。Phase 4レビューB-3修正の重名 `@変数` 補完も明示 `id=` を第一の
  解決手段に使う(`dslVariableCompletionCandidates.ts`)。
* `parent=` / `branch=` に非推奨診断は存在しない(`dslParser.test.ts`
  「accepts parent= and branch= attributes」が診断ゼロを期待)。「非推奨診断ごと
  削除」という当初記述は現状と不一致。
* role / view / printLayout / palette 文の `id=` はレコードIDとして別系統の
  現役文法。

DSL互換削除の実対象は **テスト専用の `SerializeDslOptions.includeIds`** と
**1c-1由来の `expanded=` / `elseExpanded=` 互換受理+警告**(`dslCompiler.ts`)に
縮小する(→ 5a)。

### 前提修正2: cadUiStore に「死んだ状態」は残っていない

当初の「DslPanel窓・廃止ダイアログ・パラメータ編集モード関連フラグの削除」は
Phase 3d / 4i で完了済み。`layoutSettingsStorage.ts` はwhitelist再構築のため
`dslPanelWindow` は構造的に無視される(テストあり)。store掃除の実体は
keyboard / command 側の残骸のみ(→ 5c)。

### 前提修正3: JSON残骸の実態

`documentMigration.ts` は importer ゼロの完全なデッドコード。一方
`documentFormat.ts` はインポータ(`parseCadDocumentFile`)と in-memory の
change/スナップショット型として現役。`selected*` フィールドと `printLayout`
ミラーは保存(`.nui`)には出ないが、change/history型
(`CadDocumentSnapshot`)と読み手(`printSvgExport` / `printPdfExport` /
`PrintLayoutView` / `DrawingCanvas`)が生きている。削除はデッドコード除去
(→ 5b-1)と、change型再構成+読み手の派生化(→ 5b-2)の2段に分ける。

### 前提修正4: rename伝播の大半は既存機構で成立しており、実作業は検証と拒否

* モデル内部の参照はすべて実行時 `ElementId` で保持され(式文字列内も
  `@<id>`・`<id>.<prop>`・`<id>:<key>` のID埋め込み)、シリアライズ時に
  `documentDslRefs` / `dslExpressionFormat.ts` が名前トークンへ解決する。
  そのため**モデル起点のrenameは `textPatch.ts` の再シリアライズ比較で参照行が
  自動追従する**(name変更時はfast pathが無効化され全要素が再シリアライズ比較
  される)。Phase 4e の無名昇格(`commandLineUnnamedPromotion.ts` + 1回の
  `commitDocumentChange`)が同一機構の先行実装。行末コメントは `textPatch` が
  保存し、行コメント・空行は行スプライスで不変。
* よって当初の「`textPatch.ts` の自然な拡張として実装」は不正確。実作業は
  (1) 衝突・捕獲を拒否する**純粋解析**(5d)、(2) flush・クリーンコンパイル
  ゲートと1 commit+dev検証の**コマンドcore**(5e)、(3) **参照形式ごとの統合
  カバレッジと不足修正**(5f)、(4) **UI接続**(5g)。
* store既存の `renameElement`(caller はテストのみ)は `makeUniqueElementName`
  による**自動連番**を行うため「衝突は拒否」方針と非互換。**流用禁止**。5eで
  置換・削除する。
* テキスト起点のrename(ユーザーがDSL行の名前を直接編集)は**伝播対象外**。
  従来どおり参照側は明示的なdangling診断になる(暗黙の書き換えをしない)。
  伝播は明示的なrenameコマンド経由のみ。

### 確定判断: rename検証の不変条件を強化する

当初の「伝播後にdangling参照が増えていないこと」だけでは不十分。既存の
danglingトークンが新名と同綴りで**新たに解決されてしまう捕獲**や、scope
shadowingによる**解決先の変化**を検出できない。不変条件は:

> **rename対象要素への参照以外は、文書内の全参照の「解決先要素ID」と
> 「dangling状態」が rename 前後で完全に一致する。一致しないrenameは
> コミット前に拒否する。**

### 確定判断: view / role は要素をIDで参照するため rename の影響外

要素→roleの参照は `roles=[<roleId>]`、view→roleもrole IDで、名前参照では
ない。当初文書の「view/roleの参照」は伝播対象ではなく、**「renameで不変で
あること」を検証する対象**として扱う(→ 5f)。printLayout の `place` は
グループを名前トークンで参照するため伝播対象。

### 確定判断: rename UI は専用最小プロンプト(ユーザー確認済み 2026-07-15)

CommandLineBar・セッション状態機械には手を入れない(Phase 4完成品の挙動
不変)。選択要素に対しコマンドで起動する小さな名前入力プロンプトを新設する
(→ 5g)。

### 確定判断: Phase 4レビュー残件 B-5・B-6・性能テスト拡充は本Phaseに含めない

* **B-5**(バーのnumeric参照ピックが `property: "length"` 固定)と
  **B-6**(全ステップ完了前は完了済み行チップが無反応)は CommandLineBar /
  セッションの挙動変更であり、「Phase 4で追加した完了済み値再編集・
  CommandLineBar・補完・pick routingはPhase 5で挙動変更しない」の申し送りと
  本文書の「ついで機能追加禁止」に抵触する。→ 後述のbacklogへ。
* **性能テスト拡充**(`@variable` / `要素名.parameterKey` / printLayout候補・
  CommandLineBar側候補生成のperf)はテストのみだがPhase 4機能のhardeningで
  あり本Phaseの目的(削除・整理・rename・文書)外。→ backlogへ。代替として
  rename解析には1,000要素のperf assertを5d/5fで持たせる。

## 目的

移行期間用の互換コード・デッドコードを削除して最終形にし、リネームの安全
伝播を実装し、AGENTS.md / ROADMAP.md / docs/dsl.md を新アーキテクチャに
合わせて更新する。

## 変更対象(縮小後サマリ。詳細は各子文書)

* **DSL互換の縮小掃除**(5a): `SerializeDslOptions.includeIds`、
  `expanded=` / `elseExpanded=` 互換受理+警告。
* **レガシー形式デッドコード**(5b-1): `documentMigration.ts` 削除、
  `documentFormat.ts` の未使用面縮小。**レガシーインポータは残す**。
* **スナップショットミラー**(5b-2): change/スナップショット型の
  `selected*`・`printLayout` ミラー削除、読み手のactive state派生化。
* **command/keyboard掃除**(5c): `data-element-list` matcher削除、
  `focusElementList` / `enterElementListMode` リネーム、retired IDの
  現役/retired/完全削除の実コード再分類、確定版対応表
  [`../command-id-map.md`](../command-id-map.md) への反映。
* **リネーム伝播**(5d〜5g): 上記確定判断のとおり。
* **ドキュメント更新**(5h): AGENTS.md(差分更新)、ROADMAP.md(全面)、
  docs/dsl.md、対応表確定、plan.md / README整合。

## 守るべき不変条件(全子タスク共通)

* リネームは参照を壊さない・奪わない: 上記の強化不変条件(解決先保存)を
  コミット前検証+devアサートの両方で守る。
* リネーム先が同一スコープで衝突する場合は**拒否+明確なエラー**
  (自動連番リネームしない)。
* 削除済み名への既存dangling参照は従来どおり「生トークン+明示的依存診断」の
  まま(リネーム伝播の対象にしない。新名と同綴りなら**拒否**)。
* 1リネーム=1 document change=1 Undoステップ(モデル更新・全参照パッチ込み)。
* renameは行スプライスのみ。コメント・空行・無関係な行は不変。
  「ファイル全体を再シリアライズ」するコードパスは書かない(plan.md 横断
  リスク3)。
* インポータ(`legacyImport.ts`)は削除しない。`id=` / `parent=` /
  `branch=` の受理・コンパイル挙動を変えない。
* Phase 4で追加した完了済み値再編集・CommandLineBar・補完・pick routingの
  挙動を変えない。
* Source EditorのdirtyなCodeMirror bufferが正。文書を変更する新コマンドは
  必ず `sourceEditSession.flush(reason)` を通し、`"blocked-composition"` なら
  実行しない(post-cutover文書の共通ゲート)。
* 保存済みshortcut・レイアウト設定の既存正規化・migrationを壊さない。
  未知IDは安全に無視される。

## Phase開始時点の前提

* Phase 0〜4 すべて完了済み。アプリは `.nui` 正準・常設Source Editor・
  読み取り専用インスペクタ・コマンドライン作図・DSL補完で動作している。
* 現在のEditor仕様・再利用API・重複実装禁止リストは
  [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md)
  を正とする。
* retired command IDの正規化機構(`shortcutSettingsStorage.ts` の
  `retiredCommandIds` + `legacyBindingIdMap` + 書き戻し)は実装済み。
* 4iからの明示的な残件: `data-element-list` matcher削除と
  `focusElementList` リネーム(→ 5c)。

## 子タスクと依存関係

```
5a dsl-compat-reduction ────────────┐
5b-1 legacy-format-dead-code        │
  └─ 5b-2 snapshot-mirror-removal   ├─(相互独立・並行可)
5c command-keyboard-cleanup         │
5d rename-analysis ─────────────────┘
  └─ 5e rename-command-bridge
       ├─ 5f rename-coverage   ┐並行可
       └─ 5g rename-ui         ┘
            └─(全タスク完了後)5h docs-update
```

| タスク | 依存 | 並行可否 |
|---|---|---|
| 5a | なし | 5b-1/5b-2/5c/5dと並行可 |
| 5b-1 | なし | 同上 |
| 5b-2 | 5b-1 | 5a/5c/5dと並行可 |
| 5c | なし | 5a/5b系/5dと並行可 |
| 5d | なし | 5a/5b系/5cと並行可 |
| 5e | 5d(+5b-2のmerge先行。下記merge順) | — |
| 5f | 5e | 5gと並行可 |
| 5g | 5e(+5cのmerge先行。下記merge順) | 5fと並行可 |
| 5h | 5a〜5gすべて | — |

## merge順(同時進行時の衝突回避)

* 推奨全体順: **5a → 5b-1 → 5b-2 → 5c → 5d → 5e → (5f ∥ 5g) → 5h**。
* **5b-2 は 5e より先にmergeすること**(両者とも `cadDocumentStore.ts` を
  編集する)。
* **5c は 5g より先にmergeすること**(両者とも `commandTypes.ts` /
  command定義群を編集する)。
* 5b-1 と 5b-2 は `documentFormat.ts` が重なるため直列(5b-1 → 5b-2)。
* 5a と 5d は `src/dsl/` のシリアライザテスト周辺が重なりうる。同時に走らせる
  場合は5aを先にmergeする。

## review境界

以下の3点で人手レビュー(または `/code-review`)を入れてから次へ進む:

1. **5d完了時** — rename解析基盤(純粋モジュール)のAPI・拒否条件・
   参照形式列挙の妥当性。
2. **5e完了時** — rename bridge(flushゲート・1 commit・dev検証)の安全性。
3. **5h完了時** — Phase 5全体(削除の完全性・ドキュメント整合・フルチェック)。

## 子タスクへの実行プロンプト(コピーして使う)

共通前置き(全タスク先頭に付ける):

> AGENTS.md → docs/overhaul/plan.md →
> docs/overhaul/tasks/phase-5-cleanup.md(親文書)→ 自分のタスク文書の
> 順で読んでから着手すること。タスク文書のOut of Scopeは境界であり、
> 隣のタスクの作業を先取りしない。完了時は完了条件の充足状況・実行した
> チェック・スコープ外の発見(修正せず報告のみ)をハンドバックすること。

| タスク | プロンプト本文 |
| --- | --- |
| 5a | docs/overhaul/tasks/phase-5a-dsl-compat-reduction.md を実装して。`id=`/`parent=`/`branch=` の受理・インポータ・重名`@変数`補完には一切触れず、includeIdsとexpanded=/elseExpanded=互換の削除のみで着地すること。 |
| 5b-1 | docs/overhaul/tasks/phase-5b-1-legacy-format-dead-code.md を実装して。レガシーインポータの動作を維持したままデッドコードだけを削除し、インポートroundtripテストで確認すること。スナップショット型の再構成(5b-2)を先取りしない。 |
| 5b-2 | docs/overhaul/tasks/phase-5b-2-snapshot-mirror-removal.md を実装して。`.nui`形式・Undo挙動・印刷出力を不変に保ったままchange/スナップショット型からselected*とprintLayoutミラーを除去し、読み手を派生セレクタへ移行すること。 |
| 5c | docs/overhaul/tasks/phase-5c-command-keyboard-cleanup.md を実装して。既存のshortcut正規化・migrationを1つも壊さず、現役/retired/完全削除を実コードから再分類し、docs/overhaul/command-id-map.md の「予定」行を確定させること。 |
| 5d | docs/overhaul/tasks/phase-5d-rename-analysis.md を実装して。純粋モジュールのみでアプリ非接続、挙動変更ゼロで着地し、拒否条件(衝突・捕獲・解決先変化)と参照形式列挙をテストで固定して公開APIを凍結すること。 |
| 5e | docs/overhaul/tasks/phase-5e-rename-command-bridge.md を実装して。flush→クリーンコンパイル→5d解析→拒否 or 1回のcommitDocumentChangeの経路のみで実装し、dev検証(パッチ行集合一致・解決先保存)まで含めること。UIは作らない。旧renameElement(自動連番)を置換すること。 |
| 5f | docs/overhaul/tasks/phase-5f-rename-coverage.md を実装して。全参照形式の統合カバレッジを追加し、判明した不足の修正は5d/5eで追加したrename解析・bridgeモジュールと関連テストに限定すること。他機能へ変更を広げない。 |
| 5g | docs/overhaul/tasks/phase-5g-rename-ui.md を実装して。専用最小プロンプトとコマンド登録のみで実装し、CommandLineBar・pick routing・補完には一切触れないこと。衝突時はエラー表示+入力継続。 |
| 5h | docs/overhaul/tasks/phase-5h-docs-update.md を実装して。実装は変更せずドキュメントのみ更新し、フルチェック(desktop:build含む)で着地すること。 |

## 完了条件(Phase全体)

* 5a〜5hの全子タスク完了。grepで `includeIds` / `expanded=`互換 /
  `documentMigration` / `data-element-list` / `focusElementList`(旧名)の
  参照が残っていない(ドキュメント内の歴史的言及と対応表は除く)。
* リネーム伝播が全参照形式で動作し、必須テスト行列(5f)が固定されている。
* 未知コマンドIDを含むショートカット設定が安全に無視される(5cでテスト固定)。
* AGENTS.md / ROADMAP.md / docs/dsl.md が新アーキテクチャを正しく記述(5h)。
* フルチェック: `npm test` / `npm run test:parity` / `npm run build` /
  `npm run lint` / `npm run desktop:build`(notarization警告は想定内)。

## やってはいけないこと

* レガシーインポータの削除。`id=` / `parent=` / `branch=` の受理・コンパイル
  挙動の変更。
* リネーム衝突時の自動修復(連番付与等)。単純な文字列置換によるrename
  (コメント・別scopeの同名・無関係な同一文字列・既存dangling参照を巻き込む)。
* DSL内へruntime element IDを正準参照として書くこと(rename伝播でもID依存の
  置換へ逃げない。明示 `id=` 属性として既にテキストに永続しているものは別)。
* compiled modelだけを見たrename書き換え(必ず中央flush後の正準テキストを
  解析し、実際に同じ対象へ解決される参照だけを行patchする)。
* B-5・B-6・性能テスト拡充ほか「ついで」の機能追加・挙動変更。本Phaseは
  削除・整理・リネーム伝播・ドキュメント更新のみ。
* AGENTS.md の全面書き換え(変更点のみ差分更新。既存の製品原則は維持)。
* 「ファイル全体を再シリアライズ」するコードパスの追加。

## Phase 5に含めない事項(backlog。着手は別途ユーザー判断)

| 項目 | 内容 | 除外理由 |
|---|---|---|
| B-5 | バーのnumeric参照ピックが `property: "length"` 固定(`commandLineSessionCommands.ts`)。Canvas経路・`要素名.parameterKey` 補完で代替可 | CommandLineBarの挙動変更にあたる |
| B-6 | 全ステップ完了前は完了済み行チップが無反応(`beginStepEdit` が `sessionCanConfirm` を要求) | セッション状態機械の挙動変更にあたる |
| 性能テスト拡充 | `@variable` / `要素名.parameterKey` / printLayout候補・CommandLineBar側候補生成のperfカバレッジ | Phase 4機能のhardeningでPhase 5目的外 |
| レガシーインポータ削除 | ユーザーが不要と明言したら別途 | 従来どおり |
