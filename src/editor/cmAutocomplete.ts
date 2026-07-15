import { autocompletion, completionKeymap, type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension, Text } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { dslCompletionContextAt, dslIntermediatesAttributeParameterKey, dslVarsAttributeParameterKey } from "../dsl/dslCompletionContext";
import { dslCompletionMetadataForType, dslStatementElementType } from "../dsl/dslCompletionMetadata";
import { dslReferenceCompletionOptions } from "../dsl/dslCompletionCandidates";
import { dslVariableCompletionOptions } from "../dsl/dslVariableCompletionCandidates";
import { dslLocalVariableCompletionOptions } from "../dsl/dslLocalVariableCompletionCandidates";
import { dslEnclosingPrintLayoutLine, dslPrintLayoutVariableCompletionOptions } from "../dsl/dslPrintLayoutVariableCompletionCandidates";
import { dslElementParameterCompletionOptions } from "../dsl/dslElementParameterCompletionCandidates";
import { dslLineElementStatement, dslLinePrintLayoutStatement } from "../dsl/dslValueSpans";
import { parseDsl } from "../dsl/dslParser";
import { localNumericVariableReferenceOptions, type NumericVariableReferenceOption } from "../geometry/variableReferenceOptions";
import type { ElementParameterReferenceOption } from "../geometry/elementParameterReferenceOptions";
import type { CadElement, ComputedGeometry, ComputedVariable, DependencyError, ElementId, PrintLayout } from "../types/geometry";
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
  effectiveEnabledElementIds: () => Set<ElementId> | undefined;
  evaluationErrors: () => DependencyError[] | undefined;
  /** Defaults to deriving everything from the CompletionContext's own state (Main
   * Editor). Line Lens supplies its mirrored line's live text against the REAL
   * document's line number/source, since candidate generation needs real
   * statement identity, not the lens's own 1-line buffer coordinates. */
  documentInput?: (context: CompletionContext) => DslAutocompleteDocumentInput | null;
};

const defaultDocumentInput = (context: CompletionContext): DslAutocompleteDocumentInput => {
  const line = context.state.doc.lineAt(context.pos);
  return {
    source: context.state.doc.toString(),
    cursorLineNumber: line.number,
    lineText: line.text,
    localPos: context.pos - line.from,
    doc: context.state.doc
  };
};

const statementElementIdsByLiveLine = (doc: Text, ranges: StatementRangeIndex) => {
  const result = new Map<number, ElementId>();
  for (const range of ranges.values()) {
    const line = doc.lineAt(range.from);
    if (line.from === range.from) result.set(line.number, range.elementId);
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
const currentLiveElement = (lineText: string, elementId: ElementId | undefined, elements: readonly CadElement[]) => {
  if (!elementId) return undefined;
  const statement = dslLineElementStatement(lineText);
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
  const input = (options.documentInput ?? defaultDocumentInput)(context);
  if (!input) return null;
  const completionContext = dslCompletionContextAt(input.lineText, input.localPos);
  if (!completionContext) return null;

  let completions: Completion[];
  if (completionContext.kind === "keyword") {
    completions = completionContext.options.map((label) => ({ label, type: "keyword" }));
  } else if (completionContext.kind === "attribute") {
    completions = dslCompletionMetadataForType(completionContext.elementType).attributes
      .map((parameter) => parameter.key)
      .filter((key, index, all) => all.indexOf(key) === index)
      .map((key) => ({ label: key, apply: `${key}=`, type: "property" }));
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
    const parsed = parseDsl(input.source);
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
    const currentElement = currentLiveElement(input.lineText, statementElementIds.get(input.cursorLineNumber), elements);
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
    completions = dslReferenceCompletionOptions({
      source: input.source,
      cursorLine: input.cursorLineNumber,
      kind: completionContext.parameter.definition.kind,
      statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
      elements: options.elements()
    }).map((option) => ({ label: option.label, detail: option.detail, type: "variable" }));
  }
  if (completions.length === 0 && !context.explicit) return null;
  const base = context.pos - input.localPos;
  return {
    from: base + completionContext.from,
    to: base + completionContext.to,
    options: completions,
    validFor: /^[^\s#]*$/
  };
};

/** Context and candidate generation stay CM-free; shared verbatim by the Main
 * Editor and Line Lens via `documentInput`. */
export const dslAutocompleteExtension = (options: DslAutocompleteOptions): Extension[] => [
  autocompletion({ override: [createDslCompletionSource(options)] }),
  keymap.of(completionKeymap)
];
