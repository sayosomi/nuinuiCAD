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
- (完了時に追記)
