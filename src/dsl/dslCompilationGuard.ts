import type { DslStatement } from "./dslTypes";

/**
 * Task 1 module definitions are source-AST-only. Until module lowering exists,
 * every statement whose enclosing chain reaches a module definition must stay
 * out of the existing geometry/scalar compilation paths.
 */
export const isInUnloweredModuleSubtree = (
  statements: readonly DslStatement[],
  statementIndex: number
): boolean => {
  const visited = new Set<number>();
  let currentIndex = statementIndex;
  while (currentIndex >= 0 && currentIndex < statements.length && !visited.has(currentIndex)) {
    visited.add(currentIndex);
    const statement = statements[currentIndex];
    if (statement.kind === "moduleDefinition") return true;
    const enclosing = statement.enclosing;
    if (!enclosing) return false;
    currentIndex = enclosing.statementIndex;
  }
  return false;
};

export const isCompilableDslStatement = (statements: readonly DslStatement[], statementIndex: number): boolean =>
  !isInUnloweredModuleSubtree(statements, statementIndex);
