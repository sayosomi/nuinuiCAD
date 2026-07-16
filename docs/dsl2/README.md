# DSL v2 移行計画(関数呼び出し型 DSL / `nui 2`)

現行の 1 行属性 DSL を、複数行・関数呼び出し型 DSL(`nui 2`)へ移行する独立計画。
確定仕様・全体方針・依存グラフは [plan.md](plan.md)、各子タスクは `tasks/` を参照。

この計画は `docs/overhaul/` とは独立しており、参照しない。

## 進め方

- 1 タスク = 1 セッション(実装・テスト・レビューまで完結)。
- 着手前に [plan.md](plan.md) の「不変条件」「確定仕様」と、自タスク文書の全節を読む。
- 各タスク終了時に `npm test` / `npm run build` / `npm run lint` を green にする
  (タスク文書に追加コマンドの指定がある場合はそれも)。
- 終了時にこの README の状態欄を更新し、タスク文書の「次タスクへの引き継ぎ」に
  実際の引き継ぎ事項(逸脱・発見・残件)を追記する。
- 仕様(文法・対応表・型)を変えたくなった場合は独断で変えず、plan.md の該当節へ
  変更提案として追記し、オーナー判断を仰ぐ。

## タスク一覧と状態

| # | タスク | 種別 | 依存 | 状態 |
|---|---|---|---|---|
| P1 | [construction registry](tasks/p1-construction-registry.md) | 未接続 | なし | 完了 |
| P2 | [引数スキャナ](tasks/p2-arg-scanner.md) | 未接続 | なし | 完了 |
| P3 | [要素/コンテナ call parser](tasks/p3-call-parser.md) | 未接続 | P1, P2 | 完了 |
| P4 | [設定文 parser](tasks/p4-settings-parser.md) | 未接続 | P1, P2 | 完了 |
| P5 | [registry 駆動 serializer](tasks/p5-element-serializer.md) | 未接続 | P1 | 完了 |
| P6 | [compiler 引数適用](tasks/p6-compiler-apply-args.md) | 未接続 | P1, P2 | 完了 |
| P7 | [round-trip 行列と v2 golden](tasks/p7-roundtrip-golden.md) | 未接続 | P3, P4, P5, P6 | 完了 |
| P8 | [コメントマージ](tasks/p8-comment-merge.md) | 未接続 | P5 | 未着手 |
| P9 | [値 span v2 解決](tasks/p9-parameter-spans-v2.md) | 未接続 | P1, P5, P7 | 未着手 |
| W1 | [reconciler 複数行化](tasks/w1-reconciler-multiline.md) | v1 で配線 | なし | 未着手 |
| W2 | [textPatch 行群化](tasks/w2-textpatch-rows.md) | v1 で配線 | P8 | 未着手 |
| W3 | [補完の論理文入力化](tasks/w3-completion-projection.md) | v1 で配線 | なし | 未着手 |
| W4 | [エディタ系テストのリテラル間接化](tasks/w4-editor-test-fixtures.md) | v1 で配線 | なし | 未着手 |
| W5 | [v1 パイプラインの凍結コピー](tasks/w5-legacy-freeze.md) | v1 で配線 | なし | 未着手 |
| C1 | [コア切替](tasks/c1-core-cutover.md) | 同時切替 | P3–P9, W1–W5 | 未着手 |
| F1 | [v1 文書の open 時変換](tasks/f1-v1-import.md) | 後続 | C1, W5 | 未着手 |
| F2 | [補完・ハイライト仕上げ](tasks/f2-editor-polish.md) | 後続 | C1 | 未着手 |
| F3 | [docs・性能・残骸削除](tasks/f3-docs-perf-cleanup.md) | 後続 | C1, F1 | 未着手 |
| F4 | [legacy 削除(後日)](tasks/f4-legacy-removal.md) | 後続 | F1 + 運用条件 | 未着手 |

状態は「未着手 / 進行中 / 完了 / 保留(理由)」のいずれかで更新する。

## 種別の意味

- **未接続**: 新規モジュール+テストのみ追加。製品コードから import しない。
  リスクをここで消化する。着手順は依存を満たす限り自由、並行可。
- **v1 で配線**: 既存コードの改修だが、現行 v1 文法のまま全テスト green で完結する。
  コア切替(C1)の差分を縮めるための先行改善。
- **同時切替**: 文法の一括切替。live parser に二重文法を置かないため 1 タスク。
- **後続**: 切替後の仕上げ。

## 推奨着手順

依存を満たす任意順で良いが、素直な直列順は
P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → W1 → W2 → W3 → W4 → W5 → C1 → F1 → F2 → F3 →(条件成立後)F4。
P1/P2/W1/W3/W4/W5 は依存がなく、いつでも並行着手できる。
