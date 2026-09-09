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
  ModuleScalarExpressionSemantic,
  ModuleScalarSourceTarget,
  ModuleSemanticAnalysis
} from "../dsl/moduleSemanticTypes";
import { unwrapModuleGeometrySourceTarget } from "../dsl/moduleSemanticTypes";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { ModuleGeometryPropertyRuntimeTarget, ModuleGeometryRuntimeCompilation } from "../dsl/moduleGeometryRuntime";
import { geometryInputTargetForAlias, type RuntimeGeometryInputTarget } from "../dsl/moduleGeometryRuntimeLowering";
import type {
  GeometryValueProgram,
  GeometryValueProgramEntry,
  GeometryValueProgramPath,
  GeometryValueProgramPoint
} from "../dsl/moduleGeometryValueProgram";
import { buildLexicalScopeIndexFromStatements } from "../dsl/lexicalScopeIndexAdapter";
import { moduleParameterPresenceKey } from "../dsl/moduleScalarExpression";
import type { CadElement, DrawingModifierDefinition, ElementId, GeometryInputTarget, PointAnchor } from "../types/geometry";
import { findParameterDefinition, scalarTypeForParameterDefinition } from "../parameters/parameterDefinitions";
import type { BindingAnalysis, InitializerReference } from "./bindingAnalysis";
import { analyzeBindings } from "./bindingAnalysis";
import {
  buildBindingCatalog,
  type Binding,
  type BindingId,
  type BindingSeed
} from "./bindingCatalog";
import { buildBindingControlMetadata, type BindingControlMetadata, type BindingControlOwner } from "./bindingVersions";
import type { LexicalScopeIndex } from "./lexicalScopeIndex";
import type { SetStatementAnalysis } from "./setStatementCompiler";
import {
  lowerScalarProgram,
  type ScalarProgram,
  type ScalarProgramCollection,
  type ScalarProgramCollectionMember
} from "./scalarProgram";
import type { ScalarType } from "./types";
import type { ScalarValue } from "./types";
import type {
  ScalarExpressionResolvedGeometryProperty,
  ScalarExpressionResolvedGeometryTarget,
  ScalarExpressionResolvedReference,
  TypedScalarExpression
} from "./typedExpressionAst";
import type { TextTemplateAst, TextTemplateDependency, TextTemplateSegment } from "./textTemplate";
import { scanTextTemplateLiteral } from "./textTemplateScan";
import { typecheckScalarExpression } from "./expressionTypecheck";
import { getBuiltinFunctionDefinition } from "./builtinFunctions";
import type { BindingResolution } from "./bindingResolution";
import { collectScalarExpressionReferences } from "./expressionReferenceCollector";
import type { CompiledNumericBinding } from "./numericBindingCompiler";
import { numericSourceForModuleSite } from "./moduleNumericRuntime";
import type { ScalarValueSource } from "./propertyBindingCompiler";
import { isScalarTypeAssignable } from "./scalarAssignability";
import type { ReconciledCadContainerInput } from "./containerIndex";
import type { SourceLexicalNamespaceIndex } from "../dsl/sourceLexicalNamespaceIndex";
import type { ModuleRuntimeContext } from "../dsl/moduleRuntimeContext";
import { effectiveElementActivityById } from "../model/elementActivity";
import type { RecordFieldIdentity } from "../dsl/recordSemanticAnalysis";
import { planRecordScalarLowering, recordScalarBindingIdFor, recordScalarDeclarationVersionIdFor } from "./recordScalarLowering";
import { analyzeTypedDeclarations, type TypedDeclarationAnalysis } from "./typedDeclarationAnalysis";
import { scalarTypeOfDslValueType } from "../dsl/dslValueTypes";
import { parseGeometryArrayDeferredModuleExportId } from "../dsl/geometryArraySemanticAnalysis";
import { scanScalarLiteral } from "./literalScanner";

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

export type ModuleScalarRuntimeCompilation = {
  bindingAnalysis: BindingAnalysis;
  scalarProgram: ScalarProgram;
  moduleSetStatements: readonly SetStatementAnalysis[];
  controlByScopeId: ReadonlyMap<string, BindingControlMetadata>;
  scalarExecutionPositionByRuntimeElementId: ReadonlyMap<ElementId, number>;
  scalarExecutionPositionByStatementIndex: ReadonlyMap<number, number>;
  materializedPropertyBindings: readonly MaterializedPropertyBindingSource[];
  materializedNumericBindings: readonly MaterializedNumericBindingSource[];
  materializedTextTemplates: readonly MaterializedTextTemplateSource[];
  materializedConditionalGroupConditions: readonly { elementId: ElementId; expression: TypedScalarExpression }[];
  conditionalOwnerStatementIdByElementId: ReadonlyMap<ElementId, string>;
  forGroupMutationOwnerByElementId: ReadonlyMap<ElementId, Extract<BindingControlOwner, { kind: "forGroup" }> & { elementId: ElementId }>;
  geometryValueProgram: GeometryValueProgram;
  geometryInputTargetsByRuntimeElementId: ReadonlyMap<ElementId, ReadonlyMap<string, GeometryInputTarget | readonly GeometryInputTarget[]>>;
};

type BindingInfo = {
  id: BindingId;
  declarationVersionId: string;
  name: string;
  type: ScalarType;
  bindingKind: "const" | "let";
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
  recordValues: ReadonlyMap<string, ReadonlyMap<number, { id: BindingId }>>;
  recordParameters: ReadonlyMap<number, ReadonlyMap<number, { id: BindingId }>>;
};

type RuntimeEvent =
  | { kind: "binding"; bindingId: BindingId }
  | { kind: "set"; versionId: string }
  | { kind: "element"; elementId: ElementId };

const scalarTypeOf = (type: ModuleDefinitionSemantic["parameters"][number]["type"]): ScalarType | null =>
  type && (type.kind === "number" || type.kind === "string" || type.kind === "boolean" || type.kind === "choice")
    ? type
    : null;

const pathKey = (path: readonly string[]) => encodeIdentityTuple(["instance", ...path]);
const moduleCollectionValueIdFor = (path: readonly string[], valueId: string) =>
  `module-collection:${encodeIdentityTuple([...path, valueId])}`;

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

export const moduleScalarBindingIdFor = (
  path: readonly string[],
  definitionStatementId: string,
  localStatementId: string
) => `module-binding:${encodeIdentityTuple(["local", ...path, definitionStatementId, localStatementId])}`;

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

export const moduleRecordScalarDeclarationVersionIdFor = (
  path: readonly string[],
  recordValueStatementId: string,
  field: RecordFieldIdentity
) => `module-record-declaration:${encodeIdentityTuple(["value", ...path, recordValueStatementId, field.recordStatementId, String(field.fieldIndex)])}`;

export const moduleRecordParameterScalarBindingIdFor = (
  path: readonly string[],
  definitionStatementId: string,
  parameterIndex: number,
  field: RecordFieldIdentity
) => `module-record-binding:${encodeIdentityTuple(["parameter", ...path, definitionStatementId, String(parameterIndex), field.recordStatementId, String(field.fieldIndex)])}`;

export const moduleRecordParameterScalarDeclarationVersionIdFor = (
  path: readonly string[],
  definitionStatementId: string,
  parameterIndex: number,
  field: RecordFieldIdentity
) => `module-record-declaration:${encodeIdentityTuple(["parameter", ...path, definitionStatementId, String(parameterIndex), field.recordStatementId, String(field.fieldIndex)])}`;

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
  const visitKey = `${target.kind}:${target.kind === "recordValue" ? target.statementId : target.kind === "recordParameter" ? `${target.definitionStatementId}:${target.parameterIndex}` : `${target.instanceStatementId}:${target.exportedStatementId}`}:${field.fieldIndex}`;
  if (visited.has(visitKey)) return undefined;
  visited.add(visitKey);
  if (target.kind === "recordValue") {
    const local = definition.recordValues.find((value) => value.value.statementId === target.statementId);
    if (local) {
      if (local.value.constructor) return moduleRecordScalarBindingIdFor(path, target.statementId, field);
      return local.target
        ? recordFieldBindingIdForSemanticTarget({ target: local.target, field, path, definition, instance, moduleSemanticAnalysis, sourceNamespace, rootRecordPlan, visited })
        : undefined;
    }
    const parentLocal = parentContext?.definition.recordValues.find((value) => value.value.statementId === target.statementId);
    if (parentLocal) {
      if (parentLocal.value.constructor) return moduleRecordScalarBindingIdFor(parentContext!.path, target.statementId, field);
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
    return rootRecordPlan?.fieldBindingIdsByValueStatementId.get(target.statementId)?.get(field.fieldIndex)
      ?? recordScalarBindingIdFor(target.statementId, field);
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
              declaredType: field.type,
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

const setVersionIdFor = (context: InstanceContext, statementId: string) =>
  `module-set:${encodeIdentityTuple([...context.path, context.definition.statementId, statementId])}`;

const moduleScopeIdFor = (path: readonly string[], sourceScopeId: string) =>
  `module-instance-scope:${encodeIdentityTuple([...path, sourceScopeId])}`;

const moduleOwnerIdFor = (path: readonly string[], sourceOwnerId: string) =>
  `module-owner:${encodeIdentityTuple([...path, sourceOwnerId])}`;

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
    } else if (node.kind === "unary") collectCollectionBases(node.operand);
    else if (node.kind === "binary") { collectCollectionBases(node.left); collectCollectionBases(node.right); }
    else if (node.kind === "group") collectCollectionBases(node.expression);
    else if (node.kind === "valueIf") {
      collectCollectionBases(node.condition);
      collectCollectionBases(node.thenBranch);
      collectCollectionBases(node.elseBranch);
    }
    else if (node.kind === "call") node.args.forEach((argument) => collectCollectionBases(argument.expression));
  };
  collectCollectionBases(ast);
  return semantic.references.filter((reference) =>
    (!collectionBaseStarts.has(reference.span.start) &&
      (astReferences.some((astReference) => astReference.span.start === reference.span.start) ||
        semantic.geometryProperties.some((property) =>
          property.span.start === reference.span.start && property.target?.kind === "recordField"
        )))
  );
};

const lowerRecordPropertyAst = (
  ast: ModuleScalarExpressionSemantic["ast"],
  semantic: ModuleScalarExpressionSemantic
): ModuleScalarExpressionSemantic["ast"] => {
  const recordPropertyAt = (spanStart: number) => semantic.geometryProperties.find((property) =>
    property.span.start === spanStart && property.target?.kind === "recordField"
  );
  const visit = (node: ModuleScalarExpressionSemantic["ast"]): ModuleScalarExpressionSemantic["ast"] => {
    switch (node.kind) {
      case "geometryProperty": {
        const property = recordPropertyAt(node.span.start);
        return property
          ? {
              kind: "reference",
              span: node.span,
              nameSpan: { start: node.elementNameSpan.start, end: node.propertySpan.end },
              name: `${node.elementName}.${node.property}`
            }
          : node;
      }
      case "collectionIndex": return { ...node, index: visit(node.index) };
      case "unary": return { ...node, operand: visit(node.operand) };
      case "binary": return { ...node, left: visit(node.left), right: visit(node.right) };
      case "group": return { ...node, expression: visit(node.expression) };
      case "valueIf": return {
        ...node,
        condition: visit(node.condition),
        thenBranch: visit(node.thenBranch),
        elseBranch: visit(node.elseBranch)
      };
      case "call": return { ...node, args: node.args.map((argument) => ({ ...argument, expression: visit(argument.expression) })) };
      default: return node;
    }
  };
  return visit(ast);
};

const materializeHasValueAst = (
  ast: ModuleScalarExpressionSemantic["ast"],
  semantic: ModuleScalarExpressionSemantic,
  hasValueForParameter: (definitionStatementId: string, parameterIndex: number, definitionDocumentId?: DocumentId) => boolean
): ModuleScalarExpressionSemantic["ast"] => {
  const intrinsic = ast.kind === "call" && ast.name === "hasValue"
    ? semantic.hasValueParameters.find((entry) => entry.span.start === ast.span.start)
    : undefined;
  if (intrinsic) {
    return {
      kind: "booleanLiteral",
      span: ast.span,
      value: hasValueForParameter(intrinsic.definitionStatementId, intrinsic.parameterIndex, intrinsic.definitionIdentity?.documentId)
    };
  }
  switch (ast.kind) {
    case "unary": return { ...ast, operand: materializeHasValueAst(ast.operand, semantic, hasValueForParameter) };
    case "binary": {
      const left = materializeHasValueAst(ast.left, semantic, hasValueForParameter);
      const right = materializeHasValueAst(ast.right, semantic, hasValueForParameter);
      if (ast.operator === "&&" && left.kind === "booleanLiteral") {
        if (!left.value) return { kind: "booleanLiteral", span: ast.span, value: false };
        return right;
      }
      if (ast.operator === "||" && left.kind === "booleanLiteral") {
        if (left.value) return { kind: "booleanLiteral", span: ast.span, value: true };
        return right;
      }
      return { ...ast, left, right };
    }
    case "group": return { ...ast, expression: materializeHasValueAst(ast.expression, semantic, hasValueForParameter) };
    case "valueIf": return {
      ...ast,
      condition: materializeHasValueAst(ast.condition, semantic, hasValueForParameter),
      thenBranch: materializeHasValueAst(ast.thenBranch, semantic, hasValueForParameter),
      elseBranch: materializeHasValueAst(ast.elseBranch, semantic, hasValueForParameter)
    };
    case "collectionIndex": return { ...ast, index: materializeHasValueAst(ast.index, semantic, hasValueForParameter) };
    case "call": return {
      ...ast,
      args: ast.args.map((argument) => ({ ...argument, expression: materializeHasValueAst(argument.expression, semantic, hasValueForParameter) }))
    };
    default: return ast;
  }
};

const typecheckGeometryTargetFor = (
  occurrence: ModuleGeometryBuiltinArgumentSemantic
): ScalarExpressionResolvedGeometryTarget | null => {
  if (!occurrence.reference.target || (occurrence.reference.resolution !== "resolved" && occurrence.reference.resolution !== "deferred")) return null;
  const unwrapped = unwrapModuleGeometrySourceTarget(occurrence.reference.target);
  const target = unwrapped.target;
  const pointKey = unwrapped.pointKey;
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
  if (target.kind === "collectionIndex") return null;
  return {
    statementId: target.instanceStatementId,
    statementIndex: target.instanceStatementIndex,
    geometryType: occurrence.expectedGeometryType,
    ...(pointKey ? { pointKey } : {})
  };
};

const lowerExpression = (
  semantic: ModuleScalarExpressionSemantic,
  bindingForTarget: (target: ModuleScalarSourceTarget, name: string, statementIndex: number) => Binding | undefined,
  catalogBindings: ReadonlyMap<BindingId, Binding>,
  geometryPropertyForTarget?: (target: ModuleGeometryPropertySourceTarget) => ModuleGeometryPropertyRuntimeTarget | undefined,
  collectionLengthForTarget?: (target: Extract<ModuleGeometryPropertySourceTarget, { kind: "collectionValueLength" | "collectionParameterLength" | "deferredModuleCollectionExportLength" }>) => number | undefined,
  geometryBuiltinForTarget?: (occurrence: ModuleGeometryBuiltinArgumentSemantic) => ScalarExpressionResolvedGeometryTarget | undefined,
  hasValueForParameter: (definitionStatementId: string, parameterIndex: number, definitionDocumentId?: DocumentId) => boolean = () => false,
  collectionValueIdFor: (valueId: string) => string = (valueId: string) => valueId,
  collectionSourceOrderFor: (sourceOrder: number) => number = (sourceOrder: number) => sourceOrder
): { expression: TypedScalarExpression; references: InitializerReference[] } => {
  const runtimeAst = materializeHasValueAst(lowerRecordPropertyAst(semantic.ast, semantic), semantic, hasValueForParameter);
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
  for (const property of semantic.geometryProperties) {
    if (property.target?.kind === "recordField") continue;
    if (!property.target || !property.type) {
      geometryPropertyReferences.set(property.span.start, null);
      continue;
    }
    if (property.target.kind === "collectionValueLength" || property.target.kind === "collectionParameterLength" || property.target.kind === "deferredModuleCollectionExportLength") {
      const length = property.target.kind === "collectionValueLength" && property.target.length !== null
        ? property.target.length
        : collectionLengthForTarget?.(property.target);
      if (length !== undefined) {
        geometryPropertyReferences.set(property.span.start, {
          kind: "collection",
          collectionValueId: property.target.kind === "collectionValueLength"
            ? property.target.valueId
            : property.target.kind === "collectionParameterLength"
              ? `${property.target.definitionStatementId}:parameter:${property.target.parameterIndex}`
              : JSON.stringify([property.target.instanceStatementId, property.target.exportName]),
          collectionLength: length,
          targetSourceOrder: property.target.kind === "collectionValueLength"
            ? property.target.statementIndex
            : property.target.kind === "deferredModuleCollectionExportLength"
              ? property.target.instanceStatementIndex
              : -1,
          type: property.type.kind === "number" ? property.type : { kind: "number" }
        });
      } else {
        geometryPropertyReferences.set(property.span.start, null);
      }
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
        targetSourceOrder: runtimeTarget.targetSourceOrder ?? (
          property.target.kind === "sourceGeometryProperty" || property.target.kind === "geometryValueProperty"
            ? property.target.statementIndex
            : -1
        ),
        type: property.type
      });
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
    geometryPropertyReferences.set(property.span.start, {
      elementId,
      property: property.target.property,
      targetSourceOrder,
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
  const collectTypecheckResolutions = (node: ModuleScalarExpressionSemantic["ast"]): void => {
    switch (node.kind) {
      case "reference": {
        const reference = semanticReferenceFor(node.span.start);
        typecheckResolutions.push(bindingResolutionFor(
          reference?.target && ["parameter", "recordField", "moduleLocal", "documentBinding", "iteration", "deferredModuleScalarExport"].includes(reference.target.kind)
            ? bindingForTarget(reference.target as ModuleScalarSourceTarget, reference.name, reference.span.start)
            : undefined,
          reference?.name ?? node.name,
          reference?.span.start ?? node.span.start
        ));
        return;
      }
      case "collectionIndex": {
        const reference = semanticReferenceFor(node.span.start);
        typecheckResolutions.push({
          kind: "resolvedCollectionIndex",
          collectionValueId: collectionValueIdFor(reference?.collectionValueId ?? ""),
          collectionLength: reference?.collectionLength ?? null,
          targetSourceOrder: (() => {
            const sourceOrder = reference?.targetSourceOrder ?? -1;
            return sourceOrder >= 0 ? collectionSourceOrderFor(sourceOrder) : sourceOrder;
          })(),
          type: reference?.collectionElementType ?? null
        });
        collectTypecheckResolutions(node.index);
        return;
      }
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
          const occurrence = sourceArgument.kind === "reference" || sourceArgument.kind === "geometryProperty"
            ? geometryBuiltinFor(sourceArgument.span.start)
            : undefined;
          if (parameterType && typeof parameterType === "string" && occurrence) {
            if (sourceArgument.kind === "reference") {
              typecheckResolutions.push({ kind: "resolvedGeometry", target: typecheckGeometryTargetFor(occurrence) });
            }
          } else {
            collectTypecheckResolutions(sourceArgument);
          }
        });
        return;
      }
      case "unary":
        collectTypecheckResolutions(node.operand);
        return;
      case "binary":
        collectTypecheckResolutions(node.left);
        collectTypecheckResolutions(node.right);
        return;
      case "group":
        collectTypecheckResolutions(node.expression);
        return;
      case "valueIf":
        collectTypecheckResolutions(node.condition);
        collectTypecheckResolutions(node.thenBranch);
        collectTypecheckResolutions(node.elseBranch);
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
    geometryPropertyReferences
  });
  const lowerGeometryProperties = (node: TypedScalarExpression): { node: TypedScalarExpression; references: InitializerReference[] } => {
    if (node.kind === "geometryProperty") {
      const semanticProperty = semantic.geometryProperties.find((property) => property.span.start === node.span.start);
      const resolved = semanticProperty?.target && geometryPropertyForTarget?.(semanticProperty.target);
      if (!resolved) return { node, references: [] };
      if (resolved.kind === "expression") {
        const lowered = lowerExpression(resolved.expression, bindingForTarget, catalogBindings, geometryPropertyForTarget, collectionLengthForTarget, geometryBuiltinForTarget, hasValueForParameter, collectionValueIdFor, collectionSourceOrderFor);
        return { node: lowered.expression, references: lowered.references };
      }
      return {
        node: {
          ...node,
          elementId: resolved.kind === "runtime" ? resolved.elementId : null,
          ...(resolved.kind === "value" ? { geometryValueOccurrence: resolved.occurrence } : {}),
          ...(resolved.kind === "value" && resolved.pointKey ? { geometryValuePointKey: resolved.pointKey } : {}),
          property: resolved.property,
          targetSourceOrder: resolved.targetSourceOrder ?? null
        },
        references: []
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
  const resolutions = references.map((reference) => bindingResolutionFor(
    reference.target && ["parameter", "recordField", "moduleLocal", "documentBinding", "iteration", "deferredModuleScalarExport"].includes(reference.target.kind)
      ? bindingForTarget(reference.target as ModuleScalarSourceTarget, reference.name, reference.span.start)
      : undefined,
    reference.name,
    reference.span.start
  ));
  const initializerReferences: InitializerReference[] = references.map((reference, index) => ({
    fromBindingId: "",
    occurrenceIndex: index,
    name: reference.name,
    span: reference.span,
    resolution: resolutions[index]
  }));
  // The caller fills fromBindingId after the owning binding is known. Keep a
  // catalog touch here so a missing target fails at the same lowering boundary
  // rather than being rediscovered by a runtime name lookup.
  for (const resolution of resolutions) {
    if (resolution.kind === "resolved" && !catalogBindings.has(resolution.binding.id)) {
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
  if (!expectedType || expectedType.kind === "number" || !loweredExpression.type ||
      !isScalarTypeAssignable(loweredExpression.type, expectedType)) return undefined;
  if (loweredExpression.kind === "reference" && loweredExpression.bindingId !== null && semantic.references.length === 1) {
    const reference = semantic.references[0];
    return {
      kind: "binding",
      bindingId: loweredExpression.bindingId,
      type: loweredExpression.type,
      span: reference.span,
      nameSpan: { start: reference.span.start + 1, end: reference.span.end },
      name: reference.name
    };
  }
  return { kind: "expression", expression: loweredExpression, type: loweredExpression.type, span: semantic.ast.span };
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
  reconciledContainers,
  includeStatement,
  elements,
  sourceScopeIndex,
  sourceNamespace,
  moduleGeometryRuntime,
  moduleRuntimeContext,
  drawingModifiers
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  moduleMaterialization: ModuleMaterialization;
  documentBindingAnalysis?: BindingAnalysis;
  documentScalarProgram?: ScalarProgram;
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
  for (const binding of baseCatalog.bindings) {
    if (binding.kind !== "typed" || binding.resolutionMode !== "preResolvedOnly" || binding.catalogOrder !== "source") continue;
    const bucket = sourceOwnedBindingsByStatementIndex.get(binding.statementIndex) ?? [];
    bucket.push(binding);
    sourceOwnedBindingsByStatementIndex.set(binding.statementIndex, bucket);
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
        bindingKind: binding.mutability === "let" ? "let" : "const",
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
    current: InstanceContext | null
  ): BindingId | undefined => {
    if (target.kind === "recordValue") {
      if (current) {
        for (const candidate of contextCandidatesFor(current)) {
          const fields = candidate.recordValues.get(target.statementId);
          const bindingId = fields?.get(field.fieldIndex)?.id;
          if (bindingId) return bindingId;
        }
      }
      return rootRecordPlan?.fieldBindingIdsByValueStatementId.get(target.statementId)?.get(field.fieldIndex)
        ?? recordScalarBindingIdFor(target.statementId, field);
    }
    if (target.kind === "recordParameter") {
      if (!current) return undefined;
      return contextCandidatesFor(current)
        .find((candidate) => candidate.definition.statementId === target.definitionStatementId)
        ?.recordParameters.get(target.parameterIndex)?.get(field.fieldIndex)?.id;
    }
    if (target.kind === "recordCollectionIndex") {
      const index = target.index.ast.kind === "numberLiteral" ? target.index.ast.value : null;
      if (index === null || !Number.isInteger(index) || index < 0) return undefined;
      const member = target.members?.[index];
      return member
        ? recordFieldBindingIdForTarget(member, field, current)
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
          child ?? null
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
    const recordValues = new Map<string, ReadonlyMap<number, { id: BindingId }>>();
    const recordParameters = new Map<number, ReadonlyMap<number, { id: BindingId }>>();
    const context = { key, path, instance, instanceDocumentId, definitionDocumentId, definition, parentKey, scopeId, bodyScopeId, parameters, locals, iterations, recordValues, recordParameters } as InstanceContext;
    contextsByKey.set(key, context);
    const definitionDocument = moduleRuntimeContext?.documentFor(definitionDocumentId);
    const definitionStatements = definitionDocument?.statements ?? statements;
    const definitionSourceNamespace = definitionDocument?.sourceLexicalNamespace ?? sourceNamespace;
    const definitionSourceScopeIndex = definitionDocument?.sourceLexicalNamespace.scopeIndex ?? sourceScopeIndex;
    for (const parameter of definition.parameters) {
      const parameterBinding = instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
      if (parameter.optional && parameterBinding?.state === "optionalOmitted") continue;
      const type = scalarTypeOf(parameter.type);
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
      if (!parameterBinding || parameterBinding.state === "optionalOmitted" || parameterBinding.value?.kind !== "record") continue;
      const recordDefinition = definitionSourceNamespace?.recordSemanticAnalysis?.definitionsByStatementId.get(recordParameter.typeIdentity);
      if (!recordDefinition) continue;
      const fieldBindings = new Map<number, { id: BindingId }>();
      if (parameterBinding.value.reference.target) {
        for (const field of recordDefinition.fields) {
          const bindingId = recordFieldBindingIdForTarget(parameterBinding.value.reference.target, field.identity, context);
          if (bindingId) fieldBindings.set(field.fieldIndex, { id: bindingId });
        }
      } else if (parameterBinding.value.reference.constructor) {
        for (const field of parameterBinding.value.reference.constructor.fields) {
          const bindingId = moduleRecordParameterScalarBindingIdFor(
            path,
            definition.statementId,
            parameter.parameterIndex,
            field.field
          );
          const info: BindingInfo = {
            id: bindingId,
            declarationVersionId: moduleRecordParameterScalarDeclarationVersionIdFor(path, definition.statementId, parameter.parameterIndex, field.field),
            name: `${parameter.name}.${field.fieldName}`,
            type: field.expectedType,
            bindingKind: "const",
            scopeId,
            sourceScopeId: bodyScopeId,
            contextKey: key,
            statementId: definition.statementId,
            statementIndex: instance.statementIndex
          };
          fieldBindings.set(field.field.fieldIndex, info);
          allBindingInfos.push(info);
        }
      }
      if (fieldBindings.size > 0) recordParameters.set(parameter.parameterIndex, fieldBindings);
    }
    for (const local of definition.localScalars) {
      if (!local.type || (local.type.kind !== "number" && local.type.kind !== "string" && local.type.kind !== "boolean" && local.type.kind !== "choice")) continue;
      const info: BindingInfo = {
        id: bindingIdFor("local", context, local.statementId),
        declarationVersionId: declarationVersionIdFor("local", context, local.statementId),
        name: local.name,
        type: local.type,
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
    for (const recordValue of definition.recordValues) {
      if (!recordValue.value.typeIdentity || !recordValue.target) continue;
      const recordDefinition = definitionSourceNamespace?.recordSemanticAnalysis?.definitionsByStatementId.get(recordValue.value.typeIdentity);
      if (!recordDefinition) continue;
      const fieldBindings = new Map<number, { id: BindingId }>();
      if (recordValue.value.constructor) {
        for (const field of recordValue.fields) {
          const bindingId = moduleRecordScalarBindingIdFor(path, recordValue.value.statementId, field.field);
          const info: BindingInfo = {
            id: bindingId,
            declarationVersionId: moduleRecordScalarDeclarationVersionIdFor(path, recordValue.value.statementId, field.field),
            name: `${recordValue.value.name}.${field.fieldName}`,
            type: field.expectedType,
            bindingKind: "const",
            scopeId: moduleScopeIdFor(path, definitionSourceScopeIndex?.scopeOfStatement.get(recordValue.value.statementIndex) ?? bodyScopeId),
            sourceScopeId: definitionSourceScopeIndex?.scopeOfStatement.get(recordValue.value.statementIndex) ?? bodyScopeId,
            contextKey: key,
            statementId: recordValue.value.statementId,
            statementIndex: recordValue.value.statementIndex
          };
          fieldBindings.set(field.field.fieldIndex, info);
          allBindingInfos.push(info);
        }
      } else {
        for (const field of recordDefinition.fields) {
          const bindingId = recordFieldBindingIdForTarget(recordValue.target, field.identity, context);
          if (bindingId) fieldBindings.set(field.fieldIndex, { id: bindingId });
        }
      }
      if (fieldBindings.size > 0) recordValues.set(recordValue.value.statementId, fieldBindings);
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
        type: { kind: "number" },
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
  const runtimeBindingIdForDocumentTarget = (target: Extract<ModuleScalarSourceTarget, { kind: "documentBinding" }>): BindingId => {
    const documentId = target.identity?.documentId;
    if (!documentId || documentId === moduleRuntimeContext?.rootDocumentId) return target.bindingId;
    return foreignSourceScalars.get(documentId)?.bindingIdByLocalId.get(target.bindingId) ?? target.bindingId;
  };
  const bindingInfoForTarget = (target: ModuleScalarSourceTarget, current: InstanceContext): BindingInfo | undefined => {
    if (target.kind === "documentBinding") return bindingInfoById.get(runtimeBindingIdForDocumentTarget(target));
    if (target.kind === "recordField") {
      const bindingId = recordFieldBindingIdForTarget(target.record, target.field, current);
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

  const hasValueForParameter = (current: InstanceContext, definitionStatementId: string, parameterIndex: number, definitionDocumentId?: DocumentId): boolean => {
    let cursor: InstanceContext | undefined = current;
    while (cursor) {
      if (cursor.definition.statementId === definitionStatementId &&
        (!definitionDocumentId || cursor.definitionDocumentId === definitionDocumentId)) {
        return cursor.instance.parameterBindings.find((binding) => binding.parameterIndex === parameterIndex)?.state === "optionalSupplied";
      }
      cursor = cursor.parentKey ? contextsByKey.get(cursor.parentKey) : undefined;
    }
    return false;
  };

  const presenceKeysSatisfied = (context: InstanceContext, keys: readonly string[]): boolean => {
    if (keys.length === 0) return true;
    const satisfiedPresenceKeys = new Set<string>();
    let cursor: InstanceContext | undefined = context;
    while (cursor) {
      for (const parameter of cursor.definition.parameters) {
        const binding = cursor.instance.parameterBindings.find((candidate) => candidate.parameterIndex === parameter.parameterIndex);
        if (parameter.optional && binding?.state === "optionalSupplied") {
          satisfiedPresenceKeys.add(moduleParameterPresenceKey(parameter.definitionStatementId, parameter.parameterIndex));
        }
      }
      cursor = cursor.parentKey ? contextsByKey.get(cursor.parentKey) : undefined;
    }
    return keys.every((key) => satisfiedPresenceKeys.has(key));
  };

  const moduleBodyStatementIsReachable = (context: InstanceContext, body: ModuleBodyStatementSemantic): boolean =>
    presenceKeysSatisfied(context, body.presenceParameterKeys);

  const contextIsReachable = (context: InstanceContext): boolean => {
    if (!context.parentKey) return true;
    const parent = contextsByKey.get(context.parentKey);
    if (!parent || !contextIsReachable(parent)) return false;
    const ownerBody = parent.definition.bodyStatements.find((body) => body.statementId === context.instance.statementId);
    return ownerBody ? moduleBodyStatementIsReachable(parent, ownerBody) : false;
  };

  const events: RuntimeEvent[] = [];
  const eventOrderByBindingId = new Map<BindingId, number>();
  const eventOrderByVersionId = new Map<string, number>();
  const eventOrderByStatementIndex = new Map<number, number>();
  const elementOrderById = new Map<ElementId, number>();
  const scopeExitOrderById = new Map<string, number>();
  let evaluationLimitSourceOrder: number | undefined;
  const pushEvent = (event: RuntimeEvent, sourceStatementIndex?: number) => {
    const order = events.length;
    events.push(event);
    if (sourceStatementIndex !== undefined && !eventOrderByStatementIndex.has(sourceStatementIndex)) {
      eventOrderByStatementIndex.set(sourceStatementIndex, order);
    }
    if (event.kind === "binding") eventOrderByBindingId.set(event.bindingId, order);
    if (event.kind === "set") eventOrderByVersionId.set(event.versionId, order);
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
    if (runtimeId) pushEvent({ kind: "element", elementId: runtimeId }, context.instance.statementIndex);
    for (const parameter of context.definition.parameters) {
      const info = context.parameters.get(parameter.parameterIndex);
      if (info) pushEvent({ kind: "binding", bindingId: info.id }, context.instance.statementIndex);
    }
    for (const fields of context.recordParameters.values()) {
      for (const field of fields.values()) {
        if (bindingInfoById.has(field.id)) pushEvent({ kind: "binding", bindingId: field.id }, context.instance.statementIndex);
      }
    }
    const pendingRecordValues = [...context.definition.recordValues].sort((left, right) => left.value.statementIndex - right.value.statementIndex);
    const emittedRecordValues = new Set<string>();
    const emitRecordValuesThrough = (statementIndex: number) => {
      for (const recordValue of pendingRecordValues) {
        if (emittedRecordValues.has(recordValue.value.statementId) || recordValue.value.statementIndex > statementIndex) continue;
        emittedRecordValues.add(recordValue.value.statementId);
        if (!presenceKeysSatisfied(context, recordValue.presenceParameterKeys)) continue;
        // Aliases and pass-through values reuse the source field bindings;
        // only a constructor introduces new runtime binding events.
        if (!recordValue.value.constructor) continue;
        for (const field of context.recordValues.get(recordValue.value.statementId)?.values() ?? []) {
          if (bindingInfoById.has(field.id)) pushEvent({ kind: "binding", bindingId: field.id }, recordValue.value.statementIndex);
        }
      }
    };
    for (const body of context.definition.bodyStatements) {
      emitRecordValuesThrough(body.statementIndex);
      if (!moduleBodyStatementIsReachable(context, body)) continue;
      if (body.statementKind === "typedDeclaration") {
        const info = context.locals.get(body.statementId);
        if (info) pushEvent({ kind: "binding", bindingId: info.id }, body.statementIndex);
      } else if (body.statementKind === "set") {
        const versionId = setVersionIdFor(context, body.statementId);
        pushEvent({ kind: "set", versionId }, body.statementIndex);
      } else if (body.statementKind === "moduleInstance") {
        const nestedPath = moduleRuntimeContext
          ? moduleRuntimeContext.runtimePathForInstance(context.path, (moduleRuntimeContext.analysisFor(context.definitionDocumentId) ?? moduleSemanticAnalysis).instancesByStatementId.get(body.statementId)!)
          : [...context.path, body.statementId];
        const nested = contextsByKey.get(pathKey(nestedPath));
        if (nested) emitInstance(nested);
      } else {
        const runtime = bodyRuntimeEntry(context, body);
        if (runtime) pushEvent({ kind: "element", elementId: runtime.elementId }, body.statementIndex);
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
    if (statement.kind === "atStop") {
      evaluationLimitSourceOrder ??= events.length;
      if (!eventOrderByStatementIndex.has(statementIndex)) {
        eventOrderByStatementIndex.set(statementIndex, events.length);
      }
      continue;
    }
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
    if (statement.kind === "typedDeclaration" || statement.kind === "set") {
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
      if (statement.kind === "set") {
        const setId = stableId;
        if (setId) pushEvent({ kind: "set", versionId: setId }, statementIndex);
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
      pushEvent({ kind: "element", elementId: entry.runtimeElementId }, entry.sourceStatementIndex);
    }
  }

  for (const info of allBindingInfos) info.eventOrder = eventOrderByBindingId.get(info.id);
  const moduleSeeds: BindingSeed[] = allBindingInfos.flatMap<BindingSeed>((info) => info.eventOrder === undefined ? [] : [{
    id: info.id,
    kind: "typed" as const,
    name: info.name,
    nameSpan: null,
    statementIndex: info.statementIndex,
    sourceOrder: info.eventOrder,
    effectiveScopeId: info.scopeId,
    visibility: { kind: "typed", scopeId: info.scopeId } as BindingSeed["visibility"],
    mutability: info.bindingKind === "let" ? "let" as const : "const" as const,
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
    .filter((binding) => binding.resolutionMode === "preResolvedOnly")
    .map((binding) => ({
      id: binding.id,
      kind: binding.kind,
      name: binding.name,
      nameSpan: binding.nameSpan,
      statementIndex: binding.statementIndex,
      sourceOrder: 0,
      effectiveScopeId: binding.effectiveScopeId,
      visibility: binding.visibility,
      mutability: binding.mutability,
      declaredType: binding.declaredType,
      ...(binding.declarationVersionId ? { declarationVersionId: binding.declarationVersionId } : {}),
      resolutionMode: "preResolvedOnly" as const
    }));
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
  const bindingsById = combinedCatalog.bindingsById;
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
    const info = bindingInfoForTarget(target, context);
    if (info) return bindingsById.get(info.id);
    if (target.kind === "recordField") {
      const bindingId = recordFieldBindingIdForTarget(target.record, target.field, context);
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
      const local = analysis?.genericValuesByStatementId.get(valueId);
      if (local?.ownerModuleDefinitionStatementIndex === context.definition.statementIndex) {
        return moduleCollectionValueIdFor(context.path, valueId);
      }
    }
    if (sourceNamespace?.geometryArraySemanticAnalysis?.genericValuesByStatementId.has(valueId)) return valueId;
    if (moduleRuntimeContext) {
      for (const document of moduleRuntimeContext.documentsById.values()) {
        if (document.sourceLexicalNamespace.geometryArraySemanticAnalysis?.genericValuesByStatementId.has(valueId)) {
          return document.documentId === moduleRuntimeContext.rootDocumentId
            ? valueId
            : `module-document-collection:${encodeIdentityTuple([document.documentId, valueId])}`;
        }
      }
    }
    return valueId;
  };

  const scalarCollectionMemberFromLiteral = (
    sourceText: string,
    type: ScalarType
  ): ScalarProgramCollectionMember | null => {
    const literal = scanScalarLiteral(sourceText, { start: 0, end: sourceText.length });
    if (literal.kind === "error" || literal.span.start !== 0 || literal.span.end !== sourceText.length) return null;
    const value: ScalarValue | null = literal.kind === "number"
      ? { kind: "number", value: literal.value }
      : literal.kind === "string"
        ? { kind: "string", value: literal.cooked }
        : literal.kind === "boolean"
          ? { kind: "boolean", value: literal.value }
          : type.kind === "choice" && literal.kind === "choice"
            ? { kind: "choice", value: literal.raw, options: type.options }
            : null;
    return value ? { kind: "literal", type, value } : null;
  };

  const scalarCollectionBindingForTarget = (
    target: import("../dsl/geometryArraySemanticAnalysis").GenericArraySourceTarget,
    context: InstanceContext
  ): BindingId | undefined => {
    if (target.kind === "moduleParameterValue") {
      return contextCandidatesFor(context)
        .find((candidate) => candidate.definition.statementId === target.definitionStatementId)
        ?.parameters.get(target.parameterIndex)?.id;
    }
    if (target.kind !== "scalarValue") return undefined;
    const local = contextCandidatesFor(context).map((candidate) => candidate.locals.get(target.statementId)).find(Boolean);
    return local?.id
      ?? baseCatalog.bindingsById.get(`binding:${target.statementId}`)?.id
      ?? [...foreignSourceScalars.values()].flatMap((foreign) => {
        const localId = foreign.analysis.bindingAnalysis.catalog.bindings.find((binding) => binding.kind === "typed" && binding.statementIndex === target.statementIndex)?.id;
        return localId ? [foreign.bindingIdByLocalId.get(localId)] : [];
      }).find((bindingId): bindingId is BindingId => bindingId !== undefined);
  };

  const moduleCollectionValues: ScalarProgramCollection[] = [];
  for (const context of contextsByKey.values()) {
    const contextAnalysis = sourceNamespaceForContext(context)?.geometryArraySemanticAnalysis;
    if (!contextAnalysis) continue;
    for (const value of contextAnalysis.genericValues) {
      if (value.ownerModuleDefinitionStatementIndex !== context.definition.statementIndex || !value.value) continue;
      const valueId = moduleCollectionValueIdFor(context.path, value.statementId);
      if (value.value.kind === "alias") {
        moduleCollectionValues.push({ valueId, kind: "alias", targetValueId: collectionValueIdFor(value.value.targetValueId, context) });
        continue;
      }
      const elementType = scalarTypeOfDslValueType(value.valueType.elementType);
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
      const targetValueId = binding?.value?.kind === "collection"
        ? collectionValueIdFor(binding.value.targetValueId, context.parentKey ? contextsByKey.get(context.parentKey) ?? null : null)
        : "";
      moduleCollectionValues.push({
        valueId: moduleCollectionValueIdFor(context.path, `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`),
        kind: "alias",
        targetValueId
      });
    }
  }
  const foreignCollectionValues: ScalarProgramCollection[] = [];
  for (const foreign of foreignSourceScalars.values()) {
    const collectionAnalysis = foreign.sourceNamespace.geometryArraySemanticAnalysis;
    if (!collectionAnalysis) continue;
    const foreignValueIdFor = (valueId: string) =>
      collectionAnalysis.genericValuesByStatementId.has(valueId)
        ? `module-document-collection:${encodeIdentityTuple([String(foreign.documentId), valueId])}`
        : valueId;
    for (const value of collectionAnalysis.genericValues) {
      if (value.ownerModuleDefinitionStatementIndex !== null || !value.value) continue;
      const valueId = foreignValueIdFor(value.statementId);
      if (value.value.kind === "alias") {
        foreignCollectionValues.push({ valueId, kind: "alias", targetValueId: foreignValueIdFor(value.value.targetValueId) });
        continue;
      }
      const elementType = scalarTypeOfDslValueType(value.valueType.elementType);
      if (!elementType) continue;
      const members: ScalarProgramCollectionMember[] = [];
      for (const member of value.value.members) {
        const literal = scalarCollectionMemberFromLiteral(member.sourceText, elementType);
        if (literal) {
          members.push(literal);
          continue;
        }
        if (member.target.kind !== "scalarValue") break;
        const target = member.target;
        const binding = foreign.analysis.bindingAnalysis.catalog.bindings.find((candidate) =>
          candidate.kind === "typed" && candidate.statementIndex === target.statementIndex
        );
        const bindingId = binding ? foreign.bindingIdByLocalId.get(binding.id) : undefined;
        if (!bindingId) break;
        members.push({ kind: "binding", type: elementType, bindingId });
      }
      if (members.length === value.value.members.length) foreignCollectionValues.push({ valueId, kind: "literal", members });
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
  const resolvedGeometryPropertyForContext = (
    target: ModuleGeometryPropertySourceTarget,
    context: InstanceContext
  ): ModuleGeometryPropertyRuntimeTarget | undefined => {
    if (moduleGeometryRuntime) {
      const lowered = moduleGeometryRuntime.resolvePropertyTarget(target, context.path, new Map(elements.map((element) => [element.id, element])));
      if (!lowered) return undefined;
      if (lowered.kind === "expression") return lowered;
      if (lowered.kind === "value") {
        return {
          ...lowered,
          targetSourceOrder: lowered.targetSourceOrder ?? (
            target.kind === "sourceGeometryProperty" || target.kind === "geometryValueProperty"
              ? executionPositionForValue(context.path, target.statementIndex)
              : -1
          )
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
        : undefined;
    }
    const child = runtimeContextForSourceInstance(context, target.instanceStatementId, target.instanceIdentity?.documentId);
    return child
      ? collectionLengthForValueIdAt(target.exportedStatementId, child, new Set())
      : undefined;
  };
  const resolvedGeometryBuiltinForContext = (
    occurrence: ModuleGeometryBuiltinArgumentSemantic,
    context: InstanceContext
  ): ScalarExpressionResolvedGeometryTarget | undefined => {
    if (!moduleGeometryRuntime || !occurrence.reference.target) return undefined;
    const lowered = moduleGeometryRuntime.resolveBuiltinTarget(
      occurrence.reference.target,
      context.path,
      occurrence.expectedGeometryType
    );
    if (!lowered) return undefined;
    if (lowered.kind === "geometryValue") {
      return {
        kind: "geometryValue",
        occurrence: lowered.occurrence,
        statementId: lowered.occurrence.sourceStatementId,
        statementIndex: occurrence.reference.target.kind === "geometryValue"
          ? executionPositionForValue(context.path, occurrence.reference.target.statementIndex)
          : occurrence.span.start,
        geometryType: lowered.geometryType,
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {})
      };
    }
    const statementIndex = elementOrderById.get(lowered.elementId);
    return statementIndex === undefined ? undefined : { statementId: lowered.elementId, statementIndex, geometryType: lowered.geometryType, ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}) };
  };
  const resolvedGeometryBuiltinForRoot = (
    occurrence: ModuleGeometryBuiltinArgumentSemantic
  ): ScalarExpressionResolvedGeometryTarget | undefined => {
    if (!moduleGeometryRuntime || !occurrence.reference.target) return undefined;
    const lowered = moduleGeometryRuntime.resolveBuiltinTarget(
      occurrence.reference.target,
      [],
      occurrence.expectedGeometryType
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
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {})
      };
    }
    const statementIndex = elementOrderById.get(lowered.elementId);
    return statementIndex === undefined ? undefined : { statementId: lowered.elementId, statementIndex, geometryType: lowered.geometryType, ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {}) };
  };
  const moduleInitializers = new Map<BindingId, TypedScalarExpression>();
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
      (definitionStatementId, parameterIndex, definitionDocumentId) => hasValueForParameter(context, definitionStatementId, parameterIndex, definitionDocumentId),
      (valueId) => collectionValueIdFor(valueId, context),
      (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder
    );
    moduleInitializers.set(ownerBindingId, lowered.expression);
    for (const reference of lowered.references) moduleReferences.push({ ...reference, fromBindingId: ownerBindingId });
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
      for (const field of fields) {
        const info = context.recordParameters.get(parameter.parameterIndex)?.get(field.field.fieldIndex);
        if (info?.id && field.expression) lowerForContext(field.expression, context, info.id);
      }
    }
    for (const recordValue of context.definition.recordValues) {
      if (!recordValue.value.constructor || !presenceKeysSatisfied(context, recordValue.presenceParameterKeys)) continue;
      for (const field of recordValue.fields) {
        const info = context.recordValues.get(recordValue.value.statementId)?.get(field.field.fieldIndex);
        if (info?.id && field.expression) lowerForContext(field.expression, context, info.id);
      }
    }
    for (const local of context.definition.localScalars) {
      const info = context.locals.get(local.statementId);
      const body = context.definition.bodyStatements.find((candidate) => candidate.statementId === local.statementId);
      if (info && local.initializer && body && moduleBodyStatementIsReachable(context, body)) {
        lowerForContext(local.initializer, context, info.id);
      }
    }
  }

  const moduleSets: SetStatementAnalysis[] = [];
  const materializedPropertyBindings: MaterializedPropertyBindingSource[] = [];
  const materializedNumericBindings: MaterializedNumericBindingSource[] = [];
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
        (definitionStatementId, parameterIndex, definitionDocumentId) => hasValueForParameter(context, definitionStatementId, parameterIndex, definitionDocumentId),
        (valueId) => collectionValueIdFor(valueId, context),
        (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder
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
      if (!moduleBodyStatementIsReachable(context, body)) continue;
      if (body.statementKind === "set") {
        const statement = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.statements[body.statementIndex] ?? statements[body.statementIndex];
        const info = body.scalarTarget?.kind === "moduleLocal" ? bindingInfoForTarget(body.scalarTarget, context) : undefined;
        const semantic = body.scalarExpressions[0]?.expression;
        const order = eventOrderByVersionId.get(setVersionIdFor(context, body.statementId));
        if (statement?.kind === "set" && info && semantic && order !== undefined) {
          const lowered = lowerExpression(
            semantic,
            (target) => resolvedBindingForContext(target, context),
            bindingsById,
            (target) => resolvedGeometryPropertyForContext(target, context),
            (target) => collectionLengthForTargetContext(target, context),
            (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
            (definitionStatementId, parameterIndex, definitionDocumentId) => hasValueForParameter(context, definitionStatementId, parameterIndex, definitionDocumentId),
            (valueId) => collectionValueIdFor(valueId, context),
            (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder
          );
          moduleSets.push({
            statementId: body.statementId,
            versionId: setVersionIdFor(context, body.statementId),
            sourceOrder: order,
            scopeId: moduleScopeIdFor(
              context.path,
              moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.sourceLexicalNamespace.scopeIndex.scopeOfStatement.get(body.statementIndex) ?? sourceScopeIndex?.scopeOfStatement.get(body.statementIndex) ?? context.bodyScopeId
            ),
            targetBindingId: info.id,
            targetName: statement.name,
            targetSpan: statement.nameSpan ?? statement.keywordSpan,
            expressionSpan: statement.payloadSpans.expression ?? statement.keywordSpan,
            expression: lowered.expression
          });
        }
      }
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
          (definitionStatementId, parameterIndex, definitionDocumentId) => hasValueForParameter(context, definitionStatementId, parameterIndex, definitionDocumentId),
          (valueId) => collectionValueIdFor(valueId, context),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder
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
  const combinedReferences = [...documentReferences, ...foreignReferences, ...moduleReferences];
  const combinedAnalysis = analyzeBindings({
    catalog: combinedCatalog,
    initializerReferences: combinedReferences,
    unavailableBindingIds: disabledBindingIds
  });
  const initializers = new Map<BindingId, TypedScalarExpression>();
  for (const foreign of foreignSourceScalars.values()) {
    for (const statement of foreign.program.statements) {
      const bindingId = foreign.bindingIdByLocalId.get(statement.bindingId);
      if (bindingId) initializers.set(bindingId, remapTypedExpressionBindingIds(statement.declaration.initializer, foreign.bindingIdByLocalId));
    }
  }
  const rootGeometryPropertyFor = (target: ModuleGeometryPropertySourceTarget): ModuleGeometryPropertyRuntimeTarget | undefined => {
    if (!moduleGeometryRuntime) return undefined;
    const lowered = moduleGeometryRuntime.resolvePropertyTarget(
      target,
      [],
      new Map(elements.map((element) => [element.id, element]))
    );
    if (!lowered || lowered.kind === "expression") return lowered;
    if (lowered.kind === "value") {
      return {
        ...lowered,
        targetSourceOrder: lowered.targetSourceOrder ?? (
          target.kind === "sourceGeometryProperty" || target.kind === "geometryValueProperty"
            ? executionPositionForValue([], target.statementIndex)
            : -1
        )
      };
    }
    const sourceOrder = elementOrderById.get(lowered.elementId);
    return sourceOrder === undefined ? undefined : { ...lowered, targetSourceOrder: sourceOrder };
  };
  const rootCollectionLengthFor = (
    target: Extract<ModuleGeometryPropertySourceTarget, { kind: "collectionValueLength" | "collectionParameterLength" | "deferredModuleCollectionExportLength" }>
  ): number | undefined => {
    if (target.kind === "collectionValueLength") {
      if (target.length !== null) return target.length;
      const deferred = parseGeometryArrayDeferredModuleExportId(target.valueId);
      if (!deferred) return undefined;
      const child = runtimeContextForSourceInstance(null, deferred.instanceStatementId);
      const exported = child?.definition.exports.find((candidate) => candidate.kind === "collection" && candidate.name === deferred.exportName);
      return child && exported?.kind === "collection"
        ? collectionLengthForValueIdAt(exported.exportedStatementId, child, new Set())
        : undefined;
    }
    if (target.kind === "collectionParameterLength") return undefined;
    const child = runtimeContextForSourceInstance(null, target.instanceStatementId, target.instanceIdentity?.documentId);
    return child ? collectionLengthForValueIdAt(target.exportedStatementId, child, new Set()) : undefined;
  };
  const rootBindingForTarget = (target: ModuleScalarSourceTarget, statementIndex: number): Binding | undefined => {
    if (target.kind === "documentBinding") return bindingsById.get(runtimeBindingIdForDocumentTarget(target));
    if (target.kind === "recordField") {
      const record = target.record;
      const bindingId = record.kind === "deferredModuleRecordExport" && sourceNamespace
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
                : rootRecordPlan?.fieldBindingIdsByValueStatementId.get(record.statementId)?.get(target.field.fieldIndex)
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
    return undefined;
  };

  const lowerGeometryInputTarget = (
    source: RuntimeGeometryInputTarget
  ): GeometryInputTarget | null => {
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
          (definitionStatementId, parameterIndex, definitionDocumentId) => hasValueForParameter(context, definitionStatementId, parameterIndex, definitionDocumentId),
          (valueId) => collectionValueIdFor(valueId, context),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder
        )
      : lowerExpression(
          source.target.index,
          (target) => rootBindingForTarget(target, source.target.targetSourceOrder),
          bindingsById,
          rootGeometryPropertyFor,
          rootCollectionLengthFor,
          resolvedGeometryBuiltinForRoot,
          undefined,
          (valueId) => collectionValueIdFor(valueId, null),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder
        );
    const members = source.members.flatMap((member) => {
      const lowered = geometryInputTargetForAlias(member);
      return lowered ? [lowered] : [];
    });
    if (members.length !== source.members.length) return null;
    return {
      kind: "collectionIndex",
      collectionValueId: collectionValueIdFor(source.target.collectionValueId, context ?? null),
      collectionLength: source.target.collectionLength ?? members.length,
      targetSourceOrder: context
        ? executionPositionForValue(context.path, source.target.targetSourceOrder)
        : executionPositionForValue([], source.target.targetSourceOrder),
      index: loweredIndex.expression,
      members
    };
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

  for (const [bindingId, initializer, statementIndex] of documentBindingAnalysis
    ? (documentBindingAnalysis as BindingAnalysis).catalog.bindings
      .filter((binding) => binding.kind === "typed")
      .map((binding) => [binding.id, documentScalarProgram?.statements.find((statement) => statement.bindingId === binding.id)?.declaration.initializer, binding.statementIndex] as const)
    : []) {
    if (initializer) {
      const statementId = stableStatementIdByIndex.get(statementIndex);
      const semanticSite = statementId ? moduleSemanticAnalysis.rootScalarExpressionsByStatementId.get(statementId) : undefined;
      if (semanticSite) {
        const lowered = lowerExpression(
          semanticSite.expression,
          (target) => rootBindingForTarget(target, statementIndex),
          bindingsById,
          rootGeometryPropertyFor,
          rootCollectionLengthFor,
          resolvedGeometryBuiltinForRoot,
          undefined,
          (valueId) => collectionValueIdFor(valueId, null),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder
        );
        initializers.set(bindingId, lowered.expression);
      } else {
        initializers.set(bindingId, initializer);
      }
    }
  }
  for (const [bindingId, initializer] of moduleInitializers) initializers.set(bindingId, initializer);

  const geometryValueProgramEntries: GeometryValueProgramEntry[] = [];

  const lowerGeometryValueScalar = (semantic: ModuleScalarExpressionSemantic, context?: InstanceContext) => {
    const lowered = context
      ? lowerExpression(
          semantic,
          (target) => resolvedBindingForContext(target, context),
          bindingsById,
          (target) => resolvedGeometryPropertyForContext(target, context),
          (target) => collectionLengthForTargetContext(target, context),
          (occurrence) => resolvedGeometryBuiltinForContext(occurrence, context),
          (definitionStatementId, parameterIndex, definitionDocumentId) => hasValueForParameter(context, definitionStatementId, parameterIndex, definitionDocumentId),
          (valueId) => collectionValueIdFor(valueId, context),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue(context.path, sourceOrder) : sourceOrder
        )
      : lowerExpression(
          semantic,
          (target, name, statementIndex) => rootBindingForTarget(target, statementIndex),
          bindingsById,
          rootGeometryPropertyFor,
          rootCollectionLengthFor,
          resolvedGeometryBuiltinForRoot,
          undefined,
          (valueId) => collectionValueIdFor(valueId, null),
          (sourceOrder) => sourceOrder >= 0 ? executionPositionForValue([], sourceOrder) : sourceOrder
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
    if (!reference.target || !moduleGeometryRuntime) return undefined;
    const path = context?.path ?? [];
    const lowered = moduleGeometryRuntime.resolveBuiltinTarget(reference.target, path, "point");
    if (!lowered) return undefined;
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
          ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {})
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
        ...(lowered.pointKey ? { pointKey: lowered.pointKey } : {})
      }
    };
  };

  const lowerGeometryValuePath = (
    reference: import("../dsl/moduleSemanticTypes").ModuleGeometryReferenceSemantic,
    context: InstanceContext | undefined,
    executionPosition: number
  ): GeometryValueProgramPath | undefined => {
    if (!reference.target || !moduleGeometryRuntime) return undefined;
    const path = context?.path ?? [];
    const lowered = moduleGeometryRuntime.resolveBuiltinTarget(reference.target, path, "line");
    if (!lowered) return undefined;
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
          geometryType: lowered.geometryType
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
        geometryType: lowered.geometryType
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

  const addGeometryValueProgramEntry = (value: import("../dsl/moduleSemanticTypes").ModuleGeometryValueSemantic, context?: InstanceContext) => {
    if (!value.construction) return;
    const path = context?.path ?? [];
    const executionPosition = executionPositionForValue(path, value.statementIndex);
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
                : (() => {
                const points = value.construction.pointsReference
                  ? moduleGeometryRuntime?.resolvePointReferenceList(
                    value.construction.pointsReference.source,
                    value.statementIndex,
                    path
                  )?.flatMap((anchor) => {
                    const lowered = lowerGeometryValueAnchor(anchor, executionPosition);
                    return lowered ? [lowered] : [];
                  }) ?? []
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
    geometryValueProgramEntries.push({
      sourceStatementId: value.statementId,
      sourceStatementIndex: value.statementIndex,
      declaredInterfaceType: value.declaredInterfaceType,
      occurrence: { sourceStatementId: value.statementId, instancePath: [...path] },
      executionPosition,
      construction
    });
  };

  for (const value of moduleSemanticAnalysis.geometryValues) {
    if (value.ownerModuleDefinitionStatementId !== null) continue;
    addGeometryValueProgramEntry(value);
  }
  for (const context of contextsByKey.values()) {
    if (contextIsDisabled(context) || !contextIsReachable(context)) continue;
    for (const value of context.definition.localGeometryValues) addGeometryValueProgramEntry(value, context);
  }
  geometryValueProgramEntries.sort((left, right) =>
    left.executionPosition - right.executionPosition ||
    left.sourceStatementIndex - right.sourceStatementIndex ||
    left.occurrence.instancePath.join("\u0000").localeCompare(right.occurrence.instancePath.join("\u0000"))
  );
  const geometryValueProgram: GeometryValueProgram = geometryValueProgramEntries;

  const sourceOrderByBindingId = new Map<BindingId, number>();
  for (const [bindingId, order] of eventOrderByBindingId) sourceOrderByBindingId.set(bindingId, order);
  const scalarProgram = lowerScalarProgram({
    bindingAnalysis: combinedAnalysis,
    typedInitializerByBindingId: initializers,
    positionMap: documentBindingAnalysis?.catalog ? { sourceOrderByElementIndex: [] } : { sourceOrderByElementIndex: [] },
    sourceOrderByBindingId,
    evaluationLimitSourceOrder,
    collectionValues: [
      ...(documentScalarProgram?.collectionValues ?? []),
      ...moduleCollectionValues,
      ...foreignCollectionValues
    ]
  });

  const sourceOrderByStatementIndex = new Map(eventOrderByStatementIndex);
  let nextSourceOrder = events.length;
  for (let statementIndex = statements.length - 1; statementIndex >= 0; statementIndex -= 1) {
    const exactOrder = sourceOrderByStatementIndex.get(statementIndex);
    if (exactOrder !== undefined) nextSourceOrder = exactOrder;
    else sourceOrderByStatementIndex.set(statementIndex, nextSourceOrder);
  }
  moduleSets.sort((left, right) => left.sourceOrder - right.sourceOrder);
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
    for (const body of context.definition.bodyStatements) {
      if (!moduleBodyStatementIsReachable(context, body)) continue;
      if (body.statementKind !== "element") continue;
      const runtime = bodyRuntimeEntry(context, body);
      if (!runtime) continue;
      const sourceOwnerId = body.statementId;
      const sourceStatement = moduleRuntimeContext?.documentFor(context.definitionDocumentId)?.statements[body.statementIndex] ?? statements[body.statementIndex];
      const sourceOwnerKind = sourceStatement?.kind === "element" ? sourceStatement.type : null;
      if (sourceOwnerKind !== "conditionalGroup" && sourceOwnerKind !== "forGroup") continue;
      const qualifiedOwnerId = moduleOwnerIdFor(context.path, sourceOwnerId);
      const owner = [...controlByScopeId.values()]
        .flatMap((control) => control.ownerChain)
        .find((candidate) => candidate.ownerStatementId === qualifiedOwnerId &&
          candidate.kind === (sourceOwnerKind === "forGroup" ? "forGroup" : "conditionalBranch"));
      if (!owner) continue;
      if (owner.kind === "conditionalBranch") conditionalOwnerStatementIdByElementId.set(runtime.elementId, owner.ownerStatementId);
      else forGroupMutationOwnerByElementId.set(runtime.elementId, { ...owner, elementId: runtime.elementId });
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
    moduleSetStatements: moduleSets,
    controlByScopeId,
    scalarExecutionPositionByRuntimeElementId,
    scalarExecutionPositionByStatementIndex: sourceOrderByStatementIndex,
    materializedPropertyBindings,
    materializedNumericBindings,
    materializedTextTemplates,
    materializedConditionalGroupConditions,
    conditionalOwnerStatementIdByElementId,
    forGroupMutationOwnerByElementId,
    geometryValueProgram,
    geometryInputTargetsByRuntimeElementId
  };
};
