import { parseDsl } from "./dslParser";
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
 */
export const dslLineValueSpans = (lineText: string): DslValueSpan[] => {
  const probe = parseDsl(lineText);
  const opensBlock = probe.statements.length === 1 && probe.statements[0].opensBlock;
  const { statements, diagnostics } = opensBlock ? parseDsl(`${lineText}\n}`) : probe;
  const statement = statements.find((candidate) => candidate.line === 1);
  if (!statement) return [];
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
