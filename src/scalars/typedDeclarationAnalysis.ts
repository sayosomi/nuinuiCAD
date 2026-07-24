// One-pass integration of Tasks 11–15 for typed declarations. Task 19
// lowering consumes this result directly and never repeats this work.
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { buildLexicalScopeIndexFromStatements } from "../dsl/lexicalScopeIndexAdapter";
import type { DslDiagnostic, DslStatement } from "../dsl/dslTypes";
import { isElementDslStatement } from "../dsl/dslParser";
import { analyzeBindings, type BindingAnalysis, type InitializerReference } from "./bindingAnalysis";
import { buildBindingCatalog, type BindingId } from "./bindingCatalog";
import { resolveInitializerReferences, type BindingResolution, type InitializerResolutionRequest } from "./bindingResolution";
import type { ScalarExpressionAst } from "./expressionAst";
import { parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import type { ReconciledCadContainerInput } from "./legacyContainerIndex";
import type { ScalarProgramPositionMap } from "./scalarProgram";
import type { TypedScalarExpression } from "./typedExpressionAst";

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
  const references: { name: string; span: { start: number; end: number } }[] = [];
  const visit = (node: ScalarExpressionAst): void => {
    switch (node.kind) {
      case "reference":
        references.push({ name: node.name, span: node.span });
        return;
      case "unary":
        visit(node.operand);
        return;
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "group":
        visit(node.expression);
        return;
      default:
        return;
    }
  };
  visit(ast);
  return references;
};

/**
 * Any occurrence of these forms anywhere in an AST - through `group`
 * wrapping - is syntax the legacy numeric expression grammar
 * (src/geometry/numericExpressionParser.ts) cannot represent at all,
 * regardless of what any `@name` reference inside it resolves to. Shared by
 * Task 25's conditionalGroupConditionCompiler.ts and Task 26's
 * textTemplate.ts, which both need to decide whether a piece of syntax could
 * ever have been a working legacy expression before falling back to it.
 */
export const containsLegacyIncompatibleSyntax = (ast: ScalarExpressionAst): boolean => {
  switch (ast.kind) {
    case "booleanLiteral":
    case "stringLiteral":
    case "unresolvedChoiceLiteral":
      return true;
    case "unary":
      return ast.operator === "!" || containsLegacyIncompatibleSyntax(ast.operand);
    case "binary":
      return containsLegacyIncompatibleSyntax(ast.left) || containsLegacyIncompatibleSyntax(ast.right);
    case "group":
      return containsLegacyIncompatibleSyntax(ast.expression);
    default:
      return false;
  }
};

/** A resolution is a "definite" legacy reference only when it actually
 * resolved to a binding whose declaredType is null (the legacy-var shape) -
 * anything else (unresolved, or a typed binding) is not legacy-eligible. */
export const isDefiniteLegacyReference = (resolution: BindingResolution | undefined): boolean =>
  resolution?.kind === "resolved" && resolution.binding.declaredType === null;

/** Shared "why this reference isn't usable" message for a non-resolved
 * BindingResolution - same wording Task 25's conditionalGroupConditionCompiler.ts
 * and Task 26's textTemplate.ts both surface for an unresolved/forward/duplicate
 * reference inside typed-only syntax. */
export const unresolvedReferenceMessage = (name: string, resolution: BindingResolution | undefined): string => {
  if (resolution?.kind === "forward") return `"${name}" はこの位置より後で宣言されているため、まだ参照できません。`;
  if (resolution?.kind === "duplicate") return `"${name}" は複数の宣言と一致するため一意に解決できません。`;
  return `未定義の変数 "${name}" を参照しています。`;
};

const compileDiagnostic = (statement: DslStatement, span: { start: number; end: number }, code: string, message: string): DslDiagnostic => ({
  severity: "error",
  line: statement.line,
  column: span.start + 1,
  code,
  message,
  physicalSpan: statement.physicalSpan
});

const parseInitializer = (statement: Extract<DslStatement, { kind: "typedDeclaration" }>):
  | { ok: true; value: ParsedInitializer }
  | { ok: false; diagnostics: readonly DslDiagnostic[] } => {
  const span = statement.payloadSpans.initializer;
  if (!span) {
    return { ok: false, diagnostics: [compileDiagnostic(statement, statement.keywordSpan, "scalar-program-missing-initializer", "初期化式の範囲を取得できません。")] };
  }
  // Positional padding keeps Task 14's existing statement-relative spans;
  // this parses only the initializer, never the document again.
  const parsed = parseScalarExpression(" ".repeat(span.start) + statement.initializer, span);
  if (!parsed.ast) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics.map((diagnostic) =>
        compileDiagnostic(statement, diagnostic.span, diagnostic.code, diagnostic.message)
      )
    };
  }
  return { ok: true, value: { ast: parsed.ast, references: collectReferences(parsed.ast) } };
};

const positionMapFor = (statements: readonly DslStatement[]): ScalarProgramPositionMap => {
  const sourceOrderByElementIndex: number[] = [];
  let evaluationLimit: ScalarProgramPositionMap["evaluationLimit"];
  for (let sourceOrder = 0; sourceOrder < statements.length; sourceOrder += 1) {
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
  reconciledContainers
}: {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  reconciledContainers: ReconciledCadContainerInput;
}): TypedDeclarationAnalysisCompilation => {
  const typedStatements = statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter((entry): entry is { statement: Extract<DslStatement, { kind: "typedDeclaration" }>; statementIndex: number } => entry.statement.kind === "typedDeclaration");
  if (typedStatements.length === 0) return { diagnostics: [] };

  const missingIdentity = typedStatements.flatMap(({ statement, statementIndex }) =>
    stableStatementIdByIndex.has(statementIndex)
      ? []
      : [compileDiagnostic(statement, statement.nameSpan ?? statement.keywordSpan, "missing-stable-statement-identity", "型付き宣言のstable statement identityを取得できません。")]
  );
  if (missingIdentity.length > 0) return { diagnostics: missingIdentity };

  const scopeIndex = buildLexicalScopeIndexFromStatements(statements, stableStatementIdByIndex);
  const adapter = buildDslBindingAdapterSeeds({ statements, scopeIndex, stableStatementIdByIndex, reconciledContainers });
  const catalog = buildBindingCatalog({
    scopeIndex,
    stableStatementIdByIndex,
    legacyBindings: adapter.legacyBindings,
    iterationBindings: adapter.iterationBindings,
    containerIndex: adapter.containerIndex
  });
  const parsedByBindingId = new Map<BindingId, ParsedInitializer>();
  const diagnostics: DslDiagnostic[] = [];
  for (const binding of catalog.bindings) {
    if (binding.kind !== "typed") continue;
    const statement = statements[binding.statementIndex];
    if (!statement || statement.kind !== "typedDeclaration") throw new Error(`typedDeclarationAnalysis: typed binding ${binding.id} has no declaration statement`);
    const parsed = parseInitializer(statement);
    if (!parsed.ok) diagnostics.push(...parsed.diagnostics);
    else parsedByBindingId.set(binding.id, parsed.value);
  }
  if (diagnostics.length > 0) return { diagnostics };

  const requests: InitializerResolutionRequest[] = [];
  for (const binding of catalog.bindings) {
    if (binding.kind !== "typed") continue;
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
  const initializerReferences: InitializerReference[] = resolved.map((reference) => ({
    fromBindingId: reference.fromBindingId,
    occurrenceIndex: reference.occurrenceIndex,
    name: reference.name,
    span: parsedByBindingId.get(reference.fromBindingId)?.references[reference.occurrenceIndex]?.span ?? null,
    resolution: reference.resolution
  }));
  const bindingAnalysis = analyzeBindings({ catalog, initializerReferences });

  const typedInitializerByBindingId = new Map<BindingId, TypedScalarExpression>();
  for (const binding of catalog.bindings) {
    if (binding.kind !== "typed") continue;
    const parsed = parsedByBindingId.get(binding.id);
    if (!parsed) throw new Error(`typedDeclarationAnalysis: no parsed initializer for ${binding.id}`);
    const checked = typecheckScalarExpression(parsed.ast, {
      expectedType: binding.declaredType,
      references: resolved.filter((reference) => reference.fromBindingId === binding.id).map((reference) => reference.resolution)
    });
    typedInitializerByBindingId.set(binding.id, checked.typed);
    const statement = statements[binding.statementIndex] as Extract<DslStatement, { kind: "typedDeclaration" }>;
    diagnostics.push(...checked.diagnostics.map((diagnostic) =>
      compileDiagnostic(statement, diagnostic.span, diagnostic.code, diagnostic.message)
    ));
  }
  if (diagnostics.length > 0) return { diagnostics };
  return {
    analysis: { bindingAnalysis, typedInitializerByBindingId, positionMap: positionMapFor(statements) },
    diagnostics: []
  };
};
