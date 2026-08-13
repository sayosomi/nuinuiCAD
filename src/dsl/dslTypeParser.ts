import type { ScalarType } from "../scalars/types";
import { scanScalarLiteral } from "../scalars/literalScanner";
import type { DslSpan } from "./dslTypes";
import { parseDslNumericTypeOptions, type DslNumericTypeOptions } from "./dslNumericTypeOptions";

export type DslTypeDiagnostic = { message: string; span: DslSpan; code?: string };

export type DslScalarTypeParseResult = {
  declaredType: ScalarType | null;
  choiceOptionSpans: DslSpan[];
  numericTypeOptions?: DslNumericTypeOptions;
};

export const dslChoiceTypeName = "choice";

const NUMBER_TYPE_NAME = "number";
const KNOWN_SIMPLE_TYPES: Record<string, ScalarType> = {
  string: { kind: "string" },
  boolean: { kind: "boolean" }
};

/**
 * The scalar type names accepted by typed declarations && module parameters.
 * Source Editor completion consumes the declaration-facing re-export instead
 * of maintaining a second list.
 */
export const dslTypedDeclarationTypeNames: readonly string[] = [
  NUMBER_TYPE_NAME,
  ...Object.keys(KNOWN_SIMPLE_TYPES),
  dslChoiceTypeName
];

export const dslModuleParameterTypeNames: readonly string[] = [
  ...dslTypedDeclarationTypeNames,
  "point",
  "line",
  "path"
];

const NUMBER_HEAD = new RegExp(`^${NUMBER_TYPE_NAME}\\s*\\(`);
const CHOICE_HEAD = new RegExp(`^${dslChoiceTypeName}\\s*\\(`);
const whitespace = /\s/;

const trimSpan = (source: string, start: number, end: number): DslSpan => {
  while (start < end && whitespace.test(source[start])) start += 1;
  while (end > start && whitespace.test(source[end - 1])) end -= 1;
  return { start, end };
};

const escaped = (source: string, index: number) => {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
};

const matchingClose = (source: string, open: number, to: number) => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = open; index < to; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")" && --depth === 0) {
      return index;
    }
  }
  return -1;
};

const splitTopLevelCommas = (source: string, span: DslSpan): DslSpan[] => {
  const parts: DslSpan[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = span.start;
  for (let index = span.start; index < span.end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
    } else if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(trimSpan(source, start, index));
      start = index + 1;
    }
  }
  parts.push(trimSpan(source, start, span.end));
  return parts;
};

export type DslScalarTypeParseOptions = {
  /** Extra type names accepted by the caller for diagnostic guidance only. */
  acceptedTypeDescription?: string;
};

/**
 * Parses the source-owned scalar type annotation used by `const`/`let` &&
 * module parameters. No initializer || default expression is interpreted.
 */
export const parseDslScalarType = (
  source: string,
  typeSpan: DslSpan,
  diagnostics: DslTypeDiagnostic[],
  options: DslScalarTypeParseOptions = {}
): DslScalarTypeParseResult => {
  const text = source.slice(typeSpan.start, typeSpan.end);
  if (text === NUMBER_TYPE_NAME) return { declaredType: { kind: "number" }, choiceOptionSpans: [] };
  if (NUMBER_HEAD.test(text)) {
    const parsed = parseDslNumericTypeOptions(source, typeSpan);
    diagnostics.push(...parsed.diagnostics);
    return parsed.options
      ? { declaredType: { kind: "number" }, choiceOptionSpans: [], numericTypeOptions: parsed.options }
      : { declaredType: null, choiceOptionSpans: [] };
  }
  const simple = KNOWN_SIMPLE_TYPES[text];
  if (simple) return { declaredType: simple, choiceOptionSpans: [] };

  const choiceMatch = CHOICE_HEAD.exec(text);
  if (!choiceMatch) {
    const accepted = options.acceptedTypeDescription ?? "number/string/boolean/choice(...)";
    diagnostics.push({
      message: `不明な型注釈です: ${text}(${accepted} のいずれかを指定してください)`,
      span: typeSpan
    });
    return { declaredType: null, choiceOptionSpans: [] };
  }

  const openIndex = typeSpan.start + choiceMatch[0].length - 1;
  const close = matchingClose(source, openIndex, typeSpan.end);
  if (close < 0) {
    diagnostics.push({ message: "choice の「(」が閉じられていません。", span: { start: openIndex, end: openIndex + 1 } });
    return { declaredType: null, choiceOptionSpans: [] };
  }
  if (close !== typeSpan.end - 1) {
    diagnostics.push({
      message: "choice(...) の後に余分なトークンがあります。",
      span: trimSpan(source, close + 1, typeSpan.end)
    });
    return { declaredType: null, choiceOptionSpans: [] };
  }

  const inner = trimSpan(source, openIndex + 1, close);
  if (inner.start === inner.end) {
    diagnostics.push({
      message: "choice 型には少なくとも1つの option が必要です。",
      span: { start: openIndex, end: close + 1 },
      code: "invalid-choice-type"
    });
    return { declaredType: null, choiceOptionSpans: [] };
  }

  const optionSpans = splitTopLevelCommas(source, inner);
  const optionsByName: string[] = [];
  const optionSpansByName: DslSpan[] = [];
  const seen = new Set<string>();
  let hasError = false;

  for (const span of optionSpans) {
    if (span.start === span.end) {
      diagnostics.push({ message: "choice option が空です。", span, code: "invalid-choice-type" });
      hasError = true;
      continue;
    }
    const token = scanScalarLiteral(source, span);
    if (token.kind === "choice" && token.span.end === span.end) {
      if (seen.has(token.raw)) {
        diagnostics.push({
          message: `choice option が重複しています: ${token.raw}`,
          span: token.span,
          code: "invalid-choice-type"
        });
        hasError = true;
        continue;
      }
      seen.add(token.raw);
      optionsByName.push(token.raw);
      optionSpansByName.push(token.span);
      continue;
    }
    if (token.kind === "boolean") {
      diagnostics.push({
        message: "choice option に true/false は使用できません。",
        span: token.span,
        code: "invalid-choice-type"
      });
      hasError = true;
      continue;
    }
    diagnostics.push({
      message: "choice option は裸の識別子で指定してください。",
      span,
      code: "invalid-choice-type"
    });
    hasError = true;
  }

  if (hasError) return { declaredType: null, choiceOptionSpans: optionSpansByName };
  return { declaredType: { kind: "choice", options: optionsByName }, choiceOptionSpans: optionSpansByName };
};
