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
  addBezierExtremePoint: { type: "bezierExtremePoint", recipeKind: "fallback" },
  addLine: { type: "line", recipeKind: "specialized" },
  addAngleLengthLine: { type: "angleLengthLine", recipeKind: "specialized" },
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

/** Normal command IDs whose recipes are the command-line creation cutover source. */
export const legacyCreationCommandIds = Object.keys(
  legacyCreationCommandRecipeMap
) as CommandId[];

/** Returns the command-line recipe for a legacy creation command, if it has one. */
export const creationRecipeForLegacyCommand = (commandId: string): CreationRecipe | null => {
  const entry = legacyCreationCommandRecipeMap[commandId as keyof typeof legacyCreationCommandRecipeMap];
  return entry ? creationRecipeForType(entry.type) : null;
};
