import { createStatementIdentity, type StatementIdentity } from "../document/statementIdentity";
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
  ModuleScalarExpressionSemantic,
  ModuleScalarSourceTarget,
  ModuleSemanticAnalysis,
  ResolvedModuleParameterBinding
} from "./moduleSemanticTypes";
import { buildSourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";
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
  compiled: CompiledDslDocument,
  target: ModuleDefinitionSemantic
): ModuleDefinitionSemantic[] | null => {
  const analysis = compiled.moduleSemanticAnalysis;
  if (!analysis) return null;
  const chain: ModuleDefinitionSemantic[] = [target];
  let ownerIndex = ownerModuleIndexOf(compiled.statements, target.statementIndex);
  const visited = new Set<number>([target.statementIndex]);
  while (ownerIndex !== null) {
    if (visited.has(ownerIndex)) return null;
    visited.add(ownerIndex);
    const owner = analysis.definitions.find((candidate) => candidate.statementIndex === ownerIndex);
    if (!owner) return null;
    chain.push(owner);
    ownerIndex = ownerModuleIndexOf(compiled.statements, owner.statementIndex);
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
    if (!ids.has(index)) ids.set(index, createStatementIdentity(`module-preview-source-${statement.kind}`));
  });
  return ids;
};

const syntheticCallSource = (
  instanceName: string,
  moduleName: string,
  args: readonly ModulePreviewArgument[]
) => {
  if (args.length === 0) return `nui 4\ninstance ${instanceName} = ${formatDslName(moduleName)}()`;
  return [
    "nui 4",
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
  enclosingStatementIndex: number | null
): SyntheticCall | null => {
  const source = syntheticCallSource(instanceName, moduleName, args);
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
      enclosing: enclosingStatementIndex === null
        ? null
        : { statementIndex: enclosingStatementIndex, branch: "then" }
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

const expressionIsResolved = (expression: ModuleScalarExpressionSemantic): boolean =>
  expression.references.every((reference) => reference.resolution === "resolved" && reference.target !== null) &&
  expression.geometryProperties.every((reference) =>
    (reference.resolution === "resolved" || reference.resolution === "deferred") && reference.target !== null
  ) &&
  expression.geometryBuiltinArguments.every((argument) => referenceIsResolved(argument.reference));

const referenceIsResolved = (reference: ModuleGeometryReferenceSemantic): boolean =>
  reference.coordinate !== null
    ? (!reference.coordinate.x || expressionIsResolved(reference.coordinate.x)) &&
      (!reference.coordinate.y || expressionIsResolved(reference.coordinate.y))
    : (reference.resolution === "resolved" || reference.resolution === "deferred") && reference.target !== null;

const bindingIsResolved = (binding: ResolvedModuleParameterBinding): boolean => {
  if (binding.state === "requiredOmitted") return false;
  if (binding.state === "optionalOmitted") return true;
  if (binding.state === "defaultedOmitted") return binding.value?.kind === "scalar" && expressionIsResolved(binding.value.expression);
  if (!binding.value) return false;
  return binding.value.kind === "scalar"
    ? expressionIsResolved(binding.value.expression)
    : referenceIsResolved(binding.value.reference);
};

const statementIndexForScalarTarget = (target: ModuleScalarSourceTarget): number | null => {
  switch (target.kind) {
    case "iteration":
    case "moduleLocal":
    case "documentBinding":
      return target.statementIndex;
    case "deferredModuleScalarExport":
      return target.instanceStatementIndex;
    default:
      return null;
  }
};

const callerExpressionIsSafe = (
  expression: ModuleScalarExpressionSemantic,
  cutoffStatementIndex: number,
  allowedAncestorDefinitionIds: ReadonlySet<StatementIdentity>,
  statements: readonly DslStatement[]
): boolean => {
  if (!expressionIsResolved(expression)) return false;
  for (const reference of expression.references) {
    const target = reference.target;
    if (!target) return false;
    if (target.kind === "parameter") {
      if (!allowedAncestorDefinitionIds.has(target.definitionStatementId)) return false;
      continue;
    }
    if (target.kind === "moduleLocal" || target.kind === "iteration" || target.kind === "deferredModuleScalarExport") return false;
    const statementIndex = statementIndexForScalarTarget(target);
    if (statementIndex !== null && statementIndex >= cutoffStatementIndex) return false;
  }
  for (const property of expression.geometryProperties) {
    const target = property.target;
    if (!target) return false;
    if (target.kind === "parameterProperty") {
      if (!allowedAncestorDefinitionIds.has(target.definitionStatementId)) return false;
      continue;
    }
    if (target.kind === "deferredModuleExportProperty") return false;
    if (ownerModuleIndexOf(statements, target.statementIndex) !== null || target.statementIndex >= cutoffStatementIndex) return false;
  }
  for (const argument of expression.geometryBuiltinArguments) {
    if (!callerGeometryReferenceIsSafe(argument.reference, cutoffStatementIndex, allowedAncestorDefinitionIds, statements)) return false;
  }
  return true;
};

const callerGeometryReferenceIsSafe = (
  reference: ModuleGeometryReferenceSemantic,
  cutoffStatementIndex: number,
  allowedAncestorDefinitionIds: ReadonlySet<StatementIdentity>,
  statements: readonly DslStatement[]
): boolean => {
  if (reference.coordinate) {
    return (!reference.coordinate.x || callerExpressionIsSafe(reference.coordinate.x, cutoffStatementIndex, allowedAncestorDefinitionIds, statements)) &&
      (!reference.coordinate.y || callerExpressionIsSafe(reference.coordinate.y, cutoffStatementIndex, allowedAncestorDefinitionIds, statements));
  }
  if (!referenceIsResolved(reference) || !reference.target) return false;
  const target = reference.target;
  if (target.kind === "parameter") return allowedAncestorDefinitionIds.has(target.definitionStatementId);
  if (target.kind === "deferredModuleExport") return false;
  return ownerModuleIndexOf(statements, target.statementIndex) === null && target.statementIndex < cutoffStatementIndex;
};

const callerBindingIsSafe = (
  binding: ResolvedModuleParameterBinding,
  cutoffStatementIndex: number,
  allowedAncestorDefinitionIds: ReadonlySet<StatementIdentity>,
  statements: readonly DslStatement[]
): boolean => {
  if (!bindingIsResolved(binding)) return false;
  if (!binding.value) return binding.state === "optionalOmitted";
  return binding.value.kind === "scalar"
    ? callerExpressionIsSafe(binding.value.expression, cutoffStatementIndex, allowedAncestorDefinitionIds, statements)
    : callerGeometryReferenceIsSafe(binding.value.reference, cutoffStatementIndex, allowedAncestorDefinitionIds, statements);
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

const hasRelevantError = (diagnostics: readonly DslDiagnostic[], relevantLines: ReadonlySet<number>) =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error" && relevantLines.has(diagnostic.line));

const projectAncestorDefinitions = (
  analysis: ModuleSemanticAnalysis,
  chain: readonly ModuleDefinitionSemantic[],
  syntheticStatementIds: readonly StatementIdentity[]
): ModuleSemanticAnalysis => {
  const ancestorIds = new Set(chain.slice(0, -1).map((definition) => definition.statementId));
  const childIdByAncestor = new Map<StatementIdentity, StatementIdentity>();
  chain.slice(0, -1).forEach((definition, index) => {
    childIdByAncestor.set(definition.statementId, syntheticStatementIds[index + 1]);
  });
  const definitions = analysis.definitions.map((definition) => {
    if (!ancestorIds.has(definition.statementId)) return definition;
    const childId = childIdByAncestor.get(definition.statementId);
    const childBody = childId
      ? definition.bodyStatements.filter((body) => body.statementId === childId)
      : [];
    return {
      ...definition,
      localScalars: [],
      bodyStatements: childBody,
      exports: [],
      bodyStatementIds: childBody.map((body) => body.statementId)
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

/**
 * Compile one exact-current Module definition through the existing Module
 * semantic/materialization/compiler/scalar-runtime path without changing the
 * canonical `.nui` source. Synthetic calls exist only in an ephemeral AST.
 */
export const compileModulePreviewRoot = (input: ModulePreviewRootInput): ModulePreviewRootResult | null => {
  const compiled = exactCompiled(input.source, input.semantic);
  const sourceAnalysis = compiled?.moduleSemanticAnalysis;
  if (!compiled || !sourceAnalysis || !compiled.sourceLexicalNamespace) return null;
  const sourceDefinition = sourceAnalysis.definitionsByStatementId.get(input.target.definitionStatementId);
  if (
    !sourceDefinition ||
    sourceDefinition.statementIndex !== input.target.definitionStatementIndex ||
    sourceDefinition.name !== input.target.name ||
    compiled.statements[sourceDefinition.statementIndex]?.kind !== "moduleDefinition" ||
    compiled.statements[sourceDefinition.statementIndex]?.sourceRevision !== input.source.sourceRevision
  ) return null;

  const chain = definitionChainFor(compiled, sourceDefinition);
  if (!chain) return null;
  const ancestorContexts = new Map(
    (input.ancestorContexts ?? []).map((context) => [context.definitionStatementId, context] as const)
  );
  const expectedAncestorIds = new Set(chain.slice(0, -1).map((definition) => definition.statementId));
  if ([...ancestorContexts.keys()].some((id) => !expectedAncestorIds.has(id))) return null;

  const statements: DslStatement[] = [...compiled.statements];
  const stableStatementIdByIndex = stableIdsFor(compiled);
  const logicalTextByStatementIndex = new Map<number, string>();
  compiled.statements.forEach((statement, index) => {
    const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (logical) logicalTextByStatementIndex.set(index, logical.logicalText);
  });

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
      chainIndex === 0 ? null : chain[chainIndex - 1].statementIndex
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

  const sourceNamespace = buildSourceLexicalNamespaceIndex(statements, stableStatementIdByIndex);
  const analysis = analyzeModuleSemantics({
    statements,
    stableStatementIdByIndex,
    sourceNamespace,
    spans: compiled.spans,
    logicalTextByStatementIndex,
    documentScalarBindings: documentScalarBindingsFor(compiled, stableStatementIdByIndex)
  });

  const syntheticInstances = syntheticStatementIds.map((statementId, index) => {
    const instance = analysis.instancesByStatementId.get(statementId);
    const expected = chain[index];
    return instance?.callee?.definitionStatementId === expected.statementId ? instance : null;
  });
  if (syntheticInstances.some((instance) => instance === null)) return null;

  const allowedAncestors = new Set<StatementIdentity>();
  for (const [index, instance] of syntheticInstances.entries()) {
    if (!instance) return null;
    if (!instance.parameterBindings.every((binding) =>
      callerBindingIsSafe(binding, chain[index].statementIndex, allowedAncestors, statements)
    )) return null;
    allowedAncestors.add(chain[index].statementId);
  }

  const ancestorDefinitionIds = new Set(chain.slice(0, -1).map((definition) => definition.statementId));
  const relevantLines = relevantLinesFor(
    statements,
    analysis,
    sourceDefinition.statementId,
    syntheticIndexes,
    ancestorDefinitionIds
  );
  if (hasRelevantError(analysis.diagnostics, relevantLines)) return null;

  const previewAnalysis = projectAncestorDefinitions(analysis, chain, syntheticStatementIds);
  const assignedElementIds = assignedElementIdsFor(statements, stableStatementIdByIndex);
  const materialized = materializeModuleExecution({
    statements,
    stableStatementIdByIndex,
    assignedElementIds,
    moduleSemanticAnalysis: previewAnalysis
  });
  const moduleMaterialization: ModuleMaterialization = {
    ...materialized,
    evaluationLimitIndex: undefined
  };
  const moduleGeometryRuntime = buildModuleGeometryRuntime({
    statements,
    stableStatementIdByIndex,
    moduleSemanticAnalysis: previewAnalysis,
    moduleMaterialization
  });
  if (hasRelevantError(moduleGeometryRuntime.diagnostics, relevantLines)) return null;

  const diagnostics: DslDiagnostic[] = [];
  const visibilityRoles = compiled.document?.visibilityRoles ?? [];
  const visibilityProfiles = compiled.document?.visibilityProfiles ?? [];
  const compileResult = compileMaterializedExecution({
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
    diagnostics,
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
  if (hasRelevantError(diagnostics, relevantLines)) return null;

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
      drawingModifiers: compiled.document?.modifiers
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
    diagnostics: [...analysis.diagnostics, ...moduleGeometryRuntime.diagnostics, ...diagnostics]
  };
};
