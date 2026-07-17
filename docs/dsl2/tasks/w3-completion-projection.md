# W3: 補完の論理文入力化

種別: v1 で配線 / 依存: なし

## 目的

補完コンテキスト判定を「単一物理行」から「statement の論理射影」へ移す。v1 の
バックスラッシュ継続文でも補完が正しくなり、C1 後は縦型 call の任意の引数行で
補完が動く前提になる。

## 対象範囲

- `src/dsl/logicalStatementSourceMap.ts` — `physicalToLogicalOffset`
  (物理位置 → 論理オフセット。既存 `logicalOffsetToPhysical` 系の逆写像)を追加。
- `src/editor/cmAutocomplete.ts` — `defaultDocumentInput` を statement projection
  ベースへ: `context.pos` を含む論理文を特定し、`lineText = logicalText`、
  `localPos = 論理オフセット` を `dslCompletionContextAt` へ渡す。返る
  `from`/`to`(論理)は物理へ逆射影(トークンは fragment を跨がないため単一
  segment に収まる)。ソースマップは補完 1 回あたり 1 回構築しキャッシュする。
- `src/dsl/dslCompletionContext.ts` — コード変更は原則不要(入力が論理テキストに
  なるだけ)。doc コメントの「単一行」前提記述を更新。
- テスト。

## 対象外

- 補完候補ロジック・新コンテキスト種別(construction 名・引数名補完は F2)。
  `dslCompletionContextAt` の判定規則変更(F2/C1)。

## 実装要点

- 論理文が見つからない位置(空行・構造行)は現行どおり行頭キーワード補完へ
  フォールバック。
- パフォーマンス: 既存の補完経路はすでに全文再 parse をしている
  (`currentLiveElement`)。ソースマップ構築の追加コストは同オーダーであることを
  確認し、必要ならその再 parse 結果と共有する。
- 単一行 statement では logical == physical であり、既存テストは挙動不変で
  通ること。

## テスト

- 既存 `cmAutocomplete` 系テスト全 green(単一行で挙動不変)。
- 新規: v1 バックスラッシュ継続文の継続行上での属性・参照・`@変数` 補完
  (現状は行単位判定で壊れているか不完全なはず — 修正後の正しい候補を固定)。
- `physicalToLogicalOffset` の単体テスト(先頭断片・継続断片・断片境界)。
- 補完適用後のテキストが正しい位置に挿入されること(from/to の逆射影)。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。
- `dslCompletionContextAt` のシグネチャ不変(意味だけ論理化)。

## 次タスクへの引き継ぎ

- C1 では sourceMap のグルーピング規則が括弧ベースに変わるが、本タスクの
  projection 入力機構はそのまま使われる。F2 が新コンテキスト(construction 名・
  引数名)を足す。
- 実施内容: `physicalToLogicalOffset`(`src/dsl/logicalStatementSourceMap.ts`)を
  既存 `logicalOffsetToPhysical` の逆写像として追加(セグメント走査で物理位置→
  論理オフセット。どのセグメントにも属さない位置は `null`)。
  `cmAutocomplete.ts` の `defaultDocumentInput` を、補完呼び出し1回につき
  `createLogicalStatementSourceMap` を1回だけ構築し、`context.pos` を含む
  `LogicalStatement` を特定して `lineText = statement.logicalText`、
  `localPos = physicalToLogicalOffset(...)` を設定する形へ変更。同じ
  `map`/`statement` インスタンスを `projection` として保持し、completion の
  `from`/`to` 逆射影(旧 `base + offset` 算術)でも使い回す(再構築しない)。
  該当 statement が見つからない、または `physicalToLogicalOffset` が `null` を
  返す位置(空行・構造行・継続行の切り詰められた前置空白・EOL コメント内)は、
  `lineText`/`localPos` を一切論理値にせず物理行ベースの入力を「一式」使う
  (論理値と物理値を混在させない)。`currentLiveElement` の位置引数
  (旧 `input.doc.line(input.cursorLineNumber).from + input.localPos`)は
  `localPos` が論理値になり得るため `context.pos` を直接使うよう修正。
- from/to 逆射影はオーナー指示により、始終端を個別に `logicalOffsetToPhysical`
  変換するのではなく `physicalSpanForLogicalRange(map, statement, {start, end})`
  を1回呼ぶ形にした。戻りが `segments.length !== 1`(1個の連続した物理
  フラグメントに収まらない = 継続境界をまたぐ)場合は fail-closed で補完なし。
  **実装中に見つけた落とし穴**: `physicalSpanForLogicalRange` は `to > from` の
  セグメントしか emit しない設計(P8 のコメント再付着用途に合わせたもの)ため、
  `completionContext.from === completionContext.to`(トリガー文字直後で未入力の
  ゼロ幅レンジ。elementParameter 補完の「ドット直後」等、実際によくある
  ケース)を渡すと常に `segments.length === 0` になり、fail-closed 判定に
  誤って引っかかって既存の単一行テストまで補完なしになる回帰が出た
  (`cmAutocomplete.test.ts` の「lists AB's referenceable parameters right after
  the dot」で検出)。修正: ゼロ幅レンジは `physicalSpanForLogicalRange` を使わず
  `logicalOffsetToPhysical` で単一点として射影する分岐を先に置いた
  (`completionContext.from === completionContext.to` のときのみ)。非ゼロ幅
  レンジは元の指示どおり `physicalSpanForLogicalRange` 経由・単一セグメント
  必須のまま。
- `dslCompletionContextAt`(`src/dsl/dslCompletionContext.ts`)はロジック変更
  不要だった。冒頭の doc コメント(「freshly reparsed live line」という表現)
  のみ、論理射影/物理行どちらの文字列でも動く純粋関数である旨に更新。
- テスト: `logicalStatementSourceMap.test.ts` に `physicalToLogicalOffset` の
  3ケース(先頭フラグメント内・継続フラグメント内・フラグメント間ギャップで
  null)。`cmAutocomplete.test.ts` に、v1 バックスラッシュ継続行2行目上での
  `dx=10+@Wi` 属性+`@変数` 補完テスト(from/to 逆射影をテキスト全体の置換結果
  比較で検証)と、空行(該当 statement なし)での物理行フォールバックテストを
  追加。既存全テストは無変更で green。
- 対象外どおり、補完候補ロジック・新コンテキスト種別・`dslCompletionContextAt`
  の判定規則には触れていない。`currentLiveElement`/printLayoutBlock 分岐が
  個別に行う `parseDslSnapshot` 呼び出しは、そちらの内部で独自にソースマップを
  再構築したままにしてある(共有化は本タスク対象外。同オーダーのコストである
  ことは全テスト green・`npm run build` 成功で確認済み。C1/F3 でのプロファイル
  次第で共有化を検討)。
- `npm test`(1671件 green、新規テスト5件追加)/ `npm run build` /
  `npm run lint` は green。
