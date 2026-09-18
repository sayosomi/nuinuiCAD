import type { DslDiagnosticPresentation, DslSpan } from "./dslTypes";
import { unquoteDslString } from "./dslTokens";

export type DslNextStatement = {
  kind: "next";
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  expression: string;
  expressionSpan: DslSpan;
  payloadSpans: Record<string, DslSpan>;
  args: [];
  attrs: [];
  opensBlock: false;
};

export type DslNextDiagnostic = {
  message: string;
  span: DslSpan;
  code?: string;
  presentation?: DslDiagnosticPresentation;
};

export type DslNextParseResult = {
  statement: DslNextStatement | null;
  diagnostics: DslNextDiagnostic[];
};

const identifier = /^[A-Za-z_][A-Za-z0-9_]*/;
const whitespace = /\s/;

const trimSpan = (source: string, start: number, end: number): DslSpan => {
  while (start < end && whitespace.test(source[start] ?? "")) start += 1;
  while (end > start && whitespace.test(source[end - 1] ?? "")) end -= 1;
  return { start, end };
};

const escaped = (source: string, index: number) => {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
};

const topLevelEquals = (source: string, start: number): number => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
    } else if ((character === "(" || character === "[") && depth >= 0) {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth -= 1;
    } else if (character === "=" && depth === 0) {
      return index;
    }
  }
  return -1;
};

export const parseDslNextStatement = (logicalText: string): DslNextParseResult => {
  const diagnostics: DslNextDiagnostic[] = [];
  const keywordMatch = logicalText.match(/^next\b/);
  if (!keywordMatch) return { statement: null, diagnostics };
  const keywordSpan = { start: 0, end: 4 };
  const rest = trimSpan(logicalText, keywordSpan.end, logicalText.length);
  const nameMatch = identifier.exec(logicalText.slice(rest.start));
  if (!nameMatch) {
    diagnostics.push({ message: "next には対象の carry 名が必要です。", span: keywordSpan, code: "missing-next-target" });
    return { statement: null, diagnostics };
  }
  const nameSpan = { start: rest.start, end: rest.start + nameMatch[0].length };
  const equals = topLevelEquals(logicalText, nameSpan.end);
  if (equals < 0) {
    diagnostics.push({ message: "next には `name = expression` の式が必要です。", span: nameSpan, code: "missing-next-expression" });
  }
  const expressionSpan = trimSpan(logicalText, equals >= 0 ? equals + 1 : nameSpan.end, logicalText.length);
  if (equals >= 0 && expressionSpan.start === expressionSpan.end) {
    diagnostics.push({ message: "next の式には値が必要です。", span: { start: equals, end: equals + 1 }, code: "missing-next-expression" });
  }
  const payloadSpans: Record<string, DslSpan> = { name: nameSpan, expression: expressionSpan };
  return {
    statement: {
      kind: "next",
      name: unquoteDslString(logicalText.slice(nameSpan.start, nameSpan.end)),
      nameSpan,
      keywordSpan,
      expression: logicalText.slice(expressionSpan.start, expressionSpan.end),
      expressionSpan,
      payloadSpans,
      args: [],
      attrs: [],
      opensBlock: false
    },
    diagnostics
  };
};
