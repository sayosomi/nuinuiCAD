import type { DslStatement } from "./dslTypes";

/**
 * Maps each `place` statement's own statementIndex to its
 * `(layoutId, placementIndex)` - the same "count place statements enclosed
 * by this printLayout block, in the order they appear" rule
 * `buildBlockPrintLayouts` (dslCompiler.ts) uses to build
 * `PrintLayout.placements[]`. Shared by `numericBindingCompiler.ts` (typed
 * `@name` compile) and `dslDocument.ts` (`StatementMap` `place:<layoutId>:
 * <placementIndex>` keys) so both stay in lockstep with the compiler's own
 * placement ordering - never reimplemented independently.
 */
export const buildPlacementRefsByStatementIndex = (
  statements: readonly DslStatement[],
  printLayoutIdsByStatementIndex: ReadonlyMap<number, string> | undefined
): ReadonlyMap<number, { layoutId: string; placementIndex: number }> => {
  const result = new Map<number, { layoutId: string; placementIndex: number }>();
  if (!printLayoutIdsByStatementIndex) return result;
  const placeCountByLayoutStatementIndex = new Map<number, number>();
  statements.forEach((statement, statementIndex) => {
    if (statement.kind !== "place" || statement.enclosing === null) return;
    const layoutStatementIndex = statement.enclosing.statementIndex;
    const layoutId = printLayoutIdsByStatementIndex.get(layoutStatementIndex);
    if (!layoutId) return;
    const placementIndex = placeCountByLayoutStatementIndex.get(layoutStatementIndex) ?? 0;
    placeCountByLayoutStatementIndex.set(layoutStatementIndex, placementIndex + 1);
    result.set(statementIndex, { layoutId, placementIndex });
  });
  return result;
};
