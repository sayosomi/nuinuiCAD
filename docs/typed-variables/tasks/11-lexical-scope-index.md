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

実装済みAPI(production未接続、pure library):

```ts
// src/scalars/lexicalScopeIndex.ts
export type ScopeKind = "root" | "group" | "then" | "else" | "forGroup";
export type ScopeId = string;

export type LexicalScope = {
  id: ScopeId;
  kind: ScopeKind;
  parentId: ScopeId | null;              // null only for root
  childIds: readonly ScopeId[];          // document order; then/else are separate sibling entries
  openingStatementIndex: number | null;  // document-order metadata only - never part of `id`
  entryStatementIndex: number;           // first member statement index, or statements.length if none
  exitStatementIndex: number;            // index of the closing blockEnd/blockElse, or statements.length if unclosed
};

export type ScopeDeclaration = {
  scopeId: ScopeId;
  statementIndex: number;   // document-order metadata; visibility starts here (no hoisting)
  bindingKind: "const" | "let";
  name: string;
  nameSpan: DslSpan | null;
  declaredType: ScalarType | null;
};

export type LegacyVariableRecord = { scopeId: ScopeId; statementIndex: number; name: string; nameSpan: DslSpan | null };

export type ForGroupIterationSlot = {
  scopeId: ScopeId;         // the forGroup body scope this slot belongs to
  statementIndex: number;
  name: string;             // "" for unnamed loops
  nameSpan: DslSpan | null;
};

export type LexicalScopeIndex = {
  rootScopeId: ScopeId;
  scopes: ReadonlyMap<ScopeId, LexicalScope>;
  scopeOfStatement: ReadonlyMap<number, ScopeId>;
  declarationsByScope: ReadonlyMap<ScopeId, readonly ScopeDeclaration[]>; // sorted by statementIndex
  allDeclarations: readonly ScopeDeclaration[];                          // full-document order
  legacyVariablesByScope: ReadonlyMap<ScopeId, readonly LegacyVariableRecord[]>;
  forGroupIterationSlots: ReadonlyMap<ScopeId, ForGroupIterationSlot>;
};

export type ResolveStatementId = (statementIndex: number, statement: DslStatement) => string;

// Pure core. No positional default: the caller must supply `resolveStatementId`.
export const buildLexicalScopeIndex: (
  statements: readonly DslStatement[],
  resolveStatementId: ResolveStatementId
) => LexicalScopeIndex;

// Scope chain from `scopeId` up to root (root last).
export const scopeChain: (index: LexicalScopeIndex, scopeId: ScopeId) => readonly ScopeId[];
```

```ts
// src/dsl/lexicalScopeIndexAdapter.ts (the only file that parses source text)
export const buildStructuralStatementIds: (statements: readonly DslStatement[]) => ResolveStatementId;
export const buildLexicalScopeIndexFromSource: (source: string) => LexicalScopeIndex;
```

**scope ID規則**: `root` / `group:<stableId>` / `for:<stableId>` /
`if:<stableId>:then` / `if:<stableId>:else`. `<stableId>` は常に呼び出し側が
注入する`resolveStatementId`の戻り値であり、`statementIndex`からも
geometry `ElementId`/`parentGroupId`からも導出しない。`DslStatement`自体は
まだstable IDを持たないため、`src/dsl/lexicalScopeIndexAdapter.ts`の
`buildStructuralStatementIds`が「親の解決済みID + 自身のkind/type/name
(+ ifの直下ならbranch) + 同名siblingのoccurrence連番」という構造的パスを
computeし、これを`resolveStatementId`として注入する。この構造パスは
`statementIndex`/`line`に依存しないため、無関係なstatementが前方へ挿入
されても既存scopeのIDは継承される(`src/dsl/lexicalScopeIndexAdapter.test.ts`
の"inherits an existing scope id..."で検証済み)。`statementIndex`/`line`は
scope/declaration/record上に残るが、あくまでdocument-order metadataであり、
`ScopeId`文字列そのものには一切現れない。

**then/elseの実装原則**: parser側の`enclosing`は`then`/`else`を同一frame
(`{statementIndex, branch}`)として表現するが、本indexは2つのsibling scope
(`if:<id>:then` / `if:<id>:else`)として作り直す。両者の`parentId`は
「`if`文自身を包むscope」であり、互いを親子にはしない。`else` scopeは
実際に対応する`} else {`が存在するときだけ作成する。

**stackを持たない設計**: 本moduleはparserの`applyBlockStructure`が行う
push/pop/branch-flipを独自stackで再実装しない。すべてのstatementの
scope所属・parent・branchは、そのstatement自身の`enclosing`を読むだけの
memoized再帰関数(`scopeOfStatement`相当)から導出する。これはmalformed
brace recoveryを自動的に安全にする: 何も pop/mutate しないため、
unmatchedな`blockEnd`/`blockElse`が無関係なscopeへ影響することは構造的に
起こり得ない(`src/scalars/lexicalScopeIndex.test.ts`の
"stays deterministic..."系4testで、unclosed block・stray `}`・
if-then外`else`・ブロックを開けない文の4パターンを検証済み)。12も
同じ原則(`enclosing`を正として読むだけ、独自stackを作らない)を踏襲する
こと。

**declaration order**: `declarationsByScope`は各scope内で`statementIndex`
昇順、`allDeclarations`は文書全体順。12は対象statementの位置と
`scopeChain(index, scopeId)`で得た祖先chainを組み合わせるだけで、
「その位置で見えるdeclaration候補」をsource再走査なしに列挙できる
(空間探索・再parseは不要)。

**legacy var record**: `legacyVariablesByScope`/`variable` kind文は
`{scopeId, statementIndex, name, nameSpan}`として収集するだけで、
duplicate検出・shadow解決・既存numeric var意味論への接続は一切行っていない
(D05のnamespace統合は12が担当)。

**forGroupIterationSlot**: `for`文のbody scope(`for:<id>`)ごとに1件、
synthetic `variable` attrから`name`/`nameSpan`を記録する。これは
`ScopeDeclaration`ではない — read-only、iterationごとに再生成される
bindingであり、12のname resolutionでは`declarationsByScope`とは別枠として
扱うこと。

呼び出し側の想定接続:

- **12(name resolution)**: `scopeOfStatement`、`declarationsByScope`、
  `scopeChain`だけで「position Nで見える最内側の有効binding」を解決できる。
  shadow/orderはstatementIndex比較で12が追加する。legacy var/typed binding
  の同一namespace統合(D05)も12が担当。
- **13(diagnostics)**: `legacyVariablesByScope`と`declarationsByScope`の
  名前衝突検出はTask 11ではguardしていないため、13が最初に検出する前提
  (Task 10のtypedDeclaration側と同じ約束)。

## 15. PR境界

scope indexingだけ。推奨branch slug: `typed-vars/11-scope-index`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
