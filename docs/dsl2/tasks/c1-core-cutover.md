# C1: コア切替

種別: 同時切替(1 タスク・1 コミット) / 依存: P3, P4, P5, P6, P7, P8, P9, W1, W2, W3, W4, W5

## 目的

live parser を v1 から v2 へ一括切替する。P/W 群がすべて完了していれば、本タスクは
**配線 + 旧経路削除 + テストリテラル差し替え(P7 で事前作成済み)** に縮小されて
いるはず。live parser に二重文法は置かない。

## 着手前チェック(必須)

依存タスク全完了を README の状態表で確認。特に:
- P7 の `sample.v2.nui` と型別正準リテラル fixture が存在する。
- W2 の暫定アダプタ(1 行 serializer → SerializedStatement)が機能している。
- W4 のマーカー `// dsl2-cutover: v1-literal` の一覧が引き継ぎ欄にある。
- W5 の凍結コピーが live `src/dsl/` に依存していない。

## 対象範囲(配線)

1. `src/dsl/logicalStatementSourceMap.ts` — グルーピングをバックスラッシュ継続から
   括弧バランス継続へ([plan.md](../plan.md) 確定仕様 1.1: depth 0 の `(`/`[` 未閉で
   継続、空行・構造行・EOF で「未閉呼び出し」エラー終端、呼び出し内全行コメント
   許可)。継続行認識(`isContinuation`)を削除。
2. `src/dsl/dslTypes.ts` — statement union 縮小(確定仕様 3。旧要素 kind 7 種を
   `element` へ統合、`category`/`construction` 追加)。
3. `src/dsl/dslParser.ts` — keyword dispatch を P3/P4 の parser へ委譲する
   オーケストレーションに縮小(目標 <300 行)。旧要素 parse・`key=value` 属性・
   位置糖衣・`element type=`・`profile`/`activeProfile` を削除。
   `applyBlockStructure`・重複名診断・`@stop` 一意性は維持。
   union 変更の波及(kind 絞り込み箇所)は `statement.kind === "element"` 化。
4. `src/dsl/dslCompiler.ts` — 型別 `applyStatement` 分岐と `parameterAlias` を削除し
   P6 `applyArgs` へ配線(目標 <600 行)。設定文適用(palette / visibility /
   printLayout / place)を P4 の新引数名に合わせる。ID 割当・名前索引・ブロック
   文脈・`@stop` の骨格は不変。
5. `src/dsl/dslSerializer.ts` — 27 分岐 switch を削除し P5 へ委譲。
   `flatRefs` / `documentDslRefs` / role・view 行 serializer は維持(view/color/
   role/place の出力を確定仕様 1.4 の新形へ)。
6. `src/dsl/dslDocument.ts` — `layoutElementTree` が P5 の block 出力で
   `ElementTreeRow.lines`/`argKeys` を実データ化(W2 の暫定アダプタ除去)。
   printLayout セクションを縦型ヘッダ + `) {` に。`DSL_VERSION = 2`。
7. `src/document/textPatch.ts` — `patchPrintLayouts` の縦型ヘッダ対応と
   インライン `{` 互換(751-754 行付近)の削除。
8. `src/dsl/dslParameterSpans.ts` — 旧 switch を削除し P9 実装を最終名で配線
   (「V2」サフィックスを除去)。
9. `src/dsl/dslCompletionMetadata.ts` — サンプル導出を
   `serializeElementStatementLogical` へ差し替え。
10. `src/dsl/dslHighlight.ts` — 最小対応: `key:` の attributeKey 規則、category/
    construction キーワードを registry から import、`=` 属性・旧キーワードの削除。
    (本格的な磨き込みは F2。)
11. rename — `renameAnalysisCandidate.serializerChangedStatementLines` を
    `serializeElementStatementLogical` 比較へ、`expectedPatchedLines` を変更
    statement の `range` 行集合へ(契約テスト更新)。
12. fixture/テスト:
    - `sample.v2.nui` を `sample.nui` へ昇格(旧 sample は W5 の `sample.v1.nui`)。
    - DSL コア層テスト(`dslParser` / `dslCompiler` / `dslSerializer` /
      `dslDocument` / `textPatch` / `statementReconciler` / rename 系)の v1
      リテラルを P7 の正準リテラルで書き換え。
    - W4 のマーカー付きリテラルを書き換え。
    - P7 の「v1 sample との要素 deep-equal」テストを W5 凍結 parser 経由に差し替え
      (または削除して凍結側の期待値固定へ — W5 の引き継ぎ欄参照)。
13. `npm run test:parity` を実行し、無変更 green を証明する(結果を引き継ぎ欄に
    記録)。

## 対象外

- v1 ファイルの open 変換(F1。**本タスク完了時点では v1 ファイルは version
  エラーで開けない** — 既知の中間状態として許容し、F1 を直後に実施)。
- 補完の新コンテキスト(construction 名・引数名)・ハイライト磨き込み(F2)。
- docs 更新・性能テスト(F3)。Rust・parity fixture(触れない)。

## 実装要点

- 変更は「削除と委譲」を基本とし、新ロジックをこのタスクで書かない(書きたく
  なったら P 群の漏れ — 該当 P タスクの引き継ぎ欄に記録して差し戻すか、小さければ
  当該モジュールにテスト付きで足す)。
- shadow アサート(`shadowText` / `shadowTextAssert`)は dev で有効のまま切替の
  安全網にする。
- 作業順の推奨: sourceMap → parser/types → compiler → serializer/document →
  textPatch/spans/metadata/highlight → rename → fixture/テスト。型エラーを
  コンパスに一気に通す(中間状態で green にならないのは織り込み済み。コミットは
  最後に 1 回)。

## テスト

- 全既存テスト green(書き換え後)。`npm run test:parity` green。
- 統合確認: `sample.nui`(v2)の open → 編集(値 step・rename・Canvas ピック相当の
  store 操作)→ patch → undo の一連が store/controller テストで通ること。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` / `npm run test:parity` green。
- live コードから v1 構文の受理・出力が消えている(grep: `->` 糖衣、`key=value`
  属性 parse、`element type=`、バックスラッシュ継続、`parameterAlias`)。
- 正準出力が全要素で縦型 call(P7 golden と一致)。
- このコミット 1 つを revert すれば v1 へ全戻しできる(revert 可能性を保つため、
  依存タスクの成果物には手を入れない)。

## 次タスクへの引き継ぎ

### 実施内容

- live DSLを `nui 2` の縦型call文法へ切り替え、parser/compiler/serializerを
  P1–P9とW1–W5の実装へ配線した。旧v1のキーワード別分岐、`key=value` 属性、
  `->` 糖衣、`element type=` escape hatch、バックスラッシュ継続はlive経路から除去した。
- source map、text patch、parameter span、rename解析を複数物理行statementに対応させ、
  `DSL_VERSION` を2へ更新した。凍結済み `src/document/legacyDsl/` は変更していない。
- 検証: `npm run test:parity` は14 tests green。C1受入条件の parity確認を記録する。

### 後続タスクの実績

- F1で、`nui 1` はopen時に一回だけ正準 `nui 2` へ変換して開く経路を追加した。
- F2で、construction／引数名補完とv2構文ハイライトを仕上げた。
- F3で、利用ガイド、性能sanity、live経路のv1残骸監査を完了した。
