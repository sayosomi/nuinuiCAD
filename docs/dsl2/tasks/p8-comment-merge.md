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
- `src/document/statementCommentMerge.ts` は `mergeStatementComments` を公開する。
  内部は3分岐: `next.close === null`(短形式へ収束。全行コメントは先頭行群へ、
  全EOLコメントは1本のEOLへ文書順で連結)/ `oldLines.length <= 1`(旧が1行
  statementだった。唯一のEOLは新ヘッダ行にのみ付与し、引数・close行は新規生成で
  コメント無し)/ 一般形(旧・新とも複数行call)。
- 一般形は「行オーナー」割当(header=index 0、close=最終index、それ以外は
  `oldArgLineByKey`のkey)で1パスし、各オーナーへ「直前の全行コメント群」と
  「自身のEOL」を確定させる。`)`直前にあってどのキーにも属さない素の全行コメントは
  close自身のオーナーとして自然に回収される(close行は必ず走査の最終ownedとして
  処理されるため、これを取りこぼすと無変更statementでも当該コメントが消える
  冪等性バグになる — 実装前のPlan agentレビューで発見・修正済み)。
- 消えたキー(`oldArgLineByKey`にあり`next.args`に無いkey)は旧行indexの昇順で、
  先頭全行コメント群→(EOLがあれば)全行コメント化したEOL、の順に`)`の前へ退避する。
  捨てない。
- `indent`はheader/close行に使う基底インデント。引数行は`indent + DSL_INDENT`
  (`src/dsl/dslTokens.ts`)。`SerializedStatement.args[].text`はインデント無しの
  `"key: value"`文字列(P5仕様どおり)であることを前提にしている。
- `statementCommentMerge.test.ts`で全テスト項目(引数EOL/全行コメント維持、
  ヘッダ/close EOL維持、`)`直前の素のコメント維持、削除キーの退避、複数削除の
  相対順序、並び替えを跨いだ再付着、新規キー無コメント、旧===新の完全冪等、
  無コメント素通り、旧1行→新縦型、縦型→短形式のEOL連結、引用文字列内`#`の非
  コメント扱い、depth>0のインデント)に加え、`fast-check`によるランダムkey構成
  (追加/削除/並び替え+コメント配置)での冪等性property testを固定した。
- `npm test` / `npm run build` / `npm run lint` はgreen。製品コードからのimport
  なし(未接続方針どおり)。
