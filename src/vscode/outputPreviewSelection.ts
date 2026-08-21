import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";
import type { PrintOutput, SvgOutput } from "../types/geometry";

export type OutputPreviewCandidate = {
  key: string;
  kind: "print" | "svg";
  output: PrintOutput | SvgOutput;
  sourceRange: NormalizedSourceRange;
  statementIndex: number;
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const lineStartsFor = (sourceText: string): number[] => {
  const starts = [0];
  for (const match of sourceText.matchAll(/\n/g)) starts.push((match.index ?? 0) + 1);
  return starts;
};

const sourceRangeForStatement = (
  sourceText: string,
  statement: { range: { startLine: number; endLine: number } }
): NormalizedSourceRange | null => {
  const normalizedSource = normalizedSourceFor(sourceText);
  const starts = lineStartsFor(normalizedSource);
  const startLine = statement.range.startLine - 1;
  const endLine = statement.range.endLine - 1;
  if (startLine < 0 || endLine < startLine || startLine >= starts.length || endLine >= starts.length) return null;
  const from = starts[startLine];
  const nextLineStart = starts[endLine + 1];
  const to = nextLineStart === undefined ? normalizedSource.length : nextLineStart - 1;
  return to > from ? { from, to } : null;
};

const candidateFrom = (
  sourceText: string,
  kind: "print" | "svg",
  output: PrintOutput | SvgOutput,
  compiled: CompiledDslDocument
): OutputPreviewCandidate | null => {
  const statement = compiled.statementMap?.byKey.get(`${kind}:${output.id}`);
  if (!statement) return null;
  const sourceRange = sourceRangeForStatement(sourceText, statement);
  if (!sourceRange) return null;
  return {
    key: `${kind}:${output.id}`,
    kind,
    output,
    sourceRange,
    statementIndex: statement.statementIndex
  };
};

/**
 * Returns only current compiled print/svg declarations in source order. The
 * StatementMap is the source ownership boundary; this helper never reparses
 * declarations from source text.
 */
export const outputPreviewCandidatesFor = (
  sourceText: string,
  compiled: CompiledDslDocument
): OutputPreviewCandidate[] => {
  if (!compiled.document || !compiled.statementMap) return [];
  return [
    ...compiled.document.printOutputs.flatMap((output) => {
      const candidate = candidateFrom(sourceText, "print", output, compiled);
      return candidate ? [candidate] : [];
    }),
    ...compiled.document.svgOutputs.flatMap((output) => {
      const candidate = candidateFrom(sourceText, "svg", output, compiled);
      return candidate ? [candidate] : [];
    })
  ].sort((left, right) => left.statementIndex - right.statementIndex);
};

const cursorIsInside = (cursor: number, range: NormalizedSourceRange): boolean =>
  Number.isInteger(cursor) && range.from <= cursor && cursor <= range.to;

export const selectOutputPreviewCandidate = ({
  candidates,
  cursorOffset,
  existingKey
}: {
  candidates: readonly OutputPreviewCandidate[];
  cursorOffset: number;
  existingKey: string | null;
}): OutputPreviewCandidate | null => {
  const printAtCursor = candidates.find((candidate) =>
    candidate.kind === "print" && cursorIsInside(cursorOffset, candidate.sourceRange)
  );
  if (printAtCursor) return printAtCursor;
  const svgAtCursor = candidates.find((candidate) =>
    candidate.kind === "svg" && cursorIsInside(cursorOffset, candidate.sourceRange)
  );
  if (svgAtCursor) return svgAtCursor;
  const existing = candidates.find((candidate) => candidate.key === existingKey);
  return existing ?? candidates[0] ?? null;
};

export const outputPreviewCandidateForKey = (
  candidates: readonly OutputPreviewCandidate[],
  key: string | null
): OutputPreviewCandidate | null => candidates.find((candidate) => candidate.key === key) ?? null;
