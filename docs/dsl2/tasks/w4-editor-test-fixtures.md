# W4: エディタ系テストのリテラル間接化

種別: v1 で配線 / 依存: なし

## 目的

エディタ層のテストに散在する v1 DSL リテラルを、serializer 生成・共有ヘルパ経由に
置き換え、C1 の切替時に自動追従するようにする。C1 セッションの差分量を決める
準備タスク。

## 対象範囲

対象テスト(v1 リテラルを含むもの): `dslValueSpans` / `dslValueStep` /
`dslCompletion*` / `cmAutocomplete` / `sourceEditorController*` /
`sourceEditorPickSelection` / `renameAnalysis*` / `statementReconciler` /
`cadDocumentStore` 系のテストファイル。

- リテラルが**手段**(何かの要素を含む文書が欲しいだけ)のテスト:
  `serializeElementStatement` / `serializeDocumentToDsl` / 既存
  `dslDocumentTestUtils.ts` 経由で要素から文書テキストを生成する形へ書き換える。
  必要なら共有ビルダ(要素配列 → 文書テキスト)を `dslDocumentTestUtils.ts` に
  追加する。
- リテラルが**主題**(構文そのものを検証)のテスト: そのまま残し、行頭に
  マーカーコメント `// dsl2-cutover: v1-literal` を付ける。C1 はこのマーカーを
  grep して書き換え対象を列挙する。

## 対象外

- DSL コア層のテスト(`dslParser` / `dslCompiler` / `dslSerializer` /
  `dslDocument` / `textPatch` — 構文が主題なので C1 で P7 の正準リテラルへ
  書き換える)。テストの検証内容の変更(挙動の意味を変えない純リファクタ)。

## 実装要点

- 生成経由化により、期待値(span 位置・行番号など)がハードコードだと serializer
  出力に依存して壊れやすくなる。期待値も生成テキストから導出する
  (`indexOf` 等)か、意味的な検証(span の中身が値文字列と一致する等)へ寄せる。
- 1 ファイルずつ完結させ、全テスト green を保ったままコミット可能な粒度で進める。
- 書き換えの網羅は grep(`point .* = \(`、`key=`、`->` などの v1 構文パターン)で
  棚卸しし、結果の一覧(ファイル → 生成経由化 or マーカー)を本文書の引き継ぎ欄に
  残す。

## テスト

- 既存テストの検証意図を変えずに全 green(本タスク自体が純テストリファクタ)。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。
- エディタ層テストの v1 リテラルが「生成経由」か「マーカー付き」のどちらかに
  分類済みで、未分類リテラルが grep でゼロ。

## 次タスクへの引き継ぎ

- 実施内容: `src/dsl/dslDocumentTestUtils.ts` に共有ビルダを3つ追加した。
  - `dslLinesForElements(elements, evaluationLimitIndex?)` — `layoutElementTree` +
    `documentDslRefs` を使い、パレット/可視性/印刷レイアウトの定型セクションを
    含まない要素ツリー本文行のみを生成する(通常の「手段」テストのデフォルト)。
    `evaluationLimitIndex` を渡すと `@stop` マーカーを含む出力も生成できる。
  - `dslTextForElements(elements, evaluationLimitIndex?)` — 上記に `nui 1` ヘッダを
    付けた全文。
  - `dslFlatTextForElements(elements)` — `serializeDocumentToDsl(..., {
    preserveElementOrder: true })` 経由の flat モード。`id=`/`parent=`/`branch=`
    属性を明示出力し、参照も生 ID トークンで書く(グループのブレース構造は
    出力しない)。要素の明示 ID をテキストへ確実に往復させたいテスト
    (rename の ID 保持検証など)専用。
- 対象範囲どおり、9ファイル(`renameAnalysis.contract.test.ts` /
  `renameAnalysis.test.ts` / `statementReconciler.test.ts` /
  `dslCompletionCandidates.test.ts` / `cmAutocomplete.test.ts` /
  `sourceEditorController.patchHighlight.test.ts` /
  `sourceEditorController.phase2d.test.ts` / `sourceEditorController.test.ts` /
  `sourceEditorPickSelection.test.ts` / `cadDocumentStore.canonical.test.ts` /
  `cadDocumentStore.editorSession.test.ts` / `cadDocumentStore.shadow.test.ts` /
  `cadDocumentStore.sourceUpdate.test.ts` / `cadDocumentStore.test.ts`)を
  上記ビルダ経由へ書き換えた。生成テキストに依存する期待値(行番号・span
  位置・serializer 出力形の断片)は、ハードコードをやめて生成テキストから
  `indexOf`/`split("\n")` 等で導出する形に揃えた。

### 実装中に見つけた逸脱・落とし穴

1. **printLayout セクションは常に要素ツリーより前にシリアライズされる**
   (`serializeDocumentToDsl` の section 順)。そのため「printLayout ブロックより
   前の行にトップレベル `var` がある」という行順序関係は生成経由では再現
   できない(`cmAutocomplete.ts` の `dslVariableCompletionOptions` が
   `cursorLine: block.line` を「ブロック開始行より前」のカットオフとして使う
   ため)。この行順序が主題の1テスト(`cmAutocomplete.test.ts` の
   "merges block-local layoutVar and global-only top-level candidates..."）は
   手書きリテラルへ戻しマーカーを付けた。
2. **`emptyDocument()` の既定 `evaluationLimitIndex: 0`** をそのまま
   `serializeDocumentToDsl` に渡すと、意図せず全要素が `@stop` の後ろに
   出力される(印刷レイアウトの `var` 補完テストが対象外扱いになり誤って
   赤くなった)。直接 `serializeDocumentToDsl` を呼ぶ箇所は
   `evaluationLimitIndex: elements.length` を明示すること。
3. **`layoutElementTree` の正準出力はグループの `{` を次行単独で出す**
   (`group G` → 改行 → `{`)。手書きリテラルでよく使われる `group G {` という
   同一行形式は「受理されるが正準ではない」入力であり、生成テキストの行数は
   その分ずれる。行番号を検証するテストは全てハードコードをやめ、生成
   テキストから `indexOf`/`findIndex` で導出するよう修正した。
   `foldTargetAtLine`(`sourceEditorFolding.ts`)はグループの `openBraceLineFrom`
   (`{` 自身の行)を fold 対象として見るため、フォールドガター系テストは
   ヘッダ行ではなく `{` 行を明示的に指す必要がある。
4. **`dslDocumentValueSpansAt`(Tab/Shift-Tab 値ナビゲーション)は文書全体では
   なく「カーソルを含む statement」だけを対象に巡回する**。複数 statement
   にまたがる生成ソースでは wrap-around が期待とズレるため、同一 statement
   内に3個以上の独自数値を持つ要素(本タスクでは `arcLine` の
   `radius`/`start`/`end`)を使う形に置き換えた。
5. **`freePoint` に `length=` のような未知の属性は型として存在しない**
   (元の手書きリテラルは value-span click/nav テスト用の便宜的なダミー属性
   だった)。同じ検証意図は実在の `offsetPoint.dy`(文書末尾に来る値)で
   代替できることを確認し、要素ベースへ置き換えた。
6. **id 明示保持(`id=` 属性)は document モードの serializer では出力されない**
   (`documentDslRefs` は無名要素の「参照される側」token にのみ raw ID
   フォールバックを使い、要素自身の宣言には使わない)。id 保持を検証する
   テストは `dslFlatTextForElements`(flat モード、常に `id=` を出力)を使う。
   ただしこのモードはグループのブレース構造を出力しないため、ネストが
   必要なケース(例: 無名の子グループを `place` から生 ID 参照する
   printLayout テスト)には使えない — そのケースは手書きリテラルへ戻し
   マーカーを付けた。

### マーカー付与ファイル一覧(ファイル×describe/test単位で集計)

| ファイル | 単位数 | 内容 |
|---|---|---|
| `src/dsl/dslCompletionContext.test.ts` | 1(ファイル全体) | v1単一行構文の文字オフセット判定が主題 |
| `src/dsl/dslValueSpans.test.ts` | 1(ファイル全体) | span境界判定が主題 |
| `src/dsl/dslValueStep.test.ts` | 1(ファイル全体) | 数値ステップ入力の文字位置解決が主題 |
| `src/document/statementReconciler.test.ts` | 2 | 「コメントのみの行内編集」1件 + 「複数行statement(バックスラッシュ継続)」describe(4件) |
| `src/document/renameAnalysis.contract.test.ts` | 2 | id=属性でのグループ無名子参照が主題の2件(print-layout raw-id place / コメントによる行マッピング崩れ) |
| `src/editor/cmAutocomplete.test.ts` | 2 | v1バックスラッシュ継続完了1件 + printLayout行順序依存の1件(上記逸脱1参照) |
| `src/state/cadDocumentStore.canonical.test.ts` | 3 | 意図的な構文エラー(fatal)2件 + コメント/空行保持が主題の1件 |
| `src/state/cadDocumentStore.sourceUpdate.test.ts` | 1 | 意図的な構文エラー(fatal) |
| `src/state/cadDocumentStore.test.ts` | 1 | 意図的な構文エラー(fatal) |

合計9ファイル・14単位。C1 は `grep -rn "dsl2-cutover: v1-literal" src` で
これらを列挙し、P7 の正準 v2 リテラルへ書き換える。ファイル全体マーカーの
3ファイルは個々のリテラル行にはマーカーを付けていない(ファイル冒頭の
1コメントのみ)ので、C1 側はファイル単位で全面書き換えを計画すること。

生成経由化した14ファイルは C1 で無修正 green になる見込み(共有ビルダが
本物の `layoutElementTree`/`serializeDocumentToDsl` を呼ぶため、C1 が
serializer を v2 化すれば出力も自動的に v2 になる)。ただし上記の逸脱1・6の
ケース(printLayout 行順序依存・flat モードでの id 保持)は C1 後も同じ
制約が残るため、そのまま据え置いてよい。
