import { exactPhysicalSpan, type DiagnosticSpanContext } from "./dslDiagnosticSpan";
import { isGeometryDeclarationCategory, type DslGeometryDeclarationCategory } from "./dslConstructions";
import {
  resolveSourceLexicalDeclaration,
  type SourceLexicalDeclaration,
  type SourceLexicalLookup,
  type SourceLexicalNamespaceIndex
} from "./sourceLexicalNamespaceIndex";
import type { DslDiagnostic, DslModuleParameterType, DslSpan, DslStatement } from "./dslTypes";
import { parseAndCheckModuleScalarExpression, type ModuleScalarLocalDiagnostic, type ModuleScalarReferenceResolution } from "./moduleScalarExpression";
import { moduleCallEdges, recursiveModuleInstanceIds } from "./moduleCallGraph";
import { analyzeModuleBody } from "./moduleBodySemantic";
import type { BindingId } from "../scalars/bindingCatalog";
import { scopeChain, type ScopeId } from "../scalars/lexicalScopeIndex";
import type { ScalarType } from "../scalars/types";
import type { StatementIdentity } from "../document/statementIdentity";
import type {
  ModuleArgumentSemantic,
  ModuleDefinitionSemantic,
  ModuleGeometryReferenceSemantic,
  ModuleGeometrySourceTarget,
  ModuleInstanceSemantic,
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
  scopeId: ScopeId;
  parameters: ResolvedModuleParameter[];
  parameterByName: Map<string, { parameter: ResolvedModuleParameter; index: number }>;
  bodyStatementIndexes: number[];
};

type ReferenceResolution = ModuleScalarReferenceResolution;

const scalarTypeOf = (type: DslModuleParameterType | null): ScalarType | null =>
  type && (type.kind === "number" || type.kind === "string" || type.kind === "boolean" || type.kind === "choice")
    ? type
    : null;

const geometryKindOf = (type: DslModuleParameterType | null): "point" | "line" | null =>
  type?.kind === "point" || type?.kind === "line" ? type.kind : null;

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
): ModuleGeometrySourceTarget | null => {
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
  statements: readonly DslStatement[],
  statementIndex: number,
  name: string
): SourceLexicalLookup => resolveSourceLexicalDeclaration(sourceNamespace, statementIndex, name);

const declarationGeometryTarget = (
  declaration: SourceLexicalDeclaration,
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>
): ModuleGeometrySourceTarget | null => {
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
  const addLocal = (statementIndex: number, local: LocalDiagnostic) => {
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
    const scopeId = sourceNamespace.scopeIndex.scopeOfStatement.get(statementIndex) ?? sourceNamespace.scopeIndex.rootScopeId;
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
    const state: DefinitionState = { statement, statementIndex, statementId, scopeId, parameters, parameterByName, bodyStatementIndexes };
    definitionStates.push(state);
    stateByIndex.set(statementIndex, state);
  }

  const ownerParams = (ownerIndex: number | null, name: string) => ownerIndex === null ? undefined : stateByIndex.get(ownerIndex)?.parameterByName.get(name);
  const ownerForDefinitionSite = (definitionIndex: number) => moduleOwnerIndexOf(statements, definitionIndex);

  const bindingByStatementIndex = new Map<number, { bindingId: BindingId; statementId: StatementIdentity }>(input.documentScalarBindings ?? []);

  const resolveIterationScalar = (statementIndex: number, name: string): { statementId: StatementIdentity; statementIndex: number; name: string } | null => {
    const startScope = sourceNamespace.scopeIndex.scopeOfStatement.get(statementIndex);
    if (!startScope) return null;
    for (const scopeId of scopeChain(sourceNamespace.scopeIndex, startScope)) {
      const slot = sourceNamespace.scopeIndex.forGroupIterationSlots.get(scopeId);
      if (slot?.name === name && slot.statementIndex < statementIndex) {
        return { statementId: statementIdAt(stableStatementIdByIndex, slot.statementIndex), statementIndex: slot.statementIndex, name };
      }
    }
    return null;
  };

  const resolveSourceScalar = (
    statementIndex: number,
    ownerIndex: number | null,
    name: string,
    boundaryOwnerIndex: number | null = ownerIndex
  ): ReferenceResolution => {
    const parameter = ownerParams(ownerIndex, name);
    if (parameter) {
      const type = scalarTypeOf(parameter.parameter.type);
      if (type) return { target: scalarParameterTarget(stateByIndex.get(ownerIndex!)!, parameter), type, resolution: "resolved" };
      const geometryTarget = geometryParameterTarget(stateByIndex.get(ownerIndex!)!, parameter);
      return { target: geometryTarget, type: null, resolution: "invalid", diagnostic: issue("module-scalar-geometry-reference", { start: 0, end: 0 }, `scalar expression では geometry parameter「${name}」を参照できません。`) };
    }
    const iteration = resolveIterationScalar(statementIndex, name);
    if (iteration) {
      const iterationOwner = moduleOwnerIndexOf(statements, iteration.statementIndex);
      if (boundaryOwnerIndex !== null && iterationOwner !== boundaryOwnerIndex) {
        return { target: null, type: null, resolution: "outerCapture", diagnostic: issue("module-outer-capture", { start: 0, end: 0 }, `module body から outer scalar「${name}」を暗黙 capture できません。`) };
      }
      return { target: { kind: "iteration", ...iteration }, type: { kind: "number" }, resolution: "resolved" };
    }
    const lookup = sourceDeclarationResolution(sourceNamespace, statements, statementIndex, name);
    if (lookup.kind === "undefined") return { target: null, type: null, resolution: "undefined", diagnostic: issue("module-undefined-reference", { start: 0, end: 0 }, `未定義のmodule scalar「${name}」を参照しています。`) };
    if (lookup.kind === "forward") return { target: null, type: null, resolution: "forward", diagnostic: issue("module-forward-reference", { start: 0, end: 0 }, `module scalar「${name}」はこの位置より後で宣言されています。`) };
    if (lookup.kind === "ambiguous") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-ambiguous-reference", { start: 0, end: 0 }, `module scalar「${name}」を一意に解決できません。`) };
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
    let outerOwner = ownerForDefinitionSite(definition.statementIndex);
    while (outerOwner !== null) {
      const outerParameter = ownerParams(outerOwner, reference.name);
      if (outerParameter) {
        const outerDefinition = stateByIndex.get(outerOwner)!;
        const type = scalarTypeOf(outerParameter.parameter.type);
        if (type) return { target: scalarParameterTarget(outerDefinition, outerParameter), type, resolution: "resolved" };
        return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-default-invalid-reference", reference.span, `default の参照先「${reference.name}」はscalarではありません。`) };
      }
      outerOwner = moduleOwnerIndexOf(statements, outerOwner);
    }
    const iteration = resolveIterationScalar(definition.statementIndex, reference.name);
    if (iteration) return { target: { kind: "iteration", ...iteration }, type: { kind: "number" }, resolution: "resolved" };
    const lookup = sourceDeclarationResolution(sourceNamespace, statements, definition.statementIndex, reference.name);
    if (lookup.kind === "undefined") return { target: null, type: null, resolution: "undefined", diagnostic: issue("module-undefined-reference", reference.span, `未定義のmodule scalar「${reference.name}」を参照しています。`) };
    if (lookup.kind === "forward") return { target: null, type: null, resolution: "forward", diagnostic: issue("module-forward-reference", reference.span, `module scalar「${reference.name}」はこの位置より後で宣言されています。`) };
    if (lookup.kind === "ambiguous") return { target: null, type: null, resolution: "invalid", diagnostic: issue("module-ambiguous-reference", reference.span, `module scalar「${reference.name}」を一意に解決できません。`) };
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
    const resolution = resolveSourceScalar(statementIndex, ownerIndex, reference.name, ownerIndex);
    if (resolution.diagnostic && resolution.diagnostic.span.start === 0 && resolution.diagnostic.span.end === 0) {
      return { ...resolution, diagnostic: { ...resolution.diagnostic, span: reference.span } };
    }
    return resolution;
  };

  const resolveBodyBareScalar = (statementIndex: number, ownerIndex: number, reference: { name: string; span: DslSpan }): ReferenceResolution | null => {
    const iteration = resolveIterationScalar(statementIndex, reference.name);
    if (!iteration) return null;
    const iterationOwner = moduleOwnerIndexOf(statements, iteration.statementIndex);
    if (iterationOwner !== ownerIndex) {
      return { target: null, type: null, resolution: "outerCapture", diagnostic: issue("module-outer-capture", reference.span, `module body から outer scalar「${reference.name}」を暗黙 capture できません。`) };
    }
    return { target: { kind: "iteration", ...iteration }, type: { kind: "number" }, resolution: "resolved" };
  };

  const analyzeExpression = (
    statementIndex: number,
    raw: string,
    span: DslSpan,
    expectedType: ScalarType | null,
    resolver: (reference: { name: string; span: DslSpan }) => ReferenceResolution,
    bareResolver?: (reference: { name: string; span: DslSpan }) => ReferenceResolution | null
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
    const directDeclarations = sourceNamespace.declarationsByScope.get(definition.scopeId) ?? [];
    for (const declaration of directDeclarations) {
      const parameter = definition.parameterByName.get(declaration.name);
      if (parameter && declaration.statementIndex !== definition.statementIndex) {
        addLocal(declaration.statementIndex, issue("module-parameter-collision", declaration.nameSpan ?? declaration.statement.keywordSpan, `parameter「${declaration.name}」と同じmodule scopeで名前が衝突しています。`));
      }
    }
  }

  const resolveGeometry = (
    statementIndex: number,
    ownerIndex: number | null,
    rawValue: string,
    span: DslSpan,
    expected: "point" | "line",
    options: { allowCoordinate?: boolean; allowNone?: boolean } = {}
  ): ModuleGeometryReferenceSemantic => {
    const trimmed = rawValue.trim();
    if (!trimmed) return { source: rawValue, span, target: null };
    if (trimmed === "none") {
      if (options.allowNone) return { source: rawValue, span, target: null };
      addLocal(statementIndex, issue("module-geometry-none", span, `geometry ${expected} reference に none は指定できません。`));
      return { source: rawValue, span, target: null };
    }
    if (trimmed.startsWith("(") || trimmed.startsWith("[")) {
      const coordinate = trimmed.startsWith("(") && trimmed.endsWith(")");
      if (coordinate && expected === "point" && options.allowCoordinate !== false) return { source: rawValue, span, target: null };
      addLocal(statementIndex, issue("module-geometry-type-mismatch", span, `geometry reference の形式が一致しません(期待: ${expected})。`));
      return { source: rawValue, span, target: null };
    }
    const sigilOffset = trimmed.startsWith("@") ? 1 : 0;
    const withoutSigil = trimmed.slice(sigilOffset);
    const base = withoutSigil.split(".")[0].trim();
    const baseStart = span.start + Math.max(0, rawValue.indexOf(base));
    const baseSpan = { start: baseStart, end: baseStart + base.length };
    const parameter = ownerIndex === null ? undefined : ownerParams(ownerIndex, base);
    if (parameter) {
      const parameterTarget = geometryParameterTarget(stateByIndex.get(ownerIndex!)!, parameter);
      if (!parameterTarget || parameterTarget.geometryKind !== expected) {
        addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `geometry reference「${base}」の型が一致しません(期待: ${expected})。`));
        return { source: rawValue, span, target: parameterTarget };
      }
      return { source: rawValue, span, target: parameterTarget };
    }
    const lookup = sourceDeclarationResolution(sourceNamespace, statements, statementIndex, base);
    if (lookup.kind === "undefined") {
      addLocal(statementIndex, issue("module-undefined-geometry-reference", baseSpan, `未定義のgeometry「${base}」を参照しています。`));
      return { source: rawValue, span, target: null };
    }
    if (lookup.kind === "forward") {
      addLocal(statementIndex, issue("module-forward-geometry-reference", baseSpan, `geometry「${base}」はこの位置より後で宣言されています。`));
      return { source: rawValue, span, target: null };
    }
    if (lookup.kind === "ambiguous") {
      addLocal(statementIndex, issue("module-ambiguous-geometry-reference", baseSpan, `geometry「${base}」を一意に解決できません。`));
      return { source: rawValue, span, target: null };
    }
    const target = declarationGeometryTarget(lookup.declaration, stableStatementIdByIndex);
    const declarationOwner = moduleOwnerIndexOf(statements, lookup.declaration.statementIndex);
    if (!target) {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `「${base}」はgeometryではありません。`));
      return { source: rawValue, span, target: null };
    }
    if (ownerIndex !== null && declarationOwner !== ownerIndex) {
      addLocal(statementIndex, issue("module-outer-capture", baseSpan, `module body から outer geometry「${base}」を暗黙 capture できません。`));
      return { source: rawValue, span, target: null };
    }
    if (target.geometryKind !== expected) {
      addLocal(statementIndex, issue("module-geometry-type-mismatch", baseSpan, `geometry reference「${base}」の型が一致しません(期待: ${expected})。`));
      return { source: rawValue, span, target };
    }
    return { source: rawValue, span, target };
  };

  const resolvePlainScalarTarget = (statementIndex: number, ownerIndex: number | null, name: string): ReferenceResolution => {
    const resolution = resolveSourceScalar(statementIndex, ownerIndex, name, ownerIndex);
    if (resolution.diagnostic && resolution.diagnostic.span.start === 0 && resolution.diagnostic.span.end === 0) {
      return { ...resolution, diagnostic: { ...resolution.diagnostic, span: statements[statementIndex].nameSpan ?? statements[statementIndex].keywordSpan } };
    }
    return resolution;
  };

  const instances: ModuleInstanceSemantic[] = [];
  for (const [statementIndex, statement] of statements.entries()) {
    if (statement.kind !== "moduleInstance") continue;
    const statementId = statementIdAt(stableStatementIdByIndex, statementIndex);
    const ownerIndex = moduleOwnerIndexOf(statements, statementIndex);
    const owner = ownerIndex === null ? null : stateByIndex.get(ownerIndex) ?? null;
    let callee: ResolvedModuleCallee | null = null;
    let calleeResolution: ModuleInstanceSemantic["calleeResolution"] = "undefined";
    const parameterShadow = owner?.parameterByName.get(statement.moduleName);
    if (parameterShadow) {
      calleeResolution = "notModule";
    } else {
      const lookup = sourceDeclarationResolution(sourceNamespace, statements, statementIndex, statement.moduleName);
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
              : resolveBodyScalar(statementIndex, ownerIndex, reference)
          );
          value = expression ? { kind: "scalar", expression } : null;
        } else {
          const parameterGeometryKind = geometryKindOf(parameter.type);
          if (parameterGeometryKind) value = { kind: "geometry", reference: resolveGeometry(statementIndex, ownerIndex, argument.value, argument.valueSpan, parameterGeometryKind) };
        }
        parameterBindings.push({ parameterIndex: parameter.parameterIndex, parameterName: parameter.name, parameterType: parameter.type, argumentIndex: argumentIndex ?? null, argumentLabel: argument.label, argumentSpan: argument.valueSpan, usesDefault: false, value });
      }
    }
    const semantic: ModuleInstanceSemantic = { statementId, statementIndex, name: statement.name, callerModuleDefinitionStatementId: owner?.statementId ?? null, callee, calleeResolution, parameterBindings };
    instances.push(semantic);
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
      resolveBodyBareScalar: (statementIndex, reference) => resolveBodyBareScalar(statementIndex, definition.statementIndex, reference)
    });
    localScalarsByDefinition.set(definition.statementIndex, body.localScalars);
    bodyStatementsByDefinition.set(definition.statementIndex, body.bodyStatements);
    exportsByDefinition.set(definition.statementIndex, body.exports);
  }

  const semanticDefinitions: ModuleDefinitionSemantic[] = definitionStates.map((definition) => ({
    statementId: definition.statementId,
    statementIndex: definition.statementIndex,
    name: definition.statement.name,
    scopeId: definition.scopeId,
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
  return { definitions: semanticDefinitions, instances, definitionsByStatementId, instancesByStatementId, callEdges, diagnostics };
};

export const analyzeModuleSemantic = analyzeModuleSemantics;
