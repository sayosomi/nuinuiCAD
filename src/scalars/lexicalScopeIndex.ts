// Pure lexical scope index over already-parsed DSL statements. See
// docs/typed-variables/tasks/11-lexical-scope-index.md. This module never
// parses source text and never imports src/dsl/dslDocument.ts or
// src/dsl/dslParser.ts runtime logic; it only reads the `DslStatement` shape
// (in particular `enclosing`, already computed once by the parser) and never
// re-derives block nesting with an independent stack. Scope membership,
// parent, and branch always come from reading a statement's own `enclosing`
// field - this is also what keeps malformed-brace recovery safe: nothing
// here is ever popped or mutated, so an unmatched `}` cannot corrupt a scope
// other than the one whose members legitimately point to it.
//
// Callers (see src/dsl/lexicalScopeIndexAdapter.ts) supply a stable
// per-statement id resolver. There is no positional fallback: scope IDs are
// never derived from a statement's array index, only from whatever stable
// identity the caller's resolver returns for a scope-opening statement.

import type { DslSpan, DslStatement } from "../dsl/dslTypes";
import type { ScalarType } from "./types";

export type ScopeKind = "root" | "group" | "then" | "else" | "forGroup";
export type ScopeId = string;

export type LexicalScope = {
  id: ScopeId;
  kind: ScopeKind;
  /** `null` only for root. */
  parentId: ScopeId | null;
  /** Document-order children; `then`/`else` appear as separate sibling entries. */
  childIds: readonly ScopeId[];
  /** Document-order metadata only - never part of `id`. `null` only for root. */
  openingStatementIndex: number | null;
  /** First statement index belonging to this scope, or `statements.length` if it has none. */
  entryStatementIndex: number;
  /** Index of the statement that closes this scope, or `statements.length` if never closed. */
  exitStatementIndex: number;
};

export type ScopeDeclaration = {
  scopeId: ScopeId;
  /** Document-order metadata; visibility starts here (no hoisting). */
  statementIndex: number;
  bindingKind: "const" | "let";
  name: string;
  nameSpan: DslSpan | null;
  declaredType: ScalarType | null;
};

export type LegacyVariableRecord = {
  scopeId: ScopeId;
  statementIndex: number;
  name: string;
  nameSpan: DslSpan | null;
};

export type ForGroupIterationSlot = {
  scopeId: ScopeId;
  statementIndex: number;
  /** "" for unnamed loops (`for (i from: 0 count: 3) { ... }`). */
  name: string;
  nameSpan: DslSpan | null;
};

export type LexicalScopeIndex = {
  rootScopeId: ScopeId;
  scopes: ReadonlyMap<ScopeId, LexicalScope>;
  scopeOfStatement: ReadonlyMap<number, ScopeId>;
  /** Each scope's declarations sorted by `statementIndex`. */
  declarationsByScope: ReadonlyMap<ScopeId, readonly ScopeDeclaration[]>;
  /** Full-document declaration order, for Task 12's position-based queries. */
  allDeclarations: readonly ScopeDeclaration[];
  legacyVariablesByScope: ReadonlyMap<ScopeId, readonly LegacyVariableRecord[]>;
  forGroupIterationSlots: ReadonlyMap<ScopeId, ForGroupIterationSlot>;
};

/**
 * Resolves a stable identity for the statement at `statementIndex`. Required
 * - there is no positional default - because a "reasonable" fallback based
 * on array index would defeat the purpose of the injection (D-equivalent:
 * scope IDs must never be array-index-derived). Real callers get this from
 * src/dsl/lexicalScopeIndexAdapter.ts; unit tests may use a simple stub.
 */
export type ResolveStatementId = (statementIndex: number, statement: DslStatement) => string;

const ROOT_SCOPE_ID: ScopeId = "root";

const isForGroup = (statement: DslStatement) => statement.kind === "element" && statement.type === "forGroup";
const isConditionalGroup = (statement: DslStatement) => statement.kind === "element" && statement.type === "conditionalGroup";
// A short `var Name = value` is its own statement kind, while the legacy
// call-form (`var Name = expression(value: ... scope: group)`) is an element
// statement. Task 12 must preserve both forms' established visibility rules,
// so the index records both without reparsing source text.
const isLegacyVariable = (statement: DslStatement) =>
  statement.kind === "variable" ||
  (statement.kind === "element" && statement.type === "variable" && statement.category === "var");

type MutableScope = {
  kind: ScopeKind;
  parentId: ScopeId | null;
  openingStatementIndex: number | null;
  childIds: ScopeId[];
};

export const buildLexicalScopeIndex = (
  statements: readonly DslStatement[],
  resolveStatementId: ResolveStatementId
): LexicalScopeIndex => {
  const scopeIdCache = new Map<number, ScopeId>();

  // The single source of truth for "which scope is statement i in?" - always
  // derived by reading that statement's own `enclosing`, memoized, never by
  // replaying a push/pop stack of our own.
  const scopeOfStatement = (index: number): ScopeId => {
    const cached = scopeIdCache.get(index);
    if (cached !== undefined) return cached;
    const statement = statements[index];
    const enclosing = statement.enclosing;
    let scopeId: ScopeId;
    if (enclosing === null) {
      scopeId = ROOT_SCOPE_ID;
    } else {
      const parent = statements[enclosing.statementIndex];
      if (parent.kind === "group") {
        scopeId = `group:${resolveStatementId(enclosing.statementIndex, parent)}`;
      } else if (isForGroup(parent)) {
        scopeId = `for:${resolveStatementId(enclosing.statementIndex, parent)}`;
      } else if (isConditionalGroup(parent)) {
        scopeId = `if:${resolveStatementId(enclosing.statementIndex, parent)}:${enclosing.branch}`;
      } else {
        // printLayout (or any other block-opening kind not tracked as a
        // lexical scope here): transparently delegate to the parent's own
        // containing scope instead of inventing a frame for it.
        scopeId = scopeOfStatement(enclosing.statementIndex);
      }
    }
    scopeIdCache.set(index, scopeId);
    return scopeId;
  };

  // A `blockElse` only legitimately closes a `then` scope when it matched an
  // open `conditionalGroup`-then frame in the real parser pass; that is
  // exactly the case where its own `enclosing` points at the `if` statement
  // with `branch: "then"`. An invalid/stray `} else {` gets some other
  // `enclosing` value and never lands here, so `else` scopes are only ever
  // created where a real one exists.
  const conditionalGroupsWithElse = new Set<number>();
  statements.forEach((statement) => {
    if (statement.kind !== "blockElse" || !statement.enclosing || statement.enclosing.branch !== "then") return;
    const parent = statements[statement.enclosing.statementIndex];
    if (isConditionalGroup(parent)) conditionalGroupsWithElse.add(statement.enclosing.statementIndex);
  });

  const scopes = new Map<ScopeId, MutableScope>();
  scopes.set(ROOT_SCOPE_ID, { kind: "root", parentId: null, openingStatementIndex: null, childIds: [] });

  const registerScope = (id: ScopeId, kind: ScopeKind, parentId: ScopeId, openingStatementIndex: number) => {
    if (scopes.has(id)) return;
    scopes.set(id, { kind, parentId, openingStatementIndex, childIds: [] });
    scopes.get(parentId)!.childIds.push(id);
  };

  statements.forEach((statement, index) => {
    if (!statement.opensBlock) return;
    const parentId = scopeOfStatement(index);
    if (statement.kind === "group") {
      registerScope(`group:${resolveStatementId(index, statement)}`, "group", parentId, index);
    } else if (isForGroup(statement)) {
      registerScope(`for:${resolveStatementId(index, statement)}`, "forGroup", parentId, index);
    } else if (isConditionalGroup(statement)) {
      const stableId = resolveStatementId(index, statement);
      registerScope(`if:${stableId}:then`, "then", parentId, index);
      if (conditionalGroupsWithElse.has(index)) registerScope(`if:${stableId}:else`, "else", parentId, index);
    }
    // Any other opensBlock kind (e.g. a malformed statement the real parser
    // also refused to push a frame for, or printLayout, which is not a
    // tracked scope kind here) intentionally creates no scope.
  });

  const memberIndices = new Map<ScopeId, number[]>();
  const declarationsByScope = new Map<ScopeId, ScopeDeclaration[]>();
  const legacyVariablesByScope = new Map<ScopeId, LegacyVariableRecord[]>();
  const allDeclarations: ScopeDeclaration[] = [];
  const forGroupIterationSlots = new Map<ScopeId, ForGroupIterationSlot>();

  statements.forEach((statement, index) => {
    const scopeId = scopeOfStatement(index);
    const members = memberIndices.get(scopeId);
    if (members) members.push(index);
    else memberIndices.set(scopeId, [index]);

    if (statement.kind === "typedDeclaration") {
      const declaration: ScopeDeclaration = {
        scopeId,
        statementIndex: index,
        bindingKind: statement.bindingKind,
        name: statement.name,
        nameSpan: statement.nameSpan,
        declaredType: statement.declaredType
      };
      const existing = declarationsByScope.get(scopeId);
      if (existing) existing.push(declaration);
      else declarationsByScope.set(scopeId, [declaration]);
      allDeclarations.push(declaration);
    } else if (isLegacyVariable(statement)) {
      const record: LegacyVariableRecord = {
        scopeId,
        statementIndex: index,
        name: statement.name,
        nameSpan: statement.nameSpan
      };
      const existing = legacyVariablesByScope.get(scopeId);
      if (existing) existing.push(record);
      else legacyVariablesByScope.set(scopeId, [record]);
    } else if (isForGroup(statement) && statement.opensBlock) {
      const forScopeId = `for:${resolveStatementId(index, statement)}`;
      const variableAttr = statement.attrs.find((attr) => attr.key === "variable");
      forGroupIterationSlots.set(forScopeId, {
        scopeId: forScopeId,
        statementIndex: index,
        name: variableAttr?.value ?? "",
        nameSpan: variableAttr ? { start: variableAttr.valueStart, end: variableAttr.valueEnd } : null
      });
    }
  });

  const finalizedScopes = new Map<ScopeId, LexicalScope>();
  for (const [id, info] of scopes) {
    const members = memberIndices.get(id) ?? [];
    const entryStatementIndex = members.length > 0 ? members[0] : statements.length;

    // Only `blockEnd` closes a group/forGroup/else scope. A `then` scope may
    // also be legitimately closed by its matching `blockElse` (see the
    // reasoning above); this is the one place `blockElse` counts as a valid
    // closer, because a rogue/duplicate `blockElse` can never be the last
    // member of a `then` scope (a valid flip only happens once, and nothing
    // afterward resolves back into the same `then` scope).
    let exitStatementIndex = statements.length;
    if (id !== ROOT_SCOPE_ID && members.length > 0) {
      const lastMember = statements[members[members.length - 1]];
      const validCloser = lastMember.kind === "blockEnd" || (info.kind === "then" && lastMember.kind === "blockElse");
      if (validCloser) exitStatementIndex = members[members.length - 1];
    }

    finalizedScopes.set(id, {
      id,
      kind: info.kind,
      parentId: info.parentId,
      childIds: info.childIds,
      openingStatementIndex: info.openingStatementIndex,
      entryStatementIndex,
      exitStatementIndex
    });
  }

  const scopeOfStatementMap = new Map<number, ScopeId>();
  statements.forEach((_, index) => scopeOfStatementMap.set(index, scopeOfStatement(index)));

  return {
    rootScopeId: ROOT_SCOPE_ID,
    scopes: finalizedScopes,
    scopeOfStatement: scopeOfStatementMap,
    declarationsByScope,
    allDeclarations,
    legacyVariablesByScope,
    forGroupIterationSlots
  };
};

/** Scope chain from `scopeId` up to root (root last). Convenience for Task 12. */
export const scopeChain = (index: LexicalScopeIndex, scopeId: ScopeId): readonly ScopeId[] => {
  const chain: ScopeId[] = [];
  let current: ScopeId | null = scopeId;
  while (current !== null) {
    chain.push(current);
    current = index.scopes.get(current)?.parentId ?? null;
  }
  return chain;
};
