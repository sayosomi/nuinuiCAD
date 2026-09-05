import type { DslSpan } from "./dslTypes";
import { parseDslSourceReference } from "./dslReferenceTokens";

export type GeometryArrayExpressionDiagnostic = {
  code: string;
  message: string;
  span: DslSpan;
};

export type GeometryArrayLiteralMember = {
  text: string;
  span: DslSpan;
};

export type GeometryArrayExpression =
  | {
      kind: "literal";
      span: DslSpan;
      members: readonly GeometryArrayLiteralMember[];
    }
  | {
      kind: "reference";
      span: DslSpan;
      text: string;
    };

export type GeometryArrayExpressionParseResult = {
  expression: GeometryArrayExpression | null;
  diagnostics: readonly GeometryArrayExpressionDiagnostic[];
};

const whitespace = /\s/;

const trimSpan = (source: string, start: number, end: number): DslSpan => {
  while (start < end && whitespace.test(source[start]!)) start += 1;
  while (end > start && whitespace.test(source[end - 1]!)) end -= 1;
  return { start, end };
};

const escaped = (source: string, index: number) => {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
};

const matchingSquareClose = (source: string, open: number, end: number) => {
  let quote: string | null = null;
  let squareDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  for (let index = open; index < end; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
      continue;
    }
    if (character === "[") squareDepth += 1;
    else if (character === "]") {
      squareDepth -= 1;
      if (squareDepth === 0 && parenDepth === 0 && braceDepth === 0) return index;
    } else if (character === "(") parenDepth += 1;
    else if (character === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (character === "{") braceDepth += 1;
    else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
  }
  return -1;
};

const splitMembers = (source: string, span: DslSpan) => {
  const members: GeometryArrayLiteralMember[] = [];
  const diagnostics: GeometryArrayExpressionDiagnostic[] = [];
  let quote: string | null = null;
  let squareDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let start = span.start;

  const push = (end: number, separatorSpan: DslSpan | null) => {
    const memberSpan = trimSpan(source, start, end);
    if (memberSpan.start === memberSpan.end) {
      if (separatorSpan || span.start !== span.end) {
        diagnostics.push({
          code: "geometry-array-empty-member",
          message: "geometry array の member が空です。",
          span: separatorSpan ?? memberSpan
        });
      }
    } else {
      const text = source.slice(memberSpan.start, memberSpan.end);
      if (text.trimStart().startsWith("[")) {
        diagnostics.push({
          code: "geometry-array-nested-array",
          message: "geometry array の member に nested array は使用できません。",
          span: memberSpan
        });
      }
      members.push({ text, span: memberSpan });
    }
    start = end + 1;
  };

  for (let index = span.start; index < span.end; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
      continue;
    }
    if (character === "[") squareDepth += 1;
    else if (character === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (character === "(") parenDepth += 1;
    else if (character === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (character === "{") braceDepth += 1;
    else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (character === "," && squareDepth === 0 && parenDepth === 0 && braceDepth === 0) {
      push(index, { start: index, end: index + 1 });
    }
  }
  if (start < span.end) push(span.end, null);
  return { members, diagnostics };
};

/**
 * Parse the two source forms owned by immutable geometry arrays: an ordered
 * array literal or a whole-value `@reference`. Member type/reference
 * resolution is intentionally left to the shared geometry semantic owner.
 */
export const parseGeometryArrayExpression = (
  source: string,
  sourceSpan: DslSpan = { start: 0, end: source.length }
): GeometryArrayExpressionParseResult => {
  const span = trimSpan(source, sourceSpan.start, sourceSpan.end);
  if (span.start === span.end) {
    return {
      expression: null,
      diagnostics: [{
        code: "geometry-array-expression-empty",
        message: "geometry array には初期化値が必要です。",
        span
      }]
    };
  }

  if (source[span.start] === "[") {
    const close = matchingSquareClose(source, span.start, span.end);
    if (close < 0) {
      return {
        expression: null,
        diagnostics: [{
          code: "geometry-array-unclosed-literal",
          message: "geometry array literal の「[」が閉じられていません。",
          span: { start: span.start, end: span.start + 1 }
        }]
      };
    }
    const trailing = trimSpan(source, close + 1, span.end);
    if (trailing.start !== trailing.end) {
      return {
        expression: null,
        diagnostics: [{
          code: "geometry-array-trailing-token",
          message: "geometry array literal の後に余分なトークンがあります。",
          span: trailing
        }]
      };
    }
    const inner = { start: span.start + 1, end: close };
    const split = splitMembers(source, inner);
    return {
      expression: { kind: "literal", span: { start: span.start, end: close + 1 }, members: split.members },
      diagnostics: split.diagnostics
    };
  }

  const text = source.slice(span.start, span.end);
  const reference = parseDslSourceReference(text);
  if (reference.kind === "valid") {
    return { expression: { kind: "reference", span, text }, diagnostics: [] };
  }
  return {
    expression: null,
    diagnostics: [{
      code: "geometry-array-invalid-expression",
      message: "geometry array は array literal または whole-value @reference で初期化してください。",
      span
    }]
  };
};
