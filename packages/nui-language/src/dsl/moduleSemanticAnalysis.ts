import { exactPhysicalSpan, type DiagnosticSpanContext } from "./dslDiagnosticSpan";
import { commonArgSpecs, constructionFor, constructionSpecsFor, isGeometryDeclarationCategory, type DslGeometryDeclarationCategory } from "./dslConstructions";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOf,
  moduleGeometryInterfaceTypeOfConstruction,
  moduleGeometryInterfaceTypeOfElement,
  moduleRuntimeGeometryKindOf,
  type ModuleGeometryInterfaceType
} from "./moduleGeometryInterfaces";
import {
  resolveSourceLexicalDeclaration,
  resolveSourceLexicalPath,
  type SourceLexicalDeclaration,
  type SourceLexicalLookup,
  type SourceLexicalNamespaceIndex
} from "./sourceLexicalNamespaceIndex";
import type { DslDiagnostic, DslDiagnosticRelatedInformation, DslDiagnosticPresentation, DslModuleParameterType, DslSpan, DslStatement } from "./dslTypes";
import {
  moduleParameterPresenceKey,
  parseAndCheckModuleScalarExpression,
  presenceFactsForSemanticFalse,
  presenceFactsForSemanticTruth,
  type ModuleGeometryBuiltinReferenceResolver,
  type ModuleGeometryPropertyReferenceInput,
  type ModuleGeometryPropertyReferenceResolution,
  type ModuleCollectionIndexReferenceResolution,
  type ModuleScalarLocalDiagnostic,
  type ModuleScalarReferenceResolution
} from "./moduleScalarExpression";
import { moduleCallEdges, moduleRecursionCycles } from "./moduleCallGraph";
import { analyzeModuleBody } from "./moduleBodySemantic";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import { coordinateComponent, recordField, recordSpans } from "./dslParameterSpanScanner";
import { parseScalarExpression } from "../scalars/expressionParser";
import type { ScalarExpressionAst } from "../scalars/expressionAst";
import { validateChoiceMatchExhaustiveness, validateOptionalMatchExhaustiveness } from "../scalars/expressionTypecheck";
import { parseDslConstructionInvocation } from "./dslCallParser";
import { parseGeometryArrayExpression } from "./geometryArrayExpression";
import { splitDslList } from "./dslTokens";
import { scanScalarLiteral } from "../scalars/literalScanner";
import { isChoiceOptionMember } from "../scalars/scalarAssignability";
import { getParameterDefinitions, scalarTypeForParameterDefinition } from "../parameters/parameterDefinitions";
import type { BindingId } from "../scalars/bindingCatalog";
import {
  numericGeometryPropertySupportedByStaticTarget,
  numericGeometryStaticTargetForConstruction,
  numericGeometryStaticTargetForModuleInterface,
  type NumericGeometryStaticTarget
} from "../geometry/numericGeometryProperties";
import { isDerivedPointKeyForGeometryCategory, isKnownDerivedPointKey, isLineEndpointPointKey } from "../model/pointAnchors";
import { scopeChain, type ScopeId } from "../scalars/lexicalScopeIndex";
import { geometryValueConstructionControlFlowUnsupported } from "./geometryValueConstructionScope";
import {
  resolveModuleLexicalDeclaration as resolveSharedModuleLexicalDeclaration,
  resolveModuleLexicalPath as resolveSharedModuleLexicalPath
} from "./moduleLexicalResolution";
import type { ScalarType } from "../scalars/types";
import {
  dslCoalesceResultType,
  dslRequiredValueTypeOf,
  isDslArrayValueType,
  isDslGeometryValueType,
  isDslOptionalValueType,
  isDslRecordValueType,
  isDslScalarValueType,
  isDslValueTypeAssignable,
  scalarExpressionTypeOfDslValueType,
  scalarTypeOfDslValueType,
  type DslValueType
} from "./dslValueTypes";
import { isDslNonArrayValueTypeAssignable } from "./geometryArrayTypes";
import type {
  DslArrayMappedValue,
  DslArraySemanticValue,
  GeometryArrayMappedValue,
  GeometryArraySemanticValue
} from "./geometryArraySemantics";
import {
  collectionLengthForValueId,
  collectionValueSemanticForStatement,
  geometryArrayDeferredModuleExportId,
  moduleParameterByName
} from "./geometryArraySemanticAnalysis";
import type { GenericArraySourceTarget, GeometryArraySourceTarget } from "./geometryArraySemanticAnalysis";
import { resolveDslArrayExpression } from "./geometryArraySemantics";
import type { StatementIdentity } from "../document/statementIdentity";
import type {
  ModuleArgumentSemantic,
  ModuleDefinitionSemantic,
  ExternalModuleSemanticTarget,
  ModuleGeometryPropertySourceTarget,
  ModuleGeometryReferenceSemantic,
  ModuleGeometryReferenceSite,
  ModuleGeometrySourceTarget,
  ModuleGeometryValueSemantic,
  ModuleGeometryValueExpressionSemantic,
  ModuleParentReferenceSemantic,
  ModuleParentReferenceSite,
  ModuleParentSourceTarget,
  ModuleRecordConstructorFieldSemantic,
  ModuleRecordFieldValueExpressionSemantic,
  ModuleInstanceSemantic,
  ModuleGeometryReferenceRole,
  ModuleGeometryConstructionSemantic,
  ModuleRecordFieldSourceTarget,
  ModuleRecordReferenceSemantic,
  ModuleRecordSourceTarget,
  ModuleRecordValueSemantic,
  ModuleRecordValueExpressionSemantic,
  ModuleScalarExpressionSemantic,
  ModuleScalarExpressionSite,
  ModuleScalarSourceTarget,
  ModuleSourceTarget,
  ModuleSemanticAnalysis,
  ModuleSemanticAnalysisInput,
  ResolvedModuleCallee,
  ResolvedModuleExport,
  ResolvedModuleParameter,
  ResolvedModuleParameterBinding
} from "./moduleSemanticTypes";
import { unwrapModuleGeometrySourceTarget } from "./moduleSemanticTypes";
import type {
  RecordConstructorFieldSemantic,
  RecordDefinitionSemantic,
  RecordFieldSemantic,
  RecordFieldIdentity,
  RecordTypeIdentity,
  RecordValueExpressionSemantic
} from "./recordSemanticAnalysis";
import { parseRecordConstructorFields } from "./recordSemanticAnalysis";
import {
  qualifySemanticIdentity,
  qualifySourceLocation,
  type DocumentQualifiedSourceLocation
} from "../document/multiDocumentPrimitives";

type DiagnosticRelatedSource = {
  statementIndex: number;
  span: DslSpan;
  message: string;
  presentation?: DslDiagnosticPresentation;
};

type LocalDiagnostic = ModuleScalarLocalDiagnostic & {
  relatedSources?: readonly DiagnosticRelatedSource[];
};

type DefinitionState = {
  statement: Extract<DslStatement, { kind: "moduleDefinition" }>;
  statementIndex: number;
  statementId: StatementIdentity;
  declarationScopeId: ScopeId;
  bodyScopeId: ScopeId;
  parameters: ResolvedModuleParameter[];
  parameterByName: Map<string, { parameter: ResolvedModuleParameter; index: number }>;
  bodyStatementIndexes: number[];
};

type ModuleLexicalLookup =
  | { kind: "parameter"; definition: DefinitionState; parameter: { parameter: ResolvedModuleParameter; index: number } }
  | { kind: "iteration"; statementId: StatementIdentity; statementIndex: number; name: string }
  | SourceLexicalLookup;

type ReferenceResolution = ModuleScalarReferenceResolution & {
  diagnostic?: LocalDiagnostic;
};

const scalarTypeOf = (type: DslModuleParameterType | null): ScalarType | null =>
  type && (type.kind === "number" || type.kind === "string" || type.kind === "boolean" || type.kind === "choice")
    ? type
    : null;

const geometryKindOf = moduleRuntimeGeometryKindOf;

const geometryKindOfCategory = (category: DslGeometryDeclarationCategory): "point" | "line" | null =>
  category === "point" ? "point" : category === "line" || category === "curve" || category === "arc" ? "line" : null;

const sourceSpanFor = (spans: DiagnosticSpanContext, statement: DslStatement, span: DslSpan) =>
  exactPhysicalSpan(spans, statement, span);

const toDiagnostic = (
  spans: DiagnosticSpanContext,
  statement: DslStatement,
  issue: LocalDiagnostic,
  relatedInformation: readonly DslDiagnosticRelatedInformation[] = []
): DslDiagnostic => {
  const physicalSpan = sourceSpanFor(spans, statement, issue.span);
  return {
    severity: "error",
    line: statement.line,
    column: issue.span.start + 1,
    code: issue.code,
    message: issue.message,
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {}),
    ...(issue.presentation ? { presentation: issue.presentation } : { presentation: { key: `diagnostic.${issue.code}` } }),
    ...(relatedInformation.length ? { relatedInformation } : {}),
    ...(issue.expectedType ? { expectedType: issue.expectedType } : {}),
    ...(issue.actualType ? { actualType: issue.actualType } : {})
  };
};

const issue = (code: string, span: DslSpan, message: string, extra: Partial<LocalDiagnostic> = {}): LocalDiagnostic => ({
  code,
  span,
  message,
  presentation: { key: `diagnostic.${code}` },
  ...extra
});

const moduleOwnerIndexOf = (statements: readonly DslStatement[], statementIndex: number): number | null => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    if (statements[enclosing.statementIndex]?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = statements[enclosing.statementIndex]?.enclosing ?? null;
  }
  return null;
};

const isMaterializedForGroupTemplate = (
  statements: readonly DslStatement[],
  statementIndex: number
): boolean => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    const candidate = statements[enclosing.statementIndex];
    if (candidate?.kind === "element" && candidate.type === "forGroup") return true;
    enclosing = candidate?.enclosing ?? null;
  }
  return false;
};

const isDirectModuleChild = (statement: DslStatement, moduleIndex: number) =>
  statement.enclosing?.statementIndex === moduleIndex;

const statementIdAt = (
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>,
  statementIndex: number
): StatementIdentity => {
  const id = stableStatementIdByIndex.get(statementIndex);
  if (id === undefined) throw new Error(`moduleSemanticAnalysis: no stable statement identity for index ${statementIndex}`);
  return id;
};

const geometryParameterTarget = (
  definition: DefinitionState,
  parameter: { parameter: ResolvedModuleParameter; index: number }
): Extract<ModuleGeometrySourceTarget, { kind: "parameter" }> | null => {
  const geometryKind = geometryKindOf(parameter.parameter.type);
  return geometryKind
    ? {
        kind: "parameter",
        definitionStatementId: definition.statementId,
        parameterIndex: parameter.index,
        geometryKind
      }
    : null;
};

const scalarParameterTarget = (
  definition: DefinitionState,
  parameter: { parameter: ResolvedModuleParameter; index: number }
): ModuleScalarSourceTarget | null => {
  return scalarTypeOf(parameter.parameter.type)
    ? { kind: "parameter", definitionStatementId: definition.statementId, parameterIndex: parameter.index }
    : null;
};

const sourceDeclarationResolution = (
  sourceNamespace: SourceLexicalNamespaceIndex,
  statementIndex: number,
  name: string
): SourceLexicalLookup => resolveSourceLexicalDeclaration(sourceNamespace, statementIndex, name);

const statementLocationFor = (
  source: DocumentQualifiedSourceLocation["source"] | undefined,
  statement: DslStatement | undefined
): DocumentQualifiedSourceLocation | undefined => {
  if (!source || !statement) return undefined;
  const physical = statement.namePhysicalSpan?.segments;
  const range = physical && physical.length > 0
    ? { from: physical[0]!.from, to: physical.at(-1)!.to }
    : { from: statement.documentRange.from, to: statement.documentRange.to };
  return qualifySourceLocation(source, range);
};

/** Resolve normal CAD namespace paths such as `Front::Seam::Point`.
 * Module export namespaces are handled separately, so this remains entirely
 * source-derived && does not introduce runtime name resolution. */
const qualifiedSourceDeclarationResolution = (
  sourceNamespace: SourceLexicalNamespaceIndex,
  statementIndex: number,
  path: ReturnType<typeof parseDslReferenceToken>
): SourceLexicalLookup | null => {
  if (path.segments.length < 2) return null;
  return resolveSourceLexicalPath(sourceNamespace, statementIndex, path);
};

const declarationGeometryTarget = (
  declaration: SourceLexicalDeclaration,
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>
): Extract<ModuleGeometrySourceTarget, { kind: "sourceGeometry" }> | null => {
  if (declaration.kind !== "geometry" || declaration.statement.kind !== "element" || !isGeometryDeclarationCategory(declaration.statement.category)) return null;
  const geometryKind = geometryKindOfCategory(declaration.statement.category);
  if (!geometryKind) return null;
  return {
    kind: "sourceGeometry",
    statementId: statementIdAt(stableStatementIdByIndex, declaration.statementIndex),
    statementIndex: declaration.statementIndex,
    category: declaration.statement.category,
    geometryKind
  };
};

const declarationGeometryPropertyTarget = (
  declaration: SourceLexicalDeclaration,
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>,
  property: string
): Extract<ModuleGeometryPropertySourceTarget, { kind: "sourceGeometryProperty" }> | null => {
  if (declaration.kind !== "geometry" || declaration.statement.kind !== "element" || !isGeometryDeclarationCategory(declaration.statement.category)) return null;
  return {
    kind: "sourceGeometryProperty",
    statementId: statementIdAt(stableStatementIdByIndex, declaration.statementIndex),
    statementIndex: declaration.statementIndex,
    category: declaration.statement.category,
    property
  };
};

const geometryPropertyTargetForSourceTarget = (
  target: ModuleGeometrySourceTarget,
  property: string,
  pointKey?: string
): ModuleGeometryPropertySourceTarget | null => {
  const effectivePointKey = pointKey ?? ("pointKey" in target ? target.pointKey : undefined);
  if (target.kind === "geometryValue") {
    if (target.backingTarget) return geometryPropertyTargetForSourceTarget(target.backingTarget, property, effectivePointKey);
    return {
      kind: "geometryValueProperty",
      statementId: target.statementId,
      statementIndex: target.statementIndex,
      declaredInterfaceType: target.declaredInterfaceType,
      ...(target.ownerModuleDefinitionStatementId !== undefined ? { ownerModuleDefinitionStatementId: target.ownerModuleDefinitionStatementId } : {}),
      ...(target.ownerModuleDefinitionStatementIndex !== undefined ? { ownerModuleDefinitionStatementIndex: target.ownerModuleDefinitionStatementIndex } : {}),
      property,
      ...(effectivePointKey ? { pointKey: effectivePointKey } : {}),
      ...(target.identity ? { identity: target.identity } : {})
    };
  }
  if (target.kind === "parameter") {
    return {
      ...target,
      kind: "parameterProperty",
      property,
      ...(effectivePointKey ? { pointKey: effectivePointKey } : {})
    };
  }
  if (target.kind === "sourceGeometry") {
    return {
      kind: "sourceGeometryProperty",
      statementId: target.statementId,
      statementIndex: target.statementIndex,
      category: target.category,
      property,
      ...(effectivePointKey ? { pointKey: effectivePointKey } : {}),
      ...(target.identity ? { identity: target.identity } : {})
    };
  }
  if (target.kind === "deferredModuleExport") {
    return {
      kind: "deferredModuleExportProperty",
      instanceStatementId: target.instanceStatementId,
      instanceStatementIndex: target.instanceStatementIndex,
      instanceName: target.instanceName,
      exportName: target.exportName,
      property,
      ...(effectivePointKey ? { pointKey: effectivePointKey } : {}),
      referenceSpan: target.referenceSpan,
      instanceSpan: target.instanceSpan,
      memberSpan: target.memberSpan,
      ...(target.instanceIdentity ? { instanceIdentity: target.instanceIdentity } : {}),
      ...(target.exportedIdentity ? { exportedIdentity: target.exportedIdentity } : {})
    };
  }
  return null;
};

const numericGeometryTargetForStatement = (
  statement: DslStatement | undefined,
  options: { intermediatePointCount?: number } = {}
): NumericGeometryStaticTarget | null =>
  statement?.kind === "element"
    ? numericGeometryStaticTargetForConstruction(statement.category, statement.construction, options)
    : null;

const intermediatePointCountForStatement = (statement: DslStatement | undefined): number | undefined => {
  if (statement?.kind !== "element" || statement.category !== "curve" || statement.construction !== "bezier") {
    return undefined;
  }
  const value = statement.attrs.find((attribute) => attribute.key === "intermediates")?.value;
  return value === undefined ? 0 : splitDslList(value).filter((item) => item.trim().length > 0).length;
};

const numericGeometryTargetForExport = (
  category: DslGeometryDeclarationCategory,
  statement: DslStatement | undefined
): NumericGeometryStaticTarget | null => {
  if (category === "point") return numericGeometryStaticTargetForModuleInterface("point");
  // Module geometry exports are exposed through the declared public geometry
  // interface, not through the concrete construction that produced them.
  // There is no public arc/Bezier interface yet, so line/path exports keep the
  // common path surface even when their source statement is concrete.
  if (category === "line" || category === "curve" || category === "arc") {
    return numericGeometryStaticTargetForModuleInterface("path");
  }
  const fromStatement = numericGeometryTargetForStatement(statement);
  if (fromStatement) return fromStatement;
  if (category === "text") return numericGeometryStaticTargetForConstruction("text", "");
  if (category === "image") return numericGeometryStaticTargetForConstruction("image", "");
  return numericGeometryStaticTargetForConstruction("line", "offset");
};

const choiceGeometryPropertyTypeForStatement = (
  statement: DslStatement | undefined,
  property: string
): ScalarType | null => {
  if (statement?.kind !== "element" || !statement.type) return null;
  const definition = getParameterDefinitions({ type: statement.type, intermediatePoints: [] } as never)
    .find((candidate) => candidate.key === property);
  const type = scalarTypeForParameterDefinition(definition);
  return type?.kind === "choice" ? type : null;
};

const declarationParentTarget = (
  declaration: SourceLexicalDeclaration,
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>
): ModuleParentSourceTarget | null => {
  if (declaration.kind !== "group" && declaration.kind !== "conditionalGroup" && declaration.kind !== "forGroup") return null;
  return {
    kind: "sourceContainer",
    statementId: statementIdAt(stableStatementIdByIndex, declaration.statementIndex),
    statementIndex: declaration.statementIndex,
    containerKind: declaration.kind
  };
};

const moduleCalleeDiagnosticCode = (resolution: ModuleInstanceSemantic["calleeResolution"]): string => {
  switch (resolution) {
    case "forward": return "module-forward-callee";
    case "notModule": return "module-callee-not-definition";
    case "ambiguous": return "module-ambiguous-callee";
    case "undefined": return "module-unresolved-callee";
    case "resolved": return "module-resolved-callee";
  }
};

export const analyzeModuleSemantics = (input: ModuleSemanticAnalysisInput): ModuleSemanticAnalysis => {
  const { statements, stableStatementIdByIndex, sourceNamespace, spans } = input;
  const recordAnalysis = sourceNamespace.recordSemanticAnalysis;
  const recordTypeIdentityByParameter = new Map(
    (recordAnalysis?.moduleParameters ?? []).map((parameter) => [
      `${parameter.definitionStatementId}:${parameter.parameterIndex}`,
      parameter.typeIdentity
    ] as const)
  );
  const diagnostics: DslDiagnostic[] = [];
  const localDiagnosticsByStatement = new Map<number, LocalDiagnostic[]>();
  let suppressLocalDiagnostics = false;
  // Root record scalar fields are also projected through the shared scalar
  // lowering owner. When generalized fields are validated here, keep scalar
  // diagnostics on that existing owner while allowing geometry/collection/
  // nested-record validation to report from this semantic pass.
  let suppressScalarRecordFieldDiagnostics = false;
  const addLocal = (statementIndex: number, local: LocalDiagnostic) => {
    if (suppressLocalDiagnostics) return;
    const bucket = localDiagnosticsByStatement.get(statementIndex) ?? [];
    bucket.push(local);
    localDiagnosticsByStatement.set(statementIndex, bucket);
  };
  const relatedAt = (
    statementIndex: number,
    span: DslSpan | null | undefined,
    message: string,
    presentation?: DslDiagnosticPresentation
  ): DiagnosticRelatedSource[] => span ? [{ statementIndex, span, message, ...(presentation ? { presentation } : {}) }] : [];
  const relatedForDeclaration = (
    declaration: SourceLexicalDeclaration,
    message = "Related declaration"
  ): DiagnosticRelatedSource[] => relatedAt(
    declaration.statementIndex,
    declaration.nameSpan ?? declaration.statement.keywordSpan,
    message,
    { key: "diagnostic.related.declaration" }
  );
  const definitionStates: DefinitionState[] = [];
  const stateByIndex = new Map<number, DefinitionState>();
  const geometryValuesByStatementIndex = new Map<number, ModuleGeometryValueSemantic>();
  const instances: ModuleInstanceSemantic[] = [];
  const definitions = statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter((entry): entry is { statement: Extract<DslStatement, { kind: "moduleDefinition" }>; statementIndex: number } => entry.statement.kind === "moduleDefinition");

  for (const { statement, statementIndex } of definitions) {
    const statementId = statementIdAt(stableStatementIdByIndex, statementIndex);
    const definitionIdentity = input.documentId
      ? qualifySemanticIdentity(input.documentId, statementId)
      : undefined;
    const declarationScopeId = sourceNamespace.scopeIndex.scopeOfStatement.get(statementIndex) ?? sourceNamespace.scopeIndex.rootScopeId;
    const bodyScopeId = `module:${statementId}`;
    const parameters: ResolvedModuleParameter[] = statement.parameters.map((parameter, parameterIndex) => ({
      definitionStatementId: statementId,
      parameterIndex,
      ...(definitionIdentity ? { definitionIdentity } : {}),
      name: parameter.name,
      type: parameter.type,
      valueType: parameter.valueType,
      ...(parameter.numericTypeOptions ? { numericTypeOptions: parameter.numericTypeOptions } : {}),
      recordTypeIdentity: recordTypeIdentityByParameter.get(`${statementId}:${parameterIndex}`) ?? null,
      optional: parameter.optional,
      required: !parameter.optional && parameter.defaultValue === null,
      defaultValue: parameter.defaultValue,
      defaultSpan: parameter.defaultSpan,
      defaultExpression: null
    }));
    const parameterByName = new Map<string, { parameter: ResolvedModuleParameter; index: number }>();
    for (const [parameterIndex, parameter] of parameters.entries()) {
      const previous = parameterByName.get(parameter.name);
      if (previous) {
        addLocal(statementIndex, issue(
          "module-parameter-duplicate",
          statement.parameters[parameterIndex].nameSpan ?? statement.keywordSpan,
          `module parameter「${parameter.name}」が重複しています。`,
          {
            presentation: { key: "diagnostic.module-parameter-duplicate", parameters: { parameter: parameter.name } },
            relatedSources: relatedAt(
              statementIndex,
              statement.parameters[previous.index].nameSpan ?? statement.keywordSpan,
              "First parameter with this name",
              { key: "diagnostic.related.first-parameter" }
            )
          }
        ));
      } else if (parameter.name) {
        parameterByName.set(parameter.name, { parameter, index: parameterIndex });
      }
    }
    const bodyStatementIndexes = statements
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate, candidateIndex }) => moduleOwnerIndexOf(statements, candidateIndex) === statementIndex && candidate.kind !== "blockEnd" && candidate.kind !== "blockElse")
      .map(({ candidateIndex }) => candidateIndex);
    const state: DefinitionState = { statement, statementIndex, statementId, declarationScopeId, bodyScopeId, parameters, parameterByName, bodyStatementIndexes };
    definitionStates.push(state);
    stateByIndex.set(statementIndex, state);
  }

  const relatedForParameter = (
    definition: DefinitionState,
    parameterIndex: number,
    preferType = false,
    message = preferType ? "Expected parameter type" : "Related parameter declaration"
  ): DiagnosticRelatedSource[] => {
    const parameter = definition.statement.parameters[parameterIndex];
    if (!parameter) return [];
    return relatedAt(
      definition.statementIndex,
      preferType ? parameter.typeSpan ?? parameter.nameSpan : parameter.nameSpan ?? parameter.typeSpan,
      message,
      { key: preferType ? "diagnostic.related.expected-parameter-type" : "diagnostic.related.parameter-declaration" }
    );
  };

  const defaultParameterOverlaysFor = (ownerIndex: number | null): readonly DefinitionState[] =>
    ownerIndex === null
      ? []
      : stateByIndex.get(ownerIndex)
        ? [stateByIndex.get(ownerIndex)!]
        : [];

  const moduleResolutionInputFor = (parameterOverlays: readonly DefinitionState[]) => ({
    sourceNamespace,
    stableStatementIdByIndex,
    parameterOverlays: parameterOverlays.map((definition) => ({
      bodyScopeId: definition.bodyScopeId,
      value: definition,
      parameters: definition.parameters.map((parameter, index) => ({
        index,
        name: parameter.name,
        value: { parameter, index }
      }))
    }))
  });

  const resolveModuleLexicalDeclaration = (
    statementIndex: number,
    ownerIndex: number | null,
    name: string,
    parameterOverlays: readonly DefinitionState[] = defaultParameterOverlaysFor(ownerIndex)
  ): ModuleLexicalLookup => {
    const shared = resolveSharedModuleLexicalDeclaration<
      { parameter: ResolvedModuleParameter; index: number },
      DefinitionState
    >(
      moduleResolutionInputFor(parameterOverlays),
      statementIndex,
      name
    );
    if (shared.kind !== "parameter") return shared;
    return {
      kind: "parameter",
      definition: shared.definition.value,
      parameter: shared.parameter.value
    };
  };

  const resolveModuleLexicalPath = (
    statementIndex: number,
    ownerIndex: number | null,
    path: ReturnType<typeof parseDslReferenceToken>,
    parameterOverlays: readonly DefinitionState[] = defaultParameterOverlaysFor(ownerIndex)
  ) => {
    const shared = resolveSharedModuleLexicalPath<
      { parameter: ResolvedModuleParameter; index: number },
      DefinitionState
    >(moduleResolutionInputFor(parameterOverlays), statementIndex, path);
    if (shared.kind !== "parameter") return shared;
    return {
      kind: "parameter" as const,
      definition: shared.definition.value,
      parameter: shared.parameter.value
    };
  };

  type ModuleCalleeResolution = {
    callee: ResolvedModuleCallee | null;
    externalTarget: ExternalModuleSemanticTarget | null;
    lookup: SourceLexicalLookup | { kind: "external"; member: { value: unknown } } | ModuleLexicalLookup;
  };

  /** Resolve a Module callee through the normal lexical owner first, then the
   * graph-backed external namespace hook for qualified import aliases. Bare
   * names intentionally never use the external hook. */
  const resolveModuleCallee = (
    statementIndex: number,
    ownerIndex: number | null,
    moduleName: string
  ): ModuleCalleeResolution => {
    const path = parseDslReferenceToken(moduleName);
    const lookup = path.segments.length > 1
      ? resolveSourceLexicalPath(sourceNamespace, statementIndex, path, {
          externalNamespaceResolver: input.externalNamespaceResolver
        })
      : ownerIndex === null
        ? sourceDeclarationResolution(sourceNamespace, statementIndex, moduleName)
        : resolveModuleLexicalDeclaration(statementIndex, ownerIndex, moduleName);
    if (lookup.kind === "external") {
      const value = lookup.member.value as { family?: unknown };
      const externalTarget = value.family === "module"
        ? input.externalModuleResolver?.(lookup.member) ?? null
        : null;
      return {
        externalTarget,
        callee: externalTarget
          ? {
              definitionStatementId: externalTarget.definitionStatementId,
              definitionStatementIndex: externalTarget.definitionStatementIndex,
              name: externalTarget.name,
              definitionIdentity: externalTarget.identity,
              definitionDocumentId: externalTarget.identity.documentId,
              definitionLocation: externalTarget.declaration,
              definition: externalTarget.definition,
              ...(externalTarget.documentation ? { documentation: externalTarget.documentation } : {})
            }
          : null,
        lookup
      };
    }
    if (lookup.kind === "resolved" && lookup.declaration.kind === "moduleDefinition" && lookup.declaration.statement.kind === "moduleDefinition") {
      const definitionStatementId = statementIdAt(stableStatementIdByIndex, lookup.declaration.statementIndex);
      const definitionIdentity = input.documentId
        ? qualifySemanticIdentity(input.documentId, definitionStatementId)
        : undefined;
      return {
        externalTarget: null,
        callee: {
          definitionStatementId,
          definitionStatementIndex: lookup.declaration.statementIndex,
          name: lookup.declaration.name,
          ...(definitionIdentity ? { definitionIdentity, definitionDocumentId: input.documentId } : {}),
          ...(input.source ? { definitionLocation: statementLocationFor(input.source, lookup.declaration.statement) } : {})
        },
        lookup
      };
    }
    return { callee: null, externalTarget: null, lookup };
  };

  // Body semantic analysis needs instance -> callee identity to resolve
  // qualified exports, while full argument analysis waits for branch facts.
  // Seed the existing instance collection with those identities first; the
  // complete pass below replaces these shells with normalized bindings.
  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "moduleInstance") continue;
    const ownerIndex = moduleOwnerIndexOf(statements, statementIndex);
    const resolved = resolveModuleCallee(statementIndex, ownerIndex, statement.moduleName);
    const { callee } = resolved;
    const lookup = resolved.lookup;
    const calleeResolution: ModuleInstanceSemantic["calleeResolution"] = callee
      ? "resolved"
      : lookup.kind === "external" && (lookup.member.value as { family?: unknown }).family !== "module"
        ? "notModule"
      : lookup.kind === "forward"
        ? "forward"
        : lookup.kind === "ambiguous"
          ? "ambiguous"
      : lookup.kind === "parameter" || lookup.kind === "iteration" || lookup.kind === "resolved"
        ? "notModule"
        : "undefined";
    instances.push({
      statementId: statementIdAt(stableStatementIdByIndex, statementIndex),
      statementIndex,
      name: statement.name,
      callerModuleDefinitionStatementId: ownerIndex === null ? null : stateByIndex.get(ownerIndex)?.statementId ?? null,
      callee,
      calleeResolution,
      parameterBindings: []
    });
  }

  const relatedForLookup = (
    lookup: ModuleLexicalLookup | ReturnType<typeof resolveModuleLexicalPath>,
    preferParameterType = false
  ): DiagnosticRelatedSource[] => {
    if (lookup.kind === "parameter") {
      return relatedForParameter(lookup.definition, lookup.parameter.index, preferParameterType);
    }
    if (lookup.kind === "iteration") {
      const statement = statements[lookup.statementIndex];
      return statement
        ? relatedAt(lookup.statementIndex, statement.nameSpan ?? statement.keywordSpan, "Related iteration declaration", { key: "diagnostic.related.iteration-declaration" })
        : [];
    }
    if (lookup.kind === "resolved") return relatedForDeclaration(lookup.declaration);
    if (lookup.kind === "forward" || lookup.kind === "ambiguous") {
      return lookup.declarations.flatMap((declaration) => relatedForDeclaration(declaration));
    }
    if (lookup.kind === "invalidTraversal") return relatedForDeclaration(lookup.declaration);
    return [];
  };

  const bindingByStatementIndex = new Map<number, { bindingId: BindingId; statementId: StatementIdentity }>(input.documentScalarBindings ?? []);

  type QualifiedModuleExportLookup =
    | {
        kind: "deferred";
        instance: SourceLexicalDeclaration;
        instanceName: string;
        instanceSpan: DslSpan;
        exportName: string;
        memberSpan: DslSpan;
      }
    | {
        kind: "undefined" | "forward" | "ambiguous" | "wrongKind" | "outerCapture";
        instanceName: string;
        instanceSpan: DslSpan;
        exportName: string;
        memberSpan: DslSpan;
        relatedSources: readonly DiagnosticRelatedSource[];
      };

  const resolveQualifiedModuleExport = (
    statementIndex: number,
    ownerIndex: number | null,
    referenceName: string,
    referenceSpan: DslSpan,
    referenceTextStart = 0
  ): QualifiedModuleExportLookup | null => {
    const segments = parseDslReferenceToken(referenceName).segments;
    if (segments.length < 2) return null;
    const instanceName = segments[0];
    const exportName = segments.at(-1)!;
    const instanceStart = referenceSpan.start + referenceTextStart + Math.max(0, referenceName.indexOf(instanceName));
    const memberStart = referenceSpan.start + referenceTextStart + Math.max(0, referenceName.lastIndexOf(exportName));
    const instanceSpan = { start: instanceStart, end: instanceStart + instanceName.length };
    const memberSpan = { start: memberStart, end: memberStart + exportName.length };
    const lookup = ownerIndex === null
      ? sourceDeclarationResolution(sourceNamespace, statementIndex, instanceName)
      : resolveModuleLexicalDeclaration(statementIndex, ownerIndex, instanceName);
    if (lookup.kind === "resolved") {
      // A qualified ordinary CAD namespace (for example
      // `前身頃::縫い代::先に縫う`) is not a module export. Let the normal
      // source-namespace path resolver handle every non-module declaration
      // below. Module export lookup remains exclusive to module instances.
      if (lookup.declaration.kind !== "moduleInstance") return null;
      const instanceOwnerIndex = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
      if (ownerIndex !== null && instanceOwnerIndex !== ownerIndex) {
        return {
          kind: "outerCapture",
          instanceName,
          instanceSpan,
          exportName,
          memberSpan,
          relatedSources: relatedForDeclaration(lookup.declaration)
        };
      }
      return { kind: "deferred", instance: lookup.declaration, instanceName, instanceSpan, exportName, memberSpan };
    }
    if (lookup.kind === "forward" || lookup.kind === "ambiguous") {
      if (lookup.declarations.every((declaration) => declaration.kind === "moduleInstance")) {
        return {
          kind: lookup.kind,
          instanceName,
          instanceSpan,
          exportName,
          memberSpan,
          relatedSources: lookup.declarations.flatMap((declaration) => relatedForDeclaration(declaration))
        };
      }
      return null;
    }
    if (lookup.kind === "parameter" || lookup.kind === "iteration") return null;
    return { kind: "undefined", instanceName, instanceSpan, exportName, memberSpan, relatedSources: [] };
  };

  const resolveSourceScalar = (
    statementIndex: number,
    ownerIndex: number | null,
    name: string,
    boundaryOwnerIndex: number | null = ownerIndex,
    referenceSpan: DslSpan = { start: 0, end: name.length },
    presenceFacts: ReadonlySet<string> = new Set()
  ): ReferenceResolution => {
    // Scalar AST reference spans include the leading `@`, while the
    // qualified-module resolver's source spans are defined over the path
    // text. Keep the already-resolved target's member/instance spans exact so
    // editor consumers can use them without reconstructing `instance::member`.
    const referenceTextStart = referenceSpan.end - referenceSpan.start === name.length + 1 ? 1 : 0;
    const qualified = resolveQualifiedModuleExport(statementIndex, ownerIndex, name, referenceSpan, referenceTextStart);
    if (qualified?.kind === "deferred") {
      const scalarExport = qualifiedScalarExportFor(qualified);
      if (scalarExport?.kind === "scalar") {
        return {
          target: {
            kind: "deferredModuleScalarExport",
            instanceStatementId: qualified.instance.statementId,
            instanceStatementIndex: qualified.instance.statementIndex,
            instanceName: qualified.instanceName,
            exportName: qualified.exportName,
            exportedStatementId: scalarExport.exportedStatementId,
            exportedStatementIndex: scalarExport.exportedStatementIndex,
            declaredType: scalarExport.declaredType,
            referenceSpan,
            instanceSpan: qualified.instanceSpan,
            memberSpan: qualified.memberSpan
          },
          type: scalarExport.declaredType,
          resolution: "resolved"
        };
      }
      const relatedSources = scalarExport && "exportedStatementIndex" in scalarExport
        ? relatedAt(
            scalarExport.exportedStatementIndex,
            statements[scalarExport.exportedStatementIndex]?.nameSpan ?? statements[scalarExport.exportedStatementIndex]?.keywordSpan,
            scalarExport.kind === "private" ? "Related module member declaration" : "Related geometry declaration",
            { key: scalarExport.kind === "private" ? "diagnostic.related.module-member-declaration" : "diagnostic.related.geometry-declaration" }
          )
        : [];
      return scalarExport?.kind === "geometry"
        ? {
            target: null,
            type: null,
            resolution: "invalid",
            diagnostic: issue(
              "module-geometry-reference-in-scalar",
              qualified.memberSpan,
              `scalar expression ではgeometry export「${qualified.exportName}」を参照できません。`,
              {
                relatedSources,
                presentation: { key: "diagnostic.module-geometry-reference-in-scalar", parameters: { name: qualified.exportName } }
              }
            )
          }
        : {
            target: null,
            type: null,
            resolution: "invalid",
            diagnostic: issue(
              scalarExport?.kind === "private" ? "module-private-member" : "module-undefined-export",
              qualified.memberSpan,
              scalarExport?.kind === "private"
                ? `module member「${qualified.exportName}」はexportされていないため参照できません。`
                : `module export「${qualified.exportName}」が見つかりません。`,
              {
                relatedSources,
                presentation: {
                  key: scalarExport?.kind === "private" ? "diagnostic.module-private-member" : "diagnostic.module-undefined-export",
                  parameters: { target: qualified.exportName }
                }
              }
            )
          };
    }
    if (qualified) {
      const resolution = qualified.kind === "forward" ? "forward" : qualified.kind === "undefined" ? "undefined" : qualified.kind === "outerCapture" ? "outerCapture" : "invalid";
      const code = qualified.kind === "forward"
        ? "module-forward-instance-reference"
        : qualified.kind === "ambiguous"
          ? "module-ambiguous-instance-reference"
          : qualified.kind === "outerCapture"
            ? "module-outer-capture"
            : "module-undefined-instance-reference";
      const message = qualified.kind === "forward"
        ? `module instance「${qualified.instanceName}」はこの位置より後で宣言されています。`
        : qualified.kind === "ambiguous"
          ? `module instance「${qualified.instanceName}」を一意に解決できません。`
          : qualified.kind === "outerCapture"
            ? `module body から outer module instance「${qualified.instanceName}」を暗黙 capture できません。`
            : `未定義のmodule instance「${qualified.instanceName}」を参照しています。`;
      return {
        target: null,
        type: null,
        resolution,
        diagnostic: issue(code, qualified.memberSpan, message, {
          relatedSources: qualified.relatedSources,
          presentation: {
            key: `diagnostic.${code}`,
            parameters: { name: qualified.instanceName }
          }
        })
      };
    }
    const record = recordSourceLookup(statementIndex, ownerIndex, name, referenceSpan);
    if (record.kind === "record") {
      return {
        target: null,
        type: null,
        resolution: "invalid",
        diagnostic: issue(
          "module-record-value-in-scalar",
          referenceSpan,
          `record 値「${name}」は scalar expression では参照できません。record field を指定してください。`,
          { presentation: { key: "diagnostic.module-record-value-in-scalar", parameters: { name } } }
        )
      };
    }
    if (record.kind === "blocked") {
      return { target: null, type: null, resolution: record.resolution === "outerCapture" ? "outerCapture" : record.resolution === "ambiguous" ? "invalid" : record.resolution, diagnostic: record.diagnostic };
    }
    const path = parseDslReferenceToken(name);
    const lookup = path.segments.length > 1
      ? resolveModuleLexicalPath(statementIndex, ownerIndex, path)
      : resolveModuleLexicalDeclaration(statementIndex, ownerIndex, name);
    if (lookup.kind === "parameter") {
      if (lookup.parameter.parameter.recordTypeIdentity) {
        return {
          target: {
            kind: "parameter",
            definitionStatementId: lookup.definition.statementId,
            parameterIndex: lookup.parameter.index
          },
          type: null,
          resolution: "invalid",
          diagnostic: issue("module-record-value-in-scalar", referenceSpan, `record parameter「${name}」は scalar expression では参照できません。record field を指定してください.`, {
            relatedSources: relatedForParameter(lookup.definition, lookup.parameter.index),
            presentation: { key: "diagnostic.module-record-value-in-scalar", parameters: { name } }
          })
        };
      }
      const type = scalarTypeOf(lookup.parameter.parameter.type);
      const parameterRelated = relatedForParameter(lookup.definition, lookup.parameter.index);
      if (type) {
        const target = scalarParameterTarget(lookup.definition, lookup.parameter);
        if (!target || target.kind !== "parameter") {
          return {
            target: null,
            type: null,
            resolution: "invalid",
            diagnostic: issue("module-scalar-geometry-reference", referenceSpan, `scalar expression では geometry parameter「${name}」を参照できません。`, {
              relatedSources: parameterRelated,
              presentation: { key: "diagnostic.module-scalar-geometry-reference", parameters: { name } }
            })
          };
        }
        if (lookup.parameter.parameter.optional && !presenceFacts.has(moduleParameterPresenceKey(target.definitionStatementId, target.parameterIndex))) {
          return {
            target,
            type: null,
            resolution: "invalid",
            diagnostic: issue("module-optional-value-required", referenceSpan, `optional module parameter「${name}」は hasValue(@${name}) で存在を確認してから参照してください。`, {
              relatedSources: parameterRelated,
              presentation: { key: "diagnostic.module-optional-value-required", parameters: { name } }
            })
          };
        }
        return { target, type, resolution: "resolved" };
      }
      const geometryTarget = geometryParameterTarget(lookup.definition, lookup.parameter);
      return {
        target: geometryTarget,
        type: null,
        resolution: "invalid",
        diagnostic: issue("module-scalar-geometry-reference", { start: 0, end: 0 }, `scalar expression では geometry parameter「${name}」を参照できません。`, {
          relatedSources: parameterRelated,
          presentation: { key: "diagnostic.module-scalar-geometry-reference", parameters: { name } }
        })
      };
    }
    if (lookup.kind === "iteration") {
      const iterationOwner = moduleOwnerIndexOf(statements, lookup.statementIndex);
      if (boundaryOwnerIndex !== null && iterationOwner !== boundaryOwnerIndex) {
        return {
          target: null,
          type: null,
          resolution: "outerCapture",
          diagnostic: issue("module-outer-capture", { start: 0, end: 0 }, `module body から outer scalar「${name}」を暗黙 capture できません。`, {
            relatedSources: relatedForLookup(lookup),
            presentation: { key: "diagnostic.module-outer-capture", parameters: { name } }
          })
        };
      }
      return { target: { ...lookup }, type: { kind: "number" }, resolution: "resolved" };
    }
    if (lookup.kind === "undefined") return { target: null, type: null, resolution: "undefined", diagnostic: issue("module-undefined-reference", { start: 0, end: 0 }, `未定義のmodule scalar「${name}」を参照しています。`, { presentation: { key: "diagnostic.module-undefined-reference", parameters: { name } } }) };
    if (lookup.kind === "forward") return { target: null, type: null, resolution: "forward", diagnostic: issue("module-forward-reference", { start: 0, end: 0 }, `module scalar「${name}」はこの位置より後で宣言されています。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-forward-reference", parameters: { name } } }) };
    if (lookup.kind === "ambiguous") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-ambiguous-reference", { start: 0, end: 0 }, `module scalar「${name}」を一意に解決できません。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-ambiguous-reference", parameters: { name } } }) };
    if (lookup.kind === "invalidOverlayTraversal") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-invalid-reference", { start: 0, end: 0 }, `「${lookup.name}」はparameter/iteration namespaceではありません。`, { presentation: { key: "diagnostic.module-invalid-reference", parameters: { name: lookup.name } } }) };
    if (lookup.kind === "invalidTraversal") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-invalid-reference", { start: 0, end: 0 }, `「${lookup.declaration.name}」はnamespace/containerではありません。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-invalid-reference", parameters: { name: lookup.declaration.name } } }) };
    const declaration = lookup.declaration;
    const declarationOwner = moduleOwnerIndexOf(statements, declaration.statementIndex);
    const declarationRelated = relatedForDeclaration(declaration);
    if (declaration.kind === "typedDeclaration" && declaration.statement.kind === "typedDeclaration") {
      const type = scalarExpressionTypeOfDslValueType(declaration.statement.valueType);
      if (boundaryOwnerIndex !== null && declarationOwner !== boundaryOwnerIndex) {
        return { target: null, type: null, resolution: "outerCapture", diagnostic: issue("module-outer-capture", declaration.nameSpan ?? declaration.statement.keywordSpan, `module body から outer scalar「${name}」を暗黙 capture できません。`, { relatedSources: declarationRelated, presentation: { key: "diagnostic.module-outer-capture", parameters: { name } } }) };
      }
      const statementId = statementIdAt(stableStatementIdByIndex, declaration.statementIndex);
      if (boundaryOwnerIndex !== null) return { target: { kind: "moduleLocal", statementId, statementIndex: declaration.statementIndex }, type, resolution: "resolved" };
      const binding = bindingByStatementIndex.get(declaration.statementIndex);
      if (!binding) return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-document-binding-unavailable", declaration.nameSpan ?? declaration.statement.keywordSpan, `document scalar「${name}」のbinding identityを取得できません。`, { relatedSources: declarationRelated, presentation: { key: "diagnostic.module-document-binding-unavailable", parameters: { name } } }) };
      return { target: { kind: "documentBinding", bindingId: binding.bindingId, statementId: binding.statementId, statementIndex: declaration.statementIndex }, type, resolution: "resolved" };
    }
    const geometryTarget = declarationGeometryTarget(declaration, stableStatementIdByIndex);
    if (geometryTarget) {
      return { target: geometryTarget, type: null, resolution: "invalid", diagnostic: issue("module-geometry-reference-in-scalar", declaration.nameSpan ?? declaration.statement.keywordSpan, `scalar expression では geometry「${name}」を参照できません。`, { relatedSources: declarationRelated, presentation: { key: "diagnostic.module-geometry-reference-in-scalar", parameters: { name } } }) };
    }
    return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-invalid-reference", declaration.nameSpan ?? declaration.statement.keywordSpan, `「${name}」はscalar bindingではありません。`, { relatedSources: declarationRelated, presentation: { key: "diagnostic.module-invalid-reference", parameters: { name } } }) };
  };

  const collectionValueTypeFor = (value: ReturnType<typeof collectionValueSemanticForStatement>) =>
    value && "valueType" in value
      ? value.valueType
      : value
        ? { kind: "array" as const, elementType: { kind: value.type.elementType as "point" | "line" | "path" } }
        : null;

  const resolveCollectionIndex = (
    statementIndex: number,
    ownerIndex: number | null,
    reference: { name: string; span: DslSpan },
    presenceFacts: ReadonlySet<string> = new Set()
  ): ModuleCollectionIndexReferenceResolution => {
    const invalid = (
      target: ModuleScalarSourceTarget | null,
      resolution: ModuleScalarReferenceResolution["resolution"],
      code: string,
      message: string,
      diagnosticSpan = reference.span,
      relatedSources: readonly DiagnosticRelatedSource[] = []
    ): ModuleCollectionIndexReferenceResolution => ({
      target,
      type: null,
      resolution,
      collectionValueId: null,
      collectionLength: null,
      targetSourceOrder: null,
      diagnostic: issue(code, diagnosticSpan, message, { relatedSources })
    });

    const collectionAnalysis = sourceNamespace.geometryArraySemanticAnalysis;
    if (!collectionAnalysis) {
      return invalid(null, "undefined", "module-collection-index-unavailable", `collection「${reference.name}」を解決できません。`);
    }
    const path = parseDslReferenceToken(reference.name);
    const parameter = path.segments.length === 1 && !path.absolute
      ? moduleParameterByName(statements, stableStatementIdByIndex, statementIndex, path.segments[0]!)
      : null;
    if (parameter) {
      const valueType = collectionAnalysis.genericModuleParametersBySlot.get(`${parameter.definitionStatementId}:${parameter.parameterIndex}`)?.valueType;
      if (!valueType) {
        return invalid(
          null,
          "invalid",
          "module-collection-index-type",
          `collection「${reference.name}」は scalar element collection ではありません。`,
          reference.span,
          relatedForParameter(
            definitionStates.find((candidate) => candidate.statementId === parameter.definitionStatementId)!,
            parameter.parameterIndex
          )
        );
      }
      const target: ModuleScalarSourceTarget = {
        kind: "collectionParameter",
        definitionStatementId: parameter.definitionStatementId,
        parameterIndex: parameter.parameterIndex,
        valueType,
        optional: parameter.parameter.optional
      };
      const elementType = scalarTypeOfDslValueType(valueType.elementType);
      if (!elementType) {
        return invalid(target, "invalid", "module-collection-index-type", `collection「${reference.name}」の element 型は scalar ではありません。`);
      }
      if (parameter.parameter.optional && !presenceFacts.has(moduleParameterPresenceKey(parameter.definitionStatementId, parameter.parameterIndex))) {
        return invalid(
          target,
          "invalid",
          "module-optional-value-required",
          `optional module parameter「${reference.name}」は hasValue(@${reference.name}) で存在を確認してから参照してください。`,
          reference.span,
          relatedForParameter(
            definitionStates.find((candidate) => candidate.statementId === parameter.definitionStatementId)!,
            parameter.parameterIndex
          )
        );
      }
      return {
        target,
        type: elementType,
        resolution: "resolved",
        collectionValueId: `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`,
        collectionLength: null,
        targetSourceOrder: -1
      };
    }

    const qualified = path.segments.length > 1
      ? resolveQualifiedModuleExport(statementIndex, ownerIndex, reference.name, reference.span, reference.span.end - reference.span.start === reference.name.length + 1 ? 1 : 0)
      : null;
    if (qualified?.kind === "deferred") {
      const exported = qualifiedCollectionExportFor(qualified);
      if (exported?.kind === "collection") {
        const target: ModuleScalarSourceTarget = {
          kind: "deferredModuleCollectionExport",
          instanceStatementId: qualified.instance.statementId,
          instanceStatementIndex: qualified.instance.statementIndex,
          instanceName: qualified.instanceName,
          exportName: qualified.exportName,
          exportedStatementId: exported.exportedStatementId,
          exportedStatementIndex: exported.exportedStatementIndex,
          valueType: exported.valueType,
          referenceSpan: reference.span,
          instanceSpan: qualified.instanceSpan,
          memberSpan: qualified.memberSpan,
          ...(input.documentId ? { instanceIdentity: qualifySemanticIdentity(input.documentId, qualified.instance.statementId) } : {})
        };
        const elementType = scalarTypeOfDslValueType(exported.valueType.elementType);
        if (!elementType) return invalid(target, "invalid", "module-collection-index-type", `module export「${qualified.exportName}」の element 型は scalar ではありません。`, qualified.memberSpan);
        return {
          target,
          type: elementType,
          resolution: "resolved",
          collectionValueId: geometryArrayDeferredModuleExportId(qualified.instance.statementId, qualified.exportName),
          collectionLength: null,
          targetSourceOrder: qualified.instance.statementIndex
        };
      }
      const diagnosticSpan = qualified.memberSpan;
      return invalid(
        null,
        "invalid",
        exported?.kind === "private" ? "module-private-member" : "module-undefined-export",
        exported?.kind === "private"
          ? `module member「${qualified.exportName}」はexportされていないため参照できません。`
          : `module export「${qualified.exportName}」が見つかりません。`,
        diagnosticSpan
      );
    }
    if (qualified) {
      const resolution = qualified.kind === "forward" ? "forward" : qualified.kind === "outerCapture" ? "outerCapture" : "invalid";
      return invalid(null, resolution, resolution === "forward" ? "module-forward-instance-reference" : resolution === "outerCapture" ? "module-outer-capture" : "module-undefined-instance-reference", `module instance「${qualified.instanceName}」を解決できません。`, qualified.memberSpan);
    }

    const lookup = ownerIndex === null
      ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, path) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, reference.name)
      : resolveModuleLexicalPath(statementIndex, ownerIndex, path);
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "typedDeclaration" || lookup.declaration.statement.kind !== "typedDeclaration") {
      if (lookup.kind === "forward") return invalid(null, "forward", "module-forward-reference", `collection「${reference.name}」はこの位置より後で宣言されています。`, reference.span, relatedForLookup(lookup));
      if (lookup.kind === "ambiguous") return invalid(null, "invalid", "module-ambiguous-reference", `collection「${reference.name}」を一意に解決できません。`, reference.span, relatedForLookup(lookup));
      return invalid(null, "undefined", "module-undefined-reference", `未定義の collection「${reference.name}」を参照しています。`, reference.span);
    }
    const value = collectionValueSemanticForStatement(collectionAnalysis, lookup.declaration.statementIndex);
    const valueType = collectionValueTypeFor(value);
    if (!value || !valueType) return invalid(null, "invalid", "module-collection-index-type", `参照先「${reference.name}」は collection ではありません。`, reference.span, relatedForDeclaration(lookup.declaration));
    const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
    if (ownerIndex !== null && declarationOwner !== ownerIndex) {
      return invalid(null, "outerCapture", "module-outer-capture", `module body から outer collection「${reference.name}」を暗黙 capture できません。`, reference.span, relatedForDeclaration(lookup.declaration));
    }
    const elementType = scalarTypeOfDslValueType(valueType.elementType);
    const target: ModuleScalarSourceTarget = {
      kind: "collectionValue",
      statementId: value.statementId,
      statementIndex: value.statementIndex,
      valueType,
      ...(input.documentId ? { identity: qualifySemanticIdentity(input.documentId, value.statementId) } : {})
    };
    if (!elementType) return invalid(target, "invalid", "module-collection-index-type", `collection「${reference.name}」の element 型は scalar ではありません。`, reference.span);
    return {
      target,
      type: elementType,
      resolution: "resolved",
      collectionValueId: value.statementId,
      collectionLength: collectionLengthForValueId(collectionAnalysis, value.statementId),
      targetSourceOrder: value.statementIndex
    };
  };

  const resolveDefaultScalar = (definition: DefinitionState, parameterIndex: number, reference: { name: string; span: DslSpan }): ReferenceResolution => {
    const ownParameter = definition.parameterByName.get(reference.name);
    if (ownParameter) {
      const relatedSources = relatedForParameter(definition, ownParameter.index);
      if (ownParameter.index >= parameterIndex) {
        return { target: null, type: null, resolution: "forward", diagnostic: issue("module-default-parameter-order", reference.span, `default は earlier parameter のみ参照できます:「${reference.name}」。`, { relatedSources, presentation: { key: "diagnostic.module-default-parameter-order", parameters: { name: reference.name } } }) };
      }
      const type = scalarTypeOf(ownParameter.parameter.type);
      if (ownParameter.parameter.optional) {
        return { target: scalarParameterTarget(definition, ownParameter), type: null, resolution: "invalid", diagnostic: issue("module-optional-value-required", reference.span, `optional module parameter「${reference.name}」は default で直接参照できません。hasValue(@${reference.name}) を使用してください。`, { relatedSources, presentation: { key: "diagnostic.module-optional-value-required", parameters: { name: reference.name } } }) };
      }
      return type
        ? { target: scalarParameterTarget(definition, ownParameter), type, resolution: "resolved" }
        : { target: null, type: null, resolution: "invalid", diagnostic: issue("module-default-invalid-reference", reference.span, `default の参照先「${reference.name}」はscalar parameterではありません。`, { relatedSources, presentation: { key: "diagnostic.module-default-invalid-reference", parameters: { name: reference.name } } }) };
    }
    const definitionSiteScopes = scopeChain(
      sourceNamespace.scopeIndex,
      sourceNamespace.scopeIndex.scopeOfStatement.get(definition.statementIndex) ?? sourceNamespace.scopeIndex.rootScopeId
    );
    const enclosingDefinitions = definitionSiteScopes.flatMap((scopeId) => {
      const enclosingDefinition = definitionStates.find((candidate) => candidate.bodyScopeId === scopeId);
      return enclosingDefinition ? [enclosingDefinition] : [];
    });
    const path = parseDslReferenceToken(reference.name);
    const lookup = path.segments.length > 1
      ? resolveModuleLexicalPath(definition.statementIndex, null, path, enclosingDefinitions)
      : resolveModuleLexicalDeclaration(definition.statementIndex, null, reference.name, enclosingDefinitions);
    const relatedSources = relatedForLookup(lookup);
    if (lookup.kind === "parameter") {
      const type = scalarTypeOf(lookup.parameter.parameter.type);
      if (lookup.parameter.parameter.optional) {
        return { target: scalarParameterTarget(lookup.definition, lookup.parameter), type: null, resolution: "invalid", diagnostic: issue("module-optional-value-required", reference.span, `optional module parameter「${reference.name}」は default で直接参照できません。hasValue(@${reference.name}) を使用してください。`, { relatedSources, presentation: { key: "diagnostic.module-optional-value-required", parameters: { name: reference.name } } }) };
      }
      return type
        ? { target: scalarParameterTarget(lookup.definition, lookup.parameter), type, resolution: "resolved" }
        : { target: null, type: null, resolution: "invalid", diagnostic: issue("module-default-invalid-reference", reference.span, `default の参照先「${reference.name}」はscalarではありません。`, { relatedSources, presentation: { key: "diagnostic.module-default-invalid-reference", parameters: { name: reference.name } } }) };
    }
    if (lookup.kind === "iteration") return { target: { ...lookup }, type: { kind: "number" }, resolution: "resolved" };
    if (lookup.kind === "undefined") return { target: null, type: null, resolution: "undefined", diagnostic: issue("module-undefined-reference", reference.span, `未定義のmodule scalar「${reference.name}」を参照しています。`, { presentation: { key: "diagnostic.module-undefined-reference", parameters: { name: reference.name } } }) };
    if (lookup.kind === "forward") return { target: null, type: null, resolution: "forward", diagnostic: issue("module-forward-reference", reference.span, `module scalar「${reference.name}」はこの位置より後で宣言されています。`, { relatedSources, presentation: { key: "diagnostic.module-forward-reference", parameters: { name: reference.name } } }) };
    if (lookup.kind === "ambiguous") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-ambiguous-reference", reference.span, `module scalar「${reference.name}」を一意に解決できません。`, { relatedSources, presentation: { key: "diagnostic.module-ambiguous-reference", parameters: { name: reference.name } } }) };
    if (lookup.kind === "invalidOverlayTraversal") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-invalid-reference", reference.span, `「${lookup.name}」はparameter/iteration namespaceではありません。`, { presentation: { key: "diagnostic.module-invalid-reference", parameters: { name: lookup.name } } }) };
    if (lookup.kind === "invalidTraversal") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-invalid-reference", reference.span, `「${lookup.declaration.name}」はnamespace/containerではありません。`, { relatedSources, presentation: { key: "diagnostic.module-invalid-reference", parameters: { name: lookup.declaration.name } } }) };
    const declaration = lookup.declaration;
    if (declaration.kind === "typedDeclaration" && declaration.statement.kind === "typedDeclaration") {
      const declarationOwner = moduleOwnerIndexOf(statements, declaration.statementIndex);
      const type = scalarExpressionTypeOfDslValueType(declaration.statement.valueType);
      const statementId = statementIdAt(stableStatementIdByIndex, declaration.statementIndex);
      if (declarationOwner !== null && stateByIndex.has(declarationOwner)) {
        return { target: { kind: "moduleLocal", statementId, statementIndex: declaration.statementIndex }, type, resolution: "resolved" };
      }
      const binding = bindingByStatementIndex.get(declaration.statementIndex);
      if (!binding) return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-document-binding-unavailable", reference.span, `definition site のscalar「${reference.name}」のbinding identityを取得できません。`, { relatedSources, presentation: { key: "diagnostic.module-document-binding-unavailable", parameters: { name: reference.name } } }) };
      return { target: { kind: "documentBinding", bindingId: binding.bindingId, statementId: binding.statementId, statementIndex: declaration.statementIndex }, type, resolution: "resolved" };
    }
    const geometryTarget = declarationGeometryTarget(lookup.declaration, stableStatementIdByIndex);
    return geometryTarget
      ? { target: geometryTarget, type: null, resolution: "invalid", diagnostic: issue("module-geometry-reference-in-default", reference.span, `default ではgeometry「${reference.name}」を参照できません。`, { relatedSources, presentation: { key: "diagnostic.module-geometry-reference-in-default", parameters: { name: reference.name } } }) }
      : { target: null, type: null, resolution: "invalid", diagnostic: issue("module-default-invalid-reference", reference.span, `default の参照先「${reference.name}」はscalar bindingではありません。`, { relatedSources, presentation: { key: "diagnostic.module-default-invalid-reference", parameters: { name: reference.name } } }) };
  };

  const resolveBodyScalar = (statementIndex: number, ownerIndex: number, reference: { name: string; span: DslSpan }, presenceFacts: ReadonlySet<string> = new Set()): ReferenceResolution => {
    const resolution = resolveSourceScalar(statementIndex, ownerIndex, reference.name, ownerIndex, reference.span, presenceFacts);
    if (resolution.diagnostic && resolution.diagnostic.span.start === 0 && resolution.diagnostic.span.end === 0) {
      return { ...resolution, diagnostic: { ...resolution.diagnostic, span: reference.span } };
    }
    return resolution;
  };

  const resolveHasValue = (
    statementIndex: number,
    ownerIndex: number | null,
    reference: { name: string; span: DslSpan }
  ): ReferenceResolution => {
    const path = parseDslReferenceToken(reference.name);
    const directDefinition = ownerIndex === null ? undefined : stateByIndex.get(ownerIndex);
    const directParameter = path.segments.length === 1 ? directDefinition?.parameterByName.get(reference.name) : undefined;
    const lookup = directParameter
      ? { kind: "parameter" as const, definition: directDefinition!, parameter: directParameter }
      : path.segments.length > 1
      ? resolveModuleLexicalPath(statementIndex, ownerIndex, path)
      : resolveModuleLexicalDeclaration(statementIndex, ownerIndex, reference.name);
    if (lookup.kind !== "parameter") {
      return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-has-value-argument", reference.span, "hasValue は optional module parameter の参照を1つだけ受け取ります。") };
    }
    const relatedSources = relatedForParameter(lookup.definition, lookup.parameter.index);
    if (!lookup.parameter.parameter.optional) {
      return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-has-value-parameter", reference.span, `hasValue の対象「${reference.name}」は optional module parameter ではありません。`, { relatedSources, presentation: { key: "diagnostic.module-has-value-parameter", parameters: { name: reference.name } } }) };
    }
    const target = scalarTypeOf(lookup.parameter.parameter.type)
      ? scalarParameterTarget(lookup.definition, lookup.parameter)
      : geometryParameterTarget(lookup.definition, lookup.parameter)
        ?? (lookup.parameter.parameter.recordTypeIdentity
          ? {
              kind: "parameter" as const,
              definitionStatementId: lookup.definition.statementId,
              parameterIndex: lookup.parameter.index
            }
          : null);
    if (!target) {
      return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-has-value-parameter", reference.span, `hasValue の対象「${reference.name}」は scalar または geometry の optional module parameter ではありません。`, { relatedSources, presentation: { key: "diagnostic.module-has-value-parameter", parameters: { name: reference.name } } }) };
    }
    return { target, type: scalarTypeOf(lookup.parameter.parameter.type), resolution: "resolved" };
  };

  const resolveBodyBareScalar = (statementIndex: number, ownerIndex: number, reference: { name: string; span: DslSpan }): ReferenceResolution | null => {
    const lookup = resolveModuleLexicalDeclaration(statementIndex, ownerIndex, reference.name);
    if (lookup.kind !== "iteration") return null;
    const iterationOwner = moduleOwnerIndexOf(statements, lookup.statementIndex);
    if (iterationOwner !== ownerIndex) {
      return { target: null, type: null, resolution: "outerCapture", diagnostic: issue("module-outer-capture", reference.span, `module body から outer scalar「${reference.name}」を暗黙 capture できません。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-outer-capture", parameters: { name: reference.name } } }) };
    }
    return { target: { ...lookup }, type: { kind: "number" }, resolution: "resolved" };
  };

  const analyzeExpression = (
    statementIndex: number,
    ownerIndex: number | null,
    raw: string,
    span: DslSpan,
    expectedType: import("../scalars/types").ScalarExpressionType | null,
    resolver: (reference: { name: string; span: DslSpan }, presenceFacts?: ReadonlySet<string>) => ReferenceResolution,
    bareResolver?: (reference: { name: string; span: DslSpan }) => ReferenceResolution | null,
    geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution,
    geometryBuiltinResolver?: ModuleGeometryBuiltinReferenceResolver,
    resolveHasValue?: (reference: { name: string; span: DslSpan }) => ReferenceResolution,
    presenceFacts: ReadonlySet<string> = new Set(),
    expectedTypeRelatedSources: readonly DiagnosticRelatedSource[] = []
  ) => {
    const local: LocalDiagnostic[] = [];
    const semantic = parseAndCheckModuleScalarExpression({
      raw,
      span,
      expectedType,
      resolveReference: (reference, expressionPresenceFacts) => {
        const resolution = resolver(reference, expressionPresenceFacts ?? presenceFacts);
        return resolution.diagnostic
          ? { ...resolution, diagnostic: { ...resolution.diagnostic, span: reference.span } }
          : resolution;
      },
      resolveHasValue,
      resolveCollectionIndex: (reference, expressionPresenceFacts) => resolveCollectionIndex(
        statementIndex,
        ownerIndex,
        reference,
        expressionPresenceFacts ?? presenceFacts
      ),
      resolveBareReference: bareResolver,
      resolveGeometryProperty: geometryPropertyResolver,
      resolveGeometryBuiltin: geometryBuiltinResolver,
      presenceFacts,
      diagnostics: local
    });
    const statement = statements[statementIndex];
    const declarationTypeRelatedSources = statement?.kind === "typedDeclaration"
      ? relatedAt(statementIndex, statement.payloadSpans.type, "Expected type declared here")
      : [];
    const scalarMismatchRelatedSources = expectedTypeRelatedSources.length
      ? expectedTypeRelatedSources
      : declarationTypeRelatedSources;
    for (const diagnostic of local) {
      addLocal(
        statementIndex,
        diagnostic.code === "module-scalar-type-mismatch" && scalarMismatchRelatedSources.length
          ? { ...diagnostic, relatedSources: scalarMismatchRelatedSources }
          : diagnostic
      );
    }
    return semantic;
  };

  for (const definition of definitionStates) {
    for (const [parameterIndex, parameter] of definition.parameters.entries()) {
      if (parameter.defaultValue === null || parameter.type === null) continue;
      const parameterRelated = relatedForParameter(definition, parameterIndex, true);
      const scalarType = scalarTypeOf(parameter.type);
      if (!scalarType) {
        addLocal(definition.statementIndex, issue("module-geometry-default", parameter.defaultSpan ?? definition.statement.keywordSpan, `geometry parameter「${parameter.name}」には default を指定できません。`, { relatedSources: relatedForParameter(definition, parameterIndex), presentation: { key: "diagnostic.module-geometry-default", parameters: { name: parameter.name } } }));
        continue;
      }
      const defaultSpan = parameter.defaultSpan;
      if (!defaultSpan) continue;
      const semantic = analyzeExpression(
        definition.statementIndex,
        definition.statementIndex,
        parameter.defaultValue,
        defaultSpan,
        scalarType,
        (reference) => resolveDefaultScalar(definition, parameterIndex, reference),
        undefined,
        undefined,
        undefined,
        (reference) => resolveHasValue(definition.statementIndex, definition.statementIndex, reference),
        undefined,
        parameterRelated
      );
      parameter.defaultExpression = semantic;
    }
    const directDeclarations = sourceNamespace.declarationsByScope.get(definition.bodyScopeId) ?? [];
    for (const declaration of directDeclarations) {
      const parameter = definition.parameterByName.get(declaration.name);
      if (parameter && declaration.statementIndex !== definition.statementIndex) {
        addLocal(declaration.statementIndex, issue("module-parameter-collision", declaration.nameSpan ?? declaration.statement.keywordSpan, `parameter「${declaration.name}」と同じmodule scopeで名前が衝突しています。`, { relatedSources: relatedForParameter(definition, parameter.index), presentation: { key: "diagnostic.module-parameter-collision", parameters: { name: declaration.name } } }));
      }
    }
  }

  const geometryReference = (
    source: string,
    span: DslSpan,
    expectedGeometryKind: "point" | "line",
    target: ModuleGeometrySourceTarget | null,
    resolution: ModuleGeometryReferenceSemantic["resolution"],
    coordinate: ModuleGeometryReferenceSemantic["coordinate"] = null,
    role: ModuleGeometryReferenceRole = expectedGeometryKind === "point" ? "pointReference" : "lineReference",
    nameSpan: DslSpan | null = null,
    valueType?: DslValueType
  ): ModuleGeometryReferenceSemantic => ({
    source,
    span,
    expectedGeometryKind,
    role,
    target,
    ...(valueType ? { valueType } : {}),
    coordinate,
    ...(nameSpan ? { nameSpan } : {}),
    resolution
  });

  const deferredModuleExportTarget = (
    qualified: Extract<QualifiedModuleExportLookup, { kind: "deferred" }>,
    expectedGeometryKind: "point" | "line",
    expectedInterfaceType: ModuleGeometryInterfaceType,
    span: DslSpan,
    pointKey: string | null
  ): Extract<ModuleGeometrySourceTarget, { kind: "deferredModuleExport" }> => ({
    kind: "deferredModuleExport",
    instanceStatementId: qualified.instance.statementId,
    instanceStatementIndex: qualified.instance.statementIndex,
    instanceName: qualified.instanceName,
    exportName: qualified.exportName,
    expectedGeometryKind,
    expectedInterfaceType,
    ...(pointKey ? { pointKey } : {}),
    referenceSpan: span,
    instanceSpan: qualified.instanceSpan,
    memberSpan: qualified.memberSpan
  });

  const qualifiedScalarExportFor = (
    qualified: Extract<QualifiedModuleExportLookup, { kind: "deferred" }>
  ): { kind: "scalar"; exportedStatementId: StatementIdentity; exportedStatementIndex: number; declaredType: ScalarType }
    | { kind: "geometry"; exportedStatementIndex: number; category: DslGeometryDeclarationCategory | null; interfaceType: ModuleGeometryInterfaceType }
    | { kind: "private"; exportedStatementIndex: number }
    | null => {
    const instance = instances.find((candidate) => candidate.statementId === qualified.instance.statementId);
    const externalDefinition = instance?.callee?.definition;
    if (externalDefinition) {
      const exported = externalDefinition.exports.find((candidate) => candidate.name === qualified.exportName);
      if (exported?.kind === "scalar") {
        return {
          kind: "scalar",
          exportedStatementId: exported.exportedStatementId,
          exportedStatementIndex: exported.exportedStatementIndex,
          declaredType: exported.declaredType
        };
      }
      return exported?.kind === "geometry"
        ? { kind: "geometry", exportedStatementIndex: exported.exportedStatementIndex, category: exported.category, interfaceType: exported.interfaceType }
        : null;
    }
    const definition = instance?.callee && stateByIndex.get(instance.callee.definitionStatementIndex);
    const exported = definition?.bodyStatementIndexes
      .map((statementIndex) => ({ statementIndex, statement: statements[statementIndex] }))
      .find(({ statement }) =>
        isDirectModuleChild(statement, definition.statementIndex) &&
        statement.name === qualified.exportName &&
        ((statement.kind === "typedDeclaration" && statement.exported) || (statement.kind === "element" && statement.exported))
      );
    if (!exported) {
      const privateMember = definition?.bodyStatementIndexes
        .map((statementIndex) => ({ statementIndex, statement: statements[statementIndex] }))
        .find(({ statement }) => isDirectModuleChild(statement, definition.statementIndex) && statement.name === qualified.exportName);
      return privateMember ? { kind: "private", exportedStatementIndex: privateMember.statementIndex } : null;
    }
    if (exported.statement.kind === "typedDeclaration") {
      const declaredType = scalarTypeOfDslValueType(exported.statement.valueType);
      if (declaredType) {
        return {
          kind: "scalar",
          exportedStatementId: statementIdAt(stableStatementIdByIndex, exported.statementIndex),
          exportedStatementIndex: exported.statementIndex,
          declaredType
        };
      }
      const geometryType = isDslGeometryValueType(exported.statement.valueType)
        ? exported.statement.valueType.kind
        : null;
      if (geometryType) {
        return {
          kind: "geometry",
          exportedStatementIndex: exported.statementIndex,
          category: null,
          interfaceType: geometryType
        };
      }
    }
    if (exported.statement.kind !== "element" || !isGeometryDeclarationCategory(exported.statement.category)) return null;
    return {
      kind: "geometry",
      exportedStatementIndex: exported.statementIndex,
      category: exported.statement.category,
      interfaceType: moduleGeometryInterfaceTypeOfElement(exported.statement) ?? (exported.statement.category === "point" ? "point" : "path")
    };
  };

  const qualifiedCollectionExportFor = (
    qualified: Extract<QualifiedModuleExportLookup, { kind: "deferred" }>
  ): { kind: "collection"; exportedStatementId: StatementIdentity; exportedStatementIndex: number; valueType: import("./dslValueTypes").DslArrayValueType }
    | { kind: "private"; exportedStatementIndex: number }
    | null => {
    const instance = instances.find((candidate) => candidate.statementId === qualified.instance.statementId);
    const externalDefinition = instance?.callee?.definition;
    if (externalDefinition) {
      const exported = externalDefinition.exports.find((candidate) => candidate.name === qualified.exportName);
      return exported?.kind === "collection"
        ? {
            kind: "collection",
            exportedStatementId: exported.exportedStatementId,
            exportedStatementIndex: exported.exportedStatementIndex,
            valueType: exported.valueType
          }
        : null;
    }
    const definition = instance?.callee && stateByIndex.get(instance.callee.definitionStatementIndex);
    const named = definition?.bodyStatementIndexes
      .map((statementIndex) => ({ statementIndex, statement: statements[statementIndex] }))
      .find(({ statement }) =>
        isDirectModuleChild(statement, definition.statementIndex) &&
        statement.name === qualified.exportName &&
        statement.kind === "typedDeclaration"
    );
    if (!named) return null;
    if (named.statement.kind !== "typedDeclaration") return null;
    if (!named.statement.exported) return { kind: "private", exportedStatementIndex: named.statementIndex };
    if (!isDslArrayValueType(named.statement.valueType)) return null;
    const value = collectionValueSemanticForStatement(sourceNamespace.geometryArraySemanticAnalysis!, named.statementIndex);
    return value
      ? {
          kind: "collection",
          exportedStatementId: value.statementId,
          exportedStatementIndex: named.statementIndex,
          valueType: "valueType" in value ? value.valueType : { kind: "array" as const, elementType: { kind: value.type.elementType as "point" | "line" | "path" } }
        }
      : null;
  };

  type RecordSourceLookup =
    | {
        kind: "record";
        target: ModuleRecordSourceTarget;
        typeIdentity: RecordTypeIdentity;
        definition: RecordDefinitionSemantic;
      }
    | {
        kind: "blocked";
        resolution: "undefined" | "forward" | "ambiguous" | "invalid" | "outerCapture";
        diagnostic?: LocalDiagnostic;
      }
    | { kind: "notRecord" };

  function recordDefinitionFor(typeIdentity: RecordTypeIdentity | null) {
    return typeIdentity ? recordAnalysis?.definitionsByStatementId.get(typeIdentity) ?? null : null;
  }

  function recordSourceLookup(
    statementIndex: number,
    ownerIndex: number | null,
    base: string,
    span: DslSpan
  ): RecordSourceLookup {
    if (!recordAnalysis) return { kind: "notRecord" };
    if (activeRecordValueBinder) {
      const binderPath = parseDslReferenceToken(base);
      if (!binderPath.absolute && binderPath.segments.length === 1 && binderPath.segments[0] === activeRecordValueBinder.name) {
        const definition = recordDefinitionFor(activeRecordValueBinder.typeIdentity);
        return definition
          ? {
              kind: "record",
              target: activeRecordValueBinder,
              typeIdentity: activeRecordValueBinder.typeIdentity,
              definition
            }
          : { kind: "blocked", resolution: "invalid" };
      }
    }
    const path = parseDslReferenceToken(base);
    const qualified = path.segments.length > 1
      ? resolveQualifiedModuleExport(statementIndex, ownerIndex, base, span)
      : null;
    if (qualified?.kind === "deferred") {
      const exported = qualifiedRecordExportFor(qualified);
      if (exported?.kind === "record") {
        return {
          kind: "record",
          target: {
            kind: "deferredModuleRecordExport",
            instanceStatementId: qualified.instance.statementId,
            instanceStatementIndex: qualified.instance.statementIndex,
            instanceName: qualified.instanceName,
            exportName: qualified.exportName,
            exportedStatementId: exported.exportedStatementId,
            exportedStatementIndex: exported.exportedStatementIndex,
            typeIdentity: exported.typeIdentity,
            referenceSpan: span,
            instanceSpan: qualified.instanceSpan,
            memberSpan: qualified.memberSpan
          },
          typeIdentity: exported.typeIdentity,
          definition: exported.definition
        };
      }
      return { kind: "notRecord" };
    }
    if (qualified) return { kind: "notRecord" };

    const lookup = path.segments.length > 1
      ? ownerIndex === null
        ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, path) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, base)
        : resolveModuleLexicalPath(statementIndex, ownerIndex, path)
      : resolveModuleLexicalDeclaration(statementIndex, ownerIndex, base);
    if (lookup.kind === "parameter") {
      const typeIdentity = lookup.parameter.parameter.recordTypeIdentity;
      if (!typeIdentity) return { kind: "notRecord" };
      const definition = recordDefinitionFor(typeIdentity);
      return definition
        ? {
            kind: "record",
            target: {
              kind: "recordParameter",
              definitionStatementId: lookup.definition.statementId,
              parameterIndex: lookup.parameter.index,
              typeIdentity
            },
            typeIdentity,
            definition
          }
        : { kind: "blocked", resolution: "invalid" };
    }
    if (lookup.kind === "resolved" && lookup.declaration.kind === "recordValue") {
      const value = recordAnalysis.valuesByStatementId.get(lookup.declaration.statementId);
      const definition = recordDefinitionFor(value?.typeIdentity ?? null);
      if (!value?.typeIdentity || !definition) return { kind: "blocked", resolution: "invalid" };
      const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
      if (ownerIndex !== null && declarationOwner !== ownerIndex) {
        return {
          kind: "blocked",
          resolution: "outerCapture",
          diagnostic: issue(
            "module-outer-capture",
            span,
            `module body から outer record「${base}」を暗黙 capture できません。`,
            {
              relatedSources: relatedForDeclaration(lookup.declaration),
              presentation: { key: "diagnostic.module-outer-capture", parameters: { name: base } }
            }
          )
        };
      }
      return {
        kind: "record",
        target: {
          kind: "recordValue",
          statementId: value.statementId,
          statementIndex: value.statementIndex,
          typeIdentity: value.typeIdentity,
          ...(value.valueExpression?.kind === "coalesce" ? { valueExpressionKind: "coalesce" as const } : {})
        },
        typeIdentity: value.typeIdentity,
        definition
      };
    }
    if (lookup.kind === "forward" && lookup.declarations.some((declaration) => declaration.kind === "recordValue")) {
      return {
        kind: "blocked",
        resolution: "forward",
        diagnostic: issue("module-record-forward-reference", span, `record 値「${base}」はこの位置より後で宣言されています。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-record-forward-reference", parameters: { name: base } } })
      };
    }
    if (lookup.kind === "ambiguous" && lookup.declarations.some((declaration) => declaration.kind === "recordValue")) {
      return {
        kind: "blocked",
        resolution: "ambiguous",
        diagnostic: issue("module-record-ambiguous-reference", span, `record 値「${base}」を一意に解決できません。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-record-ambiguous-reference", parameters: { name: base } } })
      };
    }
    if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "recordValue") {
      return {
        kind: "blocked",
        resolution: "invalid",
        diagnostic: issue("module-record-invalid-reference", span, `record 値「${lookup.declaration.name}」は namespace ではありません。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-record-invalid-reference", parameters: { name: lookup.declaration.name } } })
      };
    }
    return { kind: "notRecord" };
  }

  type RecordMemberResolution = {
    field: RecordFieldSemantic;
    fieldPath: readonly RecordFieldIdentity[];
    valueType: import("./dslValueTypes").DslValueType;
    property?: string;
    collectionIndex?: number;
    type: ScalarType | null;
  };

  const recordPropertyParts = (property: string): { name: string; index: number | null }[] | null => {
    if (!property) return null;
    const parts = property.split(".");
    const parsed = parts.map((part) => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/.exec(part);
      return match
        ? { name: match[1]!, index: match[2] === undefined ? null : Number(match[2]) }
        : null;
    });
    return parsed.every((part): part is { name: string; index: number | null } => part !== null) ? parsed : null;
  };

  const recordMemberFor = (
    record: Extract<RecordSourceLookup, { kind: "record" }>,
    property: string
  ): RecordMemberResolution | null => {
    const parts = recordPropertyParts(property);
    if (!parts) return null;
    let definition: RecordDefinitionSemantic | null = record.definition;
    let valueType: import("./dslValueTypes").DslValueType = { kind: "record", name: definition.name, identity: definition.statementId };
    const fieldPath: RecordFieldIdentity[] = [];
    let field: RecordFieldSemantic | null = null;
    let collectionIndex: number | undefined;
    for (const [partIndex, part] of parts.entries()) {
      if (isDslRecordValueType(valueType)) {
        definition = partIndex === 0
          ? record.definition
          : recordDefinitionFor(valueType.identity ?? null);
        if (!definition) return null;
        field = definition.fields.find((candidate) => candidate.name === part.name) ?? null;
        if (!field) return null;
        fieldPath.push(field.identity);
        valueType = field.type;
        if (part.index !== null) {
          if (!isDslArrayValueType(valueType)) return null;
          valueType = valueType.elementType;
          collectionIndex = part.index;
        }
      } else if (isDslArrayValueType(valueType)) {
        if (part.name !== "length" || part.index !== null || partIndex !== parts.length - 1) return null;
        return field
          ? { field, fieldPath, valueType, property: "length", type: { kind: "number" } }
          : null;
      } else if (isDslGeometryValueType(valueType)) {
        const geometryProperty = parts.slice(partIndex).map((candidate) => candidate.name + (candidate.index === null ? "" : `[${candidate.index}]`)).join(".");
        const type = numericGeometryPropertySupportedByStaticTarget(
          numericGeometryStaticTargetForModuleInterface(valueType.kind),
          geometryProperty
        ) ? { kind: "number" as const } : null;
        return field && type ? {
          field,
          fieldPath,
          valueType,
          property: geometryProperty,
          type,
          ...(collectionIndex !== undefined ? { collectionIndex } : {})
        } : null;
      } else {
        return null;
      }
    }
    return field ? {
      field,
      fieldPath,
      valueType,
      type: scalarTypeOfDslValueType(valueType),
      ...(collectionIndex !== undefined ? { collectionIndex } : {})
    } : null;
  };

  const recordFieldTargetFor = (
    record: Extract<RecordSourceLookup, { kind: "record" }>,
    reference: ModuleGeometryPropertyReferenceInput
  ): ModuleRecordFieldSourceTarget | null => {
    const member = recordMemberFor(record, reference.property);
    if (!member) return null;
    return {
      kind: "recordField",
      record: record.target,
      field: member.field.identity,
      fieldName: member.field.name,
      valueType: member.valueType,
      type: member.type,
      ...(member.fieldPath.length > 1 ? { fieldPath: member.fieldPath } : {}),
      ...(member.collectionIndex !== undefined ? { collectionIndex: member.collectionIndex } : {}),
      ...(member.property ? { property: member.property } : {})
    };
  };

  const statementIsExported = (statement: DslStatement | undefined): boolean =>
    Boolean(statement && (statement.kind === "typedDeclaration" || statement.kind === "element") && statement.exported);

  function qualifiedRecordExportFor(
    qualified: Extract<QualifiedModuleExportLookup, { kind: "deferred" }>
  ): { kind: "record"; exportedStatementId: StatementIdentity; exportedStatementIndex: number; typeIdentity: RecordTypeIdentity; definition: RecordDefinitionSemantic }
    | { kind: "other" }
    | null {
    const instance = instances.find((candidate) => candidate.statementId === qualified.instance.statementId);
    const externalDefinition = instance?.callee?.definition;
    if (externalDefinition) {
      const exported = externalDefinition.exports.find((candidate) => candidate.name === qualified.exportName);
      return exported?.kind === "record"
        ? {
            kind: "record",
            exportedStatementId: exported.exportedStatementId,
            exportedStatementIndex: exported.exportedStatementIndex,
            typeIdentity: exported.typeIdentity,
            definition: exported.definition
          }
        : exported ? { kind: "other" } : null;
    }
    const definition = instance?.callee && stateByIndex.get(instance.callee.definitionStatementIndex);
    const value = definition?.bodyStatementIndexes
      .map((statementIndex) => ({ statementIndex, statement: statements[statementIndex] }))
      .map(({ statementIndex, statement }) => ({ statementIndex, statement, value: recordAnalysis?.valuesByStatementIndex.get(statementIndex) }))
      .find(({ statement, value }) =>
        isDirectModuleChild(statement, definition!.statementIndex) &&
        value && statement.name === qualified.exportName && statementIsExported(statement)
      )?.value;
    if (!value?.typeIdentity) {
      const hasOtherExport = definition?.bodyStatementIndexes.some((statementIndex) => {
        const statement = statements[statementIndex];
        return isDirectModuleChild(statement, definition.statementIndex) && statement.name === qualified.exportName && statementIsExported(statement);
      });
      return hasOtherExport ? { kind: "other" } : null;
    }
    const recordDefinition = recordDefinitionFor(value.typeIdentity);
    const exportedStatement = statements[value.statementIndex];
    return recordDefinition && exportedStatement
      ? {
          kind: "record",
          exportedStatementId: value.statementId,
          exportedStatementIndex: value.statementIndex,
          typeIdentity: value.typeIdentity,
          definition: recordDefinition
        }
      : { kind: "other" };
  }

  const qualifiedDiagnostic = (
    statementIndex: number,
    span: DslSpan,
    qualified: Exclude<QualifiedModuleExportLookup, { kind: "deferred" }>,
    expected: ModuleGeometryInterfaceType | null
  ) => {
    const code = qualified.kind === "forward"
      ? "module-forward-instance-reference"
      : qualified.kind === "ambiguous"
        ? "module-ambiguous-instance-reference"
        : qualified.kind === "wrongKind"
          ? "module-geometry-type-mismatch"
          : qualified.kind === "outerCapture"
            ? "module-outer-capture"
            : "module-undefined-instance-reference";
    const message = qualified.kind === "forward"
      ? `module instance「${qualified.instanceName}」はこの位置より後で宣言されています。`
      : qualified.kind === "ambiguous"
        ? `module instance「${qualified.instanceName}」を一意に解決できません。`
        : qualified.kind === "wrongKind"
          ? `「${qualified.instanceName}」はmodule instanceではありません${expected ? `(期待: ${expected})` : ""}。`
          : qualified.kind === "outerCapture"
            ? `module body から outer module instance「${qualified.instanceName}」を暗黙 capture できません。`
            : `未定義のmodule instance「${qualified.instanceName}」を参照しています。`;
    addLocal(statementIndex, issue(code, qualified.memberSpan, message, {
      relatedSources: qualified.relatedSources,
      presentation: code === "module-geometry-type-mismatch"
        ? { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: qualified.instanceName } }
        : { key: `diagnostic.${code}`, parameters: { name: qualified.instanceName } }
    }));
  };

  const coordinateScalar = (
    statementIndex: number,
    ownerIndex: number | null,
    source: string,
    component: "x" | "y",
    span: DslSpan,
    options: {
      scalarResolver?: (reference: { name: string; span: DslSpan }, presenceFacts?: ReadonlySet<string>) => ModuleScalarReferenceResolution;
      bareScalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
      geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
      presenceFacts?: ReadonlySet<string>;
    }
  ): ModuleScalarExpressionSemantic | null => {
    const componentSpan = coordinateComponent(source, span, component);
    if (!componentSpan) return null;
    return analyzeExpression(
      statementIndex,
      ownerIndex,
      source.slice(componentSpan.start, componentSpan.end),
      componentSpan,
      { kind: "number" },
      options.scalarResolver ?? ((reference, presenceFacts) => resolveSourceScalar(statementIndex, ownerIndex, reference.name, ownerIndex, reference.span, presenceFacts)),
      options.bareScalarResolver,
      options.geometryPropertyResolver,
      undefined,
      undefined,
      options.presenceFacts
    );
  };

  let activeGeometryValueBinder: Extract<ModuleGeometrySourceTarget, { kind: "geometryValueForBinder" }> | null = null;
  let activeRecordValueBinder: Extract<ModuleRecordSourceTarget, { kind: "recordValueForBinder" }> | null = null;

  const resolveGeometry = (
    statementIndex: number,
    ownerIndex: number | null,
    rawValue: string,
    span: DslSpan,
    expected: "point" | "line",
    options: {
      expectedInterfaceType?: ModuleGeometryInterfaceType;
      allowCoordinate?: boolean;
      allowNone?: boolean;
      role?: ModuleGeometryReferenceRole;
      scalarResolver?: (reference: { name: string; span: DslSpan }, presenceFacts?: ReadonlySet<string>) => ModuleScalarReferenceResolution;
      bareScalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
      geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
      presenceFacts?: ReadonlySet<string>;
      typeMismatchRelatedSources?: readonly DiagnosticRelatedSource[];
      expectedValueType?: DslValueType;
      requireOptional?: boolean;
    } = {}
  ): ModuleGeometryReferenceSemantic => {
    const trimmed = rawValue.trim();
    const logicalSource = input.logicalTextByStatementIndex?.get(statementIndex);
    const trimmedStart = logicalSource
      ? logicalSource.indexOf(trimmed, Math.max(0, span.start))
      : -1;
    const semanticSpan = trimmedStart >= 0
      ? { start: trimmedStart, end: trimmedStart + trimmed.length }
      : span;
    const expectedDiagnosticType = options.expectedInterfaceType ?? expected;
    const role = options.role ?? (expected === "point" ? "pointReference" : "lineReference");
    const expectedRelatedSources = options.typeMismatchRelatedSources ?? [];
    let referenceNameSpan: DslSpan | null = null;
    const semantic = (
      target: ModuleGeometrySourceTarget | null,
      resolution: ModuleGeometryReferenceSemantic["resolution"],
      coordinate: ModuleGeometryReferenceSemantic["coordinate"] = null,
      referenceRole: ModuleGeometryReferenceRole = role,
      valueType?: DslValueType
    ) => geometryReference(rawValue, semanticSpan, expected, target, resolution, coordinate, referenceRole, referenceNameSpan, valueType);
    if (!trimmed) return semantic(null, "undefined");
    if (trimmed === "none") {
      if (options.allowNone) return semantic(null, "resolved");
      addLocal(statementIndex, issue("module-geometry-none", semanticSpan, `geometry ${expectedDiagnosticType} reference に none は指定できません。`, { presentation: { key: "diagnostic.module-geometry-none", parameters: { expected: expectedDiagnosticType } } }));
      return semantic(null, "invalid");
    }
    if (activeGeometryValueBinder) {
      const binderPath = parseDslSourceReference(trimmed);
      const parsedBinderPath = binderPath.kind === "valid" && !binderPath.reference.property
        ? parseDslReferenceToken(binderPath.reference.pathText)
        : null;
      const expectedBinderType = options.expectedInterfaceType ?? expected;
      if (parsedBinderPath && !parsedBinderPath.absolute && parsedBinderPath.segments.length === 1 && parsedBinderPath.segments[0] === activeGeometryValueBinder.name) {
        referenceNameSpan = semanticSpan;
        if (!isModuleGeometryInterfaceAssignable(activeGeometryValueBinder.sourceElementType, expectedBinderType)) {
          addLocal(statementIndex, issue("module-geometry-type-mismatch", semanticSpan, `geometry value-for binder「${activeGeometryValueBinder.name}」の型が一致しません。`, {
            presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: activeGeometryValueBinder.name } }
          }));
          return semantic(null, "invalid");
        }
        return semantic(activeGeometryValueBinder, "resolved");
      }
    }
    const parsedScalar = logicalSource
      ? parseScalarExpression(logicalSource, semanticSpan)
      : parseScalarExpression(trimmed, { start: 0, end: trimmed.length });
    if (parsedScalar.ast?.kind === "collectionIndex") {
      const node = parsedScalar.ast;
      const base = node.name;
      const baseSpan = logicalSource
        ? node.nameSpan
        : { start: semanticSpan.start + node.nameSpan.start, end: semanticSpan.start + node.nameSpan.end };
      referenceNameSpan = baseSpan;
      const collectionAnalysis = sourceNamespace.geometryArraySemanticAnalysis;
      const path = parseDslReferenceToken(base);
      const qualified = path.segments.length > 1
        ? resolveQualifiedModuleExport(statementIndex, ownerIndex, base, baseSpan)
        : null;
      const deferredQualified = qualified?.kind === "deferred" ? qualified : null;
      const collection = deferredQualified
        ? qualifiedCollectionExportFor(deferredQualified)
        : null;
      const parameter = path.segments.length === 1 && !path.absolute
        ? moduleParameterByName(statements, stableStatementIdByIndex, statementIndex, path.segments[0]!)
        : null;
      const value = !qualified && !parameter && collectionAnalysis
        ? (() => {
            const lookup = ownerIndex === null
              ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, path) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, base)
              : resolveModuleLexicalPath(statementIndex, ownerIndex, path);
            if (lookup.kind !== "resolved" || lookup.declaration.kind !== "typedDeclaration") return null;
            const resolved = collectionValueSemanticForStatement(collectionAnalysis, lookup.declaration.statementIndex);
            const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
            if (ownerIndex !== null && declarationOwner !== ownerIndex) {
              addLocal(statementIndex, issue("module-outer-capture", baseSpan, `module body から outer collection「${base}」を暗黙 capture できません。`, { relatedSources: relatedForDeclaration(lookup.declaration), presentation: { key: "diagnostic.module-outer-capture", parameters: { name: base } } }));
              return null;
            }
            return resolved;
          })()
        : null;
      const valueType = collection?.kind === "collection"
        ? collection.valueType
        : parameter
          ? collectionAnalysis?.genericModuleParametersBySlot.get(`${parameter.definitionStatementId}:${parameter.parameterIndex}`)?.valueType ?? null
          : collectionAnalysis ? collectionValueTypeFor(value) : null;
      const elementType = valueType && isDslArrayValueType(valueType)
        ? valueType.elementType.kind === "point" || valueType.elementType.kind === "line" || valueType.elementType.kind === "path"
          ? valueType.elementType.kind
          : null
        : null;
      const expectedInterfaceType = options.expectedInterfaceType ?? (expected === "point" ? "point" : "path");
      const generatedLookup = ownerIndex === null
        ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, path) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, base)
        : resolveModuleLexicalPath(statementIndex, ownerIndex, path);
      const compatible = elementType !== null && (expected === "point"
        ? elementType === "point"
        : isModuleGeometryInterfaceAssignable(elementType, expectedInterfaceType));
      const indexSource = logicalSource ?? trimmed;
      const indexSpan = node.index.span;
      const indexSemantic = analyzeExpression(
        statementIndex,
        ownerIndex,
        indexSource.slice(indexSpan.start, indexSpan.end),
        indexSpan,
        { kind: "number" },
        options.scalarResolver ?? ((reference, facts) => resolveSourceScalar(statementIndex, ownerIndex, reference.name, ownerIndex, reference.span, facts)),
        options.bareScalarResolver,
        options.geometryPropertyResolver,
        undefined,
        undefined,
        options.presenceFacts
      );
      if (!indexSemantic || indexSemantic.type?.kind !== "number") return semantic(null, "invalid");
      if (generatedLookup.kind === "resolved" && generatedLookup.declaration.kind === "geometry" &&
          isMaterializedForGroupTemplate(statements, generatedLookup.declaration.statementIndex)) {
        const declarationOwner = moduleOwnerIndexOf(statements, generatedLookup.declaration.statementIndex);
        const declarationRelated = relatedForDeclaration(generatedLookup.declaration);
        if (ownerIndex !== null && declarationOwner !== ownerIndex) {
          addLocal(statementIndex, issue("module-outer-capture", baseSpan, `module body から outer geometry「${base}」を暗黙 capture できません。`, {
            relatedSources: declarationRelated,
            presentation: { key: "diagnostic.module-outer-capture", parameters: { name: base } }
          }));
          return semantic(null, "outerCapture");
        }
        const sourceTarget = declarationGeometryTarget(generatedLookup.declaration, stableStatementIdByIndex);
        const actualInterfaceType = moduleGeometryInterfaceTypeOfElement(generatedLookup.declaration.statement);
        if (!sourceTarget || !actualInterfaceType || !isModuleGeometryInterfaceAssignable(actualInterfaceType, expectedInterfaceType)) {
          addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `geometry reference「${base}」の型が一致しません(期待: ${expectedDiagnosticType})。`, {
            relatedSources: expectedRelatedSources.length ? expectedRelatedSources : declarationRelated,
            presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: base } }
          }));
          return semantic(null, "invalid");
        }
        const target: Extract<ModuleGeometrySourceTarget, { kind: "forGroupOccurrence" }> = {
          kind: "forGroupOccurrence",
          statementId: sourceTarget.statementId,
          statementIndex: sourceTarget.statementIndex,
          category: sourceTarget.category,
          geometryKind: sourceTarget.geometryKind,
          expectedGeometryKind: expected,
          expectedInterfaceType,
          index: indexSemantic,
          source: logicalSource?.slice(semanticSpan.start, semanticSpan.end) ?? trimmed,
          referenceSpan: semanticSpan,
          nameSpan: baseSpan,
          occurrenceIndexSpan: logicalSource
            ? node.index.span
            : { start: semanticSpan.start + node.index.span.start, end: semanticSpan.start + node.index.span.end },
          occurrenceRange: { start: baseSpan.end, end: semanticSpan.end },
          ...(input.documentId ? { identity: qualifySemanticIdentity(input.documentId, sourceTarget.statementId) } : {})
        };
        return semantic(target, "resolved", null, expected === "point" ? "pointReference" : role);
      }
      if (parameter && parameter.parameter.optional && !options.presenceFacts?.has(moduleParameterPresenceKey(parameter.definitionStatementId, parameter.parameterIndex))) {
        addLocal(statementIndex, issue("module-optional-value-required", baseSpan, `optional module parameter「${base}」は hasValue(@${base}) で存在を確認してから参照してください。`, { relatedSources: relatedForParameter(definitionStates.find((candidate) => candidate.statementId === parameter.definitionStatementId)!, parameter.parameterIndex), presentation: { key: "diagnostic.module-optional-value-required", parameters: { name: base } } }));
        return semantic(null, "invalid");
      }
      if (!compatible || !valueType || !collectionAnalysis) {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `collection「${base}」の element 型が geometry reference の期待型と一致しません。`, { presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: base } } }));
        return semantic(null, "invalid");
      }
      const collectionValueId = collection?.kind === "collection"
        ? geometryArrayDeferredModuleExportId(deferredQualified!.instance.statementId, deferredQualified!.exportName)
        : parameter
          ? `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`
          : value!.statementId;
      const target: Extract<ModuleGeometrySourceTarget, { kind: "collectionIndex" }> = {
        kind: "collectionIndex",
        collectionValueId,
        collectionLength: parameter || collection ? null : collectionLengthForValueId(collectionAnalysis, value!.statementId),
        targetSourceOrder: parameter ? -1 : collection ? deferredQualified!.instance.statementIndex : value!.statementIndex,
        elementInterfaceType: elementType,
        expectedGeometryKind: expected,
        expectedInterfaceType,
        index: indexSemantic,
        source: `@${base}`,
        referenceSpan: semanticSpan,
        nameSpan: baseSpan
      };
      return semantic(target, "resolved", null, expected === "point" ? "pointReference" : role);
    }
    if (trimmed.startsWith("(") || trimmed.startsWith("[")) {
      const coordinate = trimmed.startsWith("(") && trimmed.endsWith(")");
      if (coordinate && expected === "point" && (options.allowCoordinate ?? true)) {
        const coordinateSource = logicalSource ?? rawValue;
        return semantic(null, "resolved", {
          kind: "coordinate",
          x: coordinateScalar(statementIndex, ownerIndex, coordinateSource, "x", semanticSpan, options),
          y: coordinateScalar(statementIndex, ownerIndex, coordinateSource, "y", semanticSpan, options)
        }, "coordinatePoint");
      }
      addLocal(statementIndex, issue(
        "module-geometry-type-mismatch",
        semanticSpan,
        coordinate && expected === "point" && options.allowCoordinate === false
          ? "このgeometry reference parameterではcoordinate形式を指定できません。"
          : `geometry reference の形式が一致しません(期待: ${expectedDiagnosticType})。`,
        {
          relatedSources: expectedRelatedSources,
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: rawValue.trim() || expectedDiagnosticType } }
        }
      ));
      return semantic(null, "invalid");
    }
    const parsedReference = parseDslSourceReference(trimmed);
    if (parsedReference.kind !== "valid") {
      const relativeSpan = parsedReference.range;
      const invalidSpan = {
        start: semanticSpan.start + relativeSpan.start,
        end: semanticSpan.start + Math.max(relativeSpan.end, relativeSpan.start + 1)
      };
      addLocal(statementIndex, issue("invalid-source-reference", invalidSpan, parsedReference.message, {
        presentation: { key: "diagnostic.invalid-source-reference", parameters: { reference: trimmed } }
      }));
      return semantic(null, "invalid");
    }
    const reference = parsedReference.reference;
    const base = reference.pathText;
    const pointKey = reference.property;
    const baseSpan = {
      start: semanticSpan.start + reference.pathRange.start,
      end: semanticSpan.start + reference.pathRange.end
    };
    referenceNameSpan = baseSpan;
    const record = recordSourceLookup(statementIndex, ownerIndex, base, baseSpan);
    if (record.kind === "record") {
      const member = recordMemberFor(record, reference.property ?? "");
      const memberRequiredValueType = member ? dslRequiredValueTypeOf(member.valueType) : null;
      if (member && memberRequiredValueType && isDslGeometryValueType(memberRequiredValueType)) {
        const pointKey = member.property;
        const expectedInterfaceType = options.expectedInterfaceType ?? (expected === "point" ? "point" : "path");
        const compatible = isModuleGeometryInterfaceAssignable(memberRequiredValueType.kind, expectedInterfaceType) &&
          (!pointKey || (expected === "point" && isKnownDerivedPointKey(pointKey)));
        if (!compatible) {
          addLocal(statementIndex, issue(
            "module-geometry-type-mismatch",
            reference.propertyRange ? { start: semanticSpan.start + reference.propertyRange.start, end: semanticSpan.start + reference.propertyRange.end } : baseSpan,
            `record field「${base}.${reference.property ?? ""}」の geometry 型が一致しません。`,
            { presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: base } } }
          ));
          return semantic(null, "invalid", null, role);
        }
        const target: Extract<ModuleGeometrySourceTarget, { kind: "recordFieldValue" }> = {
          kind: "recordFieldValue",
          record: record.target,
          field: member.field.identity,
          fieldName: member.field.name,
          valueType: member.valueType,
          ...(member.fieldPath.length > 1 ? { fieldPath: member.fieldPath } : {}),
          ...(member.collectionIndex !== undefined ? { collectionIndex: member.collectionIndex } : {}),
          ...(pointKey ? { pointKey } : {})
        };
        return semantic(target, "resolved", null, pointKey ? "derivedPoint" : role, member.valueType);
      }
      addLocal(statementIndex, issue(
        "module-record-value-in-geometry",
        baseSpan,
        `record member「${base}.${reference.property ?? ""}」は geometry ではありません。`,
        { presentation: { key: "diagnostic.module-record-value-in-geometry", parameters: { name: reference.property ?? base } } }
      ));
      return semantic(null, "invalid", null, role);
    }
    if (record.kind === "blocked") {
      if (record.diagnostic) addLocal(statementIndex, { ...record.diagnostic, span: baseSpan });
      return semantic(null, record.resolution === "ambiguous" ? "invalid" : record.resolution, null, role);
    }
    const derivedRole: ModuleGeometryReferenceRole = pointKey
      ? role === "lineEndpointReference" ? "lineEndpointReference" : "derivedPoint"
      : role;
    const rejectAccessor = (message: string) => {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, message, {
        presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: base } }
      }));
      return semantic(null, "invalid", null, derivedRole);
    };
    if (pointKey && !isKnownDerivedPointKey(pointKey)) return rejectAccessor(`geometry reference「${pointKey}」は既知のpoint anchorではありません。`);
    if (pointKey && (role === "lineReference" || role === "lineReferenceList")) return rejectAccessor("plain line referenceにはderived point accessorを指定できません。");
    if (pointKey && role === "lineEndpointReference" && !isLineEndpointPointKey(pointKey)) return rejectAccessor("line endpoint referenceにはstartまたはendを指定してください。");
    const qualified = resolveQualifiedModuleExport(statementIndex, ownerIndex, base, semanticSpan, reference.pathRange.start);
    if (qualified?.kind === "deferred") {
      return semantic(
        deferredModuleExportTarget(
          qualified,
          expected,
          options.expectedInterfaceType ?? (expected === "point" ? "point" : "path"),
          semanticSpan,
          pointKey
        ),
        "deferred",
        null,
        derivedRole
      );
    }
    if (qualified) {
      qualifiedDiagnostic(statementIndex, semanticSpan, qualified, expectedDiagnosticType);
      return semantic(null, qualified.kind === "forward" ? "forward" : qualified.kind === "undefined" ? "undefined" : qualified.kind === "outerCapture" ? "outerCapture" : "invalid", null, derivedRole);
    }
    const path = parseDslReferenceToken(base);
    const lookup = ownerIndex === null
      ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, path) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, base)
      : resolveModuleLexicalPath(statementIndex, ownerIndex, path);
    if (lookup.kind === "parameter") {
      const parameterTarget = geometryParameterTarget(lookup.definition, lookup.parameter);
      const pointTarget = pointKey
        ? parameterTarget && expected === "point" && parameterTarget.geometryKind === "line" && isLineEndpointPointKey(pointKey)
          ? { ...parameterTarget, pointKey }
          : null
        : parameterTarget;
      const actualInterfaceType = moduleGeometryInterfaceTypeOf(lookup.parameter.parameter.type);
      const compatible = pointKey
        ? Boolean(pointTarget && role !== "lineReference" && role !== "lineReferenceList")
        : options.expectedInterfaceType
          ? isModuleGeometryInterfaceAssignable(actualInterfaceType, options.expectedInterfaceType)
          : parameterTarget?.geometryKind === expected;
      if (!parameterTarget || !compatible) {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `geometry reference「${base}」の型が一致しません(期待: ${expectedDiagnosticType})。`, {
          relatedSources: expectedRelatedSources.length ? expectedRelatedSources : relatedForParameter(lookup.definition, lookup.parameter.index, true),
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: base } }
        }));
        return semantic(null, "invalid", null, derivedRole);
      }
      if (lookup.parameter.parameter.optional && !options.presenceFacts?.has(moduleParameterPresenceKey(parameterTarget.definitionStatementId, parameterTarget.parameterIndex))) {
        addLocal(statementIndex, issue("module-optional-value-required", baseSpan, `optional module parameter「${base}」は hasValue(@${base}) で存在を確認してから参照してください。`, { relatedSources: relatedForParameter(lookup.definition, lookup.parameter.index), presentation: { key: "diagnostic.module-optional-value-required", parameters: { name: base } } }));
        return semantic(null, "invalid", null, derivedRole);
      }
      return semantic(pointTarget, "resolved", null, derivedRole);
    }
    if (lookup.kind === "undefined") {
      addLocal(statementIndex, issue("module-undefined-geometry-reference", baseSpan, `未定義のgeometry「${base}」を参照しています。`, { presentation: { key: "diagnostic.module-undefined-geometry-reference", parameters: { name: base } } }));
      return semantic(null, "undefined", null, derivedRole);
    }
    if (lookup.kind === "iteration") {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `「${base}」はgeometryではありません。`, {
        relatedSources: expectedRelatedSources.length ? expectedRelatedSources : relatedForLookup(lookup),
        presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: base } }
      }));
      return semantic(null, "invalid", null, derivedRole);
    }
    if (lookup.kind === "forward") {
      addLocal(statementIndex, issue("module-forward-geometry-reference", baseSpan, `geometry「${base}」はこの位置より後で宣言されています。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-forward-geometry-reference", parameters: { name: base } } }));
      return semantic(null, "forward", null, derivedRole);
    }
    if (lookup.kind === "ambiguous") {
      addLocal(statementIndex, issue("module-ambiguous-geometry-reference", baseSpan, `geometry「${base}」を一意に解決できません。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-ambiguous-geometry-reference", parameters: { name: base } } }));
      return semantic(null, "invalid", null, derivedRole);
    }
    if (lookup.kind === "invalidOverlayTraversal") {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `「${lookup.name}」はparameter/iteration namespaceではありません。`, {
        relatedSources: expectedRelatedSources,
        presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: lookup.name } }
      }));
      return semantic(null, "invalid", null, derivedRole);
    }
    if (lookup.kind === "invalidTraversal") {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `「${lookup.declaration.name}」はnamespace/containerではありません。`, {
        relatedSources: expectedRelatedSources.length ? expectedRelatedSources : relatedForLookup(lookup),
        presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: lookup.declaration.name } }
      }));
      return semantic(null, "invalid", null, derivedRole);
    }
    if (
      lookup.declaration.kind === "typedDeclaration" &&
      lookup.declaration.statement.kind === "typedDeclaration" &&
      isDslGeometryValueType(dslRequiredValueTypeOf(lookup.declaration.statement.valueType))
    ) {
      const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
      const declarationRelated = relatedForDeclaration(lookup.declaration);
      if (ownerIndex !== null && declarationOwner !== ownerIndex) {
        addLocal(statementIndex, issue("module-outer-capture", baseSpan, `module body から outer geometry「${base}」を暗黙 capture できません。`, { relatedSources: declarationRelated, presentation: { key: "diagnostic.module-outer-capture", parameters: { name: base } } }));
        return semantic(null, "outerCapture", null, derivedRole);
      }
      const value = geometryValuesByStatementIndex.get(lookup.declaration.statementIndex);
      const actualValueType = value?.declaredValueType ?? lookup.declaration.statement.valueType;
      const actualRequiredValueType = dslRequiredValueTypeOf(actualValueType);
      const actualInterfaceType = actualRequiredValueType && isDslGeometryValueType(actualRequiredValueType)
        ? actualRequiredValueType.kind
        : value?.declaredInterfaceType ?? expected;
      const target = value
        ? {
            kind: "geometryValue" as const,
            statementId: statementIdAt(stableStatementIdByIndex, lookup.declaration.statementIndex),
            statementIndex: lookup.declaration.statementIndex,
            declaredInterfaceType: actualInterfaceType,
            backingTarget: value.backingTarget,
            ownerModuleDefinitionStatementId: value.ownerModuleDefinitionStatementId,
            ownerModuleDefinitionStatementIndex: value.ownerModuleDefinitionStatementIndex,
            ...(pointKey ? { pointKey } : {})
          }
        : null;
      const expectedValueType = options.expectedValueType ?? { kind: options.expectedInterfaceType ?? (expected === "point" ? "point" : "path") } satisfies DslValueType;
      const compatible = pointKey
        ? Boolean(target && actualInterfaceType !== "point" && isLineEndpointPointKey(pointKey))
        : Boolean(actualValueType && actualRequiredValueType && isDslValueTypeAssignable(actualValueType, expectedValueType));
      const optionalRequirementSatisfied = !options.requireOptional || isDslOptionalValueType(actualValueType);
      if (!target || !compatible || !optionalRequirementSatisfied) {
        const code = options.requireOptional && !optionalRequirementSatisfied ? "coalesce-left-not-optional" : "module-geometry-type-mismatch";
        addLocal(statementIndex, issue(
          code,
          baseSpan,
          code === "coalesce-left-not-optional"
            ? "?? の左辺は optional geometry 値である必要があります。"
            : `geometry reference「${base}」の型が一致しません(期待: ${expectedDiagnosticType})。`,
          {
          relatedSources: expectedRelatedSources.length ? expectedRelatedSources : declarationRelated,
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: base } }
          }
        ));
        return semantic(null, "invalid", null, derivedRole);
      }
      return actualValueType ? semantic(target, "resolved", null, derivedRole, actualValueType) : semantic(target, "resolved", null, derivedRole);
    }
    const target = declarationGeometryTarget(lookup.declaration, stableStatementIdByIndex);
    const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
    const declarationRelated = relatedForDeclaration(lookup.declaration);
    if (lookup.kind === "resolved" && lookup.declaration.kind === "geometry" &&
        isMaterializedForGroupTemplate(statements, lookup.declaration.statementIndex)) {
      if (ownerIndex !== null && declarationOwner !== ownerIndex) {
        addLocal(statementIndex, issue("module-outer-capture", baseSpan, `module body から outer geometry「${base}」を暗黙 capture できません。`, {
          relatedSources: declarationRelated,
          presentation: { key: "diagnostic.module-outer-capture", parameters: { name: base } }
        }));
        return semantic(null, "outerCapture", null, derivedRole);
      }
      const sourceTarget = target;
      const actualInterfaceType = moduleGeometryInterfaceTypeOfElement(lookup.declaration.statement);
      const pointTarget = pointKey && expected === "point" && sourceTarget && isDerivedPointKeyForGeometryCategory(sourceTarget.category, pointKey)
        ? pointKey
        : pointKey ? null : undefined;
      const compatible = pointKey
        ? pointTarget !== null
        : Boolean(actualInterfaceType && isModuleGeometryInterfaceAssignable(actualInterfaceType, options.expectedInterfaceType ?? (expected === "point" ? "point" : "path")));
      const indexSpan = reference.occurrenceIndexRange
        ? { start: semanticSpan.start + reference.occurrenceIndexRange.start, end: semanticSpan.start + reference.occurrenceIndexRange.end }
        : null;
      const indexSemantic = reference.occurrenceIndex && indexSpan
        ? analyzeExpression(
            statementIndex,
            ownerIndex,
            reference.occurrenceIndex,
            indexSpan,
            { kind: "number" },
            options.scalarResolver ?? ((candidate, facts) => resolveSourceScalar(statementIndex, ownerIndex, candidate.name, ownerIndex, candidate.span, facts)),
            options.bareScalarResolver,
            options.geometryPropertyResolver,
            undefined,
            undefined,
            options.presenceFacts
          )
        : null;
      if (!sourceTarget || !compatible || (reference.occurrenceIndex && (!indexSemantic || indexSemantic.type?.kind !== "number"))) {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `geometry reference「${base}」の型が一致しません(期待: ${expectedDiagnosticType})。`, {
          relatedSources: expectedRelatedSources.length ? expectedRelatedSources : declarationRelated,
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: base } }
        }));
        return semantic(null, "invalid", null, derivedRole);
      }
      const occurrenceTarget: Extract<ModuleGeometrySourceTarget, { kind: "forGroupOccurrence" }> = {
        kind: "forGroupOccurrence",
        statementId: sourceTarget.statementId,
        statementIndex: sourceTarget.statementIndex,
        category: sourceTarget.category,
        geometryKind: sourceTarget.geometryKind,
        expectedGeometryKind: expected,
        expectedInterfaceType: options.expectedInterfaceType ?? (expected === "point" ? "point" : "path"),
        index: indexSemantic,
        source: logicalSource?.slice(semanticSpan.start, semanticSpan.end) ?? trimmed,
        referenceSpan: semanticSpan,
        nameSpan: baseSpan,
        ...(indexSpan ? { occurrenceIndexSpan: indexSpan } : {}),
        ...(reference.occurrenceRange ? {
          occurrenceRange: {
            start: semanticSpan.start + reference.occurrenceRange.start,
            end: semanticSpan.start + reference.occurrenceRange.end
          }
        } : {}),
        ...(pointKey ? { pointKey } : {}),
        ...(input.documentId ? { identity: qualifySemanticIdentity(input.documentId, sourceTarget.statementId) } : {})
      };
      return semantic(occurrenceTarget, "resolved", null, derivedRole);
    }
    if (!target) {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `「${base}」はgeometryではありません。`, {
        relatedSources: expectedRelatedSources.length ? expectedRelatedSources : declarationRelated,
        presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: base } }
      }));
      return semantic(null, "invalid", null, derivedRole);
    }
    if (ownerIndex !== null && declarationOwner !== ownerIndex) {
      addLocal(statementIndex, issue("module-outer-capture", baseSpan, `module body から outer geometry「${base}」を暗黙 capture できません。`, { relatedSources: declarationRelated, presentation: { key: "diagnostic.module-outer-capture", parameters: { name: base } } }));
      return semantic(null, "outerCapture", null, derivedRole);
    }
    const pointTarget = pointKey && expected === "point" && isDerivedPointKeyForGeometryCategory(target.category, pointKey)
      ? { ...target, pointKey }
      : pointKey ? null : target;
    const actualInterfaceType = moduleGeometryInterfaceTypeOfElement(lookup.declaration.statement);
    const compatible = pointKey
      ? Boolean(pointTarget)
      : options.expectedInterfaceType
        ? isModuleGeometryInterfaceAssignable(actualInterfaceType, options.expectedInterfaceType)
        : target.geometryKind === expected;
    if (!compatible) {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `geometry reference「${base}」の型が一致しません(期待: ${expectedDiagnosticType})。`, {
        relatedSources: expectedRelatedSources.length ? expectedRelatedSources : declarationRelated,
        presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: base } }
      }));
      return semantic(null, "invalid", null, derivedRole);
    }
    return semantic(pointTarget, "resolved", null, derivedRole);
  };

  const parseGeometryValueConstruction = (
    statementIndex: number,
    ownerIndex: number | null,
    rawValue: string,
    initializerSpan: DslSpan,
    expectedInterfaceType: ModuleGeometryInterfaceType,
    options: {
      scalarResolver?: (reference: { name: string; span: DslSpan }, presenceFacts?: ReadonlySet<string>) => ModuleScalarReferenceResolution;
      bareScalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
      geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
      presenceFacts?: ReadonlySet<string>;
    } = {}
  ): ModuleGeometryConstructionSemantic | null => {
    const constructionName = rawValue.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? "";
    const selectedSpec = constructionSpecsFor(constructionName).find((candidate) =>
      isModuleGeometryInterfaceAssignable(
        moduleGeometryInterfaceTypeOfConstruction(candidate.category, candidate),
        expectedInterfaceType
      )
    );
    const parsed = parseDslConstructionInvocation(rawValue, {
      spanOffset: initializerSpan.start,
      ...(selectedSpec ? { spec: selectedSpec } : {})
    });
    for (const diagnostic of parsed.diagnostics) {
      addLocal(statementIndex, issue(
        diagnostic.code ?? "invalid-construction-call",
        diagnostic.span,
        diagnostic.message,
        diagnostic.presentation ? { presentation: diagnostic.presentation } : {}
      ));
    }
    const invocation = parsed.invocation;
    if (!invocation || invocation.categories.length === 0) return null;
    const constructionSpan = invocation.constructionSpan;
    const selectedArgumentNames = new Set((selectedSpec?.args ?? []).map((argument) => argument.arg));
    const drawableMetadataNames = new Set(commonArgSpecs.map((argument) => argument.arg));
    for (const argument of invocation.args) {
      if (argument.key !== null && drawableMetadataNames.has(argument.key) && !selectedArgumentNames.has(argument.key)) {
        addLocal(statementIndex, issue(
          "geometry-value-drawable-metadata",
          argument.keySpan ?? argument.valueSpan,
          `geometry value construction「${invocation.construction}」には drawable metadata または未対応の引数を指定できません。`,
          { presentation: { key: "diagnostic.geometry-value-drawable-metadata", parameters: { construction: invocation.construction } } }
        ));
      }
    }
    if (!invocation.pureValueInterface) {
      addLocal(statementIndex, issue(
        "geometry-value-unsupported-construction",
        constructionSpan,
        `construction「${invocation.construction}」の pure geometry value runtime はこのSliceでは未対応です。`,
        { presentation: { key: "diagnostic.geometry-value-unsupported-construction", parameters: { construction: invocation.construction } } }
      ));
      return null;
    }
    const source = input.logicalTextByStatementIndex?.get(statementIndex) ?? rawValue;
    const argument = (name: string) => invocation.args.find((candidate) => candidate.key === name);
    const xArgument = argument("x");
    const yArgument = argument("y");
    const fromArgument = argument("from");
    const sourceArgument = argument("source");
    const line1Argument = argument("line1");
    const line2Argument = argument("line2");
    const firstArgument = argument("first");
    const secondArgument = argument("second");
    const kindArgument = argument("kind");
    const lineArgument = argument("line");
    const baseArgument = argument("base");
    const distanceArgument = argument("distance");
    const ratioArgument = argument("ratio");
    const sourcesArgument = argument("sources");
    const pathsArgument = argument("paths");
    const centerArgument = argument("center");
    const point1Argument = argument("point1");
    const point2Argument = argument("point2");
    const point3Argument = argument("point3");
    const radiusArgument = argument("radius");
    const startArgument = argument("start");
    const endArgument = argument("end");
    const angleArgument = argument("angle");
    const curveSideArgument = argument("curveSide");
    const lengthArgument = argument("length");
    const startAngleArgument = argument("startAngle");
    const startLengthArgument = argument("startLength");
    const endAngleArgument = argument("endAngle");
    const endLengthArgument = argument("endLength");
    const directionArgument = argument("direction");
    const intermediatesArgument = argument("intermediates");
    const pointsArgument = argument("points");
    const closedArgument = argument("closed");
    const sideArgument = argument("side");
    const suppressTrimWarningsArgument = argument("suppressTrimWarnings");
    const scalarForSpan = (
      valueSpan: DslSpan | null | undefined,
      expectedType: ScalarType | null,
      defaultValue: string
    ) => valueSpan
      ? analyzeExpression(
          statementIndex,
          ownerIndex,
          source.slice(valueSpan.start, valueSpan.end),
          valueSpan,
          expectedType,
          options.scalarResolver ?? ((reference, presenceFacts) => resolveSourceScalar(statementIndex, ownerIndex, reference.name, ownerIndex, reference.span, presenceFacts)),
          options.bareScalarResolver,
          options.geometryPropertyResolver,
          undefined,
          undefined,
          options.presenceFacts
        )
      : analyzeExpression(
          statementIndex,
          ownerIndex,
          defaultValue,
          { start: constructionSpan.end, end: constructionSpan.end + defaultValue.length },
          expectedType,
          options.scalarResolver ?? ((reference, presenceFacts) => resolveSourceScalar(statementIndex, ownerIndex, reference.name, ownerIndex, reference.span, presenceFacts)),
          options.bareScalarResolver,
          options.geometryPropertyResolver,
          undefined,
          undefined,
          options.presenceFacts
        );
    const scalar = (
      candidate: typeof xArgument,
      expectedType: ScalarType | null,
      defaultValue: string
    ) => scalarForSpan(candidate?.valueSpan, expectedType, defaultValue);
    const placement = () => {
      const hasDistance = Boolean(distanceArgument);
      const hasRatio = Boolean(ratioArgument);
      if (!hasDistance && !hasRatio) {
        addLocal(statementIndex, issue(
          "geometry-value-placement-required",
          constructionSpan,
          `construction「${invocation.construction}」にはdistanceまたはratioのいずれか一方が必要です。`,
          { presentation: { key: "diagnostic.geometry-value-placement-required", parameters: { construction: invocation.construction } } }
        ));
        return null;
      }
      if (hasDistance === hasRatio) return null;
      const selected = hasDistance ? distanceArgument : ratioArgument;
      const value = selected ? scalarForSpan(selected.valueSpan, { kind: "number" }, "0") : null;
      return value ? { kind: hasDistance ? "distance" as const : "ratio" as const, value } : null;
    };
    const pointReference = (candidate: typeof xArgument): ModuleGeometryReferenceSemantic => candidate
      ? resolveGeometry(
          statementIndex,
          ownerIndex,
          source.slice(candidate.valueSpan.start, candidate.valueSpan.end),
          candidate.valueSpan,
          "point",
          {
            expectedInterfaceType: "point",
            allowCoordinate: true,
            role: "pointReference",
            scalarResolver: options.scalarResolver,
            bareScalarResolver: options.bareScalarResolver,
            geometryPropertyResolver: options.geometryPropertyResolver,
            presenceFacts: options.presenceFacts
          }
        )
      : geometryReference("", constructionSpan, "point", null, "invalid", null, "pointReference");
    const pathReferences = (candidate: typeof xArgument): ModuleGeometryReferenceSemantic[] => {
      if (!candidate) return [geometryReference("", constructionSpan, "line", null, "invalid", null, "lineReference")];
      const sourcesSpan = candidate.valueSpan;
      const parsedSources = parseGeometryArrayExpression(source.slice(sourcesSpan.start, sourcesSpan.end));
      for (const diagnostic of parsedSources.diagnostics) {
        addLocal(statementIndex, issue(
          diagnostic.code,
          { start: sourcesSpan.start + diagnostic.span.start, end: sourcesSpan.start + diagnostic.span.end },
          diagnostic.message,
          { presentation: { key: `diagnostic.${diagnostic.code}` } }
        ));
      }
      if (parsedSources.expression?.kind === "literal" && parsedSources.diagnostics.length === 0) {
        return parsedSources.expression.members.map((member) => {
          const memberSpan = {
            start: sourcesSpan.start + member.span.start,
            end: sourcesSpan.start + member.span.end
          };
          return resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(memberSpan.start, memberSpan.end),
            memberSpan,
            "line",
            {
              expectedInterfaceType: "path",
              allowCoordinate: false,
              role: "lineReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          );
        });
      }
      if (parsedSources.expression?.kind === "reference" && parsedSources.diagnostics.length === 0) {
        addLocal(statementIndex, issue(
          "geometry-value-array-reference-unsupported",
          sourcesSpan,
          "pure geometry value construction の baseLines には geometry reference の配列リテラルを指定してください。",
          { presentation: { key: "diagnostic.geometry-value-array-reference-unsupported" } }
        ));
      }
      return [];
    };
    if (invocation.construction === "offset" && invocation.pureValueInterface === "point") {
      if (expectedInterfaceType !== "point") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "offset point construction は point value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "offset" } }
        }));
      }
      const from = fromArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(fromArgument.valueSpan.start, fromArgument.valueSpan.end),
            fromArgument.valueSpan,
            "point",
            {
              expectedInterfaceType: "point",
              allowCoordinate: true,
              role: "pointReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "point", null, "invalid", null, "pointReference");
      return {
        kind: "offsetPoint",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        from,
        dx: scalar(argument("dx"), { kind: "number" }, "0"),
        dy: scalar(argument("dy"), { kind: "number" }, "0")
      };
    }
    if (invocation.construction === "offset" && invocation.pureValueInterface === "path") {
      if (expectedInterfaceType !== "path") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "offset line construction は path value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "offset" } }
        }));
      }
      const sources = pathReferences(sourcesArgument);
      const offsetSideType = scalarTypeForParameterDefinition(
        getParameterDefinitions({ type: "offsetLine" } as never).find((definition) => definition.key === "side")
      );
      return {
        kind: "offsetPath",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        sources,
        distance: scalar(argument("distance"), { kind: "number" }, "10"),
        side: offsetSideType ? scalar(sideArgument, offsetSideType, "right") : null,
        closed: scalar(closedArgument, { kind: "boolean" }, "false"),
        suppressTrimWarnings: scalar(suppressTrimWarningsArgument, { kind: "boolean" }, "false")
      };
    }
    if (invocation.construction === "join" && invocation.pureValueInterface === "path") {
      if (expectedInterfaceType !== "path") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "join construction は path value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "join" } }
        }));
      }
      return {
        kind: "joinedPath",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        paths: pathReferences(pathsArgument),
        closed: scalar(closedArgument, { kind: "boolean" }, "false")
      };
    }
    if (invocation.construction === "transformCopy" && invocation.pureValueInterface === "path") {
      if (expectedInterfaceType !== "path") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "transformCopy construction は path value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "transformCopy" } }
        }));
      }
      return {
        kind: "transformCopy",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        startPoint: pointReference(argument("startPoint")),
        endPoint: pointReference(argument("endPoint")),
        scale: scalar(argument("scale"), { kind: "number" }, "1"),
        angleDeg: scalar(argument("angleDeg"), { kind: "number" }, "0"),
        mirrorX: scalar(argument("mirrorX"), { kind: "boolean" }, "false"),
        baseLines: pathReferences(argument("baseLines"))
      };
    }
    if (invocation.construction === "mirrorCopy" && invocation.pureValueInterface === "path") {
      if (expectedInterfaceType !== "path") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "mirrorCopy construction は path value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "mirrorCopy" } }
        }));
      }
      return {
        kind: "mirrorCopy",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        axis1: pointReference(argument("axis1")),
        axis2: pointReference(argument("axis2")),
        baseLines: pathReferences(argument("baseLines"))
      };
    }
    if (invocation.construction === "polar" && invocation.pureValueInterface === "point") {
      if (expectedInterfaceType !== "point") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "polar point construction は point value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "polar" } }
        }));
      }
      const from = fromArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(fromArgument.valueSpan.start, fromArgument.valueSpan.end),
            fromArgument.valueSpan,
            "point",
            {
              expectedInterfaceType: "point",
              allowCoordinate: false,
              role: "pointReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "point", null, "invalid", null, "pointReference");
      return {
        kind: "polarPoint",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        from,
        angle: scalar(angleArgument, { kind: "number" }, "0"),
        distance: scalar(argument("distance"), { kind: "number" }, "0")
      };
    }
    if (invocation.construction === "between" && invocation.pureValueInterface === "point") {
      if (expectedInterfaceType !== "point") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "between construction は point value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "between" } }
        }));
      }
      const start = startArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(startArgument.valueSpan.start, startArgument.valueSpan.end),
            startArgument.valueSpan,
            "point",
            {
              expectedInterfaceType: "point",
              allowCoordinate: true,
              role: "pointReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "point", null, "invalid", null, "pointReference");
      const end = endArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(endArgument.valueSpan.start, endArgument.valueSpan.end),
            endArgument.valueSpan,
            "point",
            {
              expectedInterfaceType: "point",
              allowCoordinate: true,
              role: "pointReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "point", null, "invalid", null, "pointReference");
      const selectedPlacement = placement();
      return selectedPlacement
        ? {
            kind: "between",
            span: { start: constructionSpan.start, end: initializerSpan.end },
            start,
            end,
            placement: selectedPlacement
          }
        : null;
    }
    if (invocation.construction === "onLine" && invocation.pureValueInterface === "point") {
      if (expectedInterfaceType !== "point") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "onLine construction は point value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "onLine" } }
        }));
      }
      const from = fromArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(fromArgument.valueSpan.start, fromArgument.valueSpan.end),
            fromArgument.valueSpan,
            "point",
            {
              expectedInterfaceType: "point",
              allowCoordinate: false,
              role: "lineEndpointReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "point", null, "invalid", null, "lineEndpointReference");
      const line = fromArgument
        ? (() => {
            const rawFrom = source.slice(fromArgument.valueSpan.start, fromArgument.valueSpan.end).trim();
            const parsedFrom = parseDslSourceReference(rawFrom);
            if (parsedFrom.kind !== "valid" || !parsedFrom.reference.property) {
              return geometryReference("", constructionSpan, "line", null, "invalid", null, "lineReference");
            }
            const lineSource = `@${parsedFrom.reference.pathText}`;
            const lineSpan = { start: fromArgument.valueSpan.start, end: fromArgument.valueSpan.start + lineSource.length };
            return resolveGeometry(
              statementIndex,
              ownerIndex,
              lineSource,
              lineSpan,
              "line",
              {
                expectedInterfaceType: "path",
                allowCoordinate: false,
                role: "lineReference",
                scalarResolver: options.scalarResolver,
                bareScalarResolver: options.bareScalarResolver,
                geometryPropertyResolver: options.geometryPropertyResolver,
                presenceFacts: options.presenceFacts
              }
            );
          })()
        : geometryReference("", constructionSpan, "line", null, "invalid", null, "lineReference");
      const endpointKey = from.target
        ? unwrapModuleGeometrySourceTarget(from.target).pointKey === "end" ? "end" as const : "start" as const
        : (() => {
            const rawFrom = fromArgument ? source.slice(fromArgument.valueSpan.start, fromArgument.valueSpan.end).trim() : "";
            const parsedFrom = parseDslSourceReference(rawFrom);
            return parsedFrom.kind === "valid" && parsedFrom.reference.property === "end" ? "end" as const : "start" as const;
          })();
      const selectedPlacement = placement();
      return selectedPlacement
        ? {
            kind: "onLine",
            span: { start: constructionSpan.start, end: initializerSpan.end },
            from,
            line,
            endpointKey,
            placement: selectedPlacement
          }
        : null;
    }
    if (invocation.construction === "intersection" && invocation.pureValueInterface === "point") {
      if (expectedInterfaceType !== "point") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "intersection construction は point value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "intersection" } }
        }));
      }
      const line = (candidate: typeof line1Argument) => candidate
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(candidate.valueSpan.start, candidate.valueSpan.end),
            candidate.valueSpan,
            "line",
            {
              expectedInterfaceType: "path",
              allowCoordinate: false,
              role: "lineReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "line", null, "invalid", null, "lineReference");
      return {
        kind: "intersection",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        line1: line(line1Argument),
        line2: line(line2Argument),
        index: scalar(argument("index"), { kind: "number" }, "0"),
        extensions: scalar(argument("extensions"), { kind: "boolean" }, "false")
      };
    }
    if (invocation.construction === "commonTangent" && invocation.pureValueInterface === "line") {
      if (expectedInterfaceType !== "line" && expectedInterfaceType !== "path") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "commonTangent construction は line または path value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "commonTangent" } }
        }));
      }
      const line = (candidate: typeof firstArgument) => candidate
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(candidate.valueSpan.start, candidate.valueSpan.end),
            candidate.valueSpan,
            "line",
            {
              expectedInterfaceType: "path",
              allowCoordinate: false,
              role: "lineReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "line", null, "invalid", null, "lineReference");
      const tangentKindType = scalarTypeForParameterDefinition(
        getParameterDefinitions({ type: "commonTangentLine" } as never).find((definition) => definition.key === "kind")
      );
      const sideType = scalarTypeForParameterDefinition(
        getParameterDefinitions({ type: "commonTangentLine" } as never).find((definition) => definition.key === "side")
      );
      return {
        kind: "commonTangent",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        first: line(firstArgument),
        second: line(secondArgument),
        tangentKind: kindArgument && tangentKindType ? scalar(kindArgument, tangentKindType, "external") : null,
        side: sideArgument && sideType ? scalar(sideArgument, sideType, "left") : null
      };
    }
    if (invocation.construction === "tangentOffset" && invocation.pureValueInterface === "point") {
      if (expectedInterfaceType !== "point") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "tangentOffset construction は point value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "tangentOffset" } }
        }));
      }
      const line = lineArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(lineArgument.valueSpan.start, lineArgument.valueSpan.end),
            lineArgument.valueSpan,
            "line",
            {
              expectedInterfaceType: "path",
              allowCoordinate: false,
              role: "lineReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "line", null, "invalid", null, "lineReference");
      const base = baseArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(baseArgument.valueSpan.start, baseArgument.valueSpan.end),
            baseArgument.valueSpan,
            "point",
            {
              expectedInterfaceType: "point",
              allowCoordinate: true,
              role: "pointReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "point", null, "invalid", null, "pointReference");
      const curveSideType = scalarTypeForParameterDefinition(
        getParameterDefinitions({ type: "lineTangentOffsetPoint" } as never).find((definition) => definition.key === "curveSide")
      );
      const curveSide = curveSideArgument && curveSideType
        ? scalar(curveSideArgument, curveSideType, "convex")
        : null;
      return {
        kind: "tangentOffset",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        line,
        base,
        angle: curveSide ? null : scalar(angleArgument, { kind: "number" }, "0"),
        curveSide,
        distance: scalar(distanceArgument, { kind: "number" }, "0")
      };
    }
    if (invocation.construction === "bezierExtremePoint" && invocation.pureValueInterface === "point") {
      if (expectedInterfaceType !== "point") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "bezierExtremePoint construction は point value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "bezierExtremePoint" } }
        }));
      }
      const sourceReference = sourceArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(sourceArgument.valueSpan.start, sourceArgument.valueSpan.end),
            sourceArgument.valueSpan,
            "line",
            {
              expectedInterfaceType: "path",
              allowCoordinate: false,
              role: "lineReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "line", null, "invalid", null, "lineReference");
      return {
        kind: "bezierExtremePoint",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        source: sourceReference,
        segmentIndex: scalar(argument("segmentIndex"), { kind: "number" }, "0"),
        direction: scalar(directionArgument, { kind: "number" }, "0")
      };
    }
    if (invocation.construction === "bezierBulgePoint" && invocation.pureValueInterface === "point") {
      if (expectedInterfaceType !== "point") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "bezierBulgePoint construction は point value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "bezierBulgePoint" } }
        }));
      }
      const sourceReference = sourceArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(sourceArgument.valueSpan.start, sourceArgument.valueSpan.end),
            sourceArgument.valueSpan,
            "line",
            {
              expectedInterfaceType: "path",
              allowCoordinate: false,
              role: "lineReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "line", null, "invalid", null, "lineReference");
      return {
        kind: "bezierBulgePoint",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        source: sourceReference,
        segmentIndex: scalar(argument("segmentIndex"), { kind: "number" }, "0")
      };
    }
    if (invocation.pureValueInterface === "point") {
      if (expectedInterfaceType !== "point") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "coordinate construction は point value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "coordinate" } }
        }));
      }
      return { kind: "coordinate", span: { start: constructionSpan.start, end: initializerSpan.end }, x: scalar(xArgument, { kind: "number" }, "0"), y: scalar(yArgument, { kind: "number" }, "0") };
    }
    if (invocation.construction === "through" && invocation.pureValueInterface === "path") {
      if (expectedInterfaceType !== "path") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "through construction は path value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "through" } }
        }));
      }
      const point = (candidate: typeof point1Argument) => candidate
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(candidate.valueSpan.start, candidate.valueSpan.end),
            candidate.valueSpan,
            "point",
            {
              expectedInterfaceType: "point",
              allowCoordinate: true,
              role: "pointReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "point", null, "invalid", null, "pointReference");
      return {
        kind: "through",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        point1: point(point1Argument),
        point2: point(point2Argument),
        point3: point(point3Argument),
        start: scalar(startArgument, { kind: "number" }, "0"),
        end: scalar(endArgument, { kind: "number" }, "90")
      };
    }
    if (invocation.construction === "arc" && invocation.pureValueInterface === "path") {
      if (expectedInterfaceType !== "path") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "arc construction は path value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "arc" } }
        }));
      }
      const center = centerArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(centerArgument.valueSpan.start, centerArgument.valueSpan.end),
            centerArgument.valueSpan,
            "point",
            {
              expectedInterfaceType: "point",
              allowCoordinate: true,
              role: "coordinatePoint",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "point", null, "invalid", null, "coordinatePoint");
      const arcDirectionType = scalarTypeForParameterDefinition(
        getParameterDefinitions({ type: "arcLine", intermediatePoints: [] } as never).find((definition) => definition.key === "direction")
      );
      return {
        kind: "arc",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        center,
        radius: scalar(radiusArgument, { kind: "number" }, "30"),
        start: scalar(startArgument, { kind: "number" }, "0"),
        end: scalar(endArgument, { kind: "number" }, "90"),
        direction: arcDirectionType ? scalar(directionArgument, arcDirectionType, "counterclockwise") : null
      };
    }
    if (expectedInterfaceType !== "line" && expectedInterfaceType !== "path") {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "segment construction は line または path value にのみ代入できます。", {
        presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "segment" } }
      }));
    }
    const endpoint = (candidate: typeof startArgument) => candidate
      ? resolveGeometry(
          statementIndex,
          ownerIndex,
          source.slice(candidate.valueSpan.start, candidate.valueSpan.end),
          candidate.valueSpan,
          "point",
          {
            expectedInterfaceType: "point",
            allowCoordinate: true,
            role: "lineEndpointReference",
            scalarResolver: options.scalarResolver,
            bareScalarResolver: options.bareScalarResolver,
            geometryPropertyResolver: options.geometryPropertyResolver,
            presenceFacts: options.presenceFacts
          }
      )
      : geometryReference("", constructionSpan, "point", null, "invalid", null, "lineEndpointReference");
    if (invocation.construction === "polar" && invocation.pureValueInterface === "line") {
      if (expectedInterfaceType !== "line" && expectedInterfaceType !== "path") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "polar line construction は line または path value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "polar" } }
        }));
      }
      const start = startArgument
        ? resolveGeometry(
            statementIndex,
            ownerIndex,
            source.slice(startArgument.valueSpan.start, startArgument.valueSpan.end),
            startArgument.valueSpan,
            "point",
            {
              expectedInterfaceType: "point",
              allowCoordinate: true,
              role: "lineEndpointReference",
              scalarResolver: options.scalarResolver,
              bareScalarResolver: options.bareScalarResolver,
              geometryPropertyResolver: options.geometryPropertyResolver,
              presenceFacts: options.presenceFacts
            }
          )
        : geometryReference("", constructionSpan, "point", null, "invalid", null, "lineEndpointReference");
      return {
        kind: "polarLine",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        start,
        angle: scalar(angleArgument, { kind: "number" }, "0"),
        length: scalar(lengthArgument, { kind: "number" }, "100")
      };
    }
    if (invocation.construction === "bezier" && invocation.pureValueInterface === "path") {
      if (expectedInterfaceType !== "path") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "bezier construction は path value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "bezier" } }
        }));
      }
      const intermediates = recordSpans(source, intermediatesArgument?.valueSpan ?? { start: 0, end: 0 })?.map((record) => {
        const pointSpan = recordField(source, record, 0);
        const point = pointSpan
          ? resolveGeometry(
              statementIndex,
              ownerIndex,
              source.slice(pointSpan.start, pointSpan.end),
              pointSpan,
              "point",
              {
                expectedInterfaceType: "point",
                allowCoordinate: true,
                role: "pointReference",
                scalarResolver: options.scalarResolver,
                bareScalarResolver: options.bareScalarResolver,
                geometryPropertyResolver: options.geometryPropertyResolver,
                presenceFacts: options.presenceFacts
              }
            )
          : geometryReference("", record, "point", null, "invalid", null, "pointReference");
        return {
          span: record,
          point,
          angle: scalarForSpan(recordField(source, record, 1), { kind: "number" }, "0"),
          incomingLength: scalarForSpan(recordField(source, record, 2), { kind: "number" }, "30"),
          outgoingLength: scalarForSpan(recordField(source, record, 3), { kind: "number" }, "30")
        };
      }) ?? [];
      return {
        kind: "bezier",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        start: endpoint(startArgument),
        end: endpoint(endArgument),
        startAngle: scalar(startAngleArgument, { kind: "number" }, "0"),
        startLength: scalar(startLengthArgument, { kind: "number" }, "30"),
        endAngle: scalar(endAngleArgument, { kind: "number" }, "0"),
        endLength: scalar(endLengthArgument, { kind: "number" }, "30"),
        intermediates
      };
    }
    if (invocation.construction === "polyline" && invocation.pureValueInterface === "path") {
      if (expectedInterfaceType !== "path") {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", constructionSpan, "polyline construction は path value にのみ代入できます。", {
          presentation: { key: "diagnostic.module-geometry-type-mismatch", parameters: { target: "polyline" } }
        }));
      }
      const pointReferences: ModuleGeometryReferenceSemantic[] = [];
      let pointsReference: { source: string; span: DslSpan } | null = null;
      if (pointsArgument) {
        const pointsSpan = pointsArgument.valueSpan;
        const pointsSource = source.slice(pointsSpan.start, pointsSpan.end);
        const parsedPoints = parseGeometryArrayExpression(pointsSource);
        for (const diagnostic of parsedPoints.diagnostics) {
          addLocal(statementIndex, issue(
            diagnostic.code,
            { start: pointsSpan.start + diagnostic.span.start, end: pointsSpan.start + diagnostic.span.end },
            diagnostic.message,
            { presentation: { key: `diagnostic.${diagnostic.code}` } }
          ));
        }
        if (parsedPoints.expression?.kind === "literal" && parsedPoints.diagnostics.length === 0) {
          for (const member of parsedPoints.expression.members) {
            const memberSpan = {
              start: pointsSpan.start + member.span.start,
              end: pointsSpan.start + member.span.end
            };
            pointReferences.push(resolveGeometry(
              statementIndex,
              ownerIndex,
              source.slice(memberSpan.start, memberSpan.end),
              memberSpan,
              "point",
              {
                expectedInterfaceType: "point",
                allowCoordinate: true,
                role: "pointReference",
                scalarResolver: options.scalarResolver,
                bareScalarResolver: options.bareScalarResolver,
                geometryPropertyResolver: options.geometryPropertyResolver,
                presenceFacts: options.presenceFacts
              }
            ));
          }
        } else if (parsedPoints.expression?.kind === "reference" && parsedPoints.diagnostics.length === 0) {
          pointsReference = { source: pointsSource, span: pointsSpan };
        }
      }
      return {
        kind: "polyline",
        span: { start: constructionSpan.start, end: initializerSpan.end },
        points: pointReferences,
        pointsReference,
        closed: scalar(closedArgument, { kind: "boolean" }, "false")
      };
    }
    return { kind: "segment", span: { start: constructionSpan.start, end: initializerSpan.end }, start: endpoint(startArgument), end: endpoint(endArgument) };
  };

  const parseGeometryValueExpression = ({
    statementIndex,
    ownerIndex,
    source,
    node,
    expectedInterfaceType,
    expectedValueType,
    requireOptional,
    analyzeScalar,
    resolveReference,
    parseConstruction,
    addDiagnostic
  }: {
    statementIndex: number;
    ownerIndex: number | null;
    source: string;
    node: ScalarExpressionAst;
    expectedInterfaceType: ModuleGeometryInterfaceType;
    expectedValueType?: DslValueType;
    requireOptional?: boolean;
    analyzeScalar: (raw: string, span: DslSpan, expectedType: ScalarType | null) => ModuleScalarExpressionSemantic | null;
    resolveReference: (raw: string, span: DslSpan, options?: { expectedValueType?: DslValueType; requireOptional?: boolean }) => ModuleGeometryReferenceSemantic;
    parseConstruction: (raw: string, span: DslSpan, expectedInterfaceType: ModuleGeometryInterfaceType) => ModuleGeometryConstructionSemantic | null;
    addDiagnostic: (diagnostic: ModuleScalarLocalDiagnostic) => void;
  }): ModuleGeometryValueExpressionSemantic | null => {
    const raw = source.slice(node.span.start, node.span.end);
    switch (node.kind) {
      case "reference":
        return {
          kind: "reference",
          span: node.span,
          reference: resolveReference(raw, node.span, { expectedValueType, requireOptional })
        };
      case "noneLiteral":
        if (!isDslOptionalValueType(expectedValueType)) {
          addDiagnostic(issue(
            "optional-value-required",
            node.span,
            "none は expected optional value type がある場合にのみ使用できます。",
            { presentation: { key: "diagnostic.optional-value-required" } }
          ));
          return null;
        }
        return { kind: "none", span: node.span, valueType: expectedValueType };
      case "binary": {
        if (node.operator !== "??") {
          addDiagnostic(issue(
            "geometry-value-reference-required",
            node.span,
            "geometry value の式では ?? のみ使用できます。",
            { presentation: { key: "diagnostic.geometry-value-reference-required" } }
          ));
          return null;
        }
        const requiredValueType = dslRequiredValueTypeOf(expectedValueType);
        if (!requiredValueType || !isDslGeometryValueType(requiredValueType)) {
          addDiagnostic(issue(
            "coalesce-type-mismatch",
            node.span,
            "geometry value の ?? には geometry の underlying value type が必要です。",
            { presentation: { key: "diagnostic.coalesce-type-mismatch" } }
          ));
          return null;
        }
        const left = parseGeometryValueExpression({
          statementIndex,
          ownerIndex,
          source,
          node: node.left,
          expectedInterfaceType,
          expectedValueType: { kind: "optional", valueType: requiredValueType },
          requireOptional: true,
          analyzeScalar,
          resolveReference,
          parseConstruction,
          addDiagnostic
        });
        const right = parseGeometryValueExpression({
          statementIndex,
          ownerIndex,
          source,
          node: node.right,
          expectedInterfaceType,
          expectedValueType: requiredValueType,
          requireOptional: false,
          analyzeScalar,
          resolveReference,
          parseConstruction,
          addDiagnostic
        });
        const leftType = left?.kind === "reference" ? left.reference.valueType : left?.valueType;
        const rightType = right?.kind === "reference" ? right.reference.valueType : right?.valueType;
        const resultType = dslCoalesceResultType(leftType, rightType);
        if (!left || !right || !resultType || !isDslValueTypeAssignable(resultType, requiredValueType)) return null;
        return { kind: "coalesce", span: node.span, left, right, valueType: resultType };
      }
      case "call": {
        const construction = parseConstruction(raw, node.span, expectedInterfaceType);
        return construction ? { kind: "construction", span: node.span, construction, valueType: expectedValueType } : null;
      }
      case "valueIf": {
        const condition = analyzeScalar(
          source.slice(node.condition.span.start, node.condition.span.end),
          node.condition.span,
          { kind: "boolean" }
        );
        const thenBranch = parseGeometryValueExpression({
          statementIndex,
          ownerIndex,
          source,
          node: node.thenBranch,
          expectedInterfaceType,
          expectedValueType,
          requireOptional,
          analyzeScalar,
          resolveReference,
          parseConstruction,
          addDiagnostic
        });
        const elseBranch = parseGeometryValueExpression({
          statementIndex,
          ownerIndex,
          source,
          node: node.elseBranch ?? { kind: "noneLiteral", span: { start: node.span.end, end: node.span.end } },
          expectedInterfaceType,
          expectedValueType,
          requireOptional,
          analyzeScalar,
          resolveReference,
          parseConstruction,
          addDiagnostic
        });
        return { kind: "if", span: node.span, condition, thenBranch, elseBranch, valueType: expectedValueType };
      }
      case "valueMatch": {
        const scrutinee = analyzeScalar(
          source.slice(node.scrutinee.span.start, node.scrutinee.span.end),
          node.scrutinee.span,
          null
        );
        if (scrutinee) {
          if (scrutinee.type?.kind === "optional") {
            validateOptionalMatchExhaustiveness({
              scrutineeType: scrutinee.type,
              scrutineeSpan: node.scrutinee.span,
              matchSpan: node.span,
              arms: node.arms,
              addDiagnostic
            });
          } else {
            validateChoiceMatchExhaustiveness({
              scrutineeType: scrutinee.type,
              scrutineeSpan: node.scrutinee.span,
              matchSpan: node.span,
              arms: node.arms,
              addDiagnostic
            });
          }
        }
        return {
          kind: "match",
          span: node.span,
          scrutinee,
          arms: node.arms.map((arm) => ({
            label: arm.label,
            labelSpan: arm.labelSpan,
            binder: arm.binder,
            binderSpan: arm.binderSpan,
            expression: parseGeometryValueExpression({
              statementIndex,
              ownerIndex,
              source,
              node: arm.expression,
              expectedInterfaceType,
              expectedValueType,
              requireOptional,
              analyzeScalar,
              resolveReference,
              parseConstruction,
              addDiagnostic
            })
          })),
          valueType: expectedValueType
        };
      }
      default:
        addDiagnostic(issue(
          "geometry-value-reference-required",
          node.span,
          "geometry value の分岐結果には既存の @geometry reference または対応する construction を指定してください。",
          { presentation: { key: "diagnostic.geometry-value-reference-required" } }
        ));
        return null;
    }
  };

  const geometryValueExpressionHasConstruction = (node: ScalarExpressionAst): boolean => {
    switch (node.kind) {
      case "call": return true;
      case "valueIf": return geometryValueExpressionHasConstruction(node.thenBranch) || (node.elseBranch ? geometryValueExpressionHasConstruction(node.elseBranch) : false);
      case "valueMatch": return node.arms.some((arm) => geometryValueExpressionHasConstruction(arm.expression));
      default: return false;
    }
  };

  const resolveRootGeometry = (
    statementIndex: number,
    rawValue: string,
    span: DslSpan,
    expected: "point" | "line",
    options: Parameters<typeof resolveGeometry>[5] = {}
  ) => {
    const previous = suppressLocalDiagnostics;
    suppressLocalDiagnostics = true;
    try {
      return resolveGeometry(statementIndex, null, rawValue, span, expected, options);
    } finally {
      suppressLocalDiagnostics = previous;
    }
  };

  const numericGeometryTargetForSourceStatement = (
    statementIndex: number,
    ownerIndex: number | null,
    statement: DslStatement | undefined,
    visiting: ReadonlySet<number> = new Set()
  ): NumericGeometryStaticTarget | null => {
    const directTarget = numericGeometryTargetForStatement(
      statement,
      { intermediatePointCount: intermediatePointCountForStatement(statement) }
    );
    if (
      statement?.kind !== "element" ||
      statement.category !== "line" ||
      statement.construction !== "split" ||
      visiting.has(statementIndex)
    ) {
      return directTarget;
    }
    const source = statement.attrs.find((attribute) => attribute.key === "source")?.value;
    const parsed = source ? parseDslSourceReference(source) : null;
    if (!parsed || parsed.kind !== "valid" || parsed.reference.property) return directTarget;
    const path = parseDslReferenceToken(parsed.reference.pathText);
    const lookup = ownerIndex === null
      ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, path) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, parsed.reference.pathText)
      : resolveModuleLexicalPath(statementIndex, ownerIndex, path);
    let baseTarget: NumericGeometryStaticTarget | null = null;
    if (lookup.kind === "parameter") {
      const interfaceType = moduleGeometryInterfaceTypeOf(lookup.parameter.parameter.type);
      baseTarget = interfaceType ? numericGeometryStaticTargetForModuleInterface(interfaceType) : null;
    } else if (lookup.kind === "resolved" && lookup.declaration.kind === "geometry") {
      const nextVisiting = new Set(visiting);
      nextVisiting.add(statementIndex);
      baseTarget = numericGeometryTargetForSourceStatement(
        lookup.declaration.statementIndex,
        ownerIndex,
        lookup.declaration.statement,
        nextVisiting
      );
    }
    return numericGeometryStaticTargetForConstruction("line", "split", { baseTarget });
  };

  const resolveGeometryProperty = (
    statementIndex: number,
    ownerIndex: number | null,
    reference: ModuleGeometryPropertyReferenceInput
  ): ModuleGeometryPropertyReferenceResolution => {
    const collectionAnalysis = sourceNamespace.geometryArraySemanticAnalysis;
    if (reference.property === "length" && collectionAnalysis) {
      const qualified = resolveQualifiedModuleExport(statementIndex, ownerIndex, reference.elementName, reference.elementNameSpan);
      if (qualified?.kind === "deferred") {
        const exported = qualifiedCollectionExportFor(qualified);
        if (exported?.kind === "collection") {
          return {
            target: {
              kind: "deferredModuleCollectionExportLength",
              instanceStatementId: qualified.instance.statementId,
              instanceStatementIndex: qualified.instance.statementIndex,
              instanceName: qualified.instanceName,
              exportName: qualified.exportName,
              exportedStatementId: exported.exportedStatementId,
              exportedStatementIndex: exported.exportedStatementIndex,
              valueType: exported.valueType,
              referenceSpan: reference.span,
              instanceSpan: qualified.instanceSpan,
              memberSpan: qualified.memberSpan
            },
            type: { kind: "number" },
            resolution: "deferred"
          };
        }
        if (exported?.kind === "private") {
          addLocal(statementIndex, issue(
            "module-private-member",
            qualified.memberSpan,
            `module member「${qualified.exportName}」はexportされていないため参照できません。`,
            { presentation: { key: "diagnostic.module-private-member", parameters: { target: qualified.exportName } } }
          ));
          return { target: null, type: null, resolution: "invalid" };
        }
      } else if (qualified) {
        qualifiedDiagnostic(statementIndex, reference.span, qualified, null);
        return {
          target: null,
          type: null,
          resolution: qualified.kind === "forward" ? "forward" : qualified.kind === "undefined" ? "undefined" : qualified.kind === "outerCapture" ? "outerCapture" : "invalid"
        };
      }

      const path = parseDslReferenceToken(reference.elementName);
      const lookup = ownerIndex === null
        ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, path) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, reference.elementName)
        : resolveModuleLexicalPath(statementIndex, ownerIndex, path);
      if (lookup.kind === "parameter") {
        if (isDslArrayValueType(lookup.parameter.parameter.valueType)) {
          const parameterTarget = {
          kind: "collectionParameterLength" as const,
          definitionStatementId: lookup.definition.statementId,
          parameterIndex: lookup.parameter.index,
          valueType: lookup.parameter.parameter.valueType,
          optional: lookup.parameter.parameter.optional
        };
          if (lookup.parameter.parameter.optional && !reference.presenceFacts?.has(moduleParameterPresenceKey(parameterTarget.definitionStatementId, parameterTarget.parameterIndex))) {
          return {
            target: parameterTarget,
            type: null,
            resolution: "invalid",
            diagnostic: issue(
              "module-optional-value-required",
              reference.span,
              `optional module parameter「${reference.elementName}」は hasValue(@${reference.elementName}) で存在を確認してから参照してください。`,
              { relatedSources: relatedForParameter(lookup.definition, lookup.parameter.index), presentation: { key: "diagnostic.module-optional-value-required", parameters: { name: reference.elementName } } }
            )
          };
          }
          return { target: parameterTarget, type: { kind: "number" }, resolution: "resolved" };
        }
      }
      if (lookup.kind === "resolved" && lookup.declaration.kind === "typedDeclaration" && lookup.declaration.statement.kind === "typedDeclaration") {
        const value = collectionValueSemanticForStatement(collectionAnalysis, lookup.declaration.statementIndex);
        if (value) {
          const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
          if (ownerIndex !== null && declarationOwner !== ownerIndex) {
          return {
            target: null,
            type: null,
            resolution: "outerCapture",
            diagnostic: issue("module-outer-capture", reference.span, `module body から outer collection「${reference.elementName}」を暗黙 capture できません。`, {
              relatedSources: relatedForDeclaration(lookup.declaration),
              presentation: { key: "diagnostic.module-outer-capture", parameters: { name: reference.elementName } }
            })
          };
          }
          const valueType = "valueType" in value ? value.valueType : { kind: "array" as const, elementType: { kind: value.type.elementType as "point" | "line" | "path" } };
          return {
          target: {
            kind: "collectionValueLength",
            statementId: value.statementId,
            statementIndex: value.statementIndex,
            valueId: value.statementId,
            valueType,
            length: collectionLengthForValueId(collectionAnalysis, value.statementId),
            ...(value.statementId ? { identity: input.documentId ? qualifySemanticIdentity(input.documentId, value.statementId) : undefined } : {})
          },
          type: { kind: "number" },
          resolution: "resolved"
          };
        }
      }
    }

    // The scalar expression parser represents `@records[0].field` as a
    // geometry-property node because the same syntax is used for geometry
    // collection members. Resolve nominal-record collections through the
    // existing record reference/member owners before the ordinary geometry
    // property fallback gets a chance to report a misleading element error.
    if (reference.occurrenceIndex && collectionAnalysis) {
      const collectionPath = parseDslReferenceToken(reference.elementName);
      const qualified = collectionPath.segments.length > 1
        ? resolveQualifiedModuleExport(statementIndex, ownerIndex, reference.elementName, reference.elementNameSpan)
        : null;
      const qualifiedCollection = qualified?.kind === "deferred" ? qualifiedCollectionExportFor(qualified) : null;
      const lookup = !qualified
        ? ownerIndex === null
          ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, collectionPath) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, reference.elementName)
          : resolveModuleLexicalPath(statementIndex, ownerIndex, collectionPath)
        : null;
      const collectionValue = lookup?.kind === "resolved" && lookup.declaration.kind === "typedDeclaration"
        ? collectionValueSemanticForStatement(collectionAnalysis, lookup.declaration.statementIndex)
        : null;
      const collectionType = qualifiedCollection?.kind === "collection"
        ? qualifiedCollection.valueType
        : lookup?.kind === "parameter"
          ? collectionAnalysis.genericModuleParametersBySlot.get(`${lookup.definition.statementId}:${lookup.parameter.index}`)?.valueType ?? null
          : collectionValue && "valueType" in collectionValue
            ? collectionValue.valueType
            : null;
      const elementType = collectionType?.elementType;
      if (elementType?.kind === "record" && elementType.identity) {
        const source = input.logicalTextByStatementIndex?.get(statementIndex);
        const indexEnd = reference.occurrenceRange?.end ?? reference.occurrenceIndexSpan?.end;
        const indexedSpan = indexEnd !== undefined
          ? { start: reference.span.start, end: indexEnd }
          : null;
        const indexedSource = source && indexedSpan ? source.slice(indexedSpan.start, indexedSpan.end) : null;
        if (indexedSource && indexedSource.length > 0 && indexedSpan) {
          const recordReference = recordReferenceSemantic(
            statementIndex,
            ownerIndex,
            indexedSource,
            indexedSpan,
            elementType.identity,
            reference.presenceFacts ?? new Set()
          );
          if (recordReference.target?.kind === "recordCollectionIndex") {
            const definition = recordDefinitionFor(elementType.identity);
            const member = definition
              ? recordMemberFor({
                  kind: "record",
                  target: recordReference.target,
                  typeIdentity: elementType.identity,
                  definition
                }, reference.property)
              : null;
            if (definition && member) {
              const fieldTarget = recordFieldTargetFor({
                kind: "record",
                target: recordReference.target,
                typeIdentity: elementType.identity,
                definition
              }, reference);
              if (fieldTarget) return { target: fieldTarget, type: fieldTarget.type, resolution: fieldTarget.type ? "resolved" : "invalid" };
            }
          }
        }
      }
    }
    const record = recordSourceLookup(statementIndex, ownerIndex, reference.elementName, reference.elementNameSpan);
    if (record.kind === "record") {
      const fieldTarget = recordFieldTargetFor(record, reference);
      if (!fieldTarget) {
        return {
          target: null,
          type: null,
          resolution: "invalid",
          diagnostic: issue(
            "module-record-field-unknown",
            reference.propertySpan,
            `record「${record.definition.name}」に field「${reference.property}」はありません。`,
            { presentation: { key: "diagnostic.module-record-field-unknown", parameters: { record: record.definition.name, field: reference.property } } }
          )
        };
      }
      const recordParameterTarget = record.target.kind === "recordParameter" ? record.target : null;
      const parameterDefinition = recordParameterTarget
        ? definitionStates.find((candidate) => candidate.statementId === recordParameterTarget.definitionStatementId)
        : undefined;
      if (
        recordParameterTarget &&
        parameterDefinition?.parameters[recordParameterTarget.parameterIndex]?.optional === true &&
        !reference.presenceFacts?.has(moduleParameterPresenceKey(recordParameterTarget.definitionStatementId, recordParameterTarget.parameterIndex))
      ) {
        return {
          target: fieldTarget,
          type: null,
          resolution: "invalid",
          diagnostic: issue(
            "module-optional-value-required",
            reference.elementNameSpan,
            `optional module parameter「${reference.elementName}」は hasValue(@${reference.elementName}) で存在を確認してから参照してください。`,
            {
              relatedSources: parameterDefinition ? relatedForParameter(parameterDefinition, recordParameterTarget.parameterIndex) : [],
              presentation: { key: "diagnostic.module-optional-value-required", parameters: { name: reference.elementName } }
            }
          )
        };
      }
      return { target: fieldTarget, type: fieldTarget.type, resolution: fieldTarget.type ? "resolved" : "invalid" };
    }
    if (record.kind === "blocked") {
      return {
        target: null,
        type: null,
        resolution: record.resolution === "ambiguous" ? "invalid" : record.resolution,
        diagnostic: record.diagnostic
      };
    }
    const unknownProperty = (): ModuleGeometryPropertyReferenceResolution => ({
      target: null,
      type: null,
      resolution: "invalid",
      diagnostic: issue("module-unknown-geometry-property", reference.span, `geometry property「${reference.property}」を解決できません。`, { presentation: { key: "diagnostic.module-unknown-geometry-property", parameters: { property: reference.property } } })
    });
    const pointPath = /^(start|end)\.(x|y)$/.exec(reference.property);
    const resolvedProperty = pointPath ? pointPath[2]! : reference.property;
    const resolvedPointKey = pointPath ? pointPath[1] : undefined;
    if (activeGeometryValueBinder) {
      const binderPath = parseDslReferenceToken(reference.elementName);
      if (!binderPath.absolute && binderPath.segments.length === 1 && binderPath.segments[0] === activeGeometryValueBinder.name) {
        const type = pointPath
          ? { kind: "number" as const }
          : numericGeometryPropertySupportedByStaticTarget(
              numericGeometryStaticTargetForModuleInterface(activeGeometryValueBinder.sourceElementType),
              reference.property
            )
            ? { kind: "number" as const }
            : null;
        if (!type) return unknownProperty();
        return {
          target: {
            kind: "geometryValueForBinder",
            binderId: activeGeometryValueBinder.binderId,
            statementId: activeGeometryValueBinder.statementId,
            statementIndex: activeGeometryValueBinder.statementIndex,
            name: activeGeometryValueBinder.name,
            sourceElementType: activeGeometryValueBinder.sourceElementType,
            property: resolvedProperty,
            ...(resolvedPointKey ? { pointKey: resolvedPointKey } : {})
          },
          type,
          resolution: "resolved"
        };
      }
    }
    const qualified = resolveQualifiedModuleExport(statementIndex, ownerIndex, reference.elementName, reference.elementNameSpan);
    if (qualified?.kind === "deferred") {
      const exported = qualifiedScalarExportFor(qualified);
      const numericTarget = exported?.kind === "geometry"
        ? exported.category
          ? numericGeometryTargetForExport(exported.category, statements[exported.exportedStatementIndex])
          : numericGeometryStaticTargetForModuleInterface(exported.interfaceType)
        : exported === null
          ? numericGeometryStaticTargetForModuleInterface("path")
          : null;
      const type = numericGeometryPropertySupportedByStaticTarget(numericTarget, reference.property)
        ? { kind: "number" as const }
        : (exported?.kind === "geometry"
        ? choiceGeometryPropertyTypeForStatement(statements[exported.exportedStatementIndex], reference.property)
        : null);
      if (!type) return unknownProperty();
      return {
        target: {
          kind: "deferredModuleExportProperty",
          instanceStatementId: qualified.instance.statementId,
          instanceStatementIndex: qualified.instance.statementIndex,
          instanceName: qualified.instanceName,
          exportName: qualified.exportName,
          property: reference.property,
          referenceSpan: reference.span,
          instanceSpan: qualified.instanceSpan,
          memberSpan: qualified.memberSpan
        },
        type,
        resolution: "deferred"
      };
    }
    if (qualified) {
      qualifiedDiagnostic(statementIndex, reference.span, qualified, null);
      return { target: null, type: null, resolution: qualified.kind === "forward" ? "forward" : qualified.kind === "undefined" ? "undefined" : qualified.kind === "outerCapture" ? "outerCapture" : "invalid" };
    }
    const path = parseDslReferenceToken(reference.elementName);
    const lookup = ownerIndex === null
      ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, path) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, reference.elementName)
      : resolveModuleLexicalPath(statementIndex, ownerIndex, path);
    if (lookup.kind === "parameter") {
      const parameterTarget = geometryParameterTarget(lookup.definition, lookup.parameter);
      const relatedSources = relatedForParameter(lookup.definition, lookup.parameter.index);
      if (!parameterTarget) {
        return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-geometry-property-type-mismatch", reference.span, `「${reference.elementName}」はgeometry parameterではありません。`, { relatedSources, presentation: { key: "diagnostic.module-geometry-property-type-mismatch", parameters: { target: reference.elementName } } }) };
      }
      if (lookup.parameter.parameter.optional && !reference.presenceFacts?.has(moduleParameterPresenceKey(parameterTarget.definitionStatementId, parameterTarget.parameterIndex))) {
        return { target: { ...parameterTarget, kind: "parameterProperty", property: reference.property }, type: null, resolution: "invalid", diagnostic: issue("module-optional-value-required", reference.span, `optional module parameter「${reference.elementName}」は hasValue(@${reference.elementName}) で存在を確認してから参照してください。`, { relatedSources, presentation: { key: "diagnostic.module-optional-value-required", parameters: { name: reference.elementName } } }) };
      }
      const interfaceType = moduleGeometryInterfaceTypeOf(lookup.parameter.parameter.type);
      const type = pointPath
        ? { kind: "number" as const }
        : numericGeometryPropertySupportedByStaticTarget(
            interfaceType ? numericGeometryStaticTargetForModuleInterface(interfaceType) : null,
            reference.property
          )
        ? { kind: "number" as const }
        : null;
      if (!type) return unknownProperty();
      return {
        target: {
          ...parameterTarget,
          kind: "parameterProperty",
          property: resolvedProperty,
          ...(resolvedPointKey ? { pointKey: resolvedPointKey } : {})
        },
        type,
        resolution: "resolved"
      };
    }
    if (lookup.kind === "undefined") return { target: null, type: null, resolution: "undefined", diagnostic: issue("module-undefined-geometry-reference", reference.span, `未定義のgeometry「${reference.elementName}」を参照しています。`, { presentation: { key: "diagnostic.module-undefined-geometry-reference", parameters: { name: reference.elementName } } }) };
    if (lookup.kind === "iteration") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-geometry-property-type-mismatch", reference.span, `「${reference.elementName}」はgeometryではありません。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-geometry-property-type-mismatch", parameters: { target: reference.elementName } } }) };
    if (lookup.kind === "forward") return { target: null, type: null, resolution: "forward", diagnostic: issue("module-forward-geometry-reference", reference.span, `geometry「${reference.elementName}」はこの位置より後で宣言されています。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-forward-geometry-reference", parameters: { name: reference.elementName } } }) };
    if (lookup.kind === "ambiguous") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-ambiguous-geometry-reference", reference.span, `geometry「${reference.elementName}」を一意に解決できません。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-ambiguous-geometry-reference", parameters: { name: reference.elementName } } }) };
    if (lookup.kind === "invalidOverlayTraversal") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-geometry-property-type-mismatch", reference.span, `「${lookup.name}」はparameter/iteration namespaceではありません。`, { presentation: { key: "diagnostic.module-geometry-property-type-mismatch", parameters: { target: lookup.name } } }) };
    if (lookup.kind === "invalidTraversal") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-geometry-property-type-mismatch", reference.span, `「${lookup.declaration.name}」はnamespace/containerではありません。`, { relatedSources: relatedForLookup(lookup), presentation: { key: "diagnostic.module-geometry-property-type-mismatch", parameters: { target: lookup.declaration.name } } }) };
    const declarationRelated = relatedForDeclaration(lookup.declaration);
    if (lookup.kind === "resolved" && lookup.declaration.kind === "geometry" &&
        isMaterializedForGroupTemplate(statements, lookup.declaration.statementIndex)) {
      const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
      if (ownerIndex !== null && declarationOwner !== ownerIndex) {
        return {
          target: null,
          type: null,
          resolution: "outerCapture",
          diagnostic: issue("module-outer-capture", reference.span, `module body から outer geometry「${reference.elementName}」を暗黙 capture できません。`, {
            relatedSources: declarationRelated,
            presentation: { key: "diagnostic.module-outer-capture", parameters: { name: reference.elementName } }
          })
        };
      }
      const sourceTarget = declarationGeometryTarget(lookup.declaration, stableStatementIdByIndex);
      const indexSemantic = reference.occurrenceIndex
        ? (() => {
            const indexSpan = reference.occurrenceIndexSpan ?? reference.occurrenceIndex.span;
            const source = input.logicalTextByStatementIndex?.get(statementIndex);
            return analyzeExpression(
              statementIndex,
              ownerIndex,
              source?.slice(indexSpan.start, indexSpan.end) ?? "",
              indexSpan,
              { kind: "number" },
              (candidate, facts) => ownerIndex === null
                ? resolveSourceScalar(statementIndex, null, candidate.name, null, candidate.span, facts)
                : resolveBodyScalar(statementIndex, ownerIndex, candidate, facts),
              undefined,
              (candidate) => resolveGeometryProperty(statementIndex, ownerIndex, candidate),
              undefined,
              undefined,
              reference.presenceFacts
            );
          })()
        : null;
      const type = pointPath
        ? { kind: "number" as const }
        : numericGeometryPropertySupportedByStaticTarget(
            numericGeometryTargetForSourceStatement(lookup.declaration.statementIndex, ownerIndex, lookup.declaration.statement),
            reference.property
          )
          ? { kind: "number" as const }
          : choiceGeometryPropertyTypeForStatement(lookup.declaration.statement, reference.property);
      if (!sourceTarget || !type || (reference.occurrenceIndex && (!indexSemantic || indexSemantic.type?.kind !== "number"))) return unknownProperty();
      return {
        target: {
          kind: "forGroupOccurrenceProperty",
          statementId: sourceTarget.statementId,
          statementIndex: sourceTarget.statementIndex,
          category: sourceTarget.category,
          property: resolvedProperty,
          index: indexSemantic,
          ...(reference.occurrenceIndexSpan ? { occurrenceIndexSpan: reference.occurrenceIndexSpan } : {}),
          ...(reference.occurrenceRange ? { occurrenceRange: reference.occurrenceRange } : {}),
          ...(resolvedPointKey ? { pointKey: resolvedPointKey } : {}),
          ...(input.documentId ? { identity: qualifySemanticIdentity(input.documentId, sourceTarget.statementId) } : {})
        },
        type,
        resolution: "resolved"
      };
    }
    if (lookup.declaration.kind === "typedDeclaration" && lookup.declaration.statement.kind === "typedDeclaration" && isDslGeometryValueType(lookup.declaration.statement.valueType)) {
      const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
      if (ownerIndex !== null && declarationOwner !== ownerIndex) {
        return { target: null, type: null, resolution: "outerCapture", diagnostic: issue("module-outer-capture", reference.span, `module body から outer geometry「${reference.elementName}」を暗黙 capture できません。`, { relatedSources: declarationRelated, presentation: { key: "diagnostic.module-outer-capture", parameters: { name: reference.elementName } } }) };
      }
      const value = geometryValuesByStatementIndex.get(lookup.declaration.statementIndex);
      const valueTarget = value
        ? {
            kind: "geometryValue" as const,
            statementId: value.statementId,
            statementIndex: value.statementIndex,
            declaredInterfaceType: value.declaredInterfaceType,
            backingTarget: value.backingTarget,
            ownerModuleDefinitionStatementId: value.ownerModuleDefinitionStatementId,
            ownerModuleDefinitionStatementIndex: value.ownerModuleDefinitionStatementIndex,
            ...(value.identity ? { identity: value.identity } : {})
          }
        : null;
      const propertyTarget = valueTarget
        ? geometryPropertyTargetForSourceTarget(valueTarget, resolvedProperty, resolvedPointKey)
        : null;
      const type = pointPath
        ? { kind: "number" as const }
        : numericGeometryPropertySupportedByStaticTarget(
            numericGeometryStaticTargetForModuleInterface(value?.declaredInterfaceType ?? lookup.declaration.statement.valueType.kind),
            reference.property
          )
        ? { kind: "number" as const }
        : null;
      if (!propertyTarget || !type) return unknownProperty();
      return { target: propertyTarget, type, resolution: "resolved" };
    }
    const geometryTarget = declarationGeometryPropertyTarget(lookup.declaration, stableStatementIdByIndex, reference.property);
    if (!geometryTarget) return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-geometry-property-type-mismatch", reference.span, `「${reference.elementName}」はgeometryではありません。`, { relatedSources: declarationRelated, presentation: { key: "diagnostic.module-geometry-property-type-mismatch", parameters: { target: reference.elementName } } }) };
    const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
    if (ownerIndex !== null && declarationOwner !== ownerIndex) {
      return { target: null, type: null, resolution: "outerCapture", diagnostic: issue("module-outer-capture", reference.span, `module body から outer geometry「${reference.elementName}」を暗黙 capture できません。`, { relatedSources: declarationRelated, presentation: { key: "diagnostic.module-outer-capture", parameters: { name: reference.elementName } } }) };
    }
    const type = numericGeometryPropertySupportedByStaticTarget(
      numericGeometryTargetForSourceStatement(
        lookup.declaration.statementIndex,
        ownerIndex,
        lookup.declaration.statement,
      ),
      reference.property
    )
      ? { kind: "number" as const }
      : choiceGeometryPropertyTypeForStatement(lookup.declaration.statement, reference.property);
    if (!type) return unknownProperty();
    return { target: { ...geometryTarget, kind: "sourceGeometryProperty", property: reference.property }, type, resolution: "resolved" };
  };

  function analyzeRecordConstructorFields(
    statementIndex: number,
    ownerIndex: number | null,
    fields: readonly RecordConstructorFieldSemantic[],
    presenceFacts: ReadonlySet<string>
  ): ModuleRecordConstructorFieldSemantic[] {
    return fields.map((field) => {
      const valueExpression = analyzeRecordFieldValue(statementIndex, ownerIndex, field.expectedType, field.value, field.valueSpan, presenceFacts);
      return {
        ...field,
        expression: valueExpression?.kind === "scalar" ? valueExpression.expression : null,
        valueExpression
      };
    });
  }

  const recordReferenceSemantic = (
    statementIndex: number,
    ownerIndex: number | null,
    raw: string,
    span: DslSpan,
    expectedTypeIdentity: RecordTypeIdentity | null,
    presenceFacts: ReadonlySet<string> = new Set()
  ): ModuleRecordReferenceSemantic => {
    const invalid = (
      resolution: ModuleRecordReferenceSemantic["resolution"],
      message: string,
      diagnosticSpan = span,
      relatedSources: readonly DiagnosticRelatedSource[] = [],
      presentation?: DslDiagnosticPresentation
    ): ModuleRecordReferenceSemantic => {
      addLocal(statementIndex, issue(
        resolution === "forward" ? "module-record-forward-reference" :
          resolution === "ambiguous" ? "module-record-ambiguous-reference" :
            "module-record-reference-invalid",
        diagnosticSpan,
        message,
        { relatedSources, ...(presentation ? { presentation } : {}) }
      ));
      return { source: raw, span, typeIdentity: null, target: null, constructor: null, resolution };
    };
    if (!expectedTypeIdentity) {
      return invalid("invalid", "record Module parameter の nominal type を解決できません。");
    }
    const trimmed = raw.trim();
    const parsedScalar = input.logicalTextByStatementIndex?.get(statementIndex)
      ? parseScalarExpression(input.logicalTextByStatementIndex.get(statementIndex)!, span)
      : parseScalarExpression(trimmed, { start: 0, end: trimmed.length });
    if (parsedScalar.ast?.kind === "collectionIndex") {
      const node = parsedScalar.ast;
      const base = node.name;
      const baseSpan = input.logicalTextByStatementIndex?.get(statementIndex)
        ? node.nameSpan
        : { start: span.start + node.nameSpan.start, end: span.start + node.nameSpan.end };
      const path = parseDslReferenceToken(base);
      const qualified = path.segments.length > 1
        ? resolveQualifiedModuleExport(statementIndex, ownerIndex, base, baseSpan)
        : null;
      const deferredQualified = qualified?.kind === "deferred" ? qualified : null;
      const exported = deferredQualified ? qualifiedCollectionExportFor(deferredQualified) : null;
      const parameter = path.segments.length === 1 && !path.absolute
        ? moduleParameterByName(statements, stableStatementIdByIndex, statementIndex, path.segments[0]!)
        : null;
      const lookup = !deferredQualified && !parameter
        ? (ownerIndex === null
            ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, path) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, base)
            : resolveModuleLexicalPath(statementIndex, ownerIndex, path))
        : null;
      const collectionAnalysis = sourceNamespace.geometryArraySemanticAnalysis;
      const value = lookup?.kind === "resolved" && lookup.declaration.kind === "typedDeclaration"
        ? collectionAnalysis ? collectionValueSemanticForStatement(collectionAnalysis, lookup.declaration.statementIndex) : null
        : null;
      const valueType = exported?.kind === "collection"
        ? exported.valueType
        : parameter
          ? collectionAnalysis?.genericModuleParametersBySlot.get(`${parameter.definitionStatementId}:${parameter.parameterIndex}`)?.valueType ?? null
          : collectionAnalysis ? collectionValueTypeFor(value) : null;
      const element = valueType?.elementType.kind === "record" ? valueType.elementType : null;
      const indexSource = input.logicalTextByStatementIndex?.get(statementIndex) ?? trimmed;
      const indexSemantic = analyzeExpression(
        statementIndex,
        ownerIndex,
        indexSource.slice(node.index.span.start, node.index.span.end),
        node.index.span,
        { kind: "number" },
        (reference, facts) => ownerIndex === null
          ? resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, facts)
          : resolveBodyScalar(statementIndex, ownerIndex, reference, facts),
        undefined,
        (reference) => resolveGeometryProperty(statementIndex, ownerIndex, reference),
        undefined,
        undefined,
        presenceFacts
      );
      if (parameter && parameter.parameter.optional && !presenceFacts.has(moduleParameterPresenceKey(parameter.definitionStatementId, parameter.parameterIndex))) {
        return invalid("invalid", `optional module parameter「${base}」は hasValue(@${base}) で存在を確認してから参照してください。`, baseSpan, [], { key: "diagnostic.module-optional-value-required", parameters: { name: base } });
      }
      if (!collectionAnalysis || !element || element.identity !== expectedTypeIdentity || !indexSemantic || indexSemantic.type?.kind !== "number") {
        return invalid("invalid", `collection「${base}」の element 型が expected record 型と一致しません。`, baseSpan, [], { key: "diagnostic.module-record-invalid-reference", parameters: { name: base } });
      }
      const recordMembersFor = (valueId: string, seen: ReadonlySet<string> = new Set()): readonly Extract<ModuleRecordSourceTarget, { kind: "recordValue" }>[] => {
        if (seen.has(valueId)) return [];
        const value = collectionAnalysis.genericValuesByStatementId.get(valueId);
        if (!value?.value) return [];
        if (value.value.kind === "alias") return recordMembersFor(value.value.targetValueId, new Set([...seen, valueId]));
        if (value.value.kind === "map") return [];
        if (value.value.kind === "if") {
          return [
            ...recordMembersForValue(value.value.thenValue, new Set([...seen, valueId])),
            ...recordMembersForValue(value.value.elseValue, new Set([...seen, valueId]))
          ];
        }
        if (value.value.kind === "match") {
          return value.value.arms.flatMap((arm) => recordMembersForValue(arm.value, new Set([...seen, valueId])));
        }
        return recordMembersForValue(value.value, new Set([...seen, valueId]));
      };
      const recordMembersForValue = (
        value: DslArraySemanticValue<GenericArraySourceTarget>,
        seen: ReadonlySet<string>
      ): readonly Extract<ModuleRecordSourceTarget, { kind: "recordValue" }>[] => {
        if (value.kind === "alias") return recordMembersFor(value.targetValueId, seen);
        if (value.kind === "if") {
          return [
            ...recordMembersForValue(value.thenValue, seen),
            ...recordMembersForValue(value.elseValue, seen)
          ];
        }
        if (value.kind === "match") return value.arms.flatMap((arm) => recordMembersForValue(arm.value, seen));
        if (value.kind !== "literal") return [];
        return value.members.flatMap((member) => {
          if (member.target.kind !== "recordValue") return [];
          const recordValue = recordAnalysis?.valuesByStatementId.get(member.target.statementId);
          return recordValue?.typeIdentity
            ? [{
                kind: "recordValue" as const,
                statementId: member.target.statementId,
                statementIndex: member.target.statementIndex,
                typeIdentity: recordValue.typeIdentity
              }]
            : [];
        });
      };
      const exportedValueId = exported?.kind === "collection" ? exported.exportedStatementId : "";
      const members = recordMembersFor(value?.statementId ?? exportedValueId);
      const collectionTarget: ModuleScalarSourceTarget = exported?.kind === "collection"
        ? {
            kind: "deferredModuleCollectionExport",
            instanceStatementId: deferredQualified!.instance.statementId,
            instanceStatementIndex: deferredQualified!.instance.statementIndex,
            instanceName: deferredQualified!.instanceName,
            exportName: deferredQualified!.exportName,
            exportedStatementId: exported.exportedStatementId,
            exportedStatementIndex: exported.exportedStatementIndex,
            valueType: exported.valueType,
            referenceSpan: span,
            instanceSpan: deferredQualified!.instanceSpan,
            memberSpan: deferredQualified!.memberSpan
          }
        : parameter
          ? {
              kind: "collectionParameter",
              definitionStatementId: parameter.definitionStatementId,
              parameterIndex: parameter.parameterIndex,
              valueType: valueType!,
              optional: parameter.parameter.optional
            }
          : {
              kind: "collectionValue",
              statementId: value!.statementId,
              statementIndex: value!.statementIndex,
              valueType: valueType!
            };
      return {
        source: raw,
        span,
        typeIdentity: expectedTypeIdentity,
        target: {
          kind: "recordCollectionIndex",
          collectionValueId: exported?.kind === "collection"
            ? geometryArrayDeferredModuleExportId(deferredQualified!.instance.statementId, deferredQualified!.exportName)
            : parameter
              ? `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`
              : value!.statementId,
          collectionLength: parameter || exported ? null : collectionLengthForValueId(collectionAnalysis, value!.statementId),
          targetSourceOrder: parameter ? -1 : exported ? deferredQualified!.instance.statementIndex : value!.statementIndex,
          typeIdentity: expectedTypeIdentity,
          index: indexSemantic,
          collectionTarget,
          source: `@${base}`,
          referenceSpan: span,
          nameSpan: baseSpan,
          ...(members.length > 0 ? { members } : {})
        },
        constructor: null,
        resolution: "resolved"
      };
    }
    const parsed = parseDslSourceReference(trimmed);
    if (parsed.kind === "valid" && parsed.reference.property === null) {
      const baseSpan = {
        start: span.start + parsed.reference.pathRange.start,
        end: span.start + parsed.reference.pathRange.end
      };
      const resolved = recordSourceLookup(statementIndex, ownerIndex, parsed.reference.pathText, baseSpan);
      if (resolved.kind === "record") {
        if (resolved.typeIdentity !== expectedTypeIdentity) {
          return invalid(
            "invalid",
            `record 値「${parsed.reference.pathText}」の nominal record 型が expected type と一致しません。`,
            baseSpan,
            resolved.target.kind === "recordValue"
              ? relatedAt(resolved.target.statementIndex, statements[resolved.target.statementIndex]?.nameSpan, "Related record value", { key: "diagnostic.related.record-value" })
              : [],
            { key: "diagnostic.module-record-invalid-reference", parameters: { name: parsed.reference.pathText } }
            );
        }
        const resolvedRecordParameter = resolved.target.kind === "recordParameter" ? resolved.target : null;
        if (
          resolvedRecordParameter &&
          stateByIndex.get(
            definitionStates.find((candidate) => candidate.statementId === resolvedRecordParameter.definitionStatementId)?.statementIndex ?? -1
          )?.parameters[resolvedRecordParameter.parameterIndex]?.optional === true &&
          !presenceFacts.has(moduleParameterPresenceKey(resolvedRecordParameter.definitionStatementId, resolvedRecordParameter.parameterIndex))
        ) {
          return invalid(
            "invalid",
            `optional module parameter「${parsed.reference.pathText}」は hasValue(@${parsed.reference.pathText}) で存在を確認してから参照してください。`,
            baseSpan,
            [],
            { key: "diagnostic.module-optional-value-required", parameters: { name: parsed.reference.pathText } }
          );
        }
        return {
          source: raw,
          span,
          typeIdentity: resolved.typeIdentity,
          target: resolved.target,
          constructor: null,
          resolution: "resolved",
          ...(resolved.target.kind === "recordValue"
            ? recordAnalysis?.valuesByStatementId.get(resolved.target.statementId)?.declaredValueType
              ? { valueType: recordAnalysis.valuesByStatementId.get(resolved.target.statementId)!.declaredValueType }
              : {}
            : {})
        };
      }
      if (resolved.kind === "blocked") {
        if (resolved.diagnostic) addLocal(statementIndex, { ...resolved.diagnostic, span: baseSpan });
        return { source: raw, span, typeIdentity: null, target: null, constructor: null, resolution: resolved.resolution };
      }
    }

    const expectedDefinition = recordDefinitionFor(expectedTypeIdentity);
    if (!expectedDefinition) return invalid("invalid", "record Module parameter の definition を解決できません。");
    const constructor = parseRecordConstructorFields({ initializer: raw, initializerSpan: span, definition: expectedDefinition });
    if (!constructor) {
      return invalid("invalid", "record argument には同型 record の `@name` または `RecordName(field: value, ...)` を指定してください。");
    }
    for (const constructorIssue of constructor.issues) addLocal(statementIndex, constructorIssue);
    const targetLookup = sourceDeclarationResolution(sourceNamespace, statementIndex, constructor.name);
    const targetDefinition = targetLookup.kind === "resolved" && targetLookup.declaration.kind === "recordDefinition"
      ? recordAnalysis!.definitionsByStatementIndex.get(targetLookup.declaration.statementIndex)
      : undefined;
    if (!targetDefinition) {
      return invalid("invalid", `record constructor「${constructor.name}」は expected record definition ではありません。`, constructor.nameSpan, [], { key: "diagnostic.module-record-invalid-reference", parameters: { name: constructor.name } });
    }
    if (targetDefinition.statementId !== expectedTypeIdentity) {
      return invalid("invalid", `constructor「${constructor.name}」の nominal record 型が expected type と一致しません。`, constructor.nameSpan, [], { key: "diagnostic.module-record-invalid-reference", parameters: { name: constructor.name } });
    }
    const fields = analyzeRecordConstructorFields(statementIndex, ownerIndex, constructor.fields, presenceFacts);
    return {
      source: raw,
      span,
      typeIdentity: expectedTypeIdentity,
      target: null,
      constructor: {
        name: constructor.name,
        nameSpan: constructor.nameSpan,
        targetTypeIdentity: targetDefinition.statementId,
        fields
      },
      resolution: constructor.issues.length === 0 ? "resolved" : "invalid"
    };
  };

  const arrayValueReferenceForRecordField = (
    statementIndex: number,
    ownerIndex: number | null,
    sourceText: string,
    sourceSpan: DslSpan
  ): { targetValueId: string; valueType: import("./dslValueTypes").DslArrayValueType } | null => {
    const parsed = parseDslSourceReference(sourceText.trim());
    if (parsed.kind !== "valid" || parsed.reference.property !== null) return null;
    const path = parsed.reference.path;
    const qualified = path.segments.length > 1
      ? resolveQualifiedModuleExport(statementIndex, ownerIndex, parsed.reference.pathText, sourceSpan)
      : null;
    const deferred = qualified?.kind === "deferred" ? qualified : null;
    const exported = deferred ? qualifiedCollectionExportFor(deferred) : null;
    if (exported?.kind === "collection") {
      return {
        targetValueId: geometryArrayDeferredModuleExportId(deferred!.instance.statementId, deferred!.exportName),
        valueType: exported.valueType
      };
    }
    if (path.segments.length === 1 && !path.absolute) {
      const parameter = moduleParameterByName(statements, stableStatementIdByIndex, statementIndex, path.segments[0]!);
      const parameterValue = parameter
        ? sourceNamespace.geometryArraySemanticAnalysis?.genericModuleParametersBySlot.get(`${parameter.definitionStatementId}:${parameter.parameterIndex}`)?.valueType
        : null;
      if (parameter && parameterValue) {
        return {
          targetValueId: `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`,
          valueType: parameterValue
        };
      }
    }
    const lookup = ownerIndex === null
      ? qualifiedSourceDeclarationResolution(sourceNamespace, statementIndex, path) ?? sourceDeclarationResolution(sourceNamespace, statementIndex, parsed.reference.pathText)
      : resolveModuleLexicalPath(statementIndex, ownerIndex, path);
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "typedDeclaration") return null;
    const value = sourceNamespace.geometryArraySemanticAnalysis
      ? collectionValueSemanticForStatement(sourceNamespace.geometryArraySemanticAnalysis, lookup.declaration.statementIndex)
      : null;
    if (!value || !("valueType" in value)) return null;
    return { targetValueId: value.statementId, valueType: value.valueType };
  };

  function analyzeRecordFieldValue(
    statementIndex: number,
    ownerIndex: number | null,
    expectedType: import("./dslValueTypes").DslValueType,
    rawValue: string,
    valueSpan: DslSpan,
    presenceFacts: ReadonlySet<string>
  ): ModuleRecordFieldValueExpressionSemantic | null {
    const scalarType = scalarExpressionTypeOfDslValueType(expectedType);
    const requiredExpectedType = dslRequiredValueTypeOf(expectedType) ?? expectedType;
    if (scalarType) {
      const previousSuppressLocalDiagnostics = suppressLocalDiagnostics;
      if (suppressScalarRecordFieldDiagnostics) suppressLocalDiagnostics = true;
      const expression = analyzeExpression(
          statementIndex,
          ownerIndex,
          rawValue,
          valueSpan,
          scalarType,
          (reference, facts) => ownerIndex === null
            ? resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, facts)
            : resolveBodyScalar(statementIndex, ownerIndex, reference, facts),
          undefined,
          (reference) => resolveGeometryProperty(statementIndex, ownerIndex, reference),
          (reference) => resolveGeometry(
            statementIndex,
            ownerIndex,
            reference.name.startsWith("@") ? reference.name : `@${reference.name}`,
            reference.span,
            reference.expectedGeometryType,
            {
              expectedInterfaceType: reference.expectedGeometryType,
              role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference",
              presenceFacts
            }
          ),
          (reference) => resolveHasValue(statementIndex, ownerIndex, reference),
          presenceFacts
        );
      suppressLocalDiagnostics = previousSuppressLocalDiagnostics;
      return expression ? { kind: "scalar", expression } : null;
    }

    if (isDslGeometryValueType(requiredExpectedType)) {
      const source = input.logicalTextByStatementIndex?.get(statementIndex);
      const parsed = source
        ? parseScalarExpression(source, valueSpan, { allowOpaqueNamedCalls: true })
        : parseScalarExpression(rawValue, { start: 0, end: rawValue.length }, { allowOpaqueNamedCalls: true });
      const geometryType = requiredExpectedType.kind === "point" ? "point" : "line";
      const expectedInterfaceType = requiredExpectedType.kind;
      const geometryExpression = parsed.ast && (parsed.ast.kind === "noneLiteral" || parsed.ast.kind === "valueIf" || parsed.ast.kind === "valueMatch")
        ? parseGeometryValueExpression({
            statementIndex,
            ownerIndex,
            source: source ?? rawValue,
            node: parsed.ast,
            expectedInterfaceType,
            expectedValueType: expectedType,
            analyzeScalar: (raw, span, type) => analyzeExpression(
              statementIndex,
              ownerIndex,
              raw,
              span,
              type,
              (reference, facts) => ownerIndex === null
                ? resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, facts)
                : resolveBodyScalar(statementIndex, ownerIndex, reference, facts),
              undefined,
              (reference) => resolveGeometryProperty(statementIndex, ownerIndex, reference),
              undefined,
              (reference) => resolveHasValue(statementIndex, ownerIndex, reference),
              presenceFacts
            ),
            resolveReference: (raw, span) => resolveGeometry(statementIndex, ownerIndex, raw, span, geometryType, {
              expectedInterfaceType,
              allowCoordinate: false,
              role: geometryType === "point" ? "pointReference" : "lineReference",
              presenceFacts
            }),
            parseConstruction: (raw, span, type) => parseGeometryValueConstruction(statementIndex, ownerIndex, raw, span, type, { presenceFacts }),
            addDiagnostic: (diagnostic) => addLocal(statementIndex, diagnostic)
          })
        : parsed.ast?.kind === "call"
          ? (() => {
              const construction = parseGeometryValueConstruction(statementIndex, ownerIndex, rawValue, valueSpan, expectedInterfaceType, { presenceFacts });
              return construction ? { kind: "construction" as const, span: valueSpan, construction } : null;
            })()
          : (() => {
              const reference = resolveGeometry(
                statementIndex,
                ownerIndex,
                rawValue,
                valueSpan,
                geometryType,
                {
                  expectedInterfaceType,
                  allowCoordinate: false,
                  role: geometryType === "point" ? "pointReference" : "lineReference",
                  presenceFacts
                }
              );
              return reference.resolution === "resolved" ? { kind: "reference" as const, span: valueSpan, reference } : null;
            })();
      return { kind: "geometry", expression: geometryExpression };
    }

    if (isDslRecordValueType(requiredExpectedType)) {
      if (rawValue.trim() === "none") return { kind: "record", expression: { kind: "none", span: valueSpan, valueType: expectedType } };
      const reference = recordReferenceSemantic(
        statementIndex,
        ownerIndex,
        rawValue,
        valueSpan,
        requiredExpectedType.identity ?? null,
        presenceFacts
      );
      if (reference.constructor) return { kind: "record", expression: { kind: "constructor", span: valueSpan, constructor: reference.constructor } };
      return reference.target
        ? { kind: "record", expression: { kind: "reference", span: valueSpan, reference } }
        : { kind: "record", expression: null };
    }

    if (isDslArrayValueType(requiredExpectedType)) {
      const logicalSource = input.logicalTextByStatementIndex?.get(statementIndex);
      const source = logicalSource ?? rawValue;
      const span = logicalSource ? valueSpan : { start: 0, end: rawValue.length };
      const parsed = parseGeometryArrayExpression(source, span);
      for (const diagnostic of parsed.diagnostics) {
        addLocal(statementIndex, issue(diagnostic.code, diagnostic.span, diagnostic.message));
      }
      if (!parsed.expression || parsed.diagnostics.length > 0) return { kind: "collection", valueType: requiredExpectedType, value: null };
      const resolved = resolveDslArrayExpression<GenericArraySourceTarget>({
        expectedType: requiredExpectedType,
        expectedValueType: expectedType,
        expression: parsed.expression,
        resolveArrayReference: (sourceText, sourceSpan) => {
          const target = arrayValueReferenceForRecordField(statementIndex, ownerIndex, sourceText, sourceSpan);
          return target
            ? { kind: "resolved", targetValueId: target.targetValueId, valueType: target.valueType }
            : { kind: "invalid", diagnostic: { code: "array-reference-invalid", message: `未解決の array 参照です: ${sourceText}`, span: sourceSpan } };
        },
        resolveMember: (member) => {
          const elementType = requiredExpectedType.elementType;
          const literal = scanScalarLiteral(member.text, { start: 0, end: member.text.length });
          if (literal.kind !== "error" && literal.span.start === 0 && literal.span.end === member.text.length) {
          if (elementType.kind === "choice" && literal.kind === "choice" && isChoiceOptionMember(elementType, literal.raw)) {
              return { kind: "resolved", value: { elementType, target: { kind: "scalarValue", statementId: `record-field:${valueSpan.start}`, statementIndex } } };
            }
            if (isDslScalarValueType(elementType) && literal.kind === elementType.kind) {
              return { kind: "resolved", value: { elementType, target: { kind: "scalarValue", statementId: `record-field:${valueSpan.start}`, statementIndex } } };
            }
            return { kind: "invalid", diagnostic: { code: "array-member-type-mismatch", message: `array member「${member.text}」の型が宣言型と一致しません。`, span: member.span } };
          }
          if (elementType.kind === "record") {
            const record = recordReferenceSemantic(statementIndex, ownerIndex, member.text, member.span, elementType.identity ?? null, presenceFacts);
            return record.resolution === "resolved" && (record.target || record.constructor)
              ? { kind: "resolved", value: { elementType, target: { kind: "recordValue", statementId: `record-field:${member.span.start}`, statementIndex } } }
              : { kind: "invalid", diagnostic: { code: "array-member-record-mismatch", message: `array member「${member.text}」の nominal record 型が一致しません。`, span: member.span } };
          }
          const parsedReference = parseDslSourceReference(member.text);
          if (parsedReference.kind !== "valid" || parsedReference.reference.property !== null) {
            return { kind: "invalid", diagnostic: { code: "array-invalid-member", message: "array member は immutable value reference で指定してください。", span: member.span } };
          }
          if (isDslGeometryValueType(elementType)) {
            const geometry = resolveGeometry(statementIndex, ownerIndex, member.text, member.span, elementType.kind === "point" ? "point" : "line", {
              expectedInterfaceType: elementType.kind,
              allowCoordinate: false,
              role: elementType.kind === "point" ? "pointReference" : "lineReference",
              presenceFacts
            });
            return geometry.target && geometry.resolution === "resolved"
              ? { kind: "resolved", value: { elementType, target: geometry.target as unknown as GenericArraySourceTarget } }
              : { kind: "invalid", diagnostic: { code: "array-member-geometry-mismatch", message: `array member「${member.text}」の geometry 型が一致しません。`, span: member.span } };
          }
          const scalar = scalarTypeOfDslValueType(elementType);
          if (!scalar) return { kind: "invalid", diagnostic: { code: "array-invalid-member", message: "array member は immutable value reference で指定してください。", span: member.span } };
          const expression = analyzeExpression(
            statementIndex,
            ownerIndex,
            member.text,
            member.span,
            scalar,
            (reference, facts) => ownerIndex === null
              ? resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, facts)
              : resolveBodyScalar(statementIndex, ownerIndex, reference, facts),
            undefined,
            (reference) => resolveGeometryProperty(statementIndex, ownerIndex, reference),
            undefined,
            (reference) => resolveHasValue(statementIndex, ownerIndex, reference),
            presenceFacts
          );
          return expression
            ? { kind: "resolved", value: { elementType, target: { kind: "scalarValue", statementId: `record-field:${member.span.start}`, statementIndex } } }
            : { kind: "invalid", diagnostic: { code: "array-member-type-mismatch", message: `array member「${member.text}」の型が宣言型と一致しません。`, span: member.span } };
        }
      });
      for (const diagnostic of resolved.diagnostics) {
        addLocal(statementIndex, issue(
          diagnostic.code,
          diagnostic.span,
          diagnostic.message,
          { presentation: diagnostic.presentation }
        ));
      }
      return { kind: "collection", valueType: requiredExpectedType, value: resolved.value };
    }
    return null;
  }

  const moduleRecordValueExpressionFor = ({
    statementIndex,
    ownerIndex,
    source,
    expression,
    expectedTypeIdentity,
    presenceFacts
  }: {
    statementIndex: number;
    ownerIndex: number | null;
    source: string;
    expression: RecordValueExpressionSemantic;
    expectedTypeIdentity: RecordTypeIdentity | null;
    presenceFacts: ReadonlySet<string>;
  }): ModuleRecordValueExpressionSemantic | null => {
    const raw = source.slice(expression.span.start, expression.span.end);
    if (expression.kind === "constructor") {
      const reference = recordReferenceSemantic(statementIndex, ownerIndex, raw, expression.span, expectedTypeIdentity, presenceFacts);
      return reference.constructor
        ? { kind: "constructor", span: expression.span, constructor: reference.constructor, valueType: expression.valueType }
        : null;
    }
    if (expression.kind === "reference") {
      const reference = recordReferenceSemantic(statementIndex, ownerIndex, raw, expression.span, expectedTypeIdentity, presenceFacts);
      return reference.target ? { kind: "reference", span: expression.span, reference, valueType: expression.valueType ?? reference.valueType } : null;
    }
    if (expression.kind === "collectionIndex") {
      const reference = recordReferenceSemantic(statementIndex, ownerIndex, raw, expression.span, expectedTypeIdentity, presenceFacts);
      return reference.target?.kind === "recordCollectionIndex"
        ? { kind: "collectionIndex", span: expression.span, reference, valueType: expression.valueType }
        : null;
    }
    if (expression.kind === "none") return { kind: "none", span: expression.span, valueType: expression.valueType };
    if (expression.kind === "coalesce") {
      const left = expression.left ? moduleRecordValueExpressionFor({ statementIndex, ownerIndex, source, expression: expression.left, expectedTypeIdentity, presenceFacts }) : null;
      const right = expression.right ? moduleRecordValueExpressionFor({ statementIndex, ownerIndex, source, expression: expression.right, expectedTypeIdentity, presenceFacts }) : null;
      return { kind: "coalesce", span: expression.span, left, right, valueType: expression.valueType };
    }
    if (expression.kind === "if") {
      const condition = analyzeExpression(
        statementIndex,
        ownerIndex,
        source.slice(expression.condition.span.start, expression.condition.span.end),
        expression.condition.span,
        { kind: "boolean" },
        (reference, facts) => ownerIndex === null
          ? resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, facts)
          : resolveBodyScalar(statementIndex, ownerIndex, reference, facts),
        undefined,
        (reference) => resolveGeometryProperty(statementIndex, ownerIndex, reference),
        undefined,
        (reference) => resolveHasValue(statementIndex, ownerIndex, reference),
        presenceFacts
      );
      const thenPresenceFacts = new Set(presenceFacts);
      const elsePresenceFacts = new Set(presenceFacts);
      if (condition) {
        for (const fact of presenceFactsForSemanticTruth(condition)) thenPresenceFacts.add(fact);
        for (const fact of presenceFactsForSemanticFalse(condition)) elsePresenceFacts.add(fact);
      }
      return {
        kind: "if",
        span: expression.span,
        condition,
        thenBranch: expression.thenBranch
          ? moduleRecordValueExpressionFor({ statementIndex, ownerIndex, source, expression: expression.thenBranch, expectedTypeIdentity, presenceFacts: thenPresenceFacts })
          : null,
        elseBranch: expression.elseBranch
          ? moduleRecordValueExpressionFor({ statementIndex, ownerIndex, source, expression: expression.elseBranch, expectedTypeIdentity, presenceFacts: elsePresenceFacts })
          : null
      };
    }
    const scrutinee = analyzeExpression(
      statementIndex,
      ownerIndex,
      source.slice(expression.scrutinee.span.start, expression.scrutinee.span.end),
      expression.scrutinee.span,
      null,
      (reference, facts) => ownerIndex === null
        ? resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, facts)
        : resolveBodyScalar(statementIndex, ownerIndex, reference, facts),
      undefined,
      (reference) => resolveGeometryProperty(statementIndex, ownerIndex, reference),
      undefined,
      (reference) => resolveHasValue(statementIndex, ownerIndex, reference),
      presenceFacts
    );
    if (scrutinee) {
      if (scrutinee.type?.kind === "optional") {
        validateOptionalMatchExhaustiveness({
          scrutineeType: scrutinee.type,
          scrutineeSpan: expression.scrutinee.span,
          matchSpan: expression.span,
          arms: expression.arms,
          addDiagnostic: (diagnostic) => addLocal(statementIndex, diagnostic)
        });
      } else {
        validateChoiceMatchExhaustiveness({
          scrutineeType: scrutinee.type,
          scrutineeSpan: expression.scrutinee.span,
          matchSpan: expression.span,
          arms: expression.arms,
          addDiagnostic: (diagnostic) => addLocal(statementIndex, diagnostic)
        });
      }
    }
    return {
      kind: "match",
      span: expression.span,
      scrutinee,
      arms: expression.arms.map((arm) => ({
        label: arm.label,
        labelSpan: arm.labelSpan,
        binder: arm.binder,
        binderSpan: arm.binderSpan,
        expression: arm.expression
          ? moduleRecordValueExpressionFor({ statementIndex, ownerIndex, source, expression: arm.expression, expectedTypeIdentity, presenceFacts })
          : null
      }))
    };
  };

  const scalarRecordFieldPathsFor = (
    definition: RecordDefinitionSemantic,
    prefix: readonly RecordFieldIdentity[] = []
  ): readonly { field: RecordFieldSemantic; path: readonly RecordFieldIdentity[]; type: ScalarType }[] => definition.fields.flatMap((field) => {
    const path = [...prefix, field.identity];
    const type = scalarTypeOfDslValueType(field.type);
    if (type) return [{ field, path, type }];
    if (field.type.kind !== "record") return [];
    const nested = recordDefinitionFor(field.type.identity ?? null);
    return nested ? scalarRecordFieldPathsFor(nested, path) : [];
  });

  const moduleRecordFieldExpressionFor = (
    expression: ModuleRecordValueExpressionSemantic,
    field: { identity: RecordFieldIdentity; name: string; type: ScalarType; fieldPath?: readonly RecordFieldIdentity[] }
  ): ModuleScalarExpressionSemantic | null => {
    const fieldPath = field.fieldPath ?? [field.identity];
    const constructorFieldAtPath = (
      fields: readonly ModuleRecordConstructorFieldSemantic[],
      path: readonly RecordFieldIdentity[]
    ): ModuleRecordConstructorFieldSemantic | null => {
      let currentFields = fields;
      for (const [index, identity] of path.entries()) {
        const current = currentFields.find((candidate) => candidate.field.fieldIndex === identity.fieldIndex);
        if (!current) return null;
        if (index === path.length - 1) return current;
        if (current.valueExpression?.kind !== "record" || !current.valueExpression.expression) return null;
        const nested = current.valueExpression.expression;
        if (nested.kind !== "constructor") return null;
        currentFields = nested.constructor.fields;
      }
      return null;
    };
    if (expression.kind === "constructor") {
      return constructorFieldAtPath(expression.constructor.fields, fieldPath)?.expression ?? null;
    }
    if (expression.kind === "reference" || expression.kind === "collectionIndex") {
      const reference = expression.reference;
      if (!reference.target) return null;
      if (reference.target.kind === "recordCollectionIndex" && !reference.target.members) {
        const collectionValueId = `record-field-collection:${JSON.stringify(
          fieldPath.length === 1
            ? [reference.target.collectionValueId, field.identity.recordStatementId, field.identity.fieldIndex]
            : [reference.target.collectionValueId, "path", fieldPath.map((candidate) => [candidate.recordStatementId, candidate.fieldIndex])]
        )}`;
        const baseName = reference.source.trim().replace(/^@/, "");
        return {
          ast: {
            kind: "collectionIndex",
            span: reference.span,
            nameSpan: reference.span,
            name: baseName,
            index: reference.target.index.ast
          },
          type: field.type,
          references: [{
            name: baseName,
            nameSpan: reference.span,
            span: reference.span,
            target: null,
            resolution: "resolved",
            collectionValueId,
            collectionLength: reference.target.collectionLength,
            targetSourceOrder: reference.target.targetSourceOrder,
            collectionElementType: field.type
          }],
          geometryProperties: [],
          geometryBuiltinArguments: [],
          hasValueParameters: []
        };
      }
      const baseName = reference.source.trim().replace(/^@/, "");
      const target: ModuleRecordFieldSourceTarget = {
        kind: "recordField",
        record: reference.target,
        field: field.identity,
        fieldName: field.name,
        valueType: field.type,
        type: field.type,
        ...(fieldPath.length > 1 ? { fieldPath } : {})
      };
      return {
        ast: {
          kind: "geometryProperty",
          span: reference.span,
          elementNameSpan: reference.span,
          propertySpan: reference.span,
          elementName: baseName,
          property: field.name
        },
        type: field.type,
        references: [{
            name: `${baseName}.${field.name}`,
          nameSpan: reference.span,
          span: reference.span,
          target,
          resolution: "resolved"
        }],
        geometryProperties: [{
          geometryName: baseName,
          property: field.name,
          elementNameSpan: reference.span,
          propertySpan: reference.span,
          span: reference.span,
          target,
          type: field.type,
          resolution: "resolved"
        }],
        geometryBuiltinArguments: [],
        hasValueParameters: []
      };
    }
    if (expression.kind === "if") {
      const thenBranch = expression.thenBranch ? moduleRecordFieldExpressionFor(expression.thenBranch, field) : null;
      const elseBranch = expression.elseBranch ? moduleRecordFieldExpressionFor(expression.elseBranch, field) : null;
      return expression.condition && thenBranch && elseBranch
        ? {
            ast: {
              kind: "valueIf",
              span: expression.span,
              condition: expression.condition.ast,
              thenBranch: thenBranch.ast,
              elseBranch: elseBranch.ast
            },
            type: field.type,
            references: [expression.condition.references, thenBranch.references, elseBranch.references].flat(),
            geometryProperties: [expression.condition.geometryProperties, thenBranch.geometryProperties, elseBranch.geometryProperties].flat(),
            geometryBuiltinArguments: [expression.condition.geometryBuiltinArguments, thenBranch.geometryBuiltinArguments, elseBranch.geometryBuiltinArguments].flat(),
            hasValueParameters: [expression.condition.hasValueParameters, thenBranch.hasValueParameters, elseBranch.hasValueParameters].flat()
          }
        : null;
    }
    if (expression.kind === "none" || expression.kind === "coalesce") return null;
    const arms = expression.arms.map((arm) => ({
      label: arm.label,
      labelSpan: arm.labelSpan,
      expression: arm.expression ? moduleRecordFieldExpressionFor(arm.expression, field) : null
    }));
    return expression.scrutinee && arms.every((arm) => arm.expression)
      ? {
          ast: {
            kind: "valueMatch",
            span: expression.span,
            scrutinee: expression.scrutinee.ast,
            arms: arms.map((arm) => ({
              label: arm.label,
              labelSpan: arm.labelSpan,
              expression: arm.expression!.ast
            }))
          },
          type: field.type,
          references: [expression.scrutinee.references, ...arms.map((arm) => arm.expression!.references)].flat(),
          geometryProperties: [expression.scrutinee.geometryProperties, ...arms.map((arm) => arm.expression!.geometryProperties)].flat(),
          geometryBuiltinArguments: [expression.scrutinee.geometryBuiltinArguments, ...arms.map((arm) => arm.expression!.geometryBuiltinArguments)].flat(),
          hasValueParameters: [expression.scrutinee.hasValueParameters, ...arms.map((arm) => arm.expression!.hasValueParameters)].flat()
        }
      : null;
  };

  const moduleRecordValueExpressionFromAst = ({
    statementIndex,
    ownerIndex,
    source,
    ast,
    expectedTypeIdentity,
    presenceFacts
  }: {
    statementIndex: number;
    ownerIndex: number | null;
    source: string;
    ast: ScalarExpressionAst;
    expectedTypeIdentity: RecordTypeIdentity;
    presenceFacts: ReadonlySet<string>;
  }): ModuleRecordValueExpressionSemantic | null => {
    const requiredRecordType: DslValueType = {
      kind: "record",
      name: recordDefinitionFor(expectedTypeIdentity)?.name ?? expectedTypeIdentity,
      identity: expectedTypeIdentity
    };
    if (ast.kind === "noneLiteral") {
      return { kind: "none", span: ast.span, valueType: { kind: "optional", valueType: requiredRecordType } };
    }
    if (ast.kind === "binary" && ast.operator === "??") {
      const left = moduleRecordValueExpressionFromAst({
        statementIndex,
        ownerIndex,
        source,
        ast: ast.left,
        expectedTypeIdentity,
        presenceFacts
      });
      const right = moduleRecordValueExpressionFromAst({
        statementIndex,
        ownerIndex,
        source,
        ast: ast.right,
        expectedTypeIdentity,
        presenceFacts
      });
      const leftType = left?.valueType ?? (left?.kind === "reference" ? left.reference.valueType : undefined);
      const rightType = right?.valueType ?? (right?.kind === "reference" ? right.reference.valueType : undefined);
      const resultType = dslCoalesceResultType(leftType, rightType);
      if (!resultType) {
        addLocal(statementIndex, issue(
          "coalesce-type-mismatch",
          ast.span,
          "?? の record operands は optional な同一 nominal record 型と、その underlying record 型である必要があります。",
          { presentation: { key: "diagnostic.coalesce-type-mismatch" } }
        ));
        return null;
      }
      return { kind: "coalesce", span: ast.span, left, right, valueType: resultType };
    }
    if (ast.kind === "valueIf") {
      const condition = analyzeExpression(
        statementIndex,
        ownerIndex,
        source.slice(ast.condition.span.start, ast.condition.span.end),
        ast.condition.span,
        { kind: "boolean" },
        (reference, facts) => ownerIndex === null
          ? resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, facts)
          : resolveBodyScalar(statementIndex, ownerIndex, reference, facts),
        undefined,
        (reference) => resolveGeometryProperty(statementIndex, ownerIndex, reference),
        undefined,
        (reference) => resolveHasValue(statementIndex, ownerIndex, reference),
        presenceFacts
      );
      const thenPresenceFacts = new Set(presenceFacts);
      const elsePresenceFacts = new Set(presenceFacts);
      if (condition) {
        for (const fact of presenceFactsForSemanticTruth(condition)) thenPresenceFacts.add(fact);
        for (const fact of presenceFactsForSemanticFalse(condition)) elsePresenceFacts.add(fact);
      }
      return {
        kind: "if",
        span: ast.span,
        condition,
        thenBranch: moduleRecordValueExpressionFromAst({
          statementIndex,
          ownerIndex,
          source,
          ast: ast.thenBranch,
          expectedTypeIdentity,
          presenceFacts: thenPresenceFacts
        }),
        elseBranch: ast.elseBranch ? moduleRecordValueExpressionFromAst({
          statementIndex,
          ownerIndex,
          source,
          ast: ast.elseBranch,
          expectedTypeIdentity,
          presenceFacts: elsePresenceFacts
        }) : { kind: "none", span: { start: ast.span.end, end: ast.span.end } }
      };
    }
    if (ast.kind === "valueMatch") {
      const scrutinee = analyzeExpression(
        statementIndex,
        ownerIndex,
        source.slice(ast.scrutinee.span.start, ast.scrutinee.span.end),
        ast.scrutinee.span,
        null,
        (reference, facts) => ownerIndex === null
          ? resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, facts)
          : resolveBodyScalar(statementIndex, ownerIndex, reference, facts),
        undefined,
        (reference) => resolveGeometryProperty(statementIndex, ownerIndex, reference),
        undefined,
        (reference) => resolveHasValue(statementIndex, ownerIndex, reference),
        presenceFacts
      );
      if (scrutinee) {
        if (scrutinee.type?.kind === "optional") {
          validateOptionalMatchExhaustiveness({
            scrutineeType: scrutinee.type,
            scrutineeSpan: ast.scrutinee.span,
            matchSpan: ast.span,
            arms: ast.arms,
            addDiagnostic: (diagnostic) => addLocal(statementIndex, diagnostic)
          });
        } else {
          validateChoiceMatchExhaustiveness({
            scrutineeType: scrutinee.type,
            scrutineeSpan: ast.scrutinee.span,
            matchSpan: ast.span,
            arms: ast.arms,
            addDiagnostic: (diagnostic) => addLocal(statementIndex, diagnostic)
          });
        }
      }
      return {
        kind: "match",
        span: ast.span,
        scrutinee,
        arms: ast.arms.map((arm) => ({
          label: arm.label,
          labelSpan: arm.labelSpan,
          binder: arm.binder,
          binderSpan: arm.binderSpan,
          expression: moduleRecordValueExpressionFromAst({
            statementIndex,
            ownerIndex,
            source,
            ast: arm.expression,
            expectedTypeIdentity,
            presenceFacts
          })
        }))
      };
    }
    const raw = source.slice(ast.span.start, ast.span.end);
    const reference = recordReferenceSemantic(statementIndex, ownerIndex, raw, ast.span, expectedTypeIdentity, presenceFacts);
    if (ast.kind === "collectionIndex") {
      return reference.target?.kind === "recordCollectionIndex"
        ? { kind: "collectionIndex", span: ast.span, reference }
        : null;
    }
    if (reference.constructor) return { kind: "constructor", span: ast.span, constructor: reference.constructor, valueType: requiredRecordType };
    return reference.target ? { kind: "reference", span: ast.span, reference, valueType: reference.valueType ?? requiredRecordType } : null;
  };

  const moduleRecordCollectionBodyFor = ({
    value,
    mapped,
    statement,
    ownerIndex
  }: {
    value: { statementId: string; statementIndex: number };
    mapped: DslArrayMappedValue;
    statement: Extract<DslStatement, { kind: "typedDeclaration" }>;
    ownerIndex: number | null;
  }): NonNullable<ModuleDefinitionSemantic["mappedRecordCollectionBodies"]>[number] | null => {
    if (mapped.sourceElementType.kind !== "record" || mapped.resultElementType.kind !== "record") return null;
    const sourceTypeIdentity = mapped.sourceElementType.identity;
    const resultTypeIdentity = mapped.resultElementType.identity;
    if (!sourceTypeIdentity || !resultTypeIdentity) return null;
    const sourceDefinition = recordDefinitionFor(sourceTypeIdentity);
    const resultDefinition = recordDefinitionFor(resultTypeIdentity);
    const initializerSpan = statement.payloadSpans.initializer;
    if (!sourceDefinition || !resultDefinition || !initializerSpan) return null;
    const source = `${" ".repeat(initializerSpan.start)}${statement.initializer}`;
    const parsed = parseScalarExpression(source, mapped.bodySpan, { allowOpaqueNamedCalls: true });
    for (const parserDiagnostic of parsed.diagnostics) {
      addLocal(value.statementIndex, parserDiagnostic);
    }
    if (!parsed.ast) return null;
    const binder: Extract<ModuleRecordSourceTarget, { kind: "recordValueForBinder" }> = {
      kind: "recordValueForBinder",
      binderId: mapped.binderId,
      statementId: value.statementId,
      statementIndex: value.statementIndex,
      name: mapped.binder,
      typeIdentity: sourceTypeIdentity
    };
    const previousBinder = activeRecordValueBinder;
    activeRecordValueBinder = binder;
    try {
      const expression = moduleRecordValueExpressionFromAst({
        statementIndex: value.statementIndex,
        ownerIndex,
        source,
        ast: parsed.ast,
        expectedTypeIdentity: resultTypeIdentity,
        presenceFacts: new Set()
      });
      if (!expression) return null;
      const fields = scalarRecordFieldPathsFor(resultDefinition).map(({ field, path: fieldPath, type }) => ({
        field: field.identity,
        fieldName: field.name,
        type,
        fieldPath,
        body: moduleRecordFieldExpressionFor(expression, { ...field, type, fieldPath })
      }));
      if (fields.some((field) => !field.body)) return null;
      const fieldsWithBodies = fields.map((field) => ({ ...field, body: field.body! }));
      return {
        statementId: value.statementId,
        statementIndex: value.statementIndex,
        binderId: mapped.binderId,
        sourceTypeIdentity,
        resultTypeIdentity,
        binderFields: scalarRecordFieldPathsFor(sourceDefinition).map(({ field, path: fieldPath, type }) => ({
          field: field.identity,
          fieldName: field.name,
          type,
          fieldPath
        })),
        fields: fieldsWithBodies
      };
    } finally {
      activeRecordValueBinder = previousBinder;
    }
  };

  const resolvePlainScalarTarget = (statementIndex: number, ownerIndex: number | null, name: string): ReferenceResolution => {
    const resolution = resolveSourceScalar(statementIndex, ownerIndex, name, ownerIndex);
    if (resolution.diagnostic && resolution.diagnostic.span.start === 0 && resolution.diagnostic.span.end === 0) {
      return { ...resolution, diagnostic: { ...resolution.diagnostic, span: statements[statementIndex].nameSpan ?? statements[statementIndex].keywordSpan } };
    }
    return resolution;
  };

  // Root elements normally use the ordinary document NameIndex. Keep the
  // source-only result of the same resolver here as an editor projection too;
  // ordinary references suppress diagnostics because their existing compiler
  // owns validation, while qualified module exports retain this pass's
  // established diagnostic behavior.
  const rootGeometryReferencesByStatementId = new Map<StatementIdentity, ModuleGeometryReferenceSite[]>();
  const rootGeometryValueScalarSites = new Map<StatementIdentity, ModuleScalarExpressionSite>();
  const rootParentReferencesByStatementId = new Map<StatementIdentity, ModuleParentReferenceSite>();
  const rootRecordValuesByStatementId = new Map<StatementIdentity, ModuleRecordValueSemantic>();
  const rootMappedRecordCollectionBodies: ModuleSemanticAnalysis["mappedRecordCollectionBodies"][number][] = [];
  for (const value of recordAnalysis?.valuesByStatementId.values() ?? []) {
    if (moduleOwnerIndexOf(statements, value.statementIndex) !== null || !value.typeIdentity) continue;
    const statement = statements[value.statementIndex];
    const initializerSpan = statement?.kind === "typedDeclaration" ? statement.payloadSpans.initializer : undefined;
    if (!initializerSpan || statement?.kind !== "typedDeclaration") continue;
    const source = input.logicalTextByStatementIndex?.get(value.statementIndex) ?? `${" ".repeat(initializerSpan.start)}${statement.initializer}`;
    const definition = recordDefinitionFor(value.typeIdentity);
    const hasGeneralizedFields = Boolean(definition?.fields.some((field) => scalarTypeOfDslValueType(field.type) === null));
    const previous: boolean = suppressLocalDiagnostics;
    const previousSuppressScalarRecordFieldDiagnostics: boolean = suppressScalarRecordFieldDiagnostics;
    suppressLocalDiagnostics = !hasGeneralizedFields;
    suppressScalarRecordFieldDiagnostics = hasGeneralizedFields;
    let valueExpression: ModuleRecordValueExpressionSemantic | null = null;
    try {
      if (value.valueExpression) {
        valueExpression = moduleRecordValueExpressionFor({
          statementIndex: value.statementIndex,
          ownerIndex: null,
          source,
          expression: value.valueExpression,
          expectedTypeIdentity: value.typeIdentity,
          presenceFacts: new Set()
        });
      } else if (value.constructor) {
        const reference = recordReferenceSemantic(value.statementIndex, null, statement.initializer, initializerSpan, value.typeIdentity, new Set());
        valueExpression = reference.constructor
          ? { kind: "constructor", span: initializerSpan, constructor: reference.constructor }
          : null;
      } else if (value.reference) {
        const reference = recordReferenceSemantic(value.statementIndex, null, `@${value.reference.name}`, value.reference.span, value.typeIdentity, new Set());
        valueExpression = reference.target
          ? { kind: "reference", span: value.reference.span, reference }
          : null;
      }
    } finally {
      suppressLocalDiagnostics = previous;
      suppressScalarRecordFieldDiagnostics = previousSuppressScalarRecordFieldDiagnostics;
    }
    if (!valueExpression || !definition) continue;
    const fieldExpressions = definition.fields.map((field) => ({
      field: field.identity,
      expression: scalarTypeOfDslValueType(field.type)
        ? moduleRecordFieldExpressionFor(valueExpression!, { ...field, type: scalarTypeOfDslValueType(field.type)! })
        : null,
      valueExpression: valueExpression.kind === "constructor"
        ? valueExpression.constructor.fields.find((candidate) => candidate.field.fieldIndex === field.fieldIndex)?.valueExpression ?? null
        : null
    }));
    const target: ModuleRecordSourceTarget = {
      kind: "recordValue",
      statementId: value.statementId,
      statementIndex: value.statementIndex,
      typeIdentity: value.typeIdentity,
      ...(valueExpression.kind === "coalesce" ? { valueExpressionKind: "coalesce" as const } : {})
    };
    rootRecordValuesByStatementId.set(value.statementId, {
      value,
      target,
      fields: valueExpression.kind === "constructor" ? valueExpression.constructor.fields : [],
      valueExpression,
      fieldExpressions,
      presenceParameterKeys: [],
      declaredValueType: value.declaredValueType
    });
  }
  for (const value of sourceNamespace.geometryArraySemanticAnalysis?.genericValues ?? []) {
    if (value.ownerModuleDefinitionStatementIndex !== null || !value.value) continue;
    const mappedValues: DslArrayMappedValue[] = [];
    const collect = (candidate: DslArraySemanticValue<GenericArraySourceTarget>) => {
      if (candidate.kind === "map") {
        mappedValues.push(candidate);
        return;
      }
      if (candidate.kind === "if") {
        collect(candidate.thenValue);
        collect(candidate.elseValue);
        return;
      }
      if (candidate.kind === "match") {
        for (const arm of candidate.arms) collect(arm.value);
      }
    };
    collect(value.value);
    const statement = statements[value.statementIndex];
    if (statement?.kind !== "typedDeclaration") continue;
    for (const mapped of mappedValues) {
      const body = moduleRecordCollectionBodyFor({ value, mapped, statement, ownerIndex: null });
      if (body) rootMappedRecordCollectionBodies.push(body);
    }
  }
  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "typedDeclaration" || moduleOwnerIndexOf(statements, statementIndex) !== null) continue;
    const declaredValueType = statement.valueType;
    if (!declaredValueType) continue;
    const declaredRequiredValueType = dslRequiredValueTypeOf(declaredValueType);
    if (!isDslGeometryValueType(declaredRequiredValueType)) continue;
    const geometryInterfaceType = declaredRequiredValueType.kind as ModuleGeometryInterfaceType;
    const statementId = statementIdAt(stableStatementIdByIndex, statementIndex);
    const initializerSpan = statement.payloadSpans.initializer;
    let initializer: ModuleGeometryReferenceSemantic | null = null;
    let construction: ModuleGeometryConstructionSemantic | null = null;
    let valueExpression: ModuleGeometryValueExpressionSemantic | null = null;
    if (initializerSpan) {
      const logicalSource = input.logicalTextByStatementIndex?.get(statementIndex) ?? statement.initializer;
      const initializerText = logicalSource.slice(initializerSpan.start, initializerSpan.end).trim();
      const dynamicCandidate = /^(?:if\s*\(|match\b)/.test(initializerText) || initializerText.includes("??") || initializerText === "none";
      const parsedExpression = dynamicCandidate
        ? parseScalarExpression(logicalSource, initializerSpan, { allowOpaqueNamedCalls: true })
        : { ast: null, diagnostics: [] };
      if (dynamicCandidate) {
        for (const diagnostic of parsedExpression.diagnostics) {
          addLocal(statementIndex, issue(diagnostic.code, diagnostic.span, diagnostic.message));
        }
      }
      const dynamicExpression = parsedExpression.ast?.kind === "valueIf" || parsedExpression.ast?.kind === "valueMatch" || parsedExpression.ast?.kind === "binary" || parsedExpression.ast?.kind === "noneLiteral"
        ? parsedExpression.ast
        : null;
      const isConstruction = /^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(statement.initializer.trim());
      if (dynamicExpression) {
        if (geometryValueExpressionHasConstruction(dynamicExpression) && geometryValueConstructionControlFlowUnsupported(sourceNamespace.scopeIndex, statementIndex)) {
          addLocal(statementIndex, issue(
            "geometry-value-construction-control-flow-unsupported",
            initializerSpan,
            "control flow 内の geometry construction value はこのSliceでは未対応です。",
            { presentation: { key: "diagnostic.geometry-value-construction-control-flow-unsupported" } }
          ));
        } else {
          valueExpression = parseGeometryValueExpression({
            statementIndex,
            ownerIndex: null,
            source: logicalSource,
            node: dynamicExpression,
            expectedInterfaceType: geometryInterfaceType,
            expectedValueType: declaredValueType,
            analyzeScalar: (raw, span, expectedType) => analyzeExpression(
              statementIndex,
              null,
              raw,
              span,
              expectedType,
              (reference, presenceFacts) => resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, presenceFacts),
              undefined,
              (reference) => resolveGeometryProperty(statementIndex, null, reference),
              (reference) => resolveGeometry(
                statementIndex,
                null,
                reference.name.startsWith("@") ? reference.name : `@${reference.name}`,
                reference.span,
                reference.expectedGeometryType,
                { expectedInterfaceType: reference.expectedGeometryType, role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference" }
              )
            ),
            resolveReference: (raw, span, expressionOptions) => resolveGeometry(
              statementIndex,
              null,
              raw,
              span,
              geometryInterfaceType === "point" ? "point" : "line",
              {
                expectedInterfaceType: geometryInterfaceType,
                expectedValueType: expressionOptions?.expectedValueType,
                requireOptional: expressionOptions?.requireOptional,
                allowCoordinate: false,
                role: geometryInterfaceType === "point" ? "pointReference" : "lineReference"
              }
            ),
            parseConstruction: (raw, span, expectedInterfaceType) => parseGeometryValueConstruction(
              statementIndex,
              null,
              raw,
              span,
              expectedInterfaceType
            ),
            addDiagnostic: (diagnostic) => addLocal(statementIndex, diagnostic)
          });
        }
      } else if (isConstruction) {
        if (geometryValueConstructionControlFlowUnsupported(sourceNamespace.scopeIndex, statementIndex)) {
          addLocal(statementIndex, issue(
            "geometry-value-construction-control-flow-unsupported",
            initializerSpan,
            "control flow 内の geometry construction value はこのSliceでは未対応です。",
            { presentation: { key: "diagnostic.geometry-value-construction-control-flow-unsupported" } }
          ));
        } else {
          construction = parseGeometryValueConstruction(
            statementIndex,
            null,
            statement.initializer,
            initializerSpan,
            geometryInterfaceType
          );
        }
      } else {
        const parsedReference = parseDslSourceReference(statement.initializer.trim());
        const parsedCollectionIndex = parseScalarExpression(`${" ".repeat(initializerSpan.start)}${statement.initializer}`, initializerSpan).ast?.kind === "collectionIndex";
        if (parsedReference.kind !== "valid" && !parsedCollectionIndex) {
        addLocal(statementIndex, issue(
          "geometry-value-reference-required",
          initializerSpan,
          "geometry value の初期化には既存の @geometry reference を指定してください。",
          { presentation: { key: "diagnostic.geometry-value-reference-required" } }
        ));
        } else {
          initializer = resolveGeometry(
            statementIndex,
            null,
            statement.initializer,
            initializerSpan,
            geometryInterfaceType === "point" ? "point" : "line",
            {
              expectedInterfaceType: geometryInterfaceType,
              expectedValueType: declaredValueType,
              allowCoordinate: false,
              role: geometryInterfaceType === "point" ? "pointReference" : "lineReference"
            }
          );
        }
      }
    }
    const value: ModuleGeometryValueSemantic = {
      statementId,
      statementIndex,
      ...(input.documentId ? { identity: qualifySemanticIdentity(input.documentId, statementId) } : {}),
      name: statement.name,
      declaredInterfaceType: geometryInterfaceType,
      declaredValueType,
      ownerModuleDefinitionStatementId: null,
      ownerModuleDefinitionStatementIndex: null,
      exported: Boolean(statement.exported),
      initializer,
      construction,
      valueExpression,
      backingTarget: initializer?.target ?? null
    };
    geometryValuesByStatementIndex.set(statementIndex, value);
    if (initializer && initializerSpan) {
      rootGeometryReferencesByStatementId.set(statementId, [{ parameterKey: null, span: initializerSpan, reference: initializer }]);
    } else if (valueExpression) {
      const sites: ModuleGeometryReferenceSite[] = [];
      const collectConstruction = (constructionValue: ModuleGeometryConstructionSemantic, prefix: string) => {
        const visit = (candidate: unknown, key: string): void => {
          if (candidate === null || typeof candidate !== "object") return;
          if (Array.isArray(candidate)) {
            candidate.forEach((item, index) => visit(item, `${key}:${index}`));
            return;
          }
          if ("expectedGeometryKind" in candidate && "resolution" in candidate && "span" in candidate) {
            sites.push({ parameterKey: `${prefix}:${key}`, span: candidate.span as DslSpan, reference: candidate as ModuleGeometryReferenceSemantic });
            return;
          }
          for (const [childKey, child] of Object.entries(candidate)) {
            if (childKey === "span" || childKey === "kind" || childKey === "source") continue;
            visit(child, key ? `${key}:${childKey}` : childKey);
          }
        };
        for (const [key, candidate] of Object.entries(constructionValue)) {
          if (key === "span" || key === "kind") continue;
          visit(candidate, key);
        }
      };
      const collect = (expression: ModuleGeometryValueExpressionSemantic, prefix: string): void => {
        if (expression.kind === "reference") {
          sites.push({ parameterKey: prefix, span: expression.reference.span, reference: expression.reference });
        } else if (expression.kind === "construction") {
          collectConstruction(expression.construction, prefix);
        } else if (expression.kind === "none") {
          return;
        } else if (expression.kind === "coalesce") {
          collect(expression.left, `${prefix}:left`);
          collect(expression.right, `${prefix}:right`);
        } else if (expression.kind === "if") {
          if (expression.thenBranch) collect(expression.thenBranch, `${prefix}:then`);
          if (expression.elseBranch) collect(expression.elseBranch, `${prefix}:else`);
        } else if (expression.kind === "match") {
          expression.arms.forEach((arm) => {
            if (arm.expression) collect(arm.expression, `${prefix}:case:${arm.label}`);
          });
        }
      };
      collect(valueExpression, "value");
      if (sites.length > 0) rootGeometryReferencesByStatementId.set(statementId, sites);
      const firstScalarExpression = (expression: ModuleGeometryValueExpressionSemantic): ModuleScalarExpressionSemantic | null => {
        if (expression.kind === "if") {
          if (expression.condition) return expression.condition;
          return expression.thenBranch ? firstScalarExpression(expression.thenBranch) : expression.elseBranch ? firstScalarExpression(expression.elseBranch) : null;
        }
        if (expression.kind === "match") {
          if (expression.scrutinee) return expression.scrutinee;
          for (const arm of expression.arms) if (arm.expression) {
            const nested = firstScalarExpression(arm.expression);
            if (nested) return nested;
          }
        }
        if (expression.kind === "coalesce") {
          return firstScalarExpression(expression.left) ?? firstScalarExpression(expression.right);
        }
        return null;
      };
      const scalarExpression = firstScalarExpression(valueExpression);
      if (scalarExpression) {
        rootGeometryValueScalarSites.set(statementId, {
          parameterKey: null,
          span: scalarExpression.ast.span,
          expression: scalarExpression
        });
      }
    } else if (construction?.kind === "segment") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "start", span: construction.start.span, reference: construction.start },
        { parameterKey: "end", span: construction.end.span, reference: construction.end }
      ]);
    } else if (construction?.kind === "arc") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "center", span: construction.center.span, reference: construction.center }
      ]);
    } else if (construction?.kind === "through") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "point1", span: construction.point1.span, reference: construction.point1 },
        { parameterKey: "point2", span: construction.point2.span, reference: construction.point2 },
        { parameterKey: "point3", span: construction.point3.span, reference: construction.point3 }
      ]);
    } else if (construction?.kind === "bezier") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "start", span: construction.start.span, reference: construction.start },
        { parameterKey: "end", span: construction.end.span, reference: construction.end },
        ...construction.intermediates.map((intermediate, index) => ({
          parameterKey: `intermediates:${index}:point`,
          span: intermediate.point.span,
          reference: intermediate.point
        }))
      ]);
    } else if (construction?.kind === "offsetPoint") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "from", span: construction.from.span, reference: construction.from }
      ]);
    } else if (construction?.kind === "polarPoint") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "from", span: construction.from.span, reference: construction.from }
      ]);
    } else if (construction?.kind === "between") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "start", span: construction.start.span, reference: construction.start },
        { parameterKey: "end", span: construction.end.span, reference: construction.end }
      ]);
    } else if (construction?.kind === "onLine") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "from", span: construction.from.span, reference: construction.from }
      ]);
    } else if (construction?.kind === "tangentOffset") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "line", span: construction.line.span, reference: construction.line },
        { parameterKey: "base", span: construction.base.span, reference: construction.base }
      ]);
    } else if (construction?.kind === "commonTangent") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "first", span: construction.first.span, reference: construction.first },
        { parameterKey: "second", span: construction.second.span, reference: construction.second }
      ]);
    } else if (construction?.kind === "bezierExtremePoint") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "source", span: construction.source.span, reference: construction.source }
      ]);
    } else if (construction?.kind === "bezierBulgePoint") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "source", span: construction.source.span, reference: construction.source }
      ]);
    } else if (construction?.kind === "polarLine") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "start", span: construction.start.span, reference: construction.start }
      ]);
    } else if (construction?.kind === "offsetPath") {
      rootGeometryReferencesByStatementId.set(statementId, construction.sources.map((source, index) => ({
        parameterKey: `sources:${index}`,
        span: source.span,
        reference: source
      })));
    } else if (construction?.kind === "transformCopy") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "startPoint", span: construction.startPoint.span, reference: construction.startPoint },
        { parameterKey: "endPoint", span: construction.endPoint.span, reference: construction.endPoint },
        ...construction.baseLines.map((source, index) => ({
          parameterKey: `baseLines:${index}`,
          span: source.span,
          reference: source
        }))
      ]);
    } else if (construction?.kind === "mirrorCopy") {
      rootGeometryReferencesByStatementId.set(statementId, [
        { parameterKey: "axis1", span: construction.axis1.span, reference: construction.axis1 },
        { parameterKey: "axis2", span: construction.axis2.span, reference: construction.axis2 },
        ...construction.baseLines.map((source, index) => ({
          parameterKey: `baseLines:${index}`,
          span: source.span,
          reference: source
        }))
      ]);
    }
  }
  const parentArg = commonArgSpecs.find((arg) => arg.special === "parent");
  const resolveRootParent = (
    statementIndex: number,
    rawValue: string,
    span: DslSpan
  ): ModuleParentReferenceSemantic => {
    const trimmed = rawValue.trim();
    const logicalSource = input.logicalTextByStatementIndex?.get(statementIndex);
    const trimmedStart = logicalSource ? logicalSource.indexOf(trimmed, Math.max(0, span.start)) : -1;
    const semanticSpan = trimmedStart >= 0 ? { start: trimmedStart, end: trimmedStart + trimmed.length } : span;
    const semantic = (target: ModuleParentSourceTarget | null, resolution: ModuleParentReferenceSemantic["resolution"], nameSpan?: DslSpan): ModuleParentReferenceSemantic => ({
      source: rawValue,
      span: semanticSpan,
      ...(nameSpan ? { nameSpan } : {}),
      target,
      resolution
    });
    if (!trimmed) return semantic(null, "undefined");
    const parsedReference = parseDslSourceReference(trimmed);
    if (parsedReference.kind !== "valid" || parsedReference.reference.property) return semantic(null, "invalid");
    const reference = parsedReference.reference;
    const nameSpan = { start: semanticSpan.start + reference.pathRange.start, end: semanticSpan.start + reference.pathRange.end };
    const path = parseDslReferenceToken(reference.pathText);
    const lookup = path.segments.length === 1 && !path.absolute
      ? sourceDeclarationResolution(sourceNamespace, statementIndex, path.segments[0])
      : resolveSourceLexicalPath(sourceNamespace, statementIndex, path);
    if (lookup.kind === "resolved") {
      const target = declarationParentTarget(lookup.declaration, stableStatementIdByIndex);
      return target ? semantic(target, "resolved", nameSpan) : semantic(null, "invalid", nameSpan);
    }
    if (lookup.kind === "undefined") return semantic(null, "undefined", nameSpan);
    if (lookup.kind === "forward") return semantic(null, "forward", nameSpan);
    if (lookup.kind === "ambiguous") return semantic(null, "ambiguous", nameSpan);
    return semantic(null, "invalid", nameSpan);
  };
  for (const [statementIndex, statement] of statements.entries()) {
    if ((statement.kind !== "group" && statement.kind !== "element") || moduleOwnerIndexOf(statements, statementIndex) !== null) continue;
    const spec = statement.kind === "group" ? constructionFor("group", "") : constructionFor(statement.category, statement.construction);
    if (!spec) continue;
    if (parentArg) {
      const parentValueSpan = statement.payloadSpans[parentArg.arg];
      if (parentValueSpan) {
        const raw = input.logicalTextByStatementIndex?.get(statementIndex)?.slice(parentValueSpan.start, parentValueSpan.end)
          ?? statement.attrs.find((attr) => attr.key === parentArg.arg)?.value
          ?? "";
        rootParentReferencesByStatementId.set(statementIdAt(stableStatementIdByIndex, statementIndex), {
          parameterKey: "parent",
          span: parentValueSpan,
          reference: resolveRootParent(statementIndex, raw, parentValueSpan)
        });
      }
    }
    if (statement.kind !== "element" || (!isGeometryDeclarationCategory(statement.category) && statement.category !== "mutation") || !statement.type) continue;
    const definitionsByKey = new Map(getParameterDefinitions({ type: statement.type, intermediatePoints: [] } as never).map((definition) => [definition.key, definition]));
    const sites: ModuleGeometryReferenceSite[] = [];
    for (const arg of spec.args) {
      if (arg.special || !arg.parameterKey && !definitionsByKey.has(arg.arg)) continue;
      const parameterKey = arg.parameterKey ?? arg.arg;
      const parameter = definitionsByKey.get(parameterKey);
      const valueSpan = statement.payloadSpans[arg.arg] ?? statement.payloadSpans[parameterKey];
      if (!parameter || !valueSpan || !["reference", "lineEndpointReference", "lineReference", "lineReferenceList"].includes(parameter.kind)) continue;
      const raw = input.logicalTextByStatementIndex?.get(statementIndex)?.slice(valueSpan.start, valueSpan.end) ?? statement.attrs.find((attr) => attr.key === arg.arg)?.value ?? "";
      const expected = parameter.kind === "reference" || parameter.kind === "lineEndpointReference" ? "point" : "line";
      const sitesFor = (reference: ModuleGeometryReferenceSemantic, parameterKey: string | null, span: DslSpan) => sites.push({ parameterKey, span, reference });
      const referenceKind = (value: string): "module" | "ordinary" | "skip" => {
        const parsedReference = parseDslSourceReference(value);
        const parsedScalar = parseScalarExpression(value, { start: 0, end: value.length });
        const path = parsedScalar.ast?.kind === "collectionIndex"
          ? parseDslReferenceToken(parsedScalar.ast.name)
          : parsedReference.kind === "valid"
            ? parsedReference.reference.path
            : null;
        if (!path) return "skip";
        if (path.segments.length === 1) return "ordinary";
        const firstSegment = path.segments[0];
        const instanceLookup = sourceDeclarationResolution(sourceNamespace, statementIndex, firstSegment);
        if (instanceLookup.kind === "resolved") return instanceLookup.declaration.kind === "moduleInstance" ? "module" : "ordinary";
        return "skip";
      };
      if (parameter.kind === "lineReferenceList") {
        let cursor = 0;
        for (const token of splitDslList(raw)) {
          const offset = raw.indexOf(token, cursor);
          cursor = offset + token.length;
          const tokenSpan = { start: valueSpan.start + Math.max(0, offset), end: valueSpan.start + Math.max(0, offset) + token.length };
          const kind = referenceKind(token);
          if (kind === "module") sitesFor(resolveGeometry(statementIndex, null, token, tokenSpan, expected, { role: "lineReferenceList" }), parameterKey, tokenSpan);
          else if (kind === "ordinary") sitesFor(resolveRootGeometry(statementIndex, token, tokenSpan, expected, { role: "lineReferenceList" }), parameterKey, tokenSpan);
        }
      } else if (referenceKind(raw) === "module") {
        const reference = resolveGeometry(statementIndex, null, raw, valueSpan, expected, {
          role: parameter.kind === "reference" ? "pointReference" : parameter.kind === "lineEndpointReference" ? "lineEndpointReference" : "lineReference"
        });
        sitesFor(reference, parameterKey, valueSpan);
      } else if (referenceKind(raw) === "ordinary") {
        const reference = resolveRootGeometry(statementIndex, raw, valueSpan, expected, {
          role: parameter.kind === "reference" ? "pointReference" : parameter.kind === "lineEndpointReference" ? "lineEndpointReference" : "lineReference"
        });
        sitesFor(reference, parameterKey, valueSpan);
      }
    }
    if (sites.length) rootGeometryReferencesByStatementId.set(statementIdAt(stableStatementIdByIndex, statementIndex), sites);
  }

  const presenceFactsByStatementIndex = new Map<number, ReadonlySet<string>>();
  const definitionByStatementId = new Map(definitionStates.map((definition) => [definition.statementId, definition] as const));
  const moduleParameterForSlot = (definitionStatementId: string, parameterIndex: number) => {
    const definition = definitionByStatementId.get(definitionStatementId);
    const parameter = definition?.parameters[parameterIndex];
    return parameter
      ? { definitionStatementId, parameterIndex, name: parameter.name, optional: parameter.optional, valueType: parameter.valueType }
      : null;
  };
  const optionalGenericCollectionParameterForValueId = (targetValueId: string) => {
    const match = /^(.*):parameter:(\d+)$/.exec(targetValueId);
    return match
      ? moduleParameterForSlot(match[1]!, Number(match[2]))
      : null;
  };
  const addOptionalGenericCollectionPresenceDiagnostic = (
    statementIndex: number,
    span: DslSpan,
    parameter: NonNullable<ReturnType<typeof optionalGenericCollectionParameterForValueId>>,
    presenceFacts: ReadonlySet<string>
  ) => {
    if (!parameter.optional || presenceFacts.has(moduleParameterPresenceKey(parameter.definitionStatementId, parameter.parameterIndex))) return;
    const definition = definitionByStatementId.get(parameter.definitionStatementId);
    addLocal(statementIndex, issue(
      "module-optional-value-required",
      span,
      `optional module parameter「${parameter.name}」は hasValue(@${parameter.name}) で存在を確認してから参照してください。`,
      {
        relatedSources: definition ? relatedForParameter(definition, parameter.parameterIndex) : [],
        presentation: { key: "diagnostic.module-optional-value-required", parameters: { name: parameter.name } }
      }
    ));
  };
  const collectionArgumentSemantic = (
    statementIndex: number,
    ownerIndex: number | null,
    source: string,
    span: DslSpan,
    expectedType: import("./dslValueTypes").DslArrayValueType
  ): ModuleArgumentSemantic | null => {
    const parsed = parseDslSourceReference(source.trim());
    if (parsed.kind !== "valid" || parsed.reference.property) return null;
    const path = parseDslReferenceToken(parsed.reference.pathText);
    if (path.segments.length === 1 && !path.absolute) {
      const parameter = moduleParameterByName(statements, stableStatementIdByIndex, statementIndex, path.segments[0]!);
      if (parameter && isDslArrayValueType(parameter.parameter.valueType)) {
        return {
          kind: "collection",
          source,
          span,
          targetValueId: `${parameter.definitionStatementId}:parameter:${parameter.parameterIndex}`,
          valueType: parameter.parameter.valueType
        };
      }
    }
    const lookup = resolveSourceLexicalPath(sourceNamespace, statementIndex, path);
    if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "moduleInstance" && path.segments.length === 2) {
      const qualified = resolveQualifiedModuleExport(statementIndex, ownerIndex, parsed.reference.pathText, span, parsed.reference.pathRange.start);
      if (qualified?.kind === "deferred") {
        const exported = qualifiedCollectionExportFor(qualified);
        if (exported?.kind === "collection" && isDslNonArrayValueTypeAssignable(exported.valueType.elementType, expectedType.elementType)) {
          return {
            kind: "collection",
            source,
            span,
            targetValueId: geometryArrayDeferredModuleExportId(lookup.declaration.statementId, path.segments[1]!),
            valueType: exported.valueType
          };
        }
      }
      return null;
    }
    if (lookup.kind !== "resolved") return null;
    const value = sourceNamespace.geometryArraySemanticAnalysis
      ? collectionValueSemanticForStatement(sourceNamespace.geometryArraySemanticAnalysis, lookup.declaration.statementIndex)
      : null;
    if (!value) return null;
    const valueType = "valueType" in value ? value.valueType : { kind: "array" as const, elementType: { kind: value.type.elementType as "point" | "line" | "path" } };
    if (!isDslNonArrayValueTypeAssignable(valueType.elementType, expectedType.elementType)) return null;
    return {
      kind: "collection",
      source,
      span,
      targetValueId: value.statementId,
      valueType
    };
  };
  const analyzeInstances = () => {
    for (const [statementIndex, statement] of statements.entries()) {
      if (statement.kind !== "moduleInstance") continue;
      const statementId = statementIdAt(stableStatementIdByIndex, statementIndex);
      const ownerIndex = moduleOwnerIndexOf(statements, statementIndex);
      const owner = ownerIndex === null ? null : stateByIndex.get(ownerIndex) ?? null;
      const resolved = resolveModuleCallee(statementIndex, ownerIndex, statement.moduleName);
      const { callee, externalTarget, lookup } = resolved;
      const calleeResolution: ModuleInstanceSemantic["calleeResolution"] = callee
        ? "resolved"
        : lookup.kind === "external" && (lookup.member.value as { family?: unknown }).family !== "module"
          ? "notModule"
          : lookup.kind === "parameter" || lookup.kind === "iteration" || lookup.kind === "resolved"
            ? "notModule"
            : lookup.kind === "forward"
              ? "forward"
              : lookup.kind === "ambiguous"
                ? "ambiguous"
                : "undefined";
      if (!callee) {
        const span = statement.moduleNameSpan ?? statement.keywordSpan;
        const message = calleeResolution === "forward"
          ? `module「${statement.moduleName}」はこの位置より後で宣言されています。`
          : calleeResolution === "notModule"
            ? `「${statement.moduleName}」はmodule definitionではありません。`
            : calleeResolution === "ambiguous"
              ? `module callee「${statement.moduleName}」を一意に解決できません。`
              : `module「${statement.moduleName}」が見つかりません。`;
        addLocal(statementIndex, issue(moduleCalleeDiagnosticCode(calleeResolution), span, message, {
          relatedSources: lookup.kind === "external" ? [] : relatedForLookup(lookup),
          presentation: {
            key: `diagnostic.${moduleCalleeDiagnosticCode(calleeResolution)}`,
            parameters: { name: statement.moduleName }
          }
        }));
      }

      const parameterBindings: ResolvedModuleParameterBinding[] = [];
      const calleeState = callee && !externalTarget ? stateByIndex.get(callee.definitionStatementIndex) : undefined;
      const calleeParameters = calleeState?.parameters ?? externalTarget?.parameters ?? [];
      const argumentIndexes = new Map<string, number>();
      if (calleeState || externalTarget) {
        for (const [argumentIndex, argument] of statement.arguments.entries()) {
          if (argument.label === null) continue;
          const previousIndex = argumentIndexes.get(argument.label);
          if (previousIndex !== undefined) {
            const previous = statement.arguments[previousIndex];
            addLocal(statementIndex, issue("module-duplicate-argument", argument.labelSpan ?? argument.valueSpan, `argument「${argument.label}」が重複しています。`, {
              relatedSources: relatedAt(statementIndex, previous.labelSpan ?? previous.valueSpan, "First argument with this name", { key: "diagnostic.related.first-argument" }),
              presentation: { key: "diagnostic.module-duplicate-argument", parameters: { argument: argument.label } }
            }));
          } else argumentIndexes.set(argument.label, argumentIndex);
          const parameter = calleeState?.parameterByName.get(argument.label) ?? calleeParameters
            .map((candidate, index) => ({ parameter: candidate, index }))
            .find((candidate) => candidate.parameter.name === argument.label);
          if (!parameter) {
            addLocal(statementIndex, issue("module-unknown-argument", argument.labelSpan ?? argument.valueSpan, `module「${callee?.name ?? statement.moduleName}」にargument「${argument.label}」はありません。`, {
              relatedSources: calleeState
                ? relatedAt(calleeState.statementIndex, calleeState.statement.nameSpan ?? calleeState.statement.keywordSpan, "Called module definition", { key: "diagnostic.related.called-module-definition" })
                : [],
              presentation: {
                key: "diagnostic.module-unknown-argument",
                parameters: { module: callee?.name ?? statement.moduleName, argument: argument.label }
              }
            }));
          }
        }
        for (const parameter of calleeParameters) {
          const argumentIndex = argumentIndexes.get(parameter.name);
          const argument = argumentIndex === undefined ? undefined : statement.arguments[argumentIndex];
          const parameterRelated = calleeState ? relatedForParameter(calleeState, parameter.parameterIndex) : [];
          const parameterTypeRelated = calleeState ? relatedForParameter(calleeState, parameter.parameterIndex, true) : [];
          if (!argument) {
            if (parameter.required) addLocal(statementIndex, issue("module-missing-argument", statement.moduleNameSpan ?? statement.keywordSpan, `required argument「${parameter.name}」がありません。`, { relatedSources: parameterRelated, presentation: { key: "diagnostic.module-missing-argument", parameters: { parameter: parameter.name } } }));
            const state = parameter.optional
              ? "optionalOmitted"
              : parameter.defaultValue !== null
                ? "defaultedOmitted"
                : "requiredOmitted";
            parameterBindings.push({
              parameterIndex: parameter.parameterIndex,
              parameterName: parameter.name,
              parameterType: parameter.type,
              parameterValueType: parameter.valueType,
              argumentIndex: null,
              argumentLabel: null,
              argumentSpan: null,
              usesDefault: state === "defaultedOmitted",
              state,
              value: state === "defaultedOmitted" && parameter.defaultExpression ? { kind: "scalar", expression: parameter.defaultExpression } : null
            });
            continue;
          }
          const parameterArrayType = isDslArrayValueType(parameter.valueType)
            ? parameter.valueType
            : null;
          let value: ModuleArgumentSemantic | null = null;
          if (parameterArrayType) {
            const presenceFacts = presenceFactsByStatementIndex.get(statementIndex) ?? new Set<string>();
            if (ownerIndex !== null) {
              const parsedReference = parseDslSourceReference(argument.value.trim());
              if (parsedReference.kind === "valid" && parsedReference.reference.property === null) {
                const lookup = resolveModuleLexicalPath(statementIndex, ownerIndex, parseDslReferenceToken(parsedReference.reference.pathText));
                if (lookup.kind === "parameter") {
                  const sourceParameter = moduleParameterForSlot(lookup.definition.statementId, lookup.parameter.index);
                  if (sourceParameter && isDslArrayValueType(sourceParameter.valueType)) {
                    addOptionalGenericCollectionPresenceDiagnostic(statementIndex, argument.valueSpan, sourceParameter, presenceFacts);
                  }
                }
              }
            }
          }
          const parameterScalarType = scalarTypeOf(parameter.type);
          if (parameterArrayType) {
            value = collectionArgumentSemantic(
              statementIndex,
              ownerIndex,
              argument.value,
              argument.valueSpan,
              parameterArrayType
            );
          } else if (parameterScalarType) {
            const presenceFacts = presenceFactsByStatementIndex.get(statementIndex) ?? new Set<string>();
            const expression = analyzeExpression(
              statementIndex,
              ownerIndex,
              argument.value,
              argument.valueSpan,
              parameterScalarType,
              (reference, facts) => ownerIndex === null
                ? resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, facts)
                : resolveBodyScalar(statementIndex, ownerIndex, reference, facts),
              undefined,
              (reference) => resolveGeometryProperty(statementIndex, ownerIndex, reference),
              (reference) => resolveGeometry(
                statementIndex,
                ownerIndex,
                reference.name.startsWith("@") ? reference.name : `@${reference.name}`,
                reference.span,
                reference.expectedGeometryType,
                {
                  expectedInterfaceType: reference.expectedGeometryType,
                  role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference",
                  presenceFacts
                }
              ),
              (reference) => resolveHasValue(statementIndex, ownerIndex, reference),
              presenceFacts,
              parameterTypeRelated
            );
            value = expression ? { kind: "scalar", expression } : null;
          } else if (parameter.recordTypeIdentity) {
            const presenceFacts = presenceFactsByStatementIndex.get(statementIndex) ?? new Set<string>();
            const reference = recordReferenceSemantic(
              statementIndex,
              ownerIndex,
              argument.value,
              argument.valueSpan,
              parameter.recordTypeIdentity,
              presenceFacts
            );
            value = { kind: "record", reference };
          } else {
            const parameterGeometryKind = geometryKindOf(parameter.type);
            const parameterInterfaceType = moduleGeometryInterfaceTypeOf(parameter.type);
            if (parameterGeometryKind && parameterInterfaceType) {
              value = {
                kind: "geometry",
                reference: resolveGeometry(
                  statementIndex,
                  ownerIndex,
                  argument.value,
                  argument.valueSpan,
                  parameterGeometryKind,
                  {
                    expectedInterfaceType: parameterInterfaceType,
                    presenceFacts: presenceFactsByStatementIndex.get(statementIndex),
                    typeMismatchRelatedSources: parameterTypeRelated
                  }
                )
              };
            }
          }
          parameterBindings.push({
            parameterIndex: parameter.parameterIndex,
            parameterName: parameter.name,
            parameterType: parameter.type,
            parameterValueType: parameter.valueType,
            argumentIndex: argumentIndex ?? null,
            argumentLabel: argument.label,
            argumentSpan: argument.valueSpan,
            usesDefault: false,
            state: parameter.optional ? "optionalSupplied" : "requiredSupplied",
            value
          });
        }
      }
      const semantic: ModuleInstanceSemantic = {
        statementId,
        statementIndex,
        name: statement.name,
        ...(input.documentId ? {
          documentId: input.documentId,
          identity: qualifySemanticIdentity(input.documentId, statementId),
          ...(input.source ? { location: statementLocationFor(input.source, statement) } : {})
        } : {}),
        callerModuleDefinitionStatementId: owner?.statementId ?? null,
        ...(input.documentId ? {
          callerModuleDefinitionIdentity: owner ? qualifySemanticIdentity(input.documentId, owner.statementId) : null
        } : {}),
        callee,
        calleeResolution,
        parameterBindings
      };
      instances.push(semantic);
    }
  };

  // Root typed declarations are owned by the ordinary scalar analyzer, but a
  // qualified module scalar reference still needs the Module source identity
  // for editor completion/navigation/rename. Reuse this analysis' resolved
  // target instead of asking the editor to resolve `instance::member` again.
  const rootScalarExpressionsByStatementId = new Map<StatementIdentity, ModuleScalarExpressionSite>(rootGeometryValueScalarSites);
  for (const [statementIndex, statement] of statements.entries()) {
    if (
      statement.kind !== "typedDeclaration" ||
      moduleOwnerIndexOf(statements, statementIndex) !== null ||
      !scalarExpressionTypeOfDslValueType(statement.valueType) ||
      !statement.payloadSpans.initializer
    ) continue;
    const initializerSpan = statement.payloadSpans.initializer;
    const diagnosticsBefore = localDiagnosticsByStatement.get(statementIndex)?.length ?? 0;
    const expression = analyzeExpression(
      statementIndex,
      null,
      statement.initializer,
      initializerSpan,
      scalarExpressionTypeOfDslValueType(statement.valueType),
      (reference) => resolveSourceScalar(statementIndex, null, reference.name, null, reference.span),
      undefined,
      (reference) => resolveGeometryProperty(statementIndex, null, reference),
      (reference) => resolveGeometry(
        statementIndex,
        null,
        reference.name.startsWith("@") ? reference.name : `@${reference.name}`,
        reference.span,
        reference.expectedGeometryType,
        { expectedInterfaceType: reference.expectedGeometryType, role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference" }
      )
    );
    // Root typed declaration diagnostics remain owned by the ordinary scalar
    // analyzer. This pass only contributes already-resolved Module editor
    // identity; duplicating an invalid/private diagnostic here would make the
    // existing module scalar runtime bridge stop compiling its synthetic
    // bindings before the canonical binding diagnostics are reported.
    const diagnostics = localDiagnosticsByStatement.get(statementIndex);
    if (diagnostics && diagnostics.length > diagnosticsBefore) {
      diagnostics.splice(diagnosticsBefore);
      if (diagnostics.length === 0) localDiagnosticsByStatement.delete(statementIndex);
    }
    if (expression) {
      rootScalarExpressionsByStatementId.set(statementIdAt(stableStatementIdByIndex, statementIndex), {
        parameterKey: null,
        span: initializerSpan,
        expression
      });
    }
  }

  // A root value-for body is still a scalar expression, but its containing
  // declaration is an array and therefore is intentionally absent from the
  // root typed-declaration loop above. Analyze the body through the same
  // Module source resolver so qualified exports retain their normal semantic
  // identity for navigation, completion, and rename.
  for (const value of sourceNamespace.geometryArraySemanticAnalysis?.genericValues ?? []) {
    if (value.ownerModuleDefinitionStatementIndex !== null || value.value?.kind !== "map") continue;
    const statement = statements[value.statementIndex];
    const initializerSpan = statement?.kind === "typedDeclaration" ? statement.payloadSpans.initializer : undefined;
    if (!statement || statement.kind !== "typedDeclaration" || !initializerSpan) continue;
    const mapped = value.value;
    if (mapped.sourceElementType.kind === "record" || mapped.resultElementType.kind === "record") continue;
    const sourceElementType = scalarTypeOfDslValueType(mapped.sourceElementType);
    const resultElementType = scalarTypeOfDslValueType(mapped.resultElementType);
    if (!sourceElementType || !resultElementType) continue;
    const bodyRaw = statement.initializer.slice(mapped.bodySpan.start - initializerSpan.start, mapped.bodySpan.end - initializerSpan.start);
    const diagnosticsBefore = localDiagnosticsByStatement.get(value.statementIndex)?.length ?? 0;
    const expression = analyzeExpression(
      value.statementIndex,
      null,
      bodyRaw,
      mapped.bodySpan,
      resultElementType,
      (reference, presenceFacts) => {
        const path = parseDslReferenceToken(reference.name);
        if (path.segments.length === 1 && !path.absolute && path.segments[0] === mapped.binder) {
          return {
            target: {
              kind: "valueForBinder" as const,
              binderId: mapped.binderId,
              statementId: value.statementId,
              statementIndex: value.statementIndex,
              name: mapped.binder,
              sourceElementType
            },
            type: sourceElementType,
            resolution: "resolved" as const
          };
        }
        return resolveSourceScalar(value.statementIndex, null, reference.name, null, reference.span, presenceFacts);
      },
      undefined,
      (reference) => resolveGeometryProperty(value.statementIndex, null, reference),
      (reference) => resolveGeometry(
        value.statementIndex,
        null,
        reference.name.startsWith("@") ? reference.name : `@${reference.name}`,
        reference.span,
        reference.expectedGeometryType,
        { expectedInterfaceType: reference.expectedGeometryType, role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference" }
      )
    );
    // The ordinary scalar analyzer owns root value-for diagnostics. This
    // pass contributes only the resolved Module source projection.
    const diagnostics = localDiagnosticsByStatement.get(value.statementIndex);
    if (diagnostics && diagnostics.length > diagnosticsBefore) {
      diagnostics.splice(diagnosticsBefore);
      if (diagnostics.length === 0) localDiagnosticsByStatement.delete(value.statementIndex);
    }
    if (expression) {
      rootScalarExpressionsByStatementId.set(statementIdAt(stableStatementIdByIndex, value.statementIndex), {
        parameterKey: null,
        span: mapped.bodySpan,
        expression
      });
    }
  }

  // Collection control-flow branches reuse the established Module scalar
  // resolver/typechecker for their condition or scrutinee.  Shape resolution
  // already happened in geometryArraySemanticAnalysis; this pass only fills
  // the scalar semantic needed by the runtime and editor identity paths.
  const analyzeCollectionControlFlow = (
    statementIndex: number,
    ownerIndex: number | null,
    source: string,
    value: DslArraySemanticValue<unknown> | GeometryArraySemanticValue<unknown>,
    analyzeScalar: (raw: string, span: DslSpan, expectedType: ScalarType | null, presenceFacts?: ReadonlySet<string>) => ModuleScalarExpressionSemantic | null,
    addDiagnostic: (diagnostic: ModuleScalarLocalDiagnostic) => void,
    presenceFacts: ReadonlySet<string> = new Set()
  ): void => {
    if (value.kind === "if") {
      value.condition = analyzeScalar(
        source.slice(value.conditionSpan.start, value.conditionSpan.end),
        value.conditionSpan,
        { kind: "boolean" },
        presenceFacts
      ) ?? undefined;
      const thenPresenceFacts = new Set(presenceFacts);
      const elsePresenceFacts = new Set(presenceFacts);
      if (value.condition) {
        for (const fact of presenceFactsForSemanticTruth(value.condition)) thenPresenceFacts.add(fact);
        for (const fact of presenceFactsForSemanticFalse(value.condition)) elsePresenceFacts.add(fact);
      }
      analyzeCollectionControlFlow(statementIndex, ownerIndex, source, value.thenValue, analyzeScalar, addDiagnostic, thenPresenceFacts);
      analyzeCollectionControlFlow(statementIndex, ownerIndex, source, value.elseValue, analyzeScalar, addDiagnostic, elsePresenceFacts);
      return;
    }
    if (value.kind === "match") {
      value.scrutinee = analyzeScalar(
        source.slice(value.scrutineeSpan.start, value.scrutineeSpan.end),
        value.scrutineeSpan,
        null,
        presenceFacts
      ) ?? undefined;
      if (value.scrutinee) {
        const addMatchDiagnostic = (diagnostic: { code: string; span: DslSpan; message: string; presentation?: DslDiagnosticPresentation }) => addDiagnostic(issue(
          diagnostic.code,
          diagnostic.span,
          diagnostic.message,
          { presentation: diagnostic.presentation }
        ) as ModuleScalarLocalDiagnostic);
        if (value.scrutinee.type?.kind === "optional") {
          validateOptionalMatchExhaustiveness({
            scrutineeType: value.scrutinee.type,
            scrutineeSpan: value.scrutineeSpan,
            matchSpan: value.span,
            arms: value.arms,
            addDiagnostic: addMatchDiagnostic
          });
        } else {
          validateChoiceMatchExhaustiveness({
            scrutineeType: value.scrutinee.type,
            scrutineeSpan: value.scrutineeSpan,
            matchSpan: value.span,
            arms: value.arms,
            addDiagnostic: addMatchDiagnostic
          });
        }
      }
      for (const arm of value.arms) analyzeCollectionControlFlow(statementIndex, ownerIndex, source, arm.value, analyzeScalar, addDiagnostic);
    }
  };

  const analyzeRootCollectionControlFlow = (value: DslArraySemanticValue<unknown> | GeometryArraySemanticValue<unknown>, statementIndex: number) => {
    const statement = statements[statementIndex];
    if (statement?.kind !== "typedDeclaration") return;
    const initializerSpan = statement.payloadSpans.initializer;
    if (!initializerSpan) return;
    const source = `${" ".repeat(initializerSpan.start)}${statement.initializer}`;
    analyzeCollectionControlFlow(
      statementIndex,
      null,
      source,
      value,
      (raw, span, expectedType, presenceFacts) => analyzeExpression(
        statementIndex,
        null,
        raw,
        span,
        expectedType,
        (reference, facts) => resolveSourceScalar(statementIndex, null, reference.name, null, reference.span, facts),
        undefined,
        (reference) => resolveGeometryProperty(statementIndex, null, reference),
        (reference) => resolveGeometry(statementIndex, null, reference.name.startsWith("@") ? reference.name : `@${reference.name}`, reference.span, reference.expectedGeometryType, {
          expectedInterfaceType: reference.expectedGeometryType,
          role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference"
        }),
        (reference) => resolveHasValue(statementIndex, null, reference),
        presenceFacts
      ),
      (diagnostic) => addLocal(statementIndex, diagnostic)
    );
  };
  for (const value of sourceNamespace.geometryArraySemanticAnalysis?.genericValues ?? []) {
    if (value.ownerModuleDefinitionStatementIndex === null && value.value) analyzeRootCollectionControlFlow(value.value, value.statementIndex);
  }
  for (const value of sourceNamespace.geometryArraySemanticAnalysis?.values ?? []) {
    if (value.ownerModuleDefinitionStatementIndex === null && value.value) analyzeRootCollectionControlFlow(value.value, value.statementIndex);
  }

  // Geometry collection maps use the existing geometry-value semantic parser
  // and a narrow immutable binder overlay. The collection owner supplies the
  // source identity/type; this pass owns the body spans and resolved leaves.
  for (const value of sourceNamespace.geometryArraySemanticAnalysis?.values ?? []) {
    if (value.ownerModuleDefinitionStatementIndex !== null || value.value?.kind !== "map") continue;
    const statement = statements[value.statementIndex];
    const initializerSpan = statement?.kind === "typedDeclaration" ? statement.payloadSpans.initializer : undefined;
    if (!statement || statement.kind !== "typedDeclaration" || !initializerSpan) continue;
    const mapped = value.value;
    const bodyRaw = statement.initializer.slice(mapped.bodySpan.start - initializerSpan.start, mapped.bodySpan.end - initializerSpan.start);
    const bodySource = `${" ".repeat(mapped.bodySpan.start)}${bodyRaw}`;
    const parsedBody = parseScalarExpression(bodySource, mapped.bodySpan, { allowOpaqueNamedCalls: true });
    for (const parserDiagnostic of parsedBody.diagnostics) addLocal(value.statementIndex, issue(parserDiagnostic.code, parserDiagnostic.span, parserDiagnostic.message));
    if (!parsedBody.ast) continue;
    const binder: Extract<ModuleGeometrySourceTarget, { kind: "geometryValueForBinder" }> = {
      kind: "geometryValueForBinder",
      binderId: mapped.binderId,
      statementId: value.statementId,
      statementIndex: value.statementIndex,
      name: mapped.binder,
      sourceElementType: mapped.sourceElementType
    };
    const previousBinder: Extract<ModuleGeometrySourceTarget, { kind: "geometryValueForBinder" }> | null = activeGeometryValueBinder;
    activeGeometryValueBinder = binder;
    try {
      const body = parseGeometryValueExpression({
        statementIndex: value.statementIndex,
        ownerIndex: null,
        source: bodySource,
        node: parsedBody.ast,
        expectedInterfaceType: mapped.resultElementType,
        analyzeScalar: (raw, span, expectedType) => analyzeExpression(
          value.statementIndex,
          null,
          raw,
          span,
          expectedType,
          (reference, presenceFacts) => resolveSourceScalar(value.statementIndex, null, reference.name, null, reference.span, presenceFacts),
          undefined,
          (reference) => resolveGeometryProperty(value.statementIndex, null, reference),
          (reference) => resolveGeometry(value.statementIndex, null, reference.name.startsWith("@") ? reference.name : `@${reference.name}`, reference.span, reference.expectedGeometryType, {
            expectedInterfaceType: reference.expectedGeometryType,
            role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference"
          })
        ),
        resolveReference: (raw, span) => resolveGeometry(
          value.statementIndex,
          null,
          raw,
          span,
          mapped.resultElementType === "point" ? "point" : "line",
          {
            expectedInterfaceType: mapped.resultElementType,
            role: mapped.resultElementType === "point" ? "pointReference" : "lineReference"
          }
        ),
        parseConstruction: (raw, span, expectedInterfaceType) => parseGeometryValueConstruction(
          value.statementIndex,
          null,
          raw,
          span,
          expectedInterfaceType,
          {
            geometryPropertyResolver: (reference) => resolveGeometryProperty(value.statementIndex, null, reference)
          }
        ),
        addDiagnostic: (diagnostic) => addLocal(value.statementIndex, diagnostic)
      });
      if (body) mapped.body = body;
    } finally {
      activeGeometryValueBinder = previousBinder;
    }
  }

  const localScalarsByDefinition = new Map<number, ModuleDefinitionSemantic["localScalars"]>();
  const mappedScalarCollectionBodiesByDefinition = new Map<number, ModuleDefinitionSemantic["mappedScalarCollectionBodies"]>();
  const mappedRecordCollectionBodiesByDefinition = new Map<number, ModuleDefinitionSemantic["mappedRecordCollectionBodies"]>();
  const mappedGeometryCollectionBodiesByDefinition = new Map<number, ModuleDefinitionSemantic["mappedGeometryCollectionBodies"]>();
  const localGeometryValuesByDefinition = new Map<number, ModuleGeometryValueSemantic[]>();
  const bodyStatementsByDefinition = new Map<number, ModuleDefinitionSemantic["bodyStatements"]>();
  const recordValuesByDefinition = new Map<number, ModuleDefinitionSemantic["recordValues"]>();
  const exportsByDefinition = new Map<number, ResolvedModuleExport[]>();
  for (const definition of definitionStates) {
    const body = analyzeModuleBody({
      definition,
      statements,
      stableStatementIdByIndex,
      input,
      addLocal,
      analyzeExpression,
      resolveGeometry,
      resolveGeometryConstruction: parseGeometryValueConstruction,
      parseGeometryValueExpression,
      resolvePlainScalarTarget,
      resolveBodyScalar: (statementIndex, reference, presenceFacts) => resolveBodyScalar(statementIndex, definition.statementIndex, reference, presenceFacts),
      resolveBodyBareScalar: (statementIndex, reference) => resolveBodyBareScalar(statementIndex, definition.statementIndex, reference),
      resolveBodyGeometryProperty: (statementIndex, reference) => resolveGeometryProperty(statementIndex, definition.statementIndex, reference),
      resolveBodyGeometryBuiltin: (statementIndex, reference) => resolveGeometry(
        statementIndex,
        definition.statementIndex,
        reference.name.startsWith("@") ? reference.name : `@${reference.name}`,
        reference.span,
        reference.expectedGeometryType,
        {
          expectedInterfaceType: reference.expectedGeometryType,
          role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference",
          presenceFacts: reference.presenceFacts
        }
      ),
      resolveBodyHasValue: (statementIndex, reference) => resolveHasValue(statementIndex, definition.statementIndex, reference),
      registerGeometryValue: (value) => geometryValuesByStatementIndex.set(value.statementIndex, value)
    });
    localScalarsByDefinition.set(definition.statementIndex, body.localScalars);
    const moduleCollectionAnalysisForControlFlow = sourceNamespace.geometryArraySemanticAnalysis;
    for (const collectionValue of [
      ...(moduleCollectionAnalysisForControlFlow?.genericValues ?? []),
      ...(moduleCollectionAnalysisForControlFlow?.values ?? [])
    ]) {
      if (collectionValue.ownerModuleDefinitionStatementIndex !== definition.statementIndex || !collectionValue.value) continue;
      const statement = statements[collectionValue.statementIndex];
      if (statement?.kind !== "typedDeclaration") continue;
      const initializerSpan = statement.payloadSpans.initializer;
      if (!initializerSpan) continue;
      const source = `${" ".repeat(initializerSpan.start)}${statement.initializer}`;
      analyzeCollectionControlFlow(
        collectionValue.statementIndex,
        definition.statementIndex,
        source,
        collectionValue.value,
        (raw, span, expectedType, presenceFacts) => analyzeExpression(
          collectionValue.statementIndex,
          definition.statementIndex,
          raw,
          span,
          expectedType,
          (reference, facts) => resolveBodyScalar(collectionValue.statementIndex, definition.statementIndex, reference, facts),
          undefined,
          (reference) => resolveGeometryProperty(collectionValue.statementIndex, definition.statementIndex, reference),
          (reference) => resolveGeometry(collectionValue.statementIndex, definition.statementIndex, reference.name.startsWith("@") ? reference.name : `@${reference.name}`, reference.span, reference.expectedGeometryType, {
            expectedInterfaceType: reference.expectedGeometryType,
            role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference",
            presenceFacts: new Set()
          }),
          (reference) => resolveHasValue(collectionValue.statementIndex, definition.statementIndex, reference),
          presenceFacts
        ),
        (diagnostic) => addLocal(collectionValue.statementIndex, diagnostic)
      );
    }
    const genericMappedValuesOf = (value: DslArraySemanticValue<GenericArraySourceTarget> | null): DslArrayMappedValue[] => {
      const mappedValues: DslArrayMappedValue[] = [];
      const collect = (candidate: DslArraySemanticValue<GenericArraySourceTarget>) => {
        if (candidate.kind === "map") {
          mappedValues.push(candidate);
          return;
        }
        if (candidate.kind === "if") {
          collect(candidate.thenValue);
          collect(candidate.elseValue);
          return;
        }
        if (candidate.kind === "match") {
          for (const arm of candidate.arms) collect(arm.value);
        }
      };
      if (value) collect(value);
      return mappedValues;
    };
    const geometryMappedValuesOf = (value: GeometryArraySemanticValue<GeometryArraySourceTarget> | null): GeometryArrayMappedValue[] => {
      const mappedValues: GeometryArrayMappedValue[] = [];
      const collect = (candidate: GeometryArraySemanticValue<GeometryArraySourceTarget>) => {
        if (candidate.kind === "map") {
          mappedValues.push(candidate);
          return;
        }
        if (candidate.kind === "if") {
          collect(candidate.thenValue);
          collect(candidate.elseValue);
          return;
        }
        if (candidate.kind === "match") {
          for (const arm of candidate.arms) collect(arm.value);
        }
      };
      if (value) collect(value);
      return mappedValues;
    };
    const mappedScalarCollectionBodies: ModuleDefinitionSemantic["mappedScalarCollectionBodies"][number][] = [];
    const mappedRecordCollectionBodies: NonNullable<ModuleDefinitionSemantic["mappedRecordCollectionBodies"]>[number][] = [];
    const genericCollectionAnalysis = sourceNamespace.geometryArraySemanticAnalysis;
    for (const value of genericCollectionAnalysis?.genericValues ?? []) {
      if (value.ownerModuleDefinitionStatementIndex !== definition.statementIndex) continue;
      const statement = statements[value.statementIndex];
      if (statement?.kind !== "typedDeclaration") continue;
      const initializerSpan = statement.payloadSpans.initializer;
      if (!initializerSpan) continue;
      for (const mapped of genericMappedValuesOf(value.value)) {
        if (mapped.sourceElementType.kind === "record" || mapped.resultElementType.kind === "record") continue;
        const sourceElementType = scalarTypeOfDslValueType(mapped.sourceElementType);
        const resultElementType = scalarTypeOfDslValueType(mapped.resultElementType);
        if (!sourceElementType || !resultElementType) continue;
        const bodyRaw = statement.initializer.slice(mapped.bodySpan.start - initializerSpan.start, mapped.bodySpan.end - initializerSpan.start);
        const semantic = analyzeExpression(
        value.statementIndex,
        definition.statementIndex,
        bodyRaw,
        mapped.bodySpan,
        resultElementType,
        (reference, presenceFacts) => {
          const path = parseDslReferenceToken(reference.name);
          if (path.segments.length === 1 && !path.absolute && path.segments[0] === mapped.binder) {
            return {
              target: {
                kind: "valueForBinder" as const,
                binderId: mapped.binderId,
                statementId: value.statementId,
                statementIndex: value.statementIndex,
                name: mapped.binder,
                sourceElementType
              },
              type: sourceElementType,
              resolution: "resolved" as const
            };
          }
          return resolveBodyScalar(value.statementIndex, definition.statementIndex, reference, presenceFacts);
        },
        undefined,
        (reference) => resolveGeometryProperty(value.statementIndex, definition.statementIndex, reference),
        (reference) => resolveGeometry(
          value.statementIndex,
          definition.statementIndex,
          reference.name.startsWith("@") ? reference.name : `@${reference.name}`,
          reference.span,
          reference.expectedGeometryType,
          {
            expectedInterfaceType: reference.expectedGeometryType,
            role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference",
            presenceFacts: reference.presenceFacts
          }
        ),
        (reference) => resolveHasValue(value.statementIndex, definition.statementIndex, reference)
      );
        if (semantic?.type) {
          mappedScalarCollectionBodies.push({
            statementId: value.statementId,
            statementIndex: value.statementIndex,
            binderId: mapped.binderId,
            sourceElementType: mapped.sourceElementType,
            resultElementType: mapped.resultElementType,
            body: semantic
          });
        }
      }
      for (const mapped of genericMappedValuesOf(value.value)) {
        const body = moduleRecordCollectionBodyFor({
          value,
          mapped,
          statement,
          ownerIndex: definition.statementIndex
        });
        if (body) mappedRecordCollectionBodies.push(body);
      }
    }
    mappedScalarCollectionBodiesByDefinition.set(definition.statementIndex, mappedScalarCollectionBodies);
    // Keep the record map body alongside the scalar map body so the runtime
    // can materialize both through the same Module instance context.
    mappedRecordCollectionBodiesByDefinition.set(definition.statementIndex, mappedRecordCollectionBodies);
    const mappedGeometryCollectionBodies: NonNullable<ModuleDefinitionSemantic["mappedGeometryCollectionBodies"]>[number][] = [];
    const geometryCollectionAnalysis = sourceNamespace.geometryArraySemanticAnalysis;
    for (const value of geometryCollectionAnalysis?.values ?? []) {
      if (value.ownerModuleDefinitionStatementIndex !== definition.statementIndex) continue;
      const statement = statements[value.statementIndex];
      if (statement?.kind !== "typedDeclaration") continue;
      const initializerSpan = statement.payloadSpans.initializer;
      if (!initializerSpan) continue;
      for (const mapped of geometryMappedValuesOf(value.value)) {
      const bodyRaw = statement.initializer.slice(mapped.bodySpan.start - initializerSpan.start, mapped.bodySpan.end - initializerSpan.start);
      const bodySource = `${" ".repeat(mapped.bodySpan.start)}${bodyRaw}`;
      const parsedBody = parseScalarExpression(bodySource, mapped.bodySpan, { allowOpaqueNamedCalls: true });
      for (const parserDiagnostic of parsedBody.diagnostics) addLocal(value.statementIndex, issue(parserDiagnostic.code, parserDiagnostic.span, parserDiagnostic.message));
      if (!parsedBody.ast) continue;
      const binder: Extract<ModuleGeometrySourceTarget, { kind: "geometryValueForBinder" }> = {
        kind: "geometryValueForBinder",
        binderId: mapped.binderId,
        statementId: value.statementId,
        statementIndex: value.statementIndex,
        name: mapped.binder,
        sourceElementType: mapped.sourceElementType
      };
      const previousBinder: Extract<ModuleGeometrySourceTarget, { kind: "geometryValueForBinder" }> | null = activeGeometryValueBinder;
      activeGeometryValueBinder = binder;
      try {
        const body = parseGeometryValueExpression({
          statementIndex: value.statementIndex,
          ownerIndex: definition.statementIndex,
          source: bodySource,
          node: parsedBody.ast,
          expectedInterfaceType: mapped.resultElementType,
          analyzeScalar: (raw, span, expectedType) => analyzeExpression(
            value.statementIndex,
            definition.statementIndex,
            raw,
            span,
            expectedType,
            (reference, presenceFacts) => resolveBodyScalar(value.statementIndex, definition.statementIndex, reference, presenceFacts),
            undefined,
            (reference) => resolveGeometryProperty(value.statementIndex, definition.statementIndex, reference),
            (reference) => resolveGeometry(value.statementIndex, definition.statementIndex, reference.name.startsWith("@") ? reference.name : `@${reference.name}`, reference.span, reference.expectedGeometryType, {
              expectedInterfaceType: reference.expectedGeometryType,
              role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference",
              presenceFacts: reference.presenceFacts
            })
          ),
          resolveReference: (raw, span) => resolveGeometry(
            value.statementIndex,
            definition.statementIndex,
            raw,
            span,
            mapped.resultElementType === "point" ? "point" : "line",
            {
              expectedInterfaceType: mapped.resultElementType,
              role: mapped.resultElementType === "point" ? "pointReference" : "lineReference"
            }
          ),
          parseConstruction: (raw, span, expectedInterfaceType) => parseGeometryValueConstruction(
            value.statementIndex,
            definition.statementIndex,
            raw,
            span,
            expectedInterfaceType,
            {
              geometryPropertyResolver: (reference) => resolveGeometryProperty(value.statementIndex, definition.statementIndex, reference)
            }
          ),
          addDiagnostic: (diagnostic) => addLocal(value.statementIndex, diagnostic)
        });
        if (body) {
          mapped.body = body;
          mappedGeometryCollectionBodies.push({
            statementId: value.statementId,
            statementIndex: value.statementIndex,
            binderId: mapped.binderId,
            sourceElementType: mapped.sourceElementType,
            resultElementType: mapped.resultElementType,
            body
          });
        }
      } finally {
        activeGeometryValueBinder = previousBinder;
      }
      }
    }
    mappedGeometryCollectionBodiesByDefinition.set(definition.statementIndex, mappedGeometryCollectionBodies);
    localGeometryValuesByDefinition.set(definition.statementIndex, body.localGeometryValues);
    bodyStatementsByDefinition.set(definition.statementIndex, body.bodyStatements);
    for (const statement of body.bodyStatements) presenceFactsByStatementIndex.set(statement.statementIndex, new Set(statement.presenceParameterKeys));
    const bodyByStatementIndex = new Map(body.bodyStatements.map((statement) => [statement.statementIndex, statement] as const));
    const presenceFactsForSourceStatement = (statementIndex: number): ReadonlySet<string> => {
      const facts = new Set<string>();
      let enclosing = statements[statementIndex]?.enclosing ?? null;
      while (enclosing) {
        const condition = bodyByStatementIndex.get(enclosing.statementIndex)?.scalarExpressions.find((site) => site.parameterKey === "condition")?.expression;
        if (condition) {
          const branchFacts = enclosing.branch === "then"
            ? presenceFactsForSemanticTruth(condition)
            : presenceFactsForSemanticFalse(condition);
          for (const fact of branchFacts) facts.add(fact);
        }
        enclosing = statements[enclosing.statementIndex]?.enclosing ?? null;
      }
      return facts;
    };
    const moduleGenericCollectionAnalysis = sourceNamespace.geometryArraySemanticAnalysis;
    const checkOptionalGenericCollectionValue = (
      value: DslArraySemanticValue<GenericArraySourceTarget>,
      statementIndex: number,
      presenceFacts: ReadonlySet<string>
    ): void => {
      if (value.kind === "if") {
        const thenFacts = new Set(presenceFacts);
        const elseFacts = new Set(presenceFacts);
        if (value.condition) {
          for (const fact of presenceFactsForSemanticTruth(value.condition)) thenFacts.add(fact);
          for (const fact of presenceFactsForSemanticFalse(value.condition)) elseFacts.add(fact);
        }
        checkOptionalGenericCollectionValue(value.thenValue, statementIndex, thenFacts);
        checkOptionalGenericCollectionValue(value.elseValue, statementIndex, elseFacts);
        return;
      }
      if (value.kind === "match") {
        for (const arm of value.arms) checkOptionalGenericCollectionValue(arm.value, statementIndex, presenceFacts);
        return;
      }
      if (value.kind === "alias") {
        const parameter = optionalGenericCollectionParameterForValueId(value.targetValueId);
        if (parameter) addOptionalGenericCollectionPresenceDiagnostic(statementIndex, value.sourceSpan, parameter, presenceFacts);
        return;
      }
      if (value.kind !== "literal") return;
      for (const member of value.members) {
        const parameter = member.target.kind === "moduleParameterValue"
          ? moduleParameterForSlot(member.target.definitionStatementId, member.target.parameterIndex)
          : null;
        if (parameter) addOptionalGenericCollectionPresenceDiagnostic(statementIndex, member.sourceSpan, parameter, presenceFacts);
      }
    };
    for (const value of moduleGenericCollectionAnalysis?.genericValues ?? []) {
      if (value.ownerModuleDefinitionStatementIndex !== definition.statementIndex || !value.value) continue;
      if (value.value.kind !== "map") {
        checkOptionalGenericCollectionValue(value.value, value.statementIndex, presenceFactsForSourceStatement(value.statementIndex));
      }
    }
    const definitionRecordValues: ModuleRecordValueSemantic[] = [...(recordAnalysis?.valuesByStatementId.values() ?? [])]
      .filter((value) => moduleOwnerIndexOf(statements, value.statementIndex) === definition.statementIndex)
      .sort((left, right) => left.statementIndex - right.statementIndex)
      .map((value) => {
        const statement = statements[value.statementIndex];
        const presenceFacts = presenceFactsForSourceStatement(value.statementIndex);
        const presenceParameterKeys = [...presenceFacts];
        const initializerSpan = statement?.kind === "typedDeclaration" ? statement.payloadSpans.initializer : undefined;
        const recordSource = initializerSpan
          ? input.logicalTextByStatementIndex?.get(value.statementIndex) ?? `${" ".repeat(initializerSpan.start)}${statement?.kind === "typedDeclaration" ? statement.initializer : ""}`
          : "";
      const valueExpression = value.valueExpression
          ? moduleRecordValueExpressionFor({
              statementIndex: value.statementIndex,
              ownerIndex: definition.statementIndex,
              source: recordSource,
              expression: value.valueExpression,
              expectedTypeIdentity: value.typeIdentity,
              presenceFacts
            })
          : value.constructor
            ? (() => {
                const reference = recordReferenceSemantic(value.statementIndex, definition.statementIndex, statement?.kind === "typedDeclaration" ? statement.initializer : "", initializerSpan ?? statement?.keywordSpan ?? { start: 0, end: 0 }, value.typeIdentity, presenceFacts);
                return reference.constructor
                  ? { kind: "constructor" as const, span: initializerSpan ?? statement?.keywordSpan ?? { start: 0, end: 0 }, constructor: reference.constructor }
                  : null;
              })()
            : null;
        let target = value.typeIdentity
          ? valueExpression
            ? {
                kind: "recordValue" as const,
                statementId: value.statementId,
                statementIndex: value.statementIndex,
                typeIdentity: value.typeIdentity,
                ...(valueExpression.kind === "coalesce" ? { valueExpressionKind: "coalesce" as const } : {})
              }
            : value.constructor
            ? {
                kind: "recordValue" as const,
                statementId: value.statementId,
                statementIndex: value.statementIndex,
                typeIdentity: value.typeIdentity,
              }
            : value.reference
              ? (() => {
                  const resolved = recordSourceLookup(
                    value.statementIndex,
                    definition.statementIndex,
                    value.reference.name,
                    value.reference.span
                  );
                  if (resolved.kind === "blocked" && resolved.diagnostic) addLocal(value.statementIndex, resolved.diagnostic);
                  return resolved.kind === "record" && resolved.typeIdentity === value.typeIdentity ? resolved.target : null;
                })()
              : null
          : null;
        const recordParameterTarget = target?.kind === "recordParameter" ? target : null;
        if (
          recordParameterTarget &&
          stateByIndex.get(
            definitionStates.find((candidate) => candidate.statementId === recordParameterTarget.definitionStatementId)?.statementIndex ?? -1
          )?.parameters[recordParameterTarget.parameterIndex]?.optional === true &&
          !presenceParameterKeys.includes(moduleParameterPresenceKey(recordParameterTarget.definitionStatementId, recordParameterTarget.parameterIndex))
        ) {
          addLocal(value.statementIndex, issue(
            "module-optional-value-required",
            value.reference?.span ?? statement?.nameSpan ?? statement?.keywordSpan ?? { start: 0, end: 0 },
            `optional module parameter の record 値「${value.reference?.name ?? value.name}」は hasValue で存在を確認してから参照してください。`,
            { presentation: { key: "diagnostic.module-optional-value-required", parameters: { name: value.reference?.name ?? value.name } } }
          ));
          target = null;
        }
        const fields = value.constructor
          ? analyzeRecordConstructorFields(
              value.statementIndex,
              definition.statementIndex,
              value.constructor.fields,
              new Set(presenceParameterKeys)
            )
          : [];
        const fieldExpressions = valueExpression && recordDefinitionFor(value.typeIdentity)
          ? recordDefinitionFor(value.typeIdentity)!.fields.map((field) => ({
              field: field.identity,
              expression: scalarTypeOfDslValueType(field.type)
                ? moduleRecordFieldExpressionFor(valueExpression, { ...field, type: scalarTypeOfDslValueType(field.type)! })
                : null,
              valueExpression: valueExpression.kind === "constructor"
                ? valueExpression.constructor.fields.find((candidate) => candidate.field.fieldIndex === field.fieldIndex)?.valueExpression ?? null
                : null
            }))
          : value.constructor
            ? fields.map((field) => ({
                field: field.field,
                expression: field.expression,
                valueExpression: field.valueExpression ?? null
              }))
            : [];
        const result: ModuleRecordValueSemantic = {
          value,
          target,
          fields,
          valueExpression,
          fieldExpressions,
          presenceParameterKeys,
          declaredValueType: value.declaredValueType
        };
        if (statementIsExported(statement) && !isDirectModuleChild(statement!, definition.statementIndex)) {
          addLocal(value.statementIndex, {
            code: "module-invalid-export",
            span: (statement!.kind === "typedDeclaration" || statement!.kind === "element" ? statement!.exportSpan : null) ?? statement!.nameSpan ?? statement!.keywordSpan,
            message: "export は module 直下の名前付き record value にのみ指定できます。",
            presentation: { key: "diagnostic.module-invalid-export" }
          });
        }
        return result;
      });
    recordValuesByDefinition.set(definition.statementIndex, definitionRecordValues);
    const definitionExports = [...body.exports];
    const exportedNames = new Set(definitionExports.map((entry) => entry.name));
    for (const recordValue of definitionRecordValues) {
      const statement = statements[recordValue.value.statementIndex];
      if (!statementIsExported(statement) || !isDirectModuleChild(statement!, definition.statementIndex)) continue;
      if (!recordValue.value.name || !recordValue.value.typeIdentity || !recordValue.target) continue;
      if (exportedNames.has(recordValue.value.name)) {
        addLocal(recordValue.value.statementIndex, {
          code: "module-duplicate-export",
          span: (statement!.kind === "typedDeclaration" || statement!.kind === "element" ? statement!.exportSpan : null) ?? statement!.nameSpan ?? statement!.keywordSpan,
          message: `module export「${recordValue.value.name}」が重複しています。`,
          presentation: { key: "diagnostic.module-duplicate-export", parameters: { name: recordValue.value.name } }
        });
        continue;
      }
      const recordDefinition = recordDefinitionFor(recordValue.value.typeIdentity);
      if (!recordDefinition) continue;
      definitionExports.push({
        kind: "record",
        ownerModuleDefinitionStatementId: definition.statementId,
        exportedStatementId: recordValue.value.statementId,
        exportedStatementIndex: recordValue.value.statementIndex,
        sourceOrder: recordValue.value.statementIndex,
        name: recordValue.value.name,
        typeIdentity: recordValue.value.typeIdentity,
        definition: recordDefinition,
        backingTarget: recordValue.target
      });
      exportedNames.add(recordValue.value.name);
    }
    const collectionAnalysis = sourceNamespace.geometryArraySemanticAnalysis;
    const definitionCollections = collectionAnalysis
      ? [
          ...collectionAnalysis.genericValues,
          ...collectionAnalysis.values.map((value) => ({
            ...value,
            valueType: { kind: "array" as const, elementType: { kind: value.type.elementType as "point" | "line" | "path" } }
          }))
        ].filter((value) => value.ownerModuleDefinitionStatementIndex === definition.statementIndex)
      : [];
    for (const collectionValue of definitionCollections) {
      const statement = statements[collectionValue.statementIndex];
      if (!statement || !statementIsExported(statement) || !isDirectModuleChild(statement, definition.statementIndex)) continue;
      if (!collectionValue.name || exportedNames.has(collectionValue.name)) {
        if (collectionValue.name && exportedNames.has(collectionValue.name)) {
          addLocal(collectionValue.statementIndex, {
            code: "module-duplicate-export",
            span: (statement.kind === "typedDeclaration" || statement.kind === "element" ? statement.exportSpan : null) ?? statement.nameSpan ?? statement.keywordSpan,
            message: `module export「${collectionValue.name}」が重複しています。`,
            presentation: { key: "diagnostic.module-duplicate-export", parameters: { name: collectionValue.name } }
          });
        }
        continue;
      }
      definitionExports.push({
        kind: "collection",
        ownerModuleDefinitionStatementId: definition.statementId,
        exportedStatementId: collectionValue.statementId,
        exportedStatementIndex: collectionValue.statementIndex,
        sourceOrder: collectionValue.statementIndex,
        name: collectionValue.name,
        valueType: collectionValue.valueType
      });
      exportedNames.add(collectionValue.name);
    }
    exportsByDefinition.set(definition.statementIndex, definitionExports);
  }

  instances.length = 0;
  analyzeInstances();

  const semanticDefinitions: ModuleDefinitionSemantic[] = definitionStates.map((definition) => ({
    statementId: definition.statementId,
    statementIndex: definition.statementIndex,
    name: definition.statement.name,
    ...(input.documentId ? {
      documentId: input.documentId,
      identity: qualifySemanticIdentity(input.documentId, definition.statementId),
      ...(input.source ? { declaration: statementLocationFor(input.source, definition.statement) } : {})
    } : {}),
    declarationScopeId: definition.declarationScopeId,
    bodyScopeId: definition.bodyScopeId,
    scopeId: definition.declarationScopeId,
    parameters: definition.parameters,
    localScalars: localScalarsByDefinition.get(definition.statementIndex) ?? [],
    mappedScalarCollectionBodies: mappedScalarCollectionBodiesByDefinition.get(definition.statementIndex) ?? [],
    mappedRecordCollectionBodies: mappedRecordCollectionBodiesByDefinition.get(definition.statementIndex) ?? [],
    mappedGeometryCollectionBodies: mappedGeometryCollectionBodiesByDefinition.get(definition.statementIndex) ?? [],
    localGeometryValues: localGeometryValuesByDefinition.get(definition.statementIndex) ?? [],
    recordValues: recordValuesByDefinition.get(definition.statementIndex) ?? [],
    bodyStatements: bodyStatementsByDefinition.get(definition.statementIndex) ?? [],
    exports: exportsByDefinition.get(definition.statementIndex) ?? [],
    bodyStatementIds: definition.bodyStatementIndexes.flatMap((index) => {
      const statementId = stableStatementIdByIndex.get(index);
      return statementId ? [statementId] : [];
    })
  }));

  const callEdges = moduleCallEdges(instances);
  const recursionCycles = moduleRecursionCycles(semanticDefinitions, callEdges);
  const recursionInstancesByStatementId = new Map(instances.map((instance) => [instance.statementId, instance] as const));
  for (const instance of instances) {
    const cycle = recursionCycles.get(instance.statementId);
    if (!cycle) continue;
    const statement = statements[instance.statementIndex];
    if (statement.kind !== "moduleInstance") continue;
    const relatedSources: DiagnosticRelatedSource[] = [];
    for (const edge of cycle) {
      if (edge.instanceStatementId === instance.statementId) continue;
      const relatedInstance = recursionInstancesByStatementId.get(edge.instanceStatementId);
      if (!relatedInstance) continue;
      const relatedStatement = statements[relatedInstance.statementIndex];
      if (relatedStatement.kind !== "moduleInstance") continue;
      relatedSources.push({
        statementIndex: relatedInstance.statementIndex,
        span: relatedStatement.moduleNameSpan ?? relatedStatement.keywordSpan,
        message: "module recursion cycle に含まれる呼び出しです。",
        presentation: { key: "diagnostic.related.module-recursion" }
      });
    }
    addLocal(
      instance.statementIndex,
      issue(
        "module-recursion",
        statement.moduleNameSpan ?? statement.keywordSpan,
        `module recursion は許可されていません:「${statement.moduleName}」。`,
        {
          relatedSources,
          presentation: { key: "diagnostic.module-recursion", parameters: { name: statement.moduleName } }
        }
      )
    );
  }

  for (const [statementIndex, local] of localDiagnosticsByStatement) {
    for (const diagnostic of local) {
      const statement = statements[statementIndex];
      const relatedInformation = (diagnostic.relatedSources ?? []).flatMap((related): DslDiagnosticRelatedInformation[] => {
        const relatedStatement = statements[related.statementIndex];
        if (!relatedStatement) return [];
        const physicalSpan = sourceSpanFor(spans, relatedStatement, related.span);
        return physicalSpan ? [{
          message: related.message,
          physicalSpan,
          ...(related.presentation ? { presentation: related.presentation } : {})
        }] : [];
      });
      diagnostics.push(toDiagnostic(spans, statement, diagnostic, relatedInformation));
    }
  }
  const definitionsByStatementId = new Map(semanticDefinitions.map((definition) => [definition.statementId, definition] as const));
  const instancesByStatementId = new Map(instances.map((instance) => [instance.statementId, instance] as const));
  const geometryValues = [...geometryValuesByStatementIndex.values()].sort((left, right) => left.statementIndex - right.statementIndex);
  const geometryValuesByStatementId = new Map(geometryValues.map((value) => [value.statementId, value] as const));
  const result: ModuleSemanticAnalysis = {
    ...(input.documentId ? { documentId: input.documentId } : {}),
    ...(input.source ? { source: input.source } : {}),
    definitions: semanticDefinitions,
    instances,
    definitionsByStatementId,
    instancesByStatementId,
    mappedRecordCollectionBodies: rootMappedRecordCollectionBodies,
    callEdges,
    rootScalarExpressionsByStatementId,
    rootGeometryReferencesByStatementId,
    rootRecordValuesByStatementId,
    geometryValues,
    geometryValuesByStatementId,
    geometryValuesByStatementIndex,
    rootParentReferencesByStatementId,
    diagnostics
  };
  if (input.documentId) {
    return decorateDocumentQualifiedModuleSemantics(result, input.documentId);
  }
  return result;
};

export const analyzeModuleSemantic = analyzeModuleSemantics;

/** Adds document-qualified ownership to the central Module semantic result.
 * Same-document callers omit `documentId` and retain their established local
 * identity shape; graph-backed callers use this one decoration path for
 * parameters, body statements, exports, references, and instances. */
export const decorateDocumentQualifiedModuleSemantics = (
  analysis: ModuleSemanticAnalysis,
  documentId: import("../document/multiDocumentPrimitives").DocumentId
): ModuleSemanticAnalysis => {
  const identityFor = (statementId: StatementIdentity) => qualifySemanticIdentity(documentId, statementId);
  const mapTarget = (target: unknown): unknown => {
    if (!target || typeof target !== "object") return target;
    const value = target as Record<string, unknown>;
    const result = { ...value };
    if (typeof value.statementId === "string" && value.identity === undefined) {
      result.identity = identityFor(value.statementId);
    }
    if (value.kind === "parameter" && typeof value.definitionStatementId === "string" && value.definitionIdentity === undefined) {
      result.definitionIdentity = identityFor(value.definitionStatementId);
    }
    if (typeof value.instanceStatementId === "string" && value.instanceIdentity === undefined) {
      result.instanceIdentity = identityFor(value.instanceStatementId);
    }
    if (typeof value.exportedStatementId === "string" && value.exportedIdentity === undefined) {
      result.exportedIdentity = identityFor(value.exportedStatementId);
    }
    if (value.kind === "recordField") result.record = mapTarget(value.record);
    return result;
  };
  const mapExpression = (expression: ModuleScalarExpressionSemantic): ModuleScalarExpressionSemantic => ({
    ...expression,
    references: expression.references.map((reference) => ({ ...reference, target: mapTarget(reference.target) as ModuleSourceTarget | null })),
    geometryProperties: expression.geometryProperties.map((property) => ({ ...property, target: mapTarget(property.target) as ModuleGeometryPropertySourceTarget | null })),
    geometryBuiltinArguments: expression.geometryBuiltinArguments.map((argument) => ({
      ...argument,
      reference: mapGeometryReference(argument.reference)
    })),
    hasValueParameters: expression.hasValueParameters.map((parameter) => ({
      ...parameter,
      definitionIdentity: parameter.definitionIdentity ?? identityFor(parameter.definitionStatementId)
    }))
  });
  const mapGeometryReference = (reference: ModuleGeometryReferenceSemantic): ModuleGeometryReferenceSemantic => ({
    ...reference,
    target: mapTarget(reference.target) as ModuleGeometrySourceTarget | null,
    coordinate: reference.coordinate
      ? {
          ...reference.coordinate,
          x: reference.coordinate.x ? mapExpression(reference.coordinate.x) : null,
          y: reference.coordinate.y ? mapExpression(reference.coordinate.y) : null
        }
      : null
  });
  const mapGeometryConstruction = (construction: ModuleGeometryConstructionSemantic): ModuleGeometryConstructionSemantic => {
    const visit = (value: unknown): unknown => {
      if (value === null || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(visit);
      if ("expectedGeometryKind" in value && "resolution" in value && "span" in value) {
        return mapGeometryReference(value as ModuleGeometryReferenceSemantic);
      }
      if ("ast" in value && "type" in value) return mapExpression(value as ModuleScalarExpressionSemantic);
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
    };
    return visit(construction) as ModuleGeometryConstructionSemantic;
  };
  const mapGeometryValueExpression = (expression: import("./moduleSemanticTypes").ModuleGeometryValueExpressionSemantic): import("./moduleSemanticTypes").ModuleGeometryValueExpressionSemantic => {
    if (expression.kind === "reference") return { ...expression, reference: mapGeometryReference(expression.reference) };
    if (expression.kind === "construction") return { ...expression, construction: mapGeometryConstruction(expression.construction) };
    if (expression.kind === "none") return expression;
    if (expression.kind === "coalesce") return { ...expression, left: mapGeometryValueExpression(expression.left), right: mapGeometryValueExpression(expression.right) };
    if (expression.kind === "if") {
      return {
        ...expression,
        condition: expression.condition ? mapExpression(expression.condition) : null,
        thenBranch: expression.thenBranch ? mapGeometryValueExpression(expression.thenBranch) : null,
        elseBranch: expression.elseBranch ? mapGeometryValueExpression(expression.elseBranch) : null
      };
    }
    return {
      ...expression,
      scrutinee: expression.scrutinee ? mapExpression(expression.scrutinee) : null,
      arms: expression.arms.map((arm) => ({ ...arm, expression: arm.expression ? mapGeometryValueExpression(arm.expression) : null }))
    };
  };
  const mapRecordReference = (reference: ModuleRecordReferenceSemantic): ModuleRecordReferenceSemantic => ({
    ...reference,
    target: mapTarget(reference.target) as ModuleRecordSourceTarget | null,
    constructor: reference.constructor
      ? {
          ...reference.constructor,
          fields: reference.constructor.fields.map((field) => ({
            ...field,
            expression: field.expression ? mapExpression(field.expression) : null,
            valueExpression: field.valueExpression ? mapRecordFieldValueExpression(field.valueExpression) : null
          }))
        }
      : null
  });
  const mapRecordFieldValue = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(mapRecordFieldValue);
    if ("expectedGeometryKind" in value && "resolution" in value && "span" in value) {
      return mapGeometryReference(value as ModuleGeometryReferenceSemantic);
    }
    if ("ast" in value && "type" in value) return mapExpression(value as ModuleScalarExpressionSemantic);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      key === "target" ? mapTarget(child) : mapRecordFieldValue(child)
    ]));
  };
  const mapRecordFieldValueExpression = (
    expression: ModuleRecordFieldValueExpressionSemantic
  ): ModuleRecordFieldValueExpressionSemantic => {
    if (expression.kind === "scalar") return { ...expression, expression: mapExpression(expression.expression) };
    if (expression.kind === "geometry") {
      return {
        ...expression,
        expression: expression.expression ? mapGeometryValueExpression(expression.expression) : null
      };
    }
    if (expression.kind === "record") {
      return {
        ...expression,
        expression: expression.expression ? mapRecordValueExpression(expression.expression) : null
      };
    }
    return { ...expression, value: mapRecordFieldValue(expression.value) };
  };
  const mapRecordValueExpression = (expression: ModuleRecordValueExpressionSemantic): ModuleRecordValueExpressionSemantic => {
    if (expression.kind === "constructor") {
      return {
        ...expression,
        constructor: {
          ...expression.constructor,
          fields: expression.constructor.fields.map((field) => ({
            ...field,
            expression: field.expression ? mapExpression(field.expression) : null,
            valueExpression: field.valueExpression ? mapRecordFieldValueExpression(field.valueExpression) : null
          }))
        }
      };
    }
    if (expression.kind === "reference" || expression.kind === "collectionIndex") {
      return { ...expression, reference: mapRecordReference(expression.reference) };
    }
    if (expression.kind === "if") {
      return {
        ...expression,
        condition: expression.condition ? mapExpression(expression.condition) : null,
        thenBranch: expression.thenBranch ? mapRecordValueExpression(expression.thenBranch) : null,
        elseBranch: expression.elseBranch ? mapRecordValueExpression(expression.elseBranch) : null
      };
    }
    if (expression.kind === "none" || expression.kind === "coalesce") return expression;
    return {
      ...expression,
      scrutinee: expression.scrutinee ? mapExpression(expression.scrutinee) : null,
      arms: expression.arms.map((arm) => ({
        ...arm,
        expression: arm.expression ? mapRecordValueExpression(arm.expression) : null
      }))
    };
  };
  const mapArgument = (argument: ModuleArgumentSemantic): ModuleArgumentSemantic => {
    if (argument.kind === "scalar") return { ...argument, expression: mapExpression(argument.expression) };
    if (argument.kind === "geometry") return { ...argument, reference: mapGeometryReference(argument.reference) };
    if (argument.kind === "collection") return argument;
    return { ...argument, reference: mapRecordReference(argument.reference) };
  };
  const definitions = analysis.definitions.map((definition) => ({
    ...definition,
    documentId,
    identity: definition.identity ?? identityFor(definition.statementId),
    parameters: definition.parameters.map((parameter) => ({
      ...parameter,
      definitionIdentity: parameter.definitionIdentity ?? identityFor(parameter.definitionStatementId),
      defaultExpression: parameter.defaultExpression ? mapExpression(parameter.defaultExpression) : null
    })),
    localScalars: definition.localScalars.map((scalar) => ({
      ...scalar,
      identity: identityFor(scalar.statementId),
      initializer: scalar.initializer ? mapExpression(scalar.initializer) : null
    })),
    mappedScalarCollectionBodies: definition.mappedScalarCollectionBodies.map((mapped) => ({
      ...mapped,
      body: mapExpression(mapped.body)
    })),
    mappedRecordCollectionBodies: (definition.mappedRecordCollectionBodies ?? []).map((mapped) => ({
      ...mapped,
      fields: mapped.fields.map((field) => ({ ...field, body: mapExpression(field.body) }))
    })),
    mappedGeometryCollectionBodies: (definition.mappedGeometryCollectionBodies ?? []).map((mapped) => ({
      ...mapped,
      body: mapGeometryValueExpression(mapped.body)
    })),
    localGeometryValues: definition.localGeometryValues.map((value) => ({
      ...value,
      identity: value.identity ?? identityFor(value.statementId),
      initializer: value.initializer ? mapGeometryReference(value.initializer) : null,
      construction: value.construction ? mapGeometryConstruction(value.construction) : null,
      valueExpression: value.valueExpression ? mapGeometryValueExpression(value.valueExpression) : null,
      backingTarget: mapTarget(value.backingTarget) as ModuleGeometrySourceTarget | null
    })),
    recordValues: definition.recordValues.map((value) => ({
      ...value,
      identity: value.identity ?? identityFor(value.value.statementId),
      target: mapTarget(value.target) as ModuleRecordSourceTarget | null,
      fields: value.fields.map((field) => ({
        ...field,
        expression: field.expression ? mapExpression(field.expression) : null,
        valueExpression: field.valueExpression ? mapRecordFieldValueExpression(field.valueExpression) : null
      })),
      valueExpression: value.valueExpression ? mapRecordValueExpression(value.valueExpression) : null,
      fieldExpressions: value.fieldExpressions.map((field) => ({
        ...field,
        expression: field.expression ? mapExpression(field.expression) : null,
        valueExpression: field.valueExpression ? mapRecordFieldValueExpression(field.valueExpression) : null
      }))
    })),
    bodyStatements: definition.bodyStatements.map((statement) => ({
      ...statement,
      identity: identityFor(statement.statementId),
      scalarExpressions: statement.scalarExpressions.map((site) => ({ ...site, expression: mapExpression(site.expression) })),
      geometryReferences: statement.geometryReferences.map((site) => ({ ...site, reference: mapGeometryReference(site.reference) })),
      textTemplateHoles: statement.textTemplateHoles.map((site) => ({ ...site, expression: mapExpression(site.expression) })),
      scalarTarget: mapTarget(statement.scalarTarget) as ModuleScalarSourceTarget | null
    })),
    exports: definition.exports.map((entry) => ({
      ...entry,
      ownerModuleDefinitionIdentity: identityFor(entry.ownerModuleDefinitionStatementId),
      exportedIdentity: identityFor(entry.exportedStatementId)
    }))
  }));
  const instances = analysis.instances.map((instance) => ({
    ...instance,
    documentId,
    identity: instance.identity ?? identityFor(instance.statementId),
    callerModuleDefinitionIdentity: instance.callerModuleDefinitionStatementId
      ? identityFor(instance.callerModuleDefinitionStatementId)
      : null,
    callee: instance.callee
      ? {
          ...instance.callee,
          definitionIdentity: instance.callee.definitionIdentity ?? identityFor(instance.callee.definitionStatementId),
          definitionDocumentId: instance.callee.definitionDocumentId ?? documentId
        }
      : null,
    parameterBindings: instance.parameterBindings.map((binding) => ({
      ...binding,
      value: binding.value ? mapArgument(binding.value) : null
    }))
  }));
  const callEdges = analysis.callEdges.map((edge) => ({
    ...edge,
    callerIdentity: edge.callerIdentity ?? identityFor(edge.callerModuleDefinitionStatementId),
    calleeIdentity: edge.calleeIdentity ?? identityFor(edge.calleeModuleDefinitionStatementId),
    instanceIdentity: edge.instanceIdentity ?? identityFor(edge.instanceStatementId)
  }));
  const geometryValues = analysis.geometryValues.map((value) => ({
    ...value,
    identity: value.identity ?? identityFor(value.statementId),
    initializer: value.initializer ? mapGeometryReference(value.initializer) : null,
    construction: value.construction ? mapGeometryConstruction(value.construction) : null,
    valueExpression: value.valueExpression ? mapGeometryValueExpression(value.valueExpression) : null,
    backingTarget: mapTarget(value.backingTarget) as ModuleGeometrySourceTarget | null
  }));
  const rootScalarExpressionsByStatementId = new Map(
    [...analysis.rootScalarExpressionsByStatementId].map(([statementId, site]) => [
      statementId,
      { ...site, expression: mapExpression(site.expression) }
    ] as const)
  );
  const rootGeometryReferencesByStatementId = new Map(
    [...analysis.rootGeometryReferencesByStatementId].map(([statementId, sites]) => [
      statementId,
      sites.map((site) => ({ ...site, reference: mapGeometryReference(site.reference) }))
    ] as const)
  );
  const rootRecordValuesByStatementId = new Map(
    [...analysis.rootRecordValuesByStatementId].map(([statementId, value]) => [
      statementId,
      {
        ...value,
        identity: value.identity ?? identityFor(value.value.statementId),
        target: mapTarget(value.target) as ModuleRecordSourceTarget | null,
        valueExpression: value.valueExpression ? mapRecordValueExpression(value.valueExpression) : null,
        fields: value.fields.map((field) => ({
          ...field,
          expression: field.expression ? mapExpression(field.expression) : null,
          valueExpression: field.valueExpression ? mapRecordFieldValueExpression(field.valueExpression) : null
        })),
        fieldExpressions: value.fieldExpressions.map((field) => ({
          ...field,
          expression: field.expression ? mapExpression(field.expression) : null,
          valueExpression: field.valueExpression ? mapRecordFieldValueExpression(field.valueExpression) : null
        }))
      }
    ] as const)
  );
  const definitionsByQualifiedIdentity = new Map(
    definitions.flatMap((definition) => definition.identity ? [[
      JSON.stringify([definition.identity.documentId, definition.identity.localIdentity]),
      definition
    ] as const] : [])
  );
  const instancesByQualifiedIdentity = new Map(
    instances.flatMap((instance) => instance.identity ? [[
      JSON.stringify([instance.identity.documentId, instance.identity.localIdentity]),
      instance
    ] as const] : [])
  );
  return {
    ...analysis,
    documentId,
    definitions,
    instances,
    definitionsByStatementId: new Map(definitions.map((definition) => [definition.statementId, definition] as const)),
    instancesByStatementId: new Map(instances.map((instance) => [instance.statementId, instance] as const)),
    callEdges,
    rootScalarExpressionsByStatementId,
    rootGeometryReferencesByStatementId,
    rootRecordValuesByStatementId,
    mappedRecordCollectionBodies: analysis.mappedRecordCollectionBodies.map((mapped) => ({
      ...mapped,
      fields: mapped.fields.map((field) => ({ ...field, body: mapExpression(field.body) }))
    })),
    geometryValues,
    geometryValuesByStatementId: new Map(geometryValues.map((value) => [value.statementId, value] as const)),
    geometryValuesByStatementIndex: new Map(geometryValues.map((value) => [value.statementIndex, value] as const)),
    definitionsByQualifiedIdentity,
    instancesByQualifiedIdentity
  };
};
