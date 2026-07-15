# Phase 5d: rename参照解析(純粋モジュール、アプリ非接続)

> 親文書: [phase-5-cleanup.md](phase-5-cleanup.md)。着手前に `AGENTS.md` →
> `docs/overhaul/plan.md` → 親文書 →
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md)
> の順で読むこと。
>
> 5a / 5b系 / 5c と相互独立・並行可。**本タスク完了時にreview境界1**
> (親文書のreview境界)。

## Context

親文書「前提修正4」のとおり、モデル起点renameの参照行パッチ自体は
`commitDocumentChange` ブリッジ(`textPatch.ts` の再シリアライズ比較)で
創発的に成立する。renameで本当に難しいのは**安全性の判定**であり、それを
アプリ非接続の純粋モジュールとして先に固める:

* 同一スコープの名前衝突は拒否(自動連番しない)。
* **捕獲(capture)の拒否**: 既存のdanglingトークンが新名と同綴りで新たに
  解決されてしまう、またはscope shadowing(`elementNames.ts` の内側優先
  解決)により**既存参照の解決先が変わる** renameを拒否する。
* パッチされる行の**期待集合**を予告し、5eがブリッジの実パッチと突き合わせ
  られるようにする。

参照はモデル内部で実行時 `ElementId` 保持(式文字列内もID埋め込み)なので、
「どの文が対象要素を参照しているか」はコンパイル済みモデルから列挙できる。
一方「renameで解決が変わらないか」はテキスト側のトークン解決
(`resolveElementName`)の前後比較が必要。両方を扱う。

## Goal

`analyzeRename` 相当の純粋APIを新設し、拒否条件・参照出現列挙・期待パッチ行
集合をテストで固定して公開APIを凍結する。アプリへは接続しない(挙動変更ゼロ)。

## Scope

* 新規純粋モジュール(置き場は `src/model/renameAnalysis.ts` を基準に、
  依存方向(`dsl` ↔ `model`)の既存慣習を調査して決める。CM型・store・
  Tauri APIへの依存禁止):

  ```ts
  analyzeRename({
    sourceText,            // 正準テキスト(呼び出し側がflush済みを保証)
    compiled,              // CompiledDslDocument(同テキスト由来)
    targetElementId,
    newName
  }): RenameAnalysis

  type RenameAnalysis =
    | { verdict: "ok";
        occurrences: RenameOccurrence[];   // 参照出現(行番号+形式分類)
        expectedPatchedLines: number[] }   // 対象要素行+参照行の期待集合
    | { verdict: "rejected";
        reason: "same-scope-conflict" | "resolution-change"
              | "invalid-name" | ...;      // 実装時に確定・凍結
        detail: {...} }                    // 衝突相手・変化した参照の行/名前
  ```

  シグネチャは目安。実装時に洗練してよいが、完了時に凍結して報告すること。
* 拒否条件(いずれもエラーに行番号・相手要素名を含める):
  1. **同一スコープ衝突**: `newName` が対象要素の名前空間
     (`namespaceKey(parentGroupId)`)内の既存名と衝突
     (`reportDuplicateNames` / `makeUniqueElementName` と同じスコープ規則を
     再利用。独自実装しない)。
  2. **解決先変化(捕獲含む)**: rename後の文書で、rename対象への参照以外の
     全参照について「解決先要素ID」と「dangling状態」が前後で一致しない。
     判定は実際にrename後の文書を**メモリ内で**再シリアライズ+再コンパイル
     (または同等の解決再計算)して参照解決を突き合わせる方式を推奨
     (トークン種別ごとの手書き判定を再発明しない)。ID照合は
     `assignedElementIds` 相当でrename前のIDを引き継がせること。
  3. **不正な名前**: 空文字・DSLトークンとして表現できない名前
     (`formatDslName` で引用可能なら許容)。既存要素名と同じ検証規則に
     合わせる(新規の名前規則を発明しない)。
* 参照出現の列挙(形式分類つき): 直接参照 / `名前.端点`・`名前.pointKey`
  派生 / 式内(`@変数`・`要素名.parameterKey`・`id:key`・関数引数形) /
  名前空間修飾(`グループ::名前`、絶対 `::`) / printLayout `place` /
  グループrename時の子孫修飾名参照。compiled側のID参照グラフから列挙し、
  行番号は `statementMap` / statement `line` で対応付ける。
* `expectedPatchedLines`: 「rename後に再シリアライズ結果が変わる文」の行
  集合。`textPatch.ts` の比較意味論(`serializeElementStatement` 比較・
  printLayoutブロック再シリアライズ)と一致させること。
* 1,000要素文書での実行コストassert(既存perfテストの緩い上限パターン。
  実測は `--disable-console-intercept` で確認)。

## Out of Scope

* store・コマンド・UIへの接続(5e/5g)。
* `textPatch.ts` / `dslSerializer.ts` / `elementNames.ts` の挙動変更
  (再利用のみ。不足を見つけたら修正せず報告)。
* テキスト起点rename(DSL行の直接編集)の伝播 — 対象外が仕様
  (親文書の確定判断)。
* rename以外の操作(移動・型変更等)の解析。

## Existing APIs / files to reuse

* `src/dsl/dslParser.ts` `parseDsl` / `src/dsl/dslDocument.ts`
  `compileDslDocument`(パース・コンパイル・`statementMap`)。
* `src/model/elementNames.ts` — `resolveElementName` /
  `namespaceKey` / `elementQualifiedNameParts` / `makeUniqueElementName`
  (スコープ規則の唯一の正)。
* `src/dsl/dslSerializer.ts` `documentDslRefs` /
  `src/dsl/dslExpressionFormat.ts`(式内ID→トークン解決)。
* `src/document/textPatch.ts` — 変更文検出の比較意味論
  (`elementUpdateSetForTesting` 等のテスト用exportも参照)。
* `src/document/documentTestGenerators.ts` — プロパティテストの生成器。

## Invariants(このタスク固有の事故防止)

* 純粋・決定的: 同じ入力に同じ出力。ID生成が必要な場合はoptions注入
  (`createId` 既定=本番実装)のプロジェクト慣習に従う。
* アプリの挙動変更ゼロ(どこからもimportされない新規モジュール+テストのみ)。
* 拒否判定は**保守側に倒す**: 解決の同一性が証明できないケース(解析器が
  扱えない形)は `ok` にせず拒否する。誤って通すより誤って拒否する方が安全。
* 単純な文字列置換をいかなる内部段階でも使わない(コメント・別scope同名・
  無関係な同一文字列・既存dangling参照を構造的に巻き込まないため)。

## Edge cases(テスト必須)

* 新名が既存danglingトークンと同綴り → 拒否(捕獲)。
* グループ内要素を、外側の同名要素を参照している内側文が「shadowして
  しまう」名前へrename → 拒否(解決先変化)。
* rename対象自身が現在danglingトークンで参照されている(生IDトークン参照)
  場合の扱い: 明示 `id=` で永続しているIDへの参照は解決が変わらないこと。
* 無名要素のrename(名前なし→あり): occurrences空でも要素行はパッチ対象。
* 同名要素が別スコープに複数ある文書でのrename(修飾名参照の追従)。
* グループrename: 子孫の修飾名参照・printLayout `place`・別グループからの
  `グループ::名前` 参照が漏れなくoccurrencesに載る。
* 日本語名・空白入り名(`formatDslName` の引用)・`::` を含む不正名の拒否。

## Tests

* 上記Edge casesの単体テスト+形式分類ごとの列挙テスト。
* プロパティテスト: 生成文書に対しランダムrename→ `verdict: "ok"` の場合、
  rename適用後の再コンパイルで「対象以外の全参照の解決先・dangling状態が
  不変」をassert(検証器自身の自己検証)。
* `expectedPatchedLines` が `textPatch` の実スプライス行と一致することの
  単体近似テスト(ブリッジ接続そのものは5e)。
* 1,000要素perf assert。

## Manual verification

* 不要(アプリ非接続)。

## Completion criteria

* 公開APIが凍結され(型・拒否reason一覧を報告)、上記テストがすべてgreen。
* 挙動変更ゼロ(既存テスト全green、アプリからの参照ゼロ)。
* test / build / lint green。**完了時にreview境界1のレビューを依頼**。

## Dependencies

* なし(Phase 4完了のみ)。5a / 5b系 / 5c と並行可(5aと同時進行時は
  5a先行merge)。

## Handoff to next task

* 5e へ: 凍結した公開API・拒否reason一覧・`expectedPatchedLines` の意味論。
* 5f へ: 解析器が「保守側拒否」にしたケースの一覧(統合カバレッジで
  実挙動を固定する対象)。
