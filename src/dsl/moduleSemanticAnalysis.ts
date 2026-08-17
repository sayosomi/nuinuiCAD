import { exactPhysicalSpan, type DiagnosticSpanContext } from "./dslDiagnosticSpan";
import { commonArgSpecs, constructionFor, isGeometryDeclarationCategory, type DslGeometryDeclarationCategory } from "./dslConstructions";
import {
  isModuleGeometryInterfaceAssignable,
  moduleGeometryInterfaceTypeOf,
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
import type { DslDiagnostic, DslModuleParameterType, DslSpan, DslStatement } from "./dslTypes";
import {
  parseAndCheckModuleScalarExpression,
  type ModuleGeometryBuiltinReferenceResolver,
  type ModuleGeometryPropertyReferenceInput,
  type ModuleGeometryPropertyReferenceResolution,
  type ModuleScalarLocalDiagnostic,
  type ModuleScalarReferenceResolution
} from "./moduleScalarExpression";
import { moduleCallEdges, recursiveModuleInstanceIds } from "./moduleCallGraph";
import { analyzeModuleBody } from "./moduleBodySemantic";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import { coordinateComponent } from "./dslParameterSpanScanner";
import { splitDslList } from "./dslTokens";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { BindingId } from "../scalars/bindingCatalog";
import { isKnownNumericComputedGeometryProperty } from "../geometry/numericExpressions";
import { isDerivedPointKeyForGeometryCategory, isKnownDerivedPointKey, isLineEndpointPointKey } from "../model/pointAnchors";
import { scopeChain, type ScopeId } from "../scalars/lexicalScopeIndex";
import {
  resolveModuleLexicalDeclaration as resolveSharedModuleLexicalDeclaration,
  resolveModuleLexicalPath as resolveSharedModuleLexicalPath
} from "./moduleLexicalResolution";
import type { ScalarType } from "../scalars/types";
import type { StatementIdentity } from "../document/statementIdentity";
import type {
  ModuleArgumentSemantic,
  ModuleDefinitionSemantic,
  ModuleGeometryPropertySourceTarget,
  ModuleGeometryReferenceSemantic,
  ModuleGeometryReferenceSite,
  ModuleGeometrySourceTarget,
  ModuleParentReferenceSemantic,
  ModuleParentReferenceSite,
  ModuleParentSourceTarget,
  ModuleInstanceSemantic,
  ModuleGeometryReferenceRole,
  ModuleScalarExpressionSemantic,
  ModuleScalarExpressionSite,
  ModuleScalarSourceTarget,
  ModuleSemanticAnalysis,
  ModuleSemanticAnalysisInput,
  ResolvedModuleCallee,
  ResolvedModuleExport,
  ResolvedModuleParameter,
  ResolvedModuleParameterBinding
} from "./moduleSemanticTypes";

type LocalDiagnostic = ModuleScalarLocalDiagnostic;

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

type ReferenceResolution = ModuleScalarReferenceResolution;

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
  issue: LocalDiagnostic
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
    ...(issue.expectedType ? { expectedType: issue.expectedType } : {}),
    ...(issue.actualType ? { actualType: issue.actualType } : {})
  };
};

const issue = (code: string, span: DslSpan, message: string, extra: Partial<LocalDiagnostic> = {}): LocalDiagnostic => ({
  code,
  span,
  message,
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
  const diagnostics: DslDiagnostic[] = [];
  const localDiagnosticsByStatement = new Map<number, LocalDiagnostic[]>();
  let suppressLocalDiagnostics = false;
  const addLocal = (statementIndex: number, local: LocalDiagnostic) => {
    if (suppressLocalDiagnostics) return;
    const bucket = localDiagnosticsByStatement.get(statementIndex) ?? [];
    bucket.push(local);
    localDiagnosticsByStatement.set(statementIndex, bucket);
  };
  const definitionStates: DefinitionState[] = [];
  const stateByIndex = new Map<number, DefinitionState>();
  const definitions = statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter((entry): entry is { statement: Extract<DslStatement, { kind: "moduleDefinition" }>; statementIndex: number } => entry.statement.kind === "moduleDefinition");

  for (const { statement, statementIndex } of definitions) {
    const statementId = statementIdAt(stableStatementIdByIndex, statementIndex);
    const declarationScopeId = sourceNamespace.scopeIndex.scopeOfStatement.get(statementIndex) ?? sourceNamespace.scopeIndex.rootScopeId;
    const bodyScopeId = `module:${statementId}`;
    const parameters: ResolvedModuleParameter[] = statement.parameters.map((parameter, parameterIndex) => ({
      definitionStatementId: statementId,
      parameterIndex,
      name: parameter.name,
      type: parameter.type,
      required: parameter.defaultValue === null,
      defaultValue: parameter.defaultValue,
      defaultSpan: parameter.defaultSpan,
      defaultExpression: null
    }));
    const parameterByName = new Map<string, { parameter: ResolvedModuleParameter; index: number }>();
    for (const [parameterIndex, parameter] of parameters.entries()) {
      if (parameterByName.has(parameter.name)) {
        addLocal(statementIndex, issue("module-parameter-duplicate", statement.parameters[parameterIndex].nameSpan ?? statement.keywordSpan, `module parameter「${parameter.name}」が重複しています。`));
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

  const bindingByStatementIndex = new Map<number, { bindingId: BindingId; statementId: StatementIdentity }>(input.documentScalarBindings ?? []);

  const resolveSourceScalar = (
    statementIndex: number,
    ownerIndex: number | null,
    name: string,
    boundaryOwnerIndex: number | null = ownerIndex,
    referenceSpan: DslSpan = { start: 0, end: name.length }
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
      return scalarExport?.kind === "geometry"
        ? {
            target: null,
            type: null,
            resolution: "invalid",
            diagnostic: issue("module-geometry-reference-in-scalar", qualified.memberSpan, `scalar expression ではgeometry export「${qualified.exportName}」を参照できません。`)
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
                : `module export「${qualified.exportName}」が見つかりません。`
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
      return { target: null, type: null, resolution, diagnostic: issue(code, qualified.memberSpan, message) };
    }
    const path = parseDslReferenceToken(name);
    const lookup = path.segments.length > 1
      ? resolveModuleLexicalPath(statementIndex, ownerIndex, path)
      : resolveModuleLexicalDeclaration(statementIndex, ownerIndex, name);
    if (lookup.kind === "parameter") {
      const type = scalarTypeOf(lookup.parameter.parameter.type);
      if (type) return { target: scalarParameterTarget(lookup.definition, lookup.parameter), type, resolution: "resolved" };
      const geometryTarget = geometryParameterTarget(lookup.definition, lookup.parameter);
      return { target: geometryTarget, type: null, resolution: "invalid", diagnostic: issue("module-scalar-geometry-reference", { start: 0, end: 0 }, `scalar expression では geometry parameter「${name}」を参照できません。`) };
    }
    if (lookup.kind === "iteration") {
      const iterationOwner = moduleOwnerIndexOf(statements, lookup.statementIndex);
      if (boundaryOwnerIndex !== null && iterationOwner !== boundaryOwnerIndex) {
        return { target: null, type: null, resolution: "outerCapture", diagnostic: issue("module-outer-capture", { start: 0, end: 0 }, `module body から outer scalar「${name}」を暗黙 capture できません。`) };
      }
      return { target: { ...lookup }, type: { kind: "number" }, resolution: "resolved" };
    }
    if (lookup.kind === "undefined") return { target: null, type: null, resolution: "undefined", diagnostic: issue("module-undefined-reference", { start: 0, end: 0 }, `未定義のmodule scalar「${name}」を参照しています。`) };
    if (lookup.kind === "forward") return { target: null, type: null, resolution: "forward", diagnostic: issue("module-forward-reference", { start: 0, end: 0 }, `module scalar「${name}」はこの位置より後で宣言されています。`) };
    if (lookup.kind === "ambiguous") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-ambiguous-reference", { start: 0, end: 0 }, `module scalar「${name}」を一意に解決できません。`) };
    if (lookup.kind === "invalidOverlayTraversal") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-invalid-reference", { start: 0, end: 0 }, `「${lookup.name}」はparameter/iteration namespaceではありません。`) };
    if (lookup.kind === "invalidTraversal") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-invalid-reference", { start: 0, end: 0 }, `「${lookup.declaration.name}」はnamespace/containerではありません。`) };
    const declaration = lookup.declaration;
    const declarationOwner = moduleOwnerIndexOf(statements, declaration.statementIndex);
    if (declaration.kind === "typedDeclaration" && declaration.statement.kind === "typedDeclaration") {
      const type = declaration.statement.declaredType;
      if (boundaryOwnerIndex !== null && declarationOwner !== boundaryOwnerIndex) {
        return { target: null, type: null, resolution: "outerCapture", diagnostic: issue("module-outer-capture", declaration.nameSpan ?? declaration.statement.keywordSpan, `module body から outer scalar「${name}」を暗黙 capture できません。`) };
      }
      const statementId = statementIdAt(stableStatementIdByIndex, declaration.statementIndex);
      if (boundaryOwnerIndex !== null) return { target: { kind: "moduleLocal", statementId, statementIndex: declaration.statementIndex }, type, resolution: "resolved" };
      const binding = bindingByStatementIndex.get(declaration.statementIndex);
      if (!binding) return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-document-binding-unavailable", declaration.nameSpan ?? declaration.statement.keywordSpan, `document scalar「${name}」のbinding identityを取得できません。`) };
      return { target: { kind: "documentBinding", bindingId: binding.bindingId, statementId: binding.statementId, statementIndex: declaration.statementIndex }, type, resolution: "resolved" };
    }
    const geometryTarget = declarationGeometryTarget(declaration, stableStatementIdByIndex);
    if (geometryTarget) {
      return { target: geometryTarget, type: null, resolution: "invalid", diagnostic: issue("module-geometry-reference-in-scalar", declaration.nameSpan ?? declaration.statement.keywordSpan, `scalar expression では geometry「${name}」を参照できません。`) };
    }
    return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-invalid-reference", declaration.nameSpan ?? declaration.statement.keywordSpan, `「${name}」はscalar bindingではありません。`) };
  };

  const resolveDefaultScalar = (definition: DefinitionState, parameterIndex: number, reference: { name: string; span: DslSpan }): ReferenceResolution => {
    const ownParameter = definition.parameterByName.get(reference.name);
    if (ownParameter) {
      if (ownParameter.index >= parameterIndex) {
        return { target: null, type: null, resolution: "forward", diagnostic: issue("module-default-parameter-order", reference.span, `default は earlier parameter のみ参照できます:「${reference.name}」。`) };
      }
      const type = scalarTypeOf(ownParameter.parameter.type);
      return type
        ? { target: scalarParameterTarget(definition, ownParameter), type, resolution: "resolved" }
        : { target: null, type: null, resolution: "invalid", diagnostic: issue("module-default-invalid-reference", reference.span, `default の参照先「${reference.name}」はscalar parameterではありません。`) };
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
    if (lookup.kind === "parameter") {
      const type = scalarTypeOf(lookup.parameter.parameter.type);
      return type
        ? { target: scalarParameterTarget(lookup.definition, lookup.parameter), type, resolution: "resolved" }
        : { target: null, type: null, resolution: "invalid", diagnostic: issue("module-default-invalid-reference", reference.span, `default の参照先「${reference.name}」はscalarではありません。`) };
    }
    if (lookup.kind === "iteration") {
      return { target: { ...lookup }, type: { kind: "number" }, resolution: "resolved" };
    }
    if (lookup.kind === "undefined") return { target: null, type: null, resolution: "undefined", diagnostic: issue("module-undefined-reference", reference.span, `未定義のmodule scalar「${reference.name}」を参照しています。`) };
    if (lookup.kind === "forward") return { target: null, type: null, resolution: "forward", diagnostic: issue("module-forward-reference", reference.span, `module scalar「${reference.name}」はこの位置より後で宣言されています。`) };
    if (lookup.kind === "ambiguous") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-ambiguous-reference", reference.span, `module scalar「${reference.name}」を一意に解決できません。`) };
    if (lookup.kind === "invalidOverlayTraversal") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-invalid-reference", reference.span, `「${lookup.name}」はparameter/iteration namespaceではありません。`) };
    if (lookup.kind === "invalidTraversal") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-invalid-reference", reference.span, `「${lookup.declaration.name}」はnamespace/containerではありません。`) };
    const declaration = lookup.declaration;
    if (declaration.kind === "typedDeclaration" && declaration.statement.kind === "typedDeclaration") {
      const declarationOwner = moduleOwnerIndexOf(statements, declaration.statementIndex);
      const type = declaration.statement.declaredType;
      const statementId = statementIdAt(stableStatementIdByIndex, declaration.statementIndex);
      if (declarationOwner !== null && stateByIndex.has(declarationOwner)) {
        return { target: { kind: "moduleLocal", statementId, statementIndex: declaration.statementIndex }, type, resolution: "resolved" };
      }
      const binding = bindingByStatementIndex.get(declaration.statementIndex);
      if (!binding) return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-document-binding-unavailable", reference.span, `definition site のscalar「${reference.name}」のbinding identityを取得できません。`) };
      return { target: { kind: "documentBinding", bindingId: binding.bindingId, statementId: binding.statementId, statementIndex: declaration.statementIndex }, type, resolution: "resolved" };
    }
    const geometryTarget = declarationGeometryTarget(lookup.declaration, stableStatementIdByIndex);
    return geometryTarget
      ? { target: geometryTarget, type: null, resolution: "invalid", diagnostic: issue("module-geometry-reference-in-default", reference.span, `default ではgeometry「${reference.name}」を参照できません。`) }
      : { target: null, type: null, resolution: "invalid", diagnostic: issue("module-default-invalid-reference", reference.span, `default の参照先「${reference.name}」はscalar bindingではありません。`) };
  };

  const resolveBodyScalar = (statementIndex: number, ownerIndex: number, reference: { name: string; span: DslSpan }): ReferenceResolution => {
    const resolution = resolveSourceScalar(statementIndex, ownerIndex, reference.name, ownerIndex, reference.span);
    if (resolution.diagnostic && resolution.diagnostic.span.start === 0 && resolution.diagnostic.span.end === 0) {
      return { ...resolution, diagnostic: { ...resolution.diagnostic, span: reference.span } };
    }
    return resolution;
  };

  const resolveBodyBareScalar = (statementIndex: number, ownerIndex: number, reference: { name: string; span: DslSpan }): ReferenceResolution | null => {
    const lookup = resolveModuleLexicalDeclaration(statementIndex, ownerIndex, reference.name);
    if (lookup.kind !== "iteration") return null;
    const iterationOwner = moduleOwnerIndexOf(statements, lookup.statementIndex);
    if (iterationOwner !== ownerIndex) {
      return { target: null, type: null, resolution: "outerCapture", diagnostic: issue("module-outer-capture", reference.span, `module body から outer scalar「${reference.name}」を暗黙 capture できません。`) };
    }
    return { target: { ...lookup }, type: { kind: "number" }, resolution: "resolved" };
  };

  const analyzeExpression = (
    statementIndex: number,
    raw: string,
    span: DslSpan,
    expectedType: ScalarType | null,
    resolver: (reference: { name: string; span: DslSpan }) => ReferenceResolution,
    bareResolver?: (reference: { name: string; span: DslSpan }) => ReferenceResolution | null,
    geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution,
    geometryBuiltinResolver?: ModuleGeometryBuiltinReferenceResolver
  ) => {
    const local: LocalDiagnostic[] = [];
    const semantic = parseAndCheckModuleScalarExpression({
      raw,
      span,
      expectedType,
      resolveReference: (reference) => {
        const resolution = resolver(reference);
        return resolution.diagnostic
          ? { ...resolution, diagnostic: { ...resolution.diagnostic, span: reference.span } }
          : resolution;
      },
      resolveBareReference: bareResolver,
      resolveGeometryProperty: geometryPropertyResolver,
      resolveGeometryBuiltin: geometryBuiltinResolver,
      diagnostics: local
    });
    for (const diagnostic of local) addLocal(statementIndex, diagnostic);
    return semantic;
  };

  for (const definition of definitionStates) {
    for (const [parameterIndex, parameter] of definition.parameters.entries()) {
      if (parameter.defaultValue === null || parameter.type === null) continue;
      const scalarType = scalarTypeOf(parameter.type);
      if (!scalarType) {
        addLocal(definition.statementIndex, issue("module-geometry-default", parameter.defaultSpan ?? definition.statement.keywordSpan, `geometry parameter「${parameter.name}」には default を指定できません。`));
        continue;
      }
      const defaultSpan = parameter.defaultSpan;
      if (!defaultSpan) continue;
      const semantic = analyzeExpression(
        definition.statementIndex,
        parameter.defaultValue,
        defaultSpan,
        scalarType,
        (reference) => resolveDefaultScalar(definition, parameterIndex, reference)
      );
      parameter.defaultExpression = semantic;
    }
    const directDeclarations = sourceNamespace.declarationsByScope.get(definition.bodyScopeId) ?? [];
    for (const declaration of directDeclarations) {
      const parameter = definition.parameterByName.get(declaration.name);
      if (parameter && declaration.statementIndex !== definition.statementIndex) {
        addLocal(declaration.statementIndex, issue("module-parameter-collision", declaration.nameSpan ?? declaration.statement.keywordSpan, `parameter「${declaration.name}」と同じmodule scopeで名前が衝突しています。`));
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
    nameSpan: DslSpan | null = null
  ): ModuleGeometryReferenceSemantic => ({
    source,
    span,
    expectedGeometryKind,
    role,
    target,
    coordinate,
    ...(nameSpan ? { nameSpan } : {}),
    resolution
  });

  type QualifiedModuleExportLookup =
    | {
        kind: "deferred";
        instance: SourceLexicalDeclaration;
        instanceName: string;
        instanceSpan: DslSpan;
        exportName: string;
        memberSpan: DslSpan;
      }
    | { kind: "undefined" | "forward" | "ambiguous" | "wrongKind" | "outerCapture"; instanceName: string; instanceSpan: DslSpan; exportName: string; memberSpan: DslSpan };

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
      if (lookup.declaration.kind !== "moduleInstance") {
        return null;
      }
      const instanceOwnerIndex = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
      if (ownerIndex !== null && instanceOwnerIndex !== ownerIndex) {
        return { kind: "outerCapture", instanceName, instanceSpan, exportName, memberSpan };
      }
      return { kind: "deferred", instance: lookup.declaration, instanceName, instanceSpan, exportName, memberSpan };
    }
    if (lookup.kind === "forward" || lookup.kind === "ambiguous") {
      if (lookup.declarations.every((declaration) => declaration.kind === "moduleInstance")) {
        return { kind: lookup.kind, instanceName, instanceSpan, exportName, memberSpan };
      }
      return null;
    }
    if (lookup.kind === "parameter" || lookup.kind === "iteration") return null;
    return { kind: "undefined", instanceName, instanceSpan, exportName, memberSpan };
  };

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
    | { kind: "geometry" }
    | { kind: "private" }
    | null => {
    const instance = instances.find((candidate) => candidate.statementId === qualified.instance.statementId);
    const definition = instance?.callee && stateByIndex.get(instance.callee.definitionStatementIndex);
    const exported = definition?.bodyStatementIndexes
      .map((statementIndex) => ({ statementIndex, statement: statements[statementIndex] }))
      .find(({ statement }) =>
        isDirectModuleChild(statement, definition.statementIndex) &&
        statement.name === qualified.exportName &&
        ((statement.kind === "typedDeclaration" && statement.exported) || (statement.kind === "element" && statement.exported))
      );
    if (!exported) {
      const privateMember = definition?.bodyStatementIndexes.some((statementIndex) =>
        isDirectModuleChild(statements[statementIndex], definition.statementIndex) && statements[statementIndex].name === qualified.exportName
      );
      return privateMember ? { kind: "private" } : null;
    }
    if (exported.statement.kind === "typedDeclaration" && exported.statement.declaredType) {
      return {
        kind: "scalar",
        exportedStatementId: statementIdAt(stableStatementIdByIndex, exported.statementIndex),
        exportedStatementIndex: exported.statementIndex,
        declaredType: exported.statement.declaredType
      };
    }
    return { kind: "geometry" };
  };

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
    addLocal(statementIndex, issue(code, qualified.memberSpan, message));
  };

  const coordinateScalar = (
    statementIndex: number,
    ownerIndex: number | null,
    source: string,
    component: "x" | "y",
    span: DslSpan,
    options: {
      scalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
      bareScalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
      geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
    }
  ): ModuleScalarExpressionSemantic | null => {
    const componentSpan = coordinateComponent(source, span, component);
    if (!componentSpan) return null;
    return analyzeExpression(
      statementIndex,
      source.slice(componentSpan.start, componentSpan.end),
      componentSpan,
      { kind: "number" },
      options.scalarResolver ?? ((reference) => resolveSourceScalar(statementIndex, ownerIndex, reference.name, ownerIndex, reference.span)),
      options.bareScalarResolver,
      options.geometryPropertyResolver
    );
  };

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
      scalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution;
      bareScalarResolver?: (reference: { name: string; span: DslSpan }) => ModuleScalarReferenceResolution | null;
      geometryPropertyResolver?: (reference: ModuleGeometryPropertyReferenceInput) => ModuleGeometryPropertyReferenceResolution;
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
    let referenceNameSpan: DslSpan | null = null;
    const semantic = (
      target: ModuleGeometrySourceTarget | null,
      resolution: ModuleGeometryReferenceSemantic["resolution"],
      coordinate: ModuleGeometryReferenceSemantic["coordinate"] = null,
      referenceRole: ModuleGeometryReferenceRole = role
    ) => geometryReference(rawValue, semanticSpan, expected, target, resolution, coordinate, referenceRole, referenceNameSpan);
    if (!trimmed) return semantic(null, "undefined");
    if (trimmed === "none") {
      if (options.allowNone) return semantic(null, "resolved");
      addLocal(statementIndex, issue("module-geometry-none", semanticSpan, `geometry ${expectedDiagnosticType} reference に none は指定できません。`));
      return semantic(null, "invalid");
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
          : `geometry reference の形式が一致しません(期待: ${expectedDiagnosticType})。`
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
      addLocal(statementIndex, issue("invalid-source-reference", invalidSpan, parsedReference.message));
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
    const derivedRole: ModuleGeometryReferenceRole = pointKey
      ? role === "lineEndpointReference" ? "lineEndpointReference" : "derivedPoint"
      : role;
    const rejectAccessor = (message: string) => {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, message));
      return semantic(null, "invalid", null, derivedRole);
    };
    if (pointKey && !isKnownDerivedPointKey(pointKey)) {
      return rejectAccessor(`geometry reference「${pointKey}」は既知のpoint anchorではありません。`);
    }
    if (pointKey && (role === "lineReference" || role === "lineReferenceList")) {
      return rejectAccessor("plain line referenceにはderived point accessorを指定できません。");
    }
    if (pointKey && role === "lineEndpointReference" && !isLineEndpointPointKey(pointKey)) {
      return rejectAccessor("line endpoint referenceにはstartまたはendを指定してください。");
    }
    const qualified = resolveQualifiedModuleExport(
      statementIndex,
      ownerIndex,
      base,
      semanticSpan,
      reference.pathRange.start
    );
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
        addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `geometry reference「${base}」の型が一致しません(期待: ${expectedDiagnosticType})。`));
        return semantic(null, "invalid", null, derivedRole);
      }
      return semantic(pointTarget, "resolved", null, derivedRole);
    }
    if (lookup.kind === "undefined") {
      addLocal(statementIndex, issue("module-undefined-geometry-reference", baseSpan, `未定義のgeometry「${base}」を参照しています。`));
      return semantic(null, "undefined", null, derivedRole);
    }
    if (lookup.kind === "iteration") {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `「${base}」はgeometryではありません。`));
      return semantic(null, "invalid", null, derivedRole);
    }
    if (lookup.kind === "forward") {
      addLocal(statementIndex, issue("module-forward-geometry-reference", baseSpan, `geometry「${base}」はこの位置より後で宣言されています。`));
      return semantic(null, "forward", null, derivedRole);
    }
    if (lookup.kind === "ambiguous") {
      addLocal(statementIndex, issue("module-ambiguous-geometry-reference", baseSpan, `geometry「${base}」を一意に解決できません。`));
      return semantic(null, "invalid", null, derivedRole);
    }
    if (lookup.kind === "invalidOverlayTraversal") {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `「${lookup.name}」はparameter/iteration namespaceではありません。`));
      return semantic(null, "invalid", null, derivedRole);
    }
    if (lookup.kind === "invalidTraversal") {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `「${lookup.declaration.name}」はnamespace/containerではありません。`));
      return semantic(null, "invalid", null, derivedRole);
    }
    const target = declarationGeometryTarget(lookup.declaration, stableStatementIdByIndex);
    const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
    if (!target) {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `「${base}」はgeometryではありません。`));
      return semantic(null, "invalid", null, derivedRole);
    }
    if (ownerIndex !== null && declarationOwner !== ownerIndex) {
      addLocal(statementIndex, issue("module-outer-capture", baseSpan, `module body から outer geometry「${base}」を暗黙 capture できません。`));
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
        addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `geometry reference「${base}」の型が一致しません(期待: ${expectedDiagnosticType})。`));
      return semantic(null, "invalid", null, derivedRole);
    }
    return semantic(pointTarget, "resolved", null, derivedRole);
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

  const resolveGeometryProperty = (
    statementIndex: number,
    ownerIndex: number | null,
    reference: ModuleGeometryPropertyReferenceInput
  ): ModuleGeometryPropertyReferenceResolution => {
    const type = isKnownNumericComputedGeometryProperty(reference.property) ? { kind: "number" as const } : null;
    if (!type) {
      return {
        target: null,
        type: null,
        resolution: "invalid",
        diagnostic: issue("module-unknown-geometry-property", reference.span, `geometry property「${reference.property}」を解決できません。`)
      };
    }
    const qualified = resolveQualifiedModuleExport(statementIndex, ownerIndex, reference.elementName, reference.elementNameSpan);
    if (qualified?.kind === "deferred") {
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
      if (!parameterTarget) {
        return {
          target: null,
          type: null,
          resolution: "invalid",
          diagnostic: issue("module-geometry-property-type-mismatch", reference.span, `「${reference.elementName}」はgeometry parameterではありません。`)
        };
      }
      return {
        target: { ...parameterTarget, kind: "parameterProperty", property: reference.property },
        type,
        resolution: "resolved"
      };
    }
    if (lookup.kind === "undefined") {
      return { target: null, type: null, resolution: "undefined", diagnostic: issue("module-undefined-geometry-reference", reference.span, `未定義のgeometry「${reference.elementName}」を参照しています。`) };
    }
    if (lookup.kind === "iteration") {
      return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-geometry-property-type-mismatch", reference.span, `「${reference.elementName}」はgeometryではありません。`) };
    }
    if (lookup.kind === "forward") {
      return { target: null, type: null, resolution: "forward", diagnostic: issue("module-forward-geometry-reference", reference.span, `geometry「${reference.elementName}」はこの位置より後で宣言されています。`) };
    }
    if (lookup.kind === "ambiguous") {
      return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-ambiguous-geometry-reference", reference.span, `geometry「${reference.elementName}」を一意に解決できません。`) };
    }
    if (lookup.kind === "invalidOverlayTraversal") {
      return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-geometry-property-type-mismatch", reference.span, `「${lookup.name}」はparameter/iteration namespaceではありません。`) };
    }
    if (lookup.kind === "invalidTraversal") {
      return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-geometry-property-type-mismatch", reference.span, `「${lookup.declaration.name}」はnamespace/containerではありません。`) };
    }
    const geometryTarget = declarationGeometryPropertyTarget(lookup.declaration, stableStatementIdByIndex, reference.property);
    if (!geometryTarget) {
      return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-geometry-property-type-mismatch", reference.span, `「${reference.elementName}」はgeometryではありません。`) };
    }
    const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
    if (ownerIndex !== null && declarationOwner !== ownerIndex) {
      return { target: null, type: null, resolution: "outerCapture", diagnostic: issue("module-outer-capture", reference.span, `module body から outer geometry「${reference.elementName}」を暗黙 capture できません。`) };
    }
    return {
      target: { ...geometryTarget, kind: "sourceGeometryProperty", property: reference.property },
      type,
      resolution: "resolved"
    };
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
  const rootParentReferencesByStatementId = new Map<StatementIdentity, ModuleParentReferenceSite>();
  const parentArg = commonArgSpecs.find((arg) => arg.special === "parent");
  const resolveRootParent = (
    statementIndex: number,
    rawValue: string,
    span: DslSpan
  ): ModuleParentReferenceSemantic => {
    const trimmed = rawValue.trim();
    const logicalSource = input.logicalTextByStatementIndex?.get(statementIndex);
    const trimmedStart = logicalSource
      ? logicalSource.indexOf(trimmed, Math.max(0, span.start))
      : -1;
    const semanticSpan = trimmedStart >= 0
      ? { start: trimmedStart, end: trimmedStart + trimmed.length }
      : span;
    const semantic = (
      target: ModuleParentSourceTarget | null,
      resolution: ModuleParentReferenceSemantic["resolution"],
      nameSpan?: DslSpan
    ): ModuleParentReferenceSemantic => ({
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
    const nameSpan = {
      start: semanticSpan.start + reference.pathRange.start,
      end: semanticSpan.start + reference.pathRange.end
    };
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
    const spec = statement.kind === "group"
      ? constructionFor("group", "")
      : constructionFor(statement.category, statement.construction);
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
      const sitesFor = (reference: ModuleGeometryReferenceSemantic, parameterKey: string | null, span: DslSpan) => {
        sites.push({ parameterKey, span, reference });
      };
      const referenceKind = (value: string): "module" | "ordinary" | "skip" => {
        const parsedReference = parseDslSourceReference(value);
        if (parsedReference.kind !== "valid") return "skip";
        const path = parsedReference.reference.path;
        if (path.segments.length === 1) return "ordinary";
        const firstSegment = path.segments[0];
        const instanceLookup = sourceDeclarationResolution(sourceNamespace, statementIndex, firstSegment);
        if (instanceLookup.kind === "resolved") {
          return instanceLookup.declaration.kind === "moduleInstance" ? "module" : "ordinary";
        }
        return "skip";
      };
      if (parameter.kind === "lineReferenceList") {
        let cursor = 0;
        for (const token of splitDslList(raw)) {
          const offset = raw.indexOf(token, cursor);
          cursor = offset + token.length;
          const tokenSpan = { start: valueSpan.start + Math.max(0, offset), end: valueSpan.start + Math.max(0, offset) + token.length };
          const kind = referenceKind(token);
          if (kind === "module") {
            sitesFor(resolveGeometry(statementIndex, null, token, tokenSpan, expected, { role: "lineReferenceList" }), parameterKey, tokenSpan);
          } else if (kind === "ordinary") {
            sitesFor(resolveRootGeometry(statementIndex, token, tokenSpan, expected, { role: "lineReferenceList" }), parameterKey, tokenSpan);
          }
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

  const instances: ModuleInstanceSemantic[] = [];
  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "moduleInstance") continue;
    const statementId = statementIdAt(stableStatementIdByIndex, statementIndex);
    const ownerIndex = moduleOwnerIndexOf(statements, statementIndex);
    const owner = ownerIndex === null ? null : stateByIndex.get(ownerIndex) ?? null;
    let callee: ResolvedModuleCallee | null = null;
    let calleeResolution: ModuleInstanceSemantic["calleeResolution"] = "undefined";
    const lookup = ownerIndex === null
      ? sourceDeclarationResolution(sourceNamespace, statementIndex, statement.moduleName)
      : resolveModuleLexicalDeclaration(statementIndex, ownerIndex, statement.moduleName);
    if (lookup.kind === "parameter" || lookup.kind === "iteration") {
      calleeResolution = "notModule";
    } else {
      if (lookup.kind === "resolved") {
        if (lookup.declaration.kind === "moduleDefinition" && lookup.declaration.statement.kind === "moduleDefinition") {
          callee = { definitionStatementId: statementIdAt(stableStatementIdByIndex, lookup.declaration.statementIndex), definitionStatementIndex: lookup.declaration.statementIndex, name: lookup.declaration.name };
          calleeResolution = "resolved";
        } else {
          calleeResolution = "notModule";
        }
      } else if (lookup.kind === "forward") calleeResolution = "forward";
      else if (lookup.kind === "ambiguous") calleeResolution = "ambiguous";
    }
    if (!callee) {
      const span = statement.moduleNameSpan ?? statement.keywordSpan;
      const message = calleeResolution === "forward"
        ? `module「${statement.moduleName}」はこの位置より後で宣言されています。`
        : calleeResolution === "notModule"
          ? `「${statement.moduleName}」はmodule definitionではありません。`
          : calleeResolution === "ambiguous"
            ? `module callee「${statement.moduleName}」を一意に解決できません。`
            : `module「${statement.moduleName}」が見つかりません。`;
      addLocal(statementIndex, issue(moduleCalleeDiagnosticCode(calleeResolution), span, message));
    }

    const parameterBindings: ResolvedModuleParameterBinding[] = [];
    const calleeState = callee ? stateByIndex.get(callee.definitionStatementIndex) : undefined;
    const argumentIndexes = new Map<string, number>();
    if (calleeState) {
      for (const [argumentIndex, argument] of statement.arguments.entries()) {
        if (argument.label === null) {
          continue;
        }
        if (argumentIndexes.has(argument.label)) {
          addLocal(statementIndex, issue("module-duplicate-argument", argument.labelSpan ?? argument.valueSpan, `argument「${argument.label}」が重複しています。`));
        } else argumentIndexes.set(argument.label, argumentIndex);
        const parameter = calleeState.parameterByName.get(argument.label);
        if (!parameter) addLocal(statementIndex, issue("module-unknown-argument", argument.labelSpan ?? argument.valueSpan, `module「${calleeState.statement.name}」にargument「${argument.label}」はありません。`));
      }
      for (const parameter of calleeState.parameters) {
        const argumentIndex = argumentIndexes.get(parameter.name);
        const argument = argumentIndex === undefined ? undefined : statement.arguments[argumentIndex];
        if (!argument) {
          if (parameter.required) addLocal(statementIndex, issue("module-missing-argument", statement.moduleNameSpan ?? statement.keywordSpan, `required argument「${parameter.name}」がありません。`));
          parameterBindings.push({ parameterIndex: parameter.parameterIndex, parameterName: parameter.name, parameterType: parameter.type, argumentIndex: null, argumentLabel: null, argumentSpan: null, usesDefault: true, value: parameter.defaultExpression ? { kind: "scalar", expression: parameter.defaultExpression } : null });
          continue;
        }
        const parameterScalarType = scalarTypeOf(parameter.type);
        let value: ModuleArgumentSemantic | null = null;
        if (parameterScalarType) {
          const expression = analyzeExpression(
            statementIndex,
            argument.value,
            argument.valueSpan,
            parameterScalarType,
            (reference) => ownerIndex === null
              ? resolveSourceScalar(statementIndex, null, reference.name, null)
              : resolveBodyScalar(statementIndex, ownerIndex, reference),
            undefined,
            (reference) => resolveGeometryProperty(statementIndex, ownerIndex, reference),
            (reference) => resolveGeometry(
              statementIndex,
              ownerIndex,
              `@${reference.name}`,
              reference.span,
              reference.expectedGeometryType,
              {
                expectedInterfaceType: reference.expectedGeometryType,
                role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference"
              }
            )
          );
          value = expression ? { kind: "scalar", expression } : null;
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
                { expectedInterfaceType: parameterInterfaceType }
              )
            };
          }
        }
        parameterBindings.push({ parameterIndex: parameter.parameterIndex, parameterName: parameter.name, parameterType: parameter.type, argumentIndex: argumentIndex ?? null, argumentLabel: argument.label, argumentSpan: argument.valueSpan, usesDefault: false, value });
      }
    }
    const semantic: ModuleInstanceSemantic = { statementId, statementIndex, name: statement.name, callerModuleDefinitionStatementId: owner?.statementId ?? null, callee, calleeResolution, parameterBindings };
    instances.push(semantic);
  }

  // Root typed declarations are owned by the ordinary scalar analyzer, but a
  // qualified module scalar reference still needs the Module source identity
  // for editor completion/navigation/rename. Reuse this analysis' resolved
  // target instead of asking the editor to resolve `instance::member` again.
  const rootScalarExpressionsByStatementId = new Map<StatementIdentity, ModuleScalarExpressionSite>();
  for (const [statementIndex, statement] of statements.entries()) {
    if (
      statement.kind !== "typedDeclaration" ||
      moduleOwnerIndexOf(statements, statementIndex) !== null ||
      !statement.declaredType ||
      !statement.payloadSpans.initializer ||
      (!statement.initializer.includes("::") && !(statement.initializer.includes("@") && statement.initializer.includes(".")))
    ) continue;
    const initializerSpan = statement.payloadSpans.initializer;
    const diagnosticsBefore = localDiagnosticsByStatement.get(statementIndex)?.length ?? 0;
    const expression = analyzeExpression(
      statementIndex,
      statement.initializer,
      initializerSpan,
      statement.declaredType,
      (reference) => resolveSourceScalar(statementIndex, null, reference.name, null, reference.span),
      undefined,
      (reference) => resolveGeometryProperty(statementIndex, null, reference),
      (reference) => resolveGeometry(
        statementIndex,
        null,
        `@${reference.name}`,
        reference.span,
        reference.expectedGeometryType,
        {
          expectedInterfaceType: reference.expectedGeometryType,
          role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference"
        }
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

  const localScalarsByDefinition = new Map<number, ModuleDefinitionSemantic["localScalars"]>();
  const bodyStatementsByDefinition = new Map<number, ModuleDefinitionSemantic["bodyStatements"]>();
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
      resolvePlainScalarTarget,
      resolveBodyScalar: (statementIndex, reference) => resolveBodyScalar(statementIndex, definition.statementIndex, reference),
      resolveBodyBareScalar: (statementIndex, reference) => resolveBodyBareScalar(statementIndex, definition.statementIndex, reference),
      resolveBodyGeometryProperty: (statementIndex, reference) => resolveGeometryProperty(statementIndex, definition.statementIndex, reference),
      resolveBodyGeometryBuiltin: (statementIndex, reference) => resolveGeometry(
        statementIndex,
        definition.statementIndex,
        `@${reference.name}`,
        reference.span,
        reference.expectedGeometryType,
        {
          expectedInterfaceType: reference.expectedGeometryType,
          role: reference.expectedGeometryType === "point" ? "pointReference" : "lineReference"
        }
      )
    });
    localScalarsByDefinition.set(definition.statementIndex, body.localScalars);
    bodyStatementsByDefinition.set(definition.statementIndex, body.bodyStatements);
    exportsByDefinition.set(definition.statementIndex, body.exports);
  }

  const semanticDefinitions: ModuleDefinitionSemantic[] = definitionStates.map((definition) => ({
    statementId: definition.statementId,
    statementIndex: definition.statementIndex,
    name: definition.statement.name,
    declarationScopeId: definition.declarationScopeId,
    bodyScopeId: definition.bodyScopeId,
    scopeId: definition.declarationScopeId,
    parameters: definition.parameters,
    localScalars: localScalarsByDefinition.get(definition.statementIndex) ?? [],
    bodyStatements: bodyStatementsByDefinition.get(definition.statementIndex) ?? [],
    exports: exportsByDefinition.get(definition.statementIndex) ?? [],
    bodyStatementIds: definition.bodyStatementIndexes.flatMap((index) => {
      const statementId = stableStatementIdByIndex.get(index);
      return statementId ? [statementId] : [];
    })
  }));

  const callEdges = moduleCallEdges(instances);
  const recursiveInstances = recursiveModuleInstanceIds(semanticDefinitions, callEdges);
  for (const instance of instances) {
    if (!recursiveInstances.has(instance.statementId)) continue;
    const statement = statements[instance.statementIndex];
    if (statement.kind !== "moduleInstance") continue;
    addLocal(instance.statementIndex, issue("module-recursion", statement.moduleNameSpan ?? statement.keywordSpan, `module recursion は許可されていません:「${statement.moduleName}」。`));
  }

  for (const [statementIndex, local] of localDiagnosticsByStatement) {
    for (const diagnostic of local) {
      const statement = statements[statementIndex];
      diagnostics.push(toDiagnostic(spans, statement, diagnostic));
    }
  }
  const definitionsByStatementId = new Map(semanticDefinitions.map((definition) => [definition.statementId, definition] as const));
  const instancesByStatementId = new Map(instances.map((instance) => [instance.statementId, instance] as const));
  return {
    definitions: semanticDefinitions,
    instances,
    definitionsByStatementId,
    instancesByStatementId,
    callEdges,
    rootScalarExpressionsByStatementId,
    rootGeometryReferencesByStatementId,
    rootParentReferencesByStatementId,
    diagnostics
  };
};

export const analyzeModuleSemantic = analyzeModuleSemantics;
