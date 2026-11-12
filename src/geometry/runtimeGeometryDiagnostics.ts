import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import { sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import type { DslDiagnostic } from "@nuinuicad/nui-language";
import type { TransformationRecipe } from "@nuinuicad/nui-language";
import type {
  DependencyError,
  ElementId,
  GeometryValueEvaluationError
} from "../types/geometry";

type RuntimeDrawableDiagnostic = DslDiagnostic & {
  origin: "runtime";
  elementId: ElementId;
};

type RuntimeGeometryValueDiagnostic = DslDiagnostic & {
  origin: "runtime";
  elementId?: never;
  bindingId?: never;
  physicalSpan: NonNullable<DslDiagnostic["physicalSpan"]>;
  exactSpanOnly: true;
  navigationTarget: { kind: "sourceSpan"; physicalSpan: NonNullable<DslDiagnostic["physicalSpan"]> };
};

type RuntimeTransformationDiagnostic = DslDiagnostic & {
  origin: "runtime";
  elementId?: never;
  bindingId?: never;
  statementIndex: number;
  physicalSpan: NonNullable<DslDiagnostic["physicalSpan"]>;
  exactSpanOnly: true;
  navigationTarget: { kind: "sourceSpan"; physicalSpan: NonNullable<DslDiagnostic["physicalSpan"]> };
};

export type RuntimeGeometryDiagnostic =
  | RuntimeDrawableDiagnostic
  | RuntimeGeometryValueDiagnostic
  | RuntimeTransformationDiagnostic;

const transformationRecipesFor = (document: CompiledDslDocument): readonly TransformationRecipe[] =>
  document.runtimeTransformationRecipes ?? document.transformationRecipes ?? document.document?.transformationRecipes ?? [];

/** Resolve a synthetic recipe id only through the recipe's current source
 * identity. A stale id/index pair or a non-transformation statement must not
 * fall through to drawable ownership. */
const transformationStatementFor = (
  recipe: TransformationRecipe,
  document: CompiledDslDocument
) => {
  const statementMap = document.statementMap;
  const statementIndex = recipe.sourceStatementIndex;
  if (!statementMap || !Number.isInteger(statementIndex) || statementIndex < 0) return null;
  const statement = document.statements[statementIndex];
  const statementInfo = statementMap.statements[statementIndex];
  if (!statement || statement.kind !== "transformation" || statement.construction !== recipe.construction ||
      !statementInfo || statementInfo.kind !== "transformation" || statementInfo.statementIndex !== statementIndex ||
      statementInfo.sourceRevision !== statement.sourceRevision || statementMap.sourceRevision !== statement.sourceRevision ||
      !statement.physicalSpan.segments.length) return null;

  if (recipe.sourceStatementId !== undefined) {
    if (statementMap.statementIdByStatementIndex?.get(statementIndex) !== recipe.sourceStatementId ||
        statementMap.statementIndexByStatementId?.get(recipe.sourceStatementId) !== statementIndex ||
        statementMap.statementRangeById.get(recipe.sourceStatementId)?.statementIndex !== statementIndex) return null;
  } else if (statementMap.statementIdByStatementIndex?.has(statementIndex) ||
             recipe.id !== `transformation:${statementIndex}`) {
    return null;
  }
  return { statement, statementIndex };
};

const transformationDiagnostic = (
  recipe: TransformationRecipe,
  error: DependencyError,
  document: CompiledDslDocument
): RuntimeTransformationDiagnostic | null => {
  const owner = transformationStatementFor(recipe, document);
  if (!owner) return null;
  const { statement, statementIndex } = owner;
  const physicalSpan = statement.physicalSpan;
  const source = document.spans.sourceMap.source;
  const prefix = source.slice(0, physicalSpan.segments[0]!.from);
  return {
    severity: "error",
    line: statement.line,
    column: prefix.length - prefix.lastIndexOf("\n"),
    message: error.message,
    sourceRevision: statement.sourceRevision,
    physicalSpan,
    exactSpanOnly: true,
    origin: "runtime",
    statementIndex,
    navigationTarget: { kind: "sourceSpan", physicalSpan }
  };
};

/**
 * Project current geometry-evaluation failures onto their authored source
 * statements so host adapters can present them through the same runtime
 * diagnostic layer as scalar evaluation failures.
 *
 * Runtime elements without a current authored owner fail closed: a diagnostic
 * with a guessed or stale source location is worse than omitting that row.
 */
export const runtimeGeometryDiagnostics = (input: {
  errors?: readonly DependencyError[];
  geometryValueErrors?: readonly GeometryValueEvaluationError[];
  compiledDocument: CompiledDslDocument;
}): readonly RuntimeGeometryDiagnostic[] => {
  const statementMap = input.compiledDocument.statementMap;
  if (!statementMap) return [];

  const drawableDiagnostics = (input.errors ?? []).flatMap((error): (RuntimeDrawableDiagnostic | RuntimeTransformationDiagnostic)[] => {
    const matchingRecipes = transformationRecipesFor(input.compiledDocument)
      .filter(recipe => recipe.id === error.elementId);
    if (matchingRecipes.length > 0) {
      if (matchingRecipes.length !== 1) return [];
      const diagnostic = transformationDiagnostic(matchingRecipes[0]!, error, input.compiledDocument);
      return diagnostic ? [diagnostic] : [];
    }
    const owner = sourceOwnerForRuntimeElementId(
      {
        statementMap,
        moduleMaterialization: input.compiledDocument.moduleMaterialization
      },
      error.elementId
    );
    if (!owner) return [];

    const sourceElementId = statementMap.elementIdByStatementIndex.get(owner.sourceStatementIndex);
    return [{
      severity: "error" as const,
      line: owner.statement.line,
      column: 1,
      message: error.message,
      sourceRevision: owner.statement.sourceRevision,
      origin: "runtime" as const,
      elementId: error.elementId,
      statementIndex: owner.sourceStatementIndex,
      ...(sourceElementId
        ? { navigationTarget: { kind: "element" as const, elementId: sourceElementId } }
        : {})
    }];
  });

  const geometryValueDiagnostics = (input.geometryValueErrors ?? []).flatMap((error): RuntimeGeometryValueDiagnostic[] => {
    const statementIndex = statementMap.statementIndexByStatementId?.get(error.occurrence.sourceStatementId);
    if (statementIndex === undefined) return [];
    const statement = input.compiledDocument.statements[statementIndex];
    const part = statement?.kind === "element" ? statement.extractPart : undefined;
    const head = part && input.compiledDocument.statements[part.declarationIndex];
    const boundary = error.extract?.boundary;
    const physicalSpan = head?.kind === "extract" && part
      ? boundary === "left" ? head.parts[part.partIndex]?.leftPhysicalSpan
        : boundary === "right" ? head.parts[part.partIndex]?.rightPhysicalSpan : statement.namePhysicalSpan
      : statement?.kind === "typedDeclaration" ? statement.namePhysicalSpan : undefined;
    if (!physicalSpan?.segments.length) return [];
    const prefix = input.compiledDocument.spans.sourceMap.source.slice(0, physicalSpan.segments[0]!.from);
    return [{
      severity: "error",
      line: prefix.split("\n").length,
      column: prefix.length - prefix.lastIndexOf("\n"),
      message: error.message,
      sourceRevision: statement.sourceRevision,
      physicalSpan,
      exactSpanOnly: true,
      origin: "runtime",
      statementIndex,
      navigationTarget: { kind: "sourceSpan", physicalSpan }
    }];
  });

  return [...drawableDiagnostics, ...geometryValueDiagnostics];
};
