import { MapMode, type ChangeDesc, type Text } from "@codemirror/state";
import { highlightDslLine } from "../dsl/dslHighlight";
import type { DslDiagnostic } from "../dsl/dslTypes";

export type DiagnosticOrigin = "current" | "stale";

export type PositionedDiagnostic = {
  severity: DslDiagnostic["severity"];
  message: string;
  from: number;
  to: number;
  origin: DiagnosticOrigin;
};

/**
 * Resolves a diagnostic's column to a lint range within its line: the token that
 * starts at that column, or the line end when no token boundary is found. Tokens
 * carry only {kind, text} in sequence (no stored offsets), so this walks them
 * summing lengths rather than indexing directly.
 */
export const diagnosticColumnSpan = (lineText: string, column: number): { from: number; to: number } => {
  const targetOffset = Math.min(lineText.length, Math.max(0, column - 1));
  let offset = 0;
  for (const token of highlightDslLine(lineText)) {
    const tokenEnd = offset + token.text.length;
    if (targetOffset >= offset && targetOffset < tokenEnd) {
      return { from: offset, to: tokenEnd };
    }
    offset = tokenEnd;
  }
  return { from: targetOffset, to: lineText.length };
};

/** Exported so callers that need per-diagnostic alignment (e.g. Task 41's
 * Quick Fix action zipping) can position one diagnostic at a time instead of
 * only through the batch `toBufferDiagnostics`/`toStaleDiagnostics` helpers,
 * which drop unpositionable entries and lose index alignment with their input. */
export const positionedFromDiagnostic = (
  doc: Text,
  diagnostic: DslDiagnostic,
  origin: DiagnosticOrigin
): PositionedDiagnostic | null => {
  const physical = diagnostic.physicalSpan;
  if (physical?.segments.length === 1) {
    const segment = physical.segments[0];
    if (segment.from >= 0 && segment.to >= segment.from && segment.to <= doc.length) {
      return { severity: diagnostic.severity, message: diagnostic.message, from: segment.from, to: Math.max(segment.from, segment.to), origin };
    }
  }
  if (diagnostic.line < 1 || diagnostic.line > doc.lines) return null;
  const line = doc.line(diagnostic.line);
  const span = diagnosticColumnSpan(line.text, diagnostic.column);
  const from = line.from + span.from;
  const to = line.from + span.to;
  if (to < from) return null;
  return { severity: diagnostic.severity, message: diagnostic.message, from, to, origin };
};

/** Converts a fresh parseDsl(bufferText) result's diagnostics to absolute CM offsets against the live buffer. */
export const toBufferDiagnostics = (doc: Text, diagnostics: readonly DslDiagnostic[]): PositionedDiagnostic[] =>
  diagnostics
    .map((diagnostic) => positionedFromDiagnostic(doc, diagnostic, "current"))
    .filter((value): value is PositionedDiagnostic => value !== null);

/** Converts last-committed diagnostics to offsets against the committed doc (called once per commit). */
export const toStaleDiagnostics = (doc: Text, diagnostics: readonly DslDiagnostic[]): PositionedDiagnostic[] =>
  diagnostics
    .map((diagnostic) => positionedFromDiagnostic(doc, diagnostic, "stale"))
    .filter((value): value is PositionedDiagnostic => value !== null);

/**
 * Re-projects positioned diagnostics through a CM ChangeDesc, mirroring
 * mapStatementRangeIndex: drops any diagnostic a change fully covers instead of
 * ever presenting a diagnostic at a stale, no-longer-meaningful position.
 */
export const mapPositionedDiagnostics = (
  diagnostics: readonly PositionedDiagnostic[],
  changes: ChangeDesc
): PositionedDiagnostic[] => {
  const mapped: PositionedDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (changes.touchesRange(diagnostic.from, diagnostic.to) === "cover") continue;
    const from = changes.mapPos(diagnostic.from, 1, MapMode.TrackAfter);
    const to = changes.mapPos(diagnostic.to, -1, MapMode.TrackBefore);
    if (from === null || to === null || to < from) continue;
    mapped.push({ ...diagnostic, from, to });
  }
  return mapped;
};

const rangesOverlap = (a: PositionedDiagnostic, b: PositionedDiagnostic) => a.from < b.to && b.from < a.to;

/**
 * Merges the buffer-fresh ("current") layer with the remapped last-committed
 * ("stale") layer. A stale diagnostic is dropped when it overlaps a current
 * error, so the buffer-accurate view always wins on a fatal conflict.
 */
export const mergeDiagnosticLayers = (
  current: readonly PositionedDiagnostic[],
  stale: readonly PositionedDiagnostic[]
): PositionedDiagnostic[] => {
  const currentErrors = current.filter((diagnostic) => diagnostic.severity === "error");
  const keptStale = stale.filter(
    (diagnostic) => !currentErrors.some((error) => rangesOverlap(diagnostic, error))
  );
  return [...current, ...keptStale];
};
