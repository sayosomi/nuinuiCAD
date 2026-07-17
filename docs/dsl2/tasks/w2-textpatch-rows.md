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
- 実施内容: `ElementTreeLine`(`src/dsl/dslDocument.ts`)を`ElementTreeRow`
  (`lines: string[]` + `argKeys: (string|null)[]`)へリネーム。v1では全rowが
  `lines.length===1`/`argKeys:[null]`。`patchElements`(`src/document/textPatch.ts`)
  の複数行拒否throwを削除し、マッチした`statement`行の置換を
  `mergeStatementComments`(P8)経由の行群差し替えへ統一(旧`info.line..endLine`
  全体を対象にする)。旧v1serializerは常に1行しか作らないため、
  `next: SerializedStatement = {header, args:[], close:null}`という暫定アダプタで
  橋渡ししている(`oldArgLineByKey`は`next.close===null`なので常に空Mapで良い、
  ==`mergeToSingleLine`分岐しか通らない)。非マッチ削除も`line..endLine`全範囲へ
  修正(継続行だけ取り残す既存バグを解消)。
- `soleCanonicalLine`という fail-closed ガードを追加した(`textPatch.ts`)。
  v1アダプタ・構造行置換のどちらも「rowは常に1物理行」という前提に依存して
  おり、この前提が崩れたら(将来C1でP5の実serializerに差し替わった時など)
  `row.lines[0]`だけ読んで残りを黙って捨てるのではなく、
  `UnappliedTextPatchError`で明示的に落ちるようにしてある。**C1はこのガードと
  その2呼び出し箇所(マッチしたstatement行のbareText抽出、構造行
  blockStart/blockEnd/blockElse/atStopの置換テキスト取得)を、本物の複数行row
  対応へ書き換える前提で、このガードを単純に持ち越さないこと。**
- 逸脱・発見(実装中に見つけた、当初想定より広いスコープの修正):
  1. **insertBeforeの呼び出し順による並び順バグ**: 当初、マッチしたstatement
     行の置換を「delete+insertBefore」で統一しようとしたところ、既存statement
     群を新規groupで包む操作(`group化`相当)で、新規groupヘッダより前に子
     statementの内容が挿入される回帰が出た(`buildSplicesFromOps`は同一
     アンカーで`insertsBefore(cursor)`→`lineOps(cursor)`の順で連結するため、
     ヘッダ自体は従来どおり`setLineOp`で書く必要がある)。
     修正: ヘッダ行は常に`setLineOp`(mergedLinesの最終行)、複数行mergeで
     生じた「先頭の退避コメント行」だけを`insertBefore`にする。加えて、
     非マッチrunの挿入ループをマッチ行の置換ループより前に実行する順序へ
     入れ替え、同一アンカーでの前後関係をさらに堅牢にした。
     回帰テスト: `textPatch.test.ts`「既存statementを新規groupで包むと、子の
     内容はgroupヘッダより後ろに来る」。
  2. **挿入runのアンカーが複数行文の継続行を貫通するバグ**: 文書末尾が無変更の
     複数行文(継続statement)のとき、新規要素の追加が
     `lastMatchedOldLine + 1`(＝マッチしたヘッダ行の直後)を挿入アンカーに
     使っていたため、その複数行文のヘッダ行と継続行の間に新規要素が割り込み、
     継続が壊れて再パースエラーになる回帰があった(こちらもW2の変更前から
     存在した潜在バグで、W2のプロパティテスト拡張(継続statementを混ぜる
     ジェネレータ)が初めて踏んだ)。修正: `matchedOldEndByLayout`という
     endLine基準の別マップを追加し、`lastMatchedOldLine`はそちらの最大値を
     使うようにした(ヘッダ行ではなく複数行文の実際の終端行を基準にする)。
     回帰テスト: `textPatch.test.ts`「マッチした継続statementの直後への挿入は
     継続行の途中に割り込まない」+ `documentTestGenerators.ts`/
     `textPatch.property.test.ts`の`withContinuation`パラメータ経由の
     プロパティテスト(numRuns=500/1000の別seedでも確認済み)。
  3. `documentTestGenerators.ts`のノイズ注入ループは、バックスラッシュ継続行の
     直後にノイズ(コメント・空行)を挟むと継続が壊れるため、継続行直後は
     注入対象から除外する条件を追加した。
- 対象外どおり、`SerializedStatement`を実際に複数行で生成する経路(C1/P5)や
  `patchPalette`/`patchVisibility`/`patchPrintLayouts`には触れていない。
  `npm test` / `npm run build` / `npm run lint` は green。
