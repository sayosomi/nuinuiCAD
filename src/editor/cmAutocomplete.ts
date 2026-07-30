import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  moveCompletionSelection,
  startCompletion,
  type Completion,
  CompletionContext,
  type CompletionSource
} from "@codemirror/autocomplete";
import { Prec, type Extension, type Text } from "@codemirror/state";
import { keymap, type Command } from "@codemirror/view";
import { dslCompletionContextAt, dslIntermediatesAttributeParameterKey, dslVarsAttributeParameterKey, type DslCompletionContext } from "../dsl/dslCompletionContext";
import { dslStatementElementType } from "../dsl/dslCompletionMetadata";
import { argumentCompletionCandidates, constructionCompletionCandidates } from "../dsl/dslCallCompletionCandidates";
import { dslReferenceCompletionOptions } from "../dsl/dslCompletionCandidates";
import { dslVariableCompletionOptions } from "../dsl/dslVariableCompletionCandidates";
import { dslLocalVariableCompletionOptions } from "../dsl/dslLocalVariableCompletionCandidates";
import { dslEnclosingPrintLayoutLine, dslPrintLayoutVariableCompletionOptions } from "../dsl/dslPrintLayoutVariableCompletionCandidates";
import { dslElementParameterCompletionOptions } from "../dsl/dslElementParameterCompletionCandidates";
import { dslLinePrintLayoutStatement } from "../dsl/dslValueSpans";
import { parseDslSnapshot } from "../dsl/dslParser";
import {
  createLogicalStatementSourceMap,
  logicalOffsetToPhysical,
  physicalSpanForLogicalRange,
  physicalToLogicalOffset,
  type LogicalStatement,
  type LogicalStatementSourceMap
} from "../dsl/logicalStatementSourceMap";
import { localNumericVariableReferenceOptions, type NumericVariableReferenceOption } from "../geometry/variableReferenceOptions";
import type { ElementParameterReferenceOption } from "../geometry/elementParameterReferenceOptions";
import type { CadElement, ComputedGeometry, ComputedVariable, DependencyError, ElementId, EvaluationResult, PrintLayout } from "../types/geometry";
import type { PrintLayoutRangeIndex, ScopeBodyRangeIndex, StatementRangeIndex, TypedDeclarationRangeIndex } from "./statementRangeIndex";
import { deepestContainingScopeId, typedDeclarationBindingIdAtCursor } from "./statementRangeIndex";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { StatementInfo } from "../dsl/dslDocument";
import { isAssignableToPropertyCapability } from "../scalars/scalarAssignability";
import {
  scalarExpressionCandidates,
  scalarLiteralCandidates,
  templateHoleScalarCandidates,
  typedBindingReferenceCandidates,
  type ScalarCompletionCandidate
} from "../scalars/typedValueCandidates";
import { setRhsScalarCandidates, setTargetCandidates, type SetCompletionSiteDeps, type SetTargetCandidate } from "../scalars/setCompletionCandidates";
import { visibleTypedBindingsAtLivePosition } from "../scalars/liveTypedBindingVisibility";
import { cmCompositionCompletionRetry } from "./cmCompositionCompletionRetry";

export type DslAutocompleteDocumentInput = {
  source: string;
  cursorLineNumber: number;
  lineText: string;
  localPos: number;
  doc: Text;
};

export type DslAutocompleteOptions = {
  elements: () => readonly CadElement[];
  statementRanges: () => StatementRangeIndex;
  printLayouts: () => readonly PrintLayout[];
  printLayoutRanges: () => PrintLayoutRangeIndex;
  isComposing: () => boolean;
  /** Last-applied evaluation's computedVariables, when one exists. Used only as
   * the Tier B "still cross-references an unedited compiled element" enrichment
   * in dslVariableCompletionOptions — never as a blanket live-buffer fallback. */
  computedVariables: () => Map<ElementId, ComputedVariable> | undefined;
  /** Last-applied evaluation's computedGeometry/effectiveEnabledElementIds/errors,
   * used the same Tier B way as computedVariables above but for
   * dslElementParameterCompletionOptions's disabled/invalid gating. */
  computedGeometry: () => Map<ElementId, ComputedGeometry> | undefined;
  forGroupGeneratedRows?: () => EvaluationResult["forGroupGeneratedRows"] | undefined;
  effectiveEnabledElementIds: () => Set<ElementId> | undefined;
  evaluationErrors: () => DependencyError[] | undefined;
  /** Tier B for typed value completion (Task 39): the last successfully
   * compiled document's precomputed BindingCatalog/BindingAnalysis, read
   * as-is on every keystroke (never rebuilt here) - undefined for a document
   * with no typed declarations or set statements. */
  bindingAnalysis: () => BindingAnalysis | undefined;
  /** Live-line -> stable typed-declaration BindingId bridge (Task 39), kept
   * in sync with CM edits by the caller the same way statementRanges is. */
  typedDeclarationRanges: () => TypedDeclarationRangeIndex;
  /** Tier B site resolution for `set` target/RHS completion (Task 40): live
   * body-range tracking per lexical scope, purely structural and
   * independent of any specific `set` statement's own compiled identity -
   * see statementRangeIndex.ts's own doc comment for why this (not
   * BindingVersionGraph) is the source of truth here. */
  scopeBodyRanges: () => ScopeBodyRangeIndex;
  /** `doc.statementMap.byElementId`, used only to map an element at the
   * cursor to the compiled catalog's own statementIndex for a property
   * scalar value / template hole's BindingReferenceSite (Task 39) - never
   * for any other purpose already covered by statementRanges/computedGeometry. */
  statementInfoByElementId: () => ReadonlyMap<ElementId, StatementInfo> | undefined;
  /** Whether the evaluation backing computedGeometry/effectiveEnabledElementIds/
   * evaluationErrors above is current for the live document right now (the
   * caller's own evaluationStateIsCurrentFor check - see
   * elementParameterCandidateState in elementParameterReferenceOptions.ts).
   * Rust evaluation is asynchronous, so those fields can be stale (or from a
   * still-in-flight request) even when they otherwise look populated;
   * `elementParameter` completion must report no candidates - never a
   * synchronous re-evaluation - while this is false. Defaults to true so
   * existing callers/tests that don't model evaluation freshness keep their
   * prior behavior. */
  evaluationIsCurrent?: () => boolean;
  /** Defaults to deriving everything from the CompletionContext's own editor state. */
  documentInput?: (context: CompletionContext) => DslAutocompleteDocumentInput | null;
};

/** A logical-projection pairing kept alongside the document input so the
 * completion's from/to can later be projected back through the exact same
 * source map/statement that produced lineText/localPos — never a freshly
 * rebuilt one, and never mixed with physical-line arithmetic. */
type LogicalProjection = { map: LogicalStatementSourceMap; statement: LogicalStatement };

/** Builds the default (non-overridden) document input for one completion call.
 * Prefers the cursor's enclosing statement's logical projection (so
 * continuation-line completion sees the whole statement, per W3); falls back
 * to the legacy single physical line as one unit — never a logical lineText
 * paired with physical localPos or vice versa — whenever the cursor's
 * statement can't be found or its position can't be projected into logical
 * text (comments, the continuation backslash, trimmed indentation). */
const defaultDocumentInput = (context: CompletionContext): { input: DslAutocompleteDocumentInput; projection: LogicalProjection | null } => {
  const line = context.state.doc.lineAt(context.pos);
  const source = context.state.doc.toString();
  const physicalInput: DslAutocompleteDocumentInput = {
    source,
    cursorLineNumber: line.number,
    lineText: line.text,
    localPos: context.pos - line.from,
    doc: context.state.doc
  };
  const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 0 });
  const statement = map.statements.find((candidate) => context.pos >= candidate.range.from && context.pos <= candidate.range.to);
  if (!statement) return { input: physicalInput, projection: null };
  const localPos = physicalToLogicalOffset(map, statement, context.pos);
  if (localPos === null) return { input: physicalInput, projection: null };
  return {
    input: { ...physicalInput, lineText: statement.logicalText, localPos },
    projection: { map, statement }
  };
};

const statementElementIdsByLiveLine = (doc: Text, ranges: StatementRangeIndex) => {
  const result = new Map<number, ElementId>();
  for (const range of ranges.values()) {
    const fromLine = doc.lineAt(range.from).number;
    const toLine = doc.lineAt(range.to).number;
    for (let line = fromLine; line <= toLine; line += 1) result.set(line, range.elementId);
  }
  return result;
};

const printLayoutIdsByLiveLine = (doc: Text, ranges: PrintLayoutRangeIndex): Map<number, string> => {
  const result = new Map<number, string>();
  for (const range of ranges.values()) {
    const line = doc.lineAt(range.from);
    if (line.from === range.from) result.set(line.number, range.printLayoutId);
  }
  return result;
};

/** The compiled element for the cursor's own line, only when its type still
 * matches what the live line currently says it is (same "don't trust a stale
 * cross-reference past a structural edit" guard dslReferenceCompletionOptions
 * already applies elsewhere). */
const currentLiveElement = (source: string, position: number, elementId: ElementId | undefined, elements: readonly CadElement[]) => {
  if (!elementId) return undefined;
  const statement = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 }).statements
    .find((candidate) => position >= candidate.documentRange.from && position <= candidate.documentRange.to);
  const liveType = statement ? dslStatementElementType(statement) : null;
  if (!liveType) return undefined;
  return elements.find((element) => element.id === elementId && element.type === liveType);
};

const asVariableCompletions = (options: readonly NumericVariableReferenceOption[]): Completion[] =>
  options.map((option) => ({ label: option.displayExpression, apply: option.expression, detail: option.detail, type: "variable" }));

/** Independent of asVariableCompletions/NumericVariableReferenceOption on
 * purpose: the element-parameter pure layer has its own candidate type and
 * must not depend on the @variable-specific one. `apply`/`from`/`to` only
 * ever cover the member-token span (never the `ElementName.` prefix), so
 * `option.path` alone is the correct insertion text. */
const asElementParameterCompletions = (options: readonly ElementParameterReferenceOption[]): Completion[] =>
  options.map((option) => ({ label: option.label, apply: option.path, detail: option.detail, type: "variable" }));

/** Task 39: maps the pure `ScalarCompletionCandidate` union to CM's
 * `Completion` shape - the one place that translates candidate `kind` into a
 * CM `type`/`apply` convention. A reference candidate's `apply` always
 * re-adds the "@" sigil: the completion span never includes it when nothing
 * has been typed yet (a clean operand-start), and does include it as part of
 * the replaced text when a partial "@name" is already in progress - "@" +
 * name is the correct insertion text either way. */
const asScalarCompletions = (candidates: readonly ScalarCompletionCandidate[]): Completion[] =>
  candidates.map((candidate) => {
    if (candidate.kind === "reference") {
      return {
        label: candidate.name,
        apply: `@${candidate.name}`,
        type: "variable"
      };
    }
    if (candidate.kind === "operator") return { label: candidate.label, type: "keyword" };
    return { label: candidate.label, type: "enum" };
  });

/** Task 40: maps `SetTargetCandidate` to CM's `Completion` shape. Unlike
 * asScalarCompletions's reference branch, a `set` target is a bare
 * identifier - `apply` is the plain name, never `@`-prefixed. */
const asSetTargetCompletions = (candidates: readonly SetTargetCandidate[]): Completion[] =>
  candidates.map((candidate) => ({ label: candidate.name, apply: candidate.name, type: "variable" }));

/** Resolves the BindingReferenceSite for the CadElement at the cursor's own
 * line (property scalar value / template hole contexts): looks the live
 * element up in the compiled document's own `statementMap.byElementId` to
 * get its catalog-space statementIndex, then reads that statement's scope
 * from the same precomputed `BindingCatalog` - mirrors
 * propertyBindingCompiler.ts's own site construction exactly, so `@name`
 * visibility here matches what Task 22 itself already resolves for this
 * exact property. Returns `null` whenever the live element/statement can't
 * be cross-referenced into the (possibly stale) compiled catalog. */
const elementBindingSite = (
  elementId: ElementId | undefined,
  statementInfoByElementId: ReadonlyMap<ElementId, StatementInfo> | undefined,
  bindingAnalysis: BindingAnalysis
) => {
  const statementIndex = elementId ? statementInfoByElementId?.get(elementId)?.statementIndex : undefined;
  if (statementIndex === undefined) return null;
  const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
  return { scopeId, statementIndex };
};

/** Task 40: builds the position-based site setTargetCandidates/
 * setRhsScalarCandidates need, purely from the last successfully compiled
 * BindingCatalog's own scope index (via ScopeBodyRangeIndex) plus each
 * candidate binding's own live position (via TypedDeclarationRangeIndex) -
 * never BindingVersionGraph, and never gated on this specific `set`
 * statement's own compiled identity, so it resolves the same way for an
 * already-compiled `set` and a brand-new, never-yet-compiled one. */
const setCompletionSiteDeps = (
  options: DslAutocompleteOptions,
  bindingAnalysis: BindingAnalysis,
  cursorPosition: number
): SetCompletionSiteDeps => ({
  catalog: bindingAnalysis.catalog,
  entriesById: bindingAnalysis.entriesById,
  containingScopeId: deepestContainingScopeId(options.scopeBodyRanges(), cursorPosition, bindingAnalysis.catalog.scopeIndex.rootScopeId),
  livePositionOf: (bindingId) => options.typedDeclarationRanges().get(bindingId)?.from,
  cursorPosition
});

/**
 * Completes a newly inserted declaration/element before it has a compiled
 * owner identity. Candidate bindings must have both catalog identities and
 * mapped live declaration offsets, so this preserves the normal fail-closed
 * freshness contract without importing CodeMirror types into scalar logic.
 */
const liveTypedBindingsAtCompletionCursor = (
  options: DslAutocompleteOptions,
  bindingAnalysis: BindingAnalysis,
  cursorPosition: number
) => visibleTypedBindingsAtLivePosition({
  catalog: bindingAnalysis.catalog,
  containingScopeId: deepestContainingScopeId(
    options.scopeBodyRanges(),
    cursorPosition,
    bindingAnalysis.catalog.scopeIndex.rootScopeId
  ),
  cursorOffset: cursorPosition,
  offsetForBinding: (bindingId) => options.typedDeclarationRanges().get(bindingId)?.from
}, () => true);

type TypedReferenceCompletionContext = Extract<DslCompletionContext, {
  kind: "typedInitializer" | "propertyScalarValue" | "templateHole";
}>;

/** Keeps source lookup and composition-end eligibility on the identical
 * freshness/type-filtered candidate calculation. This stays in the editor:
 * scalar helpers receive only catalog, scope, and offset data. */
const typedReferenceCompletions = (
  options: DslAutocompleteOptions,
  input: DslAutocompleteDocumentInput,
  context: CompletionContext,
  completionContext: TypedReferenceCompletionContext
): Completion[] => {
  if (completionContext.kind === "typedInitializer") {
    const bindingAnalysis = options.bindingAnalysis();
    const bindingId = bindingAnalysis ? typedDeclarationBindingIdAtCursor(options.typedDeclarationRanges(), context.pos) : null;
    const binding = bindingAnalysis && bindingId ? bindingAnalysis.catalog.bindingsById.get(bindingId) : undefined;
    return bindingAnalysis && bindingId && !binding
      ? []
      : bindingAnalysis && binding
      ? asScalarCompletions(scalarExpressionCandidates(completionContext.positionContext, {
        catalog: bindingAnalysis.catalog,
        entriesById: bindingAnalysis.entriesById,
        site: { scopeId: binding.effectiveScopeId, statementIndex: binding.statementIndex },
        includeOperators: true
      }))
      : bindingAnalysis
        ? asScalarCompletions(scalarExpressionCandidates(completionContext.positionContext, {
          catalog: bindingAnalysis.catalog,
          entriesById: bindingAnalysis.entriesById,
          liveVisibleBindings: liveTypedBindingsAtCompletionCursor(options, bindingAnalysis, context.pos),
          includeOperators: true
        }))
      : [];
  }

  const bindingAnalysis = options.bindingAnalysis();
  const elementId = statementElementIdsByLiveLine(input.doc, options.statementRanges()).get(input.cursorLineNumber);
  const site = bindingAnalysis ? elementBindingSite(elementId, options.statementInfoByElementId(), bindingAnalysis) : null;
  if (completionContext.kind === "propertyScalarValue") {
    const propertyContext = completionContext.propertyContext;
    if (propertyContext.kind === "booleanLiteral") {
      return scalarLiteralCandidates({ kind: "boolean" }).map((candidate) => ({ label: candidate.label, type: "enum" }));
    }
    const capability = propertyContext.capability;
    return bindingAnalysis
      ? asScalarCompletions(typedBindingReferenceCandidates({
        catalog: bindingAnalysis.catalog,
        entriesById: bindingAnalysis.entriesById,
        ...(site ? { site } : { liveVisibleBindings: liveTypedBindingsAtCompletionCursor(options, bindingAnalysis, context.pos) }),
        accepts: (type) => type !== null && isAssignableToPropertyCapability(type, capability)
      }).map((candidate): ScalarCompletionCandidate => ({ kind: "reference", name: candidate.name, bindingId: candidate.bindingId })))
      : [];
  }

  return bindingAnalysis
    ? asScalarCompletions(templateHoleScalarCandidates(input.lineText, completionContext.contentSpan, input.localPos, {
      catalog: bindingAnalysis.catalog,
      entriesById: bindingAnalysis.entriesById,
      ...(site ? { site } : { liveVisibleBindings: liveTypedBindingsAtCompletionCursor(options, bindingAnalysis, context.pos) }),
      includeOperators: true
    }))
    : [];
};

/** CodeMirror's stock filtering compares the raw `@name` token to labels
 * such as `name`, so it removes every option at the bare `@` trigger. Keep
 * filtering off for that token, but retain a narrow, case-insensitive prefix
 * match once the author has started the name. */
const filteredTypedReferenceCompletions = (
  completions: readonly Completion[],
  input: DslAutocompleteDocumentInput,
  completionContext: TypedReferenceCompletionContext
): Completion[] => {
  const token = input.lineText.slice(completionContext.from, completionContext.to);
  if (!token.startsWith("@")) return [...completions];
  const query = token.slice(1).toLocaleLowerCase();
  return query.length === 0
    ? [...completions]
    : completions.filter((completion) => completion.label.toLocaleLowerCase().startsWith(query));
};

const typedReferenceToken = (input: DslAutocompleteDocumentInput, completionContext: DslCompletionContext): string | null =>
  completionContext && (
    completionContext.kind === "typedInitializer" ||
    completionContext.kind === "propertyScalarValue" ||
    completionContext.kind === "templateHole"
  )
    ? input.lineText.slice(completionContext.from, completionContext.to)
    : null;

const completionDocumentInput = (options: DslAutocompleteOptions, context: CompletionContext) => options.documentInput
  ? { input: options.documentInput(context), projection: null }
  : defaultDocumentInput(context);

const isTypedReferenceRetryContext = (options: DslAutocompleteOptions, view: Parameters<Command>[0]) => {
  const context = new CompletionContext(view.state, view.state.selection.main.head, false, view);
  const { input } = completionDocumentInput(options, context);
  if (!input) return false;
  const completionContext = dslCompletionContextAt(input.lineText, input.localPos);
  if (!completionContext || (
    completionContext.kind !== "typedInitializer" &&
    completionContext.kind !== "propertyScalarValue" &&
    completionContext.kind !== "templateHole"
  )) return false;
  if (!typedReferenceToken(input, completionContext)?.startsWith("@")) return false;
  return filteredTypedReferenceCompletions(
    typedReferenceCompletions(options, input, context, completionContext),
    input,
    completionContext
  ).length > 0;
};

/**
 * Whether the cursor is currently at an `ElementName.` position whose
 * candidates (computed from the *current* evaluation the caller already
 * confirmed is fresh) are non-empty. Used only by cmEvaluationFreshnessRetry
 * right after evaluation transitions from not-current to current, to decide
 * whether re-querying completion would actually surface something - never
 * called while evaluation is still not current (that decision belongs to
 * the caller, exactly like isTypedReferenceRetryContext above never
 * re-derives IME composition state itself).
 */
export const isElementParameterRetryContext = (options: DslAutocompleteOptions, view: Parameters<Command>[0]) => {
  const context = new CompletionContext(view.state, view.state.selection.main.head, false, view);
  const { input } = completionDocumentInput(options, context);
  if (!input) return false;
  const completionContext = dslCompletionContextAt(input.lineText, input.localPos);
  if (!completionContext || completionContext.kind !== "elementParameter") return false;
  if (!completionContext.elementToken.trim()) return false;
  return dslElementParameterCompletionOptions({
    source: input.source,
    cursorLine: input.cursorLineNumber,
    statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
    elements: options.elements(),
    elementToken: completionContext.elementToken,
    computedGeometry: options.computedGeometry() ?? new Map(),
    computedVariables: options.computedVariables(),
    effectiveEnabledElementIds: options.effectiveEnabledElementIds(),
    errors: options.evaluationErrors() ?? []
  }).length > 0;
};

export const createDslCompletionSource = (options: DslAutocompleteOptions): CompletionSource => (context) => {
  if (options.isComposing() || context.view?.compositionStarted) return null;
  const { input, projection } = completionDocumentInput(options, context);
  if (!input) return null;
  const completionContext = dslCompletionContextAt(input.lineText, input.localPos);
  if (!completionContext) return null;
  const referenceToken = typedReferenceToken(input, completionContext);
  // Ordinary typing at an empty typed expression must stay quiet. Explicit
  // completion still exposes literal/operator candidates there, while the
  // reference marker is the sole implicit trigger for typed binding options.
  if (!context.explicit && referenceToken !== null && !referenceToken.startsWith("@")) return null;

  let completions: Completion[];
  let preservesSharedReferenceRanking = false;
  let disablesCompletionFiltering = false;
  if (completionContext.kind === "keyword") {
    completions = completionContext.options.map((label) => ({ label, type: "keyword" }));
  } else if (completionContext.kind === "construction") {
    completions = constructionCompletionCandidates(completionContext.category)
      .map((candidate) => ({ ...candidate, type: "function" }));
  } else if (completionContext.kind === "argument") {
    completions = argumentCompletionCandidates(completionContext.spec, completionContext.usedArgumentNames)
      .map((candidate) => ({ ...candidate, type: "property" }));
  } else if (completionContext.kind === "elementParameter") {
    // Rust evaluation is asynchronous (useEvaluationEngine.ts): while it
    // hasn't caught up with the live document, computedGeometry/
    // effectiveEnabledElementIds can be stale or still in flight. Report no
    // candidates rather than guessing from stale data or re-evaluating
    // synchronously here - see elementParameterCandidateState. The
    // cmEvaluationFreshnessRetry extension re-queries once evaluation
    // becomes current, without requiring another keystroke.
    completions = (options.evaluationIsCurrent?.() ?? true)
      ? asElementParameterCompletions(dslElementParameterCompletionOptions({
        source: input.source,
        cursorLine: input.cursorLineNumber,
        statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
        elements: options.elements(),
        elementToken: completionContext.elementToken,
        computedGeometry: options.computedGeometry() ?? new Map(),
        computedVariables: options.computedVariables(),
        effectiveEnabledElementIds: options.effectiveEnabledElementIds(),
        errors: options.evaluationErrors() ?? []
      }))
      : [];
  } else if (completionContext.kind === "typedInitializer") {
    disablesCompletionFiltering = referenceToken?.startsWith("@") ?? false;
    completions = filteredTypedReferenceCompletions(
      typedReferenceCompletions(options, input, context, completionContext), input, completionContext
    );
  } else if (completionContext.kind === "propertyScalarValue") {
    disablesCompletionFiltering = referenceToken?.startsWith("@") ?? false;
    completions = filteredTypedReferenceCompletions(
      typedReferenceCompletions(options, input, context, completionContext), input, completionContext
    );
  } else if (completionContext.kind === "templateHole") {
    disablesCompletionFiltering = referenceToken?.startsWith("@") ?? false;
    completions = filteredTypedReferenceCompletions(
      typedReferenceCompletions(options, input, context, completionContext), input, completionContext
    );
  } else if (completionContext.kind === "setTarget") {
    const bindingAnalysis = options.bindingAnalysis();
    completions = bindingAnalysis
      ? asSetTargetCompletions(setTargetCandidates(setCompletionSiteDeps(options, bindingAnalysis, context.pos)))
      : [];
  } else if (completionContext.kind === "setRhs") {
    const bindingAnalysis = options.bindingAnalysis();
    const deps = bindingAnalysis ? setCompletionSiteDeps(options, bindingAnalysis, context.pos) : null;
    const target = deps ? setTargetCandidates(deps).find((candidate) => candidate.name === completionContext.targetName) : undefined;
    completions = deps && target
      ? asScalarCompletions(setRhsScalarCandidates(input.lineText, completionContext.expressionSpan, input.localPos, target.type, deps))
      : [];
  } else if (completionContext.parameter.definition.kind === "choice") {
    completions = (completionContext.parameter.definition.choiceOptions ?? []).map((label) => ({ label, type: "enum" }));
  } else if (completionContext.parameter.key === dslVarsAttributeParameterKey) {
    const statementElementIds = statementElementIdsByLiveLine(input.doc, options.statementRanges());
    completions = asVariableCompletions(dslLocalVariableCompletionOptions({
      lineText: input.lineText,
      pos: input.localPos,
      elementId: statementElementIds.get(input.cursorLineNumber),
      elements: options.elements()
    }));
  } else if (completionContext.parameter.key === dslIntermediatesAttributeParameterKey) {
    // intermediates=' angle/incoming/outgoing are evaluated with the element's
    // local vars= pool hardcoded to [] (verified in dslCompiler.ts) — bypass
    // the generic "number" branch below entirely so its local-vars union never
    // leaks in, and call the plain top-level source unmodified.
    completions = asVariableCompletions(dslVariableCompletionOptions({
      source: input.source,
      cursorLine: input.cursorLineNumber,
      statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
      elements: options.elements(),
      computedVariables: options.computedVariables()
    }));
  } else if (completionContext.parameter.source === "printLayoutBlock") {
    const parsed = parseDslSnapshot({ normalizedSource: input.source, sourceRevision: 0 });
    const block = dslEnclosingPrintLayoutLine(parsed, input.cursorLineNumber);
    if (!block) {
      completions = [];
    } else {
      const ownStatement = dslLinePrintLayoutStatement(input.lineText);
      const cutoffLine = ownStatement?.kind === "printLayout" ? Infinity : input.cursorLineNumber;
      const layoutVarOptions = dslPrintLayoutVariableCompletionOptions({
        parsed,
        block,
        cutoffLine,
        printLayoutIdsByLiveLine: printLayoutIdsByLiveLine(input.doc, options.printLayoutRanges()),
        printLayouts: options.printLayouts()
      });
      const topLevelOptions = dslVariableCompletionOptions({
        source: input.source,
        // Substituted to the block's own opening line: dslVariableCompletionOptions
        // resolves the live enclosing GROUP scope for its parentGroupId guard, and
        // a printLayout block is never itself inside a group's parentGroupId chain
        // in the elements sense — using the block's own line keeps that guard from
        // firing while still yielding every top-level var declared before the block.
        cursorLine: block.line,
        statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
        elements: options.elements(),
        computedVariables: options.computedVariables()
        // printLayout numeric expressions never pass currentElement to
        // evaluateNumericValue (verified in src/print/printLayout.ts), so
        // resolveVariableReference's group-scope branch is never reached —
        // only `scope: "global"` top-level vars can ever resolve here.
      }).filter((option) => option.source === "global");
      completions = asVariableCompletions([...layoutVarOptions, ...topLevelOptions]);
    }
  } else if (completionContext.parameter.definition.kind === "number") {
    const elements = options.elements();
    const statementElementIds = statementElementIdsByLiveLine(input.doc, options.statementRanges());
    const currentElement = currentLiveElement(input.source, context.pos, statementElementIds.get(input.cursorLineNumber), elements);
    const localOptions = currentElement
      ? localNumericVariableReferenceOptions({ element: currentElement, localVariableLimit: currentElement.numericVariables?.length ?? 0 })
      : [];
    const topLevelOptions = dslVariableCompletionOptions({
      source: input.source,
      cursorLine: input.cursorLineNumber,
      statementElementIds,
      elements,
      computedVariables: options.computedVariables()
    });
    completions = asVariableCompletions([...localOptions, ...topLevelOptions]);
  } else {
    const query = input.lineText.slice(completionContext.from, input.localPos);
    if (!query.trim()) return null;
    preservesSharedReferenceRanking = true;
    completions = dslReferenceCompletionOptions({
      source: input.source,
      cursorLine: input.cursorLineNumber,
      kind: completionContext.parameter.definition.kind,
      parameterKey: completionContext.parameter.key,
      query,
      replacementFrom: completionContext.from,
      statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
      elements: options.elements(),
      computedGeometry: options.computedGeometry(),
      forGroupGeneratedRows: options.forGroupGeneratedRows?.(),
      effectiveEnabledElementIds: options.effectiveEnabledElementIds(),
      errors: options.evaluationErrors()
    }).map((option) => ({
      label: option.displayLabel,
      apply: option.label,
      detail: option.detail,
      type: "variable"
    }));
  }
  if (completions.length === 0 && !context.explicit) return null;
  let from: number;
  let to: number;
  if (projection && completionContext.from === completionContext.to) {
    // physicalSpanForLogicalRange only ever emits non-empty segments (its
    // `to > from` filter is built for real content spans, e.g. P8's comment
    // re-attachment), so an empty cursor-point range — the common case right
    // after a trigger character with nothing typed yet — always comes back
    // with zero segments there. Project the single point instead.
    const point = logicalOffsetToPhysical(projection.map, projection.statement, completionContext.from);
    if (point === null) return null;
    from = point;
    to = point;
  } else if (projection) {
    // The candidates above were already computed against logical text/offsets,
    // so the replacement range must come back through that same source
    // map/statement — never physical `base + offset` arithmetic, which would
    // silently mix logical and physical coordinate spaces on a continuation
    // statement. A range that can't collapse to one contiguous physical
    // fragment (crosses a continuation boundary) is fail-closed: no completion.
    const span = physicalSpanForLogicalRange(projection.map, projection.statement, { start: completionContext.from, end: completionContext.to });
    if (!span || span.segments.length !== 1) return null;
    from = span.segments[0].from;
    to = span.segments[0].to;
  } else {
    const base = context.pos - input.localPos;
    from = base + completionContext.from;
    to = base + completionContext.to;
  }
  return {
    from,
    to,
    options: completions,
    ...(preservesSharedReferenceRanking || disablesCompletionFiltering
      ? { filter: false as const }
      : { validFor: /^[^\s#]*$/ })
  };
};

const guardedCompletionCommand = (isComposing: () => boolean, command: Command): Command =>
  (view) => {
    if (isComposing() || view.compositionStarted) return false;
    return command(view);
  };

/** Context and candidate generation stay CM-free for the Source Editor. */
export const dslAutocompleteExtension = (options: DslAutocompleteOptions): Extension[] => {
  const guarded = (command: Command) => guardedCompletionCommand(options.isComposing, command);
  const dismissCompletionForSpace = (view: Parameters<Command>[0]) => {
    if (options.isComposing() || view.compositionStarted) return false;
    // Deliberately do not consume Space: CodeMirror/the browser owns inserting
    // the one ordinary whitespace character after the completion is closed.
    closeCompletion(view);
    return false;
  };

  return [
    // Own the stock completion bindings so composition can always fall through
    // to CodeMirror/the IME. With an active popup Tab accepts (rather than
    // cycles) its current candidate; when no popup is open it returns false
    // and preserves Source Editor value-span/snippet navigation.
    autocompletion({ override: [createDslCompletionSource(options)], defaultKeymap: false }),
    cmCompositionCompletionRetry({
      isComposing: options.isComposing,
      isRetryContext: (view) => isTypedReferenceRetryContext(options, view)
    }),
    Prec.highest(keymap.of([
      { key: "Ctrl-Space", run: guarded(startCompletion) },
      { mac: "Alt-`", run: guarded(startCompletion) },
      { mac: "Alt-i", run: guarded(startCompletion) },
      { key: "Escape", run: guarded(closeCompletion) },
      { key: "ArrowDown", run: guarded(moveCompletionSelection(true)) },
      { key: "ArrowUp", run: guarded(moveCompletionSelection(false)) },
      { key: "PageDown", run: guarded(moveCompletionSelection(true, "page")) },
      { key: "PageUp", run: guarded(moveCompletionSelection(false, "page")) },
      { key: "Enter", run: guarded(acceptCompletion) },
      { key: "Tab", run: guarded(acceptCompletion) },
      { key: "Space", run: dismissCompletionForSpace },
      { key: "Space", shift: dismissCompletionForSpace }
    ]))
  ];
};
