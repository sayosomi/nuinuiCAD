import type { DslSpan } from "./dslTypes";

/**
 * Span-oriented delimiter scanner used only by parameter-span resolution.
 *
 * It deliberately does not replace the compiler's tokenization in Phase 3a:
 * changing that behavior would broaden this editor-only fix. Its rules are
 * covered against canonical compiler fixtures instead.
 */
export const trimDslSpan = (source: string, span: DslSpan): DslSpan => {
  let { start, end } = span;
  while (start < end && /\s/.test(source[start])) start += 1;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  return { start, end };
};

const quoteIsEscaped = (source: string, index: number) => {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
};

/** Splits a source range at top-level delimiters while retaining empty fields. */
export const splitDslTopLevelSpans = (
  source: string,
  span: DslSpan,
  separator: string
): DslSpan[] => {
  const parts: DslSpan[] = [];
  let start = span.start;
  let quote: string | null = null;
  let depth = 0;

  for (let index = span.start; index < span.end; index += 1) {
    const char = source[index];
    if ((char === '"' || char === "'") && !quoteIsEscaped(source, index)) {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (quote) continue;
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (depth === 0 && char === separator) {
      parts.push(trimDslSpan(source, { start, end: index }));
      start = index + 1;
    }
  }
  parts.push(trimDslSpan(source, { start, end: span.end }));
  return parts;
};

export const nonEmptyDslSpans = (spans: readonly DslSpan[]) =>
  spans.filter((span) => span.start < span.end);

const hasText = (span: DslSpan) => span.start < span.end;

/** `(x, y)` coordinate-literal x/y sub-span decomposition. Shared by parameter
 * value-span resolution and completion (which needs the same detection
 * directly against live text). */
export const coordinateComponent = (source: string, span: DslSpan, component: "x" | "y") => {
  if (source[span.start] !== "(" || source[span.end - 1] !== ")") return null;
  const parts = splitDslTopLevelSpans(source, { start: span.start + 1, end: span.end - 1 }, ",");
  const target = parts[component === "x" ? 0 : 1];
  return parts.length === 2 && target && hasText(target) ? target : null;
};

/** `[a; b; ...]` record-list decomposition (e.g. `vars: [...]`, `intermediates: [...]`). */
export const recordSpans = (source: string, span: DslSpan) => {
  if (source[span.start] !== "[" || source[span.end - 1] !== "]") return null;
  return nonEmptyDslSpans(splitDslTopLevelSpans(source, { start: span.start + 1, end: span.end - 1 }, ";"));
};

export const recordFields = (source: string, record: DslSpan) => splitDslTopLevelSpans(source, record, ":");

/** A single trimmed field span, for records with more than 2 fields (e.g.
 * `intermediates:`'s `point:angle:incoming:outgoing:id`) where recordRemainder's
 * "rest of record" would wrongly span multiple fields together. */
export const recordField = (source: string, record: DslSpan, fieldIndex: number): DslSpan | null => {
  const field = recordFields(source, record)[fieldIndex];
  if (!field) return null;
  const trimmed = trimDslSpan(source, field);
  return hasText(trimmed) ? trimmed : null;
};

export const recordRemainder = (source: string, record: DslSpan, fieldIndex: number) => {
  const field = recordFields(source, record)[fieldIndex];
  if (!field) return null;
  const remainder = trimDslSpan(source, { start: field.start, end: record.end });
  return hasText(remainder) ? remainder : null;
};
