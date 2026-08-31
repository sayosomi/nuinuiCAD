import type { StatementIdentity } from "../document/statementIdentity";
import type { BindingId } from "../scalars/bindingCatalog";
import { compileModuleScalarRuntime, type ModuleScalarRuntimeCompilation } from "../scalars/moduleScalarRuntime";
import type { ElementId } from "../types/geometry";
import { applyStatement } from "./dslCompiler";
import type { CompiledDslDocument } from "./dslDocument";
import { isCompilableDslStatement } from "./dslCompilationGuard";
import { parseDslSnapshot } from "./dslParser";
import { buildModuleGeometryRuntime, type ModuleGeometryRuntimeCompilation } from "./moduleGeometryRuntime";
import { compileMaterializedExecution } from "./moduleExecutionCompiler";
import { materializeModuleExecution, materializedRuntimeElementId, type ModuleMaterialization } from "./moduleMaterialization";
import { analyzeModuleSemantics } from "./moduleSemanticAnalysis";
import type {
  ModuleDefinitionSemantic,
  ModuleGeometryReferenceSemantic,
  ModuleRecordReferenceSemantic,
  ModuleScalarExpressionSemantic,
  ModuleSemanticAnalysis,
  ResolvedModuleParameterBinding
} from "./moduleSemanticTypes";
import { buildSourceLexicalNamespaceIndex, type SourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";
import { formatDslName } from "./dslTokens";
import type { CompileDslResult, DslDiagnostic, DslStatement } from "./dslTypes";
import { NEW_DOCUMENT_DSL_MAJOR_VERSION } from "./dslVersion";
import type {
  ModulePreviewTarget,
  ModulePreviewTargetSemanticSnapshot,
  SourceSnapshot
} from "./modulePreviewTarget";

export type ModulePreviewArgument = {
  name: string;
  expression: string;
};

export type ModulePreviewAncestorContext = {
  definitionStatementId: StatementIdentity;
  arguments?: readonly ModulePreviewArgument[];
};

export type ModulePreviewRootInput = {
  source: SourceSnapshot;
  semantic: ModulePreviewTargetSemanticSnapshot;
  target: ModulePreviewTarget;
  arguments?: readonly ModulePreviewArgument[];
  /**
   * Outermost-to-innermost ancestor Module invocation values. Only ancestors
   * of `target` are accepted; target arguments live in `arguments` above.
   */
  ancestorContexts?: readonly ModulePreviewAncestorContext[];
};

export type ModulePreviewRootResult = {
  target: ModulePreviewTarget;
  targetRuntimeElementId: ElementId;
  targetRuntimeElementIds: readonly ElementId[];
  /** Full dependency-bearing compile result; consumers render only targetRuntimeElementIds. */
  compileResult: CompileDslResult;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  moduleMaterialization: ModuleMaterialization;
  moduleGeometryRuntime: ModuleGeometryRuntimeCompilation;
  moduleScalarRuntime: ModuleScalarRuntimeCompilation;
  diagnostics: readonly DslDiagnostic[];
};

const exactCompiled = (
  source: SourceSnapshot,
  semantic: ModulePreviewTargetSemanticSnapshot
): CompiledDslDocument | null => {
  const compiled = semantic.compiled;
  if (!compiled || semantic.sourceRevision !== source.sourceRevision) return null;
  if (source.normalizedSource.includes("\r")) return null;
  const semanticText = semantic.sourceText ?? compiled.spans.sourceMap.source;
  if (
    semanticText !== source.normalizedSource ||
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision
  ) return null;
  return compiled;
};

const ownerModuleIndexOf = (statements: readonly DslStatement[], statementIndex: number): number | null => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    const parent = statements[enclosing.statementIndex];
    if (parent?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = parent?.enclosing ?? null;
  }
  return null;
};

const definitionChainFor = (
  statements: readonly DslStatement[],
  analysis: ModuleSemanticAnalysis,
  target: ModuleDefinitionSemantic
): ModuleDefinitionSemantic[] | null => {
  const chain: ModuleDefinitionSemantic[] = [target];
  let ownerIndex = ownerModuleIndexOf(statements, target.statementIndex);
  const visited = new Set<number>([target.statementIndex]);
  while (ownerIndex !== null) {
    if (visited.has(ownerIndex)) return null;
    visited.add(ownerIndex);
    const owner = analysis.definitions.find((candidate) => candidate.statementIndex === ownerIndex);
    if (!owner) return null;
    chain.push(owner);
    ownerIndex = ownerModuleIndexOf(statements, owner.statementIndex);
  }
  return chain.reverse();
};

const stableIdsFor = (compiled: CompiledDslDocument): Map<number, StatementIdentity> => {
  const ids = new Map<number, StatementIdentity>();
  for (const [index, id] of compiled.statementMap?.statementIdByStatementIndex ?? []) ids.set(index, id);
  for (const declaration of compiled.sourceLexicalNamespace?.allDeclarations ?? []) {
    ids.set(declaration.statementIndex, declaration.statementId);
  }
  for (const definition of compiled.moduleSemanticAnalysis?.definitions ?? []) {
    ids.set(definition.statementIndex, definition.statementId);
    for (const body of definition.bodyStatements) ids.set(body.statementIndex, body.statementId);
  }
  for (const instance of compiled.moduleSemanticAnalysis?.instances ?? []) ids.set(instance.statementIndex, instance.statementId);
  compiled.statements.forEach((statement, index) => {
    if (ids.has(index)) return;
    ids.set(
      index,
      `module-preview-source:${compiled.spans.sourceMap.sourceRevision}:${index}:${statement.kind}` as StatementIdentity
    );
  });
  return ids;
};

export const modulePreviewSyntheticCallSource = (
  instanceName: string,
  moduleName: string,
  args: readonly ModulePreviewArgument[]
) => {
  const header = `nui ${NEW_DOCUMENT_DSL_MAJOR_VERSION}`;
  if (args.length === 0) return `${header}\ninstance ${instanceName} = ${formatDslName(moduleName)}()`;
  return [
    header,
    `instance ${instanceName} = ${formatDslName(moduleName)}(`,
    ...args.map((argument) => `  ${formatDslName(argument.name)}: ${argument.expression},`),
    ")"
  ].join("\n");
};

type SyntheticCall = {
  statement: Extract<DslStatement, { kind: "moduleInstance" }>;
  logicalText: string;
};

const syntheticCallStatement = (
  sourceRevision: number,
  canonicalLength: number,
  line: number,
  instanceName: string,
  moduleName: string,
  args: readonly ModulePreviewArgument[],
  enclosing: DslStatement["enclosing"]
): SyntheticCall | null => {
  const source = modulePreviewSyntheticCallSource(instanceName, moduleName, args);
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) return null;
  const statement = parsed.statements.find(
    (candidate): candidate is Extract<DslStatement, { kind: "moduleInstance" }> => candidate.kind === "moduleInstance"
  );
  if (!statement) return null;
  const logicalText = parsed.logicalStatementByRangeFrom.get(statement.documentRange.from)?.logicalText ?? source;
  const from = canonicalLength + line;
  return {
    logicalText,
    statement: {
      ...statement,
      line,
      sourceRevision,
      documentRange: { ...statement.documentRange, sourceRevision, from, to: from + Math.max(1, logicalText.length) },
      enclosing: enclosing ? { ...enclosing } : null
    }
  };
};

const documentScalarBindingsFor = (
  compiled: CompiledDslDocument,
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>
) => {
  const bindings = new Map<number, { bindingId: BindingId; statementId: StatementIdentity }>();
  for (const binding of compiled.bindingAnalysis?.catalog.bindings ?? []) {
    if (binding.kind !== "typed") continue;
    const statementId = stableStatementIdByIndex.get(binding.statementIndex);
    if (!statementId) continue;
    bindings.set(binding.statementIndex, { bindingId: binding.id, statementId });
  }
  return bindings;
};

const referenceIsResolved = (reference: ModuleGeometryReferenceSemantic): boolean =>
  reference.coordinate !== null
    ? (!reference.coordinate.x || expressionIsResolved(reference.coordinate.x)) &&
      (!reference.coordinate.y || expressionIsResolved(reference.coordinate.y))
    : (reference.resolution === "resolved" || reference.resolution === "deferred") && reference.target !== null;

const expressionIsResolved = (expression: ModuleScalarExpressionSemantic): boolean =>
  expression.references.every((reference) => reference.resolution === "resolved" && reference.target !== null) &&
  expression.geometryProperties.every((reference) =>
    (reference.resolution === "resolved" || reference.resolution === "deferred") && reference.target !== null
  ) &&
  expression.geometryBuiltinArguments.every((argument) => referenceIsResolved(argument.reference));

const recordReferenceIsResolved = (reference: ModuleRecordReferenceSemantic): boolean =>
  reference.resolution === "resolved" && (reference.target !== null || reference.constructor !== null);

const bindingIsResolved = (binding: ResolvedModuleParameterBinding): boolean => {
  if (binding.state === "requiredOmitted") return false;
  if (binding.state === "optionalOmitted") return true;
  if (binding.state === "defaultedOmitted") return binding.value?.kind === "scalar" && expressionIsResolved(binding.value.expression);
  if (!binding.value) return false;
  return binding.value.kind === "scalar"
    ? expressionIsResolved(binding.value.expression)
    : binding.value.kind === "geometry"
      ? referenceIsResolved(binding.value.reference)
      : recordReferenceIsResolved(binding.value.reference);
};

const callerSourceStatementIsSafe = (
  statementIndex: number,
  cutoffStatementIndex: number,
  allowedCallerModuleStatementIndexes: ReadonlySet<number>,
  statements: readonly DslStatement[]
): boolean => {
  if (statementIndex >= cutoffStatementIndex) return false;
  const ownerModuleIndex = ownerModuleIndexOf(statements, statementIndex);
  return ownerModuleIndex === null || allowedCallerModuleStatementIndexes.has(ownerModuleIndex);
};

const callerExpressionIsSafe = (
  expression: ModuleScalarExpressionSemantic,
  cutoffStatementIndex: number,
  allowedParameterDefinitionIds: ReadonlySet<StatementIdentity>,
  allowedCallerModuleStatementIndexes: ReadonlySet<number>,
  statements: readonly DslStatement[]
): boolean => {
  if (!expressionIsResolved(expression)) return false;
  for (const reference of expression.references) {
    const target = reference.target;
    if (!target) return false;
    if (target.kind === "parameter") {
      if (!allowedParameterDefinitionIds.has(target.definitionStatementId)) return false;
      continue;
    }
    if (target.kind === "moduleLocal") {
      if (!callerSourceStatementIsSafe(
        target.statementIndex,
        cutoffStatementIndex,
        allowedCallerModuleStatementIndexes,
        statements
      )) return false;
      continue;
    }
    if (target.kind !== "documentBinding") return false;
    if (!callerSourceStatementIsSafe(
      target.statementIndex,
      cutoffStatementIndex,
      allowedCallerModuleStatementIndexes,
      statements
    )) return false;
  }
  for (const property of expression.geometryProperties) {
    const target = property.target;
    if (!target) return false;
    if (target.kind === "parameterProperty") {
      if (!allowedParameterDefinitionIds.has(target.definitionStatementId)) return false;
      continue;
    }
    if (target.kind !== "sourceGeometryProperty") return false;
    if (!callerSourceStatementIsSafe(
      target.statementIndex,
      cutoffStatementIndex,
      allowedCallerModuleStatementIndexes,
      statements
    )) return false;
  }
  for (const argument of expression.geometryBuiltinArguments) {
    if (!callerGeometryReferenceIsSafe(
      argument.reference,
      cutoffStatementIndex,
      allowedParameterDefinitionIds,
      allowedCallerModuleStatementIndexes,
      statements
    )) return false;
  }
  return true;
};

const callerGeometryReferenceIsSafe = (
  reference: ModuleGeometryReferenceSemantic,
  cutoffStatementIndex: number,
  allowedParameterDefinitionIds: ReadonlySet<StatementIdentity>,
  allowedCallerModuleStatementIndexes: ReadonlySet<number>,
  statements: readonly DslStatement[]
): boolean => {
  if (reference.coordinate) {
    return (!reference.coordinate.x || callerExpressionIsSafe(
      reference.coordinate.x,
      cutoffStatementIndex,
      allowedParameterDefinitionIds,
      allowedCallerModuleStatementIndexes,
      statements
    )) && (!reference.coordinate.y || callerExpressionIsSafe(
      reference.coordinate.y,
      cutoffStatementIndex,
      allowedParameterDefinitionIds,
      allowedCallerModuleStatementIndexes,
      statements
    ));
  }
  if (!referenceIsResolved(reference) || !reference.target) return false;
  const target = reference.target;
  if (target.kind === "parameter") return allowedParameterDefinitionIds.has(target.definitionStatementId);
  if (target.kind !== "sourceGeometry") return false;
  return callerSourceStatementIsSafe(
    target.statementIndex,
    cutoffStatementIndex,
    allowedCallerModuleStatementIndexes,
    statements
  );
};

const parameterBindingIsSafe = (
  binding: ResolvedModuleParameterBinding,
  cutoffStatementIndex: number,
  callerParameterDefinitionIds: ReadonlySet<StatementIdentity>,
  callerModuleStatementIndexes: ReadonlySet<number>,
  currentDefinitionStatementId: StatementIdentity,
  statements: readonly DslStatement[]
): boolean => {
  if (!bindingIsResolved(binding)) return false;
  if (!binding.value) return binding.state === "optionalOmitted";
  const allowedParameterDefinitionIds = binding.state === "defaultedOmitted"
    ? new Set<StatementIdentity>([currentDefinitionStatementId])
    : callerParameterDefinitionIds;
  return binding.value.kind === "scalar"
    ? callerExpressionIsSafe(
        binding.value.expression,
        cutoffStatementIndex,
        allowedParameterDefinitionIds,
        callerModuleStatementIndexes,
        statements
      )
    : binding.value.kind === "geometry"
      ? callerGeometryReferenceIsSafe(
        binding.value.reference,
        cutoffStatementIndex,
        allowedParameterDefinitionIds,
        callerModuleStatementIndexes,
        statements
      )
      : recordReferenceIsResolved(binding.value.reference);
};

const reachableDefinitionIdsFrom = (
  analysis: ModuleSemanticAnalysis,
  targetDefinitionId: StatementIdentity
): Set<StatementIdentity> => {
  const reachable = new Set<StatementIdentity>([targetDefinitionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of analysis.callEdges) {
      if (!reachable.has(edge.callerModuleDefinitionStatementId) || reachable.has(edge.calleeModuleDefinitionStatementId)) continue;
      reachable.add(edge.calleeModuleDefinitionStatementId);
      changed = true;
    }
  }
  return reachable;
};

const relevantLinesFor = (
  statements: readonly DslStatement[],
  analysis: ModuleSemanticAnalysis,
  targetDefinitionId: StatementIdentity,
  syntheticIndexes: readonly number[],
  ancestorDefinitionIds: ReadonlySet<StatementIdentity>
): Set<number> => {
  const lines = new Set<number>();
  const reachable = reachableDefinitionIdsFrom(analysis, targetDefinitionId);
  for (const definition of analysis.definitions) {
    if (!reachable.has(definition.statementId) && !ancestorDefinitionIds.has(definition.statementId)) continue;
    const statement = statements[definition.statementIndex];
    if (statement) lines.add(statement.line);
    if (!reachable.has(definition.statementId)) continue;
    for (const body of definition.bodyStatements) {
      const bodyStatement = statements[body.statementIndex];
      if (bodyStatement) lines.add(bodyStatement.line);
    }
  }
  for (const index of syntheticIndexes) {
    const statement = statements[index];
    if (statement) lines.add(statement.line);
  }
  return lines;
};

const relevantDiagnostics = (
  diagnostics: readonly DslDiagnostic[],
  relevantLines: ReadonlySet<number>
): DslDiagnostic[] => diagnostics.filter((diagnostic) => relevantLines.has(diagnostic.line));

const hasRelevantError = (diagnostics: readonly DslDiagnostic[], relevantLines: ReadonlySet<number>) =>
  relevantDiagnostics(diagnostics, relevantLines).some((diagnostic) => diagnostic.severity === "error");

const projectAncestorDefinitions = (
  analysis: ModuleSemanticAnalysis,
  chain: readonly ModuleDefinitionSemantic[],
  syntheticStatementIds: readonly StatementIdentity[]
): ModuleSemanticAnalysis => {
  const ancestorIds = new Set(chain.slice(0, -1).map((definition) => definition.statementId));
  const childDefinitionIndexByAncestor = new Map<StatementIdentity, number>();
  const childIdByAncestor = new Map<StatementIdentity, StatementIdentity>();
  chain.slice(0, -1).forEach((definition, index) => {
    childDefinitionIndexByAncestor.set(definition.statementId, chain[index + 1]!.statementIndex);
    childIdByAncestor.set(definition.statementId, syntheticStatementIds[index + 1]!);
  });
  const definitions = analysis.definitions.map((definition) => {
    if (!ancestorIds.has(definition.statementId)) return definition;
    const cutoffStatementIndex = childDefinitionIndexByAncestor.get(definition.statementId);
    const childId = childIdByAncestor.get(definition.statementId);
    const callerPrefix = cutoffStatementIndex === undefined
      ? []
      : definition.bodyStatements.filter((body) => body.statementIndex < cutoffStatementIndex);
    const syntheticChild = childId
      ? definition.bodyStatements.filter((body) => body.statementId === childId)
      : [];
    const bodyStatements = [...callerPrefix, ...syntheticChild];
    return {
      ...definition,
      localScalars: cutoffStatementIndex === undefined
        ? []
        : definition.localScalars.filter((local) => local.statementIndex < cutoffStatementIndex),
      bodyStatements,
      exports: [],
      bodyStatementIds: bodyStatements.map((body) => body.statementId)
    };
  });
  return {
    ...analysis,
    definitions,
    definitionsByStatementId: new Map(definitions.map((definition) => [definition.statementId, definition]))
  };
};

const assignedElementIdsFor = (
  statements: readonly DslStatement[],
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>
): Map<number, ElementId> => new Map(statements.flatMap((statement, index) => {
  if (statement.kind !== "group" && statement.kind !== "element") return [];
  const statementId = stableStatementIdByIndex.get(index);
  return statementId ? [[index, `module-preview-source:${statementId}` as ElementId] as const] : [];
}));

const noSourceOutputs = () => ({
  layouts: [],
  printOutputs: [],
  svgOutputs: [],
  layoutIdsByStatementIndex: new Map<number, string>(),
  outputIdsByStatementIndex: new Map<number, string>()
});

const analyzeSource = (
  compiled: CompiledDslDocument,
  statements: readonly DslStatement[],
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>,
  sourceNamespace: SourceLexicalNamespaceIndex,
  logicalTextByStatementIndex: ReadonlyMap<number, string>
) => analyzeModuleSemantics({
  statements,
  stableStatementIdByIndex,
  sourceNamespace,
  spans: compiled.spans,
  logicalTextByStatementIndex,
  documentScalarBindings: documentScalarBindingsFor(compiled, stableStatementIdByIndex)
});

/**
 * Compile one exact-current Module definition through the existing Module
 * semantic/materialization/compiler/scalar-runtime path without changing the
 * canonical `.nui` source. Synthetic calls exist only in an ephemeral AST.
 */
export const compileModulePreviewRoot = (input: ModulePreviewRootInput): ModulePreviewRootResult | null => {
  const compiled = exactCompiled(input.source, input.semantic);
  if (!compiled) return null;

  const statements: DslStatement[] = [...compiled.statements];
  const stableStatementIdByIndex = stableIdsFor(compiled);
  const logicalTextByStatementIndex = new Map<number, string>();
  compiled.statements.forEach((statement, index) => {
    const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (logical) logicalTextByStatementIndex.set(index, logical.logicalText);
  });

  let canonicalSourceNamespace: SourceLexicalNamespaceIndex;
  let canonicalAnalysis: ModuleSemanticAnalysis;
  try {
    canonicalSourceNamespace = buildSourceLexicalNamespaceIndex(statements, stableStatementIdByIndex);
    canonicalAnalysis = analyzeSource(
      compiled,
      statements,
      stableStatementIdByIndex,
      canonicalSourceNamespace,
      logicalTextByStatementIndex
    );
  } catch {
    return null;
  }

  const sourceDefinition = canonicalAnalysis.definitionsByStatementId.get(input.target.definitionStatementId);
  if (
    !sourceDefinition ||
    sourceDefinition.statementIndex !== input.target.definitionStatementIndex ||
    sourceDefinition.name !== input.target.name ||
    stableStatementIdByIndex.get(sourceDefinition.statementIndex) !== input.target.definitionStatementId ||
    compiled.statements[sourceDefinition.statementIndex]?.kind !== "moduleDefinition" ||
    compiled.statements[sourceDefinition.statementIndex]?.sourceRevision !== input.source.sourceRevision
  ) return null;

  const chain = definitionChainFor(statements, canonicalAnalysis, sourceDefinition);
  if (!chain) return null;
  const ancestorContexts = new Map(
    (input.ancestorContexts ?? []).map((context) => [context.definitionStatementId, context] as const)
  );
  const expectedAncestorIds = new Set(chain.slice(0, -1).map((definition) => definition.statementId));
  if ([...ancestorContexts.keys()].some((id) => !expectedAncestorIds.has(id))) return null;

  const syntheticIndexes: number[] = [];
  const syntheticStatementIds: StatementIdentity[] = [];
  const syntheticLineBase = compiled.sourceLines.length + 10;
  for (const [chainIndex, definition] of chain.entries()) {
    const args = chainIndex === chain.length - 1
      ? input.arguments ?? []
      : ancestorContexts.get(definition.statementId)?.arguments ?? [];
    const synthetic = syntheticCallStatement(
      input.source.sourceRevision,
      input.source.normalizedSource.length,
      syntheticLineBase + chainIndex,
      `__module_preview_${chainIndex}`,
      definition.name,
      args,
      statements[definition.statementIndex]?.enclosing ?? null
    );
    if (!synthetic) return null;
    const statementIndex = statements.length;
    const statementId = `module-preview-call:${input.target.definitionStatementId}:${chainIndex}` as StatementIdentity;
    statements.push(synthetic.statement);
    stableStatementIdByIndex.set(statementIndex, statementId);
    logicalTextByStatementIndex.set(statementIndex, synthetic.logicalText);
    syntheticIndexes.push(statementIndex);
    syntheticStatementIds.push(statementId);
  }

  let sourceNamespace: SourceLexicalNamespaceIndex;
  let analysis: ModuleSemanticAnalysis;
  try {
    sourceNamespace = buildSourceLexicalNamespaceIndex(statements, stableStatementIdByIndex);
    analysis = analyzeSource(
      compiled,
      statements,
      stableStatementIdByIndex,
      sourceNamespace,
      logicalTextByStatementIndex
    );
  } catch {
    return null;
  }

  const syntheticInstances = syntheticStatementIds.map((statementId, index) => {
    const instance = analysis.instancesByStatementId.get(statementId);
    const expected = chain[index];
    return instance?.callee?.definitionStatementId === expected.statementId ? instance : null;
  });
  if (syntheticInstances.some((instance) => instance === null)) return null;

  const callerParameterDefinitionIds = new Set<StatementIdentity>();
  const callerModuleStatementIndexes = new Set<number>();
  for (const [index, instance] of syntheticInstances.entries()) {
    if (!instance) return null;
    if (!instance.parameterBindings.every((binding) => parameterBindingIsSafe(
      binding,
      chain[index].statementIndex,
      callerParameterDefinitionIds,
      callerModuleStatementIndexes,
      chain[index].statementId,
      statements
    ))) return null;
    callerParameterDefinitionIds.add(chain[index].statementId);
    callerModuleStatementIndexes.add(chain[index].statementIndex);
  }

  const ancestorDefinitionIds = new Set(chain.slice(0, -1).map((definition) => definition.statementId));
  const relevantLines = relevantLinesFor(
    statements,
    analysis,
    sourceDefinition.statementId,
    syntheticIndexes,
    ancestorDefinitionIds
  );
  if (
    hasRelevantError(sourceNamespace.diagnostics, relevantLines) ||
    hasRelevantError(analysis.diagnostics, relevantLines)
  ) return null;

  const previewAnalysis = projectAncestorDefinitions(analysis, chain, syntheticStatementIds);
  const assignedElementIds = assignedElementIdsFor(statements, stableStatementIdByIndex);

  let moduleMaterialization: ModuleMaterialization;
  let moduleGeometryRuntime: ModuleGeometryRuntimeCompilation;
  let compileResult: CompileDslResult;
  const compilerDiagnostics: DslDiagnostic[] = [];
  try {
    const materialized = materializeModuleExecution({
      statements,
      stableStatementIdByIndex,
      assignedElementIds,
      moduleSemanticAnalysis: previewAnalysis
    });
    moduleMaterialization = {
      ...materialized,
      evaluationLimitIndex: undefined
    };
    moduleGeometryRuntime = buildModuleGeometryRuntime({
      statements,
      stableStatementIdByIndex,
      moduleSemanticAnalysis: previewAnalysis,
      moduleMaterialization
    });
    if (hasRelevantError(moduleGeometryRuntime.diagnostics, relevantLines)) return null;

    const visibilityRoles = compiled.document?.visibilityRoles ?? [];
    const visibilityProfiles = compiled.document?.visibilityProfiles ?? [];
    compileResult = compileMaterializedExecution({
      statements,
      context: {
        elements: [],
        mode: "document",
        majorVersion: compiled.majorVersion ?? NEW_DOCUMENT_DSL_MAJOR_VERSION,
        assignedElementIds,
        moduleSemanticAnalysis: previewAnalysis,
        stableStatementIdByIndex,
        sourceLexicalResolution: {
          sourceNamespace,
          elementIdByStatementIndex: moduleMaterialization.elementIdBySourceStatementIndex
        }
      },
      diagnostics: compilerDiagnostics,
      visibilitySettings: {
        visibilityRoles,
        visibilityProfiles,
        activeVisibilityProfileId: compiled.document?.activeVisibilityProfileId
      },
      materialization: moduleMaterialization,
      moduleGeometryRuntime,
      applyStatement,
      buildSourceOutputModel: noSourceOutputs
    });
  } catch {
    return null;
  }
  if (hasRelevantError(compilerDiagnostics, relevantLines)) return null;

  let moduleScalarRuntime: ModuleScalarRuntimeCompilation;
  try {
    moduleScalarRuntime = compileModuleScalarRuntime({
      statements,
      stableStatementIdByIndex,
      moduleSemanticAnalysis: previewAnalysis,
      moduleMaterialization,
      documentBindingAnalysis: compiled.bindingAnalysis,
      documentScalarProgram: compiled.scalarProgram,
      reconciledContainers: {
        elementIdByStatementIndex: moduleMaterialization.elementIdBySourceStatementIndex,
        elements: compileResult.elements
      },
      includeStatement: (statement, statementIndex) =>
        statement.kind !== "atStop" && isCompilableDslStatement(statements, statementIndex),
      elements: compileResult.elements,
      sourceScopeIndex: sourceNamespace.scopeIndex,
      moduleGeometryRuntime,
      drawingModifiers: compileResult.modifiers
    });
  } catch {
    return null;
  }

  const targetPath = syntheticStatementIds;
  const targetRuntimeElementId = materializedRuntimeElementId("moduleInstance", targetPath);
  const targetRuntimeElementIds = moduleMaterialization.executionStatements
    .filter((entry) =>
      entry.instancePath.length >= targetPath.length &&
      targetPath.every((statementId, index) => entry.instancePath[index] === statementId)
    )
    .map((entry) => entry.runtimeElementId);
  if (!targetRuntimeElementIds.includes(targetRuntimeElementId)) return null;

  const diagnostics = [
    ...relevantDiagnostics(sourceNamespace.diagnostics, relevantLines),
    ...relevantDiagnostics(analysis.diagnostics, relevantLines),
    ...relevantDiagnostics(moduleGeometryRuntime.diagnostics, relevantLines),
    ...relevantDiagnostics(compilerDiagnostics, relevantLines)
  ];
  return {
    target: input.target,
    targetRuntimeElementId,
    targetRuntimeElementIds,
    compileResult: {
      ...compileResult,
      evaluationLimitIndex: undefined,
      moduleMaterialization,
      moduleGeometryRuntime
    },
    moduleSemanticAnalysis: previewAnalysis,
    moduleMaterialization,
    moduleGeometryRuntime,
    moduleScalarRuntime,
    diagnostics
  };
};
