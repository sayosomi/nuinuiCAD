# W2: textPatch 行群化と複数行 statement 差し替え

種別: v1 で配線 / 依存: P8

## 目的

model→text bridge の最大のギャップを塞ぐ: `patchElements` が複数行 statement の
構造的更新を `UnappliedTextPatchError` で拒否している(`textPatch.ts:303-317`)のを、
行群(row)ベースの差し替えに改める。v1 のまま着地でき(正準出力は依然 1 行)、
バックスラッシュ継続文の更新が「unapplied 拒否 → 正準 1 行への置換」に改善される。

## 対象範囲

- `src/dsl/dslDocument.ts` — `layoutElementTree` の戻り値を `ElementTreeLine` から
  `ElementTreeRow`(`lines: string[]` + `argKeys` — [plan.md](../plan.md) 確定仕様 3)
  へ変更。v1 では全 row が `lines.length === 1` / `argKeys: [null]`。
- `src/document/textPatch.ts` — `patchElements`:
  - 複数行拒否ブロック(303-317 行付近)を削除。
  - 更新された statement: 旧 `info.line..info.endLine` を削除し、
    `mergeStatementComments`(P8)の結果を挿入。`oldArgLineByKey` は旧 parse の
    `DslAttribute` physical span から導出(v1 では実質空 Map)。
    無変更 statement はバイト同一(op なし)を維持。
  - 未マッチ旧 statement の削除は `line..endLine` 全範囲(statement 内部の全行
    コメントは道連れ。statement 間のコメントは無傷 — コンテナ子孫削除の既存哲学
    と同じ)。
  - 挿入 run は `rows.flatMap(row => row.lines)`。
  - 候補マッチ(旧ヘッダ行の LIS)は不変(`info.line` / `openBraceLine` /
    `range.endLine` / `elseLine` キー)。
- 両ファイルのテスト。

## 対象外

- serializer の出力変更(v1 のまま)。`patchPalette` / `patchVisibility` /
  `patchPrintLayouts`(C1 で printLayout のみ調整)。`SerializedStatement` を
  実際に複数行で生成する経路(C1)。

## 実装要点

- v1 の serializer は 1 行を返すので、`SerializedStatement` への橋渡しは暫定
  アダプタ(1 行 → `{header: 行, args: [], close: null}`)でよい。C1 で P5 に
  差し替わる。
- 「複数行の旧 → 1 行の新」への置換が本タスクで実挙動として通るようになる
  (`cadDocumentStore` の `unapplied` エラー経路が減る)。`commitModelBridge` の
  `unapplied` ステータス自体は残す(他の不能ケースの fail-closed として)。
- `applyLineSplices` の CRLF/LF 保存・文字オフセット splice は無変更。
- 既存の設計不変条件(splice のみ・触れない行はバイト同一)をコメントで維持。

## テスト

- 既存 `textPatch.test.ts` / `textPatch.property.test.ts` 全 green(単一行文書で
  挙動不変)。
- 新規: v1 バックスラッシュ継続 statement の更新 → 範囲全体が正準 1 行に置換され、
  EOL コメントが保持されること(P8 経由)。継続 statement の削除 → 全行消えること。
- property test 拡張: ランダムな継続行・コメント配置を含む文書での patch 往復
  (patch 結果を再 parse → 要素等価、無関係行バイト同一)。
- `mergeStatementComments` 統合点の単体テスト(oldArgLineByKey 導出含む)。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。
- 複数行拒否の throw が消え、複数行 statement の更新・削除が splice として成立。
- 無変更 statement のバイト同一不変条件がテストで維持されている。

## 次タスクへの引き継ぎ

- C1 は「serializer を P5 に差し替え、暫定アダプタを外す」だけで縦型出力が
  流れる状態にする。`ElementTreeRow.argKeys` は C1 で実キーが入る。
- (完了時に追記)
