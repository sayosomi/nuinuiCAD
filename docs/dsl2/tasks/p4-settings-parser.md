# P4: 設定文 parser

種別: 未接続 / 依存: P1, P2

## 目的

設定系 statement(version / color / role / view / activeView / activePrintLayout /
printLayout ヘッダ / layoutVar / place / @stop)を v2 文法で解析する parser を作る。

## 対象範囲

- 新規 `src/dsl/dslSettingsParser.ts` — [plan.md](../plan.md) 確定仕様 1.4 の全文形。
- ユニットテスト。

## 対象外

- 要素・コンテナ(P3)。ブロック構造の対応付け(既存 `applyBlockStructure` を C1 で
  流用)。compile(C1 で `dslCompiler.ts` の設定系適用を新引数名に合わせる)。

## 実装要点

- `nui 2` / `activeView 名` / `activePrintLayout 名` / `@stop` /
  `layoutVar 名 = 式` は現行と同形(既存実装から移植可)。
- color / role / view / place は「名前(または id)+ 括弧付き引数」。位置引数は
  color の hex と place のグループ名のみ(P1 の settings spec に従う)。
- view の role 可視キーは動的(`seam: false` の `seam` は role id)。固定 spec 外
  キーを role 可視エントリとして受ける。
- printLayout ヘッダは縦型受理が必須(論理結合後は 1 行なので P2 スキャナで同じ
  扱い)。`) {` 末尾の `{` を `opensBlock` として返す。
- 診断は P3 と同じ流儀(未知引数・重複・必須不足・空値)。

## テスト

- 各文形の正常 parse(1 行・縦型 printLayout ヘッダ)。
- view の動的 role キー。color の位置 hex + named。place の位置グループ名。
- 未知引数・重複・必須不足の診断。
- `nui 1` / `nui 3` はここでは「version 値の取得」まで(拒否判断は open 境界 = F1)。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。製品コードからの import なし。

## 次タスクへの引き継ぎ

- P7 が設定文 round-trip に使う。C1 が dispatch を配線し、`dslCompiler.ts` の
  `applyVisibilitySettings` / palette / printLayout 適用を新引数名に合わせる。
- (完了時に追記)
