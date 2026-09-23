import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import { bindingIdForStableStatementId } from "../scalars/bindingCatalog";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticDeclarationRange,
  dslSemanticIdentityKey,
  semanticIdentityForModuleTarget,
  type DslSemanticIdentity
} from "./dslSemanticOccurrenceIndex";
import { exactPhysicalSpan } from "./dslDiagnosticSpan";
import type { DslDiagnostic } from "./dslTypes";
import type { DslPhysicalSpan } from "./logicalStatementSourceMap";
import type { ModuleDefinitionSemantic, ModuleSemanticAnalysis } from "./moduleSemanticTypes";
import type { SourceLexicalDeclaration } from "./sourceLexicalNamespaceIndex";

export const DSL_LINT_DIAGNOSTIC_CODES = {
  unusedTypedDeclaration: "unused-typed-declaration",
  unusedModuleParameter: "unused-module-parameter",
  unusedPrivateModule: "unused-private-module"
} as const;

type DslLintDiagnosticCode = typeof DSL_LINT_DIAGNOSTIC_CODES[keyof typeof DSL_LINT_DIAGNOSTIC_CODES];

const isExactCurrentCompiledDocument = (compiled: CompiledDslDocument): boolean => {
  const sourceMap = compiled.spans?.sourceMap;
  const statementMap = compiled.statementMap;
  if (!compiled.document || !sourceMap || !statementMap || compiled.majorVersion === null) return false;
  if (statementMap.sourceRevision !== sourceMap.sourceRevision || statementMap.statements.length !== compiled.statements.length) return false;
  if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")) return false;
  if ((compiled.bindingIssueDiagnostics ?? []).some((diagnostic) => diagnostic.severity === "error")) return false;
  if (compiled.moduleSemanticAnalysis?.diagnostics.some((diagnostic) => diagnostic.severity === "error")) return false;
  return compiled.statements.every((statement) =>
    statement.sourceRevision === sourceMap.sourceRevision &&
    statement.documentRange.sourceRevision === sourceMap.sourceRevision &&
    statement.physicalSpan.sourceRevision === sourceMap.sourceRevision
  );
};

const sourceRevisionFor = (compiled: CompiledDslDocument): number => compiled.spans.sourceMap.sourceRevision;

const exactSingleSegment = (span: DslPhysicalSpan | null | undefined) =>
  span?.segments.length === 1 ? span.segments[0] ?? null : null;

const sameRange = (
  left: { from: number; to: number },
  right: { from: number; to: number }
): boolean => left.from === right.from && left.to === right.to;

const referenceCountFor = (
  index: ReturnType<typeof createDslSemanticOccurrenceIndex>,
  identity: DslSemanticIdentity,
  excludedRanges: readonly { from: number; to: number }[] = []
): number => {
  const identityKey = dslSemanticIdentityKey(identity);
  const excluded = new Set(excludedRanges.map((range) => `${range.from}:${range.to}`));
  return index.occurrences.filter((occurrence) =>
    occurrence.kind === "reference" &&
    dslSemanticIdentityKey(occurrence.identity) === identityKey &&
    !excluded.has(`${occurrence.from}:${occurrence.to}`)
  ).length;
};

const exactDeclarationRangeFor = (
  index: ReturnType<typeof createDslSemanticOccurrenceIndex>,
  identity: DslSemanticIdentity,
  expectedRange: { from: number; to: number }
) => {
  const declarationRange = dslSemanticDeclarationRange(index, identity);
  return declarationRange && sameRange(declarationRange, expectedRange) ? declarationRange : null;
};

const diagnosticFor = (
  compiled: CompiledDslDocument,
  code: DslLintDiagnosticCode,
  name: string,
  range: { from: number; to: number },
  line: number
): DslDiagnostic => ({
  severity: "warning",
  line,
  column: 1,
  message: code === DSL_LINT_DIAGNOSTIC_CODES.unusedTypedDeclaration
    ? `Declaration '${name}' is not used anywhere.`
    : code === DSL_LINT_DIAGNOSTIC_CODES.unusedModuleParameter
      ? `Module parameter '${name}' is not used anywhere.`
      : `Private Module '${name}' is not used anywhere.`,
  presentation: { key: `diagnostic.${code}`, parameters: { name } },
  sourceRevision: sourceRevisionFor(compiled),
  physicalSpan: {
    segments: [range],
    sourceRevision: sourceRevisionFor(compiled)
  },
  exactSpanOnly: true,
  code
});

const bindingForSourceTypedDeclaration = (
  compiled: CompiledDslDocument,
  bindingAnalysis: BindingAnalysis,
  declaration: SourceLexicalDeclaration
) => {
  const statement = compiled.statements[declaration.statementIndex];
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(declaration.statementIndex);
  if (
    !statement || statement.kind !== "typedDeclaration" || statement.bindingKind !== "const" ||
    statement.valueType === null || !statementId || declaration.statementId !== statementId ||
    declaration.nameSpan === null
  ) return null;

  const bindingId = bindingIdForStableStatementId(statementId);
  const binding = bindingAnalysis.catalog.bindingsById.get(bindingId);
  if (
    !binding || binding.kind !== "typed" || binding.id !== bindingId || binding.statementIndex !== declaration.statementIndex ||
    binding.name !== declaration.name || binding.mutability !== "const" || binding.resolutionMode === "preResolvedOnly" ||
    binding.declaredType === null || !binding.nameSpan ||
    binding.nameSpan.start !== declaration.nameSpan.start || binding.nameSpan.end !== declaration.nameSpan.end
  ) return null;
  return { binding, bindingId, statement };
};

const moduleDefinitionFor = (
  analysis: ModuleSemanticAnalysis,
  statementId: string,
  statementIndex: number
): ModuleDefinitionSemantic | null => {
  const definitions = analysis.definitions.filter((definition) => definition.statementId === statementId);
  const definition = analysis.definitionsByStatementId.get(statementId);
  return definitions.length === 1 && definition === definitions[0] && definition.statementIndex === statementIndex
    ? definition
    : null;
};

const callSiteLabelRangesForModuleParameter = (
  compiled: CompiledDslDocument,
  analysis: ModuleSemanticAnalysis,
  definitionStatementId: string,
  parameterIndex: number
): readonly { from: number; to: number }[] | null => {
  const ranges: { from: number; to: number }[] = [];
  for (const instance of analysis.instances) {
    if (instance.callee?.definitionStatementId !== definitionStatementId) continue;
    const bindings = instance.parameterBindings.filter((binding) => binding.parameterIndex === parameterIndex);
    if (bindings.length !== 1) return null;
    const binding = bindings[0]!;
    if (binding.argumentIndex === null) continue;

    const statement = compiled.statements[instance.statementIndex];
    const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(instance.statementIndex);
    if (!statement || statement.kind !== "moduleInstance" || statementId !== instance.statementId) return null;
    if (!Number.isInteger(binding.argumentIndex) || binding.argumentIndex < 0) return null;
    const argument = statement.arguments[binding.argumentIndex];
    if (!argument || argument.label === null) {
      if (binding.argumentLabel !== null) return null;
      continue;
    }
    if (binding.argumentLabel !== argument.label || !argument.labelSpan) return null;
    const labelRange = exactSingleSegment(exactPhysicalSpan(compiled.spans, statement, argument.labelSpan));
    if (!labelRange) return null;
    ranges.push(labelRange);
  }
  return ranges;
};

const unusedTypedDeclarationDiagnostics = (
  compiled: CompiledDslDocument,
  occurrenceIndex: ReturnType<typeof createDslSemanticOccurrenceIndex>
): DslDiagnostic[] => {
  const namespace = compiled.sourceLexicalNamespace;
  const bindingAnalysis = compiled.bindingAnalysis;
  if (!namespace || !bindingAnalysis) return [];

  const diagnostics: DslDiagnostic[] = [];
  for (const declaration of namespace.allDeclarations) {
    if (declaration.kind !== "typedDeclaration") continue;
    const resolved = bindingForSourceTypedDeclaration(compiled, bindingAnalysis, declaration);
    if (!resolved) continue;
    const identity: DslSemanticIdentity = { kind: "typed", bindingId: resolved.bindingId };
    const physicalName = exactSingleSegment(resolved.statement.namePhysicalSpan);
    if (!physicalName) continue;
    const declarationRange = exactDeclarationRangeFor(occurrenceIndex, identity, physicalName);
    if (!declarationRange || referenceCountFor(occurrenceIndex, identity) !== 0) continue;
    diagnostics.push(diagnosticFor(compiled, DSL_LINT_DIAGNOSTIC_CODES.unusedTypedDeclaration, declaration.name, declarationRange, resolved.statement.line));
  }
  return diagnostics;
};

const moduleSemanticDiagnostics = (
  compiled: CompiledDslDocument,
  occurrenceIndex: ReturnType<typeof createDslSemanticOccurrenceIndex>
): DslDiagnostic[] => {
  const namespace = compiled.sourceLexicalNamespace;
  const analysis = compiled.moduleSemanticAnalysis;
  if (!namespace || !analysis) return [];

  const diagnostics: DslDiagnostic[] = [];
  for (const declaration of namespace.allDeclarations) {
    if (declaration.kind !== "moduleDefinition") continue;
    const statement = compiled.statements[declaration.statementIndex];
    const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(declaration.statementIndex);
    if (
      !statement || statement.kind !== "moduleDefinition" || !statementId || declaration.statementId !== statementId ||
      declaration.nameSpan === null
    ) continue;
    const definition = moduleDefinitionFor(analysis, statementId, declaration.statementIndex);
    if (!definition) continue;
    if (statement.parameters.length !== definition.parameters.length) continue;

    const definitionIdentity: DslSemanticIdentity = {
      kind: "module",
      target: { kind: "moduleDefinition", statementId }
    };
    const physicalName = exactSingleSegment(statement.namePhysicalSpan);
    if (!physicalName) continue;
    const definitionRange = exactDeclarationRangeFor(occurrenceIndex, definitionIdentity, physicalName);
    if (definitionRange && !statement.exported && referenceCountFor(occurrenceIndex, definitionIdentity) === 0) {
      diagnostics.push(diagnosticFor(compiled, DSL_LINT_DIAGNOSTIC_CODES.unusedPrivateModule, declaration.name, definitionRange, statement.line));
    }

    definition.parameters.forEach((parameter, parameterIndex) => {
      const parsedParameter = statement.parameters[parameterIndex];
      if (!parsedParameter || parsedParameter.name !== parameter.name) return;
      const parameterPhysicalName = exactSingleSegment(parsedParameter.namePhysicalSpan);
      if (!parameterPhysicalName) return;
      const identity = semanticIdentityForModuleTarget(compiled, {
        kind: "moduleParameter",
        slot: { definitionStatementId: statementId, parameterIndex }
      });
      if (!identity) return;
      const parameterRange = exactDeclarationRangeFor(occurrenceIndex, identity, parameterPhysicalName);
      if (!parameterRange) return;
      const callSiteLabelRanges = callSiteLabelRangesForModuleParameter(compiled, analysis, statementId, parameterIndex);
      if (!callSiteLabelRanges || referenceCountFor(occurrenceIndex, identity, callSiteLabelRanges) !== 0) return;
      diagnostics.push(diagnosticFor(compiled, DSL_LINT_DIAGNOSTIC_CODES.unusedModuleParameter, parameter.name, parameterRange, statement.line));
    });
  }
  return diagnostics;
};

/** Analyze maintenance-quality warnings from one exact-current compiled source snapshot. */
export const analyzeDslLintDiagnostics = (compiled: CompiledDslDocument): readonly DslDiagnostic[] => {
  if (!isExactCurrentCompiledDocument(compiled)) return [];
  try {
    const occurrenceIndex = createDslSemanticOccurrenceIndex(compiled);
    return [
      ...unusedTypedDeclarationDiagnostics(compiled, occurrenceIndex),
      ...moduleSemanticDiagnostics(compiled, occurrenceIndex)
    ];
  } catch {
    return [];
  }
};
