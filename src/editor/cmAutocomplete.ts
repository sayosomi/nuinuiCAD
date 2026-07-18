import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  moveCompletionSelection,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionSource
} from "@codemirror/autocomplete";
import { Prec, type Extension, type Text } from "@codemirror/state";
import { keymap, type Command } from "@codemirror/view";
import { dslCompletionContextAt, dslIntermediatesAttributeParameterKey, dslVarsAttributeParameterKey } from "../dsl/dslCompletionContext";
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
import type { PrintLayoutRangeIndex, StatementRangeIndex } from "./statementRangeIndex";

export type DslAutocompleteDocumentInput = {
  source: string;
  cursorLineNumber: number;
  lineText: string;
  localPos: number;
  doc: Text;
};

type DslAutocompleteOptions = {
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

export const createDslCompletionSource = (options: DslAutocompleteOptions): CompletionSource => (context) => {
  if (options.isComposing() || context.view?.compositionStarted) return null;
  const { input, projection } = options.documentInput
    ? { input: options.documentInput(context), projection: null }
    : defaultDocumentInput(context);
  if (!input) return null;
  const completionContext = dslCompletionContextAt(input.lineText, input.localPos);
  if (!completionContext) return null;

  let completions: Completion[];
  let preservesSharedReferenceRanking = false;
  if (completionContext.kind === "keyword") {
    completions = completionContext.options.map((label) => ({ label, type: "keyword" }));
  } else if (completionContext.kind === "construction") {
    completions = constructionCompletionCandidates(completionContext.category)
      .map((candidate) => ({ ...candidate, type: "function" }));
  } else if (completionContext.kind === "argument") {
    completions = argumentCompletionCandidates(completionContext.spec, completionContext.usedArgumentNames)
      .map((candidate) => ({ ...candidate, type: "property" }));
  } else if (completionContext.kind === "elementParameter") {
    completions = asElementParameterCompletions(dslElementParameterCompletionOptions({
      source: input.source,
      cursorLine: input.cursorLineNumber,
      statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
      elements: options.elements(),
      elementToken: completionContext.elementToken,
      computedGeometry: options.computedGeometry() ?? new Map(),
      computedVariables: options.computedVariables(),
      effectiveEnabledElementIds: options.effectiveEnabledElementIds(),
      errors: options.evaluationErrors() ?? []
    }));
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
    ...(preservesSharedReferenceRanking
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
