import type { DslStatement } from "./dslTypes";
import { geometryArrayTypeOfTypedDeclaration } from "./geometryArraySourceAnnotations";
import { isDslGeometryValueType } from "./dslValueTypes";

export type DslStatementInclusion = (statement: DslStatement, statementIndex: number) => boolean;

/**
 * Module definitions stay out of the ordinary root geometry/scalar paths.
 * Their concrete geometry and declarative transformation recipes are lowered
 * by the dedicated module materialization/compiler boundary.
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

/**
 * Runtime compilation excludes source-only value kinds at the shared guard.
 * Geometry arrays and single geometry values retain definition-backed source
 * semantics and are lowered only when an existing geometry consumer asks for
 * concrete runtime geometry.
 */
export const isCompilableDslStatement = (statements: readonly DslStatement[], statementIndex: number): boolean => {
  if (isInUnloweredModuleSubtree(statements, statementIndex)) return false;
  const statement = statements[statementIndex];
  if (
    statement?.kind === "typedDeclaration" &&
    (geometryArrayTypeOfTypedDeclaration(statement) || isDslGeometryValueType(statement.valueType))
  ) return false;
  return true;
};

/**
 * Canonical declaration metadata includes source-authored geometry-array
 * declarations even though the scalar/geometry runtime guard excludes them.
 * Module-body declarations remain owned by the source-only module path.
 */
export const isCanonicalValueBindingDeclaration = (
  statements: readonly DslStatement[],
  statementIndex: number
): boolean => statements[statementIndex]?.kind === "typedDeclaration" && !isInUnloweredModuleSubtree(statements, statementIndex);
