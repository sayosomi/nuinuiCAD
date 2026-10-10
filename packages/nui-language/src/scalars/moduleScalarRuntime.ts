import { encodeIdentityTuple } from "../document/identityTuple";
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { isCompilableDslStatement } from "../dsl/dslCompilationGuard";
import type { DslStatement } from "../dsl/dslTypes";
import type { DocumentId, DocumentQualifiedSemanticIdentity } from "../document/multiDocumentPrimitives";
import type { StatementIdentity } from "../document/statementIdentity";
import type {
  ModuleBodyStatementSemantic,
  ModuleDefinitionSemantic,
  ModuleInstanceSemantic,
  ModuleGeometryBuiltinArgumentSemantic,
  ModuleGeometryPropertySourceTarget,
  ModuleRecordSourceTarget,
  ModuleRecordFieldValueExpressionSemantic,
  ModuleRecordValueSemantic,
  ModuleRecordValueExpressionSemantic,
  ModuleScalarExpressionSemantic,
  ModuleScalarSourceTarget,
  ModuleSemanticAnalysis
} from "../dsl/moduleSemanticTypes";
import { unwrapModuleGeometrySourceTarget } from "../dsl/moduleSemanticTypes";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOf,
  type ModuleGeometryInterfaceType
} from "../dsl/moduleGeometryInterfaces";
import { moduleOwnerIdFor, type ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { ModuleGeometryPropertyRuntimeTarget, ModuleGeometryRuntimeCompilation } from "../dsl/moduleGeometryRuntime";
import { geometryInputTargetForAlias, geometryValueOccurrenceForRecordField, moduleCarryBindingIdFor, type GeometryAlias, type RuntimeGeometryCollectionNode, type RuntimeGeometryInputTarget } from "../dsl/moduleGeometryRuntimeLowering";
import type {
  GeometryValueProgram,
  GeometryValueProgramEntry,
  GeometryValueProgramNode,
  GeometryValueProgramPath,
  GeometryValueProgramPoint,
  GeometryValueProgramTarget
} from "../dsl/moduleGeometryValueProgram";
import { buildLexicalScopeIndexFromStatements } from "../dsl/lexicalScopeIndexAdapter";
import type { CadElement, DrawingModifierDefinition, ElementId, GeometryInputCollectionNode, GeometryInputTarget, PointAnchor } from "../types/geometry";
import { isNumericExpression } from "../geometry/numericExpressions";
import { findParameterDefinition, scalarTypeForParameterDefinition } from "../parameters/parameterDefinitions";
import type { BindingAnalysis, InitializerReference } from "./bindingAnalysis";
import { analyzeBindings } from "./bindingAnalysis";
import {
  buildBindingCatalog,
  type Binding,
  type BindingId,
  type BindingSeed
} from "./bindingCatalog";
import { buildBindingControlMetadata, type BindingControlMetadata, type BindingControlOwner, type ImmutableCollectionCarry, type ImmutableForGroupPlan, type ImmutableGeometryCollectionCarry } from "./bindingVersions";
import type { LexicalScopeIndex } from "./lexicalScopeIndex";
import {
  lowerScalarProgram,
  remapTypedExpressionSourceOrders,
  type ScalarProgram,
  type ScalarProgramCollection,
  type ScalarProgramCollectionMember,
  type ScalarProgramRecordField
} from "./scalarProgram";
import type { ScalarExpressionType, ScalarType } from "./types";
import type { ScalarValue } from "./types";
import { scalarValueMatchesType } from "./types";
import type {
  ScalarExpressionResolvedGeometryProperty,
  ScalarExpressionResolvedGeometryTarget,
  ScalarExpressionResolvedOptionalMemberTarget,
  ScalarExpressionResolvedReference,
  TypedScalarExpression
} from "./typedExpressionAst";
import type { TextTemplateAst, TextTemplateDependency, TextTemplateSegment } from "./textTemplate";
import { scanTextTemplateLiteral } from "./textTemplateScan";
import { optionalCollectionMatchPresenceProjection, typecheckScalarExpression } from "./expressionTypecheck";
import { getBuiltinFunctionDefinition } from "./builtinFunctions";
import type { BindingResolution } from "./bindingResolution";
import { collectScalarExpressionReferences } from "./expressionReferenceCollector";
import {
  transformationNumericInputs,
  type CompiledNumericBinding,
  type CompiledTransformationNumericBinding
} from "./numericBindingCompiler";
import { numericSourceForModuleSite, numericSourceForModuleValue } from "./moduleNumericRuntime";
import type { ScalarValueSource } from "./propertyBindingCompiler";
import { isScalarTypeAssignable } from "./scalarAssignability";
import type { ReconciledCadContainerInput } from "./containerIndex";
import type { SourceLexicalNamespaceIndex } from "../dsl/sourceLexicalNamespaceIndex";
import type { ModuleRuntimeContext } from "../dsl/moduleRuntimeContext";
import type { TransformationRecipe } from "../dsl/transformationRecipes";
import { effectiveElementActivityById } from "../model/elementActivity";
import type { RecordFieldIdentity } from "../dsl/recordSemanticAnalysis";
import {
  planRecordScalarLowering,
  recordScalarBindingIdFor,
  recordScalarDeclarationVersionIdFor,
  recordValueCollectionIdFor,
  recordFieldCollectionValueIdFor,
  recordFieldContentsCollectionValueIdFor
} from "./recordScalarLowering";
import { analyzeTypedDeclarations, type TypedDeclarationAnalysis } from "./typedDeclarationAnalysis";
import { dslRequiredValueTypeOf, isDslArrayValueType, isDslGeometryValueType, isDslOptionalValueType, isDslRecordValueType, scalarExpressionTypeOfDslValueType, scalarTypeOfDslValueType, type DslNonArrayValueType, type DslValueType } from "../dsl/dslValueTypes";
import { collectionLengthForValueId, geometryArrayDeferredModuleExportId, parseGeometryArrayDeferredModuleExportId } from "../dsl/geometryArraySemanticAnalysis";
import type { GenericArrayValueSemantic, GeometryArraySemanticAnalysis } from "../dsl/geometryArraySemanticAnalysis";
import { immutableCarryCollectionValueId } from "./immutableCarryIdentity";
import { scanScalarLiteral } from "./literalScanner";
import { geometryValueOccurrenceKey } from "../model/geometryValueOccurrence";
import { optionalMatchBinderId } from "./optionalMatchBinder";
import { parseDslSourceReference } from "../dsl/dslReferenceTokens";
import { resolveSourceLexicalPath } from "../dsl/sourceLexicalNamespaceIndex";

const optionalCollectionMatchBinderType = (
  scrutinee: TypedScalarExpression
): { kind: "scalar"; type: ScalarType } | { kind: "collection"; collectionValueId: string } | null => {
  if (scrutinee.kind === "reference" && scrutinee.optionalCollectionMatch) {
    return { kind: "collection", collectionValueId: scrutinee.optionalCollectionMatch.collectionValueId };
  }
  const type = scrutinee.type?.kind === "optional" ? scalarTypeOfDslValueType(scrutinee.type.valueType) : null;
  return type ? { kind: "scalar", type } : null;
};

const collectionMatchArm = (
  label: string,
  valueId: string,
  binderId: string | undefined,
  scrutinee: TypedScalarExpression,
  runtimeBinderId: (binderId: string) => string = (binderId) => binderId
) => {
  const binder = optionalCollectionMatchBinderType(scrutinee);
  return {
    label,
    valueId,
    ...(label === "some" && binderId && binder?.kind === "scalar"
      ? { binderId: runtimeBinderId(binderId), binderType: binder.type }
      : label === "some" && binderId && binder?.kind === "collection"
        ? { collectionBinderId: runtimeBinderId(binderId) }
        : {})
  };
};

export type MaterializedPropertyBindingSource = {
  elementId: ElementId;
  parameterKey: string;
  source: ScalarValueSource;
};

export type MaterializedNumericBindingSource = {
  elementId: ElementId;
  binding: CompiledNumericBinding;
};

export type MaterializedTextTemplateSource = {
  elementId: ElementId;
  template: TextTemplateAst;
};

export type MaterializedForGroupCollectionSource = {
  iterationSourceValueId: string;
  iterationSourceOrder: number;
  iterationElementValueType: DslNonArrayValueType;
  iterationElementType?: ScalarType;
};

export type ModuleScalarRuntimeCompilation = {
  bindingAnalysis: BindingAnalysis;
  scalarProgram: ScalarProgram;
  controlByScopeId: ReadonlyMap<string, BindingControlMetadata>;
  scalarExecutionPositionByRuntimeElementId: ReadonlyMap<ElementId, number>;
  scalarExecutionPositionByStatementIndex: ReadonlyMap<number, number>;
  materializedPropertyBindings: readonly MaterializedPropertyBindingSource[];
  materializedNumericBindings: readonly MaterializedNumericBindingSource[];
  materializedTransformationNumericBindings: readonly CompiledTransformationNumericBinding[];
  materializedTextTemplates: readonly MaterializedTextTemplateSource[];
  materializedForGroupCollectionSourcesByElementId: ReadonlyMap<ElementId, MaterializedForGroupCollectionSource>;
  materializedConditionalGroupConditions: readonly { elementId: ElementId; expression: TypedScalarExpression }[];
  conditionalOwnerStatementIdByElementId: ReadonlyMap<ElementId, string>;
  forGroupMutationOwnerByElementId: ReadonlyMap<ElementId, Extract<BindingControlOwner, { kind: "forGroup" }> & { elementId: ElementId }>;
  geometryValueProgram: GeometryValueProgram;
  geometryCarryNextPrograms: ReadonlyMap<string, GeometryValueProgramNode>;
  geometryInputTargetsByRuntimeElementId: ReadonlyMap<ElementId, ReadonlyMap<string, GeometryInputTarget | readonly GeometryInputTarget[]>>;
  geometryCollectionNodesByValueId: ReadonlyMap<string, GeometryInputCollectionNode>;
  immutableForGroups: ReadonlyMap<string, ImmutableForGroupPlan>;
};

type BindingInfo = {
  id: BindingId;
  declarationVersionId: string;
  name: string;
  type: import("./types").ScalarExpressionType;
  bindingKind: "const";
  scopeId: string;
  sourceScopeId: string;
  contextKey: string;
  statementId: string;
  statementIndex: number;
  eventOrder?: number;
};

type InstanceContext = {
  key: string;
  path: readonly string[];
  instance: ModuleInstanceSemantic;
  instanceDocumentId?: import("../document/multiDocumentPrimitives").DocumentId;
  definitionDocumentId?: import("../document/multiDocumentPrimitives").DocumentId;
  definition: ModuleDefinitionSemantic;
  parentKey: string | null;
  scopeId: string;
  bodyScopeId: string;
  parameters: ReadonlyMap<number, BindingInfo>;
  locals: ReadonlyMap<string, BindingInfo>;
  iterations: ReadonlyMap<string, BindingInfo>;
  carries: ReadonlyMap<BindingId, BindingInfo>;
  recordValues: ReadonlyMap<string, ReadonlyMap<number, { id: BindingId }>>;
  recordValueFieldBindingsByPath: ReadonlyMap<string, ReadonlyMap<string, { id: BindingId }>>;
  recordParameters: ReadonlyMap<number, ReadonlyMap<number, { id: BindingId }>>;
  recordParameterFieldBindingsByPath: ReadonlyMap<number, ReadonlyMap<string, { id: BindingId }>>;
};

const recordFieldPathKey = (path: readonly RecordFieldIdentity[]) => JSON.stringify(
  path.map((field) => [field.recordStatementId, field.fieldIndex])
);

const recordFieldCollectionIdentityFor = (encoded: unknown): {
  collectionValueId: string;
  fieldPath: readonly RecordFieldIdentity[];
} | null => {
  if (!Array.isArray(encoded) || typeof encoded[0] !== "string") return null;
  if (
    encoded.length === 3 &&
    typeof encoded[1] === "string" &&
    typeof encoded[2] === "number" &&
    Number.isInteger(encoded[2])
  ) {
    return {
      collectionValueId: encoded[0],
      fieldPath: [{ recordStatementId: encoded[1], fieldIndex: encoded[2] }]
    };
  }
  if (encoded.length !== 3 || encoded[1] !== "path" || !Array.isArray(encoded[2])) return null;
  const fieldPath = encoded[2].flatMap((entry): RecordFieldIdentity[] => {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "number" || !Number.isInteger(entry[1])) return [];
    return [{ recordStatementId: entry[0], fieldIndex: entry[1] }];
  });
  return fieldPath.length === encoded[2].length && fieldPath.length > 0
    ? { collectionValueId: encoded[0], fieldPath }
    : null;
};

/** Whole nominal records reuse the existing record-member collection runtime.
 * The JSON identity keeps the source path and statement identity unambiguous
 * while allowing semantic nodes to emit a root-form identity that this
 * compiler resolves for a concrete Module instance. */
const recordValueCollectionIdentityFor = (valueId: string): { path: string[]; statementId: string } | null => {
  if (!valueId.startsWith("record-value:")) return null;
  try {
    const encoded = JSON.parse(valueId.slice("record-value:".length)) as unknown;
    if (!Array.isArray(encoded) || !Array.isArray(encoded[0]) || !encoded[0].every((part) => typeof part === "string") || typeof encoded[1] !== "string") return null;
    return { path: encoded[0], statementId: encoded[1] };
  } catch {
    return null;
  }
};

type RuntimeEvent =
  | { kind: "binding"; bindingId: BindingId }
  | { kind: "element"; elementId: ElementId };

const scalarTypeOf = (type: ModuleDefinitionSemantic["parameters"][number]["type"]): ScalarType | null =>
  type && (type.kind === "number" || type.kind === "string" || type.kind === "boolean" || type.kind === "choice")
    ? type
    : null;

const pathKey = (path: readonly string[]) => encodeIdentityTuple(["instance", ...path]);
const moduleCollectionValueIdFor = (path: readonly string[], valueId: string) =>
  `module-collection:${encodeIdentityTuple([...path, valueId])}`;

const mappedRecordMemberValueIdFor = (collectionValueId: string, index: number): string =>
  recordValueCollectionIdFor([collectionValueId, String(index)], collectionValueId);
const indexedRecordSelectionValueIdFor = (collectionValueId: string, indexSpan: { start: number; end: number }): string =>
  recordValueCollectionIdFor([collectionValueId, `index:${indexSpan.start}:${indexSpan.end}`], collectionValueId);
const dynamicRecordFieldContentsCollectionValueIdFor = (
  collectionValueId: string,
  indexSpan: { start: number; end: number },
  fieldPath: readonly RecordFieldIdentity[]
) => recordFieldContentsCollectionValueIdFor(
  indexedRecordSelectionValueIdFor(collectionValueId, indexSpan),
  fieldPath
);
const indexedRecordFieldContentsCollectionValueIdFor = (
  collectionValueId: string,
  index: number,
  fieldPath: readonly RecordFieldIdentity[]
) => recordFieldContentsCollectionValueIdFor(
  mappedRecordMemberValueIdFor(collectionValueId, index),
  fieldPath
);
const moduleRecordParameterCollectionValueIdFor = (
  path: readonly string[],
  definitionStatementId: string,
  parameterIndex: number
) => `module-record-parameter:${encodeIdentityTuple([...path, definitionStatementId, String(parameterIndex)])}`;

type ForeignSourceScalars = {
  documentId: import("../document/multiDocumentPrimitives").DocumentId;
  analysis: TypedDeclarationAnalysis;
  program: ScalarProgram;
  bindingIdByLocalId: ReadonlyMap<BindingId, BindingId>;
  sourceNamespace: SourceLexicalNamespaceIndex;
};

const foreignDocumentBindingId = (documentId: string, bindingId: BindingId) =>
  `module-document-binding:${encodeIdentityTuple([documentId, bindingId])}`;

const remapTypedExpressionBindingIds = (
  expression: TypedScalarExpression,
  bindingIdByLocalId: ReadonlyMap<BindingId, BindingId>
): TypedScalarExpression => {
    switch (expression.kind) {
    case "reference":
      return { ...expression, bindingId: expression.bindingId ? bindingIdByLocalId.get(expression.bindingId) ?? null : null };
    case "geometryProperty":
      return {
        ...expression,
        ...(expression.forGroupOccurrenceIndex
          ? { forGroupOccurrenceIndex: remapTypedExpressionBindingIds(expression.forGroupOccurrenceIndex, bindingIdByLocalId) }
          : {})
      };
    case "optionalMember":
      return {
        ...expression,
        target: expression.target?.kind === "geometryProperty"
          ? {
              ...expression.target,
              receiver: expression.target.receiver.kind === "geometryValue"
                ? {
                    ...expression.target.receiver,
                    target: expression.target.receiver.target.kind === "forGroupOccurrence" && expression.target.receiver.target.index
                      ? { ...expression.target.receiver.target, index: remapTypedExpressionBindingIds(expression.target.receiver.target.index, bindingIdByLocalId) }
                      : expression.target.receiver.target
                  }
                : expression.target.receiver
            }
          : expression.target
      };
    case "unary": return { ...expression, operand: remapTypedExpressionBindingIds(expression.operand, bindingIdByLocalId) };
    case "binary": return {
      ...expression,
      left: remapTypedExpressionBindingIds(expression.left, bindingIdByLocalId),
      right: remapTypedExpressionBindingIds(expression.right, bindingIdByLocalId)
    };
    case "group": return { ...expression, expression: remapTypedExpressionBindingIds(expression.expression, bindingIdByLocalId) };
    case "valueIf": return {
      ...expression,
      condition: remapTypedExpressionBindingIds(expression.condition, bindingIdByLocalId),
      thenBranch: remapTypedExpressionBindingIds(expression.thenBranch, bindingIdByLocalId),
      elseBranch: remapTypedExpressionBindingIds(expression.elseBranch, bindingIdByLocalId)
    };
    case "valueMatch": return {
      ...expression,
      scrutinee: remapTypedExpressionBindingIds(expression.scrutinee, bindingIdByLocalId),
      arms: expression.arms.map((arm) => ({ ...arm, expression: remapTypedExpressionBindingIds(arm.expression, bindingIdByLocalId) }))
    };
    case "collectionIndex": return { ...expression, index: remapTypedExpressionBindingIds(expression.index, bindingIdByLocalId) };
    case "call": return {
      ...expression,
      args: expression.args.map((argument) => argument.kind === "scalar"
        ? { ...argument, expression: remapTypedExpressionBindingIds(argument.expression, bindingIdByLocalId) }
        : argument)
    };
    default: return expression;
  }
};

const remapTypedExpressionCollectionValueIds = (
  expression: TypedScalarExpression,
  collectionValueIdFor: (valueId: string) => string
): TypedScalarExpression => {
  switch (expression.kind) {
    case "collectionIndex":
      return {
        ...expression,
        collectionValueId: expression.collectionValueId
          ? collectionValueIdFor(expression.collectionValueId)
          : expression.collectionValueId,
        index: remapTypedExpressionCollectionValueIds(expression.index, collectionValueIdFor)
      };
    case "geometryProperty":
      return {
        ...expression,
        ...(expression.collectionValueId
          ? { collectionValueId: collectionValueIdFor(expression.collectionValueId) }
          : {}),
        ...(expression.forGroupOccurrenceIndex
          ? { forGroupOccurrenceIndex: remapTypedExpressionCollectionValueIds(expression.forGroupOccurrenceIndex, collectionValueIdFor) }
          : {})
      };
    case "optionalMember":
      return {
        ...expression,
        target: expression.target?.kind === "recordField"
          ? { ...expression.target, collectionValueId: collectionValueIdFor(expression.target.collectionValueId) }
          : expression.target?.kind === "collectionLength"
            ? { ...expression.target, collectionValueId: collectionValueIdFor(expression.target.collectionValueId) }
            : expression.target?.kind === "geometryProperty"
              ? {
                  ...expression.target,
                  reference: expression.target.reference.kind === "collection"
                    ? { ...expression.target.reference, collectionValueId: collectionValueIdFor(expression.target.reference.collectionValueId) }
                    : expression.target.reference,
                  receiver: expression.target.receiver.kind === "collection"
                    ? { ...expression.target.receiver, collectionValueId: collectionValueIdFor(expression.target.receiver.collectionValueId) }
                    : expression.target.receiver
                }
              : expression.target
      };
    case "unary": return {
      ...expression,
      operand: remapTypedExpressionCollectionValueIds(expression.operand, collectionValueIdFor)
    };
    case "binary": return {
      ...expression,
      left: remapTypedExpressionCollectionValueIds(expression.left, collectionValueIdFor),
      right: remapTypedExpressionCollectionValueIds(expression.right, collectionValueIdFor)
    };
    case "group": return {
      ...expression,
      expression: remapTypedExpressionCollectionValueIds(expression.expression, collectionValueIdFor)
    };
    case "valueIf": return {
      ...expression,
      condition: remapTypedExpressionCollectionValueIds(expression.condition, collectionValueIdFor),
      thenBranch: remapTypedExpressionCollectionValueIds(expression.thenBranch, collectionValueIdFor),
      elseBranch: remapTypedExpressionCollectionValueIds(expression.elseBranch, collectionValueIdFor)
    };
    case "valueMatch": return {
      ...expression,
      scrutinee: remapTypedExpressionCollectionValueIds(expression.scrutinee, collectionValueIdFor),
      arms: expression.arms.map((arm) => ({
        ...arm,
        expression: remapTypedExpressionCollectionValueIds(arm.expression, collectionValueIdFor)
      }))
    };
    case "call": return {
      ...expression,
      args: expression.args.map((argument) => argument.kind === "scalar"
        ? { ...argument, expression: remapTypedExpressionCollectionValueIds(argument.expression, collectionValueIdFor) }
        : argument)
    };
    default: return expression;
  }
};

const collectionValueIdContainsImmutableCarry = (valueId: string): boolean => {
  if (valueId.startsWith("carry-collection:")) return true;
  const prefix = valueId.startsWith("record-field-collection:")
    ? "record-field-collection:"
    : valueId.startsWith("record-field-contents:")
      ? "record-field-contents:"
      : valueId.startsWith("record-value:")
        ? "record-value:"
        : null;
  if (!prefix) return false;
  try {
    const visit = (value: unknown): boolean => Array.isArray(value)
      ? value.some(visit)
      : typeof value === "string"
        ? collectionValueIdContainsImmutableCarry(value)
        : false;
    return visit(JSON.parse(valueId.slice(prefix.length)) as unknown);
  } catch {
    return false;
  }
};

const typedExpressionContainsImmutableCarryCollection = (expression: TypedScalarExpression): boolean => {
  if (expression.kind === "collectionIndex") {
    return (expression.collectionValueId ? collectionValueIdContainsImmutableCarry(expression.collectionValueId) : false) ||
      typedExpressionContainsImmutableCarryCollection(expression.index);
  }
  if (expression.kind === "binary") {
    return typedExpressionContainsImmutableCarryCollection(expression.left) ||
      typedExpressionContainsImmutableCarryCollection(expression.right);
  }
  if (expression.kind === "unary") return typedExpressionContainsImmutableCarryCollection(expression.operand);
  if (expression.kind === "group") return typedExpressionContainsImmutableCarryCollection(expression.expression);
  if (expression.kind === "valueIf") {
    return typedExpressionContainsImmutableCarryCollection(expression.condition) ||
      typedExpressionContainsImmutableCarryCollection(expression.thenBranch) ||
      (expression.elseBranch ? typedExpressionContainsImmutableCarryCollection(expression.elseBranch) : false);
  }
  if (expression.kind === "valueMatch") {
    return typedExpressionContainsImmutableCarryCollection(expression.scrutinee) ||
      expression.arms.some((arm) => typedExpressionContainsImmutableCarryCollection(arm.expression));
  }
  if (expression.kind === "call") {
    return expression.args.some((argument) => argument.kind === "scalar" && typedExpressionContainsImmutableCarryCollection(argument.expression));
  }
  return false;
};

const typedExpressionContainsImmutableCarryProperty = (
  expression: TypedScalarExpression,
  statementIndex: number,
  sourceNamespace: SourceLexicalNamespaceIndex | undefined
): boolean => {
  if (expression.kind === "geometryProperty") {
    return sourceNamespace?.allDeclarations.some((declaration) =>
      declaration.kind === "carry" && declaration.name === expression.elementName && declaration.statementIndex <= statementIndex
    ) === true;
  }
  if (expression.kind === "binary") {
    return typedExpressionContainsImmutableCarryProperty(expression.left, statementIndex, sourceNamespace) ||
      typedExpressionContainsImmutableCarryProperty(expression.right, statementIndex, sourceNamespace);
  }
  if (expression.kind === "unary") return typedExpressionContainsImmutableCarryProperty(expression.operand, statementIndex, sourceNamespace);
  if (expression.kind === "group") return typedExpressionContainsImmutableCarryProperty(expression.expression, statementIndex, sourceNamespace);
  if (expression.kind === "valueIf") {
    return typedExpressionContainsImmutableCarryProperty(expression.condition, statementIndex, sourceNamespace) ||
      typedExpressionContainsImmutableCarryProperty(expression.thenBranch, statementIndex, sourceNamespace) ||
      (expression.elseBranch ? typedExpressionContainsImmutableCarryProperty(expression.elseBranch, statementIndex, sourceNamespace) : false);
  }
  if (expression.kind === "valueMatch") {
    return typedExpressionContainsImmutableCarryProperty(expression.scrutinee, statementIndex, sourceNamespace) ||
      expression.arms.some((arm) => typedExpressionContainsImmutableCarryProperty(arm.expression, statementIndex, sourceNamespace));
  }
  if (expression.kind === "collectionIndex") return typedExpressionContainsImmutableCarryProperty(expression.index, statementIndex, sourceNamespace);
  if (expression.kind === "call") return expression.args.some((argument) => argument.kind === "scalar" && typedExpressionContainsImmutableCarryProperty(argument.expression, statementIndex, sourceNamespace));
  return false;
};

const typedExpressionContainsImmutableCarryBinding = (expression: TypedScalarExpression): boolean => {
  if (expression.kind === "reference") return expression.bindingId?.includes(":carry:") === true;
  if (expression.kind === "geometryProperty") return expression.geometryCarryBindingId?.includes(":carry:") === true;
  if (expression.kind === "collectionIndex") {
    return expression.collectionValueId?.startsWith("carry-collection:") === true ||
      typedExpressionContainsImmutableCarryBinding(expression.index);
  }
  if (expression.kind === "binary") return typedExpressionContainsImmutableCarryBinding(expression.left) || typedExpressionContainsImmutableCarryBinding(expression.right);
  if (expression.kind === "unary") return typedExpressionContainsImmutableCarryBinding(expression.operand);
  if (expression.kind === "group") return typedExpressionContainsImmutableCarryBinding(expression.expression);
  if (expression.kind === "valueIf") return typedExpressionContainsImmutableCarryBinding(expression.condition) || typedExpressionContainsImmutableCarryBinding(expression.thenBranch) || (expression.elseBranch ? typedExpressionContainsImmutableCarryBinding(expression.elseBranch) : false);
  if (expression.kind === "valueMatch") return typedExpressionContainsImmutableCarryBinding(expression.scrutinee) || expression.arms.some((arm) => typedExpressionContainsImmutableCarryBinding(arm.expression));
  if (expression.kind === "call") return expression.args.some((argument) => argument.kind === "scalar" && typedExpressionContainsImmutableCarryBinding(argument.expression));
  return false;
};

export const moduleScalarBindingIdFor = (
  path: readonly string[],
  definitionStatementId: string,
  localStatementId: string
) => `module-binding:${encodeIdentityTuple(["local", ...path, definitionStatementId, localStatementId])}`;

export const moduleCollectionBinderIdFor = (
  path: readonly string[],
  binderId: string
) => `module-collection-binder:${encodeIdentityTuple([...path, binderId])}`;

export const moduleRecordCollectionBinderFieldIdFor = (
  path: readonly string[],
  binderId: string,
  field: RecordFieldIdentity
) => moduleRecordCollectionBinderFieldIdForPath(path, binderId, [field]);

export const moduleRecordCollectionBinderFieldIdForPath = (
  path: readonly string[],
  binderId: string,
  fieldPath: readonly RecordFieldIdentity[]
) => `module-collection-binder-field:${encodeIdentityTuple([
  ...path,
  binderId,
  ...fieldPath.flatMap((field) => [field.recordStatementId, String(field.fieldIndex)])
])}`;

export const moduleScalarDeclarationVersionIdFor = (
  path: readonly string[],
  definitionStatementId: string,
  localStatementId: string
) => `module-declaration:${encodeIdentityTuple(["local", ...path, definitionStatementId, localStatementId])}`;

export const moduleRecordScalarBindingIdFor = (
  path: readonly string[],
  recordValueStatementId: string,
  field: RecordFieldIdentity
) => `module-record-binding:${encodeIdentityTuple(["value", ...path, recordValueStatementId, field.recordStatementId, String(field.fieldIndex)])}`;

export const moduleRecordScalarBindingIdForPath = (
  path: readonly string[],
  recordValueStatementId: string,
  fieldPath: readonly RecordFieldIdentity[]
) => fieldPath.length === 1
  ? moduleRecordScalarBindingIdFor(path, recordValueStatementId, fieldPath[0]!)
  : `module-record-binding:${encodeIdentityTuple(["value", ...path, recordValueStatementId, ...fieldPath.flatMap((field) => [field.recordStatementId, String(field.fieldIndex)])])}`;

export const moduleRecordScalarDeclarationVersionIdFor = (
  path: readonly string[],
  recordValueStatementId: string,
  field: RecordFieldIdentity
) => `module-record-declaration:${encodeIdentityTuple(["value", ...path, recordValueStatementId, field.recordStatementId, String(field.fieldIndex)])}`;

export const moduleRecordScalarDeclarationVersionIdForPath = (
  path: readonly string[],
  recordValueStatementId: string,
  fieldPath: readonly RecordFieldIdentity[]
) => fieldPath.length === 1
  ? moduleRecordScalarDeclarationVersionIdFor(path, recordValueStatementId, fieldPath[0]!)
  : `module-record-declaration:${encodeIdentityTuple(["value", ...path, recordValueStatementId, ...fieldPath.flatMap((field) => [field.recordStatementId, String(field.fieldIndex)])])}`;

export const moduleRecordParameterScalarBindingIdFor = (
  path: readonly string[],
  definitionStatementId: string,
  parameterIndex: number,
  field: RecordFieldIdentity
) => `module-record-binding:${encodeIdentityTuple(["parameter", ...path, definitionStatementId, String(parameterIndex), field.recordStatementId, String(field.fieldIndex)])}`;

export const moduleRecordParameterScalarBindingIdForPath = (
  path: readonly string[],
  definitionStatementId: string,
  parameterIndex: number,
  fieldPath: readonly RecordFieldIdentity[]
) => fieldPath.length === 1
  ? moduleRecordParameterScalarBindingIdFor(path, definitionStatementId, parameterIndex, fieldPath[0]!)
  : `module-record-binding:${encodeIdentityTuple(["parameter", ...path, definitionStatementId, String(parameterIndex), ...fieldPath.flatMap((field) => [field.recordStatementId, String(field.fieldIndex)])])}`;

export const moduleRecordParameterScalarDeclarationVersionIdFor = (
  path: readonly string[],
  definitionStatementId: string,
  parameterIndex: number,
  field: RecordFieldIdentity
) => `module-record-declaration:${encodeIdentityTuple(["parameter", ...path, definitionStatementId, String(parameterIndex), field.recordStatementId, String(field.fieldIndex)])}`;

export const moduleRecordParameterScalarDeclarationVersionIdForPath = (
  path: readonly string[],
  definitionStatementId: string,
  parameterIndex: number,
  fieldPath: readonly RecordFieldIdentity[]
) => fieldPath.length === 1
  ? moduleRecordParameterScalarDeclarationVersionIdFor(path, definitionStatementId, parameterIndex, fieldPath[0]!)
  : `module-record-declaration:${encodeIdentityTuple(["parameter", ...path, definitionStatementId, String(parameterIndex), ...fieldPath.flatMap((field) => [field.recordStatementId, String(field.fieldIndex)])])}`;

type SemanticRecordInstanceContext = {
  path: readonly string[];
  definition: ModuleDefinitionSemantic;
  instance: ModuleInstanceSemantic;
};

const recordFieldBindingIdForSemanticTarget = ({
  target,
  field,
  path,
  definition,
  instance,
  moduleSemanticAnalysis,
  sourceNamespace,
  rootRecordPlan,
  parentContext,
  visited = new Set<string>()
}: {
  target: ModuleRecordSourceTarget;
  field: RecordFieldIdentity;
  path: readonly string[];
  definition: ModuleDefinitionSemantic;
  instance: ModuleInstanceSemantic;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  sourceNamespace: SourceLexicalNamespaceIndex;
  rootRecordPlan: ReturnType<typeof planRecordScalarLowering> | undefined;
  parentContext?: SemanticRecordInstanceContext;
  visited?: Set<string>;
}): BindingId | undefined => {
  if (target.kind === "recordCollectionIndex") {
    const index = target.index.ast.kind === "numberLiteral" ? target.index.ast.value : null;
    if (index === null || !Number.isInteger(index) || index < 0) return undefined;
    const member = target.members?.[index];
    return member
      ? recordFieldBindingIdForSemanticTarget({
          target: member,
          field,
          path,
          definition,
          instance,
          moduleSemanticAnalysis,
          sourceNamespace,
          rootRecordPlan,
          parentContext,
          visited
        })
      : undefined;
  }
  if (target.kind === "recordValueForBinder") {
    return moduleRecordCollectionBinderFieldIdForPath(path, target.binderId, [field]);
  }
  const visitKey = `${target.kind}:${target.kind === "recordValue" ? target.statementId : target.kind === "recordParameter" ? `${target.definitionStatementId}:${target.parameterIndex}` : `${target.instanceStatementId}:${target.exportedStatementId}`}:${field.fieldIndex}`;
  if (visited.has(visitKey)) return undefined;
  visited.add(visitKey);
  if (target.kind === "recordValue") {
    const local = definition.recordValues.find((value) => value.value.statementId === target.statementId);
    if (local) {
      if (local.value.constructor || local.valueExpression) return moduleRecordScalarBindingIdFor(path, target.statementId, field);
      return local.target
        ? recordFieldBindingIdForSemanticTarget({ target: local.target, field, path, definition, instance, moduleSemanticAnalysis, sourceNamespace, rootRecordPlan, visited })
        : undefined;
    }
    const parentLocal = parentContext?.definition.recordValues.find((value) => value.value.statementId === target.statementId);
    if (parentLocal) {
      if (parentLocal.value.constructor || parentLocal.valueExpression) return moduleRecordScalarBindingIdFor(parentContext!.path, target.statementId, field);
      return parentLocal.target
        ? recordFieldBindingIdForSemanticTarget({
            target: parentLocal.target,
            field,
            path: parentContext!.path,
            definition: parentContext!.definition,
            instance: parentContext!.instance,
            moduleSemanticAnalysis,
            sourceNamespace,
            rootRecordPlan,
            visited
          })
        : undefined;
    }
    const fallback = rootRecordPlan?.fieldBindingIdsByValueStatementId.get(target.statementId)?.get(field.fieldIndex)
      ?? (path.length > 0 ? moduleRecordScalarBindingIdFor(path, target.statementId, field) : recordScalarBindingIdFor(target.statementId, field));
    return fallback;
  }
  if (target.kind === "recordParameter") {
    const owner = definition.statementId === target.definitionStatementId
      ? { path, definition, instance }
      : parentContext?.definition.statementId === target.definitionStatementId
        ? parentContext
        : undefined;
    if (!owner) return undefined;
    const binding = owner.instance.parameterBindings.find((candidate) => candidate.parameterIndex === target.parameterIndex);
    if (binding?.value?.kind !== "record") return undefined;
    if (binding.value.reference.target) {
      return recordFieldBindingIdForSemanticTarget({
        target: binding.value.reference.target,
        field,
        path: owner.path,
        definition: owner.definition,
        instance: owner.instance,
        moduleSemanticAnalysis,
        sourceNamespace,
        rootRecordPlan,
        parentContext,
        visited
      });
    }
    return binding.value.reference.constructor
      ? moduleRecordParameterScalarBindingIdFor(owner.path, target.definitionStatementId, target.parameterIndex, field)
      : undefined;
  }
  const child = moduleSemanticAnalysis.instancesByStatementId.get(target.instanceStatementId);
  const childDefinition = child?.callee && moduleSemanticAnalysis.definitionsByStatementId.get(child.callee.definitionStatementId);
  const exported = childDefinition?.exports.find((candidate) =>
    candidate.kind === "record" && candidate.name === target.exportName && candidate.exportedStatementId === target.exportedStatementId
  );
  return child && childDefinition && exported?.kind === "record"
    ? recordFieldBindingIdForSemanticTarget({
        target: exported.backingTarget,
        field,
        path: child.callerModuleDefinitionStatementId === null
          ? [child.statementId]
          : [...path, child.statementId],
        definition: childDefinition,
        instance: child,
        moduleSemanticAnalysis,
        sourceNamespace,
        rootRecordPlan,
        ...(child.callerModuleDefinitionStatementId === null
          ? {}
          : { parentContext: { path, definition, instance } }),
        visited
      })
    : undefined;
};

export const moduleRecordExportFieldBindingIdFor = ({
  moduleSemanticAnalysis,
  sourceNamespace,
  instanceStatementId,
  instanceIdentity,
  exportName,
  exportedStatementId,
  field,
  moduleRuntimeContext
}: {
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  sourceNamespace: SourceLexicalNamespaceIndex;
  instanceStatementId: StatementIdentity;
  instanceIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  exportName: string;
  exportedStatementId: StatementIdentity;
  field: RecordFieldIdentity;
  moduleRuntimeContext?: ModuleRuntimeContext;
}): BindingId | undefined => {
  const instance = moduleRuntimeContext?.instanceFor(instanceIdentity)
    ?? moduleSemanticAnalysis.instancesByStatementId.get(instanceStatementId);
  const definition = instance?.callee
    ? moduleRuntimeContext?.definitionFor(instance.callee.definitionIdentity)
      ?? moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId)
    : undefined;
  const exported = definition?.exports.find((candidate) =>
    candidate.kind === "record" && candidate.name === exportName && candidate.exportedStatementId === exportedStatementId
  );
  if (!instance || !definition || exported?.kind !== "record") return undefined;
  const definitionSourceNamespace = moduleRuntimeContext?.documentFor(
    definition.documentId ?? instance.callee?.definitionIdentity?.documentId
  )?.sourceLexicalNamespace ?? sourceNamespace;
  const definitionAnalysis = moduleRuntimeContext?.analysisFor(
    definition.documentId ?? instance.callee?.definitionIdentity?.documentId
  ) ?? moduleSemanticAnalysis;
  const instancePath = moduleRuntimeContext
    ? moduleRuntimeContext.runtimePathForInstance([], instance)
    : [instance.statementId];
  const rootRecordPlan = definitionSourceNamespace.recordSemanticAnalysis
    ? planRecordScalarLowering({ analysis: definitionSourceNamespace.recordSemanticAnalysis, sourceNamespace: definitionSourceNamespace })
    : undefined;
  return recordFieldBindingIdForSemanticTarget({
    target: exported.backingTarget,
    field,
    path: instancePath,
    definition,
    instance,
    moduleSemanticAnalysis: definitionAnalysis,
    sourceNamespace: definitionSourceNamespace,
    rootRecordPlan
  });
};

export const moduleScalarExportBindingSeeds = (
  moduleSemanticAnalysis: ModuleSemanticAnalysis,
  sourceNamespace: SourceLexicalNamespaceIndex,
  moduleRuntimeContext?: ModuleRuntimeContext
): readonly BindingSeed[] => {
  const seenBindingIds = new Set<BindingId>();
  return moduleSemanticAnalysis.instances
    .filter((instance) => instance.callerModuleDefinitionStatementId === null && instance.callee)
    .flatMap((instance) => {
    const definition = moduleRuntimeContext?.definitionFor(instance.callee!.definitionIdentity)
      ?? moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee!.definitionStatementId);
    if (!definition) return [];
    const effectiveScopeId = sourceNamespace.scopeIndex.scopeOfStatement.get(instance.statementIndex) ?? sourceNamespace.scopeIndex.rootScopeId;
    const definitionSourceNamespace = moduleRuntimeContext?.documentFor(
      definition.documentId ?? instance.callee!.definitionIdentity?.documentId
    )?.sourceLexicalNamespace ?? sourceNamespace;
    const definitionAnalysis = moduleRuntimeContext?.analysisFor(
      definition.documentId ?? instance.callee!.definitionIdentity?.documentId
    ) ?? moduleSemanticAnalysis;
    const instancePath = moduleRuntimeContext
      ? moduleRuntimeContext.runtimePathForInstance([], instance)
      : [instance.statementId];
    const rootRecordPlan = definitionSourceNamespace.recordSemanticAnalysis
      ? planRecordScalarLowering({ analysis: definitionSourceNamespace.recordSemanticAnalysis, sourceNamespace: definitionSourceNamespace })
      : undefined;
    return definition.exports.flatMap((exported) => exported.kind === "scalar"
      ? [{
          id: moduleScalarBindingIdFor(instancePath, definition.statementId, exported.exportedStatementId),
          kind: "typed" as const,
          name: `${instance.name}::${exported.name}`,
          nameSpan: null,
          statementIndex: instance.statementIndex,
          sourceOrder: 0,
          effectiveScopeId,
          visibility: { kind: "typed" as const, scopeId: effectiveScopeId },
          mutability: exported.bindingKind,
          declaredType: exported.declaredType,
          declarationVersionId: moduleScalarDeclarationVersionIdFor(instancePath, definition.statementId, exported.exportedStatementId),
          resolutionMode: "preResolvedOnly" as const
        }]
      : exported.kind === "record"
        ? exported.definition.fields.flatMap((field) => {
            const declaredType = scalarTypeOfDslValueType(field.type);
            if (!declaredType) return [];
            const id = recordFieldBindingIdForSemanticTarget({
              target: exported.backingTarget,
              field: field.identity,
              path: instancePath,
              definition,
              instance,
              moduleSemanticAnalysis: definitionAnalysis,
              sourceNamespace: definitionSourceNamespace,
              rootRecordPlan
            });
            if (!id) return [];
            return [{
              id,
              kind: "typed" as const,
              name: `${instance.name}::${exported.name}.${field.name}`,
              nameSpan: null,
              statementIndex: instance.statementIndex,
              sourceOrder: field.fieldIndex,
              effectiveScopeId,
              visibility: { kind: "typed" as const, scopeId: effectiveScopeId },
              mutability: "const" as const,
              declaredType,
              declarationVersionId: id.startsWith("record-field-binding:")
                ? recordScalarDeclarationVersionIdFor(exported.exportedStatementId, field.identity)
                : moduleRecordScalarDeclarationVersionIdFor(instancePath, exported.exportedStatementId, field.identity),
              resolutionMode: "preResolvedOnly" as const
            }];
          })
      : []);
    })
    .filter((seed) => {
      if (seenBindingIds.has(seed.id)) return false;
      seenBindingIds.add(seed.id);
      return true;
    });
};

const bindingIdFor = (kind: "parameter" | "local", context: InstanceContext, discriminator: string) =>
  kind === "local"
    ? moduleScalarBindingIdFor(context.path, context.definition.statementId, discriminator)
    : `module-binding:${encodeIdentityTuple([kind, ...context.path, context.definition.statementId, discriminator])}`;

const declarationVersionIdFor = (kind: "parameter" | "local", context: InstanceContext, discriminator: string) =>
  kind === "local"
    ? moduleScalarDeclarationVersionIdFor(context.path, context.definition.statementId, discriminator)
    : `module-declaration:${encodeIdentityTuple([kind, ...context.path, context.definition.statementId, discriminator])}`;

const moduleScopeIdFor = (path: readonly string[], sourceScopeId: string) =>
  `module-instance-scope:${encodeIdentityTuple([...path, sourceScopeId])}`;

const moduleIterationIdFor = (path: readonly string[], sourceOwnerId: string) =>
  `module-iteration:${encodeIdentityTuple([...path, sourceOwnerId])}`;

const remapDocumentReference = (reference: InitializerReference, bindingsById: ReadonlyMap<BindingId, Binding>): InitializerReference => {
  if (reference.resolution.kind !== "resolved") return reference;
  const binding = bindingsById.get(reference.resolution.binding.id);
  if (!binding) throw new Error(`moduleScalarRuntime: document binding ${reference.resolution.binding.id} disappeared`);
  return { ...reference, resolution: { kind: "resolved", binding } };
};

const bindingResolutionFor = (binding: Binding | undefined, name: string, statementIndex: number): BindingResolution =>
  binding
    ? { kind: "resolved", binding }
    : { kind: "undefined", name, scopeId: "module-runtime", statementIndex };

const semanticReferencesUsedByAst = (semantic: ModuleScalarExpressionSemantic, ast = semantic.ast) => {
  const astReferences = collectScalarExpressionReferences(ast);
  const collectionBaseStarts = new Set<number>();
  const collectCollectionBases = (node: ModuleScalarExpressionSemantic["ast"]): void => {
    if (node.kind === "collectionIndex") {
      collectionBaseStarts.add(node.span.start);
      collectCollectionBases(node.index);
    } else if (node.kind === "recordFieldCollectionIndex") {
      collectionBaseStarts.add(node.span.start);
      if (node.receiver.occurrenceIndex) collectCollectionBases(node.receiver.occurrenceIndex);
      collectCollectionBases(node.index);
    } else if (node.kind === "unary") collectCollectionBases(node.operand);
    else if (node.kind === "binary") { collectCollectionBases(node.left); collectCollectionBases(node.right); }
    else if (node.kind === "group") collectCollectionBases(node.expression);
    else if (node.kind === "valueIf") {
      collectCollectionBases(node.condition);
      collectCollectionBases(node.thenBranch);
      if (node.elseBranch) collectCollectionBases(node.elseBranch);
    }
    else if (node.kind === "valueMatch") {
      collectCollectionBases(node.scrutinee);
      node.arms.forEach((arm) => collectCollectionBases(arm.expression));
    }
    else if (node.kind === "call") node.args.forEach((argument) => collectCollectionBases(argument.expression));
  };
  collectCollectionBases(ast);
  return semantic.references.filter((reference) =>
    (!collectionBaseStarts.has(reference.span.start) &&
      astReferences.some((astReference) => astReference.span.start === reference.span.start))
  );
};

const lowerRecordPropertyAst = (
  ast: ModuleScalarExpressionSemantic["ast"],
  semantic: ModuleScalarExpressionSemantic
): ModuleScalarExpressionSemantic["ast"] => {
  const recordPropertyAt = (spanStart: number) => semantic.geometryProperties.find((property) =>
    property.span.start === spanStart && property.target?.kind === "recordField" && !property.target.property
  );
  const visit = (node: ModuleScalarExpressionSemantic["ast"]): ModuleScalarExpressionSemantic["ast"] => {
    switch (node.kind) {
      case "geometryProperty": {
        const property = recordPropertyAt(node.span.start);
        if (!property) return node;
        const target = property.target;
        // Whole-record field reads use the existing scalar collection-index
        // transport. This lets a non-optional record produced by `??` expose
        // its scalar fields without widening ScalarExpressionType with a
        // second non-scalar optional model.
        if (
          target?.kind === "recordField" &&
          target.record.kind === "recordValue" &&
          target.record.valueExpressionKind === "coalesce" &&
          target.collectionIndex === undefined
        ) {
          return {
            kind: "collectionIndex",
            span: node.span,
            nameSpan: { start: node.elementNameSpan.start, end: node.propertySpan.end },
            name: node.elementName,
            index: { kind: "numberLiteral", span: node.span, value: 0 }
          };
        }
        if (target?.kind === "recordField" && target.record.kind === "recordCollectionIndex" && !target.record.members && node.occurrenceIndex) {
          return {
            kind: "collectionIndex",
            span: node.span,
            nameSpan: { start: node.elementNameSpan.start, end: node.propertySpan.end },
            name: node.elementName,
            index: node.occurrenceIndex
          };
        }
        if (
          target?.kind === "recordField" &&
          target.collectionIndex !== undefined &&
          (target.record.kind === "recordValue" ||
            target.record.kind === "recordParameter" ||
            target.record.kind === "deferredModuleRecordExport")
        ) {
          const indexedProperty = /^(.*)\[(\d+)\]$/.exec(node.property);
          if (indexedProperty) {
            const fieldPathName = indexedProperty[1]!;
            const indexSpan = {
              start: node.propertySpan.start + fieldPathName.length + 1,
              end: node.propertySpan.end - 1
            };
            return {
              kind: "collectionIndex",
              span: node.span,
              nameSpan: { start: node.elementNameSpan.start, end: indexSpan.start - 1 },
              name: `${node.elementName}.${fieldPathName}`,
              index: { kind: "numberLiteral", span: indexSpan, value: target.collectionIndex }
            };
          }
        }
        return {
          kind: "reference",
          span: node.span,
          nameSpan: { start: node.elementNameSpan.start, end: node.propertySpan.end },
          name: `${node.elementName}.${node.property}`
        };
      }
      case "collectionIndex": return { ...node, index: visit(node.index) };
      case "recordFieldCollectionIndex": return {
        ...node,
        receiver: {
          ...node.receiver,
          ...(node.receiver.occurrenceIndex
            ? { occurrenceIndex: visit(node.receiver.occurrenceIndex) }
            : {})
        },
        index: visit(node.index)
      };
      case "unary": return { ...node, operand: visit(node.operand) };
      case "binary": return { ...node, left: visit(node.left), right: visit(node.right) };
      case "group": return { ...node, expression: visit(node.expression) };
      case "valueIf": return {
        ...node,
        condition: visit(node.condition),
        thenBranch: visit(node.thenBranch),
        elseBranch: node.elseBranch ? visit(node.elseBranch) : null
      };
      case "valueMatch": return {
        ...node,
        scrutinee: visit(node.scrutinee),
        arms: node.arms.map((arm) => ({ ...arm, expression: visit(arm.expression) }))
      };
      case "call": return { ...node, args: node.args.map((argument) => ({ ...argument, expression: visit(argument.expression) })) };
      default: return node;
    }
  };
  return visit(ast);
};

const typecheckGeometryTargetFor = (
  occurrence: ModuleGeometryBuiltinArgumentSemantic
): ScalarExpressionResolvedGeometryTarget | null => {
  if (!occurrence.reference.target || (occurrence.reference.resolution !== "resolved" && occurrence.reference.resolution !== "deferred")) return null;
  const unwrapped = unwrapModuleGeometrySourceTarget(occurrence.reference.target);
  const target = unwrapped.target;
  const pointKey = unwrapped.pointKey;
  if (target.kind === "geometryCarry") {
    return {
      kind: "geometryCarry",
      bindingId: target.bindingId,
      statementId: target.statementId,
      statementIndex: target.statementIndex,
      geometryType: occurrence.expectedGeometryType,
      ...(pointKey ? { pointKey } : {})
    };
  }
  if (target.kind === "parameter") {
    return {
      statementId: target.definitionStatementId,
      statementIndex: -1,
      geometryType: occurrence.expectedGeometryType,
      ...(pointKey ? { pointKey } : {})
    };
  }
  if (target.kind === "sourceGeometry") {
    return {
      statementId: target.statementId,
      statementIndex: target.statementIndex,
      geometryType: occurrence.expectedGeometryType,
      ...(pointKey ? { pointKey } : {})
    };
  }
  if (target.kind === "geometryValue") {
    return {
      kind: "geometryValue",
      occurrence: { sourceStatementId: target.statementId, instancePath: [] },
      statementId: target.statementId,
      statementIndex: target.statementIndex,
      geometryType: occurrence.expectedGeometryType,
      ...(pointKey ? { pointKey } : {})
    };
  }
  if (target.kind === "geometryValueForBinder") {
    return {
      kind: "geometryValueForBinder",
      binderId: target.binderId,
      statementId: target.statementId,
      statementIndex: -1,
      geometryType: target.sourceElementType,
      ...(pointKey ? { pointKey } : {})
    };
  }
  if (target.kind === "forGroupOccurrence") {
    return {
      kind: "forGroupOccurrence",
      templateElementId: target.statementId,
      statementId: target.statementId,
      statementIndex: target.statementIndex,
      targetSourceOrder: target.statementIndex,
      index: null,
      geometryType: occurrence.expectedGeometryType,
      ...(pointKey ? { pointKey } : {})
    };
  }
  if (target.kind === "recordFieldValue") {
    if (target.record.kind === "recordValue") {
      return {
        statementId: target.record.statementId,
        statementIndex: target.record.statementIndex,
        geometryType: isDslGeometryValueType(target.valueType)
          ? target.valueType.kind
          : occurrence.expectedGeometryType,
        ...(pointKey ? { pointKey } : {})
      };
    }
    if (target.record.kind === "recordParameter") {
      return {
        statementId: target.record.definitionStatementId,
        statementIndex: -1,
        geometryType: isDslGeometryValueType(target.valueType)
          ? target.valueType.kind
          : occurrence.expectedGeometryType,
        ...(pointKey ? { pointKey } : {})
      };
    }
    if (target.record.kind === "recordCollectionIndex") {
      return {
        statementId: target.record.collectionValueId,
        statementIndex: target.record.targetSourceOrder,
        geometryType: isDslGeometryValueType(target.valueType)
          ? target.valueType.kind
          : occurrence.expectedGeometryType,
        ...(pointKey ? { pointKey } : {})
      };
    }
    if (target.record.kind === "recordValueForBinder") {
      return {
        statementId: target.record.statementId,
        statementIndex: target.record.statementIndex,
        geometryType: isDslGeometryValueType(target.valueType)
          ? target.valueType.kind
          : occurrence.expectedGeometryType,
        ...(pointKey ? { pointKey } : {})
      };
    }
    return {
      statementId: target.record.instanceStatementId,
      statementIndex: target.record.instanceStatementIndex,
      geometryType: isDslGeometryValueType(target.valueType)
        ? target.valueType.kind
        : occurrence.expectedGeometryType,
      ...(pointKey ? { pointKey } : {})
    };
  }
  if (target.kind === "collectionIndex") return null;
  if (target.kind === "constructionInput") {
    return {
      statementId: target.ownerStatementId,
      statementIndex: target.ownerStatementIndex,
      geometryType: target.interfaceType,
      ...(pointKey ? { pointKey } : {})
    };
  }
  return {
    statementId: target.instanceStatementId,
    statementIndex: target.instanceStatementIndex,
    geometryType: occurrence.expectedGeometryType,
    ...(pointKey ? { pointKey } : {})
  };
};

export const lowerExpression = (
  semantic: ModuleScalarExpressionSemantic,
  bindingForTarget: (target: ModuleScalarSourceTarget, name: string, statementIndex: number) => Binding | undefined,
  catalogBindings: ReadonlyMap<BindingId, Binding>,
  geometryPropertyForTarget?: (target: ModuleGeometryPropertySourceTarget) => ModuleGeometryPropertyRuntimeTarget | undefined,
  collectionLengthForTarget?: (target: Extract<ModuleGeometryPropertySourceTarget, { kind: "collectionValueLength" | "collectionParameterLength" | "deferredModuleCollectionExportLength" }>) => number | undefined,
  geometryBuiltinForTarget?: (occurrence: ModuleGeometryBuiltinArgumentSemantic) => ScalarExpressionResolvedGeometryTarget | undefined,
  collectionValueIdFor: (valueId: string) => string = (valueId: string) => valueId,
  collectionSourceOrderFor: (sourceOrder: number) => number = (sourceOrder: number) => sourceOrder,
  recordParameterCollectionForTarget?: (
    target: import("../dsl/moduleSemanticTypes").ModuleRecordFieldSourceTarget
  ) => { collectionValueId: string; targetSourceOrder: number } | undefined
): { expression: TypedScalarExpression; references: InitializerReference[] } => {
  const runtimeAst = lowerRecordPropertyAst(semantic.ast, semantic);
  const references = semanticReferencesUsedByAst(semantic, runtimeAst);
  const typecheckResolutions: (BindingResolution | ScalarExpressionResolvedReference)[] = [];
  // Collection-index base references are intentionally omitted from the
  // ordinary runtime dependency list, but their semantic metadata is still
  // needed to construct the typed collection-index node.
  const semanticReferenceFor = (spanStart: number) => semantic.references.find((reference) => reference.span.start === spanStart);
  const geometryBuiltinFor = (spanStart: number) => semantic.geometryBuiltinArguments.find((occurrence) => occurrence.span.start === spanStart);
  const geometryBuiltinArgumentTargets = new Map<number, ScalarExpressionResolvedGeometryTarget | null>(
    semantic.geometryBuiltinArguments.map((occurrence) => [occurrence.span.start, typecheckGeometryTargetFor(occurrence)])
  );
  const geometryPropertyReferences = new Map<number, ScalarExpressionResolvedGeometryProperty | null>();
  const recordCollectionTargetFor = (target: import("../dsl/moduleSemanticTypes").ModuleRecordFieldSourceTarget) => {
    const fieldPath = target.fieldPath ?? [target.field];
    if (target.record.kind === "recordValue") {
      return {
        collectionValueId: collectionValueIdFor(recordValueCollectionIdFor([], target.record.statementId)),
        collectionLength: 1,
        targetSourceOrder: collectionSourceOrderFor(target.record.statementIndex),
        fieldPath
      };
    }
    if (target.record.kind === "recordCollectionIndex") {
      return {
        collectionValueId: collectionValueIdFor(target.record.collectionValueId),
        collectionLength: target.record.collectionLength,
        targetSourceOrder: collectionSourceOrderFor(target.record.targetSourceOrder),
        fieldPath
      };
    }
    if (target.record.kind === "recordParameter") {
      const recordParameter = recordParameterCollectionForTarget?.(target);
      if (!recordParameter) return null;
      return {
        collectionValueId: recordParameter.collectionValueId,
        collectionLength: 1,
        targetSourceOrder: recordParameter.targetSourceOrder,
        fieldPath
      };
    }
    if (target.record.kind === "deferredModuleRecordExport") {
      const recordValue = recordParameterCollectionForTarget?.(target);
      if (!recordValue) return null;
      return {
        collectionValueId: recordValue.collectionValueId,
        collectionLength: 1,
        targetSourceOrder: recordValue.targetSourceOrder,
        fieldPath
      };
    }
    return null;
  };
  const recordFieldSourceOrderFor = (target: ModuleGeometryPropertySourceTarget) =>
    target.kind === "recordField" ? recordCollectionTargetFor(target)?.targetSourceOrder : undefined;
  const geometryPropertyReferenceForRuntimeTarget = (
    target: ModuleGeometryPropertySourceTarget,
    runtimeTarget: ModuleGeometryPropertyRuntimeTarget,
    type: ScalarExpressionType
  ): ScalarExpressionResolvedGeometryProperty | null => {
    if (runtimeTarget.kind === "expression") return null;
    if (runtimeTarget.kind === "carry") {
      return {
        kind: "geometryCarry",
        bindingId: runtimeTarget.bindingId,
        property: runtimeTarget.property,
        ...(runtimeTarget.pointKey ? { pointKey: runtimeTarget.pointKey } : {}),
        targetSourceOrder: runtimeTarget.targetSourceOrder ?? -1,
        type
      };
    }
    if (runtimeTarget.kind === "forGroupOccurrence") {
      return {
        kind: "forGroupOccurrence",
        templateElementId: runtimeTarget.templateElementId,
        property: runtimeTarget.property,
        targetSourceOrder: runtimeTarget.targetSourceOrder,
        index: null,
        ...(runtimeTarget.pointKey ? { pointKey: runtimeTarget.pointKey } : {}),
        ...(runtimeTarget.stagePath ? { stagePath: runtimeTarget.stagePath } : {}),
        type
      };
    }
    if (runtimeTarget.kind === "value") {
      const runtimeSourceOrder = runtimeTarget.targetSourceOrder !== undefined && runtimeTarget.targetSourceOrder >= 0
        ? runtimeTarget.targetSourceOrder
        : undefined;
      return {
        kind: "geometryValue",
        occurrence: runtimeTarget.occurrence,
        property: runtimeTarget.property,
        ...(runtimeTarget.pointKey ? { pointKey: runtimeTarget.pointKey } : {}),
        ...(runtimeTarget.stagePath ? { stagePath: runtimeTarget.stagePath } : {}),
        targetSourceOrder: runtimeSourceOrder ?? (
          target.kind === "recordField"
            ? recordFieldSourceOrderFor(target)
            : target.kind === "sourceGeometryProperty" || target.kind === "geometryValueProperty"
              ? collectionSourceOrderFor(target.statementIndex)
              : -1
        ) ?? -1,
        type
      };
    }
    if (runtimeTarget.kind === "binder") {
      const runtimeSourceOrder = runtimeTarget.targetSourceOrder !== undefined && runtimeTarget.targetSourceOrder >= 0
        ? runtimeTarget.targetSourceOrder
        : undefined;
      return {
        kind: "geometryValueForBinder",
        binderId: runtimeTarget.binderId,
        property: runtimeTarget.property,
        ...(runtimeTarget.pointKey ? { pointKey: runtimeTarget.pointKey } : {}),
        ...(runtimeTarget.stagePath ? { stagePath: runtimeTarget.stagePath } : {}),
        targetSourceOrder: runtimeSourceOrder ?? (
          target.kind === "geometryValueForBinder" ? collectionSourceOrderFor(target.statementIndex) : -1
        ),
        type
      };
    }
    const runtimeSourceOrder = runtimeTarget.targetSourceOrder !== undefined && runtimeTarget.targetSourceOrder >= 0
      ? runtimeTarget.targetSourceOrder
      : undefined;
    return {
      elementId: runtimeTarget.elementId,
      property: runtimeTarget.property,
      targetSourceOrder: runtimeSourceOrder ?? (
        target.kind === "recordField"
          ? recordFieldSourceOrderFor(target)
          : target.kind === "sourceGeometryProperty"
            ? collectionSourceOrderFor(target.statementIndex)
            : target.kind === "deferredModuleExportProperty"
              ? collectionSourceOrderFor(target.instanceStatementIndex)
              : -1
      ) ?? -1,
      ...(runtimeTarget.stagePath ? { stagePath: runtimeTarget.stagePath } : {}),
      type
    };
  };
  const geometryTargetForRuntimeTarget = (
    runtimeTarget: ModuleGeometryPropertyRuntimeTarget,
    receiverType: import("../dsl/dslValueTypes").DslValueType | null
  ): ScalarExpressionResolvedGeometryTarget | null => {
    if (runtimeTarget.kind === "expression") return null;
    const unwrappedReceiverType = receiverType?.kind === "optional" ? receiverType.valueType : receiverType;
    const geometryType = isDslGeometryValueType(unwrappedReceiverType) ? unwrappedReceiverType.kind : "line";
    if (runtimeTarget.kind === "forGroupOccurrence") {
      return {
        kind: "forGroupOccurrence",
        templateElementId: runtimeTarget.templateElementId,
        statementId: runtimeTarget.templateElementId,
        statementIndex: runtimeTarget.targetSourceOrder,
        targetSourceOrder: runtimeTarget.targetSourceOrder,
        index: null,
        geometryType,
        ...(runtimeTarget.pointKey ? { pointKey: runtimeTarget.pointKey } : {}),
        ...(runtimeTarget.stagePath ? { stagePath: runtimeTarget.stagePath } : {})
      };
    }
    if (runtimeTarget.kind === "value") {
      return {
        kind: "geometryValue",
        occurrence: runtimeTarget.occurrence,
        statementId: runtimeTarget.occurrence.sourceStatementId,
        statementIndex: runtimeTarget.targetSourceOrder ?? -1,
        geometryType,
        ...(runtimeTarget.pointKey ? { pointKey: runtimeTarget.pointKey } : {}),
        ...(runtimeTarget.stagePath ? { stagePath: runtimeTarget.stagePath } : {})
      };
    }
    if (runtimeTarget.kind === "binder") {
      return {
        kind: "geometryValueForBinder",
        binderId: runtimeTarget.binderId,
        statementId: runtimeTarget.binderId,
        statementIndex: runtimeTarget.targetSourceOrder ?? -1,
        geometryType,
        ...(runtimeTarget.pointKey ? { pointKey: runtimeTarget.pointKey } : {}),
        ...(runtimeTarget.stagePath ? { stagePath: runtimeTarget.stagePath } : {})
      };
    }
    if (runtimeTarget.kind === "carry") {
      return {
        kind: "geometryCarry",
        bindingId: runtimeTarget.bindingId,
        statementId: runtimeTarget.bindingId,
        statementIndex: runtimeTarget.targetSourceOrder ?? -1,
        geometryType,
        ...(runtimeTarget.pointKey ? { pointKey: runtimeTarget.pointKey } : {})
      };
    }
    return {
      statementId: runtimeTarget.elementId,
      statementIndex: runtimeTarget.targetSourceOrder ?? -1,
      geometryType,
      ...(runtimeTarget.stagePath ? { stagePath: runtimeTarget.stagePath } : {}),
      ...(runtimeTarget.property ? {} : {})
    };
  };
  const optionalMemberReferences = new Map<number, import("./typedExpressionAst").ScalarExpressionResolvedOptionalMember | null>();
  for (const optionalMember of semantic.optionalMembers ?? []) {
    const memberType = optionalMember.memberType;
    const target = optionalMember.target;
    let optionalTarget: ScalarExpressionResolvedOptionalMemberTarget | null = null;
    if (memberType && target) {
      if (target.kind === "collectionValueLength" || target.kind === "collectionParameterLength" || target.kind === "deferredModuleCollectionExportLength") {
        optionalTarget = {
          kind: "collectionLength",
          collectionValueId: collectionValueIdFor(target.kind === "collectionValueLength"
            ? target.valueId
            : target.kind === "collectionParameterLength"
              ? `${target.definitionStatementId}:parameter:${target.parameterIndex}`
              : geometryArrayDeferredModuleExportId(target.instanceStatementId, target.exportName)),
          collectionLength: target.kind === "collectionValueLength" && target.length !== null
            ? target.length
            : collectionLengthForTarget?.(target) ?? null,
          targetSourceOrder: target.kind === "collectionValueLength"
            ? collectionSourceOrderFor(target.statementIndex)
            : target.kind === "deferredModuleCollectionExportLength"
              ? collectionSourceOrderFor(target.instanceStatementIndex)
              : -1
        };
      } else if (target.kind === "recordField" && !target.property && target.type) {
        const recordCollection = recordCollectionTargetFor(target);
        if (recordCollection) {
          const fieldPath = recordCollection.fieldPath;
          const field = fieldPath[fieldPath.length - 1]!;
          optionalTarget = {
            kind: "recordField",
            collectionValueId: collectionValueIdFor(recordFieldCollectionValueIdFor(recordCollection.collectionValueId, field, fieldPath)),
            collectionLength: recordCollection.collectionLength,
            targetSourceOrder: recordCollection.targetSourceOrder,
            field: {
              recordStatementId: field.recordStatementId,
              fieldIndex: field.fieldIndex,
              type: target.type,
              ...(fieldPath.length > 1 ? { fieldPath } : {})
            }
          };
        }
      } else {
        const runtimeTarget = geometryPropertyForTarget?.(target);
        const reference = runtimeTarget ? geometryPropertyReferenceForRuntimeTarget(target, runtimeTarget, memberType) : null;
        const collectionReceiver = target.kind === "recordField" && !target.property ? recordCollectionTargetFor(target) : null;
        const geometryReceiver = runtimeTarget
          ? geometryTargetForRuntimeTarget(runtimeTarget, optionalMember.receiverType)
          : null;
        if (reference && collectionReceiver) {
          optionalTarget = {
            kind: "geometryProperty",
            reference,
            receiver: { kind: "collection", ...collectionReceiver }
          };
        } else if (reference && geometryReceiver) {
          optionalTarget = {
            kind: "geometryProperty",
            reference,
            receiver: { kind: "geometryValue", target: geometryReceiver }
          };
        }
      }
    }
    optionalMemberReferences.set(optionalMember.span.start, {
      receiverType: optionalMember.receiverType,
      memberType,
      target: optionalTarget
    });
  }
  for (const property of semantic.geometryProperties) {
    if (property.target?.kind === "recordField" && !property.target.property) continue;
    if (!property.target || !property.type) {
      geometryPropertyReferences.set(property.span.start, null);
      continue;
    }
    if (property.target.kind === "collectionValueLength" || property.target.kind === "collectionParameterLength" || property.target.kind === "deferredModuleCollectionExportLength") {
      const length = property.target.kind === "collectionValueLength" && property.target.length !== null
        ? property.target.length
        : collectionLengthForTarget?.(property.target);
      geometryPropertyReferences.set(property.span.start, {
        kind: "collection",
        collectionValueId: collectionValueIdFor(property.target.kind === "collectionValueLength"
          ? property.target.valueId
          : property.target.kind === "collectionParameterLength"
            ? `${property.target.definitionStatementId}:parameter:${property.target.parameterIndex}`
            : geometryArrayDeferredModuleExportId(property.target.instanceStatementId, property.target.exportName)),
        collectionLength: length ?? null,
        targetSourceOrder: property.target.kind === "collectionValueLength"
          ? property.target.statementIndex
          : property.target.kind === "deferredModuleCollectionExportLength"
            ? property.target.instanceStatementIndex
            : -1,
        type: property.type.kind === "number" ? property.type : { kind: "number" }
      });
      continue;
    }
    if (property.target.kind === "geometryValueForBinder") {
      geometryPropertyReferences.set(property.span.start, {
        kind: "geometryValueForBinder",
        binderId: property.target.binderId,
        property: property.target.property,
        ...(property.target.pointKey ? { pointKey: property.target.pointKey } : {}),
        targetSourceOrder: -1,
        ...(property.target.stagePath ? { stagePath: property.target.stagePath } : {}),
        type: property.type
      });
      continue;
    }
    if (property.target.kind === "forGroupOccurrenceProperty") {
      geometryPropertyReferences.set(property.span.start, {
        kind: "forGroupOccurrence",
        templateElementId: property.target.statementId,
        property: property.target.property,
        targetSourceOrder: property.target.statementIndex,
        index: null,
        ...(property.target.pointKey ? { pointKey: property.target.pointKey } : {}),
        ...(property.target.stagePath ? { stagePath: property.target.stagePath } : {}),
        type: property.type
      });
      continue;
    }
    const runtimeTarget = geometryPropertyForTarget?.(property.target);
    if (runtimeTarget?.kind === "runtime") {
      geometryPropertyReferences.set(property.span.start, {
        elementId: runtimeTarget.elementId,
        property: runtimeTarget.property,
        targetSourceOrder: runtimeTarget.targetSourceOrder ?? (
          property.target.kind === "sourceGeometryProperty"
            ? property.target.statementIndex
            : property.target.kind === "deferredModuleExportProperty"
              ? property.target.instanceStatementIndex
              : -1
        ),
        ...(runtimeTarget.stagePath ? { stagePath: runtimeTarget.stagePath } : {}),
        type: property.type
      });
      continue;
    }
    if (runtimeTarget?.kind === "value") {
      geometryPropertyReferences.set(property.span.start, {
        kind: "geometryValue",
        occurrence: runtimeTarget.occurrence,
        property: runtimeTarget.property,
        ...(runtimeTarget.pointKey ? { pointKey: runtimeTarget.pointKey } : {}),
        ...(runtimeTarget.stagePath ? { stagePath: runtimeTarget.stagePath } : {}),
        targetSourceOrder: runtimeTarget.targetSourceOrder ?? (
          property.target.kind === "sourceGeometryProperty" || property.target.kind === "geometryValueProperty"
            ? property.target.statementIndex
            : -1
        ),
        type: property.type
      });
      continue;
    }
    if (property.target.kind === "recordField") {
      const recordCollection = recordCollectionTargetFor(property.target);
      const propertyName = property.target.property?.split(".").at(-1);
      if (recordCollection && propertyName === "length") {
        const fieldPath = recordCollection.fieldPath;
        let recordValueCollectionId: string | null = null;
        if (property.target.record.kind === "recordValue" || property.target.record.kind === "recordParameter") {
          recordValueCollectionId = recordCollection.collectionValueId;
        } else if (property.target.record.kind === "deferredModuleRecordExport") {
          recordValueCollectionId = recordCollection.collectionValueId;
        } else if (property.target.record.kind === "recordCollectionIndex") {
          const index = property.target.record.index.ast.kind === "numberLiteral"
            ? property.target.record.index.ast.value
            : null;
          const selectedRecord = index !== null && Number.isInteger(index) && index >= 0
            ? property.target.record.members?.[index]
            : undefined;
          if (selectedRecord) {
            recordValueCollectionId = collectionValueIdFor(
              recordValueCollectionIdFor([], selectedRecord.statementId)
            );
          } else if (index !== null && Number.isInteger(index) && index >= 0) {
            recordValueCollectionId = recordParameterCollectionForTarget?.(property.target)?.collectionValueId ?? null;
          }
        }
        if (recordValueCollectionId) {
          geometryPropertyReferences.set(property.span.start, {
            kind: "collection",
            collectionValueId: recordFieldContentsCollectionValueIdFor(recordValueCollectionId, fieldPath),
            collectionLength: null,
            targetSourceOrder: recordCollection.targetSourceOrder,
            type: { kind: "number" }
          });
        }
      }
      continue;
    }
  const elementId = property.target.kind === "sourceGeometryProperty"
    ? property.target.statementId
    : property.target.kind === "deferredModuleExportProperty"
      ? property.target.instanceStatementId
        : property.target.kind === "parameterProperty"
          ? property.target.definitionStatementId
          : property.target.statementId;
  const targetSourceOrder = property.target.kind === "sourceGeometryProperty"
    ? property.target.statementIndex
    : property.target.kind === "deferredModuleExportProperty"
      ? property.target.instanceStatementIndex
        : property.target.kind === "geometryValueProperty"
          ? property.target.statementIndex
          : -1;
    const targetStagePath = "stagePath" in property.target ? property.target.stagePath : undefined;
    geometryPropertyReferences.set(property.span.start, {
      elementId,
      property: property.target.property,
      targetSourceOrder,
      ...(targetStagePath ? { stagePath: targetStagePath } : {}),
      type: property.type
    });
  }
  const geometryBuiltinForCallArgument = (call: Extract<TypedScalarExpression, { kind: "call" }>, argumentIndex: number) =>
    semantic.geometryBuiltinArguments.find((occurrence) =>
      occurrence.builtinName === call.name &&
      occurrence.argumentIndex === argumentIndex &&
      occurrence.span.start >= call.span.start &&
      occurrence.span.end <= call.span.end
    );
  const collectTypecheckResolutions = (
    node: ModuleScalarExpressionSemantic["ast"],
    boundNames: ReadonlySet<string> = new Set()
  ): void => {
    switch (node.kind) {
      case "reference": {
        if (boundNames.has(node.name)) return;
        const reference = semanticReferenceFor(node.span.start);
        if (reference?.optionalCollectionMatch) {
          typecheckResolutions.push(reference.optionalCollectionMatch);
          return;
        }
        typecheckResolutions.push(bindingResolutionFor(
          reference?.target && ["parameter", "recordField", "moduleLocal", "documentBinding", "iteration", "valueForBinder", "deferredModuleScalarExport"].includes(reference.target.kind)
            ? bindingForTarget(reference.target as ModuleScalarSourceTarget, reference.name, reference.span.start)
            : undefined,
          reference?.name ?? node.name,
          reference?.span.start ?? node.span.start
        ));
        return;
      }
      case "collectionIndex": {
        if (boundNames.has(node.name)) {
          const reference = semanticReferenceFor(node.span.start);
          if (reference?.collectionValueId) {
            typecheckResolutions.push({
              kind: "resolvedCollectionIndex",
              collectionValueId: collectionValueIdFor(reference.collectionValueId),
              collectionLength: reference.collectionLength ?? null,
              targetSourceOrder: reference.targetSourceOrder ?? -1,
              type: reference.collectionElementType ?? null
            });
          }
          collectTypecheckResolutions(node.index, boundNames);
          return;
        }
        const reference = semanticReferenceFor(node.span.start);
        const geometryPropertyTarget = semantic.geometryProperties.find((property) =>
          property.span.start === node.span.start && property.target?.kind === "recordField"
        )?.target;
        const recordFieldTarget = reference?.target?.kind === "recordField"
          ? reference.target
          : geometryPropertyTarget?.kind === "recordField"
            ? geometryPropertyTarget
            : null;
        const recordValueTarget = recordFieldTarget?.record.kind === "recordValue"
          ? recordFieldTarget.record
          : null;
        const recordCollectionTarget = recordFieldTarget?.record.kind === "recordCollectionIndex" && !recordFieldTarget.record.members
          ? recordFieldTarget.record
          : null;
        const recordParameterTarget = recordFieldTarget?.record.kind === "recordParameter"
          ? recordCollectionTargetFor(recordFieldTarget)
          : null;
        const deferredRecordCollectionTarget = recordFieldTarget?.record.kind === "deferredModuleRecordExport"
          ? recordCollectionTargetFor(recordFieldTarget)
          : null;
        const recordFieldPath = recordCollectionTarget ? recordFieldTarget!.fieldPath ?? [recordFieldTarget!.field] : null;
        const recordValueFieldPath = recordValueTarget ? recordFieldTarget!.fieldPath ?? [recordFieldTarget!.field] : null;
        const recordFieldCollectionValueId = recordCollectionTarget && recordFieldPath
          ? `record-field-collection:${JSON.stringify(
              recordFieldPath.length === 1
                ? [recordCollectionTarget.collectionValueId, recordFieldPath[0]!.recordStatementId, recordFieldPath[0]!.fieldIndex]
                : [recordCollectionTarget.collectionValueId, "path", recordFieldPath.map((field) => [field.recordStatementId, field.fieldIndex])]
            )}`
          : null;
        const recordParameterFieldPath = recordParameterTarget?.fieldPath;
        const recordParameterFieldContentsCollectionValueId = recordParameterTarget && recordParameterFieldPath
          ? recordFieldContentsCollectionValueIdFor(recordParameterTarget.collectionValueId, recordParameterFieldPath)
          : null;
        const deferredRecordFieldContentsCollectionValueId =
          deferredRecordCollectionTarget &&
          recordFieldTarget?.collectionIndex !== undefined
            ? recordFieldContentsCollectionValueIdFor(
                deferredRecordCollectionTarget.collectionValueId,
                recordFieldTarget.fieldPath ?? [recordFieldTarget.field]
              )
            : null;
        const recordValueFieldCollectionValueId = recordValueTarget && recordValueFieldPath
          ? recordFieldCollectionValueIdFor(
              recordValueCollectionIdFor([], recordValueTarget.statementId),
              recordValueFieldPath[recordValueFieldPath.length - 1]!,
              recordValueFieldPath
            )
          : null;
        const recordValueFieldContentsCollectionValueId =
          recordValueTarget &&
          recordValueFieldPath &&
          recordFieldTarget?.collectionIndex !== undefined
            ? recordFieldContentsCollectionValueIdFor(
                collectionValueIdFor(recordValueCollectionIdFor([], recordValueTarget.statementId)),
                recordValueFieldPath
              )
            : null;
        typecheckResolutions.push({
          kind: "resolvedCollectionIndex",
          collectionValueId: collectionValueIdFor(
            recordFieldCollectionValueId ??
            recordValueFieldContentsCollectionValueId ??
            recordValueFieldCollectionValueId ??
            recordParameterFieldContentsCollectionValueId ??
            deferredRecordFieldContentsCollectionValueId ??
            reference?.collectionValueId ??
            ""
          ),
          collectionLength: recordCollectionTarget?.collectionLength ?? (
            recordValueTarget && recordFieldTarget?.collectionIndex === undefined
              ? 1
              : reference?.collectionLength ?? null
          ),
          targetSourceOrder: (() => {
            if (recordParameterTarget) return recordParameterTarget.targetSourceOrder;
            if (deferredRecordCollectionTarget) return deferredRecordCollectionTarget.targetSourceOrder;
            const sourceOrder = recordCollectionTarget?.targetSourceOrder ?? recordValueTarget?.statementIndex ??
              reference?.targetSourceOrder ?? -1;
            return sourceOrder >= 0 ? collectionSourceOrderFor(sourceOrder) : sourceOrder;
          })(),
          type: recordFieldTarget?.type ?? reference?.collectionElementType ?? null
        });
        collectTypecheckResolutions(node.index, boundNames);
        return;
      }
      case "recordFieldCollectionIndex": {
        const reference = semanticReferenceFor(node.span.start);
        const field = reference?.target?.kind === "recordField" ? reference.target : null;
        const fieldPath = field ? field.fieldPath ?? [field.field] : null;
        let fieldContentsValueId: string | null = null;
        if (field && fieldPath && field.record.kind === "recordCollectionIndex") {
          const occurrenceIndex = field.record.index.ast.kind === "numberLiteral" &&
            Number.isInteger(field.record.index.ast.value) &&
            field.record.index.ast.value >= 0
            ? field.record.index.ast.value
            : null;
          if (occurrenceIndex !== null) {
            const selectedRecord = field.record.members?.[occurrenceIndex];
            const recordValueId = selectedRecord
              ? collectionValueIdFor(recordValueCollectionIdFor([], selectedRecord.statementId))
              : mappedRecordMemberValueIdFor(
                  collectionValueIdFor(field.record.collectionValueId),
                  occurrenceIndex
                );
            fieldContentsValueId = recordFieldContentsCollectionValueIdFor(recordValueId, fieldPath);
          } else {
            const collectionId = collectionValueIdFor(field.record.collectionValueId);
            fieldContentsValueId = dynamicRecordFieldContentsCollectionValueIdFor(
              collectionId,
              field.record.index.ast.span,
              fieldPath
            );
          }
        }
        const resolved = reference?.resolution === "resolved" && reference.collectionElementType
          ? {
              kind: "resolvedCollectionIndex" as const,
              collectionValueId: fieldContentsValueId ?? "",
              collectionLength: null,
              targetSourceOrder: reference.targetSourceOrder !== null && reference.targetSourceOrder !== undefined && reference.targetSourceOrder >= 0
                ? collectionSourceOrderFor(reference.targetSourceOrder)
                : reference.targetSourceOrder ?? -1,
              type: reference.collectionElementType
            }
          : null;
        if (node.receiver.occurrenceIndex) collectTypecheckResolutions(node.receiver.occurrenceIndex, boundNames);
        if (resolved) typecheckResolutions.push(resolved);
        collectTypecheckResolutions(node.index, boundNames);
        return;
      }
      case "geometryProperty":
        if (node.occurrenceIndex) collectTypecheckResolutions(node.occurrenceIndex);
        return;
      case "call": {
        const definition = getBuiltinFunctionDefinition(node.name);
        const signature = definition?.signatures.find((candidate) =>
          candidate.callingStyle === "positional" &&
          candidate.parameters.length === node.args.length &&
          node.args.every((argument) => argument.kind === "positional")
        );
        node.args.forEach((argument, argumentIndex) => {
          const sourceArgument = argument.expression;
          const parameterType = signature?.parameters[argumentIndex]?.type;
          const occurrence = sourceArgument.kind === "reference" || sourceArgument.kind === "collectionIndex" || sourceArgument.kind === "geometryProperty"
            ? geometryBuiltinFor(sourceArgument.span.start)
            : undefined;
          if (parameterType && typeof parameterType === "string" && occurrence) {
            if (sourceArgument.kind === "reference" || sourceArgument.kind === "collectionIndex") {
              typecheckResolutions.push({ kind: "resolvedGeometry", target: typecheckGeometryTargetFor(occurrence) });
            }
            if (sourceArgument.kind === "collectionIndex") collectTypecheckResolutions(sourceArgument.index, boundNames);
            if (sourceArgument.kind === "geometryProperty" && sourceArgument.occurrenceIndex) collectTypecheckResolutions(sourceArgument.occurrenceIndex, boundNames);
          } else {
            collectTypecheckResolutions(sourceArgument, boundNames);
          }
        });
        return;
      }
      case "unary":
        collectTypecheckResolutions(node.operand, boundNames);
        return;
      case "binary":
        collectTypecheckResolutions(node.left, boundNames);
        collectTypecheckResolutions(node.right, boundNames);
        return;
      case "group":
        collectTypecheckResolutions(node.expression, boundNames);
        return;
      case "valueIf":
        collectTypecheckResolutions(node.condition, boundNames);
        collectTypecheckResolutions(node.thenBranch, boundNames);
        if (node.elseBranch) collectTypecheckResolutions(node.elseBranch, boundNames);
        return;
      case "valueMatch":
        collectTypecheckResolutions(node.scrutinee, boundNames);
        node.arms.forEach((arm) => collectTypecheckResolutions(
          arm.expression,
          arm.binder ? new Set([...boundNames, arm.binder]) : boundNames
        ));
        return;
      default:
        return;
    }
  };
  collectTypecheckResolutions(runtimeAst);
  const checked = typecheckScalarExpression(runtimeAst, {
    expectedType: semantic.type,
    references: typecheckResolutions,
    geometryBuiltinArguments: geometryBuiltinArgumentTargets,
    geometryPropertyReferences,
    optionalMemberReferences
  });
  const lowerGeometryProperties = (node: TypedScalarExpression): { node: TypedScalarExpression; references: InitializerReference[] } => {
    if (node.kind === "optionalMember") {
      const optionalMember = semantic.optionalMembers?.find((candidate) => candidate.span.start === node.span.start);
      const resolved = optionalMember ? optionalMemberReferences.get(optionalMember.span.start) : undefined;
      return {
        node: remapTypedExpressionCollectionValueIds(
          { ...node, target: resolved?.target ?? node.target },
          collectionValueIdFor
        ),
        references: []
      };
    }
    if (node.kind === "geometryProperty") {
      if (node.collectionValueId) {
        return { node: { ...node, collectionValueId: collectionValueIdFor(node.collectionValueId) }, references: [] };
      }
      const semanticProperty = semantic.geometryProperties.find((property) => property.span.start === node.span.start);
      const resolved = semanticProperty?.target && geometryPropertyForTarget?.(semanticProperty.target);
      if (!resolved) return { node, references: [] };
      if (resolved.kind === "expression") {
        const lowered = lowerExpression(resolved.expression, bindingForTarget, catalogBindings, geometryPropertyForTarget, collectionLengthForTarget, geometryBuiltinForTarget, collectionValueIdFor, collectionSourceOrderFor, recordParameterCollectionForTarget);
        return { node: lowered.expression, references: lowered.references };
      }
      const loweredOccurrenceIndex = resolved.kind === "forGroupOccurrence" && resolved.index
        ? lowerExpression(resolved.index, bindingForTarget, catalogBindings, geometryPropertyForTarget, collectionLengthForTarget, geometryBuiltinForTarget, collectionValueIdFor, collectionSourceOrderFor, recordParameterCollectionForTarget)
        : undefined;
      return {
        node: {
          ...node,
          elementId: resolved.kind === "runtime" ? resolved.elementId : null,
          ...(resolved.kind === "forGroupOccurrence" ? {
            forGroupOccurrenceTemplateElementId: resolved.templateElementId,
            forGroupOccurrenceIndex: loweredOccurrenceIndex?.expression ?? node.forGroupOccurrenceIndex ?? null,
            ...(resolved.pointKey ? { forGroupOccurrencePointKey: resolved.pointKey } : {})
          } : {}),
          ...(resolved.kind === "value" ? { geometryValueOccurrence: resolved.occurrence } : {}),
          ...(resolved.kind === "binder" ? { geometryValueBinderId: resolved.binderId } : {}),
          ...(resolved.kind === "carry" ? {
            geometryCarryBindingId: resolved.bindingId,
            ...(resolved.pointKey ? { geometryCarryPointKey: resolved.pointKey } : {})
          } : {}),
          ...(resolved.kind === "value" && resolved.pointKey ? { geometryValuePointKey: resolved.pointKey } : {}),
          property: resolved.property,
          targetSourceOrder: resolved.targetSourceOrder ?? null
        },
        references: loweredOccurrenceIndex?.references ?? []
      };
    }
    if (node.kind === "collectionIndex") {
      const index = lowerGeometryProperties(node.index);
      return {
        node: { ...node, collectionValueId: node.collectionValueId ? collectionValueIdFor(node.collectionValueId) : null, index: index.node },
        references: index.references
      };
    }
    if (node.kind === "unary") {
      const operand = lowerGeometryProperties(node.operand);
      return { node: { ...node, operand: operand.node }, references: operand.references };
    }
    if (node.kind === "binary") {
      const left = lowerGeometryProperties(node.left);
      const right = lowerGeometryProperties(node.right);
      return { node: { ...node, left: left.node, right: right.node }, references: [...left.references, ...right.references] };
    }
    if (node.kind === "group") {
      const expression = lowerGeometryProperties(node.expression);
      return { node: { ...node, expression: expression.node }, references: expression.references };
    }
    if (node.kind === "valueIf") {
      const condition = lowerGeometryProperties(node.condition);
      const thenBranch = lowerGeometryProperties(node.thenBranch);
      const elseBranch = lowerGeometryProperties(node.elseBranch);
      return {
        node: { ...node, condition: condition.node, thenBranch: thenBranch.node, elseBranch: elseBranch.node },
        references: [...condition.references, ...thenBranch.references, ...elseBranch.references]
      };
    }
    if (node.kind === "valueMatch") {
      const scrutinee = lowerGeometryProperties(node.scrutinee);
      const arms = node.arms.map((arm) => ({ arm, lowered: lowerGeometryProperties(arm.expression) }));
      return {
        node: {
          ...node,
          scrutinee: scrutinee.node,
          arms: arms.map(({ arm, lowered }) => ({ ...arm, expression: lowered.node }))
        },
        references: [scrutinee.references, ...arms.map(({ lowered }) => lowered.references)].flat()
      };
    }
    if (node.kind === "call") {
      const args = node.args.map((argument, argumentIndex) => {
        if (argument.kind === "geometryReference") {
          const occurrence = geometryBuiltinForCallArgument(node, argumentIndex);
          const loweredTarget = occurrence ? geometryBuiltinForTarget?.(occurrence) : undefined;
          return {
            node: { ...argument, target: loweredTarget ?? null },
            references: [] as InitializerReference[]
          };
        }
        const lowered = lowerGeometryProperties(argument.expression);
        return { node: { ...argument, expression: lowered.node }, references: lowered.references };
      });
      return {
        node: { ...node, args: args.map((argument) => argument.node) },
        references: args.flatMap((argument) => argument.references)
      };
    }
    return { node, references: [] };
  };
  const scalarDependencyReferences = references.filter((reference) => !reference.optionalCollectionMatch);
  const resolutions = scalarDependencyReferences.map((reference) => bindingResolutionFor(
    reference.target && ["parameter", "recordField", "moduleLocal", "documentBinding", "iteration", "valueForBinder", "deferredModuleScalarExport"].includes(reference.target.kind)
      ? bindingForTarget(reference.target as ModuleScalarSourceTarget, reference.name, reference.span.start)
      : undefined,
    reference.name,
    reference.span.start
  ));
  const initializerReferences: InitializerReference[] = scalarDependencyReferences.map((reference, index) => ({
    fromBindingId: "",
    occurrenceIndex: index,
    name: reference.name,
    span: reference.span,
    resolution: resolutions[index]
  }));
  const localValueForBinderIds = new Set(semantic.references.flatMap((reference) => {
    if (reference.target?.kind !== "valueForBinder") return [];
    const binding = bindingForTarget(reference.target, reference.name, reference.span.start);
    return binding ? [binding.id] : [];
  }));
  // The caller fills fromBindingId after the owning binding is known. Keep a
  // catalog touch here so a missing target fails at the same lowering boundary
  // rather than being rediscovered by a runtime name lookup.
  for (const resolution of resolutions) {
    if (resolution.kind === "resolved" &&
      !catalogBindings.has(resolution.binding.id) &&
      !localValueForBinderIds.has(resolution.binding.id)) {
      throw new Error(`moduleScalarRuntime: lowered reference ${resolution.binding.id} is not in the combined catalog`);
    }
  }
  const lowered = lowerGeometryProperties(checked.typed);
  return {
    expression: lowered.node,
    references: [...initializerReferences, ...lowered.references.map((reference, index) => ({
      ...reference,
      occurrenceIndex: initializerReferences.length + index
    }))]
  };
};

const elementForBody = (
  materialization: ModuleMaterialization,
  path: readonly string[],
  sourceStatementId: string
): { elementId: ElementId; statement: DslStatement } | undefined => {
  const entry = materialization.executionStatements.find((candidate) =>
    candidate.origin?.kind === "moduleBody" &&
    candidate.origin.sourceStatementId === sourceStatementId &&
    pathKey(candidate.runtimeInstancePath ?? candidate.instancePath) === pathKey(path)
  );
  return entry ? { elementId: entry.runtimeElementId, statement: entry.statement } : undefined;
};

const instanceElement = (
  materialization: ModuleMaterialization,
  path: readonly string[]
): ElementId | undefined => materialization.executionStatements.find((entry) =>
  entry.origin?.kind === "moduleInstance" && pathKey(entry.runtimeInstancePath ?? entry.instancePath) === pathKey(path)
)?.runtimeElementId;

const propertySourceFor = (
  element: CadElement,
  parameterKey: string,
  semantic: ModuleScalarExpressionSemantic,
  loweredExpression: TypedScalarExpression
): ScalarValueSource | undefined => {
  if (semantic.references.length === 0) return undefined;
  const parameter = findParameterDefinition(element, parameterKey);
  const expectedType = scalarTypeForParameterDefinition(parameter);
  const loweredType = loweredExpression.type && !isDslOptionalValueType(loweredExpression.type) ? loweredExpression.type : null;
  if (!expectedType || expectedType.kind === "number" || !loweredType ||
      !isScalarTypeAssignable(loweredType, expectedType)) return undefined;
  if (loweredExpression.kind === "reference" && loweredExpression.bindingId !== null && semantic.references.length === 1) {
    const reference = semantic.references[0];
    return {
      kind: "binding",
      bindingId: loweredExpression.bindingId,
      type: loweredType,
      span: reference.span,
      nameSpan: { start: reference.span.start + 1, end: reference.span.end },
      name: reference.name
    };
  }
  return { kind: "expression", expression: loweredExpression, type: loweredType, span: semantic.ast.span };
};

/**
 * Lowers Task 3 module scalar targets into the ordinary typed scalar
 * catalog/program/version graph. It deliberately receives semantic targets
 * && materialized identities; it never performs a second lexical lookup.
 */
export const compileModuleScalarRuntime = ({
  statements,
  stableStatementIdByIndex,
  moduleSemanticAnalysis,
  moduleMaterialization,
  documentBindingAnalysis,
  documentScalarProgram,
  geometryCarryNextValues = [],
  collectionCarryInputs = [],
  collectionCarryValues = [],
  collectionCarrySemanticValues = [],
  geometryCollectionCarryInputs = [],
  reconciledContainers,
  includeStatement,
  elements,
  sourceScopeIndex,
  sourceNamespace,
  moduleGeometryRuntime,
  moduleRuntimeContext,
  drawingModifiers,
  transformationRecipes
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  moduleMaterialization: ModuleMaterialization;
  documentBindingAnalysis?: BindingAnalysis;
  documentScalarProgram?: ScalarProgram;
  geometryCarryNextValues?: readonly import("../dsl/moduleSemanticTypes").ModuleGeometryValueSemantic[];
  collectionCarryInputs?: readonly (ImmutableCollectionCarry & {
    ownerStatementId: string;
    ownerStatementIndex: number;
    carryName: string;
  })[];
  collectionCarryValues?: readonly ScalarProgramCollection[];
  collectionCarrySemanticValues?: readonly GenericArrayValueSemantic[];
  geometryCollectionCarryInputs?: readonly (ImmutableGeometryCollectionCarry & {
    ownerStatementId: string;
    ownerStatementIndex: number;
    carryName: string;
  })[];
  reconciledContainers: ReconciledCadContainerInput;
  includeStatement?: (statement: DslStatement, statementIndex: number) => boolean;
  elements: readonly CadElement[];
  /** Complete source lexical index, including inert module bodies. */
  sourceScopeIndex?: LexicalScopeIndex;
  /** Complete source namespace, including record identities and root backing fields. */
  sourceNamespace?: SourceLexicalNamespaceIndex;
  /** Task 7 stable geometry target lowering; no runtime name lookup. */
  moduleGeometryRuntime?: ModuleGeometryRuntimeCompilation;
  /** Exact graph/semantic owner for imported module source execution. */
  moduleRuntimeContext?: ModuleRuntimeContext;
  drawingModifiers?: readonly DrawingModifierDefinition[];
  transformationRecipes?: readonly TransformationRecipe[];
}): ModuleScalarRuntimeCompilation => {
  const include = includeStatement ?? ((_statement, index) => isCompilableDslStatement(statements, index));
  const baseScopeIndex = documentBindingAnalysis?.catalog.scopeIndex ?? buildLexicalScopeIndexFromStatements(statements, stableStatementIdByIndex, include);
  const adapter = buildDslBindingAdapterSeeds({
    statements,
    scopeIndex: baseScopeIndex,
    stableStatementIdByIndex,
    reconciledContainers
  });
  const baseCatalog = documentBindingAnalysis?.catalog ?? buildBindingCatalog({
    scopeIndex: baseScopeIndex,
    stableStatementIdByIndex,
    iterationBindings: adapter.iterationBindings,
    containerIndex: adapter.containerIndex
  });
  const sourceOwnedBindingsByStatementIndex = new Map<number, Binding[]>();
  const sourceLaneOrdinalByBindingId = new Map<BindingId, number>();
  const sourceLaneOrdinalByStatementIndex = new Map<number, Map<Binding["kind"], number>>();
  for (const binding of baseCatalog.bindings) {
    if (binding.catalogOrder !== "append") {
      const laneOrdinals = sourceLaneOrdinalByStatementIndex.get(binding.statementIndex) ?? new Map<Binding["kind"], number>();
      const sourceOrder = laneOrdinals.get(binding.kind) ?? 0;
      if (binding.catalogOrder === "source") sourceLaneOrdinalByBindingId.set(binding.id, sourceOrder);
      laneOrdinals.set(binding.kind, sourceOrder + 1);
      sourceLaneOrdinalByStatementIndex.set(binding.statementIndex, laneOrdinals);
    }
    if (binding.kind === "typed" && binding.resolutionMode === "preResolvedOnly" && binding.catalogOrder === "source") {
      const bucket = sourceOwnedBindingsByStatementIndex.get(binding.statementIndex) ?? [];
      bucket.push(binding);
      sourceOwnedBindingsByStatementIndex.set(binding.statementIndex, bucket);
    }
  }

  const rootRecordPlan = sourceNamespace?.recordSemanticAnalysis && sourceNamespace
    ? planRecordScalarLowering({ analysis: sourceNamespace.recordSemanticAnalysis, sourceNamespace })
    : undefined;

  const contextsByKey = new Map<string, InstanceContext>();
  const allBindingInfos: BindingInfo[] = [];
  const foreignSourceScalars = new Map<import("../document/multiDocumentPrimitives").DocumentId, ForeignSourceScalars>();
  if (moduleRuntimeContext) {
    for (const document of moduleRuntimeContext.documentsById.values()) {
      if (document.documentId === moduleRuntimeContext.rootDocumentId) continue;
      const compilation = analyzeTypedDeclarations({
        statements: document.statements,
        stableStatementIdByIndex: document.statementIdByStatementIndex,
        reconciledContainers: { elementIdByStatementIndex: new Map(), elements: [] },
        spans: {
          sourceMap: moduleRuntimeContext.graph.nodes.get(document.documentId)!.artifact.parsed.sourceMap,
          logicalStatementByRangeFrom: moduleRuntimeContext.graph.nodes.get(document.documentId)!.artifact.parsed.logicalStatementByRangeFrom
        },
        includeStatement: (_statement, statementIndex) => isCompilableDslStatement(document.statements, statementIndex),
        sourceNamespace: document.sourceLexicalNamespace
      });
      if (!compilation.analysis) continue;
      const bindingIdByLocalId = new Map<BindingId, BindingId>();
      for (const binding of compilation.analysis.bindingAnalysis.catalog.bindings) {
        if (binding.kind !== "typed") continue;
        bindingIdByLocalId.set(binding.id, foreignDocumentBindingId(String(document.documentId), binding.id));
      }
      foreignSourceScalars.set(document.documentId, {
        documentId: document.documentId,
        analysis: compilation.analysis,
        program: lowerScalarProgram(compilation.analysis),
        bindingIdByLocalId,
        sourceNamespace: document.sourceLexicalNamespace
      });
    }
  }
  for (const foreign of foreignSourceScalars.values()) {
    for (const binding of foreign.analysis.bindingAnalysis.catalog.bindings) {
      const declaredType = scalarTypeOfDslValueType(binding.declaredType);
      if (binding.kind !== "typed" || declaredType === null || foreign.bindingIdByLocalId.get(binding.id) === undefined) continue;
      const id = foreign.bindingIdByLocalId.get(binding.id)!;
      const scopeId = baseScopeIndex.rootScopeId;
      allBindingInfos.push({
        id,
        declarationVersionId: `module-document-declaration:${encodeIdentityTuple([String(foreign.documentId), binding.id])}`,
        name: binding.name,
        type: declaredType,
        bindingKind: "const",
        scopeId,
        sourceScopeId: binding.effectiveScopeId,
        contextKey: scopeId,
        statementId: moduleRuntimeContext?.documentFor(foreign.documentId)?.statementIdByStatementIndex.get(binding.statementIndex) ?? binding.id,
        statementIndex: binding.statementIndex
      });
    }
  }
  const runtimeContextForSourceInstance = (
    current: InstanceContext | null,
    instanceStatementId: string,
    instanceDocumentId?: import("../document/multiDocumentPrimitives").DocumentId
  ): InstanceContext | undefined => {
    const target = moduleRuntimeContext?.instanceFor(instanceDocumentId ? {
      documentId: instanceDocumentId,
      localIdentity: instanceStatementId
    } : undefined) ?? moduleSemanticAnalysis.instancesByStatementId.get(instanceStatementId);
    if (!target) return undefined;
    if (target.callerModuleDefinitionStatementId === null) {
      const path = moduleRuntimeContext
        ? moduleRuntimeContext.runtimePathForInstance([], target)
        : [instanceStatementId];
      return contextsByKey.get(pathKey(path));
    }
    let owner: InstanceContext | undefined = current ?? undefined;
    while (owner) {
      if (owner.definition.statementId === target.callerModuleDefinitionStatementId &&
          (!target.identity || owner.definitionDocumentId === target.identity.documentId)) {
        const path = moduleRuntimeContext
          ? moduleRuntimeContext.runtimePathForInstance(owner.path, target)
          : [...owner.path, instanceStatementId];
        return contextsByKey.get(pathKey(path));
      }
      owner = owner.parentKey ? contextsByKey.get(owner.parentKey) : undefined;
    }
    return undefined;
  };
  const scalarFieldPathsFor = (
    recordDefinition: import("../dsl/recordSemanticAnalysis").RecordDefinitionSemantic,
    prefix: readonly RecordFieldIdentity[] = [],
    recordAnalysis = sourceNamespace?.recordSemanticAnalysis
  ): readonly { field: RecordFieldIdentity; path: readonly RecordFieldIdentity[]; type: import("./types").ScalarExpressionType }[] => recordDefinition.fields.flatMap((field) => {
    const path = [...prefix, field.identity];
    const scalar = scalarExpressionTypeOfDslValueType(field.type);
    if (scalar) return [{ field: field.identity, path, type: scalar }];
    const recordType = dslRequiredValueTypeOf(field.type);
    if (!isDslRecordValueType(recordType)) return [];
    const nested = recordAnalysis?.definitionsByStatementId.get(recordType.identity ?? "");
    return nested ? scalarFieldPathsFor(nested, path, recordAnalysis) : [];
  });
  const constructorFieldAtPath = (
    fields: readonly import("../dsl/moduleSemanticTypes").ModuleRecordConstructorFieldSemantic[],
    path: readonly RecordFieldIdentity[]
  ): import("../dsl/moduleSemanticTypes").ModuleRecordConstructorFieldSemantic | null => {
    let currentFields = fields;
    for (const [index, wanted] of path.entries()) {
      const current = currentFields.find((candidate) => candidate.field.fieldIndex === wanted.fieldIndex);
      if (!current) return null;
      if (index === path.length - 1) return current;
      if (current.valueExpression?.kind !== "record" || current.valueExpression.expression?.kind !== "constructor") return null;
      currentFields = current.valueExpression.expression.constructor.fields;
    }
    return null;
  };
  const recordFieldPathsFor = (
    recordDefinition: import("../dsl/recordSemanticAnalysis").RecordDefinitionSemantic,
    recordAnalysis: import("../dsl/recordSemanticAnalysis").RecordSemanticAnalysis | undefined,
    prefix: readonly RecordFieldIdentity[] = []
  ): readonly { field: import("../dsl/recordSemanticAnalysis").RecordFieldSemantic; path: readonly RecordFieldIdentity[]; valueType: DslValueType }[] => recordDefinition.fields.flatMap((field) => {
    const path = [...prefix, field.identity];
    if (!isDslRecordValueType(field.type)) return [{ field, path, valueType: field.type }];
    const nested = recordAnalysis?.definitionsByStatementId.get(field.type.identity ?? "");
    return nested ? recordFieldPathsFor(nested, recordAnalysis, path) : [];
  });
  const recordFieldValueExpressionAt = (
    expression: ModuleRecordValueExpressionSemantic,
    fieldPath: readonly RecordFieldIdentity[]
  ): ModuleRecordFieldValueExpressionSemantic | null => {
    if (expression.kind === "constructor") {
      const field = expression.constructor.fields.find((candidate) => candidate.field.fieldIndex === fieldPath[0]?.fieldIndex);
      if (!field?.valueExpression) return null;
      if (fieldPath.length === 1) return field.valueExpression;
      if (field.valueExpression.kind !== "record" || !field.valueExpression.expression) return null;
      return recordFieldValueExpressionAt(field.valueExpression.expression, fieldPath.slice(1));
    }
    if (expression.kind === "if") {
      const thenValue = expression.thenBranch ? recordFieldValueExpressionAt(expression.thenBranch, fieldPath) : null;
      const elseValue = expression.elseBranch ? recordFieldValueExpressionAt(expression.elseBranch, fieldPath) : null;
      return thenValue?.kind === "geometry" && thenValue.expression &&
        elseValue?.kind === "geometry" && elseValue.expression && expression.condition
        ? {
            kind: "geometry",
            expression: {
              kind: "if",
              span: expression.span,
              condition: expression.condition,
              thenBranch: thenValue.expression,
              elseBranch: elseValue.expression
            }
          }
        : null;
    }
    if (expression.kind === "match") {
      if (!expression.scrutinee) return null;
      const arms = expression.arms.map((arm) => {
        const value = arm.expression ? recordFieldValueExpressionAt(arm.expression, fieldPath) : null;
        return value?.kind === "geometry" && value.expression
          ? { label: arm.label, labelSpan: arm.labelSpan, expression: value.expression }
          : null;
      });
      return arms.every((arm) => arm !== null)
        ? {
            kind: "geometry",
            expression: {
              kind: "match",
              span: expression.span,
              scrutinee: expression.scrutinee,
              arms: arms as { label: string; labelSpan: import("../dsl/dslTypes").DslSpan; expression: import("../dsl/moduleSemanticTypes").ModuleGeometryValueExpressionSemantic }[]
            }
          }
        : null;
    }
    return null;
  };
  const contextCandidatesFor = (current: InstanceContext): InstanceContext[] => {
    const candidates: InstanceContext[] = [];
    let cursor: InstanceContext | undefined = current;
    while (cursor) {
      candidates.push(cursor);
      cursor = cursor.parentKey ? contextsByKey.get(cursor.parentKey) : undefined;
    }
    return candidates;
  };
  const recordFieldBindingIdForTarget = (
    target: ModuleRecordSourceTarget,
    field: RecordFieldIdentity,
    current: InstanceContext | null,
    fieldPath: readonly RecordFieldIdentity[] = [field]
  ): BindingId | undefined => {
    if (target.kind === "recordValueForBinder") {
      return moduleRecordCollectionBinderFieldIdForPath(current?.path ?? [], target.binderId, fieldPath);
    }
    if (target.kind === "recordValue") {
      if (current) {
        for (const candidate of contextCandidatesFor(current)) {
          const fields = candidate.recordValues.get(target.statementId);
          const bindingId = fieldPath.length === 1
            ? fields?.get(field.fieldIndex)?.id
            : candidate.recordValueFieldBindingsByPath.get(target.statementId)?.get(recordFieldPathKey(fieldPath))?.id;
          if (bindingId) return bindingId;
        }
      }
      return fieldPath.length === 1
        ? rootRecordPlan?.fieldBindingIdsByValueStatementId.get(target.statementId)?.get(field.fieldIndex)
          ?? recordScalarBindingIdFor(target.statementId, field)
        : rootRecordPlan?.fieldBindingIdsByAccessPathByValueStatementId.get(target.statementId)?.get(recordFieldPathKey(fieldPath));
    }
    if (target.kind === "recordParameter") {
      if (!current) return undefined;
      const owner = contextCandidatesFor(current).find((candidate) => candidate.definition.statementId === target.definitionStatementId);
      if (!owner) return undefined;
      return fieldPath.length === 1
        ? owner.recordParameters.get(target.parameterIndex)?.get(field.fieldIndex)?.id
        : owner.recordParameterFieldBindingsByPath.get(target.parameterIndex)?.get(recordFieldPathKey(fieldPath))?.id;
    }
    if (target.kind === "recordCollectionIndex") {
      const index = target.index.ast.kind === "numberLiteral" ? target.index.ast.value : null;
      if (index === null || !Number.isInteger(index) || index < 0) return undefined;
      const member = target.members?.[index];
      return member
        ? recordFieldBindingIdForTarget(member, field, current, fieldPath)
        : undefined;
    }
    const child = runtimeContextForSourceInstance(current, target.instanceStatementId, target.instanceIdentity?.documentId);
    const exported = child?.definition.exports.find((candidate) =>
      candidate.kind === "record" && candidate.name === target.exportName && candidate.exportedStatementId === target.exportedStatementId
    );
    return exported?.kind === "record"
      ? recordFieldBindingIdForTarget(
          exported.backingTarget,
          field,
          child ?? null,
          fieldPath
        )
      : undefined;
  };
  const registerInstance = (instance: ModuleInstanceSemantic, parentPath: readonly string[], parentKey: string | null): InstanceContext | undefined => {
    if (!instance.callee) return undefined;
    const path = moduleRuntimeContext
      ? moduleRuntimeContext.runtimePathForInstance(parentPath, instance)
      : [...parentPath, instance.statementId];
    const key = pathKey(path);
    const existing = contextsByKey.get(key);
    if (existing) return existing;
    const instanceDocumentId = instance.identity?.documentId ?? instance.documentId ?? moduleRuntimeContext?.rootDocumentId;
    const definition = moduleRuntimeContext
      ? moduleRuntimeContext.definitionFor(instance.callee.definitionIdentity) ?? moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId)
      : moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
    if (!definition) return undefined;
    const definitionDocumentId = definition.identity?.documentId ?? definition.documentId ?? instance.callee.definitionIdentity?.documentId ?? moduleRuntimeContext?.rootDocumentId;
    const bodyScopeId = definition.bodyScopeId;
    const scopeId = moduleScopeIdFor(path, bodyScopeId);
    const parameters = new Map<number, BindingInfo>();
    const locals = new Map<string, BindingInfo>();
    const iterations = new Map<string, BindingInfo>();
    const carries = new Map<BindingId, BindingInfo>();
    const recordValues = new Map<string, ReadonlyMap<number, { id: BindingId }>>();
    const recordValueFieldBindingsByPath = new Map<string, ReadonlyMap<string, { id: BindingId }>>();
    const recordParameters = new Map<number, ReadonlyMap<number, { id: BindingId }>>();
    const recordParameterFieldBindingsByPath = new Map<number, ReadonlyMap<string, { id: BindingId }>>();
    const context = { key, path, instance, instanceDocumentId, definitionDocumentId, definition, parentKey, scopeId, bodyScopeId, parameters, locals, iterations, carries, recordValues, recordValueFieldBindingsByPath, recordParameters, recordParameterFieldBindingsByPath } as InstanceContext;
    contextsByKey.set(key, context);
    const definitionDocument = moduleRuntimeContext?.documentFor(definitionDocumentId);
    const definitionStatements = definitionDocument?.statements ?? statements;
    const definitionSourceNamespace = definitionDocument?.sourceLexicalNamespace ?? sourceNamespace;
    const definitionSourceScopeIndex = definitionDocument?.sourceLexicalNamespace.scopeIndex ?? sourceScopeIndex;
    const fieldNameForPath = (fieldPath: readonly RecordFieldIdentity[]) => fieldPath.map((field) =>
      definitionSourceNamespace?.recordSemanticAnalysis?.definitionsByStatementId.get(field.recordStatementId)?.fields.find((candidate) => candidate.fieldIndex === field.fieldIndex)?.name ?? ""
    ).join(".");
    for (const parameter of definition.parameters) {
      const type = scalarExpressionTypeOfDslValueType(parameter.valueType) ?? scalarTypeOf(parameter.type);
      if (!type) continue;
      const id = bindingIdFor("parameter", context, String(parameter.parameterIndex));
      const info: BindingInfo = {
        id,
        declarationVersionId: declarationVersionIdFor("parameter", context, String(parameter.parameterIndex)),
        name: parameter.name,
        type,
        bindingKind: "const",
        scopeId,
        sourceScopeId: bodyScopeId,
        contextKey: key,
        statementId: definition.statementId,
        statementIndex: instance.statementIndex
      };
      parameters.set(parameter.parameterIndex, info);
      allBindingInfos.push(info);
    }
    for (const parameter of definition.parameters) {
      const recordParameter = definitionSourceNamespace?.recordSemanticAnalysis?.moduleParameters.find((candidate) =>
        candidate.definitionStatementId === definition.statementId && candidate.parameterIndex === parameter.parameterIndex
      );
      if (!recordParameter?.typeIdentity) continue;
      const parameterBinding = instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      if (!parameterBinding || parameterBinding.state === "omitted" || parameterBinding.value?.kind !== "record") continue;
      const recordDefinition = definitionSourceNamespace?.recordSemanticAnalysis?.definitionsByStatementId.get(recordParameter.typeIdentity);
      if (!recordDefinition) continue;
      const fieldBindings = new Map<number, { id: BindingId }>();
      const fieldBindingsByPath = new Map<string, { id: BindingId }>();
      if (parameterBinding.value.reference.target) {
        for (const { field, path: fieldPath } of scalarFieldPathsFor(recordDefinition, [], definitionSourceNamespace?.recordSemanticAnalysis)) {
          const bindingId = recordFieldBindingIdForTarget(parameterBinding.value.reference.target, field, context, fieldPath);
          if (bindingId) {
            const info = { id: bindingId };
            fieldBindingsByPath.set(recordFieldPathKey(fieldPath), info);
            if (fieldPath.length === 1) fieldBindings.set(field.fieldIndex, info);
          }
        }
      } else if (parameterBinding.value.reference.constructor) {
        for (const { field, path: fieldPath, type } of scalarFieldPathsFor(recordDefinition, [], definitionSourceNamespace?.recordSemanticAnalysis)) {
          const constructorField = constructorFieldAtPath(parameterBinding.value.reference.constructor.fields, fieldPath);
          if (!constructorField) continue;
          const bindingId = moduleRecordParameterScalarBindingIdForPath(
            path,
            definition.statementId,
            parameter.parameterIndex,
            fieldPath
          );
          const info: BindingInfo = {
            id: bindingId,
            declarationVersionId: moduleRecordParameterScalarDeclarationVersionIdForPath(path, definition.statementId, parameter.parameterIndex, fieldPath),
            name: `${parameter.name}.${fieldNameForPath(fieldPath)}`,
            type,
            bindingKind: "const",
            scopeId,
            sourceScopeId: bodyScopeId,
            contextKey: key,
            statementId: definition.statementId,
            statementIndex: instance.statementIndex
          };
          fieldBindingsByPath.set(recordFieldPathKey(fieldPath), info);
          if (fieldPath.length === 1) fieldBindings.set(field.fieldIndex, info);
          allBindingInfos.push(info);
        }
      }
      if (fieldBindings.size > 0) recordParameters.set(parameter.parameterIndex, fieldBindings);
      if (fieldBindingsByPath.size > 0) recordParameterFieldBindingsByPath.set(parameter.parameterIndex, fieldBindingsByPath);
    }
    for (const local of definition.localScalars) {
      const type = scalarExpressionTypeOfDslValueType(local.type);
      if (!type) continue;
      const info: BindingInfo = {
        id: bindingIdFor("local", context, local.statementId),
        declarationVersionId: declarationVersionIdFor("local", context, local.statementId),
        name: local.name,
        type,
        bindingKind: local.bindingKind,
        sourceScopeId: definitionSourceScopeIndex?.scopeOfStatement.get(local.statementIndex) ?? bodyScopeId,
        scopeId: moduleScopeIdFor(path, definitionSourceScopeIndex?.scopeOfStatement.get(local.statementIndex) ?? bodyScopeId),
        contextKey: key,
        statementId: local.statementId,
        statementIndex: local.statementIndex
      };
      locals.set(local.statementId, info);
      allBindingInfos.push(info);
    }
    for (const carry of definition.immutableCarries ?? []) {
      if (!carry.type) continue;
      const sourceScopeId = definitionSourceScopeIndex?.scopeOfStatement.get(carry.statementIndex) ?? bodyScopeId;
      const id = moduleCarryBindingIdFor(path, carry.bindingId);
      const info: BindingInfo = {
        id,
        declarationVersionId: `module-carry-declaration:${encodeIdentityTuple(["carry", ...path, carry.bindingId])}`,
        name: carry.name,
        type: carry.type,
        bindingKind: "const",
        sourceScopeId,
        scopeId: moduleScopeIdFor(path, sourceScopeId),
        contextKey: key,
        statementId: carry.statementId,
        statementIndex: carry.statementIndex
      };
      carries.set(carry.bindingId, info);
      allBindingInfos.push(info);
    }
    for (const recordValue of definition.recordValues) {
      if (!recordValue.value.typeIdentity || !recordValue.target) continue;
      const recordDefinition = definitionSourceNamespace?.recordSemanticAnalysis?.definitionsByStatementId.get(recordValue.value.typeIdentity);
      if (!recordDefinition) continue;
      const fieldBindings = new Map<number, { id: BindingId }>();
      const fieldBindingsByPath = new Map<string, { id: BindingId }>();
      if (recordValue.value.constructor) {
        for (const { field, path: fieldPath, type } of scalarFieldPathsFor(recordDefinition, [], definitionSourceNamespace?.recordSemanticAnalysis)) {
          const constructorField = constructorFieldAtPath(recordValue.fields, fieldPath);
          if (!constructorField) continue;
          const bindingId = moduleRecordScalarBindingIdForPath(path, recordValue.value.statementId, fieldPath);
          const info: BindingInfo = {
            id: bindingId,
            declarationVersionId: moduleRecordScalarDeclarationVersionIdForPath(path, recordValue.value.statementId, fieldPath),
            name: `${recordValue.value.name}.${fieldNameForPath(fieldPath)}`,
            type,
            bindingKind: "const",
            scopeId: moduleScopeIdFor(path, definitionSourceScopeIndex?.scopeOfStatement.get(recordValue.value.statementIndex) ?? bodyScopeId),
            sourceScopeId: definitionSourceScopeIndex?.scopeOfStatement.get(recordValue.value.statementIndex) ?? bodyScopeId,
            contextKey: key,
            statementId: recordValue.value.statementId,
            statementIndex: recordValue.value.statementIndex
          };
          fieldBindingsByPath.set(recordFieldPathKey(fieldPath), info);
          if (fieldPath.length === 1) fieldBindings.set(field.fieldIndex, info);
          allBindingInfos.push(info);
        }
      } else if (recordValue.valueExpression?.kind === "coalesce") {
        // A coalesced record still needs scalar bindings for constructor
        // fields on its present RHS. The collection descriptor below selects
        // those fields lazily after resolving the optional LHS.
        const constructor = recordValue.valueExpression.right?.kind === "constructor"
          ? recordValue.valueExpression.right.constructor
          : null;
        if (constructor) {
          for (const { field, path: fieldPath, type } of scalarFieldPathsFor(recordDefinition, [], definitionSourceNamespace?.recordSemanticAnalysis)) {
            const constructorField = constructorFieldAtPath(constructor.fields, fieldPath);
            if (!constructorField) continue;
            const bindingId = moduleRecordScalarBindingIdForPath(path, recordValue.value.statementId, fieldPath);
            const info: BindingInfo = {
              id: bindingId,
              declarationVersionId: moduleRecordScalarDeclarationVersionIdForPath(path, recordValue.value.statementId, fieldPath),
              name: `${recordValue.value.name}.${fieldNameForPath(fieldPath)}`,
              type,
              bindingKind: "const",
              scopeId: moduleScopeIdFor(path, definitionSourceScopeIndex?.scopeOfStatement.get(recordValue.value.statementIndex) ?? bodyScopeId),
              sourceScopeId: definitionSourceScopeIndex?.scopeOfStatement.get(recordValue.value.statementIndex) ?? bodyScopeId,
              contextKey: key,
              statementId: recordValue.value.statementId,
              statementIndex: recordValue.value.statementIndex
            };
            fieldBindingsByPath.set(recordFieldPathKey(fieldPath), info);
            if (fieldPath.length === 1) fieldBindings.set(field.fieldIndex, info);
            allBindingInfos.push(info);
          }
        }
      } else if (recordValue.valueExpression?.kind === "none") {
        // The ordinary none descriptor below represents an optional record
        // with no present branch and needs no scalar field bindings.
      } else if (recordValue.valueExpression) {
        for (const { field, path: fieldPath, type } of scalarFieldPathsFor(recordDefinition, [], definitionSourceNamespace?.recordSemanticAnalysis)) {
          const bindingId = moduleRecordScalarBindingIdForPath(path, recordValue.value.statementId, fieldPath);
          const info: BindingInfo = {
            id: bindingId,
            declarationVersionId: moduleRecordScalarDeclarationVersionIdForPath(path, recordValue.value.statementId, fieldPath),
            name: `${recordValue.value.name}.${fieldNameForPath(fieldPath)}`,
            type,
            bindingKind: "const",
            scopeId: moduleScopeIdFor(path, definitionSourceScopeIndex?.scopeOfStatement.get(recordValue.value.statementIndex) ?? bodyScopeId),
            sourceScopeId: definitionSourceScopeIndex?.scopeOfStatement.get(recordValue.value.statementIndex) ?? bodyScopeId,
            contextKey: key,
            statementId: recordValue.value.statementId,
            statementIndex: recordValue.value.statementIndex
          };
          fieldBindingsByPath.set(recordFieldPathKey(fieldPath), info);
          if (fieldPath.length === 1) fieldBindings.set(field.fieldIndex, info);
          allBindingInfos.push(info);
        }
      } else {
        for (const { field, path: fieldPath } of scalarFieldPathsFor(recordDefinition, [], definitionSourceNamespace?.recordSemanticAnalysis)) {
          const bindingId = recordFieldBindingIdForTarget(recordValue.target, field, context, fieldPath);
          if (bindingId) {
            const info = { id: bindingId };
            fieldBindingsByPath.set(recordFieldPathKey(fieldPath), info);
            if (fieldPath.length === 1) fieldBindings.set(field.fieldIndex, info);
          }
        }
      }
      if (fieldBindings.size > 0) recordValues.set(recordValue.value.statementId, fieldBindings);
      if (fieldBindingsByPath.size > 0) recordValueFieldBindingsByPath.set(recordValue.value.statementId, fieldBindingsByPath);
    }
    for (const body of definition.bodyStatements) {
      if (body.statementKind !== "element") continue;
      const statement = definitionStatements[body.statementIndex];
      if (statement?.kind !== "element" || statement.type !== "forGroup") continue;
      const sourceScopeId = definitionSourceScopeIndex?.scopeOfStatement.get(body.statementIndex) ?? bodyScopeId;
      const sourceSlot = definitionSourceScopeIndex?.forGroupIterationSlots.get(`for:${body.statementId}`);
      iterations.set(body.statementId, {
        id: moduleIterationIdFor(path, body.statementId),
        declarationVersionId: moduleIterationIdFor(path, body.statementId),
        name: sourceSlot?.name ?? "",
        type: scalarTypeOfDslValueType(sourceSlot?.valueType ?? null) ?? { kind: "number" },
        bindingKind: "const",
        sourceScopeId,
        scopeId: moduleScopeIdFor(path, sourceScopeId),
        contextKey: key,
        statementId: body.statementId,
        statementIndex: body.statementIndex
      });
    }
    for (const body of definition.bodyStatements) {
      if (body.statementKind !== "moduleInstance") continue;
      const nested = (moduleRuntimeContext?.analysisFor(definitionDocumentId) ?? moduleSemanticAnalysis).instancesByStatementId.get(body.statementId);
      if (nested) registerInstance(nested, path, key);
    }
    return context;
  };

  for (const instance of moduleSemanticAnalysis.instances) {
    if (instance.callerModuleDefinitionStatementId === null) registerInstance(instance, [], null);
  }

  const effectiveActivities = effectiveElementActivityById(elements, drawingModifiers);
  const contextIsDisabled = (context: InstanceContext) => {
    const runtimeId = instanceElement(moduleMaterialization, context.path);
    return runtimeId !== undefined && effectiveActivities.get(runtimeId)?.activity === "disabled";
  };
  const disabledBindingIds = new Set(
    allBindingInfos
      .filter((info) => contextsByKey.get(info.contextKey) && contextIsDisabled(contextsByKey.get(info.contextKey)!))
      .map((info) => info.id)
  );

  const bindingInfoById = new Map(allBindingInfos.map((info) => [info.id, info] as const));
  const valueForBinderBindingFor = (target: Extract<ModuleScalarSourceTarget, { kind: "valueForBinder" }>, context: InstanceContext): Binding => ({
    id: moduleCollectionBinderIdFor(context.path, target.binderId),
    kind: "typed",
    name: target.name,
    nameSpan: null,
    statementIndex: target.statementIndex,
    effectiveScopeId: context.scopeId,
    visibility: { kind: "typed", scopeId: context.scopeId },
    mutability: "readonly",
    declaredType: target.sourceElementType,
    rank: Number.MAX_SAFE_INTEGER,
    resolutionMode: "preResolvedOnly"
  });
  const runtimeBindingIdForDocumentTarget = (target: Extract<ModuleScalarSourceTarget, { kind: "documentBinding" }>): BindingId => {
    const documentId = target.identity?.documentId;
    if (!documentId || documentId === moduleRuntimeContext?.rootDocumentId) return target.bindingId;
    return foreignSourceScalars.get(documentId)?.bindingIdByLocalId.get(target.bindingId) ?? target.bindingId;
  };
  const bindingInfoForTarget = (target: ModuleScalarSourceTarget, current: InstanceContext): BindingInfo | undefined => {
    if (target.kind === "documentBinding") return bindingInfoById.get(runtimeBindingIdForDocumentTarget(target));
    if (target.kind === "recordField") {
      const bindingId = recordFieldBindingIdForTarget(target.record, target.field, current, target.fieldPath);
      return bindingId ? bindingInfoById.get(bindingId) : undefined;
    }
    if (target.kind === "deferredModuleScalarExport") {
      const child = runtimeContextForSourceInstance(current, target.instanceStatementId, target.instanceIdentity?.documentId);
      const exported = child?.definition.exports.find((candidate) => candidate.name === target.exportName);
      return exported?.kind === "scalar" && exported.exportedStatementId === target.exportedStatementId
        ? child?.locals.get(exported.exportedStatementId)
        : undefined;
    }
    const contextCandidates: InstanceContext[] = [];
    let cursor: InstanceContext | undefined = current;
    while (cursor) {
      contextCandidates.push(cursor);
      cursor = cursor.parentKey ? contextsByKey.get(cursor.parentKey) : undefined;
    }
    if (target.kind === "parameter") {
      return contextCandidates.find((candidate) => candidate.definition.statementId === target.definitionStatementId &&
        (!target.definitionIdentity || candidate.definitionDocumentId === target.definitionIdentity.documentId))
        ?.parameters.get(target.parameterIndex);
    }
    if (target.kind === "moduleLocal") {
      const carryBindingId = target.carryBindingId;
      if (carryBindingId) {
        return contextCandidates.find((candidate) => candidate.carries.has(carryBindingId) &&
          (!target.identity || candidate.definitionDocumentId === target.identity.documentId))
          ?.carries.get(carryBindingId);
      }
      return contextCandidates.find((candidate) => candidate.locals.has(target.statementId) &&
        (!target.identity || candidate.definitionDocumentId === target.identity.documentId))
        ?.locals.get(target.statementId);
    }
    if (target.kind === "iteration") {
      return contextCandidates.find((candidate) => candidate.iterations.has(target.statementId) &&
        (!target.identity || candidate.definitionDocumentId === target.identity.documentId))
        ?.iterations.get(target.statementId);
    }
    return undefined;
  };

  const moduleBodyStatementIsReachable = (...args: readonly unknown[]): boolean => {
    void args;
    return true;
  };

  const contextIsReachable = (context: InstanceContext): boolean => {
    if (!context.parentKey) return true;
    const parent = contextsByKey.get(context.parentKey);
    if (!parent || !contextIsReachable(parent)) return false;
    const ownerBody = parent.definition.bodyStatements.find((body) => body.statementId === context.instance.statementId);
    return ownerBody ? moduleBodyStatementIsReachable(parent, ownerBody) : false;
  };

  const events: RuntimeEvent[] = [];
  const eventOrderByBindingId = new Map<BindingId, number>();
  const eventOrderByStatementIndex = new Map<number, number>();
  const eventOrderByPathAndStatementIndex = new Map<string, Map<number, number>>();
  const elementOrderById = new Map<ElementId, number>();
  const scopeExitOrderById = new Map<string, number>();
  const pushEvent = (event: RuntimeEvent, sourceStatementIndex?: number, runtimePath: readonly string[] = []) => {
    const order = events.length;
    events.push(event);
    if (sourceStatementIndex !== undefined && !eventOrderByStatementIndex.has(sourceStatementIndex)) {
      eventOrderByStatementIndex.set(sourceStatementIndex, order);
    }
    if (sourceStatementIndex !== undefined) {
      const key = pathKey(runtimePath);
      const pathEvents = eventOrderByPathAndStatementIndex.get(key) ?? new Map<number, number>();
      if (!pathEvents.has(sourceStatementIndex)) pathEvents.set(sourceStatementIndex, order);
      eventOrderByPathAndStatementIndex.set(key, pathEvents);
    }
    if (event.kind === "binding") eventOrderByBindingId.set(event.bindingId, order);
    if (event.kind === "element") elementOrderById.set(event.elementId, order);
  };

  const emittedForeignDocumentBindings = new Set<import("../document/multiDocumentPrimitives").DocumentId>();
  const emitForeignDocumentBindings = (documentId: import("../document/multiDocumentPrimitives").DocumentId | undefined) => {
    if (!documentId || emittedForeignDocumentBindings.has(documentId)) return;
    const foreign = foreignSourceScalars.get(documentId);
    if (!foreign) return;
    emittedForeignDocumentBindings.add(documentId);
    for (const binding of foreign.analysis.bindingAnalysis.catalog.bindings) {
      if (binding.kind !== "typed") continue;
      const runtimeId = foreign.bindingIdByLocalId.get(binding.id);
      if (runtimeId) pushEvent({ kind: "binding", bindingId: runtimeId });
    }
  };

  const bodyRuntimeEntry = (context: InstanceContext, body: ModuleBodyStatementSemantic) =>
    elementForBody(moduleMaterialization, context.path, body.statementId);

  const emitInstance = (context: InstanceContext) => {
    const start = events.length;
    if (!contextIsReachable(context)) {
      scopeExitOrderById.set(context.scopeId, start);
      return;
    }
    emitForeignDocumentBindings(context.definitionDocumentId);
    const runtimeId = instanceElement(moduleMaterialization, context.path);
    const callerPath = context.path.slice(0, -1);
    if (runtimeId) pushEvent({ kind: "element", elementId: runtimeId }, context.instance.statementIndex, callerPath);
    for (const parameter of context.definition.parameters) {
      const info = context.parameters.get(parameter.parameterIndex);
      if (info) pushEvent({ kind: "binding", bindingId: info.id }, context.instance.statementIndex, callerPath);
    }
    for (const fields of context.recordParameters.values()) {
      for (const field of fields.values()) {
        if (bindingInfoById.get(field.id)?.contextKey === context.key) {
          pushEvent({ kind: "binding", bindingId: field.id }, context.instance.statementIndex, callerPath);
        }
      }
    }
    for (const fields of context.recordParameterFieldBindingsByPath.values()) {
      for (const field of fields.values()) {
        if (bindingInfoById.get(field.id)?.contextKey === context.key) {
          pushEvent({ kind: "binding", bindingId: field.id }, context.instance.statementIndex, callerPath);
        }
      }
    }
    const pendingRecordValues = [...context.definition.recordValues].sort((left, right) => left.value.statementIndex - right.value.statementIndex);
    const emittedRecordValues = new Set<string>();
    const emitRecordValuesThrough = (statementIndex: number) => {
      for (const recordValue of pendingRecordValues) {
        if (emittedRecordValues.has(recordValue.value.statementId) || recordValue.value.statementIndex > statementIndex) continue;
        emittedRecordValues.add(recordValue.value.statementId);
        // Aliases and pass-through values reuse the source field bindings;
        // only a constructor introduces new runtime binding events.
        if (!recordValue.value.constructor && !recordValue.valueExpression) continue;
        for (const field of context.recordValues.get(recordValue.value.statementId)?.values() ?? []) {
          if (bindingInfoById.has(field.id)) pushEvent({ kind: "binding", bindingId: field.id }, recordValue.value.statementIndex, context.path);
        }
        for (const field of context.recordValueFieldBindingsByPath.get(recordValue.value.statementId)?.values() ?? []) {
          if (bindingInfoById.has(field.id)) pushEvent({ kind: "binding", bindingId: field.id }, recordValue.value.statementIndex, context.path);
        }
      }
    };
    for (const body of context.definition.bodyStatements) {
      emitRecordValuesThrough(body.statementIndex);
      if (!moduleBodyStatementIsReachable(context, body)) continue;
      if (body.statementKind === "typedDeclaration") {
        const info = context.locals.get(body.statementId);
        if (info) pushEvent({ kind: "binding", bindingId: info.id }, body.statementIndex, context.path);
      } else if (body.statementKind === "moduleInstance") {
        const nestedPath = moduleRuntimeContext
          ? moduleRuntimeContext.runtimePathForInstance(context.path, (moduleRuntimeContext.analysisFor(context.definitionDocumentId) ?? moduleSemanticAnalysis).instancesByStatementId.get(body.statementId)!)
          : [...context.path, body.statementId];
        const nested = contextsByKey.get(pathKey(nestedPath));
        if (nested) emitInstance(nested);
      } else {
        const runtime = bodyRuntimeEntry(context, body);
        if (runtime) pushEvent({ kind: "element", elementId: runtime.elementId }, body.statementIndex, context.path);
      }
    }
    emitRecordValuesThrough(Number.MAX_SAFE_INTEGER);
    const contextEnd = Math.max(start, events.length);
    const sourceScopeIds = new Set<string>([context.bodyScopeId]);
    const definitionScopeIndex = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.sourceLexicalNamespace.scopeIndex ?? sourceScopeIndex;
    for (const body of context.definition.bodyStatements) {
      sourceScopeIds.add(definitionScopeIndex?.scopeOfStatement.get(body.statementIndex) ?? context.bodyScopeId);
    }
    for (const sourceScopeId of sourceScopeIds) {
      scopeExitOrderById.set(moduleScopeIdFor(context.path, sourceScopeId), contextEnd);
    }
    scopeExitOrderById.set(context.scopeId, contextEnd);
  };

  for (const [statementIndex, statement] of statements.entries()) {
    if (!include(statement, statementIndex)) continue;
    if (statement.kind === "moduleDefinition") continue;
    if (statement.kind === "moduleInstance") {
      const statementId = stableStatementIdByIndex.get(statementIndex);
      const rootInstance = statementId
        ? moduleRuntimeContext?.instanceFor({ documentId: moduleRuntimeContext.rootDocumentId, localIdentity: statementId })
          ?? moduleSemanticAnalysis.instancesByStatementId.get(statementId)
        : undefined;
      const rootPath = rootInstance && moduleRuntimeContext
        ? moduleRuntimeContext.runtimePathForInstance([], rootInstance)
        : statementId ? [statementId] : [];
      const context = rootPath.length > 0 ? contextsByKey.get(pathKey(rootPath)) : undefined;
      if (context) emitInstance(context);
      continue;
    }
    if (statement.kind === "typedDeclaration") {
      const stableId = stableStatementIdByIndex.get(statementIndex);
      const binding = baseCatalog.bindings.find((candidate) => candidate.kind === "typed" && candidate.statementIndex === statementIndex && candidate.id === `binding:${stableId}`);
      if (statement.kind === "typedDeclaration" && binding) pushEvent({ kind: "binding", bindingId: binding.id }, statementIndex);
      if (statement.kind === "typedDeclaration") {
        // Source-owned record fields are pre-resolved catalog entries rather
        // than ordinary declaration bindings. They still need a source event
        // so Module dependencies observe the record constructor before a
        // later instance consumes its field.
        for (const sourceBinding of sourceOwnedBindingsByStatementIndex.get(statementIndex) ?? []) {
          pushEvent({ kind: "binding", bindingId: sourceBinding.id }, statementIndex);
        }
      }
      continue;
    }
    const elementId = moduleMaterialization.elementIdBySourceStatementIndex.get(statementIndex);
    if (elementId) pushEvent({ kind: "element", elementId }, statementIndex);
  }

  for (const entry of moduleMaterialization.executionStatements) {
    if (entry.runtimeIdentity) {
      const context = contextsByKey.get(pathKey(entry.runtimeInstancePath ?? entry.instancePath));
      const body = entry.runtimeIdentity.kind === "moduleBody"
        ? context?.definition.bodyStatements.find((candidate) => candidate.statementId === entry.sourceStatementId)
        : undefined;
      if (context && (!contextIsReachable(context) || (body && !moduleBodyStatementIsReachable(context, body)))) continue;
    }
    if (!elementOrderById.has(entry.runtimeElementId)) {
      pushEvent(
        { kind: "element", elementId: entry.runtimeElementId },
        entry.sourceStatementIndex,
        entry.runtimeInstancePath ?? entry.instancePath
      );
    }
  }

  for (const info of allBindingInfos) {
    info.eventOrder = eventOrderByBindingId.get(info.id);
    if (info.eventOrder === undefined) {
      info.eventOrder = eventOrderByStatementIndex.get(info.statementIndex) ?? events.length;
    }
  }
  const moduleSeeds: BindingSeed[] = allBindingInfos.flatMap<BindingSeed>((info) => info.eventOrder === undefined ? [] : [{
    id: info.id,
    kind: "typed" as const,
    name: info.name,
    nameSpan: null,
    statementIndex: info.statementIndex,
    sourceOrder: info.eventOrder,
    effectiveScopeId: info.scopeId,
    visibility: { kind: "typed", scopeId: info.scopeId } as BindingSeed["visibility"],
    mutability: "const",
    declaredType: info.type,
    declarationVersionId: info.declarationVersionId,
    resolutionMode: "preResolvedOnly"
  }]);
  const iterationSeeds = baseCatalog.bindings.filter((binding) => binding.kind === "iteration").map((binding) => ({
    id: binding.id,
    kind: "iteration" as const,
    name: binding.name,
    nameSpan: binding.nameSpan,
    statementIndex: binding.statementIndex,
    sourceOrder: 0,
    effectiveScopeId: binding.effectiveScopeId,
    visibility: binding.visibility as Extract<BindingSeed["visibility"], { kind: "iteration" }>,
    mutability: binding.mutability,
    declaredType: binding.declaredType
  }));
  const moduleIterationSeeds: BindingSeed[] = [...contextsByKey.values()].flatMap((context) =>
    [...context.iterations.values()].map((info) => ({
      id: info.id,
      kind: "iteration" as const,
      name: info.name,
      nameSpan: null,
      statementIndex: info.statementIndex,
      sourceOrder: 0,
      effectiveScopeId: info.scopeId,
      visibility: { kind: "iteration", rootScopeId: info.scopeId } as BindingSeed["visibility"],
      mutability: "readonly" as const,
      declaredType: info.type,
      resolutionMode: "preResolvedOnly" as const
    }))
  );
  const basePreResolvedSeeds: BindingSeed[] = baseCatalog.bindings
    .filter((binding) => binding.resolutionMode === "preResolvedOnly" || binding.id.includes(":carry:"))
    .map((binding) => {
      const sourceLaneOrdinal = binding.catalogOrder === "source"
        ? sourceLaneOrdinalByBindingId.get(binding.id)
        : undefined;
      if (binding.catalogOrder === "source" && sourceLaneOrdinal === undefined) {
        throw new Error(`moduleScalarRuntime: missing source-lane ordinal for ${binding.id}`);
      }
      return {
      id: binding.id,
      kind: binding.kind,
      name: binding.name,
      nameSpan: binding.nameSpan,
      statementIndex: binding.statementIndex,
      sourceOrder: sourceLaneOrdinal ?? 0,
      effectiveScopeId: binding.effectiveScopeId,
      visibility: binding.visibility,
      mutability: binding.mutability,
      declaredType: binding.declaredType,
      ...(binding.declarationVersionId ? { declarationVersionId: binding.declarationVersionId } : {}),
      resolutionMode: "preResolvedOnly" as const,
      ...(binding.catalogOrder === "source" ? { catalogOrder: "source" as const } : {})
      };
    });
  const additionalSeeds: BindingSeed[] = [];
  const additionalSeedIds = new Set<BindingId>();
  for (const seed of [...basePreResolvedSeeds, ...moduleSeeds, ...moduleIterationSeeds]) {
    if (additionalSeedIds.has(seed.id)) continue;
    additionalSeedIds.add(seed.id);
    additionalSeeds.push(seed);
  }
  const combinedCatalog = buildBindingCatalog({
    scopeIndex: baseCatalog.scopeIndex,
    stableStatementIdByIndex,
    iterationBindings: iterationSeeds,
    additionalBindings: additionalSeeds,
    containerIndex: baseCatalog.containerIndex,
    ...(baseCatalog.sourceNamespaceBindingResolver
      ? { sourceNamespaceBindingResolver: baseCatalog.sourceNamespaceBindingResolver }
      : {})
  });
  const bindingsById = new Map(combinedCatalog.bindingsById);
  const remapForeignResolution = (
    resolution: BindingResolution,
    foreign: ForeignSourceScalars
  ): BindingResolution => {
    const remap = (bindingId: BindingId) => foreign.bindingIdByLocalId.get(bindingId) ?? bindingId;
    switch (resolution.kind) {
      case "resolved": {
        const binding = bindingsById.get(remap(resolution.binding.id));
        return binding ? { kind: "resolved", binding } : {
          kind: "undefined",
          name: resolution.binding.name,
          scopeId: "module-runtime-foreign",
          statementIndex: resolution.binding.statementIndex
        };
      }
      case "forward": return { ...resolution, bindingIds: resolution.bindingIds.map(remap) };
      case "self": return { ...resolution, bindingId: remap(resolution.bindingId) };
      case "duplicate": return { ...resolution, bindingIds: resolution.bindingIds.map(remap) };
      default: return resolution;
    }
  };
  const foreignReferences = [...foreignSourceScalars.values()].flatMap((foreign) =>
    foreign.analysis.bindingAnalysis.initializerReferences.map((reference) => ({
      ...reference,
      fromBindingId: foreign.bindingIdByLocalId.get(reference.fromBindingId) ?? reference.fromBindingId,
      resolution: remapForeignResolution(reference.resolution, foreign)
    }))
  );
  const documentIterationBindingForTarget = (target: Extract<ModuleScalarSourceTarget, { kind: "iteration" }>) =>
    baseCatalog.bindings.find((binding) =>
      binding.kind === "iteration" &&
      binding.statementIndex === target.statementIndex &&
      binding.name === target.name
    );
  const resolvedBindingForContext = (target: ModuleScalarSourceTarget, context: InstanceContext): Binding | undefined => {
    if (target.kind === "documentBinding") return bindingsById.get(runtimeBindingIdForDocumentTarget(target));
    if (target.kind === "valueForBinder") {
      return valueForBinderBindingFor(target, context);
    }
    const info = bindingInfoForTarget(target, context);
    if (info) return bindingsById.get(info.id);
    if (target.kind === "recordField") {
      const bindingId = recordFieldBindingIdForTarget(target.record, target.field, context, target.fieldPath);
      return bindingId ? bindingsById.get(bindingId) : undefined;
    }
    if (target.kind === "iteration") return documentIterationBindingForTarget(target);
    return undefined;
  };

  const sourceNamespaceForContext = (context: InstanceContext): SourceLexicalNamespaceIndex | undefined =>
    moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.sourceLexicalNamespace ?? sourceNamespace;

  const collectionValueIdFor = (
    valueId: string,
    context: InstanceContext | null
  ): string => {
    if (context && valueId.startsWith("carry-collection:")) {
      const suffix = valueId.endsWith(":initializer")
        ? ":initializer"
        : valueId.endsWith(":next")
          ? ":next"
          : "";
      const sourceBindingId = valueId.slice("carry-collection:".length, suffix ? -suffix.length : undefined);
      // Lowering may revisit an already projected collection ID while it
      // remaps the checked expression. Keep that remapping idempotent.
      if (sourceBindingId.startsWith("module-binding:")) return valueId;
      return `${immutableCarryCollectionValueId(moduleCarryBindingIdFor(context.path, sourceBindingId))}${suffix}`;
    }
    if (/^optional-match-binder:\d+:\d+:\d+$/.test(valueId)) {
      return context ? moduleCollectionBinderIdFor(context.path, valueId) : valueId;
    }
    const recordValueIdentity = recordValueCollectionIdentityFor(valueId);
    if (recordValueIdentity) {
      if (recordValueIdentity.path.length > 0) return valueId;
      const owner = context && contextCandidatesFor(context).find((candidate) =>
        candidate.definition.recordValues.some((value) => value.value.statementId === recordValueIdentity.statementId)
      );
      if (owner) {
        return recordValueCollectionIdFor(owner.path, recordValueIdentity.statementId);
      }
      return valueId;
    }
    if (valueId.startsWith("record-field-collection:")) {
      try {
        const encoded = JSON.parse(valueId.slice("record-field-collection:".length)) as unknown;
        const identity = recordFieldCollectionIdentityFor(encoded);
        if (identity) {
          return recordFieldCollectionValueIdFor(
            collectionValueIdFor(identity.collectionValueId, context),
            identity.fieldPath[identity.fieldPath.length - 1]!,
            identity.fieldPath
          );
        }
      } catch {
        // The compiler only emits its own encoded field projection IDs.
      }
      return valueId;
    }
    const deferred = parseGeometryArrayDeferredModuleExportId(valueId);
    if (deferred) {
      const child = runtimeContextForSourceInstance(context, deferred.instanceStatementId);
      const exported = child?.definition.exports.find((candidate) => candidate.kind === "collection" && candidate.name === deferred.exportName);
      return child && exported?.kind === "collection"
        ? moduleCollectionValueIdFor(child.path, exported.exportedStatementId)
        : valueId;
    }
    const parameterMatch = /^(.*):parameter:(\d+)$/.exec(valueId);
    if (parameterMatch && context) {
      const definitionStatementId = parameterMatch[1]!;
      const candidate = contextCandidatesFor(context).find((item) => item.definition.statementId === definitionStatementId);
      if (candidate) return moduleCollectionValueIdFor(candidate.path, valueId);
    }
    if (context) {
      const analysis = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis;
      const local = analysis?.genericValuesByStatementId.get(valueId) ?? analysis?.valuesByStatementId.get(valueId);
      if (local?.ownerModuleDefinitionStatementIndex === context.definition.statementIndex) {
        return moduleCollectionValueIdFor(context.path, valueId);
      }
    }
    if (
      sourceNamespace?.geometryArraySemanticAnalysis?.genericValuesByStatementId.has(valueId) ||
      sourceNamespace?.geometryArraySemanticAnalysis?.valuesByStatementId.has(valueId)
    ) return valueId;
    if (moduleRuntimeContext) {
      for (const document of moduleRuntimeContext.documentsById.values()) {
        if (
          document.sourceLexicalNamespace.geometryArraySemanticAnalysis?.genericValuesByStatementId.has(valueId) ||
          document.sourceLexicalNamespace.geometryArraySemanticAnalysis?.valuesByStatementId.has(valueId)
        ) {
          return document.documentId === moduleRuntimeContext.rootDocumentId
            ? valueId
            : `module-document-collection:${encodeIdentityTuple([document.documentId, valueId])}`;
        }
      }
    }
    return valueId;
  };

  const recordTargetValueIdFor = (
    target: ModuleRecordSourceTarget,
    context: InstanceContext | null
  ): string | null => {
    if (target.kind === "recordValue") {
      return collectionValueIdFor(recordValueCollectionIdFor([], target.statementId), context);
    }
    if (target.kind === "recordParameter") {
      const owner = context
        ? contextCandidatesFor(context).find((candidate) => candidate.definition.statementId === target.definitionStatementId)
        : null;
      return owner
        ? moduleRecordParameterCollectionValueIdFor(owner.path, target.definitionStatementId, target.parameterIndex)
        : null;
    }
    if (target.kind === "recordCollectionIndex") {
      return collectionValueIdFor(target.collectionValueId, context);
    }
    if (target.kind === "deferredModuleRecordExport") {
      const child = runtimeContextForSourceInstance(context, target.instanceStatementId, target.instanceIdentity?.documentId);
      const exported = child?.definition.exports.find((candidate) =>
        candidate.kind === "record" && candidate.name === target.exportName && candidate.exportedStatementId === target.exportedStatementId
      );
      return child && exported?.kind === "record"
        ? recordTargetValueIdFor(exported.backingTarget, child)
        : null;
    }
    return null;
  };

  const scalarCollectionMemberFromLiteral = (
    sourceText: string,
    type: ScalarExpressionType
  ): ScalarProgramCollectionMember | null => {
    if (sourceText.trim() === "none") {
      return type.kind === "optional" ? { kind: "literal", type, value: { kind: "none" } } : null;
    }
    const literal = scanScalarLiteral(sourceText, { start: 0, end: sourceText.length });
    if (literal.kind === "error" || literal.span.start !== 0 || literal.span.end !== sourceText.length) return null;
    const choiceType = type.kind === "choice"
      ? type
      : type.kind === "optional" && type.valueType.kind === "choice"
        ? type.valueType
        : null;
    const value: ScalarValue | null = literal.kind === "number"
      ? { kind: "number", value: literal.value }
      : literal.kind === "string"
        ? { kind: "string", value: literal.cooked }
        : literal.kind === "boolean"
          ? { kind: "boolean", value: literal.value }
          : choiceType && literal.kind === "choice"
            ? { kind: "choice", value: literal.raw, options: choiceType.options }
            : null;
    return value && scalarValueMatchesType(type, value) ? { kind: "literal", type, value } : null;
  };

  const recordCollectionMemberForTarget = (
    target: import("../dsl/geometryArraySemanticAnalysis").GenericArraySourceTarget,
    typeIdentity: string,
    context: InstanceContext | null
  ): ScalarProgramCollectionMember | null => {
    const analysis = (context ? sourceNamespaceForContext(context) : sourceNamespace)?.recordSemanticAnalysis;
    const definition = analysis?.definitionsByStatementId.get(typeIdentity);
    if (!definition) return null;
    let recordTarget: ModuleRecordSourceTarget | null = null;
    if (target.kind === "recordValue") {
      recordTarget = {
        kind: "recordValue",
        statementId: target.statementId,
        statementIndex: target.statementIndex,
        typeIdentity
      };
    } else if (target.kind === "moduleParameterValue") {
      recordTarget = {
        kind: "recordParameter",
        definitionStatementId: target.definitionStatementId,
        parameterIndex: target.parameterIndex,
        typeIdentity
      };
    }
    if (!recordTarget) return null;
    const fields: ScalarProgramRecordField[] = scalarFieldPathsFor(definition).flatMap(({ field, path: fieldPath, type }) => {
      const bindingId = recordFieldBindingIdForTarget(recordTarget!, field, context, fieldPath);
      return bindingId
        ? [{
            recordStatementId: field.recordStatementId,
            fieldIndex: field.fieldIndex,
            type,
            bindingId,
            ...(fieldPath.length > 1 ? { fieldPath } : {})
          }]
        : [];
    });
    return fields.length === scalarFieldPathsFor(definition).length
      ? { kind: "record", typeIdentity, fields }
      : null;
  };

  const scalarCollectionBindingForTarget = (
    target: import("../dsl/geometryArraySemanticAnalysis").GenericArraySourceTarget,
    context: InstanceContext | null
  ): BindingId | undefined => {
    if (target.kind === "scalarBinding") return context ? moduleCollectionBinderIdFor(context.path, target.bindingId) : undefined;
    if (target.kind === "moduleParameterValue") {
      return context
        ? contextCandidatesFor(context)
        .find((candidate) => candidate.definition.statementId === target.definitionStatementId)
        ?.parameters.get(target.parameterIndex)?.id
        : undefined;
    }
    if (target.kind !== "scalarValue") return undefined;
    const local = context ? contextCandidatesFor(context).map((candidate) => candidate.locals.get(target.statementId)).find(Boolean) : undefined;
    return local?.id
      ?? baseCatalog.bindingsById.get(`binding:${target.statementId}`)?.id
      ?? [...foreignSourceScalars.values()].flatMap((foreign) => {
        const localId = foreign.analysis.bindingAnalysis.catalog.bindings.find((binding) => binding.kind === "typed" && binding.statementIndex === target.statementIndex)?.id;
        return localId ? [foreign.bindingIdByLocalId.get(localId)] : [];
      }).find((bindingId): bindingId is BindingId => bindingId !== undefined);
  };

  const buildModuleCollectionValues = (): ScalarProgramCollection[] => {
    const moduleCollectionValues: ScalarProgramCollection[] = [];
    const registeredRecordValueIds = new Set<string>();
    const registeredRecordFieldProjectionIds = new Set<string>();
    const registeredOptionalCollectionBinderIds = new Set(
      (documentScalarProgram?.collectionValues ?? []).map((value) => value.valueId)
    );
    const appendOptionalCollectionBinderAlias = (
      binderId: string,
      sourceValueId: string,
      context: InstanceContext | null
    ): void => {
      const valueId = context ? moduleCollectionBinderIdFor(context.path, binderId) : binderId;
      if (registeredOptionalCollectionBinderIds.has(valueId)) return;
      registeredOptionalCollectionBinderIds.add(valueId);
      moduleCollectionValues.push({ valueId, kind: "alias", targetValueId: collectionValueIdFor(sourceValueId, context) });
    };

    const recordMemberForValueTarget = (
      target: ModuleRecordSourceTarget,
      typeIdentity: string,
      context: InstanceContext | null
    ): ScalarProgramCollectionMember | null => {
      const analysis = (context ? sourceNamespaceForContext(context) : sourceNamespace)?.recordSemanticAnalysis;
      const definition = analysis?.definitionsByStatementId.get(typeIdentity);
      if (!definition) return null;
      const fields = scalarFieldPathsFor(definition).flatMap(({ field, path: fieldPath, type }) => {
        const bindingId = recordFieldBindingIdForTarget(target, field, context, fieldPath);
        return bindingId
          ? [{
              recordStatementId: field.recordStatementId,
              fieldIndex: field.fieldIndex,
              type,
              bindingId,
              ...(fieldPath.length > 1 ? { fieldPath } : {})
            }]
          : [];
      });
      return fields.length === scalarFieldPathsFor(definition).length
        ? { kind: "record", typeIdentity, fields }
        : null;
    };

    const recordTargetForGenericArraySourceTarget = (
      target: import("../dsl/geometryArraySemanticAnalysis").GenericArraySourceTarget,
      context: InstanceContext | null
    ): ModuleRecordSourceTarget | null => {
      const recordAnalysis = (context ? sourceNamespaceForContext(context) : sourceNamespace)?.recordSemanticAnalysis;
      if (target.kind === "recordValue") {
        const recordValue = recordAnalysis?.valuesByStatementId.get(target.statementId);
        return recordValue?.typeIdentity
          ? {
              kind: "recordValue",
              statementId: target.statementId,
              statementIndex: target.statementIndex,
              typeIdentity: recordValue.typeIdentity
            }
          : null;
      }
      if (target.kind === "moduleParameterValue") {
        const parameter = recordAnalysis?.moduleParameters.find((candidate) =>
          candidate.definitionStatementId === target.definitionStatementId && candidate.parameterIndex === target.parameterIndex
        );
        return parameter?.typeIdentity
          ? {
              kind: "recordParameter",
              definitionStatementId: target.definitionStatementId,
              parameterIndex: target.parameterIndex,
              typeIdentity: parameter.typeIdentity
            }
          : null;
      }
      return null;
    };

    const recordTargetForCollectionMember = (
      collectionValueId: string,
      index: number,
      context: InstanceContext | null,
      seen: ReadonlySet<string> = new Set()
    ): ModuleRecordSourceTarget | null => {
      const visitKey = `${collectionValueId}:${index}`;
      if (seen.has(visitKey)) return null;
      const nextSeen = new Set([...seen, visitKey]);
      const parameterMatch = /^(.*):parameter:(\d+)$/.exec(collectionValueId);
      if (parameterMatch && context) {
        const definitionStatementId = parameterMatch[1]!;
        const parameterIndex = Number(parameterMatch[2]);
        const owner = contextCandidatesFor(context).find((candidate) => candidate.definition.statementId === definitionStatementId);
        const binding = owner?.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameterIndex);
        const callerContext = owner?.parentKey ? contextsByKey.get(owner.parentKey) ?? null : null;
        if (binding?.value?.kind === "collectionLiteral") {
          const member = binding.value.value.members[index];
          return member ? recordTargetForGenericArraySourceTarget(member.target, callerContext) : null;
        }
        if (binding?.value?.kind === "collection") {
          return recordTargetForCollectionMember(binding.value.targetValueId, index, callerContext, nextSeen);
        }
      }

      const analyses = [
        context ? sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis : undefined,
        sourceNamespace?.geometryArraySemanticAnalysis
      ];
      const value = analyses
        .map((analysis) => analysis?.genericValuesByStatementId.get(collectionValueId))
        .find((candidate) => candidate !== undefined);
      if (!value?.value) return null;
      const genericValue = value.value;
      if (genericValue.kind === "alias") {
        return recordTargetForCollectionMember(genericValue.targetValueId, index, context, nextSeen);
      }
      if (genericValue.kind === "literal") {
        const member = genericValue.members[index];
        return member ? recordTargetForGenericArraySourceTarget(member.target, context) : null;
      }
      if (genericValue.kind === "map" && genericValue.sourceElementType.kind === "record" && genericValue.resultElementType.kind === "record") {
        const body = context
          ? context.definition.mappedRecordCollectionBodies?.find((candidate) => candidate.binderId === genericValue.binderId)
          : moduleSemanticAnalysis.mappedRecordCollectionBodies.find((candidate) => candidate.binderId === genericValue.binderId);
        if (body?.expression.kind === "reference" && body.expression.reference.target?.kind === "recordValueForBinder") {
          return recordTargetForCollectionMember(genericValue.sourceValueId, index, context, nextSeen);
        }
      }
      return null;
    };

    const recordCollectionMemberCountFor = (
      collectionValueId: string,
      context: InstanceContext | null,
      seen: ReadonlySet<string> = new Set()
    ): number | null => {
      if (seen.has(collectionValueId)) return null;
      const nextSeen = new Set([...seen, collectionValueId]);
      const analyses = [
        context ? sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis : undefined,
        sourceNamespace?.geometryArraySemanticAnalysis
      ];
      for (const analysis of analyses) {
        if (!analysis) continue;
        const length = collectionLengthForValueId(analysis, collectionValueId);
        if (length !== null) return length;
      }
      const parameterMatch = /^(.*):parameter:(\d+)$/.exec(collectionValueId);
      if (parameterMatch && context) {
        const definitionStatementId = parameterMatch[1]!;
        const parameterIndex = Number(parameterMatch[2]);
        const owner = contextCandidatesFor(context).find((candidate) => candidate.definition.statementId === definitionStatementId);
        const binding = owner?.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameterIndex);
        const callerContext = owner?.parentKey ? contextsByKey.get(owner.parentKey) ?? null : null;
        if (binding?.value?.kind === "collectionLiteral") return binding.value.value.members.length;
        if (binding?.value?.kind === "collection") {
          return recordCollectionMemberCountFor(binding.value.targetValueId, callerContext, nextSeen);
        }
      }
      for (const analysis of analyses) {
        const value = analysis?.genericValuesByStatementId.get(collectionValueId)?.value;
        if (!value) continue;
        if (value.kind === "literal") return value.members.length;
        if (value.kind === "alias") return recordCollectionMemberCountFor(value.targetValueId, context, nextSeen);
        if (value.kind === "map") return recordCollectionMemberCountFor(value.sourceValueId, context, nextSeen);
      }
      return null;
    };

    const recordValueSemanticForTarget = (
      target: Extract<ModuleRecordSourceTarget, { kind: "recordValue" }>,
      context: InstanceContext | null
    ): ModuleRecordValueSemantic | undefined => {
      if (context) {
        for (const candidate of contextCandidatesFor(context)) {
          const recordValue = candidate.definition.recordValues.find((value) => value.value.statementId === target.statementId);
          if (recordValue) return recordValue;
        }
      }
      return moduleSemanticAnalysis.rootRecordValuesByStatementId.get(target.statementId);
    };

    const appendCanonicalRecordFieldContentsForTarget = (
      target: ModuleRecordSourceTarget,
      fieldPath: readonly RecordFieldIdentity[],
      context: InstanceContext | null,
      contextAnalysis: GeometryArraySemanticAnalysis,
      sourceOrder: number
    ): string | null => {
      const recordValueId = recordTargetValueIdFor(target, context);
      if (!recordValueId) return null;
      const valueId = recordFieldContentsCollectionValueIdFor(recordValueId, fieldPath);
      if (registeredRecordFieldContentsIds.has(valueId)) return valueId;
      registeredRecordFieldContentsIds.add(valueId);

      if (target.kind === "recordValue") {
        const recordValue = recordValueSemanticForTarget(target, context);
        const expression = recordValue?.valueExpression;
        const fieldValue = expression ? recordFieldValueExpressionAt(expression, fieldPath) : null;
        if (fieldValue?.kind === "collection" && fieldValue.value) {
          if (context) appendConditional(fieldValue.value, valueId, context, contextAnalysis, sourceOrder);
          else appendRootConditional(fieldValue.value, valueId, sourceOrder);
          return valueId;
        }
        if (expression?.kind === "reference" && expression.reference.target) {
          const forwardedTarget = expression.reference.target;
          const forwardedValueId = recordTargetValueIdFor(forwardedTarget, context);
          if (forwardedValueId) {
            const targetFieldValueId = recordFieldContentsCollectionValueIdFor(forwardedValueId, fieldPath);
            moduleCollectionValues.push({ valueId, kind: "alias", targetValueId: targetFieldValueId });
            return valueId;
          }
        }
      }

      moduleCollectionValues.push({ valueId, kind: "none" });
      return valueId;
    };

    const appendMappedRecordFieldContents = (
      mappedValue: import("../dsl/geometryArraySemantics").DslArrayMappedValue,
      mappedBody: NonNullable<ModuleDefinitionSemantic["mappedRecordCollectionBodies"]>[number],
      fieldPath: readonly RecordFieldIdentity[],
      index: number,
      context: InstanceContext
    ): void => {
      const contextAnalysis = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis;
      if (!contextAnalysis) return;
      const collectionValueId = collectionValueIdFor(mappedBody.statementId, context);
      const mappedRecordValueId = mappedRecordMemberValueIdFor(collectionValueId, index);
      const valueId = recordFieldContentsCollectionValueIdFor(mappedRecordValueId, fieldPath);
      if (registeredRecordFieldContentsIds.has(valueId)) return;
      registeredRecordFieldContentsIds.add(valueId);

      const fieldValue = recordFieldValueExpressionAt(mappedBody.expression, fieldPath);
      if (fieldValue?.kind === "collection" && fieldValue.value) {
        appendConditional(fieldValue.value, valueId, context, contextAnalysis, mappedBody.statementIndex);
        return;
      }

      const sourceTarget = mappedBody.expression.kind === "reference" &&
        mappedBody.expression.reference.target?.kind === "recordValueForBinder"
        ? recordTargetForCollectionMember(mappedValue.sourceValueId, index, context)
        : mappedBody.expression.kind === "reference" && mappedBody.expression.reference.target
          ? mappedBody.expression.reference.target
          : null;
      if (sourceTarget) {
        const sourceContentsValueId = appendCanonicalRecordFieldContentsForTarget(
          sourceTarget,
          fieldPath,
          context,
          contextAnalysis,
          mappedBody.statementIndex
        );
        if (sourceContentsValueId) {
          moduleCollectionValues.push({ valueId, kind: "alias", targetValueId: sourceContentsValueId });
          return;
        }
      }
      moduleCollectionValues.push({ valueId, kind: "none" });
    };

    const appendRecordValueExpression = (
      expression: ModuleRecordValueExpressionSemantic,
      valueId: string,
      target: Extract<ModuleRecordSourceTarget, { kind: "recordValue" }>,
      typeIdentity: string,
      context: InstanceContext | null
    ): void => {
      if (registeredRecordValueIds.has(valueId)) return;
      registeredRecordValueIds.add(valueId);
      if (expression.kind === "none") {
        moduleCollectionValues.push({ valueId, kind: "none" });
        return;
      }
      if (expression.kind === "coalesce") {
        const leftValueId = `${valueId}:left`;
        const rightValueId = `${valueId}:right`;
        if (expression.left) appendRecordValueExpression(expression.left, leftValueId, target, typeIdentity, context);
        if (expression.right) appendRecordValueExpression(expression.right, rightValueId, target, typeIdentity, context);
        if (!expression.left || !expression.right) return;
        moduleCollectionValues.push({ valueId, kind: "coalesce", leftValueId, rightValueId, sourceOrder: context
          ? executionPositionForValue(context.path, target.statementIndex)
          : executionPositionForValue([], target.statementIndex) });
        return;
      }
      const lowerControlExpression = (semantic: ModuleScalarExpressionSemantic | null) => {
        if (!semantic) return null;
        return context
          ? lowerExpression(
              semantic,
              (sourceTarget) => resolvedBindingForContext(sourceTarget, context),
              bindingsById,
              (sourceTarget) => resolvedGeometryPropertyForContext(sourceTarget, context),
              (sourceTarget) => collectionLengthForTargetContext(sourceTarget, context),
              (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
              (id) => collectionValueIdFor(id, context),
              (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
              (target) => recordParameterCollectionForTargetContext(target, context)
            ).expression
          : lowerExpression(
              semantic,
              (sourceTarget) => rootBindingForTarget(sourceTarget, semantic.ast.span.start),
              bindingsById,
              rootGeometryPropertyFor,
              rootCollectionLengthFor,
              resolvedGeometryBuiltinForRoot,
              (id) => collectionValueIdFor(id, null),
              (sourceOrder) => sourceOrder
            ).expression;
      };
      if (expression.kind === "if") {
        const thenValueId = `${valueId}:then`;
        const elseValueId = `${valueId}:else`;
        if (expression.thenBranch) appendRecordValueExpression(expression.thenBranch, thenValueId, target, typeIdentity, context);
        else moduleCollectionValues.push({ valueId: thenValueId, kind: "none" });
        if (expression.elseBranch) appendRecordValueExpression(expression.elseBranch, elseValueId, target, typeIdentity, context);
        else moduleCollectionValues.push({ valueId: elseValueId, kind: "none" });
        const condition = lowerControlExpression(expression.condition);
        if (condition) moduleCollectionValues.push({ valueId, kind: "if", condition, thenValueId, elseValueId, sourceOrder: context
          ? executionPositionForValue(context.path, target.statementIndex)
          : executionPositionForValue([], target.statementIndex) });
        return;
      }
      if (expression.kind === "match") {
        const arms: { label: string; valueId: string; binderId?: string }[] = [];
        for (const arm of expression.arms) {
          const armValueId = `${valueId}:arm:${arm.label}`;
          if (arm.expression) appendRecordValueExpression(arm.expression, armValueId, target, typeIdentity, context);
          else moduleCollectionValues.push({ valueId: armValueId, kind: "none" });
          const binderId = arm.label === "some" && arm.binder
            ? optionalMatchBinderId(expression.span.start, arm.labelSpan.start, arm.binderSpan?.start ?? arm.labelSpan.end)
            : undefined;
          arms.push({ label: arm.label, valueId: armValueId, ...(binderId ? { binderId } : {}) });
        }
        const scrutinee = lowerControlExpression(expression.scrutinee);
        if (scrutinee) moduleCollectionValues.push({
          valueId,
          kind: "match",
          scrutinee,
          arms: arms.map((arm) => collectionMatchArm(arm.label, arm.valueId, arm.binderId, scrutinee, (binderId) => moduleCollectionBinderIdFor(context?.path ?? [], binderId))),
          sourceOrder: context
          ? executionPositionForValue(context.path, target.statementIndex)
          : executionPositionForValue([], target.statementIndex)
        });
        return;
      }
      if (expression.kind === "reference") {
        const targetValueId = expression.reference.target
          ? recordTargetValueIdFor(expression.reference.target, context)
          : null;
        if (!targetValueId) return;
        moduleCollectionValues.push({ valueId, kind: "alias", targetValueId });
        return;
      }
      if (expression.kind === "constructor") {
        const member = recordMemberForValueTarget(target, typeIdentity, context);
        if (member) moduleCollectionValues.push({ valueId, kind: "literal", members: [member] });
        return;
      }
      // Record collection-index values already have a dedicated collection
      // owner. They remain on that existing path; this descriptor is only for
      // whole record values and their optional/coalesced branches.
    };

    const appendRecordValue = (
      recordValue: ModuleRecordValueSemantic,
      context: InstanceContext | null
    ): void => {
      const typeIdentity = recordValue.value.typeIdentity;
      const expression = recordValue.valueExpression;
      if (!typeIdentity) return;
      const valueId = recordValueCollectionIdFor(context?.path ?? [], recordValue.value.statementId);
      if (!expression) {
        if (!context || !recordValue.target || registeredRecordValueIds.has(valueId)) return;
        registeredRecordValueIds.add(valueId);
        const targetValueId = recordTargetValueIdFor(recordValue.target, context);
        if (targetValueId && targetValueId !== valueId) {
          moduleCollectionValues.push({ valueId, kind: "alias", targetValueId });
        }
        return;
      }
      const target: Extract<ModuleRecordSourceTarget, { kind: "recordValue" }> = recordValue.target?.kind === "recordValue"
        ? recordValue.target
        : {
            kind: "recordValue",
            statementId: recordValue.value.statementId,
            statementIndex: recordValue.value.statementIndex,
            typeIdentity
        };
      appendRecordValueExpression(
        expression,
        valueId,
        target,
        typeIdentity,
        context
      );
    };

    for (const context of contextsByKey.values()) {
      const recordAnalysis = sourceNamespaceForContext(context)?.recordSemanticAnalysis;
      for (const parameter of context.definition.parameters) {
        const recordParameter = recordAnalysis?.moduleParameters.find((candidate) =>
          candidate.definitionStatementId === context.definition.statementId && candidate.parameterIndex === parameter.parameterIndex
        );
        if (!recordParameter?.typeIdentity) continue;
        const valueId = moduleRecordParameterCollectionValueIdFor(
          context.path,
          parameter.definitionStatementId,
          parameter.parameterIndex
        );
        const binding = context.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
        if (binding?.value?.kind !== "record") {
          moduleCollectionValues.push({ valueId, kind: "none" });
          continue;
        }
        if (binding.value.reference.target) {
          const targetValueId = recordTargetValueIdFor(binding.value.reference.target, context);
          if (targetValueId) moduleCollectionValues.push({ valueId, kind: "alias", targetValueId });
          else moduleCollectionValues.push({ valueId, kind: "none" });
          continue;
        }
        const target: ModuleRecordSourceTarget = {
          kind: "recordParameter",
          definitionStatementId: parameter.definitionStatementId,
          parameterIndex: parameter.parameterIndex,
          typeIdentity: recordParameter.typeIdentity,
          ...(parameter.definitionIdentity ? { definitionIdentity: parameter.definitionIdentity } : {})
        };
        const member = recordMemberForValueTarget(target, recordParameter.typeIdentity, context);
        if (member) moduleCollectionValues.push({ valueId, kind: "literal", members: [member] });
        else moduleCollectionValues.push({ valueId, kind: "none" });
      }
    }

    for (const recordValue of moduleSemanticAnalysis.rootRecordValuesByStatementId.values()) {
      appendRecordValue(recordValue, null);
    }
    for (const context of contextsByKey.values()) {
      for (const recordValue of context.definition.recordValues) appendRecordValue(recordValue, context);
    }

    const appendRecordMap = (
      value: import("../dsl/geometryArraySemantics").DslArrayMappedValue,
      valueId: string,
      context: InstanceContext | null
    ): void => {
      if (value.sourceElementType.kind !== "record" || value.resultElementType.kind !== "record") return;
      const body = context
        ? (context.definition.mappedRecordCollectionBodies ?? []).find((candidate) => candidate.binderId === value.binderId)
        : moduleSemanticAnalysis.mappedRecordCollectionBodies.find((candidate) => candidate.binderId === value.binderId);
      if (!body) return;
      const path = context?.path ?? [];
      const binderFields: ScalarProgramRecordField[] = body.binderFields.map((field) => {
        const fieldPath = field.fieldPath ?? [field.field];
        const bindingId = moduleRecordCollectionBinderFieldIdForPath(path, body.binderId, fieldPath);
        bindingsById.set(bindingId, {
          id: bindingId,
          kind: "typed",
          name: `${value.binder}.${field.fieldName}`,
          nameSpan: null,
          statementIndex: body.statementIndex,
          effectiveScopeId: context?.scopeId ?? baseScopeIndex.rootScopeId,
          visibility: { kind: "typed", scopeId: context?.scopeId ?? baseScopeIndex.rootScopeId },
          mutability: "const",
          declaredType: field.type,
          rank: Number.MAX_SAFE_INTEGER,
          resolutionMode: "preResolvedOnly"
        });
        return {
          recordStatementId: field.field.recordStatementId,
          fieldIndex: field.field.fieldIndex,
          type: field.type,
          bindingId,
          ...(fieldPath.length > 1 ? { fieldPath } : {})
        };
      });
      const fields = body.fields.map((field) => {
        const lowered = context
          ? lowerExpression(
              field.body,
              (target) => resolvedBindingForContext(target, context),
              bindingsById,
              (target) => resolvedGeometryPropertyForContext(target, context),
              (target) => collectionLengthForTargetContext(target, context),
              (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
              (id) => collectionValueIdFor(id, context),
              (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
              (target) => recordParameterCollectionForTargetContext(target, context)
            ).expression
          : lowerExpression(
              field.body,
              (target) => rootBindingForTarget(target, field.body.ast.span.start),
              bindingsById,
              rootGeometryPropertyFor,
              rootCollectionLengthFor,
              resolvedGeometryBuiltinForRoot,
              (id) => collectionValueIdFor(id, null),
              (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder
            ).expression;
        return {
          recordStatementId: field.field.recordStatementId,
          fieldIndex: field.field.fieldIndex,
          type: field.type,
          body: lowered,
          ...(field.fieldPath && field.fieldPath.length > 1 ? { fieldPath: field.fieldPath } : {})
        };
      });
      moduleCollectionValues.push({
        valueId,
        kind: "recordMap",
        sourceValueId: collectionValueIdFor(value.sourceValueId, context),
        sourceTypeIdentity: body.sourceTypeIdentity,
        resultTypeIdentity: body.resultTypeIdentity,
        binderId: moduleCollectionBinderIdFor(path, body.binderId),
        binderFields,
        fields,
        sourceOrder: context ? executionOrderForValue(context.path, value.sourceOrder) : executionPositionForValue([], value.sourceOrder)
      });
    };
    const appendRecordFieldProjection = (
      expression: ModuleScalarExpressionSemantic | null,
      context: InstanceContext | null
    ): void => {
      if (!expression) return;
      const recordValueFieldTarget = expression.references.find((candidate) =>
        candidate.target?.kind === "recordField" && candidate.target.record.kind === "recordValue"
      )?.target;
      if (recordValueFieldTarget?.kind === "recordField" &&
        recordValueFieldTarget.record.kind === "recordValue") {
        const selectedRecordStatementId = recordValueFieldTarget.record.statementId;
        const fieldPath = recordValueFieldTarget.fieldPath ?? [recordValueFieldTarget.field];
        const selectedRecordValue = context
          ? context.definition.recordValues.find((candidate) => candidate.value.statementId === selectedRecordStatementId)
          : moduleSemanticAnalysis.rootRecordValuesByStatementId.get(selectedRecordStatementId);
        const selectedCollectionIndex = selectedRecordValue?.valueExpression?.kind === "collectionIndex"
          ? selectedRecordValue.valueExpression.reference.target
          : null;
        if (selectedCollectionIndex?.kind === "recordCollectionIndex") {
          const sourceValueId = collectionValueIdFor(selectedCollectionIndex.collectionValueId, context);
          const field = fieldPath[fieldPath.length - 1]!;
          const valueId = recordFieldCollectionValueIdFor(sourceValueId, field, fieldPath);
          if (registeredRecordFieldProjectionIds.has(valueId)) return;
          registeredRecordFieldProjectionIds.add(valueId);
          moduleCollectionValues.push({
            valueId,
            kind: "recordField",
            sourceValueId,
            field: {
              recordStatementId: field.recordStatementId,
              fieldIndex: field.fieldIndex,
              type: expression.type!,
              ...(fieldPath.length > 1 ? { fieldPath } : {})
            },
            sourceOrder: context
              ? Math.max(0, Math.floor(executionPositionForValue(context.path, selectedCollectionIndex.targetSourceOrder)))
              : Math.max(0, Math.floor(executionPositionForValue([], selectedCollectionIndex.targetSourceOrder)))
          });
          return;
        }
        if (recordValueFieldTarget.record.valueExpressionKind !== "coalesce") return;
        const sourceValueId = collectionValueIdFor(
          recordValueCollectionIdFor([], recordValueFieldTarget.record.statementId),
          context
        );
        const field = fieldPath[fieldPath.length - 1]!;
        const valueId = recordFieldCollectionValueIdFor(sourceValueId, field, fieldPath);
        if (registeredRecordFieldProjectionIds.has(valueId)) return;
        registeredRecordFieldProjectionIds.add(valueId);
        moduleCollectionValues.push({
          valueId,
          kind: "recordField",
          sourceValueId,
          field: {
            recordStatementId: field.recordStatementId,
            fieldIndex: field.fieldIndex,
            type: expression.type!,
            ...(fieldPath.length > 1 ? { fieldPath } : {})
          },
          sourceOrder: context
            ? Math.max(0, Math.floor(executionPositionForValue(context.path, recordValueFieldTarget.record.statementIndex)))
            : Math.max(0, Math.floor(executionPositionForValue([], recordValueFieldTarget.record.statementIndex)))
        });
        return;
      }
      const recordCollectionTarget = expression.references.find((candidate) =>
        candidate.target?.kind === "recordField" && candidate.target.record.kind === "recordCollectionIndex"
      )?.target;
      if (recordCollectionTarget?.kind === "recordField" && recordCollectionTarget.record.kind === "recordCollectionIndex") {
        const fieldPath = recordCollectionTarget.fieldPath ?? [recordCollectionTarget.field];
        const requiredFieldType = dslRequiredValueTypeOf(recordCollectionTarget.valueType) ?? recordCollectionTarget.valueType;
        if (expression.ast.kind === "recordFieldCollectionIndex" && isDslArrayValueType(requiredFieldType)) {
          const recordCollection = recordCollectionTarget.record;
          const occurrence = recordCollection.index.ast;
          const contextAnalysis = context
            ? sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis
            : sourceNamespace?.geometryArraySemanticAnalysis;
          if (!contextAnalysis) return;
          const mappedValue = contextAnalysis.genericValuesByStatementId
            .get(recordCollectionTarget.record.collectionValueId)?.value;
          const mappedBody = mappedValue?.kind === "map" &&
            mappedValue.sourceElementType.kind === "record" &&
            mappedValue.resultElementType.kind === "record"
            ? context
              ? context.definition.mappedRecordCollectionBodies?.find((candidate) => candidate.binderId === mappedValue.binderId)
              : moduleSemanticAnalysis.mappedRecordCollectionBodies.find((candidate) => candidate.binderId === mappedValue.binderId)
            : undefined;
          const isMappedRecordArray = mappedValue?.kind === "map" && Boolean(mappedBody);
          const sourceCollectionId = collectionValueIdFor(recordCollectionTarget.record.collectionValueId, context);
          const indexReferenceSourceOrder = recordCollection.index.references.reduce((maximum, reference) => {
            const target = reference.target;
            return target && "statementIndex" in target
              ? Math.max(maximum, target.statementIndex)
              : maximum;
          }, -1);
          const selectorSourceBoundary = Math.max(recordCollection.targetSourceOrder, indexReferenceSourceOrder);
          const selectorSourceOrder = context
            ? executionOrderForValue(context.path, Math.max(0, selectorSourceBoundary + 1))
            : executionPositionForValue([], Math.max(0, selectorSourceBoundary));
          const appendSelectedContents = (index: number): string => {
            const listedRecord = recordCollection.members?.[index];
            const selectedRecord = listedRecord ?? (!isMappedRecordArray
              ? recordTargetForCollectionMember(recordCollection.collectionValueId, index, context)
              : null);
            const expectedValueId = listedRecord
              ? recordFieldContentsCollectionValueIdFor(
                  recordTargetValueIdFor(listedRecord, context) ?? "",
                  fieldPath
                )
              : indexedRecordFieldContentsCollectionValueIdFor(sourceCollectionId, index, fieldPath);

            if (isMappedRecordArray && mappedValue?.kind === "map" && mappedBody && context) {
              appendMappedRecordFieldContents(mappedValue, mappedBody, fieldPath, index, context);
            } else if (selectedRecord) {
              const selectedContentsValueId = appendCanonicalRecordFieldContentsForTarget(
                selectedRecord,
                fieldPath,
                context,
                contextAnalysis,
                selectedRecord?.kind === "recordValue"
                  ? selectedRecord.statementIndex
                  : selectorSourceOrder
              );
              if (selectedContentsValueId && expectedValueId !== selectedContentsValueId && !registeredRecordFieldContentsIds.has(expectedValueId)) {
                registeredRecordFieldContentsIds.add(expectedValueId);
                moduleCollectionValues.push({ valueId: expectedValueId, kind: "alias", targetValueId: selectedContentsValueId });
              }
            } else if (!registeredRecordFieldContentsIds.has(expectedValueId)) {
              registeredRecordFieldContentsIds.add(expectedValueId);
              moduleCollectionValues.push({ valueId: expectedValueId, kind: "none" });
            }
            return expectedValueId;
          };

          const memberCount = recordCollectionMemberCountFor(recordCollection.collectionValueId, context)
            ?? recordCollection.members?.length
            ?? null;
          if (occurrence.kind === "numberLiteral" && Number.isInteger(occurrence.value) && occurrence.value >= 0) {
            if (memberCount !== null && occurrence.value >= memberCount) {
              const valueId = indexedRecordFieldContentsCollectionValueIdFor(
                sourceCollectionId,
                occurrence.value,
                fieldPath
              );
              if (!registeredRecordFieldContentsIds.has(valueId)) {
                registeredRecordFieldContentsIds.add(valueId);
                moduleCollectionValues.push({ valueId, kind: "literal", members: [] });
              }
            } else {
              appendSelectedContents(occurrence.value);
            }
            return;
          }

          const selectorValueId = dynamicRecordFieldContentsCollectionValueIdFor(
            sourceCollectionId,
            occurrence.span,
            fieldPath
          );
          if (memberCount === null) {
            if (!registeredRecordFieldContentsIds.has(selectorValueId)) {
              registeredRecordFieldContentsIds.add(selectorValueId);
              moduleCollectionValues.push({ valueId: selectorValueId, kind: "none" });
            }
            return;
          }

          const memberContentsValueIds = Array.from({ length: memberCount }, (_, index) => appendSelectedContents(index));
          const noMatchValueId = `${selectorValueId}:no-match`;
          if (!registeredRecordFieldContentsIds.has(noMatchValueId)) {
            registeredRecordFieldContentsIds.add(noMatchValueId);
            moduleCollectionValues.push({ valueId: noMatchValueId, kind: "literal", members: [] });
          }
          if (memberCount === 0) {
            if (!registeredRecordFieldContentsIds.has(selectorValueId)) {
              registeredRecordFieldContentsIds.add(selectorValueId);
              moduleCollectionValues.push({ valueId: selectorValueId, kind: "literal", members: [] });
            }
            return;
          }
          const indexedExpression = context
            ? lowerExpression(
                recordCollectionTarget.record.index,
                (target) => resolvedBindingForContext(target, context),
                bindingsById,
                (target) => resolvedGeometryPropertyForContext(target, context),
                (target) => collectionLengthForTargetContext(target, context),
                (target) => resolvedGeometryBuiltinForContext(target, context),
                (valueId) => collectionValueIdFor(valueId, context),
                (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
                (target) => recordParameterCollectionForTargetContext(target, context)
              ).expression
            : lowerExpression(
                recordCollectionTarget.record.index,
                (target) => rootBindingForTarget(target, occurrence.span.start),
                bindingsById,
                rootGeometryPropertyFor,
                rootCollectionLengthFor,
                resolvedGeometryBuiltinForRoot,
                (valueId) => collectionValueIdFor(valueId, null),
                (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder
              ).expression;
          for (let index = memberCount - 1; index >= 0; index -= 1) {
            const valueId = index === 0 ? selectorValueId : `${selectorValueId}:else:${index}`;
            const elseValueId = index === memberCount - 1
              ? noMatchValueId
              : `${selectorValueId}:else:${index + 1}`;
            moduleCollectionValues.push({
              valueId,
              kind: "if",
              condition: {
                kind: "binary",
                span: occurrence.span,
                operator: "==",
                left: indexedExpression,
                right: { kind: "numberLiteral", span: occurrence.span, value: index, type: { kind: "number" } },
                type: { kind: "boolean" }
              },
              thenValueId: memberContentsValueIds[index]!,
              elseValueId,
              sourceOrder: selectorSourceOrder
            });
          }
          return;
        }
        if (context && isDslArrayValueType(requiredFieldType)) {
          const index = recordCollectionTarget.record.index.ast.kind === "numberLiteral"
            ? recordCollectionTarget.record.index.ast.value
            : null;
          const mappedValue = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis
            ?.genericValuesByStatementId.get(recordCollectionTarget.record.collectionValueId)?.value;
          const mappedBody = mappedValue?.kind === "map" &&
            mappedValue.sourceElementType.kind === "record" &&
            mappedValue.resultElementType.kind === "record"
            ? context.definition.mappedRecordCollectionBodies?.find((candidate) => candidate.binderId === mappedValue.binderId)
            : undefined;
          if (index !== null && Number.isInteger(index) && index >= 0 && mappedValue?.kind === "map" && mappedBody) {
            appendMappedRecordFieldContents(mappedValue, mappedBody, fieldPath, index, context);
            return;
          }
        }
        const sourceValueId = collectionValueIdFor(recordCollectionTarget.record.collectionValueId, context);
        const field = fieldPath[fieldPath.length - 1]!;
        const valueId = recordFieldCollectionValueIdFor(sourceValueId, field, fieldPath);
        if (registeredRecordFieldProjectionIds.has(valueId)) return;
        registeredRecordFieldProjectionIds.add(valueId);
        moduleCollectionValues.push({
          valueId,
          kind: "recordField",
          sourceValueId,
          field: {
            recordStatementId: field.recordStatementId,
            fieldIndex: field.fieldIndex,
            type: expression.type!,
            ...(fieldPath.length > 1 ? { fieldPath } : {})
          },
          sourceOrder: context
            ? Math.max(0, Math.floor(executionPositionForValue(context.path, recordCollectionTarget.record.targetSourceOrder)))
            : recordCollectionTarget.record.targetSourceOrder
        });
        return;
      }
      if (expression.ast.kind !== "collectionIndex") return;
      const reference = expression.references.find((candidate) => candidate.collectionValueId?.startsWith("record-field-collection:"));
      if (!reference?.collectionValueId) return;
      try {
        const encoded = JSON.parse(reference.collectionValueId.slice("record-field-collection:".length)) as unknown;
        const identity = recordFieldCollectionIdentityFor(encoded);
        if (!identity) return;
        const sourceValueId = collectionValueIdFor(identity.collectionValueId, context);
        const field = identity.fieldPath[identity.fieldPath.length - 1]!;
        const valueId = recordFieldCollectionValueIdFor(sourceValueId, field, identity.fieldPath);
        if (registeredRecordFieldProjectionIds.has(valueId)) return;
        registeredRecordFieldProjectionIds.add(valueId);
        moduleCollectionValues.push({
          valueId,
          kind: "recordField",
          sourceValueId,
          field: {
            recordStatementId: field.recordStatementId,
            fieldIndex: field.fieldIndex,
            type: expression.type!,
            ...(identity.fieldPath.length > 1 ? { fieldPath: identity.fieldPath } : {})
          },
          sourceOrder: context
            ? Math.max(0, Math.floor(executionPositionForValue(context.path, reference.targetSourceOrder ?? 0)))
            : reference.targetSourceOrder ?? 0
        });
      } catch {
        // The compiler only emits its own encoded projection IDs. Ignore a
        // malformed value defensively at this runtime boundary.
      }
    };
    const appendOptionalMemberProjection = (
      expression: ModuleScalarExpressionSemantic | null,
      context: InstanceContext | null
    ): void => {
      for (const optionalMember of expression?.optionalMembers ?? []) {
        const target = optionalMember.target;
        if (target?.kind !== "recordField" || target.property || !target.type) continue;
        const fieldPath = target.fieldPath ?? [target.field];
        let sourceValueId: string | null = null;
        let sourceOrder: number | null = null;
        if (target.record.kind === "recordValue") {
          sourceValueId = collectionValueIdFor(recordValueCollectionIdFor([], target.record.statementId), context);
          sourceOrder = context
            ? Math.max(0, Math.floor(executionPositionForValue(context.path, target.record.statementIndex)))
            : Math.max(0, Math.floor(executionPositionForValue([], target.record.statementIndex)));
        } else if (target.record.kind === "recordCollectionIndex") {
          sourceValueId = collectionValueIdFor(target.record.collectionValueId, context);
          sourceOrder = context
            ? Math.max(0, Math.floor(executionPositionForValue(context.path, target.record.targetSourceOrder)))
            : target.record.targetSourceOrder;
        } else if (target.record.kind === "recordParameter" && context) {
          const recordParameter = recordParameterCollectionForTargetContext(target, context);
          if (recordParameter) {
            sourceValueId = recordParameter.collectionValueId;
            sourceOrder = Math.max(0, Math.floor(recordParameter.targetSourceOrder));
          }
        }
        if (!sourceValueId || sourceOrder === null) continue;
        const field = fieldPath[fieldPath.length - 1]!;
        const valueId = recordFieldCollectionValueIdFor(sourceValueId, field, fieldPath);
        if (registeredRecordFieldProjectionIds.has(valueId)) continue;
        registeredRecordFieldProjectionIds.add(valueId);
        moduleCollectionValues.push({
          valueId,
          kind: "recordField",
          sourceValueId,
          field: {
            recordStatementId: field.recordStatementId,
            fieldIndex: field.fieldIndex,
            type: optionalMember.memberType!,
            ...(fieldPath.length > 1 ? { fieldPath } : {})
          },
          sourceOrder
        });
      }
    };
    const appendConditional = (
      value: import("../dsl/geometryArraySemantics").DslArraySemanticValue<import("../dsl/geometryArraySemanticAnalysis").GenericArraySourceTarget>,
      valueId: string,
      context: InstanceContext,
      contextAnalysis: GeometryArraySemanticAnalysis,
      sourceOrder: number,
      sourceOrderIsRuntimePosition = false
    ): void => {
      const collectionSourceOrder = sourceOrderIsRuntimePosition
        ? sourceOrder
        : executionPositionForValue(context.path, sourceOrder);
      if (value.kind === "if") {
        const thenValueId = `${valueId}:then`;
        const elseValueId = `${valueId}:else`;
        appendConditional(value.thenValue, thenValueId, context, contextAnalysis, sourceOrder, sourceOrderIsRuntimePosition);
        appendConditional(value.elseValue, elseValueId, context, contextAnalysis, sourceOrder, sourceOrderIsRuntimePosition);
        if (!value.condition) return;
        const condition = lowerExpression(
          value.condition,
          (target) => resolvedBindingForContext(target, context),
          bindingsById,
          (target) => resolvedGeometryPropertyForContext(target, context),
          (target) => collectionLengthForTargetContext(target, context),
          (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
          (id) => collectionValueIdFor(id, context),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
          (target) => recordParameterCollectionForTargetContext(target, context)
        ).expression;
        moduleCollectionValues.push({ valueId, kind: "if", condition, thenValueId, elseValueId, sourceOrder: collectionSourceOrder });
        return;
      }
      if (value.kind === "match") {
        const arms: { label: string; valueId: string; binderId?: string }[] = [];
        for (const arm of value.arms) {
          const armValueId = `${valueId}:arm:${arm.label}`;
          appendConditional(arm.value, armValueId, context, contextAnalysis, sourceOrder, sourceOrderIsRuntimePosition);
          arms.push({ label: arm.label, valueId: armValueId, ...(arm.binderId ? { binderId: arm.binderId } : {}) });
        }
        if (!value.scrutinee) return;
        const loweredScrutinee = lowerExpression(
          value.scrutinee,
          (target) => resolvedBindingForContext(target, context),
          bindingsById,
          (target) => resolvedGeometryPropertyForContext(target, context),
          (target) => collectionLengthForTargetContext(target, context),
          (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
          (id) => collectionValueIdFor(id, context),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
          (target) => recordParameterCollectionForTargetContext(target, context)
        ).expression;
        const matchBinderType = optionalCollectionMatchBinderType(loweredScrutinee);
        const scrutinee = remapTypedExpressionCollectionValueIds(
          optionalCollectionMatchPresenceProjection(loweredScrutinee),
          (id) => collectionValueIdFor(id, context)
        );
        if (matchBinderType?.kind === "collection") {
          for (const arm of arms) {
            if (arm.label === "some" && arm.binderId) {
              appendOptionalCollectionBinderAlias(arm.binderId, matchBinderType.collectionValueId, context);
            }
          }
        }
        moduleCollectionValues.push({
          valueId,
          kind: "match",
          scrutinee,
          arms: arms.map((arm) => collectionMatchArm(
            arm.label,
            arm.valueId,
            arm.binderId,
            loweredScrutinee,
            (binderId) => moduleCollectionBinderIdFor(context.path, binderId)
          )),
          sourceOrder: collectionSourceOrder
        });
        return;
      }
      if (value.kind === "coalesce") {
        const leftValueId = `${valueId}:left`;
        const rightValueId = `${valueId}:right`;
        appendConditional(value.left, leftValueId, context, contextAnalysis, sourceOrder, sourceOrderIsRuntimePosition);
        appendConditional(value.right, rightValueId, context, contextAnalysis, sourceOrder, sourceOrderIsRuntimePosition);
        moduleCollectionValues.push({
          valueId,
          kind: "coalesce",
          leftValueId,
          rightValueId,
          sourceOrder: collectionSourceOrder
        });
        return;
      }
      if (value.kind === "alias") {
        moduleCollectionValues.push({ valueId, kind: "alias", targetValueId: collectionValueIdFor(value.targetValueId, context) });
        return;
      }
      if (value.kind === "map") {
        if (value.sourceElementType.kind === "record" || value.resultElementType.kind === "record") {
          appendRecordMap(value, valueId, context);
          return;
        }
        if (!value.body) return;
        const runtimeBinderId = moduleCollectionBinderIdFor(context.path, value.binderId);
        moduleCollectionValues.push({ valueId, kind: "map", sourceValueId: collectionValueIdFor(value.sourceValueId, context), sourceElementType: value.sourceElementType, resultElementType: value.resultElementType, binderId: runtimeBinderId, body: value.body, sourceOrder: value.sourceOrder });
        return;
      }
      if (value.kind === "none") {
        moduleCollectionValues.push({ valueId, kind: "none" });
        return;
      }
      const elementType = scalarExpressionTypeOfDslValueType(value.valueType.elementType);
      if (value.valueType.elementType.kind === "record") {
        const members = value.members.flatMap((member) => {
          const record = recordCollectionMemberForTarget(member.target, value.valueType.elementType.kind === "record" ? value.valueType.elementType.identity ?? "" : "", context);
          return record ? [record] : [];
        });
        if (members.length === value.members.length) moduleCollectionValues.push({ valueId, kind: "literal", members });
        return;
      }
      if (!elementType) return;
      const members: ScalarProgramCollectionMember[] = [];
      for (const member of value.members) {
        const literal = scalarCollectionMemberFromLiteral(member.sourceText, elementType);
        if (literal) members.push(literal);
        else {
          const bindingId = scalarCollectionBindingForTarget(member.target, context);
          if (!bindingId) return;
          members.push({ kind: "binding", type: elementType, bindingId });
        }
      }
      moduleCollectionValues.push({ valueId, kind: "literal", members });
    };
    const registeredRecordFieldContentsIds = new Set<string>();
    const appendRecordFieldContentsForExpression = (
      expression: ModuleRecordValueExpressionSemantic,
      fieldPath: readonly RecordFieldIdentity[],
      valueId: string,
      context: InstanceContext,
      contextAnalysis: GeometryArraySemanticAnalysis,
      sourceOrder: number
    ): void => {
      if (registeredRecordFieldContentsIds.has(valueId)) return;
      registeredRecordFieldContentsIds.add(valueId);
      const appendNone = (id: string) => moduleCollectionValues.push({ valueId: id, kind: "none" });
      const lowerControlExpression = (semantic: ModuleScalarExpressionSemantic | null) => semantic
        ? lowerExpression(
            semantic,
            (target) => resolvedBindingForContext(target, context),
            bindingsById,
            (target) => resolvedGeometryPropertyForContext(target, context),
            (target) => collectionLengthForTargetContext(target, context),
            (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
            (id) => collectionValueIdFor(id, context),
            (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
            (target) => recordParameterCollectionForTargetContext(target, context)
          ).expression
        : null;

      if (expression.kind === "constructor") {
        const fieldValue = recordFieldValueExpressionAt(expression, fieldPath);
        if (fieldValue?.kind === "collection" && fieldValue.value) {
          appendConditional(fieldValue.value, valueId, context, contextAnalysis, sourceOrder);
        } else {
          appendNone(valueId);
        }
        return;
      }
      if (expression.kind === "reference") {
        const targetValueId = expression.reference.target
          ? recordTargetValueIdFor(expression.reference.target, context)
          : null;
        if (targetValueId) {
          moduleCollectionValues.push({
            valueId,
            kind: "alias",
            targetValueId: recordFieldContentsCollectionValueIdFor(targetValueId, fieldPath)
          });
        } else {
          appendNone(valueId);
        }
        return;
      }
      if (expression.kind === "collectionIndex") {
        const target = expression.reference.target;
        const index = target?.kind === "recordCollectionIndex" && target.index.ast.kind === "numberLiteral"
          ? target.index.ast.value
          : null;
        const selected = target?.kind === "recordCollectionIndex" && index !== null && Number.isInteger(index) && index >= 0
          ? target.members?.[index]
          : undefined;
        const targetValueId = selected ? recordTargetValueIdFor(selected, context) : null;
        if (targetValueId) {
          moduleCollectionValues.push({
            valueId,
            kind: "alias",
            targetValueId: recordFieldContentsCollectionValueIdFor(targetValueId, fieldPath)
          });
        } else {
          appendNone(valueId);
        }
        return;
      }
      if (expression.kind === "none") {
        appendNone(valueId);
        return;
      }
      if (expression.kind === "coalesce") {
        const leftValueId = `${valueId}:left`;
        const rightValueId = `${valueId}:right`;
        if (expression.left) appendRecordFieldContentsForExpression(expression.left, fieldPath, leftValueId, context, contextAnalysis, sourceOrder);
        else appendNone(leftValueId);
        if (expression.right) appendRecordFieldContentsForExpression(expression.right, fieldPath, rightValueId, context, contextAnalysis, sourceOrder);
        else appendNone(rightValueId);
        moduleCollectionValues.push({
          valueId,
          kind: "coalesce",
          leftValueId,
          rightValueId,
          sourceOrder: executionPositionForValue(context.path, sourceOrder)
        });
        return;
      }
      if (expression.kind === "if") {
        const thenValueId = `${valueId}:then`;
        const elseValueId = `${valueId}:else`;
        if (expression.thenBranch) appendRecordFieldContentsForExpression(expression.thenBranch, fieldPath, thenValueId, context, contextAnalysis, sourceOrder);
        else appendNone(thenValueId);
        if (expression.elseBranch) appendRecordFieldContentsForExpression(expression.elseBranch, fieldPath, elseValueId, context, contextAnalysis, sourceOrder);
        else appendNone(elseValueId);
        const condition = lowerControlExpression(expression.condition);
        if (condition) {
          moduleCollectionValues.push({
            valueId,
            kind: "if",
            condition,
            thenValueId,
            elseValueId,
            sourceOrder: executionPositionForValue(context.path, sourceOrder)
          });
        } else {
          appendNone(valueId);
        }
        return;
      }

      const arms: { label: string; valueId: string; binderId?: string }[] = [];
      for (const arm of expression.arms) {
        const armValueId = `${valueId}:arm:${arm.label}`;
        if (arm.expression) appendRecordFieldContentsForExpression(arm.expression, fieldPath, armValueId, context, contextAnalysis, sourceOrder);
        else appendNone(armValueId);
        const binderId = arm.label === "some" && arm.binder
          ? optionalMatchBinderId(expression.span.start, arm.labelSpan.start, arm.binderSpan?.start ?? arm.labelSpan.end)
          : undefined;
        arms.push({ label: arm.label, valueId: armValueId, ...(binderId ? { binderId } : {}) });
      }
      const loweredScrutinee = lowerControlExpression(expression.scrutinee);
      if (!loweredScrutinee) {
        appendNone(valueId);
        return;
      }
      const matchBinderType = optionalCollectionMatchBinderType(loweredScrutinee);
      const scrutinee = remapTypedExpressionCollectionValueIds(
        optionalCollectionMatchPresenceProjection(loweredScrutinee),
        (id) => collectionValueIdFor(id, context)
      );
      if (matchBinderType?.kind === "collection") {
        for (const arm of arms) {
          if (arm.label === "some" && arm.binderId) {
            appendOptionalCollectionBinderAlias(arm.binderId, matchBinderType.collectionValueId, context);
          }
        }
      }
      moduleCollectionValues.push({
        valueId,
        kind: "match",
        scrutinee,
        arms: arms.map((arm) => collectionMatchArm(
          arm.label,
          arm.valueId,
          arm.binderId,
          loweredScrutinee,
          (binderId) => moduleCollectionBinderIdFor(context.path, binderId)
        )),
        sourceOrder: executionPositionForValue(context.path, sourceOrder)
      });
    };

    for (const context of contextsByKey.values()) {
      const contextAnalysis = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis;
      const recordAnalysis = sourceNamespaceForContext(context)?.recordSemanticAnalysis;
      if (!contextAnalysis || !recordAnalysis) continue;
      for (const recordValue of context.definition.recordValues) {
        const typeIdentity = recordValue.value.typeIdentity;
        const expression = recordValue.valueExpression;
        const definition = typeIdentity ? recordAnalysis.definitionsByStatementId.get(typeIdentity) : undefined;
        if (!definition) continue;
        const recordValueId = recordValueCollectionIdFor(context.path, recordValue.value.statementId);
        for (const { path: fieldPath, valueType } of recordFieldPathsFor(definition, recordAnalysis)) {
          const requiredType = dslRequiredValueTypeOf(valueType) ?? valueType;
          if (!isDslArrayValueType(requiredType)) continue;
          const valueId = recordFieldContentsCollectionValueIdFor(recordValueId, fieldPath);
          if (expression) {
            appendRecordFieldContentsForExpression(
              expression,
              fieldPath,
              valueId,
              context,
              contextAnalysis,
              recordValue.value.statementIndex
            );
          } else {
            const targetValueId = recordValue.target
              ? recordTargetValueIdFor(recordValue.target, context)
              : null;
            if (targetValueId) {
              moduleCollectionValues.push({
                valueId,
                kind: "alias",
                targetValueId: recordFieldContentsCollectionValueIdFor(targetValueId, fieldPath)
              });
            } else {
              moduleCollectionValues.push({ valueId, kind: "none" });
            }
          }
        }
      }
    }

    for (const context of contextsByKey.values()) {
      const contextAnalysis = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis;
      const recordAnalysis = sourceNamespaceForContext(context)?.recordSemanticAnalysis;
      if (!contextAnalysis || !recordAnalysis) continue;
      for (const parameter of context.definition.parameters) {
        const recordParameter = recordAnalysis.moduleParameters.find((candidate) =>
          candidate.definitionStatementId === context.definition.statementId && candidate.parameterIndex === parameter.parameterIndex
        );
        const definition = recordParameter?.typeIdentity
          ? recordAnalysis.definitionsByStatementId.get(recordParameter.typeIdentity)
          : undefined;
        const binding = context.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
        if (!definition || binding?.value?.kind !== "record") continue;
        const valueId = moduleRecordParameterCollectionValueIdFor(
          context.path,
          parameter.definitionStatementId,
          parameter.parameterIndex
        );
        const reference = binding.value.reference;
        for (const { path: fieldPath, valueType } of recordFieldPathsFor(definition, recordAnalysis)) {
          const requiredType = dslRequiredValueTypeOf(valueType) ?? valueType;
          if (!isDslArrayValueType(requiredType)) continue;
          const fieldValueId = recordFieldContentsCollectionValueIdFor(valueId, fieldPath);
          if (reference.target) {
            const targetValueId = recordTargetValueIdFor(reference.target, context);
            moduleCollectionValues.push(targetValueId
              ? {
                  valueId: fieldValueId,
                  kind: "alias",
                  targetValueId: recordFieldContentsCollectionValueIdFor(targetValueId, fieldPath)
                }
              : { valueId: fieldValueId, kind: "none" });
          } else if (reference.constructor) {
            appendRecordFieldContentsForExpression({
              kind: "constructor",
              span: reference.span,
              constructor: reference.constructor
            }, fieldPath, fieldValueId, context, contextAnalysis, context.instance.statementIndex);
          } else {
            moduleCollectionValues.push({ valueId: fieldValueId, kind: "none" });
          }
        }
      }
    }

    for (const context of contextsByKey.values()) {
    const contextAnalysis = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis;
    if (!contextAnalysis) continue;
    for (const value of contextAnalysis.genericValues) {
      if (value.ownerModuleDefinitionStatementIndex !== context.definition.statementIndex || !value.value) continue;
      const valueId = moduleCollectionValueIdFor(context.path, value.statementId);
      if (value.value.kind === "if" || value.value.kind === "match") {
        appendConditional(value.value, valueId, context, contextAnalysis, value.statementIndex);
        continue;
      }
      if (value.value.kind === "map") {
        if (value.value.sourceElementType.kind === "record" || value.value.resultElementType.kind === "record") {
          appendRecordMap(value.value, valueId, context);
          continue;
        }
        const runtimeBinderId = moduleCollectionBinderIdFor(context.path, value.value.binderId);
        bindingsById.set(runtimeBinderId, valueForBinderBindingFor({
          kind: "valueForBinder",
          binderId: value.value.binderId,
          statementId: value.statementId,
          statementIndex: value.statementIndex,
          name: value.value.binder,
          sourceElementType: value.value.sourceElementType
        }, context));
        const bodySemantic = context.definition.mappedScalarCollectionBodies.find((candidate) => candidate.statementId === value.statementId)?.body;
        if (!bodySemantic) continue;
        const loweredBody = lowerExpression(
          bodySemantic,
          (target) => resolvedBindingForContext(target, context),
          bindingsById,
          (target) => resolvedGeometryPropertyForContext(target, context),
          (target) => collectionLengthForTargetContext(target, context),
          (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
          (valueId) => collectionValueIdFor(valueId, context),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
          (target) => recordParameterCollectionForTargetContext(target, context)
        );
        moduleCollectionValues.push({
          valueId,
          kind: "map",
          sourceValueId: collectionValueIdFor(value.value.sourceValueId, context),
          sourceElementType: value.value.sourceElementType,
          resultElementType: value.value.resultElementType,
          binderId: runtimeBinderId,
          body: loweredBody.expression,
          sourceOrder: value.value.sourceOrder
        });
        continue;
      }
      if (value.value.kind === "alias") {
        moduleCollectionValues.push({ valueId, kind: "alias", targetValueId: collectionValueIdFor(value.value.targetValueId, context) });
        continue;
      }
      if (value.value.kind === "coalesce") {
        const leftValueId = `${valueId}:left`;
        const rightValueId = `${valueId}:right`;
        appendConditional(value.value.left, leftValueId, context, contextAnalysis, value.statementIndex);
        appendConditional(value.value.right, rightValueId, context, contextAnalysis, value.statementIndex);
        moduleCollectionValues.push({ valueId, kind: "coalesce", leftValueId, rightValueId, sourceOrder: executionPositionForValue(context.path, value.statementIndex) });
        continue;
      }
      if (value.value.kind === "none") {
        moduleCollectionValues.push({ valueId, kind: "none" });
        continue;
      }
      const elementType = scalarExpressionTypeOfDslValueType(value.valueType.elementType);
      if (value.valueType.elementType.kind === "record") {
        const members = value.value.members.flatMap((member) => {
          const record = recordCollectionMemberForTarget(member.target, value.valueType.elementType.kind === "record" ? value.valueType.elementType.identity ?? "" : "", context);
          return record ? [record] : [];
        });
        if (members.length === value.value.members.length) moduleCollectionValues.push({ valueId, kind: "literal", members });
        continue;
      }
      if (!elementType) continue;
      const members: ScalarProgramCollectionMember[] = [];
      for (const member of value.value.members) {
        const literal = scalarCollectionMemberFromLiteral(member.sourceText, elementType);
        if (literal) {
          members.push(literal);
          continue;
        }
        const bindingId = scalarCollectionBindingForTarget(member.target, context);
        if (!bindingId) break;
        members.push({ kind: "binding", type: elementType, bindingId });
      }
      if (members.length === value.value.members.length) moduleCollectionValues.push({ valueId, kind: "literal", members });
    }
    for (const parameter of contextAnalysis.genericModuleParameters.filter((candidate) => candidate.definitionStatementId === context.definition.statementId)) {
      const binding = context.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      const valueId = moduleCollectionValueIdFor(context.path, `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`);
      if (binding?.value?.kind === "collection") {
        moduleCollectionValues.push({
          valueId,
          kind: "alias",
          targetValueId: collectionValueIdFor(binding.value.targetValueId, context.parentKey ? contextsByKey.get(context.parentKey) ?? null : null)
        });
      } else if (binding?.value?.kind === "collectionLiteral") {
        const callerContext = context.parentKey ? contextsByKey.get(context.parentKey) ?? null : null;
        const literal = binding.value.value;
        if (literal.valueType.elementType.kind === "record") {
          const members = literal.members.flatMap((member) => {
            const record = recordCollectionMemberForTarget(member.target, literal.valueType.elementType.kind === "record" ? literal.valueType.elementType.identity ?? "" : "", callerContext);
            return record ? [record] : [];
          });
          if (members.length === literal.members.length) moduleCollectionValues.push({ valueId, kind: "literal", members });
          continue;
        }
        const elementType = scalarExpressionTypeOfDslValueType(literal.valueType.elementType);
        if (elementType) {
          const members: ScalarProgramCollectionMember[] = [];
          for (const member of literal.members) {
            const scalarLiteral = scalarCollectionMemberFromLiteral(member.sourceText, elementType);
            if (scalarLiteral) {
              members.push(scalarLiteral);
              continue;
            }
            const bindingId = scalarCollectionBindingForTarget(member.target, callerContext);
            if (!bindingId) break;
            members.push({ kind: "binding", type: elementType, bindingId });
          }
          if (members.length === literal.members.length) moduleCollectionValues.push({ valueId, kind: "literal", members });
        }
      } else {
        // An omitted or explicit-none optional collection is the ordinary
        // shared none value, not a missing alias target.
        moduleCollectionValues.push({ valueId, kind: "none" });
      }
    }
    for (const recordValue of context.definition.recordValues) {
      for (const field of recordValue.fieldExpressions) {
        appendRecordFieldProjection(field.expression, context);
        appendOptionalMemberProjection(field.expression, context);
      }
    }
    for (const body of context.definition.bodyStatements) {
      for (const site of body.scalarExpressions) {
        appendRecordFieldProjection(site.expression, context);
        appendOptionalMemberProjection(site.expression, context);
      }
    }
    }
    const appendRootConditional = (
      value: import("../dsl/geometryArraySemantics").DslArraySemanticValue<import("../dsl/geometryArraySemanticAnalysis").GenericArraySourceTarget>,
      valueId: string,
      sourceOrder: number
    ): void => {
      if (value.kind === "if") {
        const thenValueId = `${valueId}:then`;
        const elseValueId = `${valueId}:else`;
        appendRootConditional(value.thenValue, thenValueId, sourceOrder);
        appendRootConditional(value.elseValue, elseValueId, sourceOrder);
        if (!value.condition) return;
        const condition = lowerExpression(
          value.condition,
          (target) => rootBindingForTarget(target, value.condition?.ast.span.start ?? sourceOrder),
          bindingsById,
          rootGeometryPropertyFor,
          rootCollectionLengthFor,
          resolvedGeometryBuiltinForRoot,
          (id) => collectionValueIdFor(id, null),
          (order) => order
        ).expression;
        moduleCollectionValues.push({ valueId, kind: "if", condition, thenValueId, elseValueId, sourceOrder });
        return;
      }
      if (value.kind === "match") {
        const arms = value.arms.map((arm) => {
          const armValueId = `${valueId}:arm:${arm.label}`;
          appendRootConditional(arm.value, armValueId, sourceOrder);
          return { label: arm.label, valueId: armValueId, ...(arm.binderId ? { binderId: arm.binderId } : {}) };
        });
        if (!value.scrutinee) return;
        const scrutinee = lowerExpression(
          value.scrutinee,
          (target) => rootBindingForTarget(target, value.scrutinee?.ast.span.start ?? sourceOrder),
          bindingsById,
          rootGeometryPropertyFor,
          rootCollectionLengthFor,
          resolvedGeometryBuiltinForRoot,
          (id) => collectionValueIdFor(id, null),
          (order) => order
        ).expression;
        moduleCollectionValues.push({
          valueId,
          kind: "match",
          scrutinee,
          arms: arms.map((arm) => collectionMatchArm(arm.label, arm.valueId, arm.binderId, scrutinee)),
          sourceOrder
        });
        return;
      }
      if (value.kind === "coalesce") {
        const leftValueId = `${valueId}:left`;
        const rightValueId = `${valueId}:right`;
        appendRootConditional(value.left, leftValueId, sourceOrder);
        appendRootConditional(value.right, rightValueId, sourceOrder);
        moduleCollectionValues.push({ valueId, kind: "coalesce", leftValueId, rightValueId, sourceOrder });
        return;
      }
      if (value.kind === "map") {
        appendRecordMap(value, valueId, null);
        return;
      }
      if (value.kind === "alias") {
        moduleCollectionValues.push({ valueId, kind: "alias", targetValueId: collectionValueIdFor(value.targetValueId, null) });
        return;
      }
      if (value.kind === "none") {
        moduleCollectionValues.push({ valueId, kind: "none" });
        return;
      }
      if (value.valueType.elementType.kind === "record") {
        const members = value.members.flatMap((member) => {
          const record = recordCollectionMemberForTarget(member.target, value.valueType.elementType.kind === "record" ? value.valueType.elementType.identity ?? "" : "", null);
          return record ? [record] : [];
        });
        if (members.length === value.members.length) moduleCollectionValues.push({ valueId, kind: "literal", members });
        return;
      }
      const elementType = scalarExpressionTypeOfDslValueType(value.valueType.elementType);
      if (!elementType) return;
      const members: ScalarProgramCollectionMember[] = [];
      for (const member of value.members) {
        const literal = scalarCollectionMemberFromLiteral(member.sourceText, elementType);
        if (literal) members.push(literal);
        else {
          const bindingId = scalarCollectionBindingForTarget(member.target, null);
          if (!bindingId) return;
          members.push({ kind: "binding", type: elementType, bindingId });
        }
      }
      moduleCollectionValues.push({ valueId, kind: "literal", members });
    };
    // Root nominal-record collections use the same lazy descriptors as Module
    // instances. Scalar root collections remain owned by documentScalarProgram.
    for (const value of sourceNamespace?.geometryArraySemanticAnalysis?.genericValues ?? []) {
      if (value.ownerModuleDefinitionStatementIndex !== null || !value.value) continue;
      const valueId = value.statementId;
      // Root scalar collections are already owned by documentScalarProgram;
      // only nominal-record collections need the module runtime projection.
      if (value.value.kind === "none") continue;
      if (value.value.kind === "if" || value.value.kind === "match") {
        if (value.valueType.elementType.kind === "record") {
          appendRootConditional(value.value, valueId, value.statementIndex);
        }
        continue;
      }
      if (value.value.kind === "map" && value.value.sourceElementType.kind === "record") {
        appendRecordMap(value.value, valueId, null);
        continue;
      }
      if (value.valueType.elementType.kind !== "record") continue;
      if (value.value.kind === "alias") {
        moduleCollectionValues.push({ valueId, kind: "alias", targetValueId: collectionValueIdFor(value.value.targetValueId, null) });
        continue;
      }
      if (value.value.kind !== "literal") continue;
      const members = value.value.members.flatMap((member) => {
        const record = recordCollectionMemberForTarget(member.target, value.valueType.elementType.kind === "record" ? value.valueType.elementType.identity ?? "" : "", null);
        return record ? [record] : [];
      });
      if (members.length === value.value.members.length) moduleCollectionValues.push({ valueId, kind: "literal", members });
    }
    for (const recordValue of moduleSemanticAnalysis.rootRecordValuesByStatementId.values()) {
      for (const field of recordValue.fieldExpressions) {
        appendRecordFieldProjection(field.expression, null);
        appendOptionalMemberProjection(field.expression, null);
      }
    }
    for (const site of moduleSemanticAnalysis.rootScalarExpressionsByStatementId.values()) {
      appendRecordFieldProjection(site.expression, null);
      appendOptionalMemberProjection(site.expression, null);
    }
    for (const sites of moduleSemanticAnalysis.rootElementScalarExpressionsByStatementId.values()) {
      for (const site of sites) appendOptionalMemberProjection(site.expression, null);
    }

    const appendOptionalCollectionMatchAliases = (
      semantic: ModuleScalarExpressionSemantic | null | undefined,
      context: InstanceContext | null
    ): void => {
      if (!semantic) return;
      const visit = (node: ModuleScalarExpressionSemantic["ast"]): void => {
        if (node.kind === "valueMatch") {
          const match = node.scrutinee.kind === "reference"
            ? semantic.references.find((reference) => reference.span.start === node.scrutinee.span.start)?.optionalCollectionMatch
            : undefined;
          if (match) {
            for (const arm of node.arms) {
              if (arm.label !== "some" || !arm.binder) continue;
              const binderId = optionalMatchBinderId(
                node.span.start,
                arm.labelSpan.start,
                arm.binderSpan?.start ?? arm.labelSpan.end
              );
              appendOptionalCollectionBinderAlias(binderId, match.collectionValueId, context);
            }
          }
          visit(node.scrutinee);
          node.arms.forEach((arm) => visit(arm.expression));
          return;
        }
        if (node.kind === "collectionIndex") return visit(node.index);
        if (node.kind === "geometryProperty") {
          if (node.occurrenceIndex) visit(node.occurrenceIndex);
          return;
        }
        if (node.kind === "optionalMember") return;
        if (node.kind === "unary") return visit(node.operand);
        if (node.kind === "binary") { visit(node.left); visit(node.right); return; }
        if (node.kind === "group") return visit(node.expression);
        if (node.kind === "valueIf") {
          visit(node.condition);
          visit(node.thenBranch);
          if (node.elseBranch) visit(node.elseBranch);
          return;
        }
        if (node.kind === "call") node.args.forEach((argument) => visit(argument.expression));
      };
      visit(semantic.ast);
    };
    for (const context of contextsByKey.values()) {
      for (const parameter of context.definition.parameters) {
        appendOptionalCollectionMatchAliases(parameter.defaultExpression, context);
      }
      for (const local of context.definition.localScalars) {
        appendOptionalCollectionMatchAliases(local.initializer, context);
      }
      for (const body of context.definition.bodyStatements) {
        body.scalarExpressions.forEach((site) => appendOptionalCollectionMatchAliases(site.expression, context));
      }
      for (const mapped of context.definition.mappedScalarCollectionBodies) {
        appendOptionalCollectionMatchAliases(mapped.body, context);
      }
      for (const mapped of context.definition.mappedRecordCollectionBodies ?? []) {
        mapped.fields.forEach((field) => appendOptionalCollectionMatchAliases(field.body, context));
      }
      for (const carry of context.definition.immutableCarries ?? []) {
        appendOptionalCollectionMatchAliases(carry.initializer, context);
        appendOptionalCollectionMatchAliases(carry.next, context);
      }
      for (const recordValue of context.definition.recordValues) {
        recordValue.fieldExpressions.forEach((field) => appendOptionalCollectionMatchAliases(field.expression, context));
      }
    }

    const collectionCarryValueById = new Map(collectionCarryValues.map((value) => [value.valueId, value] as const));
    const collectionCarrySemanticValueById = new Map(
      collectionCarrySemanticValues.flatMap((value) => value.value && value.ownerModuleDefinitionStatementIndex !== null
        ? [[value.statementId, value] as const]
        : [])
    );
    const registeredCollectionCarryValueIds = new Set(
      (documentScalarProgram?.collectionValues ?? []).map((value) => value.valueId)
    );
    const moduleCollectionCarryBindingIdFor = (bindingId: BindingId, context: InstanceContext): BindingId | null => {
      if (!bindingId.startsWith("binding:")) return null;
      const sourceStatementId = bindingId.slice("binding:".length);
      const local = context.definition.localScalars.find((candidate) => candidate.statementId === sourceStatementId);
      if (local) return moduleScalarBindingIdFor(context.path, context.definition.statementId, local.statementId);

      const sourceCarry = sourceNamespaceForContext(context)?.allDeclarations.find((declaration) =>
        declaration.kind === "carry" && `binding:${declaration.statementId}` === bindingId
      );
      if (!sourceCarry || sourceCarry.statement.kind !== "element") return null;
      const carryIndex = sourceCarry.statement.forCarries?.findIndex((candidate) => candidate.name === sourceCarry.name) ?? -1;
      const ownerStatementId = context.definition.bodyStatements.find((body) => body.statementIndex === sourceCarry.statementIndex)?.statementId;
      const semanticCarry = context.definition.immutableCarries?.find((candidate) =>
        candidate.statementId === ownerStatementId && candidate.carryIndex === carryIndex
      );
      return semanticCarry ? moduleCarryBindingIdFor(context.path, semanticCarry.bindingId) : null;
    };
    const projectCollectionCarryValue = (
      value: ScalarProgramCollection,
      context: InstanceContext
    ): ScalarProgramCollection | null => {
      const valueId = collectionValueIdFor(value.valueId, context);
      if (value.kind === "alias") {
        return { ...value, valueId, targetValueId: collectionValueIdFor(value.targetValueId, context) };
      }
      if (value.kind === "literal") {
        const members: ScalarProgramCollectionMember[] = [];
        for (const member of value.members) {
          if (member.kind === "literal") {
            members.push(member);
            continue;
          }
          if (member.kind !== "binding") return null;
          const bindingId = moduleCollectionCarryBindingIdFor(member.bindingId, context);
          if (!bindingId) return null;
          members.push({ ...member, bindingId });
        }
        return { ...value, valueId, members };
      }
      return null;
    };
    for (const context of contextsByKey.values()) {
      const bodyStatementIds = new Set(context.definition.bodyStatements.map((body) => body.statementId));
      for (const carry of collectionCarryInputs) {
        if (!bodyStatementIds.has(carry.ownerStatementId)) continue;
        for (const sourceValueId of [carry.initializerValueId, carry.nextValueId]) {
          const semanticValue = collectionCarrySemanticValueById.get(sourceValueId);
          if (semanticValue?.value) {
            const contextAnalysis = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis;
            const valueId = collectionValueIdFor(sourceValueId, context);
            if (contextAnalysis && !registeredCollectionCarryValueIds.has(valueId)) {
              appendConditional(
                semanticValue.value,
                valueId,
                context,
                contextAnalysis,
                executionOrderForValue(context.path, semanticValue.statementIndex),
                true
              );
              registeredCollectionCarryValueIds.add(valueId);
            }
            continue;
          }
          const sourceValue = collectionCarryValueById.get(sourceValueId);
          if (!sourceValue) continue;
          const projected = projectCollectionCarryValue(sourceValue, context);
          if (!projected || registeredCollectionCarryValueIds.has(projected.valueId)) continue;
          registeredCollectionCarryValueIds.add(projected.valueId);
          moduleCollectionValues.push(projected);
        }
      }
    }
    return moduleCollectionValues;
  };
  const foreignCollectionValues: ScalarProgramCollection[] = [];
  for (const foreign of foreignSourceScalars.values()) {
    const collectionAnalysis = foreign.sourceNamespace.geometryArraySemanticAnalysis;
    if (!collectionAnalysis) continue;
    const foreignValueIdFor = (valueId: string) =>
      collectionAnalysis.genericValuesByStatementId.has(valueId)
        ? `module-document-collection:${encodeIdentityTuple([String(foreign.documentId), valueId])}`
        : valueId;
    const foreignBindingForTarget = (target: ModuleScalarSourceTarget): Binding | undefined => {
      const localBindingId = target.kind === "documentBinding"
          ? target.bindingId
          : target.kind === "moduleLocal" || target.kind === "iteration"
            ? foreign.analysis.bindingAnalysis.catalog.bindings.find((candidate) =>
              candidate.kind === "typed" && candidate.statementIndex === target.statementIndex &&
              (target.kind === "moduleLocal" || candidate.name === target.name)
            )?.id
          : undefined;
      const runtimeBindingId = localBindingId ? foreign.bindingIdByLocalId.get(localBindingId) : undefined;
      return runtimeBindingId ? bindingsById.get(runtimeBindingId) : undefined;
    };
    const foreignSourceOrderFor = (statementIndex: number): number => {
      const candidates = foreign.analysis.bindingAnalysis.catalog.bindings
        .filter((candidate) => candidate.kind === "typed")
        .sort((left, right) => left.statementIndex - right.statementIndex);
      const candidate = candidates.find((entry) => entry.statementIndex >= statementIndex) ?? candidates.at(-1);
      const runtimeBindingId = candidate ? foreign.bindingIdByLocalId.get(candidate.id) : undefined;
      return runtimeBindingId === undefined
        ? statementIndex
        : eventOrderByBindingId.get(runtimeBindingId) ?? statementIndex;
    };
    const appendForeignValue = (
      value: import("../dsl/geometryArraySemantics").DslArraySemanticValue<import("../dsl/geometryArraySemanticAnalysis").GenericArraySourceTarget>,
      valueId: string,
      sourceOrder: number
    ): void => {
      if (value.kind === "if") {
        appendForeignValue(value.thenValue, `${valueId}:then`, sourceOrder);
        appendForeignValue(value.elseValue, `${valueId}:else`, sourceOrder);
        if (!value.condition) return;
        const condition = lowerExpression(
          value.condition,
          (target) => foreignBindingForTarget(target),
          bindingsById,
          undefined,
          (target) => target.kind === "collectionValueLength"
            ? target.length ?? collectionLengthForValueId(collectionAnalysis, target.valueId) ?? undefined
            : undefined,
          undefined,
          foreignValueIdFor,
          foreignSourceOrderFor
        ).expression;
        foreignCollectionValues.push({ valueId, kind: "if", condition, thenValueId: `${valueId}:then`, elseValueId: `${valueId}:else`, sourceOrder: foreignSourceOrderFor(sourceOrder) });
        return;
      }
      if (value.kind === "match") {
        const arms: { label: string; valueId: string; binderId?: string }[] = [];
        for (const arm of value.arms) {
          const armValueId = `${valueId}:arm:${arm.label}`;
          appendForeignValue(arm.value, armValueId, sourceOrder);
          arms.push({
            label: arm.label,
            valueId: armValueId,
            ...(arm.binderId ? { binderId: `module-document-collection-binder:${encodeIdentityTuple([String(foreign.documentId), arm.binderId])}` } : {})
          });
        }
        if (!value.scrutinee) return;
        const scrutinee = lowerExpression(
          value.scrutinee,
          (target) => foreignBindingForTarget(target),
          bindingsById,
          undefined,
          (target) => target.kind === "collectionValueLength"
            ? target.length ?? collectionLengthForValueId(collectionAnalysis, target.valueId) ?? undefined
            : undefined,
          undefined,
          foreignValueIdFor,
          foreignSourceOrderFor
        ).expression;
        foreignCollectionValues.push({
          valueId,
          kind: "match",
          scrutinee,
          arms: arms.map((arm) => collectionMatchArm(arm.label, arm.valueId, arm.binderId, scrutinee)),
          sourceOrder: foreignSourceOrderFor(sourceOrder)
        });
        return;
      }
      if (value.kind === "map") {
        if (value.sourceElementType.kind === "record" || value.resultElementType.kind === "record") return;
        if (!value.body) return;
        const bindingIdByLocalId = new Map<BindingId, BindingId>(foreign.bindingIdByLocalId);
        const runtimeBinderId = `module-document-collection-binder:${encodeIdentityTuple([String(foreign.documentId), value.binderId])}`;
        bindingIdByLocalId.set(value.binderId, runtimeBinderId);
        foreignCollectionValues.push({
          valueId,
          kind: "map",
          sourceValueId: foreignValueIdFor(value.sourceValueId),
          sourceElementType: value.sourceElementType,
          resultElementType: value.resultElementType,
          binderId: runtimeBinderId,
          body: remapTypedExpressionBindingIds(value.body, bindingIdByLocalId),
          sourceOrder: value.sourceOrder
        });
        return;
      }
      if (value.kind === "alias") {
        foreignCollectionValues.push({ valueId, kind: "alias", targetValueId: foreignValueIdFor(value.targetValueId) });
        return;
      }
      if (value.kind === "coalesce") {
        const leftValueId = `${valueId}:left`;
        const rightValueId = `${valueId}:right`;
        appendForeignValue(value.left, leftValueId, sourceOrder);
        appendForeignValue(value.right, rightValueId, sourceOrder);
        foreignCollectionValues.push({ valueId, kind: "coalesce", leftValueId, rightValueId, sourceOrder: foreignSourceOrderFor(sourceOrder) });
        return;
      }
      if (value.kind === "none") {
        foreignCollectionValues.push({ valueId, kind: "none" });
        return;
      }
      const elementType = scalarExpressionTypeOfDslValueType(value.valueType.elementType);
      if (!elementType) return;
      const members: ScalarProgramCollectionMember[] = [];
      for (const member of value.members) {
        const literal = scalarCollectionMemberFromLiteral(member.sourceText, elementType);
        if (literal) {
          members.push(literal);
          continue;
        }
        const target = member.target;
        if (target.kind === "scalarBinding") {
          members.push({
            kind: "binding",
            type: elementType,
            bindingId: `module-document-collection-binder:${encodeIdentityTuple([String(foreign.documentId), target.bindingId])}`
          });
          continue;
        }
        if (target.kind !== "scalarValue") return;
        const binding = foreign.analysis.bindingAnalysis.catalog.bindings.find((candidate) =>
          candidate.kind === "typed" && candidate.statementIndex === target.statementIndex
        );
        const bindingId = binding ? foreign.bindingIdByLocalId.get(binding.id) : undefined;
        if (!bindingId) return;
        members.push({ kind: "binding", type: elementType, bindingId });
      }
      foreignCollectionValues.push({ valueId, kind: "literal", members });
    };
    for (const value of collectionAnalysis.genericValues) {
      if (value.ownerModuleDefinitionStatementIndex !== null || !value.value) continue;
      appendForeignValue(value.value, foreignValueIdFor(value.statementId), value.statementIndex);
    }
  }
  const executionPositionForValue = (path: readonly string[], statementIndex: number): number => {
    if (path.length === 0) {
      const exact = eventOrderByStatementIndex.get(statementIndex);
      if (exact !== undefined) return exact;
      const next = [...eventOrderByStatementIndex.entries()]
        .filter(([candidate]) => candidate > statementIndex)
        .sort((left, right) => left[0] - right[0])[0];
      if (next) return Math.max(0, next[1] - 0.5);
      const previous = [...eventOrderByStatementIndex.entries()]
        .filter(([candidate]) => candidate < statementIndex)
        .sort((left, right) => right[0] - left[0])[0];
      return Math.max(0, previous ? previous[1] + 0.5 : statementIndex);
    }
    const candidates = moduleMaterialization.executionStatements
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        const entryPath = entry.runtimeInstancePath ?? entry.instancePath;
        return entryPath.length === path.length && entryPath.every((part, index) => part === path[index]);
      });
    const first = candidates.find(({ entry }) => entry.sourceStatementIndex >= statementIndex) ?? candidates.at(-1);
    const base = first?.index ?? 0;
    const context = contextsByKey.get(pathKey(path));
    const priorScalarEvents = context
      ? [
          ...[...context.parameters.values()].map((parameter) => eventOrderByBindingId.get(parameter.id)),
          ...context.definition.bodyStatements
            .filter((body) => body.statementIndex < statementIndex)
            .map((body) => eventOrderByStatementIndex.get(body.statementIndex))
        ].filter((order): order is number => order !== undefined)
      : [];
    const statementFraction = statementIndex / Math.max(1_000_000, statements.length + 1);
    const firstAvailableAfterScalars = priorScalarEvents.length > 0
      ? Math.max(...priorScalarEvents) + 0.5 + statementFraction
      : base + statementFraction;
    return Math.max(
      base + statementFraction,
      firstAvailableAfterScalars
    );
  };
  const executionOrderForValue = (path: readonly string[], statementIndex: number): number => {
    const context = contextsByKey.get(pathKey(path));
    const pathEvents = eventOrderByPathAndStatementIndex.get(pathKey(path));
    const priorParameterEvents = context
      ? [
          ...[...context.parameters.values()].map((parameter) => eventOrderByBindingId.get(parameter.id)),
          ...[...context.recordParameters.values()].flatMap((fields) =>
            [...fields.values()].map((field) => eventOrderByBindingId.get(field.id))
          ),
          ...[...context.recordParameterFieldBindingsByPath.values()].flatMap((fields) =>
            [...fields.values()].map((field) => eventOrderByBindingId.get(field.id))
          )
        ].filter((order): order is number => order !== undefined)
      : [];
    const priorPathEvents = [...(pathEvents?.entries() ?? [])]
      .filter(([sourceStatementIndex]) => sourceStatementIndex < statementIndex)
      .map(([, order]) => order);
    const lastPriorEvent = Math.max(...priorParameterEvents, ...priorPathEvents);
    // Rust evaluates a carry's next expression against binding versions whose
    // source order is strictly before this boundary. Use the next integer after
    // the last preceding Module runtime event, which is the compiler-owned
    // discrete execution order and retains the reference path's before-next
    // position without serializing a fractional source position.
    return Number.isFinite(lastPriorEvent) ? lastPriorEvent + 1 : 0;
  };
  const runtimeEventPositionForValue = (path: readonly string[], statementIndex: number): number => {
    if (path.length === 0) return executionPositionForValue(path, statementIndex);
    const pathEvents = eventOrderByPathAndStatementIndex.get(pathKey(path));
    if (pathEvents) {
      const exact = pathEvents.get(statementIndex);
      if (exact !== undefined) return exact;
    }
    const priorPathEvents = [...(pathEvents?.entries() ?? [])]
      .filter(([candidate]) => candidate < statementIndex)
      .map(([, order]) => order);
    const context = contextsByKey.get(pathKey(path));
    const priorParameterEvents = context
      ? [
          ...[...context.parameters.values()].map((parameter) => eventOrderByBindingId.get(parameter.id)),
          ...[...context.recordParameters.values()].flatMap((fields) =>
            [...fields.values()].map((field) => eventOrderByBindingId.get(field.id))
          )
        ].filter((order): order is number => order !== undefined)
      : [];
    const priorEvents = [...priorPathEvents, ...priorParameterEvents];
    if (priorEvents.length > 0) return Math.max(...priorEvents) + 0.5;
    const instanceId = instanceElement(moduleMaterialization, path);
    const instancePosition = instanceId ? elementOrderById.get(instanceId) : undefined;
    return instancePosition === undefined ? 0 : instancePosition + 0.5;
  };
  const recordFieldSourceOrderForContext = (
    target: Extract<ModuleGeometryPropertySourceTarget, { kind: "recordField" }>,
    path: readonly string[]
  ): number | undefined => {
    switch (target.record.kind) {
      case "recordValue":
      case "recordValueForBinder":
        return executionPositionForValue(path, target.record.statementIndex);
      case "recordCollectionIndex":
        return target.record.targetSourceOrder >= 0
          ? executionPositionForValue(path, target.record.targetSourceOrder)
          : target.record.targetSourceOrder;
      case "deferredModuleRecordExport":
        return executionPositionForValue(path, target.record.instanceStatementIndex);
      case "recordParameter": {
        const context = contextsByKey.get(pathKey(path));
        const fieldBindings = context?.recordParameters.get(target.record.parameterIndex);
        const orders = [...(fieldBindings?.values() ?? [])]
          .map((binding) => eventOrderByBindingId.get(binding.id))
          .filter((order): order is number => order !== undefined);
        if (orders.length > 0) return Math.min(...orders);
        return context
          ? eventOrderByPathAndStatementIndex
            .get(pathKey(context.path.slice(0, -1)))
            ?.get(context.instance.statementIndex)
          : undefined;
      }
    }
  };
  const recordParameterCollectionForTargetContext = (
    target: import("../dsl/moduleSemanticTypes").ModuleRecordFieldSourceTarget,
    context: InstanceContext | null
  ): { collectionValueId: string; targetSourceOrder: number } | undefined => {
    if (target.record.kind === "recordCollectionIndex") {
      if (!context) return undefined;
      const valueType = dslRequiredValueTypeOf(target.valueType) ?? target.valueType;
      const index = target.record.index.ast.kind === "numberLiteral" ? target.record.index.ast.value : null;
      const collection = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis
        ?.genericValuesByStatementId.get(target.record.collectionValueId);
      const mapValue = collection?.value;
      if (
        !isDslArrayValueType(valueType) ||
        index === null || !Number.isInteger(index) || index < 0 ||
        mapValue?.kind !== "map" ||
        mapValue.sourceElementType.kind !== "record" ||
        mapValue.resultElementType.kind !== "record"
      ) return undefined;
      const mappedBody = context.definition.mappedRecordCollectionBodies?.find((candidate) =>
        candidate.binderId === mapValue.binderId
      );
      if (!mappedBody) return undefined;
      const collectionValueId = collectionValueIdFor(target.record.collectionValueId, context);
      return {
        collectionValueId: mappedRecordMemberValueIdFor(collectionValueId, index),
        targetSourceOrder: executionPositionForValue(context.path, target.record.targetSourceOrder)
      };
    }
    if (target.record.kind === "deferredModuleRecordExport") {
      const collectionValueId = recordTargetValueIdFor(target.record, context);
      const targetSourceOrder = recordFieldSourceOrderForContext(target, context?.path ?? []);
      return collectionValueId && targetSourceOrder !== undefined
        ? { collectionValueId, targetSourceOrder }
        : undefined;
    }
    const recordParameter = target.record;
    if (recordParameter.kind !== "recordParameter") return undefined;
    if (!context) return undefined;
    const owner = contextCandidatesFor(context).find((candidate) =>
      candidate.definition.statementId === recordParameter.definitionStatementId &&
      (!recordParameter.definitionIdentity || candidate.definitionDocumentId === recordParameter.definitionIdentity.documentId)
    );
    if (!owner) return undefined;
    const targetSourceOrder = recordFieldSourceOrderForContext(target, owner.path);
    if (targetSourceOrder === undefined) return undefined;
    return {
      collectionValueId: moduleRecordParameterCollectionValueIdFor(
        owner.path,
        recordParameter.definitionStatementId,
        recordParameter.parameterIndex
      ),
      targetSourceOrder
    };
  };
  const resolvedGeometryPropertyForContext = (
    target: ModuleGeometryPropertySourceTarget,
    context: InstanceContext
  ): ModuleGeometryPropertyRuntimeTarget | undefined => {
    if (moduleGeometryRuntime) {
      const lowered = moduleGeometryRuntime.resolvePropertyTarget(target, context.path, new Map(elements.map((element) => [element.id, element])));
      if (!lowered) return undefined;
      if (lowered.kind === "expression") return lowered;
      if (lowered.kind === "value") {
        const recordSourceOrder = target.kind === "recordField"
          ? recordFieldSourceOrderForContext(target, context.path)
          : undefined;
        const loweredSourceOrder = lowered.targetSourceOrder !== undefined && lowered.targetSourceOrder >= 0
          ? lowered.targetSourceOrder
          : undefined;
        return {
          ...lowered,
          targetSourceOrder: loweredSourceOrder ?? recordSourceOrder ?? (
            target.kind === "sourceGeometryProperty" || target.kind === "geometryValueProperty"
              ? executionPositionForValue(context.path, target.statementIndex)
              : -1
          )
        };
      }
      if (lowered.kind === "binder") return lowered;
      if (lowered.kind === "forGroupOccurrence") {
        return {
          ...lowered,
          targetSourceOrder: lowered.targetSourceOrder >= 0
            ? executionPositionForValue(context.path, lowered.targetSourceOrder)
            : lowered.targetSourceOrder
        };
      }
      if (lowered.kind === "carry") {
        return {
          ...lowered,
          bindingId: moduleCarryBindingIdFor(context.path, lowered.bindingId),
          targetSourceOrder: lowered.targetSourceOrder !== undefined && lowered.targetSourceOrder >= 0
            ? executionPositionForValue(context.path, lowered.targetSourceOrder)
            : lowered.targetSourceOrder
        };
      }
      const sourceOrder = elementOrderById.get(lowered.elementId);
      return sourceOrder === undefined ? undefined : { ...lowered, targetSourceOrder: sourceOrder };
    }
    if (target.kind !== "sourceGeometryProperty") return undefined;
    let cursor: InstanceContext | undefined = context;
    while (cursor) {
      if (cursor.definition.bodyStatements.some((body) => body.statementId === target.statementId)) {
        const runtime = elementForBody(moduleMaterialization, cursor.path, target.statementId);
        if (runtime) {
          const sourceOrder = elementOrderById.get(runtime.elementId);
          if (sourceOrder !== undefined) return { kind: "runtime", elementId: runtime.elementId, property: target.property, targetSourceOrder: sourceOrder };
        }
      }
      cursor = cursor.parentKey ? contextsByKey.get(cursor.parentKey) : undefined;
    }
    const documentElementId = moduleMaterialization.elementIdBySourceStatementIndex.get(target.statementIndex);
    if (!documentElementId) return undefined;
    const sourceOrder = elementOrderById.get(documentElementId);
    return sourceOrder === undefined ? undefined : { kind: "runtime", elementId: documentElementId, property: target.property, targetSourceOrder: sourceOrder };
  };
  const collectionLengthForValueIdAt = (
    valueId: string,
    context: InstanceContext,
    visited: ReadonlySet<string> = new Set()
  ): number | undefined => {
    if (visited.has(`${context.key}:${valueId}`)) return undefined;
    const nextVisited = new Set([...visited, `${context.key}:${valueId}`]);
    const definitionDocument = moduleRuntimeContext?.documentFor(context.definitionDocumentId);
    const analysis = definitionDocument?.sourceLexicalNamespace.geometryArraySemanticAnalysis ?? sourceNamespace?.geometryArraySemanticAnalysis;
    const byId = analysis?.genericValuesByStatementId.get(valueId) ?? analysis?.valuesByStatementId.get(valueId);
    if (byId?.value) {
      if (byId.value.kind === "literal") return byId.value.members.length;
      if (byId.value.kind === "none" || byId.value.kind === "if" || byId.value.kind === "match" || byId.value.kind === "coalesce") return undefined;
      if (byId.value.kind === "map") return collectionLengthForValueIdAt(byId.value.sourceValueId, context, nextVisited);
      return collectionLengthForValueIdAt(byId.value.targetValueId, context, nextVisited);
    }
    const parameterMatch = /^(.*):parameter:(\d+)$/.exec(valueId);
    if (parameterMatch) {
      const definitionStatementId = parameterMatch[1]!;
      const parameterIndex = Number(parameterMatch[2]);
      let owner: InstanceContext | undefined = context;
      while (owner) {
        if (owner.definition.statementId === definitionStatementId) {
          const binding = owner.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameterIndex);
          if (binding?.value?.kind === "collectionLiteral") return binding.value.value.members.length;
          if (binding?.value?.kind !== "collection") return undefined;
          return collectionLengthForValueIdAt(binding.value.targetValueId, owner, nextVisited);
        }
        owner = owner.parentKey ? contextsByKey.get(owner.parentKey) : undefined;
      }
      return undefined;
    }
    const deferred = parseGeometryArrayDeferredModuleExportId(valueId);
    if (deferred) {
      const child = runtimeContextForSourceInstance(context, deferred.instanceStatementId);
      const exported = child?.definition.exports.find((candidate) => candidate.kind === "collection" && candidate.name === deferred.exportName);
      return child && exported?.kind === "collection"
        ? collectionLengthForValueIdAt(exported.exportedStatementId, child, nextVisited)
        : undefined;
    }
    return undefined;
  };
  const collectionLengthForTargetContext = (
    target: Extract<ModuleGeometryPropertySourceTarget, { kind: "collectionValueLength" | "collectionParameterLength" | "deferredModuleCollectionExportLength" }>,
    context: InstanceContext
  ): number | undefined => {
    if (target.kind === "collectionValueLength") {
      return target.length ?? collectionLengthForValueIdAt(target.valueId, context);
    }
    if (target.kind === "collectionParameterLength") {
      const candidates = contextCandidatesFor(context).filter((candidate) =>
        candidate.definition.statementId === target.definitionStatementId &&
        (!target.definitionIdentity || candidate.definitionDocumentId === target.definitionIdentity.documentId)
      );
      const binding = candidates[0]?.instance.parameterBindings.find((candidate) => candidate.parameterIndex === target.parameterIndex);
      return binding?.value?.kind === "collection"
        ? collectionLengthForValueIdAt(binding.value.targetValueId, candidates[0]!, new Set())
        : binding?.value?.kind === "collectionLiteral"
          ? binding.value.value.members.length
          : undefined;
    }
    const child = runtimeContextForSourceInstance(context, target.instanceStatementId, target.instanceIdentity?.documentId);
    return child
      ? collectionLengthForValueIdAt(target.exportedStatementId, child, new Set())
      : undefined;
  };
  const geometryInterfaceTypeForReference = (
    reference: import("../dsl/moduleSemanticTypes").ModuleGeometryReferenceSemantic,
    context?: InstanceContext
  ): ModuleGeometryInterfaceType | undefined => {
    if (reference.expectedGeometryKind === "point") return "point";
    const target = reference.target;
    if (!target) return undefined;
    if ("expectedInterfaceType" in target && target.expectedInterfaceType) return target.expectedInterfaceType;
    if (target.kind === "geometryValue") return target.declaredInterfaceType;
    if (target.kind === "geometryValueForBinder") return target.sourceElementType;
    if (target.kind === "geometryCarry") return target.geometryKind;
    if (target.kind === "parameter") {
      return moduleGeometryInterfaceTypeOf(context?.definition.parameters.find((parameter) =>
        parameter.parameterIndex === target.parameterIndex
      )?.type) ?? undefined;
    }
    if (target.kind === "sourceGeometry") {
      if (target.category === "curve" || target.category === "arc" || target.category === "path") return "path";
      if (target.category === "point") return "point";
      return target.geometryKind;
    }
    if (target.kind === "forGroupOccurrence") {
      return target.category === "point" ? "point" : target.expectedInterfaceType ?? "path";
    }
    if (target.kind === "constructionInput") return target.interfaceType;
    if (target.kind === "recordFieldValue") {
      return target.valueType.kind === "point" || target.valueType.kind === "line" || target.valueType.kind === "path"
        ? target.valueType.kind
        : undefined;
    }
    if (target.kind === "deferredModuleExport") {
      return target.expectedInterfaceType ?? target.expectedGeometryKind;
    }
    if (reference.valueType?.kind === "line" || reference.valueType?.kind === "path") return reference.valueType.kind;
    return reference.expectedGeometryKind;
  };
  const resolvedGeometryBuiltinForContext = (
    occurrence: ModuleGeometryBuiltinArgumentSemantic,
    context: InstanceContext,
    expectedGeometryType?: ModuleGeometryInterfaceType
  ): ScalarExpressionResolvedGeometryTarget | undefined => {
    if (!moduleGeometryRuntime || !occurrence.reference.target) return undefined;
    const resolvedGeometryType = expectedGeometryType ??
      geometryInterfaceTypeForReference(occurrence.reference, context) ??
      occurrence.expectedGeometryType;
    const stagePath = "stagePath" in occurrence.reference.target ? occurrence.reference.target.stagePath : undefined;
    const lowered = moduleGeometryRuntime.resolveBuiltinTarget(
      occurrence.reference.target,
      context.path,
      resolvedGeometryType
    );
    if (!lowered) return undefined;
    const resolvedStagePath = stagePath ?? lowered.stagePath;
    if (lowered.kind === "geometryValue") {
      return {
        kind: "geometryValue",
        occurrence: lowered.occurrence,
        statementId: lowered.occurrence.sourceStatementId,
        statementIndex: occurrence.reference.target.kind === "geometryValue"
          ? executionPositionForValue(context.path, occurrence.reference.target.statementIndex)
          : occurrence.span.start,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
      };
    }
    if (lowered.kind === "forGroupOccurrence") {
      const index = lowered.index
        ? lowerExpression(
            lowered.index,
            (target) => resolvedBindingForContext(target, context),
            bindingsById,
            (target) => resolvedGeometryPropertyForContext(target, context),
            (target) => collectionLengthForTargetContext(target, context),
            (candidate) => resolvedGeometryBuiltinForContext(candidate, context),
            (valueId) => collectionValueIdFor(valueId, context),
            (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
            (target) => recordParameterCollectionForTargetContext(target, context)
          ).expression
        : null;
      return {
        kind: "forGroupOccurrence",
        templateElementId: lowered.templateElementId,
        statementId: lowered.templateElementId,
        statementIndex: lowered.targetSourceOrder,
        targetSourceOrder: lowered.targetSourceOrder >= 0
          ? executionPositionForValue(context.path, lowered.targetSourceOrder)
          : lowered.targetSourceOrder,
        index,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
      };
    }
    if (lowered.kind === "geometryCarry") {
      return {
        kind: "geometryCarry",
        bindingId: lowered.bindingId,
        statementId: lowered.bindingId,
        statementIndex: occurrence.span.start,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
      };
    }
    const statementIndex = elementOrderById.get(lowered.elementId);
    return statementIndex === undefined ? undefined : {
      statementId: lowered.elementId,
      statementIndex,
      geometryType: lowered.geometryType,
      ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
      ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
    };
  };
  const resolvedGeometryBuiltinForRoot = (
    occurrence: ModuleGeometryBuiltinArgumentSemantic
  ): ScalarExpressionResolvedGeometryTarget | undefined => {
    if (!moduleGeometryRuntime || !occurrence.reference.target) return undefined;
    const resolvedGeometryType = geometryInterfaceTypeForReference(occurrence.reference) ?? occurrence.expectedGeometryType;
    const stagePath = "stagePath" in occurrence.reference.target ? occurrence.reference.target.stagePath : undefined;
    const lowered = moduleGeometryRuntime.resolveBuiltinTarget(
      occurrence.reference.target,
      [],
      resolvedGeometryType
    );
    if (!lowered) return undefined;
    if (lowered.kind === "geometryValue") {
      return {
        kind: "geometryValue",
        occurrence: lowered.occurrence,
        statementId: lowered.occurrence.sourceStatementId,
        statementIndex: occurrence.reference.target.kind === "geometryValue"
          ? executionPositionForValue([], occurrence.reference.target.statementIndex)
          : occurrence.span.start,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(stagePath ? { stagePath } : {})
      };
    }
    if (lowered.kind === "forGroupOccurrence") {
      const index = lowered.index
        ? lowerExpression(
            lowered.index,
            (target) => rootBindingForTarget(target, lowered.targetSourceOrder),
            bindingsById,
            rootGeometryPropertyFor,
            rootCollectionLengthFor,
            resolvedGeometryBuiltinForRoot,
            (valueId) => collectionValueIdFor(valueId, null),
            (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder
          ).expression
        : null;
      return {
        kind: "forGroupOccurrence",
        templateElementId: lowered.templateElementId,
        statementId: lowered.templateElementId,
        statementIndex: lowered.targetSourceOrder,
        targetSourceOrder: lowered.targetSourceOrder >= 0
          ? executionPositionForValue([], lowered.targetSourceOrder)
          : lowered.targetSourceOrder,
        index,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(stagePath ? { stagePath } : {})
      };
    }
    if (lowered.kind === "geometryCarry") {
      return {
        kind: "geometryCarry",
        bindingId: lowered.bindingId,
        statementId: lowered.bindingId,
        statementIndex: occurrence.span.start,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(stagePath ? { stagePath } : {})
      };
    }
    const statementIndex = elementOrderById.get(lowered.elementId);
    return statementIndex === undefined ? undefined : { statementId: lowered.elementId, statementIndex, geometryType: lowered.geometryType, ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}) };
  };
  const moduleInitializers = new Map<BindingId, TypedScalarExpression>();
  const moduleCarryNextExpressions = new Map<BindingId, TypedScalarExpression>();
  const moduleReferences: InitializerReference[] = [];
  const lowerForContext = (semantic: ModuleScalarExpressionSemantic, context: InstanceContext, ownerBindingId: BindingId) => {
    if (contextIsDisabled(context)) return;
    const lowered = lowerExpression(
      semantic,
      (target) => resolvedBindingForContext(target, context),
      bindingsById,
      (target) => resolvedGeometryPropertyForContext(target, context),
      (target) => collectionLengthForTargetContext(target, context),
      (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
      (valueId) => collectionValueIdFor(valueId, context),
      (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
      (target) => recordParameterCollectionForTargetContext(target, context)
    );
    moduleInitializers.set(ownerBindingId, lowered.expression);
    for (const reference of lowered.references) moduleReferences.push({ ...reference, fromBindingId: ownerBindingId });
  };

  const lowerRecordConstructorFields = (
    fields: readonly import("../dsl/moduleSemanticTypes").ModuleRecordConstructorFieldSemantic[],
    prefix: readonly RecordFieldIdentity[],
    bindingForPath: (path: readonly RecordFieldIdentity[]) => BindingId | undefined,
    context: InstanceContext
  ): void => {
    for (const field of fields) {
      const fieldPath = [...prefix, field.field];
      const value = field.valueExpression;
      if (value?.kind === "scalar") {
        const bindingId = bindingForPath(fieldPath);
        if (bindingId) lowerForContext(value.expression, context, bindingId);
      } else if (value?.kind === "record" && value.expression?.kind === "constructor") {
        lowerRecordConstructorFields(value.expression.constructor.fields, fieldPath, bindingForPath, context);
      }
    }
  };

  for (const context of contextsByKey.values()) {
    if (contextIsDisabled(context) || !contextIsReachable(context)) continue;
    for (const parameter of context.definition.parameters) {
      const info = context.parameters.get(parameter.parameterIndex);
      const binding = context.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      if (!info || !binding || binding.value?.kind !== "scalar") continue;
      lowerForContext(binding.value.expression, context, info.id);
    }
    for (const parameter of context.definition.parameters) {
      const binding = context.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      const fields = binding?.value?.kind === "record" && binding.value.reference.constructor
        ? binding.value.reference.constructor.fields
        : [];
      if (fields.length > 0) {
        lowerRecordConstructorFields(
          fields,
          [],
          (fieldPath) => fieldPath.length === 1
            ? context.recordParameters.get(parameter.parameterIndex)?.get(fieldPath[0]!.fieldIndex)?.id
            : context.recordParameterFieldBindingsByPath.get(parameter.parameterIndex)?.get(recordFieldPathKey(fieldPath))?.id,
          context
        );
      }
    }
    for (const recordValue of context.definition.recordValues) {
      if (recordValue.value.constructor) {
        lowerRecordConstructorFields(
          recordValue.fields,
          [],
          (fieldPath) => fieldPath.length === 1
            ? context.recordValues.get(recordValue.value.statementId)?.get(fieldPath[0]!.fieldIndex)?.id
            : context.recordValueFieldBindingsByPath.get(recordValue.value.statementId)?.get(recordFieldPathKey(fieldPath))?.id,
          context
        );
      } else if (recordValue.valueExpression?.kind === "coalesce" && recordValue.valueExpression.right?.kind === "constructor") {
        lowerRecordConstructorFields(
          recordValue.valueExpression.right.constructor.fields,
          [],
          (fieldPath) => fieldPath.length === 1
            ? context.recordValues.get(recordValue.value.statementId)?.get(fieldPath[0]!.fieldIndex)?.id
            : context.recordValueFieldBindingsByPath.get(recordValue.value.statementId)?.get(recordFieldPathKey(fieldPath))?.id,
          context
        );
      } else if (recordValue.valueExpression) {
        for (const field of recordValue.fieldExpressions) {
          const info = context.recordValues.get(recordValue.value.statementId)?.get(field.field.fieldIndex);
          if (info?.id && field.expression) lowerForContext(field.expression, context, info.id);
        }
      }
    }
    for (const local of context.definition.localScalars) {
      const info = context.locals.get(local.statementId);
      const body = context.definition.bodyStatements.find((candidate) => candidate.statementId === local.statementId);
      if (info && local.initializer && body && moduleBodyStatementIsReachable(context, body)) {
        lowerForContext(local.initializer, context, info.id);
      }
    }
    for (const carry of context.definition.immutableCarries ?? []) {
      if (!carry.type || !carry.initializer || !carry.next) continue;
      const info = context.carries.get(carry.bindingId);
      if (!info) continue;
      lowerForContext(carry.initializer, context, info.id);
      const loweredNext = lowerExpression(
        carry.next,
        (target) => resolvedBindingForContext(target, context),
        bindingsById,
        (target) => resolvedGeometryPropertyForContext(target, context),
        (target) => collectionLengthForTargetContext(target, context),
        (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
        (valueId) => collectionValueIdFor(valueId, context),
        (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
        (target) => recordParameterCollectionForTargetContext(target, context)
      );
      moduleCarryNextExpressions.set(info.id, loweredNext.expression);
    }
  }

  const materializedPropertyBindings: MaterializedPropertyBindingSource[] = [];
  const materializedNumericBindings: MaterializedNumericBindingSource[] = [];
  const materializedTransformationNumericBindings: CompiledTransformationNumericBinding[] = [];
  const materializedTextTemplates: MaterializedTextTemplateSource[] = [];
  const materializedConditionalGroupConditions: { elementId: ElementId; expression: TypedScalarExpression }[] = [];
  const lowerModuleTextTemplate = (context: InstanceContext, body: ModuleBodyStatementSemantic, runtime: { elementId: ElementId; statement: DslStatement }) => {
    if (runtime.statement.kind !== "element" || runtime.statement.type !== "text") return;
    const attr = runtime.statement.attrs.find((candidate) => candidate.key === "text");
    if (!attr || attr.value.startsWith("@") || body.textTemplateHoles.length === 0) return;
    const source = " ".repeat(attr.valueStart) + attr.value;
    const scanned = scanTextTemplateLiteral(source, { start: attr.valueStart, end: attr.valueEnd });
    if (scanned.kind === "error") return;
    const segments: TextTemplateSegment[] = [];
    const dependencies: TextTemplateDependency[] = [];
    for (const segment of scanned.segments) {
      if (segment.kind === "literal") {
        segments.push(segment);
        continue;
      }
      const site = body.textTemplateHoles.find((candidate) => candidate.contentSpan.start === segment.contentSpan.start);
      if (!site) {
        segments.push({
          kind: "hole",
          holeKind: "numeric",
          span: segment.span,
          contentSpan: segment.contentSpan,
          cookedInsertOffset: segment.cookedInsertOffset,
          raw: source.slice(segment.contentSpan.start, segment.contentSpan.end)
        });
        continue;
      }
      const lowered = lowerExpression(
        site.expression,
        (target) => resolvedBindingForContext(target, context),
        bindingsById,
        (target) => resolvedGeometryPropertyForContext(target, context),
        (target) => collectionLengthForTargetContext(target, context),
        (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
        (valueId) => collectionValueIdFor(valueId, context),
        (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
        (target) => recordParameterCollectionForTargetContext(target, context)
      );
      for (const reference of lowered.references) {
        if (reference.resolution.kind !== "resolved" || reference.resolution.binding.kind !== "typed" || !reference.span) continue;
        dependencies.push({
          holeSpan: segment.span,
          bindingId: reference.resolution.binding.id,
          name: reference.name,
          span: reference.span,
          elementId: runtime.elementId
        });
      }
      const base = { span: segment.span, contentSpan: segment.contentSpan, cookedInsertOffset: segment.cookedInsertOffset } as const;
      const loweredType = lowered.expression.type;
      if (loweredType?.kind === "string" || loweredType?.kind === "number") {
        segments.push({ kind: "hole", holeKind: loweredType.kind, ...base, expression: lowered.expression });
      } else {
        segments.push({ kind: "hole", holeKind: "numeric", ...base, raw: source.slice(segment.contentSpan.start, segment.contentSpan.end) });
      }
    }
    materializedTextTemplates.push({
      elementId: runtime.elementId,
      template: {
        span: scanned.span,
        quote: scanned.quote,
        raw: scanned.raw,
        segments,
        dependencies
      }
    });
  };
  for (const context of contextsByKey.values()) {
    if (!contextIsReachable(context)) continue;
    for (const body of context.definition.bodyStatements) {
      if (body.statementKind !== "transformation" || !moduleBodyStatementIsReachable(context, body)) continue;
      const recipe = (transformationRecipes ?? []).find((candidate) =>
        (candidate.sourceStatementId === body.statementId ||
          (candidate.sourceStatementId === undefined && candidate.sourceStatementIndex === body.statementIndex)) &&
        candidate.runtimeInstancePath?.length === context.path.length &&
        candidate.runtimeInstancePath.every((part, index) => part === context.path[index])
      );
      if (!recipe) continue;
      const operationInputs = transformationNumericInputs(recipe.operation);
      for (const site of body.scalarExpressions) {
        if (!site.parameterKey || site.expression.references.length === 0) continue;
        const input = operationInputs.find((candidate) => candidate.parameterPath === site.parameterKey);
        if (!input || !isNumericExpression(input.value)) continue;
        const lowered = lowerExpression(
          site.expression,
          (target) => resolvedBindingForContext(target, context),
          bindingsById,
          (target) => resolvedGeometryPropertyForContext(target, context),
          (target) => collectionLengthForTargetContext(target, context),
          (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
          (valueId) => collectionValueIdFor(valueId, context),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
          (target) => recordParameterCollectionForTargetContext(target, context)
        );
        const binding = numericSourceForModuleValue(
          input.value,
          input.parameterKey,
          { ...site, parameterKey: input.parameterKey },
          (target) => resolvedBindingForContext(target, context),
          lowered.expression
        );
        if (binding) materializedTransformationNumericBindings.push({
          recipeId: recipe.id,
          parameterPath: site.parameterKey,
          binding
        });
      }
    }
  }
  for (const context of contextsByKey.values()) {
    if (!contextIsReachable(context)) continue;
    for (const body of context.definition.bodyStatements) {
      if (!moduleBodyStatementIsReachable(context, body)) continue;
      const runtime = bodyRuntimeEntry(context, body);
      if (!runtime || (body.statementKind !== "element" && body.statementKind !== "group")) continue;
      const element = elements.find((candidate) => candidate.id === runtime.elementId);
      if (!element) continue;
      lowerModuleTextTemplate(context, body, runtime);
      for (const site of body.scalarExpressions) {
        if (site.parameterKey === null) continue;
        const loweredSiteExpression = lowerExpression(
          site.expression,
          (target) => resolvedBindingForContext(target, context),
          bindingsById,
          (target) => resolvedGeometryPropertyForContext(target, context),
          (target) => collectionLengthForTargetContext(target, context),
          (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
          (valueId) => collectionValueIdFor(valueId, context),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
          (target) => recordParameterCollectionForTargetContext(target, context)
        );
        if (element.type === "conditionalGroup" && site.parameterKey === "condition") {
          materializedConditionalGroupConditions.push({ elementId: runtime.elementId, expression: loweredSiteExpression.expression });
        }
        const property = propertySourceFor(element, site.parameterKey, site.expression, loweredSiteExpression.expression);
        if (property) {
          materializedPropertyBindings.push({ elementId: runtime.elementId, parameterKey: site.parameterKey, source: property });
        }
        const numeric = numericSourceForModuleSite(
          element,
          site,
          (target) => resolvedBindingForContext(target, context),
          loweredSiteExpression.expression
        );
        if (numeric) materializedNumericBindings.push({ elementId: runtime.elementId, binding: numeric });
      }
      // A geometry parameter can carry a coordinate anchor. When that alias
      // is consumed by a body element, keep its x/y expressions on the same
      // numeric binding path as a source-level coordinate() argument.
      if (moduleGeometryRuntime) {
        for (const referenceSite of body.geometryReferences) {
          if (!referenceSite.parameterKey || referenceSite.reference.coordinate) continue;
          const coordinate = moduleGeometryRuntime.coordinateForReference(referenceSite.reference, context.path);
          if (!coordinate) continue;
          for (const [axis, expression] of [["x", coordinate.x], ["y", coordinate.y]] as const) {
            if (!expression) continue;
            const numeric = numericSourceForModuleSite(
              element,
              { parameterKey: `${referenceSite.parameterKey}:${axis}`, span: expression.ast.span, expression },
              (target) => resolvedBindingForContext(target, context)
            );
            if (numeric) materializedNumericBindings.push({ elementId: runtime.elementId, binding: numeric });
          }
        }
      }
    }
  }

  const documentReferences = (documentBindingAnalysis?.initializerReferences ?? []).map((reference) => remapDocumentReference(reference, bindingsById));
  // A compiled aggregate document may already include module-runtime references.
  // Preview lowers those bindings again for its ephemeral synthetic instances;
  // keep the fresh lowering for any binding it owns rather than adding duplicate
  // occurrence indexes to the rebuilt graph.
  const moduleReferenceBindingIds = new Set(moduleReferences.map((reference) => reference.fromBindingId));
  const combinedReferences = [
    ...documentReferences.filter((reference) => !moduleReferenceBindingIds.has(reference.fromBindingId)),
    ...foreignReferences,
    ...moduleReferences
  ];
  const combinedAnalysis = analyzeBindings({
    catalog: combinedCatalog,
    initializerReferences: combinedReferences,
    unavailableBindingIds: new Set([
      ...disabledBindingIds,
      ...baseCatalog.bindings
        .filter((binding) => binding.kind === "typed" && binding.id.startsWith("value-for-binder:"))
        .map((binding) => binding.id)
    ])
  });
  const initializers = new Map<BindingId, TypedScalarExpression>();
  for (const foreign of foreignSourceScalars.values()) {
    for (const statement of foreign.program.statements) {
      const bindingId = foreign.bindingIdByLocalId.get(statement.bindingId);
      if (bindingId) initializers.set(bindingId, remapTypedExpressionBindingIds(statement.declaration.initializer, foreign.bindingIdByLocalId));
    }
  }
  const rootGeometryPropertyFor = (target: ModuleGeometryPropertySourceTarget): ModuleGeometryPropertyRuntimeTarget | undefined => {
    if (target.kind === "geometryCarry") {
      return {
        kind: "carry",
        bindingId: target.bindingId,
        property: target.property,
        ...(target.pointKey ? { pointKey: target.pointKey } : {}),
        targetSourceOrder: executionPositionForValue([], target.statementIndex)
      };
    }
    if (!moduleGeometryRuntime) return undefined;
    const lowered = moduleGeometryRuntime.resolvePropertyTarget(
      target,
      [],
      new Map(elements.map((element) => [element.id, element]))
    );
    if (!lowered || lowered.kind === "expression") return lowered;
    if (lowered.kind === "value") {
      const recordSourceOrder = target.kind === "recordField"
        ? recordFieldSourceOrderForContext(target, [])
        : undefined;
      const loweredSourceOrder = lowered.targetSourceOrder !== undefined && lowered.targetSourceOrder >= 0
        ? lowered.targetSourceOrder
        : undefined;
      return {
        ...lowered,
        targetSourceOrder: loweredSourceOrder ?? recordSourceOrder ?? (
          target.kind === "sourceGeometryProperty" || target.kind === "geometryValueProperty"
            ? executionPositionForValue([], target.statementIndex)
            : -1
        )
      };
    }
    if (lowered.kind === "binder") return lowered;
    if (lowered.kind === "forGroupOccurrence") {
      return {
        ...lowered,
        targetSourceOrder: lowered.targetSourceOrder >= 0
          ? executionPositionForValue([], lowered.targetSourceOrder)
          : lowered.targetSourceOrder
      };
    }
    if (lowered.kind === "carry") return lowered;
    const sourceOrder = elementOrderById.get(lowered.elementId);
    return sourceOrder === undefined ? undefined : { ...lowered, targetSourceOrder: sourceOrder };
  };
  const rootCollectionLengthFor = (
    target: Extract<ModuleGeometryPropertySourceTarget, { kind: "collectionValueLength" | "collectionParameterLength" | "deferredModuleCollectionExportLength" }>
  ): number | undefined => {
    const rootValueLength = (valueId: string, visited: ReadonlySet<string> = new Set()): number | undefined => {
      if (visited.has(valueId)) return undefined;
      const nextVisited = new Set([...visited, valueId]);
      const value = sourceNamespace?.geometryArraySemanticAnalysis?.genericValuesByStatementId.get(valueId);
      if (value?.value) {
        if (value.value.kind === "literal") return value.value.members.length;
        if (value.value.kind === "none" || value.value.kind === "if" || value.value.kind === "match" || value.value.kind === "coalesce") return undefined;
        if (value.value.kind === "map") return rootValueLength(value.value.sourceValueId, nextVisited);
        return rootValueLength(value.value.targetValueId, nextVisited);
      }
      const deferred = parseGeometryArrayDeferredModuleExportId(valueId);
      if (!deferred) return undefined;
      const child = runtimeContextForSourceInstance(null, deferred.instanceStatementId);
      const exported = child?.definition.exports.find((candidate) => candidate.kind === "collection" && candidate.name === deferred.exportName);
      return child && exported?.kind === "collection"
        ? collectionLengthForValueIdAt(exported.exportedStatementId, child, nextVisited)
        : undefined;
    };
    if (target.kind === "collectionValueLength") {
      if (target.length !== null) return target.length;
      return rootValueLength(target.valueId);
    }
    if (target.kind === "collectionParameterLength") return undefined;
    const child = runtimeContextForSourceInstance(null, target.instanceStatementId, target.instanceIdentity?.documentId);
    return child ? collectionLengthForValueIdAt(target.exportedStatementId, child, new Set()) : undefined;
  };
  const rootBindingForTarget = (target: ModuleScalarSourceTarget, statementIndex: number): Binding | undefined => {
    if (target.kind === "documentBinding") return bindingsById.get(runtimeBindingIdForDocumentTarget(target));
    if (target.kind === "recordField") {
      const record = target.record;
      const bindingId = record.kind === "recordValueForBinder"
        ? moduleRecordCollectionBinderFieldIdForPath([], record.binderId, target.fieldPath ?? [target.field])
        : record.kind === "recordCollectionIndex"
          ? recordFieldBindingIdForTarget(record, target.field, null, target.fieldPath)
        : record.kind === "deferredModuleRecordExport" && sourceNamespace
        ? moduleRecordExportFieldBindingIdFor({
            moduleSemanticAnalysis,
            sourceNamespace,
            instanceStatementId: record.instanceStatementId,
            instanceIdentity: record.instanceIdentity,
            exportName: record.exportName,
            exportedStatementId: record.exportedStatementId,
            field: target.field,
            moduleRuntimeContext
          })
                : record.kind === "recordValue"
          ? (() => {
              // The Module-aware document pass may have supplied an external
              // backing map for an ordinary record alias. Reuse that existing
              // catalog resolver here when rematerializing the root program;
              // this runtime layer must not resolve Module exports itself.
              const value = sourceNamespace?.recordSemanticAnalysis?.valuesByStatementId.get(record.statementId);
              const definition = value?.typeIdentity
                ? sourceNamespace?.recordSemanticAnalysis?.definitionsByStatementId.get(value.typeIdentity)
                : undefined;
              const field = definition?.fields.find((candidate) => candidate.fieldIndex === target.field.fieldIndex);
              const sourceResolution = value && field
                ? documentBindingAnalysis?.catalog.sourceNamespaceBindingResolver?.(
                    `${value.name}.${field.name}`,
                    statementIndex,
                    baseScopeIndex.scopeOfStatement.get(statementIndex) ?? baseScopeIndex.rootScopeId
                  )
                : undefined;
              return sourceResolution?.kind === "resolved"
                ? sourceResolution.bindingId
                : (target.fieldPath && target.fieldPath.length > 1
                  ? rootRecordPlan?.fieldBindingIdsByAccessPathByValueStatementId.get(record.statementId)?.get(JSON.stringify(
                      target.fieldPath.map((field) => [field.recordStatementId, field.fieldIndex])
                    ))
                  : rootRecordPlan?.fieldBindingIdsByValueStatementId.get(record.statementId)?.get(target.field.fieldIndex))
                  ?? recordScalarBindingIdFor(record.statementId, target.field);
            })()
          : undefined;
      return bindingId ? bindingsById.get(bindingId) : undefined;
    }
    if (target.kind === "deferredModuleScalarExport") {
      const context = moduleRuntimeContext
        ? runtimeContextForSourceInstance(null, target.instanceStatementId, target.instanceIdentity?.documentId)
        : undefined;
      const instance = context?.instance ?? moduleSemanticAnalysis.instancesByStatementId.get(target.instanceStatementId);
      const definition = context?.definition ?? (instance?.callee
        ? moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId)
        : undefined);
      const definitionStatementId = definition?.statementId;
      return definitionStatementId
        ? bindingsById.get(moduleScalarBindingIdFor(context?.path ?? [target.instanceStatementId], definitionStatementId, target.exportedStatementId))
        : undefined;
    }
    if (target.kind === "iteration") return documentIterationBindingForTarget(target);
    return undefined;
  };

  const statementIndexByIdentity = new Map(
    [...stableStatementIdByIndex].map(([statementIndex, statementId]) => [statementId, statementIndex] as const)
  );
  for (const [statementId, sites] of moduleSemanticAnalysis.rootElementScalarExpressionsByStatementId) {
    const statementIndex = statementIndexByIdentity.get(statementId);
    if (statementIndex === undefined) continue;
    const elementId = reconciledContainers.elementIdByStatementIndex.get(statementIndex);
    if (!elementId) continue;
    const element = elements.find((candidate) => candidate.id === elementId);
    if (!element) continue;
    for (const site of sites) {
      if (!site.parameterKey || !site.expression.optionalMembers?.length) continue;
      const lowered = lowerExpression(
        site.expression,
        (target, _name, targetStatementIndex) => rootBindingForTarget(target, targetStatementIndex),
        bindingsById,
        rootGeometryPropertyFor,
        rootCollectionLengthFor,
        resolvedGeometryBuiltinForRoot,
        (valueId) => collectionValueIdFor(valueId, null),
        (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder
      );
      const numeric = numericSourceForModuleSite(
        element,
        site,
        (target, _name, targetStatementIndex) => rootBindingForTarget(target, targetStatementIndex),
        lowered.expression
      );
      if (numeric) materializedNumericBindings.push({ elementId, binding: numeric });
    }
  }

  const moduleCollectionValues = buildModuleCollectionValues();

  const lazyGeometryValuePrograms = new Map<string, GeometryValueProgramNode>();
  const lowerCollectionScalar = (
    expression: ModuleScalarExpressionSemantic,
    context: InstanceContext | undefined
  ): TypedScalarExpression => context
    ? lowerExpression(
        expression,
        (target) => resolvedBindingForContext(target, context),
        bindingsById,
        (target) => resolvedGeometryPropertyForContext(target, context),
        (target) => collectionLengthForTargetContext(target, context),
        (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
        (valueId) => collectionValueIdFor(valueId, context),
        (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
        (target) => recordParameterCollectionForTargetContext(target, context)
      ).expression
    : lowerExpression(
        expression,
        (target) => rootBindingForTarget(target, expression.ast.span.start),
        bindingsById,
        rootGeometryPropertyFor,
        rootCollectionLengthFor,
        resolvedGeometryBuiltinForRoot,
        (valueId) => collectionValueIdFor(valueId, null),
        (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder
      ).expression;

  const lowerCollectionNode = (
    node: RuntimeGeometryCollectionNode
  ): GeometryInputCollectionNode | null => {
    if (node.kind === "none") return { kind: "none" };
    if (node.kind === "leaf") {
      const targets = node.aliases.map((alias) => {
        const lowered = geometryInputTargetForAlias(alias);
        if (!lowered) return null;
        const target = lowerGeometryInputTarget(lowered);
        return target && target.kind !== "collectionIndex" && target.kind !== "collectionValue"
          ? target
          : null;
      });
      return targets.every((target) => target !== null)
        ? { kind: "leaf", targets: targets as Exclude<GeometryInputTarget, { kind: "collectionIndex" } | { kind: "collectionValue" }>[] }
        : null;
    }
    if (node.kind === "geometryValueMap") {
      const context = node.instancePath.length > 0
        ? contextsByKey.get(pathKey(node.instancePath))
        : undefined;
      const programValue: import("../dsl/moduleSemanticTypes").ModuleGeometryValueSemantic = {
        statementId: node.sourceStatementId,
        statementIndex: node.executionPosition,
        name: node.sourceStatementId,
        declaredInterfaceType: node.declaredInterfaceType,
        ownerModuleDefinitionStatementId: context?.definition.statementId ?? null,
        ownerModuleDefinitionStatementIndex: context?.definition.statementIndex ?? null,
        exported: false,
        initializer: null,
        construction: null,
        valueExpression: node.body,
        backingTarget: null
      };
      const executionPosition = executionPositionForValue(node.instancePath, node.executionPosition);
      const program = lowerGeometryValueExpression(programValue, node.body, context, executionPosition);
      if (!program) return null;
      return {
        kind: "geometryValueMap",
        source: {
          kind: "value",
          valueId: collectionValueIdFor(node.sourceValueId, context ?? null)
        },
        sourceStatementId: node.sourceStatementId,
        instancePath: node.instancePath,
        binderId: node.binderId,
        geometryType: node.geometryType,
        declaredInterfaceType: node.declaredInterfaceType,
        program,
        executionPosition
      };
    }
    if (node.kind === "if") {
      const sourceContext = node.sourcePath.length > 0 ? contextsByKey.get(pathKey(node.sourcePath)) : undefined;
      const thenBranch = lowerCollectionNode(node.thenBranch);
      const elseBranch = lowerCollectionNode(node.elseBranch);
      return thenBranch && elseBranch
        ? {
            kind: "if",
            condition: lowerCollectionScalar(node.condition, sourceContext),
            sourceOrder: executionPositionForValue(node.sourcePath, node.sourceOrder),
            thenBranch,
            elseBranch
          }
        : null;
    }
    if (node.kind === "coalesce") {
      const leftBranch = lowerCollectionNode(node.leftBranch);
      const rightBranch = lowerCollectionNode(node.rightBranch);
      return leftBranch && rightBranch
        ? { kind: "coalesce", leftBranch, rightBranch }
        : null;
    }
    const sourceContext = node.sourcePath.length > 0 ? contextsByKey.get(pathKey(node.sourcePath)) : undefined;
    const arms = node.arms.map((arm) => {
      const value = lowerCollectionNode(arm.value);
      return value ? { label: arm.label, value } : null;
    });
    return arms.every((arm) => arm !== null)
      ? {
          kind: "match",
          scrutinee: optionalCollectionMatchPresenceProjection(lowerCollectionScalar(node.scrutinee, sourceContext)),
          sourceOrder: executionPositionForValue(node.sourcePath, node.sourceOrder),
          arms: arms as { label: string; value: GeometryInputCollectionNode }[]
        }
      : null;
  };

  const lowerGeometryInputTarget = (
    source: RuntimeGeometryInputTarget
  ): GeometryInputTarget | null => {
    if (source.kind === "geometryValueMapPending") {
      const loweredSource = geometryInputTargetForAlias(source.source);
      if (!loweredSource || loweredSource.kind === "geometryValueMapPending" || loweredSource.kind === "geometryValueMap") return null;
      return {
        kind: "geometryValueMap",
        occurrence: source.occurrence,
        binderId: source.binderId,
        geometryType: source.geometryType,
        ...(source.pointKey ? { pointKey: source.pointKey } : {}),
        source: loweredSource,
        program: {
          kind: "reference",
          target: {
            kind: "geometryValueForBinder",
            binderId: "pending-geometry-map-binder",
            statementId: source.occurrence.sourceStatementId,
            statementIndex: source.executionPosition,
            geometryType: source.declaredInterfaceType
          }
        },
        executionPosition: source.executionPosition,
        declaredInterfaceType: source.declaredInterfaceType
      };
    }
    if (source.kind === "collectionValue") {
      const currentPath = source.currentPath ?? [];
      const context = contextsByKey.get(pathKey(currentPath));
      const value = lowerCollectionNode(source.value);
      if (!value) return null;
      return {
        kind: "collectionValue",
        collectionValueId: source.collectionValueId,
        targetSourceOrder: context ? executionPositionForValue(context.path, source.targetSourceOrder) : source.targetSourceOrder,
        value
      };
    }
    if (source.kind === "forGroupOccurrenceSource") {
      const currentPath = source.currentPath ?? [];
      const context = contextsByKey.get(pathKey(currentPath));
      const loweredIndex = source.index
        ? context
          ? lowerExpression(
              source.index,
              (target) => resolvedBindingForContext(target, context),
              bindingsById,
              (target) => resolvedGeometryPropertyForContext(target, context),
              (target) => collectionLengthForTargetContext(target, context),
              (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
              (valueId) => collectionValueIdFor(valueId, context),
              (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
              (target) => recordParameterCollectionForTargetContext(target, context)
            ).expression
          : lowerExpression(
              source.index,
              (target) => rootBindingForTarget(target, source.targetSourceOrder),
              bindingsById,
              rootGeometryPropertyFor,
              rootCollectionLengthFor,
              resolvedGeometryBuiltinForRoot,
              (valueId) => collectionValueIdFor(valueId, null),
              (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder
            ).expression
        : null;
      return {
        kind: "forGroupOccurrence",
        templateElementId: source.templateElementId,
        geometryType: source.geometryType,
        targetSourceOrder: context && source.targetSourceOrder >= 0
          ? executionPositionForValue(context.path, source.targetSourceOrder)
          : source.targetSourceOrder,
        index: loweredIndex,
        ...(source.pointKey ? { pointKey: source.pointKey } : {})
      };
    }
    if (source.kind !== "collectionIndex" || !("target" in source)) return source;
    const currentPath = source.currentPath ?? [];
    const context = contextsByKey.get(pathKey(currentPath));
    const loweredIndex = context
      ? lowerExpression(
          source.target.index,
          (target) => resolvedBindingForContext(target, context),
          bindingsById,
          (target) => resolvedGeometryPropertyForContext(target, context),
          (target) => collectionLengthForTargetContext(target, context),
          (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
          (valueId) => collectionValueIdFor(valueId, context),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder,
          (target) => recordParameterCollectionForTargetContext(target, context)
        )
      : lowerExpression(
          source.target.index,
          (target) => rootBindingForTarget(target, source.target.targetSourceOrder),
          bindingsById,
          rootGeometryPropertyFor,
          rootCollectionLengthFor,
          resolvedGeometryBuiltinForRoot,
          (valueId) => collectionValueIdFor(valueId, null),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder,
          (target) => recordParameterCollectionForTargetContext(target, null)
        );
    const members = source.members.flatMap((member) => {
      const lowered = geometryInputTargetForAlias(member);
      if (!lowered) return [];
      const target = lowerGeometryInputTarget(lowered);
      return target ? [target] : [];
    });
    if (members.length !== source.members.length) return null;
    const value = source.value ? lowerCollectionNode(source.value) : null;
    if (source.value && !value) return null;
    return {
      kind: "collectionIndex",
      collectionValueId: collectionValueIdFor(source.target.collectionValueId, context ?? null),
      collectionLength: source.target.collectionLength ?? (source.value ? null : members.length),
      targetSourceOrder: context
        ? executionPositionForValue(context.path, source.target.targetSourceOrder)
        : executionPositionForValue([], source.target.targetSourceOrder),
      index: loweredIndex.expression,
      members: source.value ? [] : members,
      ...(value ? { value } : {})
    };
  };

  const geometryValueProgramTargetForInput = (
    source: RuntimeGeometryInputTarget,
    context: InstanceContext | undefined,
    executionPosition: number,
    geometryType: ModuleGeometryInterfaceType
  ): GeometryValueProgramTarget | undefined => {
    if (source.kind === "geometryValueMapPending") {
      if (!isModuleGeometryInterfaceAssignable(source.geometryType, geometryType)) return undefined;
      return {
        kind: "geometryValue",
        occurrence: source.occurrence,
        statementId: source.occurrence.sourceStatementId,
        statementIndex: executionPosition,
        geometryType: source.geometryType,
        ...(source.pointKey ? { pointKey: source.pointKey } : {}),
        ...(source.stagePath ? { stagePath: source.stagePath } : {})
      };
    }
    const lowered = lowerGeometryInputTarget(source);
    if (!lowered) return undefined;
    if (lowered.kind === "collectionIndex") {
      return { kind: "geometryInputTarget", target: lowered, geometryType };
    }
    if (lowered.kind === "drawable") {
      const statementIndex = elementOrderById.get(lowered.elementId);
      return statementIndex === undefined ? undefined : {
        statementId: lowered.elementId,
        statementIndex,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(lowered.stagePath ? { stagePath: lowered.stagePath } : {})
      };
    }
    if (lowered.kind === "geometryValue" || lowered.kind === "geometryValueMap") {
      return {
        kind: "geometryValue",
        occurrence: lowered.occurrence,
        statementId: lowered.occurrence.sourceStatementId,
        statementIndex: executionPosition,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(lowered.stagePath ? { stagePath: lowered.stagePath } : {})
      };
    }
    if (lowered.kind === "geometryCarry") {
      return {
        kind: "geometryCarry",
        bindingId: moduleCarryBindingIdFor(context?.path ?? [], lowered.bindingId),
        statementId: lowered.bindingId,
        statementIndex: executionPosition,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(lowered.stagePath ? { stagePath: lowered.stagePath } : {})
      };
    }
    if (lowered.kind === "forGroupOccurrence") {
      return {
        kind: "forGroupOccurrence",
        templateElementId: lowered.templateElementId,
        statementId: lowered.templateElementId,
        statementIndex: lowered.targetSourceOrder,
        targetSourceOrder: lowered.targetSourceOrder,
        index: lowered.index,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(lowered.stagePath ? { stagePath: lowered.stagePath } : {})
      };
    }
    return undefined;
  };

  for (const [bindingId, initializer, statementIndex] of documentBindingAnalysis
    ? (documentBindingAnalysis as BindingAnalysis).catalog.bindings
      .filter((binding) => binding.kind === "typed")
      .map((binding) => [binding.id, documentScalarProgram?.statements.find((statement) => statement.bindingId === binding.id)?.declaration.initializer, binding.statementIndex] as const)
    : []) {
    if (initializer) {
      const statementId = stableStatementIdByIndex.get(statementIndex);
      const semanticSite = statementId ? moduleSemanticAnalysis.rootScalarExpressionsByStatementId.get(statementId) : undefined;
      if (
        semanticSite &&
        !typedExpressionContainsImmutableCarryCollection(initializer) &&
        !typedExpressionContainsImmutableCarryProperty(initializer, statementIndex, sourceNamespace) &&
        !typedExpressionContainsImmutableCarryBinding(initializer)
      ) {
        const lowered = lowerExpression(
          semanticSite.expression,
          (target) => rootBindingForTarget(target, statementIndex),
          bindingsById,
          rootGeometryPropertyFor,
          rootCollectionLengthFor,
          resolvedGeometryBuiltinForRoot,
          (valueId) => collectionValueIdFor(valueId, null),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder,
          (target) => recordParameterCollectionForTargetContext(target, null)
        );
        initializers.set(bindingId, lowered.expression);
      } else {
        initializers.set(bindingId, remapTypedExpressionCollectionValueIds(initializer, (valueId) => collectionValueIdFor(valueId, null)));
      }
    }
  }
  for (const [bindingId, initializer] of moduleInitializers) initializers.set(bindingId, initializer);

  const geometryValueProgramEntries: GeometryValueProgramEntry[] = [];
  const geometryCarryNextPrograms = new Map<string, GeometryValueProgramNode>();

  const lowerGeometryValueScalar = (semantic: ModuleScalarExpressionSemantic, context?: InstanceContext) => {
    const lowered = context
      ? lowerExpression(
          semantic,
          (target) => resolvedBindingForContext(target, context),
          bindingsById,
          (target) => resolvedGeometryPropertyForContext(target, context),
          (target) => collectionLengthForTargetContext(target, context),
          (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
          (valueId) => collectionValueIdFor(valueId, context),
          (sourceOrder) => sourceOrder >= 0 ? runtimeEventPositionForValue(context.path, sourceOrder) : sourceOrder,
          (target) => recordParameterCollectionForTargetContext(target, context)
        )
      : lowerExpression(
          semantic,
          (target, name, statementIndex) => rootBindingForTarget(target, statementIndex),
          bindingsById,
          rootGeometryPropertyFor,
          rootCollectionLengthFor,
          resolvedGeometryBuiltinForRoot,
          (valueId) => collectionValueIdFor(valueId, null),
          (sourceOrder) => sourceOrder >= 0 ? runtimeEventPositionForValue([], sourceOrder) : sourceOrder
        );
    return lowered.expression;
  };

  const lowerGeometryValuePoint = (
    reference: import("../dsl/moduleSemanticTypes").ModuleGeometryReferenceSemantic,
    context: InstanceContext | undefined,
    executionPosition: number
  ): GeometryValueProgramPoint | undefined => {
    if (reference.coordinate?.x && reference.coordinate.y) {
      return {
        kind: "coordinate",
        x: lowerGeometryValueScalar(reference.coordinate.x, context),
        y: lowerGeometryValueScalar(reference.coordinate.y, context)
      };
    }
    if (reference.target?.kind === "geometryValueForBinder") {
      return {
        kind: "target",
        target: {
          kind: "geometryValueForBinder",
          binderId: reference.target.binderId,
          statementId: reference.target.statementId,
          statementIndex: executionPosition,
          geometryType: reference.target.sourceElementType,
          ...(reference.target.stagePath ? { stagePath: reference.target.stagePath } : {})
        }
      };
    }
    if (!reference.target || !moduleGeometryRuntime) return undefined;
    const path = context?.path ?? [];
    if (reference.target.kind === "collectionIndex") {
      const indexed = moduleGeometryRuntime.resolveGeometryCollectionIndexPoint(reference.target, path);
      if (!indexed) return undefined;
      if ("mode" in indexed) return lowerGeometryValueAnchor(indexed, executionPosition);
      const target = geometryValueProgramTargetForInput(indexed, context, executionPosition, "point");
      return target ? { kind: "target", target } : undefined;
    }
    const stagePath = "stagePath" in reference.target ? reference.target.stagePath : undefined;
    const lowered = moduleGeometryRuntime.resolveBuiltinTarget(reference.target, path, "point");
    if (!lowered) return undefined;
    const resolvedStagePath = stagePath ?? lowered.stagePath;
    if (lowered.kind === "geometryValue") {
      return {
        kind: "target",
        target: {
          kind: "geometryValue",
          occurrence: lowered.occurrence,
          statementId: lowered.occurrence.sourceStatementId,
          statementIndex: reference.target.kind === "geometryValue"
            ? executionPositionForValue(path, reference.target.statementIndex)
            : executionPosition,
          geometryType: lowered.geometryType,
          ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
          ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
        }
      };
    }
    if (lowered.kind === "forGroupOccurrence") {
      return {
        kind: "target",
        target: {
          kind: "forGroupOccurrence",
          templateElementId: lowered.templateElementId,
          statementId: lowered.templateElementId,
          statementIndex: lowered.targetSourceOrder,
          targetSourceOrder: lowered.targetSourceOrder >= 0
            ? executionPositionForValue(path, lowered.targetSourceOrder)
            : lowered.targetSourceOrder,
          index: lowered.index ? lowerGeometryValueScalar(lowered.index, context) : null,
          geometryType: lowered.geometryType,
          ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
          ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
        }
      };
    }
    if (lowered.kind === "geometryCarry") {
      return {
        kind: "target",
        target: {
          kind: "geometryCarry",
          bindingId: lowered.bindingId,
          statementId: lowered.bindingId,
          statementIndex: executionPosition,
          geometryType: lowered.geometryType,
          ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
          ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
        }
      };
    }
    const targetSourceOrder = elementOrderById.get(lowered.elementId);
    if (targetSourceOrder === undefined) return undefined;
    return {
      kind: "target",
      target: {
        statementId: lowered.elementId,
        statementIndex: targetSourceOrder,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
        ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
      }
    };
  };

  const lowerGeometryValuePath = (
    reference: import("../dsl/moduleSemanticTypes").ModuleGeometryReferenceSemantic,
    context: InstanceContext | undefined,
    executionPosition: number
  ): GeometryValueProgramPath | undefined => {
    const target = reference.target;
    const declaredInterfaceType = geometryInterfaceTypeForReference(reference, context) ?? reference.expectedGeometryKind;
    if (reference.target?.kind === "geometryValueForBinder") {
      return {
        kind: "target",
        target: {
          kind: "geometryValueForBinder",
          binderId: reference.target.binderId,
          statementId: reference.target.statementId,
          statementIndex: executionPosition,
          geometryType: reference.target.sourceElementType,
          ...(reference.target.stagePath ? { stagePath: reference.target.stagePath } : {})
        }
      };
    }
    if (!target || !moduleGeometryRuntime) return undefined;
    const path = context?.path ?? [];
    if (target.kind === "collectionIndex") {
      const indexed = moduleGeometryRuntime.resolveGeometryCollectionIndexLine(target, path);
      if (!indexed) return undefined;
      const indexedProgramTarget = geometryValueProgramTargetForInput(indexed, context, executionPosition, declaredInterfaceType);
      return indexedProgramTarget ? { kind: "target", target: indexedProgramTarget } : undefined;
    }
    const stagePath = "stagePath" in target ? target.stagePath : undefined;
    const lowered = moduleGeometryRuntime.resolveBuiltinTarget(target, path, declaredInterfaceType);
    if (!lowered) return undefined;
    const resolvedStagePath = stagePath ?? lowered.stagePath;
    if (lowered.kind === "geometryValue") {
      return {
        kind: "target",
        target: {
          kind: "geometryValue",
          occurrence: lowered.occurrence,
          statementId: lowered.occurrence.sourceStatementId,
          statementIndex: target.kind === "geometryValue"
            ? executionPositionForValue(path, target.statementIndex)
            : executionPosition,
          geometryType: lowered.geometryType,
          ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
        }
      };
    }
    if (lowered.kind === "forGroupOccurrence") {
      return {
        kind: "target",
        target: {
          kind: "forGroupOccurrence",
          templateElementId: lowered.templateElementId,
          statementId: lowered.templateElementId,
          statementIndex: lowered.targetSourceOrder,
          targetSourceOrder: lowered.targetSourceOrder >= 0
            ? executionPositionForValue(path, lowered.targetSourceOrder)
            : lowered.targetSourceOrder,
          index: lowered.index ? lowerGeometryValueScalar(lowered.index, context) : null,
          geometryType: lowered.geometryType,
          ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}),
          ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
        }
      };
    }
    if (lowered.kind === "geometryCarry") {
      return {
        kind: "target",
        target: {
          kind: "geometryCarry",
          bindingId: lowered.bindingId,
          statementId: lowered.bindingId,
          statementIndex: executionPosition,
          geometryType: lowered.geometryType,
          ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
        }
      };
    }
    const targetSourceOrder = elementOrderById.get(lowered.elementId);
    if (targetSourceOrder === undefined) return undefined;
    return {
      kind: "target",
      target: {
        statementId: lowered.elementId,
        statementIndex: targetSourceOrder,
        geometryType: lowered.geometryType,
        ...(resolvedStagePath ? { stagePath: resolvedStagePath } : {})
      }
    };
  };

  const lowerGeometryValueAnchor = (
    anchor: PointAnchor,
    executionPosition: number
  ): GeometryValueProgramPoint | undefined => {
    if (anchor.mode === "coordinate") {
      if (typeof anchor.x !== "number" || typeof anchor.y !== "number") return undefined;
      const numberLiteral = (value: number): TypedScalarExpression => ({
        kind: "numberLiteral",
        span: { start: 0, end: 0 },
        value,
        type: { kind: "number" }
      });
      return { kind: "coordinate", x: numberLiteral(anchor.x), y: numberLiteral(anchor.y) };
    }
    if (!moduleGeometryRuntime) return undefined;
    if (anchor.mode === "geometryValue") {
      return {
        kind: "target",
        target: {
          kind: "geometryValue",
          occurrence: anchor.occurrence,
          statementId: anchor.occurrence.sourceStatementId,
          statementIndex: executionPosition,
          geometryType: "point",
          ...(anchor.pointKey ? { pointKey: anchor.pointKey } : {})
        }
      };
    }
    const elementId = anchor.mode === "reference" ? anchor.pointId : anchor.elementId;
    const statementIndex = elementOrderById.get(elementId);
    if (statementIndex === undefined) return undefined;
    return {
      kind: "target",
      target: {
        statementId: elementId,
        statementIndex,
        geometryType: "point",
        ...(anchor.mode === "derived" ? { pointKey: anchor.pointKey } : {})
      }
    };
  };

  const lowerGeometryValueExpression = (
    value: import("../dsl/moduleSemanticTypes").ModuleGeometryValueSemantic,
    expression: import("../dsl/moduleSemanticTypes").ModuleGeometryValueExpressionSemantic,
    context: InstanceContext | undefined,
    executionPosition: number
  ): GeometryValueProgramNode | undefined => {
    if (expression.kind === "reference") {
      const lowered = expression.reference.expectedGeometryKind === "point"
        ? lowerGeometryValuePoint(expression.reference, context, executionPosition)
        : lowerGeometryValuePath(expression.reference, context, executionPosition);
      return lowered?.kind === "target" ? { kind: "reference", target: lowered.target } : undefined;
    }
    if (expression.kind === "construction") {
      return addGeometryValueProgramEntry(
        { ...value, valueExpression: null, construction: expression.construction },
        context,
        false
      );
    }
    if (expression.kind === "none") {
      return { kind: "none" };
    }
    if (expression.kind === "coalesce") {
      const left = lowerGeometryValueExpression(value, expression.left, context, executionPosition);
      const right = lowerGeometryValueExpression(value, expression.right, context, executionPosition);
      return left && right ? { kind: "coalesce", left, right } : undefined;
    }
    if (expression.kind === "if") {
      const condition = expression.condition ? lowerGeometryValueScalar(expression.condition, context) : null;
      const thenBranch = expression.thenBranch
        ? lowerGeometryValueExpression(value, expression.thenBranch, context, executionPosition)
        : undefined;
      const elseBranch: GeometryValueProgramNode = expression.elseBranch
        ? lowerGeometryValueExpression(value, expression.elseBranch, context, executionPosition) ?? { kind: "none" as const }
        : { kind: "none" as const };
      return condition && thenBranch
        ? { kind: "if", condition, thenBranch, elseBranch }
        : undefined;
    }
    const scrutinee = expression.scrutinee ? lowerGeometryValueScalar(expression.scrutinee, context) : null;
    const arms = expression.arms.flatMap((arm) => {
      const lowered = arm.expression
        ? lowerGeometryValueExpression(value, arm.expression, context, executionPosition)
        : undefined;
      return lowered ? [{ label: arm.label, expression: lowered }] : [];
    });
    return scrutinee && arms.length === expression.arms.length ? { kind: "match", scrutinee, arms } : undefined;
  };

  const geometryInputTargetsByRuntimeElementId = new Map<ElementId, ReadonlyMap<string, GeometryInputTarget | readonly GeometryInputTarget[]>>();
  const isTargetList = (source: RuntimeGeometryInputTarget | readonly RuntimeGeometryInputTarget[]): source is readonly RuntimeGeometryInputTarget[] => Array.isArray(source);
  for (const [elementId, sources] of moduleGeometryRuntime?.geometryInputTargetSourcesByRuntimeElementId ?? []) {
    const targets = new Map<string, GeometryInputTarget | readonly GeometryInputTarget[]>();
    for (const [parameterKey, source] of sources) {
      if (isTargetList(source)) {
        const lowered = source.flatMap((item) => {
          const target = lowerGeometryInputTarget(item);
          return target ? [target] : [];
        });
        if (lowered.length === source.length) targets.set(parameterKey, lowered);
      } else {
        const lowered = lowerGeometryInputTarget(source);
        if (lowered) targets.set(parameterKey, lowered);
      }
    }
    if (targets.size > 0) geometryInputTargetsByRuntimeElementId.set(elementId, targets);
  }
  for (const [elementId, targets] of moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId ?? []) {
    if (geometryInputTargetsByRuntimeElementId.has(elementId)) continue;
    geometryInputTargetsByRuntimeElementId.set(elementId, targets);
  }

  const appendRecordGeometryValuePrograms = ({
    recordTarget,
    recordValueExpression,
    recordDefinition,
    recordAnalysis,
    context,
    statementId,
    statementIndex,
    executionPath
  }: {
    recordTarget: ModuleRecordSourceTarget;
    recordValueExpression: ModuleRecordValueExpressionSemantic;
    recordDefinition: import("../dsl/recordSemanticAnalysis").RecordDefinitionSemantic;
    recordAnalysis: import("../dsl/recordSemanticAnalysis").RecordSemanticAnalysis | undefined;
    context?: InstanceContext;
    statementId: string;
    statementIndex: number;
    executionPath?: readonly string[];
  }) => {
    const path = context?.path ?? [];
    for (const { field, path: fieldPath, valueType } of recordFieldPathsFor(recordDefinition, recordAnalysis)) {
      if (!isDslGeometryValueType(valueType)) continue;
      const fieldValue = recordFieldValueExpressionAt(recordValueExpression, fieldPath);
      if (fieldValue?.kind !== "geometry" || !fieldValue.expression || fieldValue.expression.kind === "reference") continue;
      const occurrence = geometryValueOccurrenceForRecordField(recordTarget, fieldPath, path);
      const virtualValue: import("../dsl/moduleSemanticTypes").ModuleGeometryValueSemantic = {
        statementId: occurrence.sourceStatementId,
        statementIndex,
        name: `${statementId}.${field.name}`,
        declaredInterfaceType: valueType.kind,
        ownerModuleDefinitionStatementId: context?.definition.statementId ?? null,
        ownerModuleDefinitionStatementIndex: context?.definition.statementIndex ?? null,
        exported: false,
        initializer: null,
        construction: null,
        valueExpression: fieldValue.expression,
        backingTarget: null
      };
      const executionPosition = runtimeEventPositionForValue(executionPath ?? path, statementIndex);
      const construction = lowerGeometryValueExpression(virtualValue, fieldValue.expression, context, executionPosition);
      if (!construction) continue;
      geometryValueProgramEntries.push({
        sourceStatementId: occurrence.sourceStatementId,
        sourceStatementIndex: statementIndex,
        declaredInterfaceType: valueType.kind,
        occurrence,
        sourceExecutionPosition: executionPosition,
        executionPosition,
        construction
      });
    }
  };

  const addGeometryValueProgramEntry = (
    value: import("../dsl/moduleSemanticTypes").ModuleGeometryValueSemantic,
    context?: InstanceContext,
    emit = true
  ): GeometryValueProgramNode | undefined => {
    const path = context?.path ?? [];
    const executionPosition = runtimeEventPositionForValue(path, value.statementIndex);
    if (value.valueExpression) {
      const expression = lowerGeometryValueExpression(value, value.valueExpression, context, executionPosition);
      if (!expression) return undefined;
      if (emit) {
        geometryValueProgramEntries.push({
          sourceStatementId: value.statementId,
          sourceStatementIndex: value.statementIndex,
          declaredInterfaceType: value.declaredInterfaceType,
          occurrence: { sourceStatementId: value.statementId, instancePath: [...path] },
          sourceExecutionPosition: executionPosition,
          executionPosition,
          construction: expression
        });
      }
      return expression;
    }
    if (value.initializer) {
      const lowered = value.initializer.expectedGeometryKind === "point"
        ? lowerGeometryValuePoint(value.initializer, context, executionPosition)
        : lowerGeometryValuePath(value.initializer, context, executionPosition);
      if (!lowered) return undefined;
      const construction: GeometryValueProgramNode = lowered.kind === "target"
        ? { kind: "reference", target: lowered.target }
        : { kind: "coordinate", x: lowered.x, y: lowered.y };
      if (emit) {
        geometryValueProgramEntries.push({
          sourceStatementId: value.statementId,
          sourceStatementIndex: value.statementIndex,
          declaredInterfaceType: value.declaredInterfaceType,
          occurrence: { sourceStatementId: value.statementId, instancePath: [...path] },
          sourceExecutionPosition: executionPosition,
          executionPosition,
          construction
        });
      }
      return construction;
    }
    if (!value.construction) return undefined;
    const construction = value.construction.kind === "coordinate"
      ? value.construction.x && value.construction.y
        ? {
            kind: "coordinate" as const,
            x: lowerGeometryValueScalar(value.construction.x, context),
            y: lowerGeometryValueScalar(value.construction.y, context)
          }
        : null
      : value.construction.kind === "offsetPoint"
        ? (() => {
            const from = lowerGeometryValuePoint(value.construction.from, context, executionPosition);
            const dx = value.construction.dx ? lowerGeometryValueScalar(value.construction.dx, context) : null;
            const dy = value.construction.dy ? lowerGeometryValueScalar(value.construction.dy, context) : null;
            return from && dx && dy ? { kind: "offsetPoint" as const, from, dx, dy } : null;
          })()
      : value.construction.kind === "polarPoint"
        ? (() => {
            const from = lowerGeometryValuePoint(value.construction.from, context, executionPosition);
            const angleDeg = value.construction.angle ? lowerGeometryValueScalar(value.construction.angle, context) : null;
            const distance = value.construction.distance ? lowerGeometryValueScalar(value.construction.distance, context) : null;
            return from && angleDeg && distance ? { kind: "polarPoint" as const, from, angleDeg, distance } : null;
          })()
      : value.construction.kind === "between"
        ? (() => {
            const start = lowerGeometryValuePoint(value.construction.start, context, executionPosition);
            const end = lowerGeometryValuePoint(value.construction.end, context, executionPosition);
            const placement = lowerGeometryValueScalar(value.construction.placement.value, context);
            return start && end && placement
              ? { kind: "between" as const, start, end, placement: { kind: value.construction.placement.kind, value: placement } }
              : null;
          })()
      : value.construction.kind === "onLine"
        ? (() => {
            const line = lowerGeometryValuePath(value.construction.line, context, executionPosition);
            const placement = lowerGeometryValueScalar(value.construction.placement.value, context);
            return line && placement
              ? { kind: "onLine" as const, line, endpointKey: value.construction.endpointKey, placement: { kind: value.construction.placement.kind, value: placement } }
              : null;
          })()
      : value.construction.kind === "intersection"
        ? (() => {
            const line1 = lowerGeometryValuePath(value.construction.line1, context, executionPosition);
            const line2 = lowerGeometryValuePath(value.construction.line2, context, executionPosition);
            const index = value.construction.index ? lowerGeometryValueScalar(value.construction.index, context) : null;
            const extensions = value.construction.extensions ? lowerGeometryValueScalar(value.construction.extensions, context) : null;
            return line1 && line2 && index && extensions
              ? { kind: "intersection" as const, line1, line2, index, extensions }
              : null;
          })()
      : value.construction.kind === "commonTangent"
        ? (() => {
            const first = lowerGeometryValuePath(value.construction.first, context, executionPosition);
            const second = lowerGeometryValuePath(value.construction.second, context, executionPosition);
            const tangentKind = value.construction.tangentKind
              ? lowerGeometryValueScalar(value.construction.tangentKind, context)
              : null;
            const side = value.construction.side
              ? lowerGeometryValueScalar(value.construction.side, context)
              : null;
            return first && second && tangentKind && side
              ? { kind: "commonTangent" as const, first, second, tangentKind, side }
              : null;
          })()
      : value.construction.kind === "tangentOffset"
        ? (() => {
            const line = lowerGeometryValuePath(value.construction.line, context, executionPosition);
            const base = lowerGeometryValuePoint(value.construction.base, context, executionPosition);
            const angleDeg = value.construction.angle ? lowerGeometryValueScalar(value.construction.angle, context) : null;
            const curveSide = value.construction.curveSide ? lowerGeometryValueScalar(value.construction.curveSide, context) : null;
            const distance = value.construction.distance ? lowerGeometryValueScalar(value.construction.distance, context) : null;
            return line && base && distance
              ? { kind: "tangentOffset" as const, line, base, angleDeg, curveSide, distance }
              : null;
          })()
      : value.construction.kind === "bezierExtremePoint"
        ? (() => {
            const source = lowerGeometryValuePath(value.construction.source, context, executionPosition);
            const segmentIndex = value.construction.segmentIndex ? lowerGeometryValueScalar(value.construction.segmentIndex, context) : null;
            const direction = value.construction.direction ? lowerGeometryValueScalar(value.construction.direction, context) : null;
            return source && segmentIndex && direction
              ? { kind: "bezierExtremePoint" as const, source, segmentIndex, direction }
              : null;
          })()
      : value.construction.kind === "bezierBulgePoint"
        ? (() => {
            const source = lowerGeometryValuePath(value.construction.source, context, executionPosition);
            const segmentIndex = value.construction.segmentIndex ? lowerGeometryValueScalar(value.construction.segmentIndex, context) : null;
            return source && segmentIndex
              ? { kind: "bezierBulgePoint" as const, source, segmentIndex }
              : null;
          })()
      : value.construction.kind === "segment"
        ? (() => {
            const start = lowerGeometryValuePoint(value.construction.start, context, executionPosition);
            const end = lowerGeometryValuePoint(value.construction.end, context, executionPosition);
            return start && end ? { kind: "segment" as const, start, end } : null;
          })()
      : value.construction.kind === "polarLine"
        ? (() => {
            const start = lowerGeometryValuePoint(value.construction.start, context, executionPosition);
            const angleDeg = value.construction.angle ? lowerGeometryValueScalar(value.construction.angle, context) : null;
            const length = value.construction.length ? lowerGeometryValueScalar(value.construction.length, context) : null;
            return start && angleDeg && length ? { kind: "polarLine" as const, start, angleDeg, length } : null;
          })()
      : value.construction.kind === "arc"
          ? (() => {
            const center = lowerGeometryValuePoint(value.construction.center, context, executionPosition);
            const radius = value.construction.radius ? lowerGeometryValueScalar(value.construction.radius, context) : null;
            const startAngleDeg = value.construction.start ? lowerGeometryValueScalar(value.construction.start, context) : null;
            const endAngleDeg = value.construction.end ? lowerGeometryValueScalar(value.construction.end, context) : null;
            const direction = value.construction.direction ? lowerGeometryValueScalar(value.construction.direction, context) : null;
            return center && radius && startAngleDeg && endAngleDeg && direction
              ? { kind: "arc" as const, center, radius, startAngleDeg, endAngleDeg, direction }
              : null;
            })()
            : value.construction.kind === "through"
            ? (() => {
              const point1 = lowerGeometryValuePoint(value.construction.point1, context, executionPosition);
              const point2 = lowerGeometryValuePoint(value.construction.point2, context, executionPosition);
              const point3 = lowerGeometryValuePoint(value.construction.point3, context, executionPosition);
              const startAngleDeg = value.construction.start ? lowerGeometryValueScalar(value.construction.start, context) : null;
              const endAngleDeg = value.construction.end ? lowerGeometryValueScalar(value.construction.end, context) : null;
              return point1 && point2 && point3 && startAngleDeg && endAngleDeg
                ? { kind: "through" as const, point1, point2, point3, startAngleDeg, endAngleDeg }
                : null;
            })()
            : value.construction.kind === "bezier"
              ? (() => {
                const start = lowerGeometryValuePoint(value.construction.start, context, executionPosition);
                const end = lowerGeometryValuePoint(value.construction.end, context, executionPosition);
                const startAngleDeg = value.construction.startAngle ? lowerGeometryValueScalar(value.construction.startAngle, context) : null;
                const startLength = value.construction.startLength ? lowerGeometryValueScalar(value.construction.startLength, context) : null;
                const endAngleDeg = value.construction.endAngle ? lowerGeometryValueScalar(value.construction.endAngle, context) : null;
                const endLength = value.construction.endLength ? lowerGeometryValueScalar(value.construction.endLength, context) : null;
                const intermediates = value.construction.intermediates.flatMap((intermediate) => {
                  const point = lowerGeometryValuePoint(intermediate.point, context, executionPosition);
                  const angleDeg = intermediate.angle ? lowerGeometryValueScalar(intermediate.angle, context) : null;
                  const incomingLength = intermediate.incomingLength ? lowerGeometryValueScalar(intermediate.incomingLength, context) : null;
                  const outgoingLength = intermediate.outgoingLength ? lowerGeometryValueScalar(intermediate.outgoingLength, context) : null;
                  return point && angleDeg && incomingLength && outgoingLength
                    ? [{ point, angleDeg, incomingLength, outgoingLength }]
                    : [];
                });
                return start && end && startAngleDeg && startLength && endAngleDeg && endLength && intermediates.length === value.construction.intermediates.length
                  ? { kind: "bezier" as const, start, end, startAngleDeg, startLength, endAngleDeg, endLength, intermediates }
                  : null;
              })()
              : value.construction.kind === "transformCopy"
                ? (() => {
                    const startPoint = lowerGeometryValuePoint(value.construction.startPoint, context, executionPosition);
                    const endPoint = lowerGeometryValuePoint(value.construction.endPoint, context, executionPosition);
                    const scale = value.construction.scale ? lowerGeometryValueScalar(value.construction.scale, context) : null;
                    const angleDeg = value.construction.angleDeg ? lowerGeometryValueScalar(value.construction.angleDeg, context) : null;
                    const mirrorX = value.construction.mirrorX ? lowerGeometryValueScalar(value.construction.mirrorX, context) : null;
                    const baseLines = value.construction.baseLines.flatMap((source) => {
                      const lowered = lowerGeometryValuePath(source, context, executionPosition);
                      return lowered ? [lowered] : [];
                    });
                    return startPoint && endPoint && scale && angleDeg && mirrorX && baseLines.length === value.construction.baseLines.length
                      ? { kind: "transformCopy" as const, startPoint, endPoint, scale, angleDeg, mirrorX, baseLines }
                      : null;
                  })()
                : value.construction.kind === "mirrorCopy"
                  ? (() => {
                      const axis1 = lowerGeometryValuePoint(value.construction.axis1, context, executionPosition);
                      const axis2 = lowerGeometryValuePoint(value.construction.axis2, context, executionPosition);
                      const baseLines = value.construction.baseLines.flatMap((source) => {
                        const lowered = lowerGeometryValuePath(source, context, executionPosition);
                        return lowered ? [lowered] : [];
                      });
                      return axis1 && axis2 && baseLines.length === value.construction.baseLines.length
                        ? { kind: "mirrorCopy" as const, axis1, axis2, baseLines }
                        : null;
                    })()
              : value.construction.kind === "offsetPath"
                ? (() => {
                    const sources = value.construction.sources.flatMap((source) => {
                      const lowered = lowerGeometryValuePath(source, context, executionPosition);
                      return lowered ? [lowered] : [];
                    });
                    const distance = value.construction.distance ? lowerGeometryValueScalar(value.construction.distance, context) : null;
                    const side = value.construction.side ? lowerGeometryValueScalar(value.construction.side, context) : null;
                    const closed = value.construction.closed ? lowerGeometryValueScalar(value.construction.closed, context) : null;
                    const suppressTrimWarnings = value.construction.suppressTrimWarnings
                      ? lowerGeometryValueScalar(value.construction.suppressTrimWarnings, context)
                      : null;
                    return distance && side && closed && suppressTrimWarnings && sources.length === value.construction.sources.length
                      ? { kind: "offsetPath" as const, sources, distance, side, closed, suppressTrimWarnings }
                      : null;
                  })()
              : value.construction.kind === "joinedPath"
                ? (() => {
                    const paths = value.construction.paths.flatMap((source) => {
                      const lowered = lowerGeometryValuePath(source, context, executionPosition);
                      return lowered ? [lowered] : [];
                    });
                    const closed = value.construction.closed ? lowerGeometryValueScalar(value.construction.closed, context) : null;
                    return closed && paths.length === value.construction.paths.length
                      ? { kind: "joinedPath" as const, paths, closed }
                      : null;
                  })()
              : (() => {
                const resolvedPoints = value.construction.pointsReference
                  ? moduleGeometryRuntime?.resolvePointReferenceList(
                    value.construction.pointsReference.source,
                    value.statementIndex,
                    path
                  ) ?? null
                  : null;
                const resolvedPointAnchors: readonly PointAnchor[] | null = value.construction.pointsReference
                  ? Array.isArray(resolvedPoints) ? resolvedPoints : null
                  : null;
                if (value.construction.pointsReference && resolvedPoints && !resolvedPointAnchors) return null;
                const points = value.construction.pointsReference
                  ? (resolvedPointAnchors ?? []).flatMap((anchor: PointAnchor) => {
                    const lowered = lowerGeometryValueAnchor(anchor, executionPosition);
                    return lowered ? [lowered] : [];
                  })
                  : value.construction.points.flatMap((point) => {
                    const lowered = lowerGeometryValuePoint(point, context, executionPosition);
                    return lowered ? [lowered] : [];
                  });
                const closed = value.construction.closed ? lowerGeometryValueScalar(value.construction.closed, context) : null;
                return closed && (value.construction.pointsReference || points.length === value.construction.points.length)
                  ? { kind: "polyline" as const, points, closed }
                  : null;
              })();
    if (!construction) return;
    if (!emit) return construction;
    geometryValueProgramEntries.push({
      sourceStatementId: value.statementId,
      sourceStatementIndex: value.statementIndex,
      declaredInterfaceType: value.declaredInterfaceType,
      occurrence: { sourceStatementId: value.statementId, instancePath: [...path] },
      sourceExecutionPosition: executionPosition,
      executionPosition,
      construction
    });
    return construction;
  };

  const addGeometryMapProgramEntries = (
    value: import("../dsl/geometryArraySemanticAnalysis").GeometryArrayValueSemantic,
    context?: InstanceContext
  ) => {
    if (value.value?.kind !== "map" || !moduleGeometryRuntime) return;
    const mappedValue = value.value;
    const body = mappedValue.body ?? context?.definition.mappedGeometryCollectionBodies?.find((candidate) => candidate.statementId === value.statementId)?.body;
    if (!body) return;
    const path = context?.path ?? [];
    const aliases = moduleGeometryRuntime.resolveGeometryArrayAliasesForValueId?.(mappedValue.sourceValueId, path);
    if (!aliases) return;
    const virtualValue: import("../dsl/moduleSemanticTypes").ModuleGeometryValueSemantic = {
      statementId: value.statementId,
      statementIndex: value.statementIndex,
      name: value.name,
      declaredInterfaceType: mappedValue.resultElementType,
      ownerModuleDefinitionStatementId: context?.definition.statementId ?? null,
      ownerModuleDefinitionStatementIndex: context?.definition.statementIndex ?? null,
      initializer: null,
      construction: null,
      valueExpression: body,
      backingTarget: null
      ,
      exported: false
    };
    const executionPosition = runtimeEventPositionForValue(path, value.statementIndex);
    aliases.forEach((_alias: GeometryAlias, memberIndex: number) => {
      const occurrence = {
        sourceStatementId: value.statementId,
        instancePath: [...path],
        mappedMemberIndex: memberIndex
      };
      const expression = lowerGeometryValueExpression(virtualValue, body, context, executionPosition);
      if (!expression) return;
      lazyGeometryValuePrograms.set(geometryValueOccurrenceKey(occurrence), expression);
      geometryValueProgramEntries.push({
        sourceStatementId: value.statementId,
        sourceStatementIndex: value.statementIndex,
        declaredInterfaceType: mappedValue.resultElementType,
        occurrence,
        sourceExecutionPosition: executionPosition,
        executionPosition,
        construction: expression,
        lazy: true
      });
    });
  };

  for (const value of moduleSemanticAnalysis.geometryValues) {
    if (value.ownerModuleDefinitionStatementId !== null) continue;
    addGeometryValueProgramEntry(value);
  }
  for (const value of geometryCarryNextValues) {
    const construction = addGeometryValueProgramEntry(value, undefined, false);
    if (construction) geometryCarryNextPrograms.set(value.statementId, construction);
  }
  for (const recordValue of moduleSemanticAnalysis.rootRecordValuesByStatementId.values()) {
    if (!recordValue.target || !recordValue.valueExpression || !recordValue.value.typeIdentity) continue;
    const recordAnalysis = sourceNamespace?.recordSemanticAnalysis ?? undefined;
    const recordDefinition = recordAnalysis?.definitionsByStatementId.get(recordValue.value.typeIdentity);
    if (!recordDefinition) continue;
    appendRecordGeometryValuePrograms({
      recordTarget: recordValue.target,
      recordValueExpression: recordValue.valueExpression,
      recordDefinition,
      recordAnalysis,
      statementId: recordValue.value.statementId,
      statementIndex: recordValue.value.statementIndex
    });
  }
  for (const context of contextsByKey.values()) {
    if (contextIsDisabled(context) || !contextIsReachable(context)) continue;
    for (const value of context.definition.localGeometryValues) addGeometryValueProgramEntry(value, context);
    const recordAnalysis = sourceNamespaceForContext(context)?.recordSemanticAnalysis ?? undefined;
    for (const recordValue of context.definition.recordValues) {
      if (!recordValue.target || !recordValue.valueExpression || !recordValue.value.typeIdentity) continue;
      const recordDefinition = recordAnalysis?.definitionsByStatementId.get(recordValue.value.typeIdentity);
      if (!recordDefinition) continue;
      appendRecordGeometryValuePrograms({
        recordTarget: recordValue.target,
        recordValueExpression: recordValue.valueExpression,
        recordDefinition,
        recordAnalysis,
        context,
        statementId: recordValue.value.statementId,
        statementIndex: recordValue.value.statementIndex
      });
    }
    for (const parameter of context.definition.parameters) {
    const recordAnalysis = sourceNamespaceForContext(context)?.recordSemanticAnalysis ?? undefined;
      const recordParameter = recordAnalysis?.moduleParameters.find((candidate) =>
        candidate.definitionStatementId === parameter.definitionStatementId && candidate.parameterIndex === parameter.parameterIndex
      );
      if (!recordParameter?.typeIdentity) continue;
      const binding = context.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      if (binding?.value?.kind !== "record" || !binding.value.reference.constructor) continue;
      const recordDefinition = recordAnalysis?.definitionsByStatementId.get(recordParameter.typeIdentity);
      if (!recordDefinition) continue;
      appendRecordGeometryValuePrograms({
        recordTarget: {
          kind: "recordParameter",
          definitionStatementId: parameter.definitionStatementId,
          parameterIndex: parameter.parameterIndex,
          typeIdentity: recordParameter.typeIdentity,
          ...(parameter.definitionIdentity ? { definitionIdentity: parameter.definitionIdentity } : {})
        },
        recordValueExpression: {
          kind: "constructor",
          span: binding.value.reference.span,
          constructor: binding.value.reference.constructor
        },
        recordDefinition,
        recordAnalysis,
        context,
        statementId: parameter.definitionStatementId,
        statementIndex: context.instance.statementIndex,
        executionPath: context.path.slice(0, -1)
      });
    }
    const source = context.definitionDocumentId && moduleRuntimeContext
      ? moduleRuntimeContext.documentFor(context.definitionDocumentId)?.sourceLexicalNamespace.geometryArraySemanticAnalysis
      : sourceNamespace?.geometryArraySemanticAnalysis;
    for (const value of source?.values ?? []) {
      if (value.ownerModuleDefinitionStatementIndex === context.definition.statementIndex) addGeometryMapProgramEntries(value, context);
    }
  }
  for (const value of sourceNamespace?.geometryArraySemanticAnalysis?.values ?? []) {
    if (value.ownerModuleDefinitionStatementIndex === null) addGeometryMapProgramEntries(value);
  }
  geometryValueProgramEntries.sort((left, right) =>
    left.executionPosition - right.executionPosition ||
    left.sourceStatementIndex - right.sourceStatementIndex ||
    left.occurrence.instancePath.join("\u0000").localeCompare(right.occurrence.instancePath.join("\u0000"))
  );
  const geometryValueProgram: GeometryValueProgram = geometryValueProgramEntries;

  const geometryCollectionNodesByValueId = new Map<string, GeometryInputCollectionNode>();
  const registerGeometryCollectionNode = (
    valueId: string,
    currentPath: readonly string[],
    context: InstanceContext | null
  ) => {
    const runtimeNode = moduleGeometryRuntime?.resolveGeometryArrayCollectionForValueId?.(valueId, currentPath);
    if (!runtimeNode) return;
    const lowered = lowerCollectionNode(runtimeNode);
    if (!lowered) return;
    geometryCollectionNodesByValueId.set(collectionValueIdFor(valueId, context), lowered);
  };
  for (const value of moduleSemanticAnalysis.geometryValues) {
    if (value.ownerModuleDefinitionStatementId === null) {
      registerGeometryCollectionNode(value.statementId, [], null);
    }
  }
  for (const value of sourceNamespace?.geometryArraySemanticAnalysis?.values ?? []) {
    if (value.ownerModuleDefinitionStatementIndex === null) {
      registerGeometryCollectionNode(value.statementId, [], null);
    }
  }
  for (const context of contextsByKey.values()) {
    if (contextIsDisabled(context) || !contextIsReachable(context)) continue;
    const contextCollectionAnalysis = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis;
    for (const parameter of contextCollectionAnalysis?.moduleParameters ?? []) {
      if (parameter.definitionStatementId !== context.definition.statementId) continue;
      registerGeometryCollectionNode(
        `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`,
        context.path,
        context
      );
    }
    for (const value of context.definition.localGeometryValues) {
      registerGeometryCollectionNode(value.statementId, context.path, context);
    }
    const source = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis;
    for (const value of source?.values ?? []) {
      if (value.ownerModuleDefinitionStatementIndex === context.definition.statementIndex) {
        registerGeometryCollectionNode(value.statementId, context.path, context);
      }
    }
  }
  for (const collection of moduleCollectionValues) {
    if (collection.kind !== "alias") continue;
    const target = geometryCollectionNodesByValueId.get(collection.targetValueId);
    if (target) geometryCollectionNodesByValueId.set(collection.valueId, target);
  }

  const replaceLazyGeometryMapPrograms = (target: GeometryInputTarget): GeometryInputTarget => {
    if (target.kind === "geometryValueMap") {
      return {
        ...target,
        program: lazyGeometryValuePrograms.get(geometryValueOccurrenceKey(target.occurrence)) ?? target.program,
        source: replaceLazyGeometryMapPrograms(target.source as GeometryInputTarget) as Exclude<GeometryInputTarget, { kind: "collectionIndex" | "geometryValueMap" }>
      };
    }
    const replaceCollectionNode = (node: GeometryInputCollectionNode): GeometryInputCollectionNode => {
      if (node.kind === "none") return node;
      if (node.kind === "leaf") return { kind: "leaf", targets: node.targets.map(replaceLazyGeometryMapPrograms) as Exclude<GeometryInputTarget, { kind: "collectionIndex" | "collectionValue" }>[] };
      if (node.kind === "geometryValueMap") return {
        ...node,
        source: node.source.kind === "node"
          ? { ...node.source, node: replaceCollectionNode(node.source.node) }
          : node.source,
        program: replaceLazyProgramsInGeometryValueProgram(node.program) as GeometryValueProgramNode
      };
      if (node.kind === "if") return { ...node, thenBranch: replaceCollectionNode(node.thenBranch), elseBranch: replaceCollectionNode(node.elseBranch) };
      if (node.kind === "coalesce") return { ...node, leftBranch: replaceCollectionNode(node.leftBranch), rightBranch: replaceCollectionNode(node.rightBranch) };
      return { ...node, arms: node.arms.map((arm) => ({ ...arm, value: replaceCollectionNode(arm.value) })) };
    };
    if (target.kind === "collectionValue") return { ...target, value: replaceCollectionNode(target.value) };
    if (target.kind === "collectionIndex") return { ...target, members: target.members.map(replaceLazyGeometryMapPrograms), ...(target.value ? { value: replaceCollectionNode(target.value) } : {}) };
    return target;
  };
  const replaceLazyProgramsInGeometryValueProgram = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(replaceLazyProgramsInGeometryValueProgram);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (record.kind === "geometryInputTarget" && record.target && typeof record.target === "object") {
      return {
        ...record,
        target: replaceLazyGeometryMapPrograms(record.target as GeometryInputTarget)
      };
    }
    return Object.fromEntries(Object.entries(record).map(([key, nested]) => [
      key,
      replaceLazyProgramsInGeometryValueProgram(nested)
    ]));
  };
  for (const entry of geometryValueProgramEntries) {
    entry.construction = replaceLazyProgramsInGeometryValueProgram(entry.construction) as GeometryValueProgramNode;
  }
  for (const [elementId, targets] of geometryInputTargetsByRuntimeElementId) {
    const replaced = new Map<string, GeometryInputTarget | readonly GeometryInputTarget[]>();
    for (const [parameterKey, target] of targets) {
      replaced.set(parameterKey, Array.isArray(target)
        ? target.map((item) => replaceLazyGeometryMapPrograms(item))
        : replaceLazyGeometryMapPrograms(target as GeometryInputTarget));
    }
    geometryInputTargetsByRuntimeElementId.set(elementId, replaced);
  }

  const sourceOrderByBindingId = new Map<BindingId, number>();
  for (const [bindingId, order] of eventOrderByBindingId) sourceOrderByBindingId.set(bindingId, order);
  const documentCollectionValues = (documentScalarProgram?.collectionValues ?? []).map((value): ScalarProgramCollection => {
    if (value.kind === "alias") return { ...value, targetValueId: collectionValueIdFor(value.targetValueId, null) };
    if (value.kind === "map") return {
      ...value,
      sourceValueId: collectionValueIdFor(value.sourceValueId, null),
      body: remapTypedExpressionCollectionValueIds(value.body, (valueId) => collectionValueIdFor(valueId, null))
    };
    if (value.kind === "recordMap") return {
      ...value,
      sourceValueId: collectionValueIdFor(value.sourceValueId, null),
      fields: value.fields.map((field) => ({
        ...field,
        body: remapTypedExpressionCollectionValueIds(field.body, (valueId) => collectionValueIdFor(valueId, null))
      }))
    };
    if (value.kind === "recordField") return {
      ...value,
      sourceValueId: collectionValueIdFor(value.sourceValueId, null)
    };
    if (value.kind === "if") {
      return {
        ...value,
        condition: remapTypedExpressionCollectionValueIds(
          remapTypedExpressionSourceOrders(value.condition, (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder),
          (valueId) => collectionValueIdFor(valueId, null)
        ),
        sourceOrder: executionPositionForValue([], value.sourceOrder)
      };
    }
    if (value.kind === "match") {
      return {
        ...value,
        scrutinee: remapTypedExpressionCollectionValueIds(
          remapTypedExpressionSourceOrders(value.scrutinee, (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder),
          (valueId) => collectionValueIdFor(valueId, null)
        ),
        sourceOrder: executionPositionForValue([], value.sourceOrder)
      };
    }
    return value;
  });
  const scalarProgram = lowerScalarProgram({
    bindingAnalysis: combinedAnalysis,
    typedInitializerByBindingId: initializers,
    positionMap: documentBindingAnalysis?.catalog ? { sourceOrderByElementIndex: [] } : { sourceOrderByElementIndex: [] },
    sourceOrderByBindingId,
    collectionValues: [
      ...documentCollectionValues,
      ...moduleCollectionValues.filter((value) =>
        !documentCollectionValues.some((documentValue) => documentValue.valueId === value.valueId)
      ),
      ...foreignCollectionValues
    ]
  });
  const materializedCollectionValueIds = new Set([
    ...(scalarProgram.collectionValues ?? []).map((value) => value.valueId),
    ...geometryCollectionNodesByValueId.keys()
  ]);
  const materializedForGroupCollectionSourcesByElementId = new Map<ElementId, MaterializedForGroupCollectionSource>();
  for (const entry of moduleMaterialization.executionStatements) {
    if (entry.type !== "forGroup" || entry.runtimeIdentity?.kind !== "moduleBody") continue;
    const context = contextsByKey.get(pathKey(entry.runtimeInstancePath ?? entry.instancePath));
    if (!context || !contextIsReachable(context)) continue;
    const body = context.definition.bodyStatements.find((candidate) => candidate.statementId === entry.sourceStatementId);
    if (!body || !moduleBodyStatementIsReachable(context, body)) continue;
    if (entry.statement.kind !== "element" || entry.statement.type !== "forGroup" || !entry.statement.forSource) continue;

    const parsedSource = parseDslSourceReference(entry.statement.forSource);
    if (parsedSource.kind !== "valid") continue;
    const sourceNamespace = sourceNamespaceForContext(context);
    if (!sourceNamespace) continue;
    const lookup = resolveSourceLexicalPath(sourceNamespace, entry.sourceStatementIndex, parsedSource.reference.path);
    let valueType: DslValueType | null;
    let sourceValueId: string;
    let sourceStatementIndex: number;
    if (lookup.kind === "resolved") {
      const declaration = lookup.declaration;
      valueType = declaration.statement.kind === "typedDeclaration"
        ? declaration.statement.valueType
        : declaration.kind === "carry" && declaration.statement.kind === "element"
          ? declaration.statement.forCarries?.find((carry) => carry.name === declaration.name)?.valueType ?? null
          : null;
      sourceValueId = declaration.kind === "carry"
        ? immutableCarryCollectionValueId(`binding:${declaration.statementId}`)
        : declaration.statementId;
      sourceStatementIndex = declaration.statementIndex;
    } else if (
      lookup.kind === "undefined" &&
      !parsedSource.reference.path.absolute &&
      parsedSource.reference.path.segments.length === 1
    ) {
      const parameter = context.definition.parameters.find((candidate) =>
        candidate.definitionStatementId === context.definition.statementId &&
        candidate.name === parsedSource.reference.path.segments[0]
      );
      if (!parameter || !isDslArrayValueType(parameter.valueType)) continue;
      const parameterCollectionType = sourceNamespace.geometryArraySemanticAnalysis?.genericModuleParametersBySlot.get(
        `${parameter.definitionStatementId}:${parameter.parameterIndex}`
      )?.valueType;
      valueType = parameterCollectionType ?? parameter.valueType;
      sourceValueId = `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`;
      sourceStatementIndex = context.definition.statementIndex;
    } else {
      continue;
    }
    if (!isDslArrayValueType(valueType)) continue;

    const iterationSourceValueId = collectionValueIdFor(sourceValueId, context);
    if (!materializedCollectionValueIds.has(iterationSourceValueId)) continue;
    const iterationElementType = scalarTypeOfDslValueType(valueType.elementType);
    materializedForGroupCollectionSourcesByElementId.set(entry.runtimeElementId, {
      iterationSourceValueId,
      iterationSourceOrder: executionPositionForValue(context.path, sourceStatementIndex),
      iterationElementValueType: valueType.elementType,
      ...(iterationElementType ? { iterationElementType } : {})
    });
  }
  const sourceOrderByStatementIndex = new Map(eventOrderByStatementIndex);
  let nextSourceOrder = events.length;
  for (let statementIndex = statements.length - 1; statementIndex >= 0; statementIndex -= 1) {
    const exactOrder = sourceOrderByStatementIndex.get(statementIndex);
    if (exactOrder !== undefined) nextSourceOrder = exactOrder;
    else sourceOrderByStatementIndex.set(statementIndex, nextSourceOrder);
  }
  // A Module carry's loop boundary is also the boundary for every owner-chain
  // entry produced below. Clamp it before control metadata is qualified so
  // BindingVersionGraph, the Module owner projection, and the immutable carry
  // plan all transport one canonical execution boundary.
  for (const context of contextsByKey.values()) {
    if (!contextIsReachable(context)) continue;
    const definitionScopeIndex = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.sourceLexicalNamespace.scopeIndex ?? sourceScopeIndex;
    for (const carry of context.definition.immutableCarries ?? []) {
      if (!carry.type || !carry.initializer || !carry.next) continue;
      const binding = context.carries.get(carry.bindingId);
      if (!binding || !moduleInitializers.has(binding.id) || !moduleCarryNextExpressions.has(binding.id)) continue;
      const loopScopeId = `for:${carry.statementId}`;
      const parameterBindingIds = new Set([
        ...[...context.parameters.values()].map((parameter) => parameter.id),
        ...[...context.recordParameters.values()].flatMap((fields) => [...fields.values()].map((field) => field.id)),
        ...[...context.recordParameterFieldBindingsByPath.values()].flatMap((fields) => [...fields.values()].map((field) => field.id))
      ]);
      const isInsideLoopScope = (statementIndex: number): boolean => {
        let scopeId = definitionScopeIndex?.scopeOfStatement.get(statementIndex);
        while (scopeId) {
          if (scopeId === loopScopeId) return true;
          scopeId = definitionScopeIndex?.scopes.get(scopeId)?.parentId ?? undefined;
        }
        return false;
      };
      const firstPostLoopBindingOrder = allBindingInfos
        .filter((local) => local.contextKey === context.key && !parameterBindingIds.has(local.id) &&
          local.statementIndex > carry.statementIndex && !isInsideLoopScope(local.statementIndex))
        .map((local) => local.eventOrder)
        .filter((order): order is number => order !== undefined)
        .sort((left, right) => left - right)[0];
      if (firstPostLoopBindingOrder === undefined) continue;
      const qualifiedLoopScopeId = moduleScopeIdFor(context.path, loopScopeId);
      scopeExitOrderById.set(
        qualifiedLoopScopeId,
        Math.min(scopeExitOrderById.get(qualifiedLoopScopeId) ?? firstPostLoopBindingOrder, firstPostLoopBindingOrder)
      );
    }
  }
  for (const context of contextsByKey.values()) {
    if (!contextIsReachable(context)) continue;
    const definitionScopeIndex = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.sourceLexicalNamespace.scopeIndex ?? sourceScopeIndex;
    const parameterBindingIds = new Set([
      ...[...context.parameters.values()].map((parameter) => parameter.id),
      ...[...context.recordParameters.values()].flatMap((fields) => [...fields.values()].map((field) => field.id)),
      ...[...context.recordParameterFieldBindingsByPath.values()].flatMap((fields) => [...fields.values()].map((field) => field.id))
    ]);
    for (const carry of collectionCarryInputs) {
      const body = context.definition.bodyStatements.find((candidate) => candidate.statementId === carry.ownerStatementId);
      if (!body || body.statementKind !== "element") continue;
      const loopScopeId = `for:${carry.ownerStatementId}`;
      const isInsideLoopScope = (statementIndex: number): boolean => {
        let scopeId = definitionScopeIndex?.scopeOfStatement.get(statementIndex);
        while (scopeId) {
          if (scopeId === loopScopeId) return true;
          scopeId = definitionScopeIndex?.scopes.get(scopeId)?.parentId ?? undefined;
        }
        return false;
      };
      const firstPostLoopBindingOrder = allBindingInfos
        .filter((candidate) => candidate.contextKey === context.key && !parameterBindingIds.has(candidate.id) &&
          candidate.statementIndex > carry.ownerStatementIndex && !isInsideLoopScope(candidate.statementIndex))
        .map((candidate) => candidate.eventOrder)
        .filter((order): order is number => order !== undefined)
        .sort((left, right) => left - right)[0];
      if (firstPostLoopBindingOrder === undefined) continue;
      const qualifiedLoopScopeId = moduleScopeIdFor(context.path, loopScopeId);
      scopeExitOrderById.set(
        qualifiedLoopScopeId,
        Math.min(scopeExitOrderById.get(qualifiedLoopScopeId) ?? firstPostLoopBindingOrder, firstPostLoopBindingOrder)
      );
    }
  }
  const controlByScopeId = new Map<string, BindingControlMetadata>();
  const conditionalOwnerStatementIdByElementId = new Map<ElementId, string>();
  const forGroupMutationOwnerByElementId = new Map<ElementId, Extract<BindingControlOwner, { kind: "forGroup" }> & { elementId: ElementId }>();
  const sourceControls = sourceScopeIndex
    ? buildBindingControlMetadata(sourceScopeIndex, stableStatementIdByIndex, sourceOrderByStatementIndex)
    : new Map<string, BindingControlMetadata>();
  const sourceControlsByDocument = new Map<DocumentId, ReadonlyMap<string, BindingControlMetadata>>();
  if (moduleRuntimeContext) {
    for (const document of moduleRuntimeContext.documentsById.values()) {
      const sourceOrder = document.documentId === moduleRuntimeContext.rootDocumentId
        ? sourceOrderByStatementIndex
        : new Map([...document.statementIdByStatementIndex.keys()].map((statementIndex) => [statementIndex, statementIndex] as const));
      sourceControlsByDocument.set(document.documentId, buildBindingControlMetadata(
        document.sourceLexicalNamespace.scopeIndex,
        document.statementIdByStatementIndex,
        sourceOrder
      ));
    }
  }
  const sourceControlsForDocument = (documentId: DocumentId | undefined) =>
    (documentId ? sourceControlsByDocument.get(documentId) : undefined) ?? sourceControls;
  const sourceScopeOfInstance = (context: InstanceContext) =>
    moduleRuntimeContext?.documentFor(context.instanceDocumentId)?.sourceLexicalNamespace.scopeIndex.scopeOfStatement.get(context.instance.statementIndex)
      ?? sourceScopeIndex?.scopeOfStatement.get(context.instance.statementIndex);
  const qualifyOwner = (
    owner: BindingControlOwner,
    path: readonly string[],
    iterations: ReadonlyMap<string, BindingInfo>,
    qualify: boolean
  ): BindingControlOwner => {
    if (!qualify) return owner;
    return owner.kind === "forGroup"
      ? {
          ...owner,
          ownerStatementId: moduleOwnerIdFor(path, owner.ownerStatementId),
          scopeId: moduleScopeIdFor(path, owner.scopeId),
          exitSourceOrder: scopeExitOrderById.get(moduleScopeIdFor(path, owner.scopeId)) ?? owner.exitSourceOrder,
          ...(iterations.get(owner.ownerStatementId)?.id
            ? { iterationBindingId: iterations.get(owner.ownerStatementId)!.id }
            : {})
        }
      : {
          ...owner,
          ownerStatementId: moduleOwnerIdFor(path, owner.ownerStatementId),
          scopeId: moduleScopeIdFor(path, owner.scopeId),
          exitSourceOrder: scopeExitOrderById.get(moduleScopeIdFor(path, owner.scopeId)) ?? owner.exitSourceOrder
        };
  };
  const controlForContextScope = (context: InstanceContext, sourceScopeId: string): BindingControlMetadata => {
    const definitionSourceControls = sourceControlsForDocument(context.definitionDocumentId);
    const sourceControl = definitionSourceControls.get(sourceScopeId);
    if (!sourceControl) {
      return { scopeId: moduleScopeIdFor(context.path, sourceScopeId), scopeExitSourceOrder: events.length, ownerChain: [], kind: "linear" };
    }
    const parentContext = context.parentKey ? contextsByKey.get(context.parentKey) : undefined;
    const instanceSourceControls = sourceControlsForDocument(context.instanceDocumentId);
    const callSiteOwnerChain = sourceScopeOfInstance(context)
      ? instanceSourceControls.get(sourceScopeOfInstance(context)!)?.ownerChain ?? []
      : [];
    const inherited = parentContext
      ? callSiteOwnerChain.map((owner) => qualifyOwner(owner, parentContext.path, parentContext.iterations, true))
      : callSiteOwnerChain;
    const ownerChain = [
      ...inherited,
      ...sourceControl.ownerChain.map((owner) => qualifyOwner(owner, context.path, context.iterations, true))
    ];
    const owner = ownerChain.at(-1);
    return {
      scopeId: moduleScopeIdFor(context.path, sourceScopeId),
      scopeExitSourceOrder: scopeExitOrderById.get(moduleScopeIdFor(context.path, sourceScopeId)) ?? sourceControl.scopeExitSourceOrder,
      ownerChain,
      kind: owner?.kind ?? "linear"
    };
  };
  // Every module binding uses its source lexical scope qualified by the call
  // path. The document control map is rebuilt by dslDocument && merged
  // separately; materialized module owners use the explicit qualified IDs.
  for (const context of contextsByKey.values()) {
    if (!contextIsReachable(context)) continue;
    const relevantScopeIds = new Set<string>([context.bodyScopeId]);
    const definitionScopeIndex = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.sourceLexicalNamespace.scopeIndex ?? sourceScopeIndex;
    for (const body of context.definition.bodyStatements) {
      relevantScopeIds.add(definitionScopeIndex?.scopeOfStatement.get(body.statementIndex) ?? context.bodyScopeId);
    }
    for (const sourceScopeId of relevantScopeIds) {
      controlByScopeId.set(moduleScopeIdFor(context.path, sourceScopeId), controlForContextScope(context, sourceScopeId));
    }
    const rootExit = scopeExitOrderById.get(context.scopeId) ?? events.length;
    if (!controlByScopeId.has(context.scopeId)) {
      controlByScopeId.set(context.scopeId, {
        scopeId: context.scopeId,
        scopeExitSourceOrder: rootExit,
        ownerChain: [],
        kind: "linear"
      });
    }
  }
  const immutableForGroups = new Map<string, ImmutableForGroupPlan>();
  for (const context of contextsByKey.values()) {
    if (!contextIsReachable(context)) continue;
    for (const carry of context.definition.immutableCarries ?? []) {
      if (!carry.type || !carry.initializer || !carry.next) continue;
      const binding = context.carries.get(carry.bindingId);
      const initializer = binding ? moduleInitializers.get(binding.id) : undefined;
      const nextExpression = binding ? moduleCarryNextExpressions.get(binding.id) : undefined;
      if (!binding || !initializer || !nextExpression) continue;
      const ownerStatementId = moduleOwnerIdFor(context.path, carry.statementId);
      const owner = [...controlByScopeId.values()]
        .flatMap((control) => control.ownerChain)
        .find((candidate): candidate is Extract<BindingControlOwner, { kind: "forGroup" }> =>
          candidate.kind === "forGroup" && candidate.ownerStatementId === ownerStatementId
        );
      const fallbackScopeId = moduleScopeIdFor(context.path, `for:${carry.statementId}`);
      const fallbackExitSourceOrder = scopeExitOrderById.get(fallbackScopeId)
        ?? executionOrderForValue(context.path, carry.statementIndex);
      const executionOwner = owner
        ? {
            scopeId: owner.scopeId,
            exitSourceOrder: owner.exitSourceOrder,
            ...(owner.entrySourceOrder !== undefined ? { entrySourceOrder: owner.entrySourceOrder } : {}),
            iterationBindingId: moduleIterationIdFor(context.path, carry.statementId)
          }
        : {
            scopeId: fallbackScopeId,
            exitSourceOrder: Math.max(0, Math.floor(fallbackExitSourceOrder)),
            entrySourceOrder: executionPositionForValue(context.path, carry.statementIndex) - 0.5,
            iterationBindingId: moduleIterationIdFor(context.path, carry.statementId)
          };
      const existing = immutableForGroups.get(ownerStatementId);
      immutableForGroups.set(ownerStatementId, {
        ownerStatementId,
        executionOwner: existing?.executionOwner ?? executionOwner,
        carries: [
          ...(existing?.carries ?? []),
          {
            bindingId: binding.id,
            nextBindingId: moduleCarryBindingIdFor(
              context.path,
              `binding:next:${carry.statementId}:${carry.nextStatementIndex}`
            ),
            initializer,
            declaredType: carry.type,
            nextExpression,
            nextSourceOrder: executionOrderForValue(context.path, carry.nextStatementIndex)
          }
        ],
        ...(existing?.geometryCarries ? { geometryCarries: existing.geometryCarries } : {}),
        ...(existing?.collectionCarries ? { collectionCarries: existing.collectionCarries } : {}),
        ...(existing?.geometryCollectionCarries ? { geometryCollectionCarries: existing.geometryCollectionCarries } : {})
      });
    }
    for (const carry of geometryCollectionCarryInputs) {
      const body = context.definition.bodyStatements.find((candidate) => candidate.statementId === carry.ownerStatementId);
      if (!body || body.statementKind !== "element") continue;
      const sourceStatement = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.statements[carry.ownerStatementIndex]
        ?? statements[carry.ownerStatementIndex];
      if (
        sourceStatement?.kind !== "element" ||
        sourceStatement.type !== "forGroup" ||
        !sourceStatement.forCarries?.some((candidate) => candidate.name === carry.carryName)
      ) continue;
      const sourceForContext = (source: ImmutableGeometryCollectionCarry["initializer"]) =>
        source.kind === "value"
          ? { kind: "value" as const, valueId: collectionValueIdFor(source.valueId, context) }
          : source;
      const ownerStatementId = moduleOwnerIdFor(context.path, carry.ownerStatementId);
      const owner = [...controlByScopeId.values()]
        .flatMap((control) => control.ownerChain)
        .find((candidate): candidate is Extract<BindingControlOwner, { kind: "forGroup" }> =>
          candidate.kind === "forGroup" && candidate.ownerStatementId === ownerStatementId
        );
      const fallbackScopeId = moduleScopeIdFor(context.path, `for:${carry.ownerStatementId}`);
      const fallbackExitSourceOrder = scopeExitOrderById.get(fallbackScopeId)
        ?? executionOrderForValue(context.path, carry.ownerStatementIndex);
      const executionOwner = owner
        ? {
            scopeId: owner.scopeId,
            exitSourceOrder: owner.exitSourceOrder,
            ...(owner.entrySourceOrder !== undefined ? { entrySourceOrder: owner.entrySourceOrder } : {}),
            iterationBindingId: moduleIterationIdFor(context.path, carry.ownerStatementId)
          }
        : {
            scopeId: fallbackScopeId,
            exitSourceOrder: Math.max(0, Math.floor(fallbackExitSourceOrder)),
            entrySourceOrder: executionPositionForValue(context.path, carry.ownerStatementIndex) - 0.5,
            iterationBindingId: moduleIterationIdFor(context.path, carry.ownerStatementId)
          };
      const bindingId = moduleCarryBindingIdFor(context.path, carry.bindingId);
      const projectedCarry: ImmutableGeometryCollectionCarry = {
        bindingId,
        collectionValueId: collectionValueIdFor(carry.collectionValueId, context),
        initializer: sourceForContext(carry.initializer),
        next: sourceForContext(carry.next),
        declaredType: carry.declaredType,
        nextSourceOrder: executionOrderForValue(context.path, carry.nextSourceOrder)
      };
      const existing = immutableForGroups.get(ownerStatementId);
      const geometryCollectionCarries = [...(existing?.geometryCollectionCarries ?? [])]
        .filter((candidate) => candidate.bindingId !== bindingId);
      geometryCollectionCarries.push(projectedCarry);
      immutableForGroups.set(ownerStatementId, {
        ownerStatementId,
        executionOwner: existing?.executionOwner ?? executionOwner,
        carries: existing?.carries ?? [],
        ...(existing?.geometryCarries ? { geometryCarries: existing.geometryCarries } : {}),
        ...(existing?.collectionCarries ? { collectionCarries: existing.collectionCarries } : {}),
        geometryCollectionCarries
      });
    }
  }
  const moduleGeometryTargetFor = (
    context: InstanceContext,
    reference: import("../dsl/moduleSemanticTypes").ModuleGeometryReferenceSemantic,
    expectedGeometryType: ModuleGeometryInterfaceType
  ): ScalarExpressionResolvedGeometryTarget | undefined => {
    if (!reference.target || !moduleGeometryRuntime) return undefined;
    return resolvedGeometryBuiltinForContext({
      builtinName: "immutable-carry",
      argumentIndex: 0,
      span: reference.span,
      expectedGeometryType: reference.expectedGeometryKind,
      reference
    }, context, expectedGeometryType);
  };
  for (const context of contextsByKey.values()) {
    if (!contextIsReachable(context)) continue;
    for (const carry of context.definition.immutableCarries ?? []) {
      if (carry.type || !carry.geometryInitializer || !carry.geometryNext) continue;
      if (!isDslGeometryValueType(carry.valueType)) continue;
      const expectedGeometryType = carry.valueType.kind;
      const initializerTarget = moduleGeometryTargetFor(context, carry.geometryInitializer, expectedGeometryType);
      const nextTarget = moduleGeometryTargetFor(context, carry.geometryNext, expectedGeometryType);
      if (!initializerTarget || !nextTarget) continue;
      const ownerStatementId = moduleOwnerIdFor(context.path, carry.statementId);
      const owner = [...controlByScopeId.values()]
        .flatMap((control) => control.ownerChain)
        .find((candidate): candidate is Extract<BindingControlOwner, { kind: "forGroup" }> =>
          candidate.kind === "forGroup" && candidate.ownerStatementId === ownerStatementId
        );
      const definitionScopeIndex = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.sourceLexicalNamespace.scopeIndex ?? sourceScopeIndex;
      const loopScopeId = `for:${carry.statementId}`;
      const isInsideLoopScope = (statementIndex: number): boolean => {
        let scopeId = definitionScopeIndex?.scopeOfStatement.get(statementIndex);
        while (scopeId) {
          if (scopeId === loopScopeId) return true;
          scopeId = definitionScopeIndex?.scopes.get(scopeId)?.parentId ?? undefined;
        }
        return false;
      };
      const firstPostLoopBindingOrder = [...context.locals.values()]
        .filter((local) => local.statementIndex > carry.statementIndex && !isInsideLoopScope(local.statementIndex))
        .map((local) => eventOrderByBindingId.get(local.id))
        .filter((order): order is number => order !== undefined)
        .sort((left, right) => left - right)[0];
      const executionExitSourceOrder = firstPostLoopBindingOrder === undefined ? undefined : firstPostLoopBindingOrder - 0.5;
      const executionOwner = owner
        ? {
            scopeId: owner.scopeId,
            exitSourceOrder: executionExitSourceOrder === undefined ? owner.exitSourceOrder : Math.min(owner.exitSourceOrder, executionExitSourceOrder),
            ...(owner.entrySourceOrder !== undefined ? { entrySourceOrder: owner.entrySourceOrder } : {}),
            iterationBindingId: moduleIterationIdFor(context.path, carry.statementId)
          }
        : {
            scopeId: moduleScopeIdFor(context.path, loopScopeId),
            exitSourceOrder: scopeExitOrderById.get(moduleScopeIdFor(context.path, loopScopeId))
              ?? executionOrderForValue(context.path, carry.statementIndex),
            entrySourceOrder: executionOrderForValue(context.path, carry.statementIndex),
            iterationBindingId: moduleIterationIdFor(context.path, carry.statementId)
          };
      // Module geometry targets retain the carry name in their resolved
      // target identity; keep that execution identity local to this runtime
      // projection while the source carry binding remains canonical.
      const bindingId = moduleCarryBindingIdFor(context.path, `${carry.bindingId}:${carry.name}`);
      const existing = immutableForGroups.get(ownerStatementId);
      immutableForGroups.set(ownerStatementId, {
        ownerStatementId,
        executionOwner: existing?.executionOwner ?? executionOwner,
        carries: existing?.carries ?? [],
        ...(existing?.collectionCarries ? { collectionCarries: existing.collectionCarries } : {}),
        ...(existing?.geometryCollectionCarries ? { geometryCollectionCarries: existing.geometryCollectionCarries } : {}),
        geometryCarries: [
          ...(existing?.geometryCarries ?? []).filter((candidate) => candidate.bindingId !== bindingId),
          {
            bindingId,
            declaredType: carry.valueType,
            initializerTarget,
            nextTarget,
            nextSourceOrder: executionOrderForValue(context.path, carry.nextStatementIndex)
          }
        ]
      });
    }
  }
  const moduleCollectionValueIds = new Set([
    ...(documentScalarProgram?.collectionValues ?? []).map((value) => value.valueId),
    ...moduleCollectionValues.map((value) => value.valueId)
  ]);
  for (const context of contextsByKey.values()) {
    if (!contextIsReachable(context)) continue;
    for (const carry of collectionCarryInputs) {
      const body = context.definition.bodyStatements.find((candidate) => candidate.statementId === carry.ownerStatementId);
      if (!body || body.statementKind !== "element") continue;
      const sourceStatement = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.statements[carry.ownerStatementIndex]
        ?? statements[carry.ownerStatementIndex];
      if (
        sourceStatement?.kind !== "element" ||
        sourceStatement.type !== "forGroup" ||
        !sourceStatement.forCarries?.some((candidate) => candidate.name === carry.carryName)
      ) continue;
      const collectionValueId = collectionValueIdFor(carry.collectionValueId, context);
      const initializerValueId = collectionValueIdFor(carry.initializerValueId, context);
      const nextValueId = collectionValueIdFor(carry.nextValueId, context);
      if (!moduleCollectionValueIds.has(initializerValueId) || !moduleCollectionValueIds.has(nextValueId)) continue;

      const ownerStatementId = moduleOwnerIdFor(context.path, carry.ownerStatementId);
      const owner = [...controlByScopeId.values()]
        .flatMap((control) => control.ownerChain)
        .find((candidate): candidate is Extract<BindingControlOwner, { kind: "forGroup" }> =>
          candidate.kind === "forGroup" && candidate.ownerStatementId === ownerStatementId
        );
      const fallbackScopeId = moduleScopeIdFor(context.path, `for:${carry.ownerStatementId}`);
      const fallbackExitSourceOrder = scopeExitOrderById.get(fallbackScopeId)
        ?? executionOrderForValue(context.path, carry.ownerStatementIndex);
      const executionOwner = owner
        ? {
            scopeId: owner.scopeId,
            exitSourceOrder: owner.exitSourceOrder,
            ...(owner.entrySourceOrder !== undefined ? { entrySourceOrder: owner.entrySourceOrder } : {}),
            iterationBindingId: moduleIterationIdFor(context.path, carry.ownerStatementId)
          }
        : {
            scopeId: fallbackScopeId,
            exitSourceOrder: Math.max(0, Math.floor(fallbackExitSourceOrder)),
            entrySourceOrder: executionPositionForValue(context.path, carry.ownerStatementIndex) - 0.5,
            iterationBindingId: moduleIterationIdFor(context.path, carry.ownerStatementId)
          };
      const bindingId = moduleCarryBindingIdFor(context.path, carry.bindingId);
      const projectedCarry: ImmutableCollectionCarry = {
        bindingId,
        collectionValueId,
        initializerValueId,
        nextValueId,
        declaredType: carry.declaredType,
        nextSourceOrder: executionOrderForValue(context.path, carry.nextSourceOrder)
      };
      const existing = immutableForGroups.get(ownerStatementId);
      const collectionCarries = [...(existing?.collectionCarries ?? [])]
        .filter((candidate) => candidate.bindingId !== bindingId);
      collectionCarries.push(projectedCarry);
      immutableForGroups.set(ownerStatementId, {
        ownerStatementId,
        executionOwner: existing?.executionOwner ?? executionOwner,
        carries: existing?.carries ?? [],
        ...(existing?.geometryCarries ? { geometryCarries: existing.geometryCarries } : {}),
        collectionCarries,
        ...(existing?.geometryCollectionCarries ? { geometryCollectionCarries: existing.geometryCollectionCarries } : {})
      });
    }
  }
  // Project the compiler-owned Module loop boundary after carry overrides
  // have been applied, so runtime owner joins and the graph's owner snapshot
  // are derived from the same control metadata.
  for (const context of contextsByKey.values()) {
    if (!contextIsReachable(context)) continue;
    for (const body of context.definition.bodyStatements) {
      if (!moduleBodyStatementIsReachable(context, body) || body.statementKind !== "element") continue;
      const runtime = bodyRuntimeEntry(context, body);
      if (!runtime) continue;
      const sourceStatement = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.statements[body.statementIndex] ?? statements[body.statementIndex];
      const sourceOwnerKind = sourceStatement?.kind === "element" ? sourceStatement.type : null;
      if (sourceOwnerKind !== "conditionalGroup" && sourceOwnerKind !== "forGroup") continue;
      const qualifiedOwnerId = moduleOwnerIdFor(context.path, body.statementId);
      const owner = [...controlByScopeId.values()]
        .flatMap((control) => control.ownerChain)
        .find((candidate) => candidate.ownerStatementId === qualifiedOwnerId &&
          candidate.kind === (sourceOwnerKind === "forGroup" ? "forGroup" : "conditionalBranch"));
      if (sourceOwnerKind === "conditionalGroup") {
        if (owner?.kind === "conditionalBranch") conditionalOwnerStatementIdByElementId.set(runtime.elementId, owner.ownerStatementId);
        continue;
      }

      const immutableForGroup = immutableForGroups.get(qualifiedOwnerId);
      const immutableExecutionOwner = immutableForGroup?.ownerStatementId === qualifiedOwnerId
        ? immutableForGroup.executionOwner
        : undefined;
      // Keep ordinary control metadata authoritative when it exists. The
      // canonical immutable-for plan supplies the same qualified loop owner
      // only for carry-only loops without an ordinary control owner; downstream
      // owner validation still checks consistency when both sources exist.
      const projectedOwner = owner?.kind === "forGroup"
        ? owner
        : immutableExecutionOwner
          ? {
              kind: "forGroup" as const,
              ownerStatementId: qualifiedOwnerId,
              ...immutableExecutionOwner
            }
          : undefined;
      if (projectedOwner) {
        forGroupMutationOwnerByElementId.set(runtime.elementId, { ...projectedOwner, elementId: runtime.elementId });
      }
    }
  }

  const scalarExecutionPositionByRuntimeElementId = new Map<ElementId, number>();
  const lastScalarExecutionPositionByExecutionUnit = new Map<number, number>();
  for (const entry of moduleMaterialization.executionStatements) {
    const scalarExecutionPosition = elementOrderById.get(entry.runtimeElementId);
    if (scalarExecutionPosition !== undefined) {
      scalarExecutionPositionByRuntimeElementId.set(entry.runtimeElementId, scalarExecutionPosition);
      lastScalarExecutionPositionByExecutionUnit.set(entry.executionUnitStatementIndex, scalarExecutionPosition);
      continue;
    }

    if (!entry.runtimeIdentity) {
      throw new Error(`moduleScalarRuntime: missing scalar execution position for root element ${entry.runtimeElementId}`);
    }
    const context = contextsByKey.get(pathKey(entry.runtimeInstancePath ?? entry.instancePath));
    const body = entry.runtimeIdentity.kind === "moduleBody"
      ? context?.definition.bodyStatements.find((candidate) => candidate.statementId === entry.sourceStatementId)
      : undefined;
    if (!context || (contextIsReachable(context) && (!body || moduleBodyStatementIsReachable(context, body)))) {
      throw new Error(`moduleScalarRuntime: missing scalar execution position for reachable materialized element ${entry.runtimeElementId}`);
    }

    // Unreachable materialized placeholders must not advance the scalar
    // cursor into a later concrete module instance before their conditional
    // owner has been evaluated. Reuse only the latest position already seen
    // in this execution unit; borrowing from another unit would change the
    // mutation timeline for the placeholder.
    const lastScalarExecutionPosition = lastScalarExecutionPositionByExecutionUnit.get(entry.executionUnitStatementIndex);
    if (lastScalarExecutionPosition === undefined) {
      throw new Error(
        `moduleScalarRuntime: unreachable materialized element ${entry.runtimeElementId} has no prior scalar execution position in execution unit ${entry.executionUnitStatementIndex}`
      );
    }
    scalarExecutionPositionByRuntimeElementId.set(entry.runtimeElementId, lastScalarExecutionPosition);
  }

  return {
    bindingAnalysis: combinedAnalysis,
    scalarProgram,
    controlByScopeId,
    scalarExecutionPositionByRuntimeElementId,
    scalarExecutionPositionByStatementIndex: sourceOrderByStatementIndex,
    materializedPropertyBindings,
    materializedNumericBindings,
    materializedTransformationNumericBindings,
    materializedTextTemplates,
    materializedForGroupCollectionSourcesByElementId,
    materializedConditionalGroupConditions,
    conditionalOwnerStatementIdByElementId,
    forGroupMutationOwnerByElementId,
    geometryValueProgram,
    geometryCarryNextPrograms,
    geometryInputTargetsByRuntimeElementId,
    geometryCollectionNodesByValueId,
    immutableForGroups
  };
};
