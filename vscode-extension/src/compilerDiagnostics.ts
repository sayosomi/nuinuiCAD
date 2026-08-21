import type { AutomationDocumentState } from "../../src/document/automationDocument";
import type { DslDiagnostic } from "../../src/dsl/dslTypes";

export type CompilerDiagnosticPosition = {
  line: number;
  character: number;
};

export type CompilerDiagnosticRange = {
  start: CompilerDiagnosticPosition;
  end: CompilerDiagnosticPosition;
};

export type CompilerDiagnosticRelatedInformation = {
  message: string;
  range: CompilerDiagnosticRange;
};

export type CompilerDiagnostic = {
  severity: DslDiagnostic["severity"];
  message: string;
  range: CompilerDiagnosticRange;
  relatedInformation?: readonly CompilerDiagnosticRelatedInformation[];
  code?: string;
  source: "nuinuiCAD";
};

type LineIndex = {
  starts: readonly number[];
  ends: readonly number[];
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const lineIndexFor = (normalizedSource: string): LineIndex => {
  const starts = [0];
  const ends: number[] = [];
  for (let index = 0; index < normalizedSource.length; index += 1) {
    if (normalizedSource[index] !== "\n") continue;
    ends.push(index);
    starts.push(index + 1);
  }
  ends.push(normalizedSource.length);
  return { starts, ends };
};

const positionAt = (index: LineIndex, offset: number): CompilerDiagnosticPosition | null => {
  if (!Number.isInteger(offset) || offset < 0 || offset > index.ends.at(-1)!) return null;

  let low = 0;
  let high = index.starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (index.starts[middle]! > offset) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  const line = Math.max(0, high);
  return { line, character: offset - index.starts[line]! };
};

const rangeForSegment = (
  index: LineIndex,
  normalizedSource: string,
  segment: { from: number; to: number }
): CompilerDiagnosticRange | null => {
  if (
    !Number.isInteger(segment.from) ||
    !Number.isInteger(segment.to) ||
    segment.from < 0 ||
    segment.to < segment.from ||
    segment.to > normalizedSource.length
  ) return null;
  const start = positionAt(index, segment.from);
  const end = positionAt(index, segment.to);
  return start && end ? { start, end } : null;
};

const rangeForPhysicalSpan = (
  index: LineIndex,
  normalizedSource: string,
  physicalSpan: NonNullable<DslDiagnostic["physicalSpan"]>
): CompilerDiagnosticRange | null => {
  for (const segment of physicalSpan.segments) {
    const range = rangeForSegment(index, normalizedSource, segment);
    if (range) return range;
  }
  return null;
};

const rangeForLegacyPosition = (
  index: LineIndex,
  line: number,
  column: number
): CompilerDiagnosticRange | null => {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
  const lineIndex = line - 1;
  const lineStart = index.starts[lineIndex];
  const lineEnd = index.ends[lineIndex];
  if (lineStart === undefined || lineEnd === undefined) return null;

  const from = lineStart + column - 1;
  if (from < lineStart || from > lineEnd) return null;
  const to = Math.min(from + 1, lineEnd);
  const start = positionAt(index, from);
  const end = positionAt(index, to);
  return start && end ? { start, end } : null;
};

export const toCompilerDiagnostic = (
  sourceText: string,
  diagnostic: DslDiagnostic
): CompilerDiagnostic | null => {
  const normalizedSource = normalizedSourceFor(sourceText);
  const index = lineIndexFor(normalizedSource);
  const segments = diagnostic.physicalSpan?.segments ?? [];
  let range: CompilerDiagnosticRange | null = null;

  if (segments.length === 1) range = rangeForSegment(index, normalizedSource, segments[0]!);
  if (!range && diagnostic.exactSpanOnly) {
    for (const segment of segments) {
      range = rangeForSegment(index, normalizedSource, segment);
      if (range) break;
    }
    if (!range) return null;
  }
  if (!range) range = rangeForLegacyPosition(index, diagnostic.line, diagnostic.column);
  if (!range) return null;

  const relatedInformation = (diagnostic.relatedInformation ?? [])
    .map((related) => {
      const relatedRange = rangeForPhysicalSpan(index, normalizedSource, related.physicalSpan);
      return relatedRange ? { message: related.message, range: relatedRange } : null;
    })
    .filter((related): related is CompilerDiagnosticRelatedInformation => related !== null);

  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    range,
    ...(relatedInformation.length === 0 ? {} : { relatedInformation }),
    ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
    source: "nuinuiCAD"
  };
};

export const compilerDiagnosticsFor = (
  sourceText: string,
  diagnostics: readonly DslDiagnostic[],
  bindingIssueDiagnostics: readonly DslDiagnostic[]
): CompilerDiagnostic[] =>
  [...diagnostics, ...bindingIssueDiagnostics]
    .map((diagnostic) => toCompilerDiagnostic(sourceText, diagnostic))
    .filter((diagnostic): diagnostic is CompilerDiagnostic => diagnostic !== null);

export const compilerDiagnosticsForState = (
  sourceText: string,
  state: Pick<AutomationDocumentState, "diagnostics" | "bindingIssueDiagnostics">
): CompilerDiagnostic[] => compilerDiagnosticsFor(sourceText, state.diagnostics, state.bindingIssueDiagnostics);
