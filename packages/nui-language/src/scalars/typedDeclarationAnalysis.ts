// One-pass integration of Tasks 11–15 for typed declarations. Task 19
// lowering consumes this result directly && never repeats this work.
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { buildLexicalScopeIndexFromStatements } from "../dsl/lexicalScopeIndexAdapter";
import { isCanonicalValueBindingDeclaration, isCompilableDslStatement } from "../dsl/dslCompilationGuard";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { DslDiagnostic, DslDiagnosticPresentation, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { RecordValueSemantic } from "../dsl/recordSemanticAnalysis";
import { isElementDslStatement } from "../dsl/dslParser";
import { parameterKeyForArg } from "../dsl/dslConstructions";
import { analyzeBindings, type BindingAnalysis, type InitializerReference } from "./bindingAnalysis";
import { bindingIdForStableStatementId, buildBindingCatalog, type Binding, type BindingId, type BindingSeed, type SourceNamespaceBindingResolver } from "./bindingCatalog";
import { resolveInitializerReferences, type BindingResolution, type InitializerResolutionRequest } from "./bindingResolution";
import { resolveBuiltinGeometryArguments, type ResolveBuiltinGeometryArgumentsResult } from "./builtinGeometryArgumentResolution";
import { getBuiltinFunctionDefinition } from "./builtinFunctions";
import type { ScalarExpressionAst } from "./expressionAst";
import { collectScalarExpressionReferences } from "./expressionReferenceCollector";
import { isScalarExpressionCandidateSource, parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import type { ReconciledCadContainerInput } from "./containerIndex";
import type { ScalarProgramPositionMap } from "./scalarProgram";
import type { ScalarType } from "./types";
import type { ScalarExpressionResolvedCollectionIndex, ScalarExpressionResolvedReference, TypedScalarExpression } from "./typedExpressionAst";
import { resolveGeometryPropertyMetadata } from "./typedGeometryPropertyResolution";
import { findParameterDefinition, scalarTypeForParameterDefinition } from "../parameters/parameterDefinitions";
import { createElementNameContext } from "../model/elementNames";
import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import { isDslScalarValueType, scalarTypeOfDslValueType } from "../dsl/dslValueTypes";
import { scanExpressionReferences } from "../dsl/expressionReferenceToken";
import {
  resolveSourceLexicalPath,
  type SourceLexicalNamespaceIndex,
  type SourceLexicalDeclaration
} from "../dsl/sourceLexicalNamespaceIndex";
import {
  planRecordScalarLowering,
  prepareRecordScalarExpression,
  recordScalarSourceBindingResolverFor,
  type ExternalRecordScalarAlias,
  type RecordScalarControlFlowProjection
} from "./recordScalarLowering";

export type { DiagnosticSpanContext };

export type TypedDeclarationAnalysis = {
  bindingAnalysis: BindingAnalysis;
  typedInitializerByBindingId: ReadonlyMap<BindingId, TypedScalarExpression>;
  positionMap: ScalarProgramPositionMap;
};

export type TypedDeclarationAnalysisCompilation = {
  analysis?: TypedDeclarationAnalysis;
  diagnostics: readonly DslDiagnostic[];
};

export type AdditionalScalarInitializer = {
  bindingId: BindingId;
  raw: string;
  span: DslSpan;
  /** Prepared projected ASTs are used only for record field backing slots. */
  ast?: ScalarExpressionAst;
  /** Embedded scalar expressions may have a result type distinct from the
   * synthetic binding used to type their lexical references. */
  expectedType?: ScalarType;
  /** Compiler-only metadata for root record field projections. */
  recordControlFlowProjection?: RecordScalarControlFlowProjection;
};

export type PreparedScalarExpressionIssue = {
  code: string;
  span: DslSpan;
  message: string;
  presentation?: DslDiagnosticPresentation;
};

export type PreparedScalarExpressionDependency = {
  bindingId: BindingId;
  name: string;
  span: DslSpan;
};

export type PrepareScalarExpression = (input: {
  bindingId: BindingId;
  statementIndex: number;
  ast: ScalarExpressionAst;
  referenceResolutions: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  /** Raw dotted-property nodes already owned as geometry builtin operands. */
  geometryPropertySpanStarts: ReadonlySet<number>;
}) => {
  ast: ScalarExpressionAst;
  references: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  issues?: readonly PreparedScalarExpressionIssue[];
  dependencies?: readonly PreparedScalarExpressionDependency[];
};

type CollectionIndexResolver = (input: {
  statementIndex: number;
  node: Extract<ScalarExpressionAst, { kind: "collectionIndex" }>;
}) => ScalarExpressionResolvedCollectionIndex | null;

type ParsedInitializer = { ast: ScalarExpressionAst; references: ReturnType<typeof collectReferences> };

/** Pure AST walker with no declaration-specific logic - reused as-is by
 * Task 25's conditionalGroupConditionCompiler.ts for the same purpose
 * (collecting every `@name` reference in a parsed scalar expression, in
 * source order), so there is exactly one reference-collecting traversal in
 * the scalar subsystem. */
export const collectReferences = (ast: ScalarExpressionAst): readonly { name: string; span: { start: number; end: number } }[] => {
  return collectScalarExpressionReferences(ast);
};

/** Whether an expression needs scalar-only syntax rather than the separate
 * numeric expression evaluator used by geometry and text interpolation. */
export const containsNonNumericScalarSyntax = (ast: ScalarExpressionAst): boolean => {
  switch (ast.kind) {
    case "booleanLiteral":
    case "stringLiteral":
    case "unresolvedChoiceLiteral":
      return true;
    case "unary":
      return ast.operator === "!" || containsNonNumericScalarSyntax(ast.operand);
    case "binary":
      return (
        ast.operator === "||" ||
        ast.operator === "&&" ||
        ast.operator === "==" ||
        ast.operator === "!=" ||
        ast.operator === "<" ||
        ast.operator === "<=" ||
        ast.operator === ">" ||
        ast.operator === ">=" ||
        containsNonNumericScalarSyntax(ast.left) ||
        containsNonNumericScalarSyntax(ast.right)
      );
    case "group":
      return containsNonNumericScalarSyntax(ast.expression);
    case "valueIf":
      return true;
    case "valueMatch":
      return true;
    case "collectionIndex":
      return containsNonNumericScalarSyntax(ast.index);
    case "call":
      return getBuiltinFunctionDefinition(ast.name)?.signatures.some((signature) => signature.returnType.kind === "boolean") ?? false;
    default:
      return false;
  }
};

const spanContains = (container: DslSpan, candidate: DslSpan): boolean =>
  candidate.start >= container.start && candidate.end <= container.end;

const sameSpan = (left: DslSpan, right: DslSpan): boolean =>
  left.start === right.start && left.end === right.end;

const sharedRecordControlFlowDiagnostic = (
  diagnostic: { code: string; span: DslSpan },
  projection: RecordScalarControlFlowProjection
): boolean => projection.shells.some((shell) => {
  if (shell.kind === "if") return spanContains(shell.conditionSpan, diagnostic.span);
  if (spanContains(shell.scrutineeSpan, diagnostic.span)) return true;
  if (diagnostic.code === "missing-match-case" && sameSpan(shell.span, diagnostic.span)) return true;
  return (
    (diagnostic.code === "duplicate-match-case" || diagnostic.code === "impossible-match-case") &&
    shell.caseLabelSpans.some((span) => sameSpan(span, diagnostic.span))
  );
});

const shouldEmitRecordProjectionDiagnostic = (
  bindingId: BindingId,
  diagnostic: { code: string; span: DslSpan },
  additionalInitializers: ReadonlyMap<BindingId, AdditionalScalarInitializer>
): boolean => {
  const projection = additionalInitializers.get(bindingId)?.recordControlFlowProjection;
  return !projection || projection.diagnosticOwner || !sharedRecordControlFlowDiagnostic(diagnostic, projection);
};

const collectionIndexResolutionsFor = (
  ast: ScalarExpressionAst,
  statementIndex: number,
  resolver: CollectionIndexResolver | undefined
): ReadonlyMap<number, ScalarExpressionResolvedCollectionIndex> => {
  const resolutions = new Map<number, ScalarExpressionResolvedCollectionIndex>();
  const visit = (node: ScalarExpressionAst): void => {
    if (node.kind === "collectionIndex") {
      const resolution = resolver?.({ statementIndex, node });
      if (resolution) resolutions.set(node.span.start, resolution);
      visit(node.index);
      return;
    }
    if (node.kind === "unary") return visit(node.operand);
    if (node.kind === "binary") { visit(node.left); visit(node.right); return; }
    if (node.kind === "group") return visit(node.expression);
    if (node.kind === "valueIf") { visit(node.condition); visit(node.thenBranch); visit(node.elseBranch); return; }
    if (node.kind === "valueMatch") { visit(node.scrutinee); node.arms.forEach((arm) => visit(arm.expression)); return; }
    if (node.kind === "call") node.args.forEach((argument) => visit(argument.expression));
  };
  visit(ast);
  return resolutions;
};

const collectionIndexBaseStartsFor = (ast: ScalarExpressionAst): ReadonlySet<number> => {
  const starts = new Set<number>();
  const visit = (node: ScalarExpressionAst): void => {
    if (node.kind === "collectionIndex") {
      starts.add(node.span.start);
      visit(node.index);
      return;
    }
    if (node.kind === "unary") return visit(node.operand);
    if (node.kind === "binary") { visit(node.left); visit(node.right); return; }
    if (node.kind === "group") return visit(node.expression);
    if (node.kind === "valueIf") { visit(node.condition); visit(node.thenBranch); visit(node.elseBranch); return; }
    if (node.kind === "valueMatch") { visit(node.scrutinee); node.arms.forEach((arm) => visit(arm.expression)); return; }
    if (node.kind === "call") node.args.forEach((argument) => visit(argument.expression));
  };
  visit(ast);
  return starts;
};

const referenceResolutionsForAst = (
  ast: ScalarExpressionAst,
  collectionResolutions: ReadonlyMap<number, ScalarExpressionResolvedCollectionIndex>,
  ordinary: readonly (BindingResolution | ScalarExpressionResolvedReference)[]
): readonly (BindingResolution | ScalarExpressionResolvedReference)[] => {
  const output: (BindingResolution | ScalarExpressionResolvedReference)[] = [];
  let cursor = 0;
  const visit = (node: ScalarExpressionAst): void => {
    if (node.kind === "reference") { output.push(ordinary[cursor++]!); return; }
    if (node.kind === "collectionIndex") {
      const resolved = collectionResolutions.get(node.span.start);
      if (resolved) output.push(resolved);
      else output.push(ordinary[cursor++]!);
      visit(node.index);
      return;
    }
    if (node.kind === "unary") return visit(node.operand);
    if (node.kind === "binary") { visit(node.left); visit(node.right); return; }
    if (node.kind === "group") return visit(node.expression);
    if (node.kind === "valueIf") { visit(node.condition); visit(node.thenBranch); visit(node.elseBranch); return; }
    if (node.kind === "valueMatch") { visit(node.scrutinee); node.arms.forEach((arm) => visit(arm.expression)); return; }
    if (node.kind === "call") node.args.forEach((argument) => visit(argument.expression));
  };
  visit(ast);
  if (cursor !== ordinary.length) throw new Error("typedDeclarationAnalysis: scalar reference resolution sequence is out of sync");
  return output;
};

/** Shared "why this reference isn't usable" message for a non-resolved
 * BindingResolution - same wording Task 25's conditionalGroupConditionCompiler.ts
 * && Task 26's textTemplate.ts both surface for an unresolved/forward/duplicate
 * reference inside typed-only syntax. */
export const unresolvedReferenceMessage = (name: string, resolution: BindingResolution | undefined): string => {
  if (resolution?.kind === "forward") return `"${name}" はこの位置より後で宣言されているため、まだ参照できません。`;
  if (resolution?.kind === "namespace" && resolution.reason === "forward") return `"${name}" はこの位置より後で宣言されているため、まだ参照できません。`;
  if (resolution?.kind === "duplicate") return `"${name}" は複数の宣言と一致するため一意に解決できません。`;
  if (resolution?.kind === "namespace" && resolution.reason === "ambiguous") return `"${name}" は複数の宣言と一致するため一意に解決できません。`;
  return `未定義の変数 "${name}" を参照しています。`;
};

const sourceNamespaceBindingResolverFor = (
  sourceNamespace: SourceLexicalNamespaceIndex,
  typedStatementIndexes: ReadonlySet<number>,
  additionalResolver?: SourceNamespaceBindingResolver
): SourceNamespaceBindingResolver => (name, statementIndex) => {
  const additional = additionalResolver?.(name, statementIndex, sourceNamespace.scopeIndex.scopeOfStatement.get(statementIndex) ?? sourceNamespace.scopeIndex.rootScopeId);
  if (additional) return additional;
  const path = parseDslReferenceToken(name);
  const lookup = resolveSourceLexicalPath(sourceNamespace, statementIndex, path);
  if (lookup.kind === "undefined") return null;
  if (lookup.kind === "resolved") {
    if (
      lookup.declaration.kind === "typedDeclaration" &&
      typedStatementIndexes.has(lookup.declaration.statementIndex) &&
      lookup.declaration.statement.kind === "typedDeclaration" &&
      isDslScalarValueType(lookup.declaration.statement.valueType)
    ) {
      const bindingId = bindingIdForStableStatementId(lookup.declaration.statementId);
      return { kind: "resolved", bindingId };
    }
    return {
      kind: "blocked",
      reason: "incompatible",
      declarationKind: lookup.declaration.kind,
      statementId: lookup.declaration.statementId
    };
  }
  if (lookup.kind === "invalidTraversal") {
    return {
      kind: "blocked",
      reason: "invalidTraversal",
      declarationKind: lookup.declaration.kind,
      statementId: lookup.declaration.statementId
    };
  }
  const declarations = lookup.declarations;
  if (
    path.segments.length === 1 &&
    declarations.every((declaration) =>
      declaration.kind === "typedDeclaration" &&
      typedStatementIndexes.has(declaration.statementIndex) &&
      declaration.statement.kind === "typedDeclaration" &&
      isDslScalarValueType(declaration.statement.valueType)
    )
  ) return null;
  return { kind: "blocked", reason: lookup.kind };
};

const compileDiagnostic = (
  spans: DiagnosticSpanContext,
  statement: DslStatement,
  span: DslSpan,
  code: string,
  message: string,
  extra?: {
    expectedType?: ScalarType;
    actualType?: ScalarType;
    bindingId?: BindingId;
    presentation?: DslDiagnostic["presentation"];
  }
): DslDiagnostic => {
  const physicalSpan = exactPhysicalSpan(spans, statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
    presentation: extra?.presentation ?? { key: `diagnostic.${code}` },
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {}),
    ...(extra?.expectedType ? { expectedType: extra.expectedType } : {}),
    ...(extra?.actualType ? { actualType: extra.actualType } : {}),
    ...(extra?.bindingId ? { bindingId: extra.bindingId, navigationTarget: { kind: "binding" as const, bindingId: extra.bindingId } } : {})
  };
};

const parseInitializerSource = (
  spans: DiagnosticSpanContext,
  statement: DslStatement,
  bindingId: BindingId,
  raw: string,
  span: DslSpan
):
  | { ok: true; value: ParsedInitializer }
  | { ok: false; diagnostics: readonly DslDiagnostic[] } => {
  const parsed = parseScalarExpression(" ".repeat(span.start) + raw, span);
  if (!parsed.ast) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics.map((diagnostic) =>
        compileDiagnostic(spans, statement, diagnostic.span, diagnostic.code, diagnostic.message, { bindingId })
      )
    };
  }
  return { ok: true, value: { ast: parsed.ast, references: collectReferences(parsed.ast) } };
};

const parseInitializer = (
  spans: DiagnosticSpanContext,
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>,
  bindingId: BindingId
):
  | { ok: true; value: ParsedInitializer }
  | { ok: false; diagnostics: readonly DslDiagnostic[] } => {
  const span = statement.payloadSpans.initializer;
  if (!span) {
    return {
      ok: false,
      diagnostics: [compileDiagnostic(spans, statement, statement.keywordSpan, "scalar-program-missing-initializer", "初期化式の範囲を取得できません。", { bindingId })]
    };
  }
  return parseInitializerSource(spans, statement, bindingId, statement.initializer, span);
};

const positionMapFor = (
  statements: readonly DslStatement[],
  includeStatement: (statement: DslStatement, statementIndex: number) => boolean
): ScalarProgramPositionMap => {
  const sourceOrderByElementIndex: number[] = [];
  let evaluationLimit: ScalarProgramPositionMap["evaluationLimit"];
  for (let sourceOrder = 0; sourceOrder < statements.length; sourceOrder += 1) {
    if (!includeStatement(statements[sourceOrder], sourceOrder)) continue;
    if (statements[sourceOrder].kind === "atStop" && !evaluationLimit) {
      evaluationLimit = { elementIndex: sourceOrderByElementIndex.length, sourceOrder };
    }
    if (isElementDslStatement(statements[sourceOrder])) sourceOrderByElementIndex.push(sourceOrder);
  }
  return evaluationLimit ? { sourceOrderByElementIndex, evaluationLimit } : { sourceOrderByElementIndex };
};

export const analyzeTypedDeclarations = ({
  statements,
  stableStatementIdByIndex,
  reconciledContainers,
  spans,
  includeStatement: includeStatementOption,
  sourceNamespace,
  additionalBindings,
  additionalBindingResolver,
  additionalGeometryResolver,
  additionalCollectionIndexResolver,
  additionalGeometryPropertyResolver,
  additionalInitializers,
  nonProgramBindingIds,
  prepareScalarExpression,
  additionalRecordPropertyResolver,
  additionalRecordValueResolver
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  reconciledContainers: ReconciledCadContainerInput;
  spans: DiagnosticSpanContext;
  includeStatement?: (statement: DslStatement, statementIndex: number) => boolean;
  sourceNamespace?: SourceLexicalNamespaceIndex;
  additionalBindings?: readonly BindingSeed[];
  additionalBindingResolver?: SourceNamespaceBindingResolver;
  additionalGeometryResolver?: (input: {
    readonly statementIndex: number;
    readonly node: Extract<import("./expressionAst").ScalarExpressionAst, { kind: "reference" | "geometryProperty" }>;
    readonly occurrenceIndex: number | null;
    readonly expectedGeometryType: Extract<import("../dsl/moduleGeometryInterfaces").ModuleGeometryInterfaceType, "point" | "line">;
  }) => import("./typedExpressionAst").ScalarExpressionResolvedGeometryTarget | undefined;
  additionalCollectionIndexResolver?: CollectionIndexResolver;
  additionalInitializers?: readonly AdditionalScalarInitializer[];
  /** Synthetic bindings used to typecheck an embedded expression but never
   * emitted as standalone scalar-program declarations. */
  nonProgramBindingIds?: ReadonlySet<BindingId>;
  prepareScalarExpression?: PrepareScalarExpression;
  additionalRecordPropertyResolver?: (input: {
    statementIndex: number;
    node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>;
  }) => import("./recordScalarLowering").AdditionalRecordScalarPropertyResolution | null;
  additionalGeometryPropertyResolver?: (input: {
    statementIndex: number;
    node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>;
  }) => import("./typedExpressionAst").ScalarExpressionResolvedGeometryProperty | null;
  additionalRecordValueResolver?: (value: RecordValueSemantic) => ExternalRecordScalarAlias | null;
}): TypedDeclarationAnalysisCompilation => {
  const includeStatement = includeStatementOption ?? ((_statement, statementIndex) =>
    isCompilableDslStatement(statements, statementIndex)
  );
  const includeBindingMetadataStatement = (statement: DslStatement, statementIndex: number): boolean =>
    includeStatement(statement, statementIndex) || isCanonicalValueBindingDeclaration(statements, statementIndex);
  const recordAnalysis = sourceNamespace?.recordSemanticAnalysis ?? null;
  const recordPlan = recordAnalysis && sourceNamespace
    ? planRecordScalarLowering({
        analysis: recordAnalysis,
        sourceNamespace,
        includeValue: (value) => {
          const statement = statements[value.statementIndex];
          return Boolean(statement && includeStatement(statement, value.statementIndex));
        },
        additionalRecordValueResolver
      })
    : null;
  const recordBindingResolver = recordAnalysis && sourceNamespace && recordPlan
    ? recordScalarSourceBindingResolverFor({ analysis: recordAnalysis, sourceNamespace, plan: recordPlan })
    : undefined;
  const combinedAdditionalBindingResolver: SourceNamespaceBindingResolver | undefined =
    additionalBindingResolver || recordBindingResolver
      ? (name, statementIndex, scopeId) =>
          additionalBindingResolver?.(name, statementIndex, scopeId)
          ?? recordBindingResolver?.(name, statementIndex, scopeId)
          ?? null
      : undefined;
  const effectiveAdditionalBindings: BindingSeed[] = [];
  const effectiveAdditionalBindingIds = new Set<BindingId>();
  for (const binding of [...(recordPlan?.bindingSeeds ?? []), ...(additionalBindings ?? [])]) {
    // A Module export may intentionally reuse a root record field's scalar
    // backing identity. Keep one catalog binding for that identity while the
    // caller's resolver may still expose the export-qualified name.
    if (effectiveAdditionalBindingIds.has(binding.id)) continue;
    effectiveAdditionalBindingIds.add(binding.id);
    effectiveAdditionalBindings.push(binding);
  }
  const effectiveAdditionalInitializers: AdditionalScalarInitializer[] = [
    ...(recordPlan?.initializers.map((initializer) => ({
      bindingId: initializer.bindingId,
      raw: initializer.raw,
      span: initializer.span,
      ...(initializer.ast ? { ast: initializer.ast } : {}),
      ...(initializer.recordControlFlowProjection
        ? { recordControlFlowProjection: initializer.recordControlFlowProjection }
        : {})
    })) ?? []),
    ...(additionalInitializers ?? [])
  ];
  const recordPrepare: PrepareScalarExpression | undefined = recordAnalysis && sourceNamespace && recordPlan
    ? ({ statementIndex, ast, referenceResolutions, geometryPropertySpanStarts }) =>
        prepareRecordScalarExpression({
          ast,
          statementIndex,
          analysis: recordAnalysis,
          sourceNamespace,
          plan: recordPlan,
          referenceResolutions,
          skipPropertySpanStarts: geometryPropertySpanStarts,
          additionalPropertyResolver: (node) => additionalRecordPropertyResolver?.({ statementIndex, node }) ?? null
        })
    : undefined;
  // A caller-supplied closed frontend remains authoritative for its own
  // custom preparation. Ordinary document analysis uses the record adapter.
  const effectivePrepareScalarExpression = prepareScalarExpression ?? recordPrepare;

  const typedStatements = statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter((entry): entry is { statement: Extract<DslStatement, { kind: "typedDeclaration" }>; statementIndex: number } =>
      entry.statement.kind === "typedDeclaration" && includeBindingMetadataStatement(entry.statement, entry.statementIndex)
    );
  const hasSourceOutputStatements = statements.some((statement, statementIndex) =>
    (statement.kind === "layout" || statement.kind === "print" || statement.kind === "svg") && includeStatement(statement, statementIndex)
  );
  const elementsById = new Map(reconciledContainers.elements.map((element) => [element.id, element]));
  const hasScalarExpressionConsumers = statements.some((statement, statementIndex) => {
    if (!includeStatement(statement, statementIndex)) return false;
    if (statement.kind !== "element" && statement.kind !== "group") return false;
    const elementId = reconciledContainers.elementIdByStatementIndex.get(statementIndex);
    const element = elementId ? elementsById.get(elementId) : undefined;
    if (!element) return false;
    if (element.type === "conditionalGroup" || element.type === "forGroup") return true;
    return statement.attrs.some((attr) => {
      const hasTypedNumericOperator = /[\^%]/.test(attr.value);
      if (!isScalarExpressionCandidateSource(attr.value) && !hasTypedNumericOperator) return false;
      const parameterKey = parameterKeyForArg(element.type, attr.key);
      const definition = findParameterDefinition(element, parameterKey);
      const expectedType = scalarTypeForParameterDefinition(definition);
      if (!expectedType) return false;
      if (expectedType.kind !== "number") return true;
      if (hasTypedNumericOperator) return true;
      return scanExpressionReferences(attr.value).some((match) => match.kind === "elementProperty" && match.sigil);
    });
  });
  if (
    typedStatements.length === 0 &&
    !hasSourceOutputStatements &&
    !hasScalarExpressionConsumers &&
    effectiveAdditionalInitializers.length === 0
  ) return { diagnostics: [] };

  const missingIdentity = typedStatements.flatMap(({ statement, statementIndex }) =>
    stableStatementIdByIndex.has(statementIndex)
      ? []
      : [compileDiagnostic(spans, statement, statement.nameSpan ?? statement.keywordSpan, "missing-stable-statement-identity", "型付き宣言のstable statement identityを取得できません。")]
  );
  if (missingIdentity.length > 0) return { diagnostics: missingIdentity };

  const scopeIndex = buildLexicalScopeIndexFromStatements(statements, stableStatementIdByIndex, includeBindingMetadataStatement);
  const adapter = buildDslBindingAdapterSeeds({ statements, scopeIndex, stableStatementIdByIndex, reconciledContainers });
  const scalarTypedStatementIndexes = new Set(
    typedStatements
      .filter(({ statement }) => isDslScalarValueType(statement.valueType))
      .map(({ statementIndex }) => statementIndex)
  );
  const catalog = buildBindingCatalog({
    scopeIndex,
    stableStatementIdByIndex,
    iterationBindings: adapter.iterationBindings,
    containerIndex: adapter.containerIndex,
    ...(effectiveAdditionalBindings.length ? { additionalBindings: effectiveAdditionalBindings } : {}),
    ...(sourceNamespace
      ? { sourceNamespaceBindingResolver: sourceNamespaceBindingResolverFor(sourceNamespace, scalarTypedStatementIndexes, combinedAdditionalBindingResolver) }
      : {})
  });
  const additionalInitializerByBindingId = new Map(
    effectiveAdditionalInitializers.map((initializer) => [initializer.bindingId, initializer] as const)
  );
  const analyzesInitializer = (bindingId: BindingId, resolutionMode: string | undefined) =>
    resolutionMode !== "preResolvedOnly" || additionalInitializerByBindingId.has(bindingId);
  const isScalarTypedBinding = (binding: Binding): boolean =>
    binding.kind === "typed" && scalarTypeOfDslValueType(binding.declaredType) !== null;

  const parsedByBindingId = new Map<BindingId, ParsedInitializer>();
  const diagnostics: DslDiagnostic[] = [];
  for (const binding of catalog.bindings) {
    if (!isScalarTypedBinding(binding) || !analyzesInitializer(binding.id, binding.resolutionMode)) continue;
    const statement = statements[binding.statementIndex];
    if (!statement) throw new Error(`typedDeclarationAnalysis: typed binding ${binding.id} has no owner statement`);
    const additional = additionalInitializerByBindingId.get(binding.id);
    const parsed = additional?.ast
      ? { ok: true as const, value: { ast: additional.ast, references: collectReferences(additional.ast) } }
      : additional
      ? parseInitializerSource(spans, statement, binding.id, additional.raw, additional.span)
      : statement.kind === "typedDeclaration"
        ? parseInitializer(spans, statement, binding.id)
        : { ok: false as const, diagnostics: [compileDiagnostic(spans, statement, statement.keywordSpan, "scalar-program-missing-initializer", "型付きbindingの初期化式を取得できません。", { bindingId: binding.id })] };
    if (!parsed.ok) diagnostics.push(...parsed.diagnostics);
    else parsedByBindingId.set(binding.id, parsed.value);
  }
  if (diagnostics.length > 0) return { diagnostics };

  const collectionIndexResolutionByBindingId = new Map<BindingId, ReadonlyMap<number, ScalarExpressionResolvedCollectionIndex>>();
  const ordinaryReferencesByBindingId = new Map<BindingId, readonly { name: string; span: { start: number; end: number } }[]>();
  const collectionIndexBaseReferenceOccurrenceIndexesByBindingId = new Map<BindingId, ReadonlySet<number>>();
  for (const binding of catalog.bindings) {
    const parsed = parsedByBindingId.get(binding.id);
    if (!parsed || !isScalarTypedBinding(binding) || !analyzesInitializer(binding.id, binding.resolutionMode)) continue;
    collectionIndexResolutionByBindingId.set(
      binding.id,
      collectionIndexResolutionsFor(parsed.ast, binding.statementIndex, additionalCollectionIndexResolver)
    );
  }
  const requests: InitializerResolutionRequest[] = [];
  for (const binding of catalog.bindings) {
    if (!isScalarTypedBinding(binding) || !analyzesInitializer(binding.id, binding.resolutionMode)) continue;
    const parsed = parsedByBindingId.get(binding.id);
    if (!parsed) throw new Error(`typedDeclarationAnalysis: missing parsed initializer for ${binding.id}`);
    const collectionIndexBaseStarts = collectionIndexBaseStartsFor(parsed.ast);
    const scopeId = scopeIndex.scopeOfStatement.get(binding.statementIndex) ?? scopeIndex.rootScopeId;
    const ordinaryReferences = parsed.references.filter((reference) => !collectionIndexResolutionByBindingId.get(binding.id)?.has(reference.span.start));
    ordinaryReferencesByBindingId.set(binding.id, ordinaryReferences);
    const collectionIndexBaseReferenceOccurrenceIndexes = new Set<number>();
    ordinaryReferences.forEach((reference, occurrenceIndex) => {
      if (collectionIndexBaseStarts.has(reference.span.start)) collectionIndexBaseReferenceOccurrenceIndexes.add(occurrenceIndex);
    });
    collectionIndexBaseReferenceOccurrenceIndexesByBindingId.set(binding.id, collectionIndexBaseReferenceOccurrenceIndexes);
    ordinaryReferences.forEach((reference, occurrenceIndex) => requests.push({
      fromBindingId: binding.id,
      occurrenceIndex,
      name: reference.name,
      site: { scopeId, statementIndex: binding.statementIndex }
    }));
  }
  const resolved = resolveInitializerReferences(catalog, requests);
  const resolvedByBindingId = new Map<BindingId, BindingResolution[]>();
  for (const reference of resolved) {
    const bucket = resolvedByBindingId.get(reference.fromBindingId);
    if (bucket) bucket.push(reference.resolution);
    else resolvedByBindingId.set(reference.fromBindingId, [reference.resolution]);
  }
  const sourceDeclarationsByStatementId: ReadonlyMap<string, SourceLexicalDeclaration> = sourceNamespace
    ? new Map(sourceNamespace.allDeclarations.map((declaration) => [declaration.statementId, declaration]))
    : new Map();
  const geometryResolutionByBindingId = new Map<BindingId, ResolveBuiltinGeometryArgumentsResult>();
  const preparedByBindingId = new Map<BindingId, ReturnType<NonNullable<PrepareScalarExpression>>>();
  for (const binding of catalog.bindings) {
    if (!isScalarTypedBinding(binding) || !analyzesInitializer(binding.id, binding.resolutionMode)) continue;
    const parsed = parsedByBindingId.get(binding.id);
    if (!parsed) throw new Error(`typedDeclarationAnalysis: missing parsed initializer for ${binding.id}`);
    const geometryResolution = resolveBuiltinGeometryArguments({
      ast: parsed.ast,
      statementIndex: binding.statementIndex,
      scalarReferenceResolutions: resolvedByBindingId.get(binding.id) ?? [],
      collectionIndexBaseReferenceOccurrenceIndexes: collectionIndexBaseReferenceOccurrenceIndexesByBindingId.get(binding.id),
      sourceDeclarationsByStatementId,
      additionalGeometryResolver: additionalGeometryResolver
        ? ({ node, occurrenceIndex, expectedGeometryType }) => additionalGeometryResolver({
            statementIndex: binding.statementIndex,
            node,
            occurrenceIndex,
            expectedGeometryType
          })
        : undefined,
      resolveSourceGeometryPath: sourceNamespace
        ? (elementName) => resolveSourceLexicalPath(sourceNamespace, binding.statementIndex, parseDslReferenceToken(elementName))
        : undefined
    });
    geometryResolutionByBindingId.set(binding.id, geometryResolution);
    const statement = statements[binding.statementIndex];
    if (!statement) continue;
    for (const issue of geometryResolution.issues) {
      if (shouldEmitRecordProjectionDiagnostic(binding.id, issue, additionalInitializerByBindingId)) {
        diagnostics.push(compileDiagnostic(spans, statement, issue.span, issue.code, issue.message, {
          bindingId: binding.id,
          presentation: issue.presentation
        }));
      }
    }
    if (effectivePrepareScalarExpression) {
      const prepared = effectivePrepareScalarExpression({
        bindingId: binding.id,
        statementIndex: binding.statementIndex,
        ast: parsed.ast,
        referenceResolutions: referenceResolutionsForAst(
          parsed.ast,
          collectionIndexResolutionByBindingId.get(binding.id) ?? new Map(),
          geometryResolution.references
        ),
        geometryPropertySpanStarts: new Set(geometryResolution.geometryPropertyTargets.keys())
      });
      preparedByBindingId.set(binding.id, prepared);
      for (const issue of prepared.issues ?? []) {
        if (shouldEmitRecordProjectionDiagnostic(binding.id, issue, additionalInitializerByBindingId)) {
          diagnostics.push(compileDiagnostic(spans, statement, issue.span, issue.code, issue.message, {
            bindingId: binding.id,
            presentation: issue.presentation
          }));
        }
      }
    }
  }

  for (const reference of resolved) {
    if (reference.resolution.kind !== "namespace") continue;
    if (geometryResolutionByBindingId.get(reference.fromBindingId)?.claimedReferenceOccurrenceIndexes.has(reference.occurrenceIndex)) continue;
    if (reference.resolution.reason === "ambiguous") continue;
    const statement = statements[reference.site.statementIndex];
    const span = ordinaryReferencesByBindingId.get(reference.fromBindingId)?.[reference.occurrenceIndex]?.span;
    if (!statement || !span) continue;
    const privateMember = reference.resolution.reason === "private"
      ? parseDslReferenceToken(reference.name).segments.at(-1) ?? reference.name
      : null;
    const message = reference.resolution.reason === "forward"
      ? `"${reference.name}" はこの位置より後で宣言されているため、まだ参照できません。`
      : privateMember
        ? `module member「${privateMember}」はexportされていないため参照できません。`
        : `"${reference.name}" は${reference.resolution.declarationKind ?? "scalar以外の宣言"}のため、scalar expressionでは参照できません。`;
    diagnostics.push(compileDiagnostic(
      spans,
      statement,
      span,
      reference.resolution.reason === "private"
        ? "module-private-member"
        : reference.resolution.reason === "forward" ? "forward-binding-reference" : "scalar-namespace-type-mismatch",
      message,
      { bindingId: reference.fromBindingId }
    ));
  }

  const resolvedReferencesByBindingId = new Map<BindingId, Array<(typeof resolved)[number]>>();
  for (const reference of resolved) {
    const bucket = resolvedReferencesByBindingId.get(reference.fromBindingId);
    if (bucket) bucket.push(reference);
    else resolvedReferencesByBindingId.set(reference.fromBindingId, [reference]);
  }
  const initializerReferences: InitializerReference[] = [];
  for (const binding of catalog.bindings) {
    if (!isScalarTypedBinding(binding) || !analyzesInitializer(binding.id, binding.resolutionMode)) continue;
    if (nonProgramBindingIds?.has(binding.id)) continue;
    const parsed = parsedByBindingId.get(binding.id);
    if (!parsed) continue;
    const normal = (resolvedReferencesByBindingId.get(binding.id) ?? []).map((reference) => ({
      name: reference.name,
      span: ordinaryReferencesByBindingId.get(binding.id)?.[reference.occurrenceIndex]?.span ?? null,
      resolution: geometryResolutionByBindingId.get(binding.id)?.claimedReferenceOccurrenceIndexes.has(reference.occurrenceIndex)
        ? {
            kind: "namespace" as const,
            name: reference.name,
            scopeId: reference.site.scopeId,
            statementIndex: reference.site.statementIndex,
            reason: "incompatible" as const,
            declarationKind: "builtinGeometryArgument"
          }
        : reference.resolution
    }));
    const extra = (preparedByBindingId.get(binding.id)?.dependencies ?? []).map((dependency) => {
      const target = catalog.bindingsById.get(dependency.bindingId);
      if (!target) throw new Error(`typedDeclarationAnalysis: prepared dependency ${dependency.bindingId} is not in the catalog`);
      return {
        name: dependency.name,
        span: dependency.span,
        resolution: { kind: "resolved" as const, binding: target }
      };
    });
    let normalIndex = 0;
    let extraIndex = 0;
    let occurrenceIndex = 0;
    while (normalIndex < normal.length || extraIndex < extra.length) {
      const normalEntry = normal[normalIndex];
      const extraEntry = extra[extraIndex];
      const normalStart = normalEntry?.span?.start ?? Number.MAX_SAFE_INTEGER;
      const extraStart = extraEntry?.span.start ?? Number.MAX_SAFE_INTEGER;
      const entry = normalStart <= extraStart ? normalEntry! : extraEntry!;
      if (normalStart <= extraStart) normalIndex += 1;
      else extraIndex += 1;
      initializerReferences.push({
        fromBindingId: binding.id,
        occurrenceIndex,
        name: entry.name,
        span: entry.span,
        resolution: entry.resolution
      });
      occurrenceIndex += 1;
    }
  }
  const bindingAnalysis = analyzeBindings({
    catalog,
    initializerReferences,
    unavailableBindingIds: nonProgramBindingIds
  });

  const typedInitializerByBindingId = new Map<BindingId, TypedScalarExpression>();
  const sourceOrderByElementId = new Map<string, number>();
  for (const [statementIndex, elementId] of reconciledContainers.elementIdByStatementIndex) sourceOrderByElementId.set(elementId, statementIndex);
  const nameContext = createElementNameContext([...reconciledContainers.elements]);
  for (const binding of catalog.bindings) {
    if (!isScalarTypedBinding(binding) || !analyzesInitializer(binding.id, binding.resolutionMode)) continue;
    const additional = additionalInitializerByBindingId.get(binding.id);
    const parsed = parsedByBindingId.get(binding.id);
    if (!parsed) throw new Error(`typedDeclarationAnalysis: no parsed initializer for ${binding.id}`);
    const prepared = preparedByBindingId.get(binding.id);
    const ownerContainerId = adapter.containerIndex.ownerContainerIdByStatementIndex.get(binding.statementIndex);
    const geometryPropertyResolution = resolveGeometryPropertyMetadata(
      prepared?.ast ?? parsed.ast,
      reconciledContainers.elements,
      sourceOrderByElementId,
      {
        currentElement: { parentGroupId: ownerContainerId ?? undefined },
        nameContext,
        additionalGeometryPropertyResolver: additionalGeometryPropertyResolver
          ? ({ node }) => additionalGeometryPropertyResolver({ statementIndex: binding.statementIndex, node })
          : undefined,
        skipPropertySpanStarts: geometryResolutionByBindingId.get(binding.id)?.geometryPropertyTargets
          ? new Set(geometryResolutionByBindingId.get(binding.id)!.geometryPropertyTargets.keys())
          : undefined
      }
    );
    const checked = typecheckScalarExpression(prepared?.ast ?? parsed.ast, {
      expectedType: additional?.expectedType ?? scalarTypeOfDslValueType(binding.declaredType),
      references: prepared?.references ?? referenceResolutionsForAst(
        parsed.ast,
        collectionIndexResolutionByBindingId.get(binding.id) ?? new Map(),
        geometryResolutionByBindingId.get(binding.id)?.references ?? resolvedByBindingId.get(binding.id) ?? []
      ),
      geometryBuiltinArguments: geometryResolutionByBindingId.get(binding.id)?.geometryPropertyTargets,
      geometryPropertyReferences: geometryPropertyResolution.geometryPropertyReferences
    });
    const statement = statements[binding.statementIndex];
    if (!statement) throw new Error(`typedDeclarationAnalysis: no owner statement for ${binding.id}`);
    typedInitializerByBindingId.set(binding.id, checked.typed);
    diagnostics.push(...checked.diagnostics.flatMap((diagnostic) =>
      shouldEmitRecordProjectionDiagnostic(binding.id, diagnostic, additionalInitializerByBindingId)
        ? [compileDiagnostic(spans, statement, diagnostic.span, diagnostic.code, diagnostic.message, {
            expectedType: diagnostic.expectedType,
            actualType: diagnostic.actualType,
            bindingId: binding.id,
            presentation: diagnostic.presentation
          })]
        : []
    ));
    diagnostics.push(...geometryPropertyResolution.issues.flatMap((issue) =>
      shouldEmitRecordProjectionDiagnostic(binding.id, { code: "geometry-property-invalid", span: issue.span }, additionalInitializerByBindingId)
        ? [compileDiagnostic(spans, statement, issue.span, "geometry-property-invalid", issue.message, {
            bindingId: binding.id,
            presentation: issue.presentation
          })]
        : []
    ));
  }
  return {
    analysis: { bindingAnalysis, typedInitializerByBindingId, positionMap: positionMapFor(statements, includeStatement) },
    diagnostics
  };
};
