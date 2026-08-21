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

const sourceRangeForStatement = (
  sourceText: string,
  statement: { statementIndex: number },
  compiled: CompiledDslDocument
): NormalizedSourceRange | null => {
  const normalizedSource = normalizedSourceFor(sourceText);
  const sourceMap = compiled.spans.sourceMap;
  if (sourceMap.source !== normalizedSource) return null;
  // StatementMap indexes semantic statements. The source-map projection also
  // contains blank/comment logical entries, so its array index is not the
  // current statement identity. Use the parser-owned range on the matching
  // current compiled statement instead of re-resolving source text here.
  const sourceStatement = compiled.statements[statement.statementIndex];
  if (!sourceStatement || sourceStatement.documentRange.sourceRevision !== sourceMap.sourceRevision) return null;
  const { from, to } = sourceStatement.documentRange;
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
  const sourceRange = sourceRangeForStatement(sourceText, statement, compiled);
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
