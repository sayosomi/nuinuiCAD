// One-pass integration of Tasks 11–15 for typed declarations. Task 19
// lowering consumes this result directly and never repeats this work.
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { buildLexicalScopeIndexFromStatements } from "../dsl/lexicalScopeIndexAdapter";
import { isCompilableDslStatement } from "../dsl/dslCompilationGuard";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import { isElementDslStatement } from "../dsl/dslParser";
import { analyzeBindings, type BindingAnalysis, type InitializerReference } from "./bindingAnalysis";
import { bindingIdForStableStatementId, buildBindingCatalog, type BindingId, type BindingSeed, type SourceNamespaceBindingResolver } from "./bindingCatalog";
import { resolveInitializerReferences, type BindingResolution, type InitializerResolutionRequest } from "./bindingResolution";
import type { ScalarExpressionAst } from "./expressionAst";
import { collectScalarExpressionReferences } from "./expressionReferenceCollector";
import { parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import type { ReconciledCadContainerInput } from "./containerIndex";
import type { ScalarProgramPositionMap } from "./scalarProgram";
import type { ScalarType } from "./types";
import type { TypedScalarExpression } from "./typedExpressionAst";
import { resolveTypedGeometryProperties } from "./typedGeometryPropertyResolution";
import { createElementNameContext } from "../model/elementNames";
import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import {
  resolveSourceLexicalPath,
  type SourceLexicalNamespaceIndex
} from "../dsl/sourceLexicalNamespaceIndex";

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
 * numeric expression evaluator used by geometry, local numeric variables,
 * and text interpolation. */
export const containsNonNumericScalarSyntax = (ast: ScalarExpressionAst): boolean => {
  switch (ast.kind) {
    case "booleanLiteral":
    case "stringLiteral":
    case "unresolvedChoiceLiteral":
      return true;
    case "unary":
      return ast.operator === "!" || containsNonNumericScalarSyntax(ast.operand);
    case "binary":
      return containsNonNumericScalarSyntax(ast.left) || containsNonNumericScalarSyntax(ast.right);
    case "group":
      return containsNonNumericScalarSyntax(ast.expression);
    default:
      return false;
  }
};

/** Shared "why this reference isn't usable" message for a non-resolved
 * BindingResolution - same wording Task 25's conditionalGroupConditionCompiler.ts
 * and Task 26's textTemplate.ts both surface for an unresolved/forward/duplicate
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
    if (lookup.declaration.kind === "typedDeclaration" && typedStatementIndexes.has(lookup.declaration.statementIndex)) {
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
  // Keep the existing binding sweep as the owner for all-typed duplicate and
  // forward buckets for simple names. Qualified paths have already been
  // resolved by the canonical namespace and must retain its forward/ambiguous
  // reason even when every candidate is typed. A mixed-kind bucket must remain
  // blocked so a scalar consumer cannot skip an inner geometry/group and
  // capture an outer scalar.
  const declarations = lookup.declarations;
  if (
    path.segments.length === 1 &&
    declarations.every((declaration) => declaration.kind === "typedDeclaration" && typedStatementIndexes.has(declaration.statementIndex))
  ) return null;
  return { kind: "blocked", reason: lookup.kind };
};

/** Exact-span-or-nothing (Task 48): physicalSpan is set only when the
 * logical->physical projection actually succeeds; a lookup/revision failure
 * never falls back to the whole statement's span - it leaves physicalSpan
 * unset and relies on exactSpanOnly to keep the gutter/Quick Fix/navigation
 * from inventing a wrong position. `bindingId` doubles as the navigation
 * target since every diagnostic here is about one binding's own declaration. */
const compileDiagnostic = (
  spans: DiagnosticSpanContext,
  statement: DslStatement,
  span: DslSpan,
  code: string,
  message: string,
  extra?: { expectedType?: ScalarType; actualType?: ScalarType; bindingId?: BindingId }
): DslDiagnostic => {
  const physicalSpan = exactPhysicalSpan(spans, statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code,
    message,
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {}),
    ...(extra?.expectedType ? { expectedType: extra.expectedType } : {}),
    ...(extra?.actualType ? { actualType: extra.actualType } : {}),
    ...(extra?.bindingId ? { bindingId: extra.bindingId, navigationTarget: { kind: "binding" as const, bindingId: extra.bindingId } } : {})
  };
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
  // Positional padding keeps Task 14's existing statement-relative spans;
  // this parses only the initializer, never the document again.
  const parsed = parseScalarExpression(" ".repeat(span.start) + statement.initializer, span);
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
  additionalBindingResolver
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  reconciledContainers: ReconciledCadContainerInput;
  spans: DiagnosticSpanContext;
  includeStatement?: (statement: DslStatement, statementIndex: number) => boolean;
  sourceNamespace?: SourceLexicalNamespaceIndex;
  additionalBindings?: readonly BindingSeed[];
  additionalBindingResolver?: SourceNamespaceBindingResolver;
}): TypedDeclarationAnalysisCompilation => {
  const includeStatement = includeStatementOption ?? ((_statement, statementIndex) =>
    isCompilableDslStatement(statements, statementIndex)
  );
  const typedStatements = statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter((entry): entry is { statement: Extract<DslStatement, { kind: "typedDeclaration" }>; statementIndex: number } =>
      entry.statement.kind === "typedDeclaration" && includeStatement(entry.statement, entry.statementIndex)
    );
  // printLayout/place numeric fields resolve `@name` against this same
  // bindingAnalysis/catalog (Task 53) even when the document declares no
  // typed const/let of its own - an unresolved `@name` there (e.g.
  // `scale: @nope`) still needs a populated .analysis so
  // compileNumericBindings can run and diagnose it, not the bare
  // `{diagnostics: []}` shortcut below.
  const hasPrintLayoutStatements = statements.some((statement, statementIndex) =>
    statement.kind === "printLayout" && includeStatement(statement, statementIndex)
  );
  if (typedStatements.length === 0 && !hasPrintLayoutStatements) return { diagnostics: [] };

  const missingIdentity = typedStatements.flatMap(({ statement, statementIndex }) =>
    stableStatementIdByIndex.has(statementIndex)
      ? []
      : [compileDiagnostic(spans, statement, statement.nameSpan ?? statement.keywordSpan, "missing-stable-statement-identity", "型付き宣言のstable statement identityを取得できません。")]
  );
  if (missingIdentity.length > 0) return { diagnostics: missingIdentity };

  const scopeIndex = buildLexicalScopeIndexFromStatements(statements, stableStatementIdByIndex, includeStatement);
  const adapter = buildDslBindingAdapterSeeds({ statements, scopeIndex, stableStatementIdByIndex, reconciledContainers });
  const typedStatementIndexes = new Set(typedStatements.map(({ statementIndex }) => statementIndex));
  const catalog = buildBindingCatalog({
    scopeIndex,
    stableStatementIdByIndex,
    iterationBindings: adapter.iterationBindings,
    containerIndex: adapter.containerIndex,
    ...(additionalBindings?.length ? { additionalBindings } : {}),
    ...(sourceNamespace
      ? { sourceNamespaceBindingResolver: sourceNamespaceBindingResolverFor(sourceNamespace, typedStatementIndexes, additionalBindingResolver) }
      : {})
  });
  const parsedByBindingId = new Map<BindingId, ParsedInitializer>();
  const diagnostics: DslDiagnostic[] = [];
  for (const binding of catalog.bindings) {
    if (binding.kind !== "typed" || binding.resolutionMode === "preResolvedOnly") continue;
    const statement = statements[binding.statementIndex];
    if (!statement || statement.kind !== "typedDeclaration") throw new Error(`typedDeclarationAnalysis: typed binding ${binding.id} has no declaration statement`);
    const parsed = parseInitializer(spans, statement, binding.id);
    if (!parsed.ok) diagnostics.push(...parsed.diagnostics);
    else parsedByBindingId.set(binding.id, parsed.value);
  }
  if (diagnostics.length > 0) return { diagnostics };

  const requests: InitializerResolutionRequest[] = [];
  for (const binding of catalog.bindings) {
    if (binding.kind !== "typed" || binding.resolutionMode === "preResolvedOnly") continue;
    const parsed = parsedByBindingId.get(binding.id);
    if (!parsed) throw new Error(`typedDeclarationAnalysis: missing parsed initializer for ${binding.id}`);
    const scopeId = scopeIndex.scopeOfStatement.get(binding.statementIndex) ?? scopeIndex.rootScopeId;
    parsed.references.forEach((reference, occurrenceIndex) => requests.push({
      fromBindingId: binding.id,
      occurrenceIndex,
      name: reference.name,
      site: { scopeId, statementIndex: binding.statementIndex }
    }));
  }
  const resolved = resolveInitializerReferences(catalog, requests);
  for (const reference of resolved) {
    if (reference.resolution.kind !== "namespace") continue;
    // Cross-kind same-scope collisions already have the source namespace's
    // single declaration diagnostic. Do not add a second consumer diagnostic
    // for the ambiguous case; the important invariant is that no outer
    // scalar was selected.
    if (reference.resolution.reason === "ambiguous") continue;
    const statement = statements[reference.site.statementIndex];
    const span = parsedByBindingId.get(reference.fromBindingId)?.references[reference.occurrenceIndex]?.span;
    if (!statement || !span) continue;
    const message = reference.resolution.reason === "forward"
      ? `"${reference.name}" はこの位置より後で宣言されているため、まだ参照できません。`
      : `"${reference.name}" は${reference.resolution.declarationKind ?? "scalar以外の宣言"}のため、scalar expressionでは参照できません。`;
    diagnostics.push(compileDiagnostic(
      spans,
      statement,
      span,
      reference.resolution.reason === "forward" ? "forward-binding-reference" : "scalar-namespace-type-mismatch",
      message,
      { bindingId: reference.fromBindingId }
    ));
  }
  // Typechecking consumes resolutions in each binding's occurrence order.
  // Keep that ordering while indexing the one shared resolved stream once,
  // instead of re-scanning every resolution for every typed binding.
  const resolvedByBindingId = new Map<BindingId, BindingResolution[]>();
  for (const reference of resolved) {
    const bucket = resolvedByBindingId.get(reference.fromBindingId);
    if (bucket) bucket.push(reference.resolution);
    else resolvedByBindingId.set(reference.fromBindingId, [reference.resolution]);
  }
  const initializerReferences: InitializerReference[] = resolved.map((reference) => ({
    fromBindingId: reference.fromBindingId,
    occurrenceIndex: reference.occurrenceIndex,
    name: reference.name,
    span: parsedByBindingId.get(reference.fromBindingId)?.references[reference.occurrenceIndex]?.span ?? null,
    resolution: reference.resolution
  }));
  const bindingAnalysis = analyzeBindings({ catalog, initializerReferences });

  const typedInitializerByBindingId = new Map<BindingId, TypedScalarExpression>();
  const sourceOrderByElementId = new Map<string, number>();
  for (const [statementIndex, elementId] of reconciledContainers.elementIdByStatementIndex) sourceOrderByElementId.set(elementId, statementIndex);
  const nameContext = createElementNameContext([...reconciledContainers.elements]);
  for (const binding of catalog.bindings) {
    if (binding.kind !== "typed" || binding.resolutionMode === "preResolvedOnly") continue;
    const parsed = parsedByBindingId.get(binding.id);
    if (!parsed) throw new Error(`typedDeclarationAnalysis: no parsed initializer for ${binding.id}`);
    const checked = typecheckScalarExpression(parsed.ast, {
      expectedType: binding.declaredType,
      references: resolvedByBindingId.get(binding.id) ?? []
    });
    const statement = statements[binding.statementIndex] as Extract<DslStatement, { kind: "typedDeclaration" }>;
    const ownerContainerId = adapter.containerIndex.ownerContainerIdByStatementIndex.get(binding.statementIndex);
    // elementNames' currentElement contract uses parentGroupId as the
    // namespace being searched. Do not pass the owner CadElement itself:
    // its parentGroupId would select the owner's parent namespace instead of
    // the owner's direct children.
    const geometryResolution = resolveTypedGeometryProperties(
      checked.typed,
      reconciledContainers.elements,
      sourceOrderByElementId,
      {
        currentElement: { parentGroupId: ownerContainerId ?? undefined },
        nameContext
      }
    );
    typedInitializerByBindingId.set(binding.id, geometryResolution.expression);
    diagnostics.push(...checked.diagnostics.map((diagnostic) =>
      compileDiagnostic(spans, statement, diagnostic.span, diagnostic.code, diagnostic.message, {
        expectedType: diagnostic.expectedType,
        actualType: diagnostic.actualType,
        bindingId: binding.id
      })
    ));
    diagnostics.push(...geometryResolution.issues.map((issue) =>
      compileDiagnostic(spans, statement, issue.span, "geometry-property-invalid", issue.message, { bindingId: binding.id })
    ));
  }
  return {
    analysis: { bindingAnalysis, typedInitializerByBindingId, positionMap: positionMapFor(statements, includeStatement) },
    diagnostics
  };
};
