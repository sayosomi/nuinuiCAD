# P7: round-trip 行列と v2 golden fixture

種別: 未接続 / 依存: P3, P4, P5, P6

## 目的

P3〜P6 を束ねて「parse → applyArgs ≡ 元要素」「serialize → parse → serialize が
固定点」を全型で証明し、C1 が使う v2 golden fixture(sample 文書・型別正準
リテラル)を事前作成する。C1 のテストリテラル書き換えコストをここで前払いする。

## 対象範囲

- 新規テスト(例 `src/dsl/dslV2RoundTrip.test.ts`):
  - 全 27 型 × populated/minimal の round-trip 行列
    (element → serializeLogical → callParser → applyArgs → element 等価)。
  - 冪等性 property test: serialize → parse → serialize がバイト同一
    (fast-check 等、既存 `textPatch.property.test.ts` の流儀に合わせる)。
  - 設定文(color/role/view/printLayout/place)の round-trip。
- 新規 fixture:
  - `src/dsl/__fixtures__/sample.v2.nui` — 現行 `sample.nui` と同じ文書内容の
    v2 版(手書きし、テストで「parse+compile 結果が現行 sample.nui の
    parse+compile 結果と要素 deep-equal」を証明する)。
  - 型別正準リテラル集(例 `src/dsl/__fixtures__/v2CanonicalStatements.ts`)—
    C1 でのテスト書き換えの参照元。P5 出力との一致をテストで固定する。

## 対象外

- 製品コードの変更。既存テスト・既存 `sample.nui` の変更(C1)。

## 実装要点

- populated サンプルは既存 `dslCompletionMetadata.ts` の `populatedTemplate` 相当の
  作り方を参考にする(全フィールド非デフォルト・全参照形)。
- 要素等価の比較は id・順序を除き deep-equal(現行 round-trip テスト
  `dslDocumentTestUtils.ts` の流儀を参照)。
- sample.v2.nui は縦型正準で書く(コンテナ・if/else・for・printLayout・@stop・
  無名要素・コメントを含める)。「v1 sample と同一要素へ compile される」ことが
  正しさの定義。v1 側の parse には現行の live parser(まだ v1)を使う。

## テスト

本タスクの成果物自体がテスト。加えて:

- 診断ケースの golden(未知 construction・重複引数・必須不足のメッセージ固定)。
- 1 行形式で書いた同内容が縦型と同じ要素になること(形式非依存の証明)。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。製品コードへの変更なし。
- 全 27 型の round-trip と冪等性が green。
- `sample.v2.nui` と型別正準リテラルが fixture として存在し、P5 出力との一致が
  テストで固定されている。

## 次タスクへの引き継ぎ

- C1 は `sample.v2.nui` を新 `sample.nui` に昇格させ、型別正準リテラルを各テストの
  書き換えに使う。P9 も span 解決対象テキストとして正準リテラルを使う。
- 「v1 sample との要素 deep-equal」テストは C1 で v1 parser が消えると成立しなく
  なるため、C1 で削除(または W5 の凍結 parser 経由に差し替え)することを明記。
- (完了時に追記)
