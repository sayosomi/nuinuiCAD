import { isElementDslStatement, parseDsl } from "./dslParser";
import type { DslSpan, DslStatement } from "./dslTypes";

export type DslValueSpan = DslSpan;

const spanKey = (span: DslSpan) => `${span.start}:${span.end}`;

const candidateSpans = (statement: DslStatement): DslSpan[] => [
  ...Object.values(statement.payloadSpans),
  ...statement.attrs.map((attr): DslSpan => ({ start: attr.valueStart, end: attr.valueEnd }))
];

/**
 * Editable value spans for a single DSL source line, in source order, line-relative.
 * Parses `lineText` in isolation so it always reflects the live buffer, never a
 * possibly-stale last-good document parse. Returns [] whenever the line has no
 * statement, or its own parse produced any error diagnostic (a partial/erroring
 * parse's spans must never be used for click selection).
 *
 * A block-opening line (trailing `{`, e.g. `for i count=5 {`) has no matching `}`
 * when parsed alone, which would otherwise manufacture a spurious "unclosed block"
 * diagnostic and hide that statement's own attribute values. Such a line is probed
 * first, then reparsed with a synthetic closing line so its real diagnostics (if any)
 * can be told apart from that artifact.
 *
 * Non-element statements (palette/view/print/directive lines such as `nui`, `role`,
 * `view`, `color`, `printLayout`, `place`, `layoutVar`, `atStop`) are never a target,
 * even when they carry real attribute/payload values — this is the one shared
 * determination both click-selection and Tab-navigation rely on for "is this line's
 * value clickable/tabbable at all."
 */
export const dslLineValueSpans = (lineText: string): DslValueSpan[] => {
  const probe = parseDsl(lineText);
  const opensBlock = probe.statements.length === 1 && probe.statements[0].opensBlock;
  const { statements, diagnostics } = opensBlock ? parseDsl(`${lineText}\n}`) : probe;
  const statement = statements.find((candidate) => candidate.line === 1);
  if (!statement || !isElementDslStatement(statement)) return [];
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.line === 1)) return [];
  const keyword = spanKey(statement.keywordSpan);
  const seen = new Set<string>();
  const spans: DslValueSpan[] = [];
  for (const span of candidateSpans(statement)) {
    const key = spanKey(span);
    if (key === keyword || seen.has(key)) continue;
    seen.add(key);
    spans.push(span);
  }
  return spans.sort((a, b) => a.start - b.start);
};

/** Half-open [start, end): the position right after a value is not part of it. */
export const findDslValueSpanAt = (spans: readonly DslValueSpan[], offset: number): DslValueSpan | null =>
  spans.find((span) => offset >= span.start && offset < span.end) ?? null;

export type DslValueSpanDirection = "next" | "previous";

/**
 * The value span adjacent to `pos` among `spans` (already source-ordered, from
 * dslLineValueSpans), cycling at the ends. If `pos` is inside a span — which, via
 * findDslValueSpanAt's half-open check, also covers "the current selection exactly
 * matches a span" since that always has pos === span.start — that span is the
 * reference point. Otherwise the nearest span in `direction` is used, wrapping around
 * when none exists.
 */
export const adjacentDslValueSpan = (
  spans: readonly DslValueSpan[],
  pos: number,
  direction: DslValueSpanDirection
): DslValueSpan | null => {
  if (spans.length === 0) return null;
  const reference = findDslValueSpanAt(spans, pos);
  if (reference) {
    const index = spans.indexOf(reference);
    return direction === "next"
      ? spans[(index + 1) % spans.length]
      : spans[(index - 1 + spans.length) % spans.length];
  }
  if (direction === "next") return spans.find((span) => span.start > pos) ?? spans[0];
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    if (spans[index].end <= pos) return spans[index];
  }
  return spans[spans.length - 1];
};
