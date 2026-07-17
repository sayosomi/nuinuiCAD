# W1: reconciler 複数行化

種別: v1 で配線(現行文法のまま green で完結) / 依存: なし

## 目的

安定 ID 継承(statement reconciliation)が statement の先頭物理行しか比較しない
単一行前提を外す。v1 のバックスラッシュ継続文でも今日から正しくなり、C1 後の
縦型 statement で必須になる。

## 対象範囲

- `src/document/statementReconciler.ts` — `statementText`(139-141 行付近)を
  全行結合へ:

```ts
const statementText = (statements, lines) =>
  statements.map((s) =>
    lines.slice(s.line - 1, s.endLine).map((l) => l.trim()).join(" "));
```

- 同ファイルのテスト追加。

## 対象外

- stage 2〜6・scopeKey・block pairing(statement index ベースで無変更)。
  textPatch(W2)。文法変更。

## 実装要点

- stage 1 の LCS(`diffTexts`)は statement 単位のテキスト列を比較する。全行結合に
  より「継続行だけの編集」が変更として見えるようになる。stage の意味論は不変
  (引数行の編集 = 今日の属性編集と同格)。
- `LCS_AREA_LIMIT`(250,000)は statement 数ベースなので影響なしのはずだが、
  長い statement テキストでの比較コストに劣化がないか既存の性能系テスト
  (`*Cost.test.ts` があれば)で確認する。

## テスト

- v1 バックスラッシュ継続文の継続行だけを編集 → stage 1/2 で ID 継承されること
  (現状は先頭行が同一なため「無変更」と誤判定される — 修正で正しく「変更」に
  なること、および ID が維持されることの両方)。
- 複数行 statement の移動・rename を含む既存シナリオの回帰。
- 単一行文書での既存テスト全 green(挙動不変)。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。
- 差分は `statementReconciler.ts` とそのテストに閉じる。

## 次タスクへの引き継ぎ

- C1 は reconciler に追加変更なしで縦型 statement を扱えるはず。もし C1 で
  reconciler 由来の ID 揺れが出たら、まず本タスクのテスト網を疑うこと。
- 実施内容: `statementText`(`src/document/statementReconciler.ts`)を
  `statement.line`〜`statement.endLine` 全行 trim + 単一スペース結合に変更。
  単一行 statement は `endLine === line` のため既存出力と完全一致し、既存の全
  テスト(ストレステスト含む)は無変更で green。
- 逸脱・発見: なし。実装は本文書に記載の diff どおり 1 関数の変更のみで完結した。
  stage 2〜6 はこの関数の出力にのみ依存するため、他コードの変更は不要だった。
- 追加した回帰テストでは、複数行 statement の並べ替えケースについて特定 statement
  が必ず特定の段階になることは断定していない(LCS の有効な選択によって段階1に残る
  statement が変わり得るため)。代わりに名前→ID対応の一貫性・新規/消滅なし・ID
  重複なしを検証している。リネームケースも同様に段階を断定せず、単一行のリネーム
  規則が複数行化後も壊れていないことのみを回帰確認した。
