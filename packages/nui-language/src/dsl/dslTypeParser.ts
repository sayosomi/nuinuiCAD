import type { ScalarType } from "../scalars/types";
import { scanScalarLiteral } from "../scalars/literalScanner";
import type { DslDiagnosticPresentation, DslSpan } from "./dslTypes";
import type { DslNonArrayValueType, DslRequiredNonArrayValueType, DslValueType } from "./dslValueTypes";
import { isBareDslIdentifierChar } from "./dslTokens";
import { parseDslNumericTypeOptions, type DslNumericTypeOptions } from "./dslNumericTypeOptions";
import {
  dslGeometryArrayTypeNames,
  dslValueTypeOfGeometryArrayTypeName
} from "./geometryArrayTypes";

export type DslTypeDiagnostic = { message: string; span: DslSpan; code?: string; presentation?: DslDiagnosticPresentation };

export type DslScalarTypeParseResult = {
  declaredType: ScalarType | null;
  choiceOptionSpans: DslSpan[];
  numericTypeOptions?: DslNumericTypeOptions;
};

export type DslDeclaredValueTypeParseResult = {
  valueType: DslValueType | null;
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
 * The value type names accepted by typed declarations. Source Editor
 * completion consumes this declaration-facing list instead of maintaining a
 * second vocabulary. Named record types remain source declarations.
 */
export const dslTypedDeclarationTypeNames: readonly string[] = [
  NUMBER_TYPE_NAME,
  ...Object.keys(KNOWN_SIMPLE_TYPES),
  dslChoiceTypeName,
  `${NUMBER_TYPE_NAME}?`,
  ...Object.keys(KNOWN_SIMPLE_TYPES).map((name) => `${name}?`),
  `${NUMBER_TYPE_NAME}[]`,
  ...Object.keys(KNOWN_SIMPLE_TYPES).map((name) => `${name}[]`),
  `${NUMBER_TYPE_NAME}?[]`,
  ...Object.keys(KNOWN_SIMPLE_TYPES).map((name) => `${name}?[]`),
  `${NUMBER_TYPE_NAME}[]?`,
  ...Object.keys(KNOWN_SIMPLE_TYPES).map((name) => `${name}[]?`),
  "point",
  "line",
  "path",
  "point?",
  "line?",
  "path?",
  ...dslGeometryArrayTypeNames.map((name) => name.replace("[]", "?[]")),
  ...dslGeometryArrayTypeNames.map((name) => name.replace("[]", "[]?")),
  ...dslGeometryArrayTypeNames
];

export const dslModuleParameterTypeNames: readonly string[] = [
  NUMBER_TYPE_NAME,
  ...Object.keys(KNOWN_SIMPLE_TYPES),
  dslChoiceTypeName,
  `${NUMBER_TYPE_NAME}[]`,
  ...Object.keys(KNOWN_SIMPLE_TYPES).map((name) => `${name}[]`),
  "point",
  "line",
  "path",
  ...dslGeometryArrayTypeNames
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
 * Parses the source-owned scalar type annotation used by scalar declarations,
 * record fields, && scalar Module parameters. No initializer || default
 * expression is interpreted.
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
      span: typeSpan,
      code: "unknown-type",
      presentation: { key: "diagnostic.unknown-type", parameters: { type: text } }
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
      if (token.raw === "none") {
        diagnostics.push({
          message: "予約語 none は choice option に使用できません。",
          span: token.span,
          code: "reserved-none-choice-option"
        });
        hasError = true;
        continue;
      }
      if (seen.has(token.raw)) {
        diagnostics.push({
          message: `choice option が重複しています: ${token.raw}`,
          span: token.span,
          code: "invalid-choice-type",
          presentation: { key: "diagnostic.duplicate-choice-option", parameters: { option: token.raw } }
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

const isBareTypeName = (text: string) =>
  text.length > 0 && [...text].every((character) => isBareDslIdentifierChar(character));

/**
 * Parses a declaration-facing value type. Built-in scalar spellings retain
 * their existing parser/diagnostics; a single `[]` suffix lifts any currently
 * valid non-array value type into the canonical immutable collection type;
 * any other bare identifier becomes an unresolved nominal record type.
 */
export const parseDslDeclaredValueType = (
  source: string,
  typeSpan: DslSpan,
  diagnostics: DslTypeDiagnostic[]
): DslDeclaredValueTypeParseResult => {
  const text = source.slice(typeSpan.start, typeSpan.end);
  let suffixEnd = typeSpan.start + text.length - (text.length - text.trimEnd().length);
  let arraySuffix = false;
  let outerOptional = false;
  let memberOptional = false;

  const stripSuffix = (suffix: "?" | "[]"): DslSpan | null => {
    while (suffixEnd > typeSpan.start && whitespace.test(source[suffixEnd - 1]!)) suffixEnd -= 1;
    const width = suffix.length;
    if (suffixEnd < typeSpan.start + width || source.slice(suffixEnd - width, suffixEnd) !== suffix) return null;
    const span = { start: suffixEnd - width, end: suffixEnd };
    suffixEnd = span.start;
    while (suffixEnd > typeSpan.start && whitespace.test(source[suffixEnd - 1]!)) suffixEnd -= 1;
    return span;
  };

  const outerOptionalSpan = stripSuffix("?");
  if (outerOptionalSpan) outerOptional = true;
  const arraySpan = stripSuffix("[]");
  if (arraySpan) arraySuffix = true;
  const memberOptionalSpan = stripSuffix("?");
  if (memberOptionalSpan) memberOptional = true;

  if (outerOptional && memberOptional) {
    diagnostics.push({
      message: "optional 型の ? は1つだけ指定できます。T?? は使用できません。",
      span: memberOptionalSpan!,
      code: "repeated-optional-type",
      presentation: { key: "diagnostic.repeated-optional-type" }
    });
    return { valueType: null, choiceOptionSpans: [] };
  }

  const elementTypeSpan = trimSpan(source, typeSpan.start, suffixEnd);
  const elementText = source.slice(elementTypeSpan.start, elementTypeSpan.end);
  const residualTrimmed = elementText.trimEnd();
  const residualQuestion = residualTrimmed.endsWith("?");
  const residualArray = residualTrimmed.endsWith("[]");
  if (memberOptional && !arraySuffix) {
    diagnostics.push({
      message: "optional 型の ? は1つだけ指定できます。T?? は使用できません。",
      span: memberOptionalSpan!,
      code: "repeated-optional-type",
      presentation: { key: "diagnostic.repeated-optional-type" }
    });
    return { valueType: null, choiceOptionSpans: [] };
  }
  if (residualQuestion || residualArray) {
    const suffixStart = residualQuestion
      ? elementTypeSpan.start + residualTrimmed.lastIndexOf("?")
      : elementTypeSpan.start + residualTrimmed.lastIndexOf("[]");
    diagnostics.push({
      message: residualQuestion
        ? "optional 型の ? は1つだけ指定できます。T?? は使用できません。"
        : "配列は1次元のみ対応しています。T[][] は使用できません。",
      span: { start: suffixStart, end: suffixStart + (residualQuestion ? 1 : 2) },
      code: residualQuestion ? "repeated-optional-type" : "nested-array-type",
      presentation: { key: residualQuestion ? "diagnostic.repeated-optional-type" : "diagnostic.nested-array-type" }
    });
    return { valueType: null, choiceOptionSpans: [] };
  }

  const composeValueType = (base: DslRequiredNonArrayValueType): DslValueType => {
    const valueType: DslNonArrayValueType = memberOptional ? { kind: "optional", valueType: base } : base;
    if (arraySuffix) return outerOptional
      ? { kind: "optional", valueType: { kind: "array", elementType: valueType } }
      : { kind: "array", elementType: valueType };
    return outerOptional ? { kind: "optional", valueType: base } : valueType;
  };

  if (elementText === "point" || elementText === "line" || elementText === "path") {
    return { valueType: composeValueType({ kind: elementText }), choiceOptionSpans: [] };
  }
  const geometryValueType = dslValueTypeOfGeometryArrayTypeName(elementText);
  if (geometryValueType) {
    diagnostics.push({
      message: "配列型の要素型に配列型を指定できません。",
      span: elementTypeSpan,
      code: "nested-array-type",
      presentation: { key: "diagnostic.nested-array-type" }
    });
    return { valueType: null, choiceOptionSpans: [] };
  }

  const builtInScalarSyntax =
    elementText === NUMBER_TYPE_NAME ||
    elementText === dslChoiceTypeName ||
    Object.prototype.hasOwnProperty.call(KNOWN_SIMPLE_TYPES, elementText) ||
    NUMBER_HEAD.test(elementText) ||
    CHOICE_HEAD.test(elementText);
  if (builtInScalarSyntax || !isBareTypeName(elementText)) {
    const parsed = parseDslScalarType(source, elementTypeSpan, diagnostics, {
      acceptedTypeDescription: "number/string/boolean/choice(...)/point/line/path/T[]"
    });
    return {
      valueType: parsed.declaredType
        ? composeValueType(parsed.declaredType)
        : null,
      choiceOptionSpans: parsed.choiceOptionSpans,
      ...(parsed.numericTypeOptions ? { numericTypeOptions: parsed.numericTypeOptions } : {})
    };
  }
  return {
    valueType: composeValueType({ kind: "record", name: elementText }),
    choiceOptionSpans: []
  };
};
