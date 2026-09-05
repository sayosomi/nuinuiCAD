import type { CompiledDslDocument } from "./dslDocument";
import { createModifierAuthoringIndex } from "./dslModifierAuthoringIndex";
import { resolveModifierValueStep } from "./dslModifierAuthoring";
import {
  physicalSpanForLogicalRange,
  physicalToLogicalOffset,
  type DslPhysicalSegment,
  type SourceRevision,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
import { resolveDslValueStep, type DslValueStepDirection } from "./dslValueStep";
import {
  resolveTypedValueStep,
  typedValueStepTargetForBinding,
  typedValueStepTargetForStatement
} from "./dslTypedValueStep";
import type { DslSpan, DslStatement } from "./dslTypes";

export type DslSourceValueStepSemanticSnapshot = {
  sourceRevision: SourceRevision;
  sourceText?: string;
  compiled?: CompiledDslDocument;
};

export type DslSourceValueStepQueryInput = {
  source: SourceSnapshot;
  semantic?: DslSourceValueStepSemanticSnapshot;
  selections: readonly DslSpan[];
  direction: DslValueStepDirection;
};

export type DslSourceValueStepPlan = {
  sourceRevision: SourceRevision;
  edit: { from: number; to: number; expectedText: string; newText: string };
  selection: DslSpan;
};

const semanticSourceText = (semantic: DslSourceValueStepSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const exactSemantic = (
  source: SourceSnapshot,
  semantic: DslSourceValueStepSemanticSnapshot | undefined
): semantic is DslSourceValueStepSemanticSnapshot & { compiled: CompiledDslDocument } => Boolean(
  semantic?.compiled &&
  semantic.sourceRevision === source.sourceRevision &&
  semanticSourceText(semantic) === source.normalizedSource
);

const singleSegment = (segments: readonly DslPhysicalSegment[]): DslPhysicalSegment | null =>
  segments.length === 1 ? segments[0] ?? null : null;

const containsSelection = (range: DslPhysicalSegment, selection: DslSpan) =>
  selection.start === selection.end
    ? selection.start >= range.from && selection.start <= range.to
    : selection.start === range.from && selection.end === range.to;

const statementContainsSelection = (
  segments: readonly DslPhysicalSegment[],
  selection: DslSpan
) => segments.some((segment) =>
  selection.start >= segment.from && selection.end <= segment.to
);

const planFor = (
  source: SourceSnapshot,
  range: DslPhysicalSegment,
  newText: string
): DslSourceValueStepPlan | null => {
  const expectedText = source.normalizedSource.slice(range.from, range.to);
  if (expectedText === newText) return null;
  return {
    sourceRevision: source.sourceRevision,
    edit: { ...range, expectedText, newText },
    selection: { start: range.from, end: range.from + newText.length }
  };
};

const logicalSelectionFor = (
  compiled: CompiledDslDocument,
  statement: DslStatement,
  selection: DslSpan
): DslSpan | null => {
  const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  if (!logical) return null;
  const start = physicalToLogicalOffset(compiled.spans.sourceMap, logical, selection.start);
  const end = physicalToLogicalOffset(compiled.spans.sourceMap, logical, selection.end);
  return start === null || end === null ? null : { start, end };
};

const physicalEditRange = (
  compiled: CompiledDslDocument,
  statement: DslStatement,
  span: DslSpan
): DslPhysicalSegment | null => {
  const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  if (!logical) return null;
  const physical = physicalSpanForLogicalRange(compiled.spans.sourceMap, logical, span);
  return physical ? singleSegment(physical.segments) : null;
};

const typedPlan = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument,
  statement: DslStatement,
  statementIndex: number,
  selection: DslSpan,
  direction: DslValueStepDirection
): DslSourceValueStepPlan | null => {
  if (statement.kind !== "typedDeclaration" && statement.kind !== "set") return null;
  const valueSpan = statement.payloadSpans[statement.kind === "typedDeclaration" ? "initializer" : "expression"];
  if (!valueSpan) return null;
  const logicalSelection = logicalSelectionFor(compiled, statement, selection);
  if (!logicalSelection) return null;
  const target = statement.kind === "typedDeclaration"
    ? typedValueStepTargetForStatement(compiled, statementIndex)
    : (() => {
        const bindingId = compiled.setStatements?.get(statementIndex)?.targetBindingId;
        return bindingId ? typedValueStepTargetForBinding(compiled, bindingId) : null;
      })();
  if (!target) return null;
  const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  if (!logical) return null;
  const value = logical.logicalText.slice(valueSpan.start, valueSpan.end);
  const change = resolveTypedValueStep(
    value,
    target.declaredType,
    { from: valueSpan.start, to: valueSpan.end },
    logicalSelection,
    direction,
    target.options
  );
  if (!change) return null;
  const range = physicalEditRange(compiled, statement, { start: change.from, end: change.to });
  return range ? planFor(source, range, change.insert) : null;
};

const elementPlan = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument,
  statement: DslStatement,
  statementIndex: number,
  selection: DslSpan,
  direction: DslValueStepDirection
): DslSourceValueStepPlan | null => {
  if (statement.kind !== "element") return null;
  const element = compiled.sourceElementsByStatementIndex.get(statementIndex);
  if (!element) return null;
  const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  const logicalSelection = logicalSelectionFor(compiled, statement, selection);
  if (!logical || !logicalSelection) return null;
  const change = resolveDslValueStep(logical.logicalText, element, logicalSelection, direction);
  if (!change) return null;
  const range = physicalEditRange(compiled, statement, { start: change.from, end: change.to });
  return range ? planFor(source, range, change.insert) : null;
};

/** Exact-current host-neutral Source Value Step query. It never mutates source. */
export const queryDslSourceValueStep = ({
  source,
  semantic,
  selections,
  direction
}: DslSourceValueStepQueryInput): DslSourceValueStepPlan | null => {
  if (!exactSemantic(source, semantic) || selections.length !== 1) return null;
  const selection = selections[0]!;
  if (
    selection.start < 0 || selection.end < selection.start ||
    selection.end > source.normalizedSource.length
  ) return null;
  const compiled = semantic.compiled;

  const modifierIndex = createModifierAuthoringIndex(compiled);
  for (const property of modifierIndex.properties) {
    for (const token of property.tokens) {
      if (!containsSelection(token.range, selection)) continue;
      const value = source.normalizedSource.slice(token.range.from, token.range.to);
      const change = resolveModifierValueStep(property.key, token.kind, value, direction);
      return change ? planFor(source, token.range, change.insert) : null;
    }
  }

  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (!statementContainsSelection(statement.physicalSpan.segments, selection)) continue;
    return typedPlan(source, compiled, statement, statementIndex, selection, direction) ??
      elementPlan(source, compiled, statement, statementIndex, selection, direction);
  }
  return null;
};
