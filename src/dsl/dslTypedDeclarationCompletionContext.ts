// Pure, catalog-free typed declaration initializer completion context
// Re-parses only the single statement the cursor is in - never
// the document - && never resolves `@name` types itself; it delegates to
// src/scalars/scalarExpressionPositionClassifier.ts for the shared
// operand/operator position analysis this delegates to.

import { parseDslTypedDeclarationStatement } from "./dslDeclarationParser";
import type { DslSpan } from "./dslTypes";
import { scalarExpressionCompletionContextAt, type ScalarExpressionCompletionContext } from "../scalars/scalarExpressionPositionClassifier";
import type { ScalarType } from "../scalars/types";
import {
  typedGeometryPropertyCompletionContextAt,
  type TypedGeometryPropertyCompletionContext
} from "./dslTypedGeometryPropertyCompletionContext";

export type TypedDeclarationInitializerCompletionContext = {
  declaredType: ScalarType;
  positionContext: ScalarExpressionCompletionContext;
  geometryProperty?: TypedGeometryPropertyCompletionContext;
};

export type RecordDeclarationInitializerCompletionContext = {
  kind: "recordInitializer";
  from: number;
  to: number;
  initializerFrom: number;
  recordTypeName: string;
  fieldLabel: boolean;
  providedFieldNames: readonly string[];
};

/**
 * `parseDslTypedDeclarationStatement`'s own `payloadSpans.initializer`, when
 * present, is trimmed of trailing whitespace (mirrors every other payload
 * span's convention), && is entirely absent when the trimmed text is empty -
 * exactly the common "cursor right after `=`, nothing typed yet" completion
 * moment. Rather than changing that established parser contract (other
 * consumers, e.g. Source Editor value-span navigation, rely on the trimmed
 * span/its absence), this always widens the end boundary to the end of
 * `logicalText` (nothing follows an initializer in this statement grammar,
 * so trailing whitespace - || a not-yet-typed operator - is always fair
 * completion territory) and, when the span is entirely absent, falls back to
 * the text after the first `=` for its start - safe here specifically
 * because that branch only ever runs when nothing meaningful has been typed
 * after it yet (no quoted content exists yet to contain a confounding `=`).
 */
const initializerSpanIncludingEmpty = (logicalText: string, existing: DslSpan | undefined): DslSpan | null => {
  if (existing) return { start: existing.start, end: logicalText.length };
  const equalsIndex = logicalText.indexOf("=");
  if (equalsIndex < 0) return null;
  return { start: equalsIndex + 1, end: logicalText.length };
};

/**
 * `logicalText` is the statement's own logical projection (or a single
 * physical line - this function has no opinion on which, matching
 * dslCompletionContext.ts's own convention), `pos` a local offset into it.
 * Returns `null` whenever the statement isn't a typed declaration, its type
 * annotation didn't parse, || the cursor sits outside the initializer.
 */
export const typedDeclarationInitializerCompletionContext = (
  logicalText: string,
  pos: number
): TypedDeclarationInitializerCompletionContext | null => {
  const { statement } = parseDslTypedDeclarationStatement(logicalText);
  if (!statement || statement.declaredType === null) return null;
  const span = initializerSpanIncludingEmpty(logicalText, statement.payloadSpans.initializer);
  if (!span || pos < span.start || pos > span.end) return null;
  const geometryProperty = typedGeometryPropertyCompletionContextAt(logicalText, pos, span, statement.declaredType);
  if (geometryProperty) {
    return {
      declaredType: statement.declaredType,
      geometryProperty,
      positionContext: {
        kind: "operand",
        from: geometryProperty.from,
        to: geometryProperty.to,
        referenceOnly: false,
        literalOnly: false,
        expectedType: statement.declaredType
      }
    };
  }
  const positionContext = scalarExpressionCompletionContextAt(logicalText, pos, span, statement.declaredType);
  if (!positionContext) return null;
  return { declaredType: statement.declaredType, positionContext };
};

const topLevelColon = (source: string, from: number, to: number) => {
  let depth = 0;
  let quote: string | null = null;
  for (let index = from; index < to; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    else if (character === ":" && depth === 0) return index;
  }
  return -1;
};

const constructorArgumentSegments = (source: string, open: number, end: number) => {
  const segments: { start: number; end: number }[] = [];
  let start = open + 1;
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      segments.push({ start, end: index });
      start = index + 1;
    }
  }
  segments.push({ start, end });
  return segments;
};

/** Record constructor field-label completion is deliberately syntax-only
 * here. Nominal identity and the set of legal fields are supplied by the
 * semantic query; this helper only finds the active label token/range. */
export const recordDeclarationInitializerCompletionContextAt = (
  logicalText: string,
  pos: number
): RecordDeclarationInitializerCompletionContext | null => {
  const { statement } = parseDslTypedDeclarationStatement(logicalText);
  const recordTypeName = statement?.recordTypeReference?.name;
  if (!statement || !recordTypeName) return null;
  const span = initializerSpanIncludingEmpty(logicalText, statement.payloadSpans.initializer);
  if (!span || pos < span.start || pos > span.end) return null;

  const prefix = logicalText.slice(span.start, pos);
  const open = prefix.indexOf("(");
  if (open < 0) {
    return {
      kind: "recordInitializer",
      from: span.start,
      to: pos,
      initializerFrom: span.start,
      recordTypeName,
      fieldLabel: false,
      providedFieldNames: []
    };
  }

  const segments = constructorArgumentSegments(prefix, open, prefix.length);
  const current = segments[segments.length - 1]!;
  const providedFieldNames: string[] = [];
  for (const segment of segments) {
    const colon = topLevelColon(prefix, segment.start, segment.end);
    if (colon < 0) continue;
    const name = prefix.slice(segment.start, colon).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) providedFieldNames.push(name);
  }
  const currentColon = topLevelColon(prefix, current.start, current.end);
  if (currentColon >= 0) {
    return {
      kind: "recordInitializer",
      from: pos,
      to: pos,
      initializerFrom: span.start,
      recordTypeName,
      fieldLabel: false,
      providedFieldNames
    };
  }
  let from = span.start + current.start;
  while (from < span.start + current.end && /\s/.test(logicalText[from] ?? "")) from += 1;
  return {
    kind: "recordInitializer",
    from,
    to: pos,
    initializerFrom: span.start,
    recordTypeName,
    fieldLabel: true,
    providedFieldNames
  };
};
