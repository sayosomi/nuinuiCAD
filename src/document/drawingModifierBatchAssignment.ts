import { formatDslName, scanDslSource } from "../dsl/dslTokens";
import type { DslPhysicalSpan, SourceRevision, SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type { DslStatement, ParseDslResult } from "../dsl/dslTypes";
import type { LineSplice } from "./textPatch";

export type DrawingModifierSourceTarget = {
  readonly sourceStatementIndex: number;
  readonly sourceRevision: SourceRevision;
};

export type DrawingModifierBatchOperation =
  | { readonly kind: "add"; readonly modifierName: string }
  | { readonly kind: "remove"; readonly modifierName: string };

export type DrawingModifierTargetEligibility =
  | { readonly eligible: true }
  | {
      readonly eligible: false;
      readonly reason: "unsupported-statement-kind" | "unnamed-target";
    };

export type DrawingModifierBatchPlanInput = {
  readonly source: SourceSnapshot;
  readonly parsed: ParseDslResult;
  readonly targets: readonly DrawingModifierSourceTarget[];
  readonly operation: DrawingModifierBatchOperation;
};

export type DrawingModifierBatchPlan = {
  readonly splices: readonly LineSplice[];
  readonly targetCount: number;
  readonly changedTargetCount: number;
};

export type DrawingModifierBatchPlanFailureReason =
  | "invalid-source-snapshot"
  | "stale-target"
  | "ineligible-target"
  | "modifier-undefined"
  | "modifier-ambiguous"
  | "unsafe-source-edit";

export type DrawingModifierBatchPlanResult =
  | { readonly ok: true; readonly plan: DrawingModifierBatchPlan }
  | {
      readonly ok: false;
      readonly reason: DrawingModifierBatchPlanFailureReason;
      readonly target?: DrawingModifierSourceTarget;
    };

type ExactSourceEdit = {
  readonly from: number;
  readonly to: number;
  readonly text: string;
};

type PhysicalRange = { readonly from: number; readonly to: number };

type ModifierBracketRange = {
  readonly open: number;
  readonly close: number;
};

export const analyzeDrawingModifierAssignmentTarget = (
  statement: DslStatement
): DrawingModifierTargetEligibility => {
  if (statement.kind !== "element" && statement.kind !== "group") {
    return { eligible: false, reason: "unsupported-statement-kind" };
  }
  if (!statement.name) return { eligible: false, reason: "unnamed-target" };
  return { eligible: true };
};

const safeSingleSegment = (
  source: SourceSnapshot,
  span: DslPhysicalSpan | null | undefined
): PhysicalRange | null => {
  if (!span || span.sourceRevision !== source.sourceRevision || span.segments.length !== 1) return null;
  const segment = span.segments[0];
  if (
    !Number.isInteger(segment.from) ||
    !Number.isInteger(segment.to) ||
    segment.from < 0 ||
    segment.to < segment.from ||
    segment.to > source.normalizedSource.length
  ) return null;
  return segment;
};

const codeMaskFor = (source: string): string =>
  scanDslSource(source).lines.map((line) => line.code).join("\n");

const findModifierBrackets = (
  codeMask: string,
  statement: DslStatement,
  headEnd: number
): ModifierBracketRange | null => {
  let quote: string | null = null;
  let open = -1;
  for (let index = headEnd; index < statement.documentRange.to; index += 1) {
    const char = codeMask[index];
    if (!char) continue;
    if ((char === "\"" || char === "'") && codeMask[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (quote) continue;
    if (open < 0) {
      if (char === "[") {
        open = index;
        continue;
      }
      if (char === "=" || char === "{") return null;
      continue;
    }
    if (char === "]") return { open, close: index };
  }
  return null;
};

const firstCommaBetween = (codeMask: string, from: number, to: number): number | null => {
  for (let index = from; index < to; index += 1) if (codeMask[index] === ",") return index;
  return null;
};

const lastCommaBetween = (codeMask: string, from: number, to: number): number | null => {
  for (let index = to - 1; index >= from; index -= 1) if (codeMask[index] === ",") return index;
  return null;
};

const commaPositionsBetween = (codeMask: string, from: number, to: number): number[] => {
  const positions: number[] = [];
  for (let index = from; index < to; index += 1) if (codeMask[index] === ",") positions.push(index);
  return positions;
};

const topLevelModifierDefinitionCount = (
  statements: readonly DslStatement[],
  modifierName: string
): number => {
  let depth = 0;
  let count = 0;
  for (const statement of statements) {
    if (statement.kind === "blockEnd") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (statement.kind === "modifierDefinition" && depth === 0 && statement.name === modifierName) count += 1;
    if (statement.opensBlock && statement.kind !== "blockElse") depth += 1;
  }
  return count;
};

const statementHeadRange = (
  source: SourceSnapshot,
  statement: DslStatement
): PhysicalRange | null => {
  if (statement.name) {
    const name = safeSingleSegment(source, statement.namePhysicalSpan);
    if (name) return name;
  }
  return safeSingleSegment(source, statement.keywordPhysicalSpan);
};

const modifierNameRanges = (
  source: SourceSnapshot,
  statement: DslStatement
): readonly PhysicalRange[] | null => {
  const names = statement.modifierNames ?? [];
  const spans = statement.modifierNamePhysicalSpans ?? [];
  if (names.length !== spans.length) return null;
  const ranges: PhysicalRange[] = [];
  for (const span of spans) {
    const range = safeSingleSegment(source, span);
    if (!range) return null;
    ranges.push(range);
  }
  return ranges;
};

const addEditsForStatement = (
  source: SourceSnapshot,
  codeMask: string,
  statement: DslStatement,
  modifierName: string
): readonly ExactSourceEdit[] | null => {
  if (statement.modifierNames?.includes(modifierName)) return [];
  const head = statementHeadRange(source, statement);
  if (!head) return null;
  const formatted = formatDslName(modifierName);
  const brackets = findModifierBrackets(codeMask, statement, head.to);

  if (!brackets) {
    if ((statement.modifierNames?.length ?? 0) !== 0) return null;
    return [{ from: head.to, to: head.to, text: ` [${formatted}]` }];
  }

  const ranges = modifierNameRanges(source, statement);
  if (!ranges) return null;
  if (ranges.length === 0) return [{ from: brackets.close, to: brackets.close, text: formatted }];
  const last = ranges[ranges.length - 1];
  return [{ from: last.to, to: last.to, text: `, ${formatted}` }];
};

const removeEditsForStatement = (
  source: SourceSnapshot,
  codeMask: string,
  statement: DslStatement,
  modifierName: string
): readonly ExactSourceEdit[] | null => {
  const names = statement.modifierNames;
  if (!names?.includes(modifierName)) return [];
  const ranges = modifierNameRanges(source, statement);
  const head = statementHeadRange(source, statement);
  if (!ranges || !head || ranges.length !== names.length) return null;
  const brackets = findModifierBrackets(codeMask, statement, head.to);
  if (!brackets) return null;

  const remove = names.map((name) => name === modifierName);
  const edits: ExactSourceEdit[] = [];
  for (let index = 0; index < ranges.length; index += 1) {
    if (remove[index]) edits.push({ from: ranges[index].from, to: ranges[index].to, text: "" });
  }

  if (remove.every(Boolean)) {
    for (const comma of commaPositionsBetween(codeMask, brackets.open + 1, brackets.close)) {
      edits.push({ from: comma, to: comma + 1, text: "" });
    }
    return edits;
  }

  let index = 0;
  while (index < remove.length) {
    if (!remove[index]) {
      index += 1;
      continue;
    }
    const runStart = index;
    while (index < remove.length && remove[index]) index += 1;
    const runEnd = index;

    if (runEnd < remove.length) {
      for (let removed = runStart; removed < runEnd; removed += 1) {
        const comma = firstCommaBetween(codeMask, ranges[removed].to, ranges[removed + 1].from);
        if (comma === null) return null;
        edits.push({ from: comma, to: comma + 1, text: "" });
      }
      continue;
    }

    if (runStart === 0) return null;
    const leadingComma = lastCommaBetween(codeMask, ranges[runStart - 1].to, ranges[runStart].from);
    if (leadingComma === null) return null;
    edits.push({ from: leadingComma, to: leadingComma + 1, text: "" });
    for (let removed = runStart; removed < runEnd - 1; removed += 1) {
      const comma = firstCommaBetween(codeMask, ranges[removed].to, ranges[removed + 1].from);
      if (comma === null) return null;
      edits.push({ from: comma, to: comma + 1, text: "" });
    }
  }

  return edits;
};

const lineStartsFor = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === "\n") starts.push(index + 1);
  return starts;
};

const lineIndexAt = (starts: readonly number[], offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle; else high = middle - 1;
  }
  return low;
};

const exactEditsToLineSplices = (
  source: string,
  edits: readonly ExactSourceEdit[]
): readonly LineSplice[] | null => {
  const ordered = [...edits].sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 0; index < ordered.length; index += 1) {
    const edit = ordered[index];
    if (
      !Number.isInteger(edit.from) ||
      !Number.isInteger(edit.to) ||
      edit.from < 0 ||
      edit.to < edit.from ||
      edit.to > source.length
    ) return null;
    if (index > 0 && edit.from < ordered[index - 1].to) return null;
  }

  const starts = lineStartsFor(source);
  const lines = source.split("\n");
  const byLine = new Map<number, ExactSourceEdit[]>();
  for (const edit of ordered) {
    const fromLine = lineIndexAt(starts, edit.from);
    const toLine = edit.to > edit.from ? lineIndexAt(starts, edit.to - 1) : fromLine;
    if (fromLine !== toLine) return null;
    const list = byLine.get(fromLine) ?? [];
    list.push(edit);
    byLine.set(fromLine, list);
  }

  const splices: LineSplice[] = [];
  for (const lineIndex of [...byLine.keys()].sort((left, right) => left - right)) {
    let replacement = lines[lineIndex];
    const lineStart = starts[lineIndex];
    for (const edit of [...byLine.get(lineIndex)!].sort((left, right) => right.from - left.from || right.to - left.to)) {
      const localFrom = edit.from - lineStart;
      const localTo = edit.to - lineStart;
      replacement = `${replacement.slice(0, localFrom)}${edit.text}${replacement.slice(localTo)}`;
    }
    splices.push({ startLine: lineIndex + 1, endLine: lineIndex + 1, replacementLines: [replacement] });
  }
  return splices;
};

const sourceSnapshotMatchesParse = (source: SourceSnapshot, parsed: ParseDslResult): boolean =>
  !source.normalizedSource.includes("\r") &&
  parsed.sourceRevision === source.sourceRevision &&
  parsed.sourceMap.sourceRevision === source.sourceRevision &&
  parsed.sourceMap.source === source.normalizedSource;

export const planDrawingModifierBatchAssignment = (
  input: DrawingModifierBatchPlanInput
): DrawingModifierBatchPlanResult => {
  const { source, parsed, operation } = input;
  if (!sourceSnapshotMatchesParse(source, parsed)) return { ok: false, reason: "invalid-source-snapshot" };

  if (operation.kind === "add") {
    const definitionCount = topLevelModifierDefinitionCount(parsed.statements, operation.modifierName);
    if (definitionCount === 0) return { ok: false, reason: "modifier-undefined" };
    if (definitionCount > 1) return { ok: false, reason: "modifier-ambiguous" };
  }

  const targets: DrawingModifierSourceTarget[] = [];
  const seen = new Set<string>();
  for (const target of input.targets) {
    if (target.sourceRevision !== source.sourceRevision) return { ok: false, reason: "stale-target", target };
    const key = `${target.sourceRevision}:${target.sourceStatementIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }

  const codeMask = codeMaskFor(source.normalizedSource);
  const edits: ExactSourceEdit[] = [];
  let changedTargetCount = 0;
  for (const target of targets) {
    const statement = parsed.statements[target.sourceStatementIndex];
    if (!statement || statement.sourceRevision !== source.sourceRevision) {
      return { ok: false, reason: "stale-target", target };
    }
    if (!analyzeDrawingModifierAssignmentTarget(statement).eligible) {
      return { ok: false, reason: "ineligible-target", target };
    }
    const statementEdits = operation.kind === "add"
      ? addEditsForStatement(source, codeMask, statement, operation.modifierName)
      : removeEditsForStatement(source, codeMask, statement, operation.modifierName);
    if (!statementEdits) return { ok: false, reason: "unsafe-source-edit", target };
    if (statementEdits.length > 0) changedTargetCount += 1;
    edits.push(...statementEdits);
  }

  const splices = exactEditsToLineSplices(source.normalizedSource, edits);
  if (!splices) return { ok: false, reason: "unsafe-source-edit" };
  return {
    ok: true,
    plan: {
      splices,
      targetCount: targets.length,
      changedTargetCount
    }
  };
};

export const applyDrawingModifierBatchAssignment = (
  input: DrawingModifierBatchPlanInput,
  commitLineSplices: (splices: readonly LineSplice[]) => void
): DrawingModifierBatchPlanResult => {
  const result = planDrawingModifierBatchAssignment(input);
  if (result.ok && result.plan.splices.length > 0) commitLineSplices(result.plan.splices);
  return result;
};
