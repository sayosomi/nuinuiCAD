# 11: Lexical scope index

## 1. タイトル

11: Lexical scope index

## 2. 目的

全brace blockとdocument orderを表すstable scope indexを構築する。

## 3. 依存タスク

10

## 4. 前提API・型

`LexicalScopeIndex`、scope ID、parent/children、statement→scope、scope entry/exit、declaration order query。

## 5. 対象

root/group/then/else/forGroup body、iteration binding slot、typed declaration collection。

## 6. 対象外

name resolution、undefined/forward/cycle diagnostic、evaluation。

## 7. 固定仕様

then/elseはsiblings。declaration visibility開始はstatement位置。qualified pathは持たない。

## 8. 実装方針

parserのenclosing/branch情報からpure indexを1 passで作り、geometry group IDではなくstatement identityをscope IDに使う。

## 9. 変更対象ファイル

新規`src/scalars/lexicalScopeIndex.ts`とfixtures/tests、parser adapter。

## 10. 追加・更新するテスト

nested group、then/else、forGroup、empty block、malformed brace recovery、stable ID inheritance、1000 statements。

## 11. 互換性条件

legacy var semanticsはこのtaskでは解決せずrecordとして収集するだけ。

## 12. performance条件

O(statements+scopes)。250/1000 CPU measurementを記録。

## 13. 完了条件

12がsource再走査なしでvisible declaration候補を列挙できる。

## 14. 次タスクへの引き継ぎ

12がlegacy scope adapterとshadow/orderを追加する。

## 15. PR境界

scope indexingだけ。推奨branch slug: `typed-vars/11-scope-index`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
