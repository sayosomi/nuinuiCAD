// Task 29: compiles/resolves the `set name = expression` statement - target
// resolution against visible `let` bindings, RHS typecheck against the
// target's declared type. See
// docs/typed-variables/tasks/29-set-syntax-resolution.md.
//
// Structural precedent: this module follows propertyBindingCompiler.ts's
// (Task 22) two-phase shape - collect every candidate across one forward
// pass, then a single resolveReferencesAtSites batch call for the whole
// document - not conditionalGroupConditionCompiler.ts's (Task 25) per-
// occurrence call shape. resolveReferencesAtSites's underlying runSweep does
// a full forward pass over every statement on each invocation, so calling it
// once per `set` occurrence would cost O(document size x set count); one
// call for the whole document keeps this linear.
//
// Target-validity rule (the one place this module's logic differs from both
// sibling compilers above, which reject any invalid-status binding
// outright): an invalid-status `let` - poisoned by its own initializer
// failure or a failed dependency - is still a valid, recoverable `set`
// target, but *only* when its declared scalar type is known. A `let` whose
// declaredType itself is null (type annotation unresolved/malformed) cannot
// be safely typechecked against, so it is always invalid-set-target
// regardless of its BindingAnalysis status.

import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { Binding, BindingId } from "./bindingCatalog";
import { resolveReferencesAtSites, type BindingResolution, type SiteReferenceRequest } from "./bindingResolution";
import type { ScalarExpressionAst } from "./expressionAst";
import { parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import { collectReferences, unresolvedReferenceMessage } from "./typedDeclarationAnalysis";
import type { TypedScalarExpression } from "./typedExpressionAst";

export const CONST_ASSIGNMENT_CODE = "const-assignment";
export const INVALID_SET_TARGET_CODE = "invalid-set-target";
export const MISSING_SET_STATEMENT_IDENTITY_CODE = "missing-stable-statement-identity";
// Distinct from INVALID_SET_TARGET_CODE, which is reserved (plan.md) for the
// *target* itself being unresolved/const/legacy/local/iteration. A reference
// elsewhere inside the RHS expression is a different failure mode, mirroring
// how propertyBindingCompiler.ts/conditionalGroupConditionCompiler.ts each
// use their own per-consumer codes for this rather than overloading a single
// code across two structurally different positions.
export const SET_RHS_UNRESOLVED_CODE = "set-rhs-unresolved";
export const SET_RHS_INVALID_REFERENCE_CODE = "set-rhs-invalid-reference";

export type SetStatementAnalysis = {
  /** Reconciler-issued stable identity - Task 30's stable version-ID source. Never a fabricated/derived value. */
  statementId: string;
  /** statementIndex - matches ScalarProgramStatement's sourceOrder convention. */
  sourceOrder: number;
  /** Opaque lexical scope identity captured during Task 29 resolution. */
  scopeId: string;
  targetBindingId: BindingId;
  targetName: string;
  targetSpan: DslSpan;
  expressionSpan: DslSpan;
  expression: TypedScalarExpression;
};

export type CompileSetStatementsInput = {
  statements: readonly DslStatement[];
  /**
   * Required, non-optional - mirrors analyzeTypedDeclarations's own
   * stableStatementIdByIndex parameter exactly. The caller (dslDocument.ts)
   * must only invoke this function when a real, reconciler-populated map is
   * available; it must never pass a fallback empty Map to paper over a
   * document that has not been through reconciliation.
   */
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  /**
   * Undefined when the document has zero typed declarations at all (Task
   * 13's analyzeTypedDeclarations short-circuits without building a catalog
   * in that case). Every `set` statement is still visited; with no catalog,
   * every target is unconditionally invalid-set-target (there is no `let`
   * in the document to resolve against).
   */
  bindingAnalysis: BindingAnalysis | undefined;
};

export type SetStatementCompilation = {
  setsByStatementIndex: ReadonlyMap<number, SetStatementAnalysis>;
  diagnostics: readonly DslDiagnostic[];
};

export type SetTargetClassification =
  | { kind: "valid"; binding: Binding }
  | { kind: "invalid"; reason: "unresolved" | "const-assignment" | "not-let" | "declared-type-unknown" };

/**
 * The single target-validity chain for a `set` statement's name resolution:
 * must resolve, must be a `let` (never `const`, and never legacy/iteration/
 * elementLocal, all of which carry mutability "readonly"), and must have a
 * known declared type. Shared with Task 37's rename safety analysis
 * (src/scalars/typedRenameAnalysis.ts), which classifies the same target
 * name's resolution before and after a candidate rename - this must stay the
 * single source of truth for "is this a safe set target" so the two never
 * drift apart.
 */
export const classifySetTargetResolution = (resolution: BindingResolution | undefined): SetTargetClassification => {
  if (!resolution || resolution.kind !== "resolved") return { kind: "invalid", reason: "unresolved" };
  const binding = resolution.binding;
  if (binding.mutability === "const") return { kind: "invalid", reason: "const-assignment" };
  if (binding.mutability !== "let") return { kind: "invalid", reason: "not-let" };
  if (binding.declaredType === null) return { kind: "invalid", reason: "declared-type-unknown" };
  return { kind: "valid", binding };
};

const diagnosticAt = (statement: DslStatement, span: DslSpan, code: string, message: string): DslDiagnostic => ({
  severity: "error",
  line: statement.line,
  column: span.start + 1,
  code,
  message,
  physicalSpan: statement.physicalSpan
});

type SetCandidate = {
  statement: Extract<DslStatement, { kind: "set" }>;
  statementIndex: number;
  targetSpan: DslSpan;
  targetKey: string;
  ast: ScalarExpressionAst;
  expressionSpan: DslSpan;
  references: readonly { name: string; span: DslSpan }[];
  referenceKeys: readonly string[];
};

export const compileSetStatements = ({
  statements,
  stableStatementIdByIndex,
  bindingAnalysis
}: CompileSetStatementsInput): SetStatementCompilation => {
  const setEntries = statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter((entry): entry is { statement: Extract<DslStatement, { kind: "set" }>; statementIndex: number } =>
      entry.statement.kind === "set"
    );
  if (setEntries.length === 0) return { setsByStatementIndex: new Map(), diagnostics: [] };

  // Identity contract: fail-closed, all-or-nothing, mirroring
  // typedDeclarationAnalysis.ts's own missingIdentity check exactly. Never
  // synthesize an ID from statementIndex or any other source-derived value.
  const missingIdentity = setEntries.flatMap(({ statement, statementIndex }) =>
    stableStatementIdByIndex.has(statementIndex)
      ? []
      : [diagnosticAt(
          statement,
          statement.nameSpan ?? statement.keywordSpan,
          MISSING_SET_STATEMENT_IDENTITY_CODE,
          "set文のstable statement identityを取得できません。"
        )]
  );
  if (missingIdentity.length > 0) return { setsByStatementIndex: new Map(), diagnostics: missingIdentity };

  const diagnostics: DslDiagnostic[] = [];
  const candidates: SetCandidate[] = [];
  const requests: SiteReferenceRequest[] = [];

  for (const { statement, statementIndex } of setEntries) {
    if (!statement.nameSpan) {
      // The parser already diagnosed a missing target name; nothing further to resolve.
      continue;
    }
    const targetSpan = statement.nameSpan;

    const expressionSpan = statement.payloadSpans.expression;
    if (!expressionSpan) {
      // Missing RHS - already diagnosed by the parser.
      continue;
    }
    // Parse the RHS regardless of catalog availability, so a malformed RHS
    // is still reported even in a document with zero typed declarations.
    const parsed = parseScalarExpression(" ".repeat(expressionSpan.start) + statement.expression, expressionSpan);
    if (!parsed.ast) {
      diagnostics.push(...parsed.diagnostics.map((diagnostic) =>
        diagnosticAt(statement, diagnostic.span, diagnostic.code, diagnostic.message)
      ));
      continue;
    }

    if (bindingAnalysis === undefined) {
      // No catalog at all - there is no possible `let` in the document to
      // resolve against, so the target is unconditionally invalid. Skip
      // reference resolution/typecheck entirely (there is nothing to
      // resolve against).
      diagnostics.push(diagnosticAt(
        statement,
        targetSpan,
        INVALID_SET_TARGET_CODE,
        `"${statement.name}" は定義されていません。set の対象は宣言済みの let だけです。`
      ));
      continue;
    }

    const references = collectReferences(parsed.ast);
    const targetKey = `${statementIndex}:target`;
    const referenceKeys = references.map((_, index) => `${statementIndex}:rhs:${index}`);

    const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex)
      ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
    requests.push({ key: targetKey, name: statement.name, site: { scopeId, statementIndex } });
    references.forEach((reference, index) => {
      requests.push({ key: referenceKeys[index], name: reference.name, site: { scopeId, statementIndex } });
    });

    candidates.push({
      statement,
      statementIndex,
      targetSpan,
      targetKey,
      ast: parsed.ast,
      expressionSpan,
      references,
      referenceKeys
    });
  }

  // Single batch sweep for every set statement in the document - not one
  // lookup per occurrence. See resolveReferencesAtSites's own O(n) batching
  // contract and this module's header comment.
  const resolutions = requests.length > 0 && bindingAnalysis
    ? resolveReferencesAtSites(bindingAnalysis.catalog, requests)
    : new Map<string, BindingResolution>();

  const setsByStatementIndex = new Map<number, SetStatementAnalysis>();

  if (candidates.length === 0) return { setsByStatementIndex, diagnostics };

  // A candidate is only ever pushed above after the `bindingAnalysis ===
  // undefined` branch has already `continue`d, so a non-empty `candidates`
  // array (just proven above) guarantees `bindingAnalysis` is defined here -
  // this simple check narrows it for the rest of the function, including
  // the nested closures below, matching this codebase's existing
  // fail-fast-on-caller-contract-violation convention.
  if (bindingAnalysis === undefined) {
    throw new Error("setStatementCompiler: candidates present without a bindingAnalysis catalog");
  }

  for (const candidate of candidates) {
    const targetResolution = resolutions.get(candidate.targetKey);
    // Shared with Task 37's rename safety analysis - the single target-
    // validity chain (resolved, let, not const, known declared type). An
    // invalid-status `let` (poisoned by its own initializer or a failed
    // dependency) is still accepted here - its declared type is known, so
    // this is the deliberate recovery path plan.md describes. No status
    // check against bindingAnalysis.entriesById gates this branch.
    const classification = classifySetTargetResolution(targetResolution);
    if (classification.kind === "invalid") {
      const code = classification.reason === "const-assignment" ? CONST_ASSIGNMENT_CODE : INVALID_SET_TARGET_CODE;
      const message = classification.reason === "unresolved"
        ? unresolvedReferenceMessage(candidate.statement.name, targetResolution)
        : classification.reason === "const-assignment"
        ? `"${candidate.statement.name}" は const のため再代入できません。`
        : classification.reason === "not-let"
        ? `"${candidate.statement.name}" はlet宣言ではないため set の対象にできません。`
        : `"${candidate.statement.name}" の宣言型が確定していないため、set の対象にできません。`;
      diagnostics.push(diagnosticAt(candidate.statement, candidate.targetSpan, code, message));
      continue;
    }
    const binding = classification.binding;

    let hasReferenceDiagnostic = false;
    const referenceResolutions: BindingResolution[] = [];
    candidate.references.forEach((reference, index) => {
      const resolution = resolutions.get(candidate.referenceKeys[index]);
      if (!resolution || resolution.kind !== "resolved") {
        diagnostics.push(diagnosticAt(
          candidate.statement,
          reference.span,
          SET_RHS_UNRESOLVED_CODE,
          unresolvedReferenceMessage(reference.name, resolution)
        ));
        hasReferenceDiagnostic = true;
        return;
      }
      const referencedEntry = bindingAnalysis.entriesById.get(resolution.binding.id);
      // Legacy measurement vars are the migration bridge's typed-number
      // external bindings. Their catalog shape deliberately has no declared
      // type or typed-program eligibility entry, but Task 15's typechecker
      // already treats them as number and Task 31 reads their live runtime
      // value. Do not reject that resolved reference as an invalid typed
      // declaration.
      const isLegacyNumericBinding = resolution.binding.kind === "legacy";
      if (
        (!isLegacyNumericBinding && resolution.binding.declaredType === null) ||
        (!isLegacyNumericBinding && referencedEntry?.status.kind === "invalid")
      ) {
        diagnostics.push(diagnosticAt(
          candidate.statement,
          reference.span,
          SET_RHS_INVALID_REFERENCE_CODE,
          `"${reference.name}" は無効な宣言のため参照できません。`
        ));
        hasReferenceDiagnostic = true;
        return;
      }
      referenceResolutions.push(resolution);
    });
    if (hasReferenceDiagnostic) continue;

    const checked = typecheckScalarExpression(candidate.ast, {
      expectedType: binding.declaredType,
      references: referenceResolutions
    });
    if (checked.diagnostics.length > 0) {
      diagnostics.push(...checked.diagnostics.map((diagnostic) =>
        diagnosticAt(candidate.statement, diagnostic.span, diagnostic.code, diagnostic.message)
      ));
      continue;
    }

    const statementId = stableStatementIdByIndex.get(candidate.statementIndex);
    // Proven present by the identity-contract check at the top of this
    // function - no `!`, no fallback.
    if (statementId === undefined) {
      throw new Error(`setStatementCompiler: missing proven-present statement identity for index ${candidate.statementIndex}`);
    }

    setsByStatementIndex.set(candidate.statementIndex, {
      statementId,
      sourceOrder: candidate.statementIndex,
      scopeId: bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(candidate.statementIndex)
        ?? bindingAnalysis.catalog.scopeIndex.rootScopeId,
      targetBindingId: binding.id,
      targetName: candidate.statement.name,
      targetSpan: candidate.targetSpan,
      expressionSpan: candidate.expressionSpan,
      expression: checked.typed
    });
  }

  return { setsByStatementIndex, diagnostics };
};
