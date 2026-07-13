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
