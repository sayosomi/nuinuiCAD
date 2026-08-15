// `set` target-name && RHS completion candidate generation.
// Unlike declaration/property/template completion
// (typedValueCandidates.ts), this never resolves visibility through
// visibleBindingsAt's compiled-statementIndex sweep && never touches
// BindingVersionGraph: a `set` statement's own target may currently be
// unresolved (invalid target) || its RHS invalid, && a brand-new,
// never-yet-compiled `set` line must still complete correctly. Instead,
// visibility is resolved purely from each candidate typed binding's own
// *live* document position (already tracked independently of this specific
// `set` statement's own compiled identity - see
// src/editor/statementRangeIndex.ts's TypedDeclarationRangeIndex) compared
// against the live cursor position, plus lexical scope-chain membership from
// the last compiled BindingCatalog's own scope index (which is always
// available && always current for every statement, valid || not - the
// statement's own compiled analysis/BindingVersionGraph may be unavailable
// exactly for the cases this task must handle, so they are never consulted
// here). Forward-reference exclusion && pre-declaration outer-scope
// shadowing both fall out of the position comparison alone - see
// setVisibleTypedBindings's own doc comment.

import type { BindingAnalysis } from "./bindingAnalysis";
import type { Binding, BindingCatalog, BindingId } from "./bindingCatalog";
import type { ScopeId } from "./lexicalScopeIndex";
import { visibleTypedBindingsAtLivePosition } from "./liveTypedBindingVisibility";
import { isScalarTypeAssignable } from "./scalarAssignability";
import { scalarExpressionCompletionContextAt } from "./scalarExpressionPositionClassifier";
import type { ScalarExpressionToken } from "./expressionTokenizer";
import type { ScalarSpan } from "./literalScanner";
import {
  literalTokenScalarType,
  scalarLiteralCandidates,
  scalarOperatorCandidates,
  scalarPrefixOperatorCandidates,
  scalarFunctionCandidates,
  type ScalarCompletionCandidate
} from "./typedValueCandidates";
import type { ScalarType } from "./types";

export type SetTargetCandidate = { readonly name: string; readonly bindingId: BindingId; readonly type: ScalarType };

export type SetCompletionSiteDeps = {
  catalog: BindingCatalog;
  entriesById: BindingAnalysis["entriesById"];
  /** The live cursor's deepest containing lexical scope - the caller's own
   * ScopeBodyRangeIndex query result (statementRangeIndex.ts's
   * deepestContainingScopeId); this module never touches CM/live-position
   * plumbing itself. */
  containingScopeId: ScopeId;
  /** A typed binding's own live document position (`from`), || `undefined`
   * when it currently has no trackable live position (untracked/stale -
   * excluded, fail-closed, never guessed). Backed by the caller's own
   * TypedDeclarationRangeIndex, passed as a plain lookup so this module
   * stays editor-agnostic. */
  livePositionOf: (bindingId: BindingId) => number | undefined;
  cursorPosition: number;
};

/**
 * Every typed binding visible at `cursorPosition`: in `containingScopeId` ||
 * an ancestor scope, with a live position at || before the cursor.
 * Same-name shadowing prefers the innermost scope in the chain, then (same
 * scope) the nearest-preceding live position. A binding declared *after* the
 * cursor (even in the same scope) is excluded by the position check alone -
 * this is forward-reference exclusion; a binding shadowed by an inner-scope
 * declaration that itself sits after the cursor is *not* excluded, because
 * that inner declaration never passes the position check either - this is
 * "内側同名宣言の前は外側が見え" pre-declaration outer visibility
 * rule, falling out of the same single position comparison. `accepts`
 * narrows by mutability/type; callers choose the exact predicate (target
 * completion: `let` only, known type, any BindingAnalysis status; RHS
 * reference ,completion: any non-invalid binding assignable to the expected
 * type).
 */
const setVisibleTypedBindings = (
  deps: SetCompletionSiteDeps,
  accepts: (binding: Binding) => boolean
): readonly Binding[] => {
  return visibleTypedBindingsAtLivePosition({
    catalog: deps.catalog,
    containingScopeId: deps.containingScopeId,
    cursorOffset: deps.cursorPosition,
    offsetForBinding: deps.livePositionOf
  }, accepts);
};

/**
 * Every visible `let` with a known declared type - INCLUDES an invalid
 * (poisoned) `let`, since this never consults BindingAnalysis status at all,
 * only the catalog's own kind/mutability/declaredType shape (mirrors
 * setStatementCompiler.ts's classifySetTargetResolution's target-validity
 * chain, minus the status check that function also deliberately skips).
 * const/iteration/elementLocal are excluded by kind/mutability, never
 * by status.
 */
export const setTargetCandidates = (deps: SetCompletionSiteDeps): readonly SetTargetCandidate[] =>
  setVisibleTypedBindings(deps, (binding) => binding.mutability === "let" && binding.declaredType !== null)
    .map((binding) => ({ name: binding.name, bindingId: binding.id, type: binding.declaredType as ScalarType }));

const nonInvalidAssignable = (deps: SetCompletionSiteDeps, expectedType: ScalarType) => (binding: Binding): boolean =>
  binding.declaredType !== null &&
  isScalarTypeAssignable(binding.declaredType, expectedType) &&
  deps.entriesById.get(binding.id)?.status.kind !== "invalid";

const referenceCandidates = (deps: SetCompletionSiteDeps, expectedType: ScalarType): ScalarCompletionCandidate[] =>
  setVisibleTypedBindings(deps, nonInvalidAssignable(deps, expectedType))
    .map((binding) => ({ kind: "reference", name: binding.name, bindingId: binding.id }));

/** Mirrors typedValueCandidates.ts's own resolvePrecedingOperandType, using
 * this module's position-based visibility instead of visibleBindingsAt. */
const precedingOperandType = (precedingToken: ScalarExpressionToken, deps: SetCompletionSiteDeps, rootType: ScalarType | null): ScalarType | null => {
  if (precedingToken.kind === "literal") return literalTokenScalarType(precedingToken);
  if (precedingToken.kind === "reference") {
    const binding = setVisibleTypedBindings(
      deps,
      (candidate) => candidate.declaredType !== null && deps.entriesById.get(candidate.id)?.status.kind !== "invalid"
    ).find((candidate) => candidate.name === precedingToken.name);
    return binding?.declaredType ?? null;
  }
  if (precedingToken.kind === "rightParen") return rootType;
  return null; // operator / leftParen can never be a "preceding operand" token.
};

/**
 * Set RHS completion: reuses the pure, catalog-free literal/
 * operator tables && operand/operator position classification unchanged;
 * only its reference-candidate visibility is this module's position-based
 * resolution (see this module's header) rather than typedValueCandidates.ts's
 * visibleBindingsAt-based typedBindingReferenceCandidates/
 * scalarExpressionCandidates.
 */
export const setRhsScalarCandidates = (
  text: string,
  expressionSpan: ScalarSpan,
  pos: number,
  expectedType: ScalarType,
  deps: SetCompletionSiteDeps
): readonly ScalarCompletionCandidate[] => {
  const context = scalarExpressionCompletionContextAt(text, pos, expressionSpan, expectedType);
  if (!context) return [];

  if (context.kind === "operator") {
    const operandType = precedingOperandType(context.precedingToken, deps, context.rootType);
    return scalarOperatorCandidates(operandType).map((candidate): ScalarCompletionCandidate => ({ kind: "operator", label: candidate.label }));
  }
  if (context.kind === "argumentName") return [];

  const candidates: ScalarCompletionCandidate[] = [];
  const { expectedType: operandType } = context;
  if (operandType === null) return candidates;
  if (!context.literalOnly) candidates.push(...referenceCandidates(deps, operandType));
  if (!context.referenceOnly) {
    candidates.push(...scalarFunctionCandidates(operandType));
    for (const literal of scalarLiteralCandidates(operandType)) candidates.push({ kind: "literal", label: literal.label });
    if (!context.literalOnly) {
      for (const prefix of scalarPrefixOperatorCandidates(operandType)) candidates.push({ kind: "operator", label: prefix.label });
    }
  }
  return candidates;
};
