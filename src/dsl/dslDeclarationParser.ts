import type { ScalarType } from "../scalars/types";
import { scanScalarLiteral } from "../scalars/literalScanner";
import type { DslSpan } from "./dslTypes";
import { unquoteDslString } from "./dslTokens";
import { parseDslNumericTypeOptions, type DslNumericTypeOptions } from "./dslNumericTypeOptions";

// Focused parser for the v3-only typed declaration statement:
//   const NAME: TYPE = INITIALIZER
//   let NAME: TYPE = INITIALIZER
// See docs/typed-variables/tasks/10-typed-declaration-syntax.md.
//
// The initializer is never interpreted as an expression here - it is kept
// purely as a raw {text, span} pair for Task 14 to re-tokenize. This parser
// only classifies literal tokens inside a choice(...) type annotation, and
// does so exclusively through scanScalarLiteral (Task 09) - no separate
// identifier or true/false reserved-word check is implemented here.

export type DslDeclarationDiagnostic = { message: string; span: DslSpan; code?: string };

/** No `:` type annotation at all (as opposed to a colon with empty type text) - Task 41's Quick Fix routes on this. */
export const MISSING_DECLARED_TYPE_CODE = "missing-declared-type";

export type DslTypedDeclarationStatement = {
  kind: "typedDeclaration";
  bindingKind: "const" | "let";
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  /** `null` when the type annotation itself failed to parse. */
  declaredType: ScalarType | null;
  /** Per-option spans, index-aligned with `declaredType.options` when it is a choice type. */
  choiceOptionSpans: readonly DslSpan[];
  /** Optional source-owned step/bounds metadata for a `number(...)` type annotation. */
  numericTypeOptions?: DslNumericTypeOptions;
  /** Raw, unparsed initializer source text - never evaluated or re-quoted. */
  initializer: string;
  payloadSpans: Record<string, DslSpan>;
  args: [];
  attrs: [];
  opensBlock: false;
};

export type DslDeclarationParseResult = {
  statement: DslTypedDeclarationStatement | null;
  diagnostics: DslDeclarationDiagnostic[];
};

const leadingIdentifier = /^[A-Za-z_][A-Za-z0-9_]*/;
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

// Local copies of the quote/paren-depth-aware top-level scan primitives
// established independently by dslCallParser.ts/dslSettingsParser.ts/
// dslCallCompletionContext.ts - this codebase does not share them across
// parser files, so a fourth local copy here matches existing convention.
const topLevelIndex = (source: string, target: string, from: number, to: number) => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = from; index < to; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
    } else if (character === target && depth === 0) {
      return index;
    } else if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth -= 1;
    }
  }
  return -1;
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
    if (character === "\"" || character === "'") {
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

const parseName = (source: string, span: DslSpan): { name: string; nameSpan: DslSpan | null } =>
  span.start === span.end
    ? { name: "", nameSpan: null }
    : { name: unquoteDslString(source.slice(span.start, span.end)), nameSpan: span };

const KNOWN_SIMPLE_TYPES: Record<string, ScalarType> = {
  string: { kind: "string" },
  boolean: { kind: "boolean" }
};

const CHOICE_HEAD = /^choice\s*\(/;

const parseDeclaredType = (
  source: string,
  typeSpan: DslSpan,
  diagnostics: DslDeclarationDiagnostic[]
): { declaredType: ScalarType | null; choiceOptionSpans: DslSpan[]; numericTypeOptions?: DslNumericTypeOptions } => {
  const text = source.slice(typeSpan.start, typeSpan.end);
  if (text === "number") return { declaredType: { kind: "number" }, choiceOptionSpans: [] };
  if (/^number\s*\(/.test(text)) {
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
    diagnostics.push({
      message: `不明な型注釈です: ${text}(number/string/boolean/choice(...) のいずれかを指定してください)`,
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
  const options: string[] = [];
  const spans: DslSpan[] = [];
  const seen = new Set<string>();
  let hasError = false;

  for (const span of optionSpans) {
    if (span.start === span.end) {
      diagnostics.push({ message: "choice option が空です。", span, code: "invalid-choice-type" });
      hasError = true;
      continue;
    }
    // All option-token classification routes through scanScalarLiteral
    // (Task 09) exclusively - it already distinguishes bare choice
    // identifiers from the reserved true/false boolean tokens.
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
      options.push(token.raw);
      spans.push(token.span);
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

  if (hasError) return { declaredType: null, choiceOptionSpans: spans };
  return { declaredType: { kind: "choice", options }, choiceOptionSpans: spans };
};

// Declarations never open a block (opensBlock is always false below), so
// unlike parseDslSettingsStatement/parseDslCallStatement this parser takes
// no `{opensBlock}` caller hint - there is nothing for it to affect.
export const parseDslTypedDeclarationStatement = (logicalText: string): DslDeclarationParseResult => {
  const diagnostics: DslDeclarationDiagnostic[] = [];
  const keyword = leadingIdentifier.exec(logicalText)?.[0];
  if (keyword !== "const" && keyword !== "let") return { statement: null, diagnostics };

  const keywordSpan: DslSpan = { start: 0, end: keyword.length };
  const rest = trimSpan(logicalText, keyword.length, logicalText.length);

  const colon = topLevelIndex(logicalText, ":", rest.start, rest.end);
  const equals = topLevelIndex(logicalText, "=", colon >= 0 ? colon + 1 : rest.start, rest.end);

  const nameSpanRaw = trimSpan(logicalText, rest.start, colon >= 0 ? colon : equals >= 0 ? equals : rest.end);
  const name = parseName(logicalText, nameSpanRaw);
  if (!name.nameSpan) diagnostics.push({ message: `${keyword} には名前が必要です。`, span: keywordSpan });

  if (colon < 0) {
    diagnostics.push({ message: `${keyword} には型注釈(: 型)が必要です。`, span: keywordSpan, code: MISSING_DECLARED_TYPE_CODE });
  }
  const typeSpan: DslSpan =
    colon >= 0 ? trimSpan(logicalText, colon + 1, equals >= 0 ? equals : rest.end) : { start: rest.end, end: rest.end };
  if (colon >= 0 && typeSpan.start === typeSpan.end) {
    diagnostics.push({ message: `${keyword} には型注釈(: 型)が必要です。`, span: { start: colon, end: colon + 1 } });
  }

  if (equals < 0) {
    diagnostics.push({ message: `${keyword} には初期化式(= 値)が必要です。`, span: keywordSpan });
  }
  const initializerSpan = trimSpan(logicalText, equals >= 0 ? equals + 1 : rest.end, rest.end);
  if (equals >= 0 && initializerSpan.start === initializerSpan.end) {
    diagnostics.push({ message: "初期化式には「=」の後に値が必要です。", span: initializerSpan });
  }

  const { declaredType, choiceOptionSpans, numericTypeOptions } =
    typeSpan.start === typeSpan.end
      ? { declaredType: null as ScalarType | null, choiceOptionSpans: [] as DslSpan[] }
      : parseDeclaredType(logicalText, typeSpan, diagnostics);

  const payloadSpans: Record<string, DslSpan> = {};
  if (name.nameSpan) payloadSpans.name = name.nameSpan;
  if (typeSpan.start !== typeSpan.end) payloadSpans.type = typeSpan;
  if (initializerSpan.start !== initializerSpan.end) payloadSpans.initializer = initializerSpan;

  return {
    statement: {
      kind: "typedDeclaration",
      bindingKind: keyword,
      ...name,
      keywordSpan,
      declaredType,
      choiceOptionSpans,
      ...(numericTypeOptions ? { numericTypeOptions } : {}),
      initializer: logicalText.slice(initializerSpan.start, initializerSpan.end),
      payloadSpans,
      args: [],
      attrs: [],
      opensBlock: false
    },
    diagnostics
  };
};
