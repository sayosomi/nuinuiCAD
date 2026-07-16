import { isElementDslStatement, parseDsl } from "./dslParser";
import type { DslSpan, DslStatement } from "./dslTypes";
import { physicalSpanForStatementRange, singlePhysicalSegment, statementProjectionAt } from "./dslStatementProjection";
import type { SourceSnapshot } from "./logicalStatementSourceMap";

export type DslValueSpan = DslSpan;

export type DslLabeledValueSpan = DslSpan & {
  source: "payload" | "attr";
  /** Parser semantic key. Some legacy DSL spellings are normalized by the parser. */
  key: string;
};

const spanKey = (span: DslSpan) => `${span.start}:${span.end}`;

const candidateSpans = (statement: DslStatement): DslLabeledValueSpan[] => [
  ...Object.entries(statement.payloadSpans).map(([key, span]) => ({ ...span, source: "payload" as const, key })),
  ...statement.attrs.map((attr): DslLabeledValueSpan => ({
    start: attr.valueStart,
    end: attr.valueEnd,
    source: "attr",
    key: attr.key
  }))
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
/** Parses a live source line under the same safety rules used for editable spans. */
export const dslLineElementStatement = (lineText: string): DslStatement | null => {
  const probe = parseDsl(lineText);
  const opensBlock = probe.statements.length === 1 && probe.statements[0].opensBlock;
  const { statements, diagnostics } = opensBlock ? parseDsl(`${lineText}\n}`) : probe;
  const statement = statements.find((candidate) => candidate.line === 1);
  if (!statement || !isElementDslStatement(statement)) return null;
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.line === 1)) return null;
  return statement;
};

const labeledValueSpansForStatement = (statement: DslStatement | null): DslLabeledValueSpan[] => {
  if (!statement) return [];
  const keyword = spanKey(statement.keywordSpan);
  const seen = new Set<string>();
  const spans: DslLabeledValueSpan[] = [];
  for (const span of candidateSpans(statement)) {
    const key = spanKey(span);
    if (key === keyword || seen.has(key)) continue;
    seen.add(key);
    spans.push(span);
  }
  return spans.sort((a, b) => a.start - b.start);
};

export const dslLineLabeledValueSpans = (lineText: string): DslLabeledValueSpan[] =>
  labeledValueSpansForStatement(dslLineElementStatement(lineText));

type DslPrintLayoutBlockStatement = Extract<DslStatement, { kind: "place" | "layoutVar" | "printLayout" }>;

/**
 * Mirrors dslLineElementStatement for the three printLayout-block-only
 * statement kinds, which dslLineElementStatement always rejects
 * (isElementDslStatement is false for them by design — they never produce a
 * CadElement). `printLayout` opens a block itself, so it reuses the same
 * synthetic-closing-`}` trick as dslLineElementStatement. `place`/`layoutVar`
 * instead require an enclosing printLayout block to parse without a spurious
 * "must be inside printLayout" diagnostic (applyBlockStructure), so they are
 * reparsed wrapped in a synthetic one-line block. parseDsl parses each source
 * line independently (source.split(...).forEach), so term/span offsets found
 * on the wrapped member line are already relative to `lineText` itself — no
 * coordinate adjustment is needed (locked down by a dedicated span-offset
 * test in dslValueSpans.test.ts).
 */
export const dslLinePrintLayoutStatement = (lineText: string): DslPrintLayoutBlockStatement | null => {
  const probe = parseDsl(lineText);
  const probeStatement = probe.statements.find((candidate) => candidate.line === 1);
  if (!probeStatement) return null;

  if (probeStatement.kind === "printLayout") {
    const opensBlock = probe.statements.length === 1 && probeStatement.opensBlock;
    const { statements, diagnostics } = opensBlock ? parseDsl(`${lineText}\n}`) : probe;
    const statement = statements.find((candidate) => candidate.line === 1);
    if (!statement || statement.kind !== "printLayout") return null;
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.line === 1)) return null;
    return statement;
  }

  if (probeStatement.kind === "place" || probeStatement.kind === "layoutVar") {
    const { statements, diagnostics } = parseDsl(`printLayout {\n${lineText}\n}`);
    const statement = statements.find((candidate) => candidate.line === 2);
    if (!statement || (statement.kind !== "place" && statement.kind !== "layoutVar")) return null;
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.line === 2)) return null;
    return statement;
  }

  return null;
};

/** Sibling to dslLineLabeledValueSpans for the printLayout-block-only kinds. */
export const dslLinePrintLayoutValueSpans = (lineText: string): DslLabeledValueSpan[] =>
  labeledValueSpansForStatement(dslLinePrintLayoutStatement(lineText));

/** Projection used by click selection and Tab navigation. */
export const dslLineValueSpans = (lineText: string): DslValueSpan[] =>
  dslLineLabeledValueSpans(lineText).map(({ start, end }) => ({ start, end }));

export type DslDocumentValueSpan = DslLabeledValueSpan & { from: number; to: number };

/** Live-editor projection. Values may be on any physical continuation line;
 * only contiguous token spans are returned for direct CM selection. */
export const dslDocumentValueSpansAt = (
  snapshot: SourceSnapshot,
  position: number
): { ok: true; value: DslDocumentValueSpan[] } | { ok: false; reason: "revision-mismatch" } => {
  const projection = statementProjectionAt(snapshot, position);
  if (!projection.ok) return projection;
  if (!projection.value || !isElementDslStatement(projection.value.statement)) return { ok: true, value: [] };
  if (projection.value.parsed.diagnostics.some((diagnostic) =>
    diagnostic.severity === "error" &&
    diagnostic.line >= projection.value!.statement.line &&
    diagnostic.line <= projection.value!.statement.endLine
  )) return { ok: true, value: [] };
  const spans = labeledValueSpansForStatement(projection.value.statement);
  const projected = spans.flatMap((span) => {
    const physical = physicalSpanForStatementRange(projection.value!, span);
    const range = singlePhysicalSegment(snapshot, physical);
    if (!range.ok) return [];
    return range.value ? [{ ...span, ...range.value }] : [];
  });
  return { ok: true, value: projected.sort((left, right) => left.from - right.from) };
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
