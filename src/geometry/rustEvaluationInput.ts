import type { CadElement, DrawingModifierDefinition, ElementId } from "../types/geometry";
import { isRustLinearMutationEligible } from "../scalars/linearMutationEvaluator";
import type { TypedScalarExpression, TypedDependencyGraph } from "@nuinuicad/nui-language";
import { buildRustBindingMutationPayload, type RustBindingMutationPayload } from "./bindingVersionPayload";
import type { EvaluateElementsOptions } from "./evaluate";
import type { PropertyBindingRuntimeEntry } from "./propertyBindingRuntime";
import type { NumericBindingRuntimeEntry } from "./numericBindingRuntime";
import { toRustTextTemplateSegments, type RustTextTemplateSegment } from "./textTemplateRuntime";
import type { ModuleMaterialization } from "@nuinuicad/nui-language";
import type { GeometryInputCollectionNode } from "../types/geometry";
import type { GeometryInputTarget } from "../types/geometry";

type ConditionExpressionInput = { elementId: ElementId; expression: TypedScalarExpression };
type TextTemplateInput = { elementId: ElementId; segments: readonly RustTextTemplateSegment[] };

const rustGeometryInputTarget = (target: GeometryInputTarget): GeometryInputTarget => {
  const withoutSourceText = { ...target } as GeometryInputTarget & { sourceText?: string };
  delete withoutSourceText.sourceText;
  if (withoutSourceText.kind === "geometryValueMap") {
    return {
      ...withoutSourceText,
      source: rustGeometryInputTarget(withoutSourceText.source)
    } as GeometryInputTarget;
  }
  return withoutSourceText as GeometryInputTarget;
};

const isGeometryInputTargetList = (
  target: GeometryInputTarget | readonly GeometryInputTarget[]
): target is readonly GeometryInputTarget[] => Array.isArray(target);

export type EvaluateDocumentInput = {
  elements: CadElement[];
  evaluationOrder?: readonly ElementId[];
  transformationRecipes?: readonly import("@nuinuicad/nui-language").TransformationRecipe[] | {
    recipes: readonly import("@nuinuicad/nui-language").TransformationRecipe[];
    dependencyPlans: readonly import("@nuinuicad/nui-language").TypedTransformationDependencyPlan[];
  };
  transformationDependencyPlans?: readonly import("@nuinuicad/nui-language").TypedTransformationDependencyPlan[];
  sourceStatementIndices?: Array<{ elementId: ElementId; statementIndex: number }>;
  evaluationLimitIndex?: number;
  allowDisabledElementIds?: readonly ElementId[];
  drawingModifiers?: readonly DrawingModifierDefinition[];
  selectedDrawingProfileId?: string;
  scalarProgram?: EvaluateElementsOptions["scalarProgram"];
  scalarExpressionPayload?: {
    numericBindings: readonly NumericBindingRuntimeEntry[];
    conditionalDependencyGraph?: Pick<TypedDependencyGraph, "edges">;
  };
  bindingVersions?: RustBindingMutationPayload;
  propertyBindings?: readonly PropertyBindingRuntimeEntry[];
  numericBindings?: readonly NumericBindingRuntimeEntry[];
  controlBooleanBindings?: readonly PropertyBindingRuntimeEntry[];
  geometryValueProgram?: EvaluateElementsOptions["geometryValueProgram"];
  geometryInputTargets?: Array<{
    elementId: ElementId;
    parameters: Array<{
      parameterKey: string;
      target: import("../types/geometry").GeometryInputTarget | readonly import("../types/geometry").GeometryInputTarget[];
    }>;
  }>;
  geometryCollectionNodes?: Array<{
    collectionValueId: string;
    value: GeometryInputCollectionNode;
  }>;
  conditionExpressions?: readonly ConditionExpressionInput[];
  textTemplates?: readonly TextTemplateInput[];
  textPropertyBindings?: readonly PropertyBindingRuntimeEntry[];
  moduleMaterialization?: {
    instances: readonly ModuleMaterialization["instanceBaseGeometrySnapshots"][number][];
  };
};

/** The sole JSON-shaped projection sent to Rust, shared by host transports and parity. */
export const buildRustEvaluationInput = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {},
  {
    includeBindingVersions = true
  }: { includeBindingVersions?: boolean } = {}
): EvaluateDocumentInput => {
  const mutationPayload = includeBindingVersions && options.bindingVersions && isRustLinearMutationEligible(options.bindingVersions)
    ? buildRustBindingMutationPayload(
        options.bindingVersions,
        elements,
        options.statementInfoByElementId,
        options.statementIdByStatementIndex,
        options.sourceExecutionPositionByElementId,
        options.scalarExecutionPositionByElementId,
        options.moduleConditionalOwnerStatementIdByElementId,
        options.moduleForGroupExecutionOwnerByElementId,
        options.scalarProgram?.collectionValues
      )
    : undefined;
  return {
    elements,
    ...(options.evaluationOrder ? { evaluationOrder: options.evaluationOrder } : {}),
    ...(options.transformationRecipes?.length
      ? {
          transformationRecipes: {
            recipes: options.transformationRecipes,
            dependencyPlans: options.transformationDependencyPlans ?? []
          }
        }
      : {}),
    ...(options.statementInfoByElementId?.size
      ? {
          sourceStatementIndices: Array.from(options.statementInfoByElementId, ([elementId, info]) => ({
            elementId,
            statementIndex: info.statementIndex
          }))
        }
      : {}),
    evaluationLimitIndex: options.evaluationLimitIndex,
    ...(options.allowDisabledElementIds?.size
      ? { allowDisabledElementIds: Array.from(options.allowDisabledElementIds) }
      : {}),
    drawingModifiers: options.drawingModifiers ?? [],
    ...(options.selectedDrawingProfileId ? { selectedDrawingProfileId: options.selectedDrawingProfileId } : {}),
    ...(mutationPayload
      ? { bindingVersions: mutationPayload }
      : options.scalarProgram ? { scalarProgram: options.scalarProgram } : {}),
    ...(options.propertyBindingEntries?.length ? { propertyBindings: options.propertyBindingEntries } : {}),
    ...((options.numericBindingEntries?.length || options.typedDependencyGraph)
      ? {
          scalarExpressionPayload: {
            numericBindings: options.numericBindingEntries ?? [],
            ...(options.typedDependencyGraph
              ? { conditionalDependencyGraph: { edges: options.typedDependencyGraph.edges } }
              : {})
          }
        }
      : {}),
    ...(options.controlBooleanEntries?.length ? { controlBooleanBindings: options.controlBooleanEntries } : {}),
    ...(options.geometryValueProgram?.length ? { geometryValueProgram: options.geometryValueProgram } : {}),
    ...(options.geometryInputTargetsByElementId?.size
      ? {
          geometryInputTargets: Array.from(options.geometryInputTargetsByElementId, ([elementId, parameters]) => ({
          elementId,
            parameters: Array.from(parameters, ([parameterKey, target]) => ({
              parameterKey,
              target: isGeometryInputTargetList(target)
                ? target.map((item) => rustGeometryInputTarget(item))
                : rustGeometryInputTarget(target)
            }))
          }))
        }
      : {}),
    ...(options.geometryCollectionNodesByValueId?.size
      ? { geometryCollectionNodes: Array.from(options.geometryCollectionNodesByValueId, ([collectionValueId, value]) => ({ collectionValueId, value })) }
      : {}),
    ...(options.conditionalGroupConditionsByElementId?.size
      ? { conditionExpressions: Array.from(options.conditionalGroupConditionsByElementId, ([elementId, expression]) => ({ elementId, expression })) }
      : {}),
    ...(options.textTemplateEntriesByElementId?.size
      ? { textTemplates: Array.from(options.textTemplateEntriesByElementId, ([elementId, ast]) => ({ elementId, segments: toRustTextTemplateSegments(ast) })) }
      : {}),
    ...(options.textPropertyBindingEntries?.length ? { textPropertyBindings: options.textPropertyBindingEntries } : {}),
    ...(options.moduleMaterialization?.instanceBaseGeometrySnapshots.length
      ? { moduleMaterialization: { instances: options.moduleMaterialization.instanceBaseGeometrySnapshots } }
      : {})
  };
};
