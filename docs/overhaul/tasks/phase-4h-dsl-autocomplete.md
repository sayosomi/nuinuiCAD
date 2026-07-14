# Phase 4h: エディタ内DSL文脈補完(cmAutocomplete)

> 親文書: [phase-4-command-line.md](phase-4-command-line.md)。着手前に
> `AGENTS.md` → `docs/overhaul/plan.md` → 親文書 →
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md)
> の順で読むこと。
>
> コマンドライン系タスク(4a-1〜4g)とは**完全に独立**。いつでも並行実装可。

## Context

作図フローの第2系統「DSL直接タイプ」を支える補完。`@codemirror/autocomplete`
は依存に入っているが未接続。CM型を `src/editor/` の外へ漏らさない境界
(post-cutover文書)の内側に実装する。

## Goal

新規行・既存行の編集時に、カーソル文脈に応じた補完が出る:
行頭=文キーワード、参照位置=名前空間対応の要素名(`名前.端点` 派生形含む)、
属性位置=属性キーと `choiceOptions` 値。

## Scope

* 新規 `src/editor/cmAutocomplete.ts` — `CompletionSource` 実装+
  文脈判定の純粋ヘルパ(純粋部分はCM非依存で単体テスト可能に分離する。
  例 `src/dsl/dslCompletionContext.ts`)。
* 補完文脈:
  1. **行頭(文キーワード位置)**: 要素型キーワード+非element文キーワード
     (`nui` / `role` / `view` / `color` / `printLayout` / `@stop` / グループ
     開始等)。正は `dslParser` / `dslTokens` が受理するキーワード集合。
  2. **参照位置**(属性値が参照kindの位置): カーソル行より**前**の要素の
     名前(名前空間修飾形 `A.B.C` を含む)+線要素は `名前.start` /
     `名前.end` 等の派生形。前方参照になる名前は候補に出さない
     (文書順依存の原則)。無名要素は候補に出さない。
  3. **属性位置**(属性キー): その文の要素型の属性キー
     (`parameterDefinitions` 由来のキー→DSL属性名)。choice属性の値位置では
     `choiceOptions`。
* controller(`sourceEditorController.ts`)への接続: extension追加、
  IME composition中は補完を出さない(既存guardに従う)、明示起動
  (Ctrl+Space等CM標準)+タイプ中の自動起動。
* Line Lensでの補完は**スコープ外可**(mainのみで完了条件を満たす。
  lens対応する場合はmainと同一ソースを使うこと)。

## Out of Scope

* コマンドラインバーの補完(4dの名前サジェストは別UI)。
* 文法自体の変更・新キーワード追加。
* snippet展開・テンプレート挿入(既存機能のまま)。
* 診断・lint(既存のdiagnosticsのまま)。

## Existing APIs / files to reuse

* `src/dsl/dslTokens.ts` / `dslParser.ts` / `dslReferenceTokens.ts` —
  トークン種別と参照トークン形。
* `src/dsl/dslValueSpans.ts` / `dslParameterSpans.ts` — 行単独reparseで
  属性位置を判定する既存パターン(dirtyバッファでも正しい唯一の方法)。
  **独自の行パーサを書かない**。
* `src/model/elementNames.ts` — 修飾名構築(`buildQualifiedNameById`)。
* `src/parameters/parameterDefinitions.ts` — 属性キー・`choiceOptions`。
  parameterKey→DSL属性名の対応はPhase 3aで作ったマッピング
  (`dslParameterSpans` 系)を再利用する。
* `src/editor/cmLanguage.ts` — 既存のCM言語設定(拡張の追加位置)。
* `src/editor/statementRangeIndex.ts` — カーソル行→文indexと前方要素集合。

## Invariants

* CM型・importは `src/editor/` と `SourceEditorPane.tsx` の内側のみ。
* 文脈判定は**現在のCMバッファのテキスト**(dirty含む)を正とし、コンパイル
  済みモデルは名前集合の取得のみに使う(行の構文判定に使わない)。
* 参照候補はカーソル行より前の要素のみ(評価順の原則をUI側でも守る)。
* IME composition中に補完ポップアップを出さない・確定済みテキストを
  変更しない。
* 補完の適用はCMの通常のuserEvent付きtransaction(Undoは通常のタイピングと
  同じ扱い。selection-only規則の対象外)。
* 大規模文書(1,000要素)で入力毎の候補生成が体感遅延しないこと
  (名前集合のキャッシュは既存の再計算タイミングに合わせる)。

## Edge cases

* 空行・コメント行・parse errorのある行(補完を出さない or 行頭キーワード
  のみ、を文脈判定で明確に)。
* ブロック開始行(末尾 `{`)・グループ内のインデント行頭。
* 名前に日本語を含む要素の補完とIMEの相互作用(composition確定後に候補が
  出る)。
* `名前.` までタイプした時点での派生形候補(線の端点等)。
* 同名要素が別スコープにある場合の修飾名候補の一意性。

## Tests

* 文脈判定純粋ヘルパの単体テスト(行頭/参照位置/属性キー位置/choice値
  位置/コメント・エラー行/ブロック行)。
* 参照候補の前方限定・無名除外・修飾名・派生形。
* 属性キー候補が要素型ごとに `parameterDefinitions` 由来のDSL属性名と
  一致すること(乖離検出のマトリクステスト)。
* controller統合: composition中に候補が出ないこと。
* 性能: 1,000要素文書での候補生成コストのassert(既存の性能テストの
  緩い上限パターンに従う。実測は `--disable-console-intercept` で確認)。

## Manual verification

* 実アプリで新規行タイプ→行頭キーワード補完→参照位置で名前補完→属性
  キー補完の一連。日本語IMEで名前をタイプして補完が邪魔しないこと。

## Completion criteria

* 親文書の完了条件「エディタ内で新規行タイプ時に文脈補完が機能」を満たす。
* `npm test` / `npm run build` / `npm run lint` green。

## Dependencies

* Phase 2完了(済み)のみ。4a-1〜4g・4iと並行可。

## Handoff to next task

* Phase 5でのDSL互換削除(`id=` / `parent=` 等)の際、補完候補からも同時に
  消えるよう、キーワード集合の正が `dslTokens` / `dslParser` にあることを
  報告に明記する。
