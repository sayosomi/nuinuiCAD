import { constructionFor, isGeometryDeclarationCategory, type DslConstructionSpec } from "./dslConstructions";
import type { DslModuleParameterType, DslStatement } from "./dslTypes";

/** Public geometry interfaces exposed by Module signatures. */
export type ModuleGeometryInterfaceType = "point" | "line" | "path";

/** The existing runtime geometry domain: point || broad line-like geometry. */
export type ModuleRuntimeGeometryKind = "point" | "line";

/**
 * Converts a Module parameter's public interface to its runtime geometry kind.
 * `path` deliberately reuses the existing broad line-like runtime alias.
 */
export const moduleRuntimeGeometryKindOf = (
  type: DslModuleParameterType | null | undefined
): ModuleRuntimeGeometryKind | null => {
  const interfaceType = moduleGeometryInterfaceTypeOf(type);
  return interfaceType === "point" ? "point" : interfaceType === "line" || interfaceType === "path" ? "line" : null;
};

export const moduleGeometryInterfaceTypeOf = (
  type: DslModuleParameterType | null | undefined
): ModuleGeometryInterfaceType | null =>
  type?.kind === "point" || type?.kind === "line" || type?.kind === "path" ? type.kind : null;

/**
 * Classifies a persisted element declaration for Module interface checks.
 * This uses the existing construction registry, so the element category is
 * not mistaken for a strict straight-line guarantee.
 */
export const moduleGeometryInterfaceTypeOfElement = (
  statement: DslStatement | null | undefined
): ModuleGeometryInterfaceType | null => {
  if (statement?.kind !== "element" || !isGeometryDeclarationCategory(statement.category)) return null;
  return moduleGeometryInterfaceTypeOfConstruction(statement.category, constructionFor(statement.category, statement.construction));
};

/** Registry-derived interface classification shared by declaration and
 * construction-value analysis. */
export const moduleGeometryInterfaceTypeOfConstruction = (
  category: string,
  construction: DslConstructionSpec | null | undefined
): ModuleGeometryInterfaceType | null => {
  if (!construction) return null;
  if (category === "point") return "point";
  if (category !== "line" && category !== "curve" && category !== "arc") return null;
  return construction.elementType === "line" || construction.elementType === "angleLengthLine" || construction.elementType === "commonTangentLine"
    ? "line"
    : "path";
};

/** Module interface compatibility is directional, not an implicit conversion. */
export const isModuleGeometryInterfaceAssignable = (
  actual: ModuleGeometryInterfaceType | null | undefined,
  expected: ModuleGeometryInterfaceType | null | undefined
): boolean => {
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  return actual === "line" && expected === "path";
};
