# 抜本改善計画: DSLテキストを正とするUI・保存形式の刷新

Status: 承認済み(2026-07-09)。実装はPhase単位で個別のcoding agentに分担する。
各Phaseの実装タスクは `docs/overhaul/tasks/` 参照。

## Context

唯一のユーザーへのヒヤリングで確定した方針。旧形式との互換は不要(一回限りの
インポータのみ用意)。

**現状の問題**:

* 保存JSON(`.nuinui.json` schemaVersion 5)に選択状態などのUI状態が混在し、
  `printLayout` 互換ミラー等の冗長性がある。
* DSLテキストは双方向変換できるのに保存されず、フローティングパネルで
  「書き出し→編集→適用」の往復が必要。Undo履歴も文書とDSLで二系統に分裂。
* UIでは「要素追加後に何度も余計なクリックが必要」「作成時に選択中の要素が
  勝手に基準にされ、それベースで命名される」のが最大の不満。
* 構成リスト(LeftPanel)は非仮想化で大規模文書に弱い。

## 確定した設計判断(ユーザー合意済み)

1. **保存形式 = DSLテキスト1ファイル**(拡張子 `.nui`)。パレット・表示
   プロファイル・印刷レイアウトも全てDSL文で表現。JSON形式は廃止。
2. **メモリ上のコンパイル済み要素モデルが実行時表現**(描画・評価は従来速度)。
   テキストが正・永続。Canvas操作は「該当1行だけの外科的書き換え」に変換
   (他の行・コメント・空行・順序は不変)。ドラッグ中はモデルのみ更新、確定時に
   1行書き戻し=1 Undoステップ。**Undo履歴はテキストベースの一本に統合**。
3. **左ペイン = CodeMirror 6ベースのDSLエディタが構成リストを置換**。
   1行=1要素、カーソル行⇄Canvas選択の双方向同期、グループは折りたたみ。
4. **右ペイン = 読み取り専用インスペクタ**(依存・計測値・診断)。パラメータ
   項目を選ぶとDSL該当行・該当属性へカーソルジャンプ。フォーム型パラメータ
   編集UIは廃止。
5. **作図フローは両方**: (a) AutoCAD風コマンドライン(必須参照を順にプロンプト。
   選択中要素は「Enterで採用できる候補」としてのみ提示——勝手に基準にしない)、
   (b) DSL行を補完付きで直接タイプ。
6. **命名**: 作成フローに名前入力ステップ(自動候補+Enter採用/タイプで上書き/
   スキップで**無名要素**)。DSLは無名文を許可。無名要素が参照されたら自動昇格
   (文脈的な名前を付与し同一Undoステップで行パッチ)。グループスコープ名・
   リネーム安全伝播・**IDの永続化廃止**(実行時IDのみ、パース時に照合割当)。
7. グループ構文は**ブレース `{ }`** ブロック(インデントは見た目のみ)。
8. 旧 `.nuinui.json` → `.nui` の一回限りインポータコマンドを用意。

AGENTS.md の不変条件は全Phaseで維持: キーボードファースト、決定論的評価、
明示的依存エラー、Rust-first評価、`evaluate_document(input)` 境界安定、
mm単位、Y-up。

## 検証済みの前提事実

* DSLは行指向(1文=1行、`DslStatement.line` あり)。現行は `parent=` / `id=`
  属性でフラット(`src/dsl/dslSerializer.ts:40,45`)。
* `commitDocumentChange` 呼び出し元は非テスト13ファイル(commands群・DslPanel・
  templates)。ブリッジで署名を維持すれば書き換え不要。
* 名前空間解決(`resolveElementName`、`A.B.C` 修飾名)は
  `src/model/elementNames.ts` に既存。
* IDはセッションランダム生成(`src/model/cadIds.ts`)で、永続以外にセッション間
  安定性を要求する箇所はない。
* Rust側 `src-tauri/src/document_file.rs` は内容非依存の文字列read/write。
  本計画でRust変更は原則不要。
* ドラッグは既に `previewDocumentChange`(履歴なし)/ `commitDocumentChange`
  (1ステップ)分離済み。

## アーキテクチャ要点

### 正準状態とデータフロー

```
sourceText (正準・永続)
   │ parse + compile
   ▼
CompiledDocument (派生・実行時)          previewElements (ドラッグ中のみ)
   elements / palette / roles /
   profiles / printLayouts /
   evaluationLimitIndex /
   statementMap(要素ID→行範囲+属性スパン) /
   diagnostics
   │
   ▼
描画・評価(Rust evaluate_document)・ヒットテスト
```

変更入口は3つ:

1. `commitText(nextText, origin)` — エディタ・ファイル・インポータ。
   履歴push → 再パース → ID照合 → 再コンパイル。
2. `commitDocumentChange(change)` — **ブリッジ**。現行署名を維持し、モデル差分を
   オブジェクト同一性で検出 → 変更された文だけ再シリアライズして行スプライス →
   再パース+照合。既存コマンド群は無変更で動く。
3. `previewDocumentChange(change)` — `previewElements` のみ設定(履歴・テキスト
   非関与)。描画・評価は `previewElements ?? doc.elements` を読む。

### ID照合(statementReconciler)

パースごとに実行時IDを再割当てするのではなく、直前のコンパイル結果と照合して
可能な限りIDを継承する。優先順位付き5段階(詳細仕様と期待結果の表は
`tasks/phase-1a-pure-modules.md`):

1. 文テキスト配列のLCS差分 — 不変領域はID直接継承(1行編集なら n−1 文が
   O(n) で解決)。
2. 残余の完全キーマッチ「名前空間パス+名前+型」 — 通常の属性編集・行移動は
   ここでID継承(ID変化0)。
3. LCS置換ハンク内の位置対応ペアリング(型+名前空間一致) — **リネーム**と
   無名⇄有名の遷移はここでID継承(ID変化0)。
4. 無名残余を「名前空間+型+相対順序」でマッチ。
5. 残りは新規ID / 消滅。リネーム+行移動の同時実行と型変更は対応不能で
   新規ID(許容制約)。

これにより選択・Undo・評価キャッシュ・Rustペイロードは実行時IDのまま全て
無変更で動く。

### Undo統合

履歴 = テキストスナップショット `{text, selectionIds, cursorLine}` の
past/future、上限200(1000要素×80字≒80KB/枚なので十分軽い。rope不要)。
CodeMirror自体の履歴は「未コミットのタイピングバースト内」のみ有効で、
コミット境界でフェンスする。**ストア履歴が唯一の正**。

## Phase構成と依存関係

```
Phase 0  文書完全表現のDSL文法(挙動変更なし)
  │
Phase 1a 純粋モジュール: statementReconciler / textPatch(アプリ非接続)
  │
Phase 1b 影テキスト維持 + dev等価assert(正準はまだJSONスナップショット)
  │
Phase 1c 正準反転: sourceTextが正・統合Undo・選択状態のUIストア移動
  │
Phase 1d `.nui` 保存/読込 + レガシーインポータ(JSON保存廃止)
  │
  ├── Phase 2  CodeMirror 6 左ペイン(構成リスト置換)
  │      │
  │      ├── Phase 3  読み取り専用インスペクタ + フォーム編集廃止
  │      │
  │      └── Phase 4  コマンドライン作図 + DSL補完(DslPanel削除)
  │             (Phase 3と4は相互独立、並行可。ともにPhase 2に依存)
  │
Phase 5  ハードクリーンアップ(Phase 2・3・4すべての完了後)
```

* 0 → 1a → 1b → 1c → 1d は厳密な直列。
* Phase 2 は 1d 完了後(`.nui` が正になってからエディタを常設化する)。
  技術的には 1c 後でも可能だが、保存形式とUIの整合を保つため 1d 後とする。
* Phase 3 と Phase 4 は Phase 2 の成果物(SourceEditorPane・カーソル同期・
  statementMapベースのジャンプ)に依存するが、相互には独立。並行実装可。
  Phase 2e完了後に追加したEditor polish(値span選択・Tab移動・編集可能
  Line Lens・dirty時Canvas操作の保留など)は
  `tasks/phase-2-post-cutover-editor-polish.md` に記録済みで、Phase 3/4は
  そこにある共通基盤を再利用する(重複実装しない)。
* Phase 3の実装は `tasks/phase-3-inspector.md` を親文書として4子タスクへ
  分割した(2026-07-12): 3a ジャンプAPI → (3b 数値ステップ ∥ 3c
  InspectorPanel) → 3d フォーム編集削除cutover。
* Phase 4の実装は `tasks/phase-4-command-line.md` を親文書として10子タスクへ
  分割した(2026-07-14): コマンドライン系は 4a-1 レシピ基盤 →
  4b セッション → 4c バー+挿入 → 4d ピック連携 → 4e 無名昇格 →
  4f ゴーストプレビュー → 4g 作成コマンドcutover の直列。
  4a-2 レシピ全数カバレッジは4a-1後に4b〜4fと並行可で、4gの前提条件。
  4h DSL補完と 4i DslPanel削除は独立の並行レーン。ピック連携は
  テンプレート挿入で実証済みの「仮想target+insertionIndex」機構を共有し、
  確定コミットは `commitDocumentChange` ブリッジ経由(詳細は親文書の
  確定判断)。
* Phase 5 は全Phase完了後の互換コード削除とリネーム伝播。
* Phase 5の実装は `tasks/phase-5-cleanup.md` を親文書として10子タスクへ
  分割した(2026-07-16): クリーンアップ系は 5a DSL互換縮小 ∥
  (5b-1 レガシー形式デッドコード → 5b-2 スナップショットミラー削除) ∥
  5c command/keyboard掃除 が相互独立・並行可。リネーム系は
  5d 参照解析(純粋) → 5e コマンドcore(bridge/Undo) →
  (5f 参照形式カバレッジ ∥ 5g UI接続) の直列+末端並行。
  5i コマンドライン途中ステップ編集(Phase 4レビューB-6の解消。
  Phase 4挙動不変条件へのユーザー承認済み例外)は全タスクと並行可。
  5h ドキュメント更新は全タスク完了後の最終。merge順(5b-2は5eより先、
  5cは5gより先)とreview境界(5d後・5e後・5h後)は親文書を正とする。
  調査で崩れた当初前提(下記「主な削除対象」の注記、cadUiStoreの死に状態は
  4iで削除済み、rename伝播はブリッジの再シリアライズ追従で大半成立済み等)の
  詳細は親文書「Phase全体の確定判断」を参照。旧command ID対応の確定版は
  `docs/overhaul/command-id-map.md` に集約した。

## Phase 1 分割の根拠

元計画のPhase 1(テキスト正準ストア+形式切替+Undo統合を一括)は最高リスク
だったため、以下の原理で4分割した:

* **1a**: 新規純粋モジュールのみ。アプリに接続しないため挙動変更ゼロ。
  テストだけで品質を確定できる。
* **1b(影モード)**: 正準はJSONスナップショットのまま、全コミットで影の
  DSLテキストを並行維持し、devビルドで「影テキストを再コンパイル≡現モデル」を
  assertする。行パッチのバグが**文書破損ではなくdev警告**として顕在化する
  安全網。ユーザー可視の挙動変更なし。
* **1c**: 影で実証済みの機構の正準を反転するだけ。同時にUndo統合と選択状態の
  移動を行う(新履歴が選択を運ぶため、選択移動を先行させると「Undoで選択が
  戻らない」一時的な退行が生じる。よって1cに同梱するのが最も安全)。
  保存形式は変えない(保存時に `doc` からJSONスナップショットを生成)。
* **1d**: ファイル形式の切替のみ。ストアは触らない。

## 横断リスクと防衛

1. **ブリッジの忠実性が要**: `textPatch` の誤スプライス=テキストとモデルの
   乖離。防衛=1bの影assert+毎コミット再コンパイル検証+ランダムコマンド列の
   プロパティテスト。
2. **ID非永続下の参照安定**: 削除済み名への参照は生トークンのままシリアライズ
   +明示的依存診断(AGENTS.mdルール)。シリアライズは絶対にクラッシュさせない。
3. **「ファイル全体を再シリアライズ」の誘惑を禁止**: コメント・空行保存は
   行スプライスであることの構造的帰結。全体再シリアライズを行うコードパスは
   レビューで却下する。
4. **キーボードファースト回帰面**: Canvas選択→Source Editor focus
   →Tab/Shift+Tab値span移動→直接入力またはAlt+←/→を回帰テストする。
   Inspector専用の旧bindingは代替先なしで安全に正規化除去する。

## 主な削除対象(最終形)

* `LeftPanel.tsx` + `ElementListRow` / `useElementListData` 等リスト系(~2000行)
* `DslPanel.tsx` + ローカル履歴、`DslEditor.tsx`(textarea実装)
* `ElementEditor.tsx`、全 `*ElementFields.tsx`、`ParameterEditors` 系。
  `ExpressionInsertTray` はテンプレート挿入専用ヘルパーとして残し、RightPanel
  とフォーム編集用の状態・commandからは切り離す
* パラメータ編集モード(値編集コマンド)、dependency jump互換、
  Inspector行ナビゲーション。キーボード編集はSource Editorの値span経路が代替
* `documentFormat.ts` の保存経路、`documentMigration.ts`(既に死んでいる)、
  スナップショットの `printLayout` ミラーと `selected*` フィールド
* ~~`id=` / `parent=` / `branch=` のDSL互換(Phase 5)~~ —
  **2026-07-16撤回**: レガシーインポータ出力が3属性で元の評価順を保持し、
  明示 `id=` は同一スコープ重名の正式な逃げ道・レコードIDとして現役のため、
  正式文法として存続させる。Phase 5で削除するのはテスト専用
  `SerializeDslOptions.includeIds` と `expanded=`/`elseExpanded=` 互換のみ
  (詳細は `tasks/phase-5-cleanup.md` 前提修正1)

**`src/parameters/parameterDefinitions.ts` は縮小して存続**: ラベル(インスペクタ・
プロンプト)、値種別(レシピ生成・DSL属性コンパイル)、`stepLevels`(数値ステップ
コマンド)、`choiceOptions`(補完)。`directKey` と編集モード配管は削除。

## 検証(全Phase共通)

* `npm test` / `npm run build` / `npm run lint`
* 評価・ペイロード・Rust適格性に触れたら `npm run test:parity`
* Rust変更時のみ `cargo fmt --check` / `cargo test` / `cargo clippy`
  (本計画では原則Rust変更なし)
* Phase 1c以降: 実アプリで「新規作成→作図→保存→再起動→読込→Undo/Redo→
  Canvasドラッグ→テキスト直編集」のエンドツーエンド動線を毎回確認
* Phase 2でmacOS日本語IME手動チェック
* 最終Phaseで `npm run desktop:build`(notarization警告は想定内)
