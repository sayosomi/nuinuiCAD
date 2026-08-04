// Pure, metadata-driven candidate generation for typed value completion
// (Task 39). Reads a precomputed BindingCatalog/BindingAnalysis and never
// re-parses source, re-resolves names, or re-runs typecheck - see
// docs/typed-variables/tasks/39-typed-value-completion.md.
//
// Literal/operator tables mirror src/scalars/expressionTypecheck.ts's own
// SIMPLE_BINARY_RULES/checkEqualityBinary matrix exactly (never re-derived):
// number allows arithmetic, numeric comparison, and equality; boolean allows
// `&&`/`||`/equality (`!` is a prefix, offered separately); string/choice
// allow only equality. Binding reference candidates reuse
// bindingResolution.ts's visibleBindingsAt, which already returns exactly one
// binding per visible name (innermost, shadow-resolved) and naturally excludes
// a typed declaration's own not-yet-declared self and any forward reference -
// see typedValueCandidates.test.ts's "pre-declaration visibility" suite.

import type { BindingAnalysis } from "./bindingAnalysis";
import type { Binding, BindingCatalog, BindingId } from "./bindingCatalog";
import { type BindingReferenceSite, visibleBindingsAt } from "./bindingResolution";
import type { ScalarExpressionToken } from "./expressionTokenizer";
import type { ScalarSpan } from "./literalScanner";
import { isScalarTypeAssignable } from "./scalarAssignability";
import { scalarExpressionCompletionContextAt, type ScalarExpressionCompletionContext } from "./scalarExpressionPositionClassifier";
import { isChoiceScalarType, type ScalarType } from "./types";

export type ScalarValueCandidate = { readonly label: string };
export type ScalarBindingCandidate = { readonly name: string; readonly bindingId: BindingId; readonly type: ScalarType | null };

/** boolean literal candidates first (declared value order matches source authoring convention elsewhere: true before false). */
export const scalarLiteralCandidates = (type: ScalarType): readonly ScalarValueCandidate[] => {
  if (type.kind === "boolean") return [{ label: "true" }, { label: "false" }];
  if (isChoiceScalarType(type)) return type.options.map((option) => ({ label: option }));
  return [];
};

const NUMBER_OPERATORS = ["+", "-", "*", "/", "<", "<=", ">", ">=", "==", "!="] as const;
const BOOLEAN_OPERATORS = ["&&", "||", "==", "!="] as const;
const EQUALITY_ONLY_OPERATORS = ["==", "!="] as const;

/** `operandType === null` (unresolved/undefined preceding operand) offers no operator - a caller cannot know which matrix applies. */
export const scalarOperatorCandidates = (operandType: ScalarType | null): readonly ScalarValueCandidate[] => {
  if (operandType === null) return [];
  if (operandType.kind === "number") return NUMBER_OPERATORS.map((label) => ({ label }));
  if (operandType.kind === "boolean") return BOOLEAN_OPERATORS.map((label) => ({ label }));
  return EQUALITY_ONLY_OPERATORS.map((label) => ({ label })); // string | choice
};

/** Unary `!` is only ever valid ahead of a boolean operand (expressionTypecheck.ts's `unary` rule); offered at an operand-start position, never after an operand. */
export const scalarPrefixOperatorCandidates = (expectedType: ScalarType | null): readonly ScalarValueCandidate[] =>
  expectedType === null || expectedType.kind === "boolean" ? [{ label: "!" }] : [];

/**
 * Every non-`typed` binding kind (iteration) carries
 * `declaredType: null` in the catalog and is treated as implicit `number` at
 * every existing read site (see expressionTypecheck.ts's own `binding.kind ===
 * "typed" ? binding.declaredType : (binding.declaredType ?? NUMBER_TYPE)`).
 * This mirrors that exact convention rather than re-deriving it.
 */
const declaredOrImplicitType = (binding: Binding): ScalarType | null =>
  binding.kind === "typed" ? binding.declaredType : (binding.declaredType ?? { kind: "number" });

// literalScanner.ts's ScalarLiteralToken (this token's `.literal` field type)
// is exactly these 4 success variants - a scan error is the separate
// ScalarLiteralScanError type and never reaches a "literal" token at all
// (tokenizeScalarExpression returns early on error instead) - so this switch
// is already exhaustive with no `default`/unreachable branch needed.
export const literalTokenScalarType = (literal: ScalarExpressionToken & { kind: "literal" }): ScalarType => {
  switch (literal.literal.kind) {
    case "number":
      return { kind: "number" };
    case "string":
      return { kind: "string" };
    case "boolean":
      return { kind: "boolean" };
    case "choice":
      // Operator selection only ever inspects `.kind` (string/choice share the
      // equality-only matrix) - the concrete option list is never meaningful
      // here, so an empty list is a safe placeholder, never surfaced to a caller.
      return { kind: "choice", options: [] };
  }
};

export type ResolvePrecedingOperandTypeInput = {
  precedingToken: ScalarExpressionToken | null;
  catalog: BindingCatalog;
  entriesById: BindingAnalysis["entriesById"];
  /** Omit only when the caller supplies liveVisibleBindings. */
  site?: BindingReferenceSite;
  /** A caller-provided, already fail-closed visible set for an uncompiled
   * source statement. This stays plain domain data; editor range mapping
   * belongs outside this module. */
  liveVisibleBindings?: readonly Binding[];
  /**
   * Approximation used only when `precedingToken.kind === "rightParen"`:
   * inner parenthesized sub-expressions are never recursively type-inferred
   * here, so the declaration/property/hole's own expected root type stands
   * in. A mismatched inner type only ever widens/narrows the operator
   * candidate list, never the real typecheck diagnostic (expressionTypecheck.ts
   * remains the correctness authority) - see the task plan's explicit note.
   */
  rootType: ScalarType | null;
};

/** Resolves the ScalarType of a classifier-reported preceding token, the one piece of type inference the pure classifier deliberately does not do. */
export const resolvePrecedingOperandType = (input: ResolvePrecedingOperandTypeInput): ScalarType | null => {
  const { precedingToken } = input;
  if (!precedingToken) return null;
  if (precedingToken.kind === "literal") return literalTokenScalarType(precedingToken);
  if (precedingToken.kind === "reference") {
    const visible = input.liveVisibleBindings ?? (input.site ? visibleBindingsAt(input.catalog, input.site) : []);
    const binding = visible.find((candidate) => candidate.name === precedingToken.name);
    if (!binding || input.entriesById.get(binding.id)?.status.kind === "invalid") return null;
    return declaredOrImplicitType(binding);
  }
  if (precedingToken.kind === "rightParen") return input.rootType;
  return null; // operator / leftParen can never be a "preceding operand" token.
};

export type TypedBindingReferenceCandidatesInput = {
  catalog: BindingCatalog;
  entriesById: BindingAnalysis["entriesById"];
  /** Required for compiled-statement visibility. Omit only with the mapped,
   * plain-data liveVisibleBindings supplied by Source Editor completion. */
  site?: BindingReferenceSite;
  liveVisibleBindings?: readonly Binding[];
  /** Caller decides exact-match vs. property-capability subset assignability. */
  accepts: (type: ScalarType | null) => boolean;
};

/**
 * `visibleBindingsAt` already returns one binding per visible name (innermost,
 * shadow-resolved) and, for an initializer's own declaration site, naturally
 * excludes the binding's own not-yet-declared self and any same-scope forward
 * declaration (see bindingResolution.ts's statement-index sweep boundary) -
 * no extra self/forward filtering is added here. Only invalid-status
 * exclusion and the caller's type filter are applied.
 */
export const typedBindingReferenceCandidates = (input: TypedBindingReferenceCandidatesInput): readonly ScalarBindingCandidate[] => {
  const candidates: ScalarBindingCandidate[] = [];
  const visible = input.liveVisibleBindings ?? (input.site ? visibleBindingsAt(input.catalog, input.site) : []);
  for (const binding of visible) {
    if (input.entriesById.get(binding.id)?.status.kind === "invalid") continue;
    const type = declaredOrImplicitType(binding);
    if (!input.accepts(type)) continue;
    candidates.push({ name: binding.name, bindingId: binding.id, type });
  }
  return candidates;
};

export type ScalarCompletionCandidate =
  | { readonly kind: "literal"; readonly label: string }
  | { readonly kind: "operator"; readonly label: string }
  | { readonly kind: "reference"; readonly name: string; readonly bindingId: BindingId };

export type ScalarExpressionCandidatesDeps = {
  catalog: BindingCatalog;
  entriesById: BindingAnalysis["entriesById"];
  site?: BindingReferenceSite;
  liveVisibleBindings?: readonly Binding[];
  /**
   * `false` for a context that never allows expression operators (property
   * scalar values are never routed through this function at all - see
   * dslPropertyScalarCompletionContext.ts - so in practice this is always
   * `true` for the two callers that do use it: typed declaration initializers
   * and template holes).
   */
  includeOperators: boolean;
};

/**
 * The single orchestration point combining a pure
 * `ScalarExpressionCompletionContext` (declaration initializer / template
 * hole position analysis, catalog-free) with the precomputed
 * BindingCatalog/BindingAnalysis needed to resolve `@name` candidates and an
 * operator-position's preceding operand type. Reference/expression operand
 * matching is always exact-type (D07's subset rule is a property-capability-
 * only concept; see dslPropertyScalarCompletionContext.ts for that path).
 */
export const scalarExpressionCandidates = (
  context: ScalarExpressionCompletionContext,
  deps: ScalarExpressionCandidatesDeps
): readonly ScalarCompletionCandidate[] => {
  if (context.kind === "operator") {
    if (!deps.includeOperators) return [];
    const operandType = resolvePrecedingOperandType({
      precedingToken: context.precedingToken,
      catalog: deps.catalog,
      entriesById: deps.entriesById,
      site: deps.site,
      liveVisibleBindings: deps.liveVisibleBindings,
      rootType: context.rootType
    });
    return scalarOperatorCandidates(operandType).map((candidate): ScalarCompletionCandidate => ({ kind: "operator", label: candidate.label }));
  }

  const candidates: ScalarCompletionCandidate[] = [];
  const { expectedType } = context;
  if (expectedType === null) return candidates;

  if (!context.literalOnly) {
    const accepts = (type: ScalarType | null): boolean => type !== null && isScalarTypeAssignable(type, expectedType);
    for (const reference of typedBindingReferenceCandidates({
      catalog: deps.catalog,
      entriesById: deps.entriesById,
      site: deps.site,
      liveVisibleBindings: deps.liveVisibleBindings,
      accepts
    })) {
      candidates.push({ kind: "reference", name: reference.name, bindingId: reference.bindingId });
    }
  }
  if (!context.referenceOnly) {
    for (const literal of scalarLiteralCandidates(expectedType)) candidates.push({ kind: "literal", label: literal.label });
    if (!context.literalOnly && deps.includeOperators) {
      for (const prefix of scalarPrefixOperatorCandidates(expectedType)) candidates.push({ kind: "operator", label: prefix.label });
    }
  }
  return candidates;
};

const HOLE_ROOT_TYPES: readonly ScalarType[] = [{ kind: "string" }, { kind: "number" }];

const scalarCompletionCandidateKey = (candidate: ScalarCompletionCandidate): string =>
  candidate.kind === "reference" ? `reference:${candidate.bindingId}` : `${candidate.kind}:${candidate.label}`;

/**
 * A template hole's content only ever resolves to a string or number result
 * (Task 26 - boolean/choice results are always `interpolation-type-mismatch`),
 * and which of the two a given hole needs is not known without evaluating it.
 * Rather than guessing, this analyzes the position once per candidate root
 * type and unions the results (deduped by candidate identity) - reusing
 * scalarExpressionCompletionContextAt/scalarExpressionCandidates unchanged,
 * never a hole-specific type-union concept inside either of them.
 */
export const templateHoleScalarCandidates = (
  text: string,
  contentSpan: ScalarSpan,
  pos: number,
  deps: ScalarExpressionCandidatesDeps
): readonly ScalarCompletionCandidate[] => {
  const seen = new Set<string>();
  const candidates: ScalarCompletionCandidate[] = [];
  for (const rootType of HOLE_ROOT_TYPES) {
    const context = scalarExpressionCompletionContextAt(text, pos, contentSpan, rootType);
    if (!context) continue;
    for (const candidate of scalarExpressionCandidates(context, deps)) {
      const key = scalarCompletionCandidateKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates;
};
