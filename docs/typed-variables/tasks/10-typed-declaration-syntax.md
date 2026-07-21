# 10: Typed const/let declaration syntax / serializer

## 1. タイトル

10: Typed const/let declaration syntax / serializer

## 2. 目的

nui3のconst/let、型注釈、initializer、choice options、declaration spansとserializerを実装する。

## 3. 依存タスク

06, 09

## 4. 前提API・型

`DslTypedDeclarationStatement`、name/type/initializer spans、`serializeTypedDeclaration`。

## 5. 対象

line parser、explicit type grammar、initializer raw span、stable statement identity連携、declaration-only completion context metadata、canonical serializer。

## 6. 対象外

set syntax、name resolution、expression typecheck/evaluation。

## 7. 固定仕様

明示型必須。choice optionsはordered bare tokens、空/duplicate/true/falseは禁止。set parserを一切実装しない。

## 8. 実装方針

既存parser facadeへv3-only statement kindを追加し、initializer内容はraw spanとして14へ渡す。

## 9. 変更対象ファイル

DSL statement types/parser/serializer/reconciler identity tests、新規focused declaration parser。

## 10. 追加・更新するテスト

const/let全型、missing type/init、choice validation、vertical周辺行、comments、spans、v2 version error、round-trip。

## 11. 互換性条件

legacy var parser/serializerは変更しない。open/save無変更。

## 12. performance条件

1 statement parseはlength線形。1000 declaration parse sanityは00 helperを利用。

## 13. 完了条件

parse/serializeだけで完結し、set文字列をunknown statementとして扱う。

## 14. 次タスクへの引き継ぎ

11はscope node、14はinitializer AST、19はcompiled programへ接続する。

実装済みAPI(production未接続、`nonElementKinds`によりCadElementもreconcilerも一切関与しない):

```ts
// src/dsl/dslDeclarationParser.ts
export type DslDeclarationDiagnostic = { message: string; span: DslSpan; code?: string };

export type DslTypedDeclarationStatement = {
  kind: "typedDeclaration";
  bindingKind: "const" | "let";
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  declaredType: ScalarType | null;       // null when the type annotation itself failed to parse
  choiceOptionSpans: readonly DslSpan[]; // index-aligned with declaredType.options when it's a choice type
  initializer: string;                   // raw, unparsed initializer text
  payloadSpans: Record<string, DslSpan>; // {name?, type?, initializer?}, same convention as layoutVar
  args: []; attrs: []; opensBlock: false;
};

export const parseDslTypedDeclarationStatement: (logicalText: string) => {
  statement: DslTypedDeclarationStatement | null; // null only when the leading keyword isn't const/let
  diagnostics: DslDeclarationDiagnostic[];
};

// src/dsl/dslDeclarationSerializer.ts
export const serializeTypedDeclaration: (
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>
) => string; // "const NAME: TYPE = <initializer verbatim>" - no majorVersion branch, v3-only statement
```

`DslStatement`(`src/dsl/dslTypes.ts`)にも同じフィールド構成で
`{ kind: "typedDeclaration"; bindingKind; declaredType; choiceOptionSpans; initializer }`
がunion memberとして追加済み。`dslParser.ts`の`dslStatementKeywords`に
`const`/`let`が登録済みで、`nonElementKinds`にも`"typedDeclaration"`が入って
いるため、`parseDslSnapshot`/`compileDslDocument`は通常のstatementとして
これを返すが、`isElementDslStatement`が`false`を返すのでCadElement化・
statementReconciler照合・`reportDuplicateNames`のいずれにも参加しない
(同名重複チェックは意図的に未実装 — 11-13のbinding resolutionが担当)。

version gateは`dslCompiler.ts`の`typedDeclarationVersionDiagnostics`が
`compileDslToElements`内で(07のstate:と同じ`requireDslMajorVersionForFeature`
経由で)`typed-syntax-requires-nui3`を発行する。parse自体はversion非依存で
常に成功する。

**initializerはraw textのみ、evaluation/typecheck/expression parseは一切
行っていない。** `scanScalarLiteral`(09)を呼ぶのは`choice(...)`型注釈の
option token判定だけで、initializer側では一度も呼んでいない。
`serializeTypedDeclaration`もdeclaration外殻(keyword/spacing/name/`: `/
type text/` = `)だけをcanonical化し、`=`の後のinitializer文字列は空白・
quote・escape・括弧を含めsource span由来のbyte-for-byte出力である
(再quote・re-escape・空白正規化を一切行わない)。plan.mdの
「stringはdouble quoteと定義済みescapeへcanonicalizeする」はTask 10の
出力ではなく、initializerが実際にparse/typecheckされた後(14以降/46)の
挙動を指しているので、46実装時にこの差分を見落とさないこと。

呼び出し側の想定接続:

- **11(lexical scope index)**: `parsed.statements.filter(s => s.kind ===
  "typedDeclaration")`を`enclosing`(scope nesting)と`bindingKind`/`name`/
  `nameSpan`で直接消費できる。同名重複はTask 10ではguardしていないため、
  11がbinding coreとして最初に検出する前提。
- **14(TS expression parser)**: `statement.initializer`
  (`payloadSpans.initializer`のraw text)を独自tokenizerでゼロから
  re-tokenizeする。Task 10はこの文字列の中身について一切の形状検証をして
  いない(数値式として壊れていても診断を出さない)。
- **19(compiled scalar program)**: `bindingKind`/`declaredType`/
  `choiceOptionSpans`が`ScalarProgramStatement`へ持ち上げるための構造化
  フィールド。`declaredType`は`src/scalars/types.ts`の`ScalarType`をその
  まま再利用しているため変換不要。

## 15. PR境界

declaration syntax/serializerだけ。推奨branch slug: `typed-vars/10-declaration-syntax`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
