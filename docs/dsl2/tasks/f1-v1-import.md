# F1: v1 文書の open 時変換

種別: 後続(C1 の直後に実施) / 依存: C1, W5

## 目的

既存 v1 `.nui` を open 時に一回変換して v2 として開けるようにする。最も単純で
安全な移行方式(変換は open 境界の一回だけ、live parser は v2 のみ)。

## 対象範囲

- 新規 `src/document/legacyV1Import.ts` — `parseLegacyV1Document`(W5)→
  document data → v2 `serializeDocumentToDsl` で正準 v2 テキストを生成。
  ブロック構造・要素順は v1 parse から来るので `.nuinui.json` importer の
  `preserveElementOrder` は不要。コメント・手書きレイアウトは失われる(仕様)。
- `src/document/documentFile.ts` — `openDocument`: major 1 を検出したら変換し、
  同一 `currentFilePath`・`dirtySinceSave: true` で開く。ステータス通知
  「nui 1 から変換しました(保存で nui 2 になります)」。major 0 / >2 は既存の
  version エラー。
- `src/document/nuiVersion.ts` 系 — 「unsupported」の意味を調整
  (1 = 変換可、0 または >2 = 拒否)。
- テスト + `npm run desktop:build` スモーク。

## 対象外

- `.nuinui.json` importer の変更(出力が自動的に v2 になるだけ)。
- 変換の逆方向(v2 → v1)。凍結コピーの削除(F4)。

## 実装要点

- 変換失敗(v1 側 diagnostics に error)時は開かず、既存の「開けない」エラー UI に
  診断概要を出す(壊れた v1 を黙って部分変換しない)。
- `flushSourceEditForFileOperation` 等の既存 open 前処理の順序を崩さない。
- 変換後テキストは v2 として即 compile され、diagnostics ゼロであるべき
  (v1 で valid だった文書は v2 でも valid — これをテストの主軸にする)。

## テスト

- `sample.v1.nui`(全糖衣形・`element type=`・継続行・`parent=` fallback を含む
  よう必要なら拡充)→ 変換 → v2 として compile → 要素 deep-equal(凍結 parser の
  compile 結果と比較)。
- 変換後テキストの冪等性(v2 として serialize し直してもバイト同一)。
- dirty フラグ・ファイルパス維持・通知文言。v1 エラー文書の拒否。v3 の拒否。
- 手動スモーク: `npm run desktop:build` で v1 ファイルを開く → 変換表示 → 保存 →
  再 open で v2 として無変換で開くこと。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。desktop スモーク実施
  (結果を引き継ぎ欄に記録)。
- v1 ファイルが「開けない」状態が解消されている。

## 次タスクへの引き継ぎ

- F4 へ: ローカル `.nui` の v2 化状況(オーナー確認)をここに記録していく。

### 実施内容

- `src/document/legacyV1Import.ts` を追加し、`parseLegacyV1Document`(W5の凍結facade)の
  document data を `serializeDocumentToDsl` で正準v2テキストへ一回変換する経路を実装した。
  凍結コピー(`src/document/legacyDsl/`)は変更していない。
- open境界はlive v2 parserへ渡す前に生テキストの先頭 `nui <major>` を判定し、major 1だけを
  凍結facadeへ送る。major 0と3以上は従来どおり拒否し、v2・不正なヘッダはlive v2側の既存処理に
  委ねる。live parser/compilerにv1文法は追加していない。
- 変換時はv1 diagnosticsのerrorを拒否し、生成したv2テキストもlive compilerで再検証する。どちらかに
  errorがあれば現在の文書を置き換えず、既存のファイルopenエラーUIへ診断概要を渡す。成功時は同じ
  `currentFilePath`でdirtyとして開くため、ユーザー保存時にv2として書き戻される。
- 変換済みであることは新しい専用UI状態を増やさず、既存の「未保存の変更」表示で示す。v1→v2変換では
  コメントと手書きレイアウトが失われることは既知の仕様のまま。
- 検証: `npm test`、`npm run build`、`npm run lint`、`npm run desktop:build` はすべて成功。
  desktop buildのnotarization未設定警告とBigInt target変換警告は既存の許容警告。
