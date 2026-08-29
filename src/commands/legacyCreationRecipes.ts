import type { CadElementType } from "../types/geometry";
import type { CommandId } from "./commandTypes";
import { creationRecipeForType, type CreationRecipe } from "./creationRecipes";

/**
 * Legacy creation commands that Phase 4g replaces with command-line sessions.
 * `recipeKind` documents whether the step order is specialized || generated.
 */
export const legacyCreationCommandRecipeMap = {
  addFreePoint: { type: "freePoint", recipeKind: "specialized" },
  addText: { type: "text", recipeKind: "fallback" },
  addOffsetPoint: { type: "offsetPoint", recipeKind: "fallback" },
  addPolarOffsetPoint: { type: "polarOffsetPoint", recipeKind: "fallback" },
  addDivisionPoint: { type: "divisionPoint", recipeKind: "specialized" },
  addLineDivisionPoint: { type: "lineDivisionPoint", recipeKind: "specialized" },
  addIntersectionPoint: { type: "intersectionPoint", recipeKind: "fallback" },
  addLineTangentOffsetPoint: { type: "lineTangentOffsetPoint", recipeKind: "fallback" },
  addBezierBulgePoint: { type: "bezierBulgePoint", recipeKind: "fallback" },
  addBezierExtremePoint: { type: "bezierExtremePoint", recipeKind: "fallback" },
  addLine: { type: "line", recipeKind: "specialized" },
  addAngleLengthLine: { type: "angleLengthLine", recipeKind: "specialized" },
  addCommonTangentLine: { type: "commonTangentLine", recipeKind: "fallback" },
  addArcLine: { type: "arcLine", recipeKind: "specialized" },
  addThreePointArcLine: { type: "threePointArcLine", recipeKind: "fallback" },
  addCornerRadiusArcLine: { type: "cornerRadiusArcLine", recipeKind: "fallback" },
  addEdge: { type: "edge", recipeKind: "fallback" },
  addExtendTrim: { type: "extendTrim", recipeKind: "fallback" },
  addBezierCurve: { type: "bezierCurve", recipeKind: "specialized" },
  addOffsetLine: { type: "offsetLine", recipeKind: "specialized" },
  addCopyLine: { type: "copyLine", recipeKind: "specialized" },
  addSymmetricCopyLine: { type: "symmetricCopyLine", recipeKind: "specialized" },
  addMove: { type: "move", recipeKind: "specialized" },
  addSymmetricMove: { type: "symmetricMove", recipeKind: "specialized" },
  addSplitLine: { type: "splitLine", recipeKind: "fallback" }
} as const satisfies Readonly<Record<string, {
  type: CadElementType;
  recipeKind: "specialized" | "fallback";
}>>;

/**
 * Recipe-generatable types intentionally omitted from the legacy Create
 * Geometry / Quick Create catalog. Polyline needs a variable-length point-list
 * flow, while pathReverse acts on a selected existing path and is inserted by
 * its selection command rather than as a standalone creation action.
 */
export const legacyCreationCatalogExclusions = [
  {
    type: "polyline",
    rationale: "Polyline needs a variable-length point-list flow that the recipe-backed catalog does not provide."
  },
  {
    type: "pathReverse",
    rationale: "Path reversal acts on a selected existing path and is inserted by its selection command."
  }
] as const satisfies readonly { type: CadElementType; rationale: string }[];

/** Normal command IDs whose recipes are the command-line creation cutover source. */
export const legacyCreationCommandIds = Object.keys(
  legacyCreationCommandRecipeMap
) as CommandId[];

/** Returns the command-line recipe for a legacy creation command, if it has one. */
export const creationRecipeForLegacyCommand = (commandId: string): CreationRecipe | null => {
  const entry = legacyCreationCommandRecipeMap[commandId as keyof typeof legacyCreationCommandRecipeMap];
  return entry ? creationRecipeForType(entry.type) : null;
};
