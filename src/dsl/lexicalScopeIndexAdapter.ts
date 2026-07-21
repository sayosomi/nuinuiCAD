// Adapter connecting the pure src/scalars/lexicalScopeIndex.ts core to real
// DSL source text. This file is the only place in the lexical-scope-index
// feature that imports parser runtime logic (`parseDsl`); the core itself
// never parses source and never imports this file, keeping the dependency
// direction src/dsl/ -> src/scalars/ and never the reverse.
//
// See docs/typed-variables/tasks/11-lexical-scope-index.md.

import { parseDsl } from "./dslParser";
import type { DslStatement } from "./dslTypes";
import { buildLexicalScopeIndex, type LexicalScopeIndex, type ResolveStatementId } from "../scalars/lexicalScopeIndex";

const isConditionalGroup = (statement: DslStatement) => statement.kind === "element" && statement.type === "conditionalGroup";

const structuralKeyOf = (statement: DslStatement): string => {
  if (statement.kind === "element") return `element:${statement.type ?? ""}:${statement.name}`;
  if (statement.kind === "blockEnd" || statement.kind === "blockElse") return statement.kind;
  return `${statement.kind}:${statement.name}`;
};

/**
 * Builds a structural, position-independent stable id for every statement:
 * parent's own resolved id + this statement's kind/type/name (+ branch, when
 * directly inside an `if`), disambiguated by an occurrence counter among
 * identically-keyed siblings at that nesting level. This depends only on
 * structural content and relative nesting, never on `statementIndex`/`line`,
 * so inserting an unrelated statement earlier in the document never changes
 * the id of an unaffected scope-opening statement elsewhere.
 *
 * Genuinely duplicate siblings (same kind/type/name at the same nesting
 * level, e.g. two sibling `group A { ... }` blocks) fall back to an
 * occurrence-index suffix - the one case where relative document order still
 * matters, which is an inherent limit of a name-based identity, not a defect.
 */
export const buildStructuralStatementIds = (statements: readonly DslStatement[]): ResolveStatementId => {
  const idCache = new Map<number, string>();
  const siblingOccurrence = new Map<string, number>();

  const resolve = (index: number): string => {
    const cached = idCache.get(index);
    if (cached !== undefined) return cached;
    const statement = statements[index];
    const enclosing = statement.enclosing;
    const parentPath = enclosing === null ? "root" : resolve(enclosing.statementIndex);
    const branchPart = enclosing !== null && isConditionalGroup(statements[enclosing.statementIndex]) ? `:${enclosing.branch}` : "";
    const key = `${parentPath}${branchPart}/${structuralKeyOf(statement)}`;

    const occurrence = siblingOccurrence.get(key) ?? 0;
    siblingOccurrence.set(key, occurrence + 1);
    const id = occurrence === 0 ? key : `${key}#${occurrence}`;
    idCache.set(index, id);
    return id;
  };

  return (index) => resolve(index);
};

export const buildLexicalScopeIndexFromSource = (source: string): LexicalScopeIndex => {
  const parsed = parseDsl(source);
  return buildLexicalScopeIndex(parsed.statements, buildStructuralStatementIds(parsed.statements));
};
