import { parseDslTypedDeclarationStatement } from "./dslDeclarationParser";
import { dslCompletionMetadataForType, dslStatementElementType } from "./dslCompletionMetadata";
import { dslLineElementStatement, dslLineLabeledValueSpans } from "./dslValueSpans";
import type { GeometryArrayType } from "./geometryArrayTypes";
import type { DslSpan } from "./dslTypes";

export type GeometryArrayCompletionContext = {
  expectedType: GeometryArrayType;
  mode: "member" | "arrayReference";
  from: number;
  to: number;
};

const initializerSpanIncludingEmpty = (source: string, existing: DslSpan | undefined): DslSpan | null => {
  if (existing) return { start: existing.start, end: source.length };
  const equalsIndex = source.indexOf("=");
  return equalsIndex < 0 ? null : { start: equalsIndex + 1, end: source.length };
};

const firstNonWhitespace = (source: string, from: number, to: number) => {
  let cursor = from;
  while (cursor < to && /\s/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
};

const currentArrayMemberStart = (source: string, contentStart: number, pos: number) => {
  let quote: string | null = null;
  let depth = 0;
  let start = contentStart;
  for (let index = contentStart; index < pos; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) start = index + 1;
  }
  return firstNonWhitespace(source, start, pos);
};

/**
 * Source-shape adapter shared by declaration, construction-parameter, and
 * Module-argument completion. It determines whether the cursor is completing
 * one member of an inline literal or a whole named array reference.
 * Type/visibility resolution stays in the source/Module semantic owners.
 */
export const geometryArrayValueCompletionContextAt = (
  source: string,
  pos: number,
  valueSpan: DslSpan,
  expectedType: GeometryArrayType
): GeometryArrayCompletionContext | null => {
  if (pos < valueSpan.start || pos > valueSpan.end) return null;
  const valueStart = firstNonWhitespace(source, valueSpan.start, valueSpan.end);
  if (source[valueStart] === "[") {
    const contentStart = valueStart + 1;
    let close = valueSpan.end;
    let quote: string | null = null;
    let depth = 1;
    for (let index = contentStart; index < valueSpan.end; index += 1) {
      const char = source[index];
      if (quote) {
        if (char === quote && source[index - 1] !== "\\") quote = null;
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === "[") depth += 1;
      else if (char === "]" && --depth === 0) {
        close = index;
        break;
      }
    }
    if (pos >= contentStart && pos <= close) {
      return {
        expectedType,
        mode: "member",
        from: currentArrayMemberStart(source, contentStart, pos),
        to: pos
      };
    }
  }
  return {
    expectedType,
    mode: "arrayReference",
    from: Math.min(valueStart, pos),
    to: pos
  };
};

const geometryArrayParameterCompletionContextAt = (
  source: string,
  pos: number
): GeometryArrayCompletionContext | null => {
  const statement = dslLineElementStatement(source);
  const elementType = statement ? dslStatementElementType(statement) : null;
  if (!statement || !elementType) return null;
  const metadata = dslCompletionMetadataForType(elementType);
  const span = dslLineLabeledValueSpans(source).find((item) => {
    const bounds = item.start === item.end && item.rawValueSpan ? item.rawValueSpan : item;
    return pos >= bounds.start && pos <= bounds.end;
  });
  if (!span) return null;
  const parameters = metadata.parameters.filter((parameter) =>
    parameter.source === span.source && parameter.key === span.key
  );
  const parameter = parameters.length === 1 ? parameters[0] : undefined;
  if (!parameter?.definition.geometryArrayType) return null;
  const valueSpan = span.start === span.end && span.rawValueSpan ? span.rawValueSpan : span;
  return geometryArrayValueCompletionContextAt(
    source,
    pos,
    { start: valueSpan.start, end: Math.max(valueSpan.end, pos) },
    parameter.definition.geometryArrayType
  );
};

/**
 * Tolerant source-only completion context for immutable geometry-array values.
 * Typed declarations retain their existing source-owned path; element
 * parameters opt in through ParameterDefinition.geometryArrayType so the same
 * completion semantics can be reused without introducing a second resolver.
 */
export const geometryArrayDeclarationCompletionContextAt = (
  source: string,
  pos: number
): GeometryArrayCompletionContext | null => {
  const { statement } = parseDslTypedDeclarationStatement(source);
  if (statement?.geometryArrayType && statement.bindingKind === "const") {
    const initializerSpan = initializerSpanIncludingEmpty(source, statement.payloadSpans.initializer);
    if (!initializerSpan) return null;
    return geometryArrayValueCompletionContextAt(source, pos, initializerSpan, statement.geometryArrayType);
  }
  return geometryArrayParameterCompletionContextAt(source, pos);
};
