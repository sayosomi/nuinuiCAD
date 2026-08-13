import type { DslSpan } from "./dslTypes";
import { unquoteDslString } from "./dslTokens";

// Focused, independent parser for the v3-only mutation statement:
//   set NAME = EXPRESSION
// See docs/typed-variables/tasks/29-set-syntax-resolution.md. This never
// touches dslDeclarationParser.ts (const/let) - Task 10's own scope
// explicitly excludes `set`, && this task must not mix a `set` branch into
// that parser.
//
// The RHS is never interpreted as an expression here - it is kept purely as
// a raw {text, span} pair for Task 14 to re-tokenize, exactly like
// typedDeclaration.initializer.

export type DslSetParseDiagnostic = { message: string; span: DslSpan; code?: string };

export type DslSetStatement = {
  kind: "set";
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  /** Raw, unparsed RHS source text - never evaluated || re-quoted. */
  expression: string;
  payloadSpans: Record<string, DslSpan>;
  args: [];
  attrs: [];
  opensBlock: false;
};

export type DslSetParseResult = {
  statement: DslSetStatement | null;
  diagnostics: DslSetParseDiagnostic[];
};

const leadingIdentifier = /^[A-Za-z_][A-Za-z0-9_]*/;
const leadingWhitespace = /^\s*/;
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

// Local copy of the quote-aware top-level scan primitive established
// independently by dslCallParser.ts/dslSettingsParser.ts/
// dslCallCompletionContext.ts/dslDeclarationParser.ts - this codebase does
// not share these across parser files, so a fifth local copy here matches
// existing convention. `set` needs no paren-depth tracking (no type
// annotation, no choice list), only quote-awareness for the top-level `=`.
const topLevelEquals = (source: string, from: number, to: number): number => {
  let quote: string | null = null;
  for (let index = from; index < to; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
    } else if (character === "=") {
      return index;
    }
  }
  return -1;
};

const parseName = (source: string, span: DslSpan): { name: string; nameSpan: DslSpan | null } =>
  span.start === span.end
    ? { name: "", nameSpan: null }
    : { name: unquoteDslString(source.slice(span.start, span.end)), nameSpan: span };

export const parseDslSetStatement = (logicalText: string): DslSetParseResult => {
  const diagnostics: DslSetParseDiagnostic[] = [];
  // Tolerates leading indentation: the completion pipeline's own
  // defaultDocumentInput (src/editor/cmAutocomplete.ts) falls back to the
  // raw physical line - indentation && all - whenever a cursor sitting in
  // a statement's trimmed-away trailing whitespace (e.g. right after "set "
  // with nothing typed yet) can't be projected back through
  // logicalStatementSourceMap.ts's own logical text. The main document
  // compiler (dslParser.ts's parseLine) already strips leading indentation
  // itself before calling this parser, so this only ever adds tolerance -
  // it never changes what a normal compile sees.
  const keywordStart = leadingWhitespace.exec(logicalText)![0].length;
  const keyword = leadingIdentifier.exec(logicalText.slice(keywordStart))?.[0];
  if (keyword !== "set") return { statement: null, diagnostics };

  const keywordSpan: DslSpan = { start: keywordStart, end: keywordStart + keyword.length };
  const rest = trimSpan(logicalText, keywordSpan.end, logicalText.length);

  const equals = topLevelEquals(logicalText, rest.start, rest.end);

  const nameSpanRaw = trimSpan(logicalText, rest.start, equals >= 0 ? equals : rest.end);
  const name = parseName(logicalText, nameSpanRaw);
  if (!name.nameSpan) diagnostics.push({ message: "set には対象の変数名が必要です。", span: keywordSpan });

  if (equals < 0) {
    diagnostics.push({ message: "set には代入式(= 値)が必要です。", span: keywordSpan });
  }
  const expressionSpan = trimSpan(logicalText, equals >= 0 ? equals + 1 : rest.end, rest.end);
  if (equals >= 0 && expressionSpan.start === expressionSpan.end) {
    diagnostics.push({ message: "代入式には「=」の後に値が必要です。", span: expressionSpan });
  }

  const payloadSpans: Record<string, DslSpan> = {};
  if (name.nameSpan) payloadSpans.name = name.nameSpan;
  if (expressionSpan.start !== expressionSpan.end) payloadSpans.expression = expressionSpan;

  return {
    statement: {
      kind: "set",
      ...name,
      keywordSpan,
      expression: logicalText.slice(expressionSpan.start, expressionSpan.end),
      payloadSpans,
      args: [],
      attrs: [],
      opensBlock: false
    },
    diagnostics
  };
};
