// Adapter wiring the pure src/scalars/lexicalScopeIndex.ts core to the
// document layer's own stable statement identity - the one already
// maintained by statement reconciliation (e.g.
// StatementMap.elementIdByStatementIndex / CompileDslResult.elementIdsByStatementIndex
// for element-bearing statements such as group/if/forGroup - see
// src/document/statementReconciler.ts, src/dsl/dslDocument.ts). This module
// never invents a stand-in identity: not from statementIndex, a content
// hash, kind/type/name/nesting structure, || a traversal-order counter. It
// only requires the caller to supply the real mapping && wires it into the
// pure core's required resolver, throwing rather than silently substituting
// when an entry is missing.
//
// There is currently no source-only way to obtain this mapping (it requires
// reconciling against a previous document snapshot), so this module offers
// no "from source text alone" production convenience. Tests that need a
// statement array without wiring up real reconciled IDs define their own
// clearly test-only id maps locally instead (see
// lexicalScopeIndexAdapter.test.ts && test/typedVariablesScopeIndexPerformance.test.ts).
//
// See docs/typed-variables/tasks/11-lexical-scope-index.md.

import type { DslStatement } from "./dslTypes";
import { buildLexicalScopeIndex, type IncludeStatement, type LexicalScopeIndex } from "../scalars/lexicalScopeIndex";

export const buildLexicalScopeIndexFromStatements = (
  statements: readonly DslStatement[],
  stableStatementIdByIndex: ReadonlyMap<number, string>,
  includeStatement?: IncludeStatement
): LexicalScopeIndex =>
  buildLexicalScopeIndex(statements, (index) => {
    const id = stableStatementIdByIndex.get(index);
    if (id === undefined) {
      throw new Error(`lexicalScopeIndexAdapter: no stable statement id supplied for statement index ${index}`);
    }
    return id;
  }, includeStatement);
