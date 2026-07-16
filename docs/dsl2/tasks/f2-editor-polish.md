# F2: 補完・ハイライト仕上げ

種別: 後続 / 依存: C1

## 目的

v2 文法固有の編集体験を仕上げる: construction 名補完・引数名補完・registry 駆動
ハイライト・複数行 splice 上の表示確認。

## 対象範囲

- `src/dsl/dslCompletionContext.ts` + 補完候補モジュール:
  - 新コンテキスト「`= ` 直後の construction トークン」→ その category の
    construction 候補(registry から。説明文付き)。
  - 旧 trailing-attribute コンテキストの置換「call 括弧内 depth 1 の引数名位置」→
    `dslCompletionMetadataForType` 由来の `key: ` 候補(既出引数は除外)。
  - コンテナヘッダ(if/for/group)の引数名補完と位置引数位置の扱い。
- `src/dsl/dslHighlight.ts` — registry から category/construction を import した
  トークン分類の整理、`key:` / 位置引数 / record 内の色分けの確認(C1 の最小対応の
  磨き込み)。
- 表示確認: 複数行 splice の patch ハイライト・状態レール・fold(group fold)が
  縦型 statement で崩れないことのテスト固定。
- テスト。

## 対象外

- 値側補完の新機能(既存の `@変数`・参照・record 補完は C1 時点で動いている
  はず)。call 本体の折りたたみ(対象外と確定済み)。

## 実装要点

- 候補メタデータは registry と `dslCompletionMetadata`(serializer 導出)を正とし、
  ハードコード表を作らない。
- 引数名候補の挿入形は `key: `(コロン+空白)まで含め、縦型では行頭インデントを
  崩さないこと。
- W3 の論理文入力機構の上に足す(物理行判定へ戻さない)。

## テスト

- 各コンテキストの検出と候補内容(category 別 construction、既出引数の除外、
  コンテナ位置引数直後の named 引数候補)。
- 縦型 statement の各物理行(ヘッダ・引数行・`)` 行)での補完起動位置の網羅。
- ハイライトのトークン分類スナップショット(v2 正準リテラル上)。
- controller テストでの patch ハイライト・fold の回帰。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。
- 補完が keyword / construction / 引数名 / 値の 4 階層で機能。

## 次タスクへの引き継ぎ

- F3 へ: docs に載せるべき補完仕様の変更点をここへ列挙する。
- (完了時に追記)
