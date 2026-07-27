// Task 38: projects Task 37's statement-logical-text rename spans into
// physical `LineSplice`s, ready for `commitLineSplicePatch`. Pure - never
// re-runs typed rename safety analysis, never re-resolves any binding.
//
// `parseDslSnapshot` is called exactly once (not per entry) purely to obtain
// the logical->physical projection table (`physicalSpanForLogicalRange` is
// "the only bridge from parser logical offsets to editor physical offsets",
// per its own doc comment in logicalStatementSourceMap.ts) - this is
// necessary plumbing to locate already-analysis-approved spans in real
// source text, not a re-verification of rename safety.
import type { CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import type { DslSpan } from "../dsl/dslTypes";
import { physicalSpanForLogicalRange } from "../dsl/logicalStatementSourceMap";
import type { LineSplice } from "./textPatch";

export type TypedRenameSpliceEntry = {
  readonly statementIndex: number;
  readonly span: DslSpan;
  readonly oldName: string;
  readonly newName: string;
};

export type TypedRenameSpliceResult =
  | { ok: true; splices: LineSplice[] }
  | { ok: false; reason: string };

type PhysicalReplacement = { from: number; to: number; text: string };

const lineStartOffsets = (sourceText: string): number[] => {
  const starts = [0];
  for (const match of sourceText.matchAll(/\r?\n/g)) starts.push((match.index ?? 0) + match[0].length);
  return starts;
};

/** Index of the last `lineStarts[i] <= offset` - the 0-based line containing `offset`. */
const lineIndexForOffset = (lineStarts: readonly number[], offset: number): number => {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo;
};

/**
 * Builds one `LineSplice` per physical line touched by `entries` (declaration
 * + every affected occurrence from a Task 37 "ok" verdict). Every entry is
 * independently verified against the live `sourceText` before any splice is
 * built - a single mismatch, duplicate, overlap, or non-contiguous/
 * cross-line projection fails the whole batch atomically; no partial
 * application is ever returned.
 */
export const buildTypedRenameSplices = (
  sourceText: string,
  compiled: CompiledDslDocument,
  entries: readonly TypedRenameSpliceEntry[]
): TypedRenameSpliceResult => {
  if (entries.length === 0) return { ok: true, splices: [] };

  const normalizedSource = sourceText.replace(/\r\n/g, "\n");
  const parsed = parseDslSnapshot({ normalizedSource, sourceRevision: 0 });
  const sourceMap = parsed.sourceMap;

  const replacements: PhysicalReplacement[] = [];
  for (const entry of entries) {
    const statement = compiled.statements[entry.statementIndex];
    if (!statement) return { ok: false, reason: `statementIndex ${entry.statementIndex} is out of range` };
    const logical = sourceMap.statements.find(
      (candidate) =>
        candidate.range.from === statement.documentRange.from && candidate.range.to === statement.documentRange.to
    );
    if (!logical) return { ok: false, reason: `no logical statement projection for statementIndex ${entry.statementIndex}` };
    const physical = physicalSpanForLogicalRange(sourceMap, logical, entry.span);
    if (!physical || physical.segments.length !== 1) {
      return { ok: false, reason: `non-contiguous physical projection for "${entry.oldName}"` };
    }
    const { from, to } = physical.segments[0];
    if (sourceText.slice(from, to) !== entry.oldName) {
      return { ok: false, reason: `projected span for "${entry.oldName}" does not match the live source text` };
    }
    replacements.push({ from, to, text: entry.newName });
  }

  const byStart = [...replacements].sort((a, b) => a.from - b.from);
  for (let index = 1; index < byStart.length; index += 1) {
    if (byStart[index].from < byStart[index - 1].to) {
      return { ok: false, reason: "two entries project onto duplicate or overlapping source ranges" };
    }
  }

  const lineStarts = lineStartOffsets(sourceText);
  const byLine = new Map<number, PhysicalReplacement[]>();
  for (const replacement of byStart) {
    const fromLine = lineIndexForOffset(lineStarts, replacement.from);
    const toLine = replacement.to > replacement.from ? lineIndexForOffset(lineStarts, replacement.to - 1) : fromLine;
    if (fromLine !== toLine) {
      return { ok: false, reason: `projected span for "${replacement.text}" crosses a physical line boundary` };
    }
    const list = byLine.get(fromLine) ?? [];
    list.push(replacement);
    byLine.set(fromLine, list);
  }

  const lines = sourceText.split(/\r?\n/);
  const splices: LineSplice[] = [];
  for (const lineIndex of [...byLine.keys()].sort((a, b) => a - b)) {
    const lineStart = lineStarts[lineIndex];
    const lineReplacements = [...byLine.get(lineIndex)!].sort((a, b) => b.from - a.from);
    let newLine = lines[lineIndex];
    for (const replacement of lineReplacements) {
      const localFrom = replacement.from - lineStart;
      const localTo = replacement.to - lineStart;
      newLine = `${newLine.slice(0, localFrom)}${replacement.text}${newLine.slice(localTo)}`;
    }
    splices.push({ startLine: lineIndex + 1, endLine: lineIndex + 1, replacementLines: [newLine] });
  }

  return { ok: true, splices };
};
