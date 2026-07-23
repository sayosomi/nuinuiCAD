# 26: Text template scanner / dependencies / typecheck

## 1. タイトル

26: Text template scanner / dependencies / typecheck

## 2. 目的

canonical `label(text: ...)`のraw stringからliteral/number/string holeを解析し、escape/span/dependency/typeを確定する。

## 3. 依存タスク

09, 12, 15

## 4. 前提API・型

`TextTemplateAst` segments、raw/cooked offsets、hole typed AST、dependency records、template diagnostics。

## 5. 対象

`{@string}`、既存`{numeric expression}`、全escape、literal braces、unclosed/nested hole、source spans。

## 6. 対象外

TS/Rust template evaluation、string concat、boolean/choice stringify。

## 7. 固定仕様

scannerはunescape前raw sourceを読む。`\{`/`\}`はliteral。boolean/choice holeはtype mismatch。canonical constructionはlabel。

## 8. 実装方針

09 string scannerと14/15 expression pipelineを再利用し、existing regex replacementを新pure scannerへ置換する準備をする。

## 9. 変更対象ファイル

新規`src/scalars/textTemplate.ts`、DSL text property adapter、dependency/span tests。

## 10. 追加・更新するテスト

希望例、numeric mix、全brace escape、unknown escape、unclosed/nested、boolean/choice rejection、exact inner/outer spans。

## 11. 互換性条件

nui 3でも採用するnumeric interpolationとholeなしtextのsemanticsを維持する。v2 round-trip/goldenやlegacy-only malformed matrixは追加しない。

## 12. performance条件

template length+hole ASTに線形。regex backtrackingを使わない。

## 13. 完了条件

27/28/36/39/43が同じtemplate AST/metadataを使える。

## 14. 次タスクへの引き継ぎ

27 TS evaluation、28 Rust、36 dependenciesへ接続する。

## 15. PR境界

template analysisだけ。推奨branch slug: `typed-vars/26-template-analysis`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
