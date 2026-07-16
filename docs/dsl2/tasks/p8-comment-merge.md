# P8: コメントマージ(statementCommentMerge)

種別: 未接続 / 依存: P5

## 目的

statement 差し替え時に旧コメントを新テキストへ決定的に再付着させる純関数を作る。
複数行 statement を patch してもユーザーのコメントが消えない、という v2 の
コメント保存契約([plan.md](../plan.md) 確定仕様 1.5)の実装点。

## 対象範囲

- 新規 `src/document/statementCommentMerge.ts` — 確定仕様 3 の
  `mergeStatementComments({oldLines, oldArgLineByKey, next, indent}) => string[]`。
- ユニットテスト。

## 対象外

- textPatch への組み込み(W2)。コメント抽出以外のテキスト操作。

## 実装要点

- アルゴリズム(確定仕様 1.5 の契約を実装に落としたもの):
  1. 新ヘッダ行 + 旧ヘッダの EOL コメント。
  2. 新引数キーごとに、旧でそのキーの引数行の直前にあった全行コメント群 →
     新引数行 + そのキーの旧 EOL コメント。
  3. 旧にあって新で消えたキーに付いていた全行コメントは `)` の前へ。
     消えたキーの EOL コメントも同様に全行コメント化して `)` の前へ退避する
     (捨てない)。
  4. 閉じ行 + 旧閉じ行の EOL コメント。
- 旧が 1 行 statement(v1 形または短形式)の場合: 旧 EOL コメントは新ヘッダ行へ。
  新が短形式(`close: null`, `args: []`)の場合: 全コメントをその 1 行の EOL と
  直前全行コメントへ集約。
- コメント抽出は既存 `splitDslComment`(quote-aware)を使う。
- 旧と新が同一内容なら呼ばれない前提だが、呼ばれてもバイト同一を返すこと
  (冪等性)。
- `oldArgLineByKey` は呼び出し側(W2)が旧 parse の attr span から作る。本関数は
  行番号 → `oldLines` インデックスの対応だけを仮定する。

## テスト

- 引数 EOL コメント維持・引数間全行コメント維持・ヘッダ/閉じ EOL 維持。
- 引数の追加・削除・並び替えを跨いだ再付着。消えたキーのコメント退避。
- 旧 1 行 → 新縦型、旧縦型 → 新短形式の両方向。
- コメントなしの素通り(入出力が new の素の行群と一致)。冪等性。
- 引用文字列内 `#` の非コメント扱い。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。製品コードからの import なし。
- 決定的(同入力同出力)・純関数。

## 次タスクへの引き継ぎ

- W2 が textPatch の statement 差し替え経路に組み込む。`oldArgLineByKey` の生成は
  W2 側の責務。
- (完了時に追記)
