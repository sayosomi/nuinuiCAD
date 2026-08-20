import type { CadElement, DrawingModifierDefinition, ElementId } from "../types/geometry";
import { isRustLinearMutationEligible } from "../scalars/linearMutationEvaluator";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import { buildRustBindingMutationPayload, type RustBindingMutationPayload } from "./bindingVersionPayload";
import type { EvaluateElementsOptions } from "./evaluate";
import type { PropertyBindingRuntimeEntry } from "./propertyBindingRuntime";
import type { NumericBindingRuntimeEntry } from "./numericBindingRuntime";
import { toRustTextTemplateSegments, type RustTextTemplateSegment } from "./textTemplateRuntime";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";

type ConditionExpressionInput = { elementId: ElementId; expression: TypedScalarExpression };
type TextTemplateInput = { elementId: ElementId; segments: readonly RustTextTemplateSegment[] };

export type EvaluateDocumentInput = {
  elements: CadElement[];
  evaluationLimitIndex?: number;
  allowDisabledElementIds?: readonly ElementId[];
  drawingModifiers?: readonly DrawingModifierDefinition[];
  selectedDrawingProfileId?: string;
  scalarProgram?: EvaluateElementsOptions["scalarProgram"];
  scalarExpressionPayload?: { numericBindings: readonly NumericBindingRuntimeEntry[] };
  bindingVersions?: RustBindingMutationPayload;
  propertyBindings?: readonly PropertyBindingRuntimeEntry[];
  numericBindings?: readonly NumericBindingRuntimeEntry[];
  controlBooleanBindings?: readonly PropertyBindingRuntimeEntry[];
  conditionExpressions?: readonly ConditionExpressionInput[];
  textTemplates?: readonly TextTemplateInput[];
  textPropertyBindings?: readonly PropertyBindingRuntimeEntry[];
  moduleMaterialization?: {
    instances: readonly ModuleMaterialization["instanceBaseGeometrySnapshots"][number][];
  };
};

/** The sole JSON-shaped projection sent to Rust, shared by Tauri && parity. */
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
        options.moduleForGroupMutationOwnerByElementId
      )
    : undefined;
  return {
    elements,
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
    ...(options.numericBindingEntries?.length ? { scalarExpressionPayload: { numericBindings: options.numericBindingEntries } } : {}),
    ...(options.controlBooleanEntries?.length ? { controlBooleanBindings: options.controlBooleanEntries } : {}),
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
