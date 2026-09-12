import type { DslSpan } from "./dslTypes";
import { parseDslSourceReference } from "./dslReferenceTokens";
import { parseScalarExpression } from "../scalars/expressionParser";
import {
  isScalarIdentifierCharacterAt,
  isScalarIdentifierStartCharacter
} from "../scalars/literalScanner";

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
  | { kind: "none"; span: DslSpan }
  | {
      kind: "literal";
      span: DslSpan;
      members: readonly GeometryArrayLiteralMember[];
    }
  | {
      kind: "reference";
      span: DslSpan;
      text: string;
    }
  | {
      kind: "valueFor";
      span: DslSpan;
      binder: string;
      binderSpan: DslSpan;
      sourceText: string;
      sourceSpan: DslSpan;
      bodySpan: DslSpan;
    }
  | {
      kind: "if";
      span: DslSpan;
      conditionText: string;
      conditionSpan: DslSpan;
      thenBranch: GeometryArrayExpression;
      elseBranch: GeometryArrayExpression | null;
    }
  | {
      kind: "match";
      span: DslSpan;
      scrutineeText: string;
      scrutineeSpan: DslSpan;
      arms: readonly {
        label: string;
        labelSpan: DslSpan;
        binder?: string;
        binderSpan?: DslSpan;
        expression: GeometryArrayExpression;
        }[];
    }
  | {
      kind: "coalesce";
      span: DslSpan;
      left: GeometryArrayExpression;
      right: GeometryArrayExpression;
    }

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

const matchingBraceClose = (source: string, open: number, end: number) => {
  let quote: string | null = null;
  let depth = 0;
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
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const firstUnquotedBrace = (source: string, start: number, end: number) => {
  let quote: string | null = null;
  for (let index = start; index < end; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
      continue;
    }
    if (character === "{") return index;
  }
  return -1;
};

const codePointWidthAt = (source: string, index: number) => {
  const codePoint = source.codePointAt(index);
  return codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
};

const identifierStartAt = (source: string, index: number) => {
  const codePoint = source.codePointAt(index);
  return codePoint !== undefined && isScalarIdentifierStartCharacter(String.fromCodePoint(codePoint));
};

const identifierPartAt = isScalarIdentifierCharacterAt;

const keywordAt = (source: string, span: DslSpan, keyword: string) =>
  source.slice(span.start, span.start + keyword.length) === keyword &&
  !identifierPartAt(source, span.start - 1) &&
  !identifierPartAt(source, span.start + keyword.length);

const matchingDelimiter = (source: string, open: number, end: number, left: string, right: string) => {
  let quote: string | null = null;
  let depth = 0;
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
    if (character === left) depth += 1;
    else if (character === right) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const firstTopLevelBrace = (source: string, start: number, end: number) => {
  let quote: string | null = null;
  let parenDepth = 0;
  let squareDepth = 0;
  for (let index = start; index < end; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
      continue;
    }
    if (character === "(") parenDepth += 1;
    else if (character === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (character === "[") squareDepth += 1;
    else if (character === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (character === "{" && parenDepth === 0 && squareDepth === 0) return index;
  }
  return -1;
};

const topLevelCoalesceOperator = (source: string, span: DslSpan): number => {
  let quote: string | null = null;
  let squareDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  for (let index = span.start; index < span.end - 1; index += 1) {
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
    else if (character === "?" && source[index + 1] === "?" && squareDepth === 0 && parenDepth === 0 && braceDepth === 0) return index;
  }
  return -1;
};

const parseNested = (source: string, span: DslSpan): GeometryArrayExpressionParseResult => parseGeometryArrayExpression(source, span);

const scalarSyntaxDiagnostics = (source: string, span: DslSpan): GeometryArrayExpressionDiagnostic[] =>
  parseScalarExpression(source, span).diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    span: diagnostic.span
  }));

const parseValueIf = (source: string, span: DslSpan): GeometryArrayExpressionParseResult => {
  let cursor = span.start + 2;
  while (cursor < span.end && whitespace.test(source[cursor]!)) cursor += 1;
  if (source[cursor] !== "(") {
    return { expression: null, diagnostics: [{ code: "value-if-malformed-condition", message: "value-if の条件は「if (条件)」の形で指定してください。", span }] };
  }
  const conditionClose = matchingDelimiter(source, cursor, span.end, "(", ")");
  if (conditionClose < 0) {
    return { expression: null, diagnostics: [{ code: "value-if-malformed-condition", message: "value-if の条件を閉じる「)」がありません。", span: { start: cursor, end: cursor + 1 } }] };
  }
  const conditionSpan = trimSpan(source, cursor + 1, conditionClose);
  const conditionDiagnostics = scalarSyntaxDiagnostics(source, conditionSpan);
  if (conditionDiagnostics.length > 0) return { expression: null, diagnostics: conditionDiagnostics };
  cursor = conditionClose + 1;
  while (cursor < span.end && whitespace.test(source[cursor]!)) cursor += 1;
  if (source[cursor] !== "{") {
    return { expression: null, diagnostics: [{ code: "value-if-malformed-branch", message: "value-if の then ブランチは「{ 式 }」の形で指定してください。", span: { start: cursor, end: Math.min(span.end, cursor + 1) } }] };
  }
  const thenClose = matchingDelimiter(source, cursor, span.end, "{", "}");
  if (thenClose < 0) {
    return { expression: null, diagnostics: [{ code: "value-if-malformed-branch", message: "value-if の then ブランチを閉じる「}」がありません。", span: { start: cursor, end: cursor + 1 } }] };
  }
  const thenResult = parseNested(source, trimSpan(source, cursor + 1, thenClose));
  cursor = thenClose + 1;
  while (cursor < span.end && whitespace.test(source[cursor]!)) cursor += 1;
  const elseSpan = { start: cursor, end: Math.min(span.end, cursor + 4) };
  if (!keywordAt(source, elseSpan, "else")) {
    const trailing = trimSpan(source, thenClose + 1, span.end);
    if (trailing.start !== trailing.end) return { expression: null, diagnostics: [{ code: "geometry-array-trailing-token", message: "value-if の後に余分なトークンがあります。", span: trailing }] };
    if (!thenResult.expression) return { expression: null, diagnostics: thenResult.diagnostics };
    return {
      expression: { kind: "if", span, conditionText: source.slice(conditionSpan.start, conditionSpan.end), conditionSpan, thenBranch: thenResult.expression, elseBranch: null },
      diagnostics: thenResult.diagnostics
    };
  }
  cursor += 4;
  while (cursor < span.end && whitespace.test(source[cursor]!)) cursor += 1;
  if (source[cursor] !== "{") {
    return { expression: null, diagnostics: [{ code: "value-if-malformed-branch", message: "value-if の else ブランチは「{ 式 }」の形で指定してください。", span: { start: cursor, end: Math.min(span.end, cursor + 1) } }] };
  }
  const elseClose = matchingDelimiter(source, cursor, span.end, "{", "}");
  if (elseClose < 0) {
    return { expression: null, diagnostics: [{ code: "value-if-malformed-branch", message: "value-if の else ブランチを閉じる「}」がありません。", span: { start: cursor, end: cursor + 1 } }] };
  }
  const elseResult = parseNested(source, trimSpan(source, cursor + 1, elseClose));
  const trailing = trimSpan(source, elseClose + 1, span.end);
  if (trailing.start !== trailing.end) {
    return { expression: null, diagnostics: [{ code: "geometry-array-trailing-token", message: "value-if の後に余分なトークンがあります。", span: trailing }] };
  }
  const diagnostics = [...thenResult.diagnostics, ...elseResult.diagnostics];
  if (!thenResult.expression || !elseResult.expression) return { expression: null, diagnostics };
  return {
    expression: { kind: "if", span, conditionText: source.slice(conditionSpan.start, conditionSpan.end), conditionSpan, thenBranch: thenResult.expression, elseBranch: elseResult.expression },
    diagnostics
  };
};

const nextMatchArm = (source: string, start: number, end: number) => {
  let quote: string | null = null;
  let squareDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  for (let index = start; index < end; index += 1) {
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
    else if (character === "}") {
      if (braceDepth === 0 && squareDepth === 0 && parenDepth === 0) return index;
      braceDepth = Math.max(0, braceDepth - 1);
    }
    if (squareDepth || parenDepth || braceDepth) continue;
    if (identifierStartAt(source, index)) {
      let cursor = index + codePointWidthAt(source, index);
      while (cursor < end && identifierPartAt(source, cursor)) cursor += codePointWidthAt(source, cursor);
      let arrow = cursor;
      while (arrow < end && whitespace.test(source[arrow]!)) arrow += 1;
      if (source.slice(arrow, arrow + 2) === "=>") return index;
      if (source.slice(index, cursor) === "some" && identifierStartAt(source, arrow)) {
        let binderEnd = arrow + codePointWidthAt(source, arrow);
        while (binderEnd < end && identifierPartAt(source, binderEnd)) binderEnd += codePointWidthAt(source, binderEnd);
        let binderArrow = binderEnd;
        while (binderArrow < end && whitespace.test(source[binderArrow]!)) binderArrow += 1;
        if (source.slice(binderArrow, binderArrow + 2) === "=>") return index;
      }
      index = cursor - 1;
    }
  }
  return end;
};

const parseValueMatch = (source: string, span: DslSpan): GeometryArrayExpressionParseResult => {
  let cursor = span.start + 5;
  while (cursor < span.end && whitespace.test(source[cursor]!)) cursor += 1;
  const open = firstTopLevelBrace(source, cursor, span.end);
  if (open < 0) return { expression: null, diagnostics: [{ code: "value-match-malformed", message: "match には「{ ケース }」の本体が必要です。", span }] };
  const scrutineeSpan = trimSpan(source, cursor, open);
  if (scrutineeSpan.start === scrutineeSpan.end) return { expression: null, diagnostics: [{ code: "value-match-missing-scrutinee", message: "match にはscrutinee式が必要です。", span: { start: open, end: open + 1 } }] };
  const scrutineeDiagnostics = scalarSyntaxDiagnostics(source, scrutineeSpan);
  if (scrutineeDiagnostics.length > 0) return { expression: null, diagnostics: scrutineeDiagnostics };
  const close = matchingDelimiter(source, open, span.end, "{", "}");
  if (close < 0) return { expression: null, diagnostics: [{ code: "value-match-missing-closing-brace", message: "match を閉じる「}」がありません。", span: { start: open, end: open + 1 } }] };
  const arms: { label: string; labelSpan: DslSpan; binder?: string; binderSpan?: DslSpan; expression: GeometryArrayExpression }[] = [];
  const diagnostics: GeometryArrayExpressionDiagnostic[] = [];
  cursor = open + 1;
  while (true) {
    while (cursor < close && whitespace.test(source[cursor]!)) cursor += 1;
    if (cursor === close) break;
    const labelStart = cursor;
    if (!identifierStartAt(source, cursor)) {
      diagnostics.push({ code: "value-match-malformed-arm", message: "match ケースはchoice optionラベルで始めてください。", span: { start: cursor, end: Math.min(close, cursor + 1) } });
      break;
    }
    cursor += codePointWidthAt(source, cursor);
    while (cursor < close && identifierPartAt(source, cursor)) cursor += codePointWidthAt(source, cursor);
    const labelSpan = { start: labelStart, end: cursor };
    while (cursor < close && whitespace.test(source[cursor]!)) cursor += 1;
    let binder: string | undefined;
    let binderSpan: DslSpan | undefined;
    if (source.slice(labelStart, cursor).trim() === "some") {
      const candidateStart = cursor;
      if (identifierStartAt(source, candidateStart)) {
        let candidateEnd = candidateStart + codePointWidthAt(source, candidateStart);
        while (candidateEnd < close && identifierPartAt(source, candidateEnd)) candidateEnd += codePointWidthAt(source, candidateEnd);
        let arrow = candidateEnd;
        while (arrow < close && whitespace.test(source[arrow]!)) arrow += 1;
        if (source.slice(arrow, arrow + 2) === "=>") {
          binder = source.slice(candidateStart, candidateEnd);
          binderSpan = { start: candidateStart, end: candidateEnd };
          cursor = arrow;
        }
      }
    }
    if (source.slice(cursor, cursor + 2) !== "=>") {
      diagnostics.push({ code: "value-match-missing-arrow", message: "match ケースには「=>」が必要です。", span: { start: cursor, end: Math.min(close, cursor + 2) } });
      break;
    }
    cursor += 2;
    const bodyStart = cursor;
    const bodyEnd = nextMatchArm(source, bodyStart, close);
    const bodySpan = trimSpan(source, bodyStart, bodyEnd);
    const body = parseNested(source, bodySpan);
    diagnostics.push(...body.diagnostics);
    if (body.expression) arms.push({ label: source.slice(labelSpan.start, labelSpan.end), labelSpan, ...(binder ? { binder, binderSpan } : {}), expression: body.expression });
    cursor = bodyEnd;
  }
  const trailing = trimSpan(source, close + 1, span.end);
  if (trailing.start !== trailing.end) diagnostics.push({ code: "geometry-array-trailing-token", message: "match の後に余分なトークンがあります。", span: trailing });
  return diagnostics.length || arms.length === 0
    ? { expression: null, diagnostics }
    : { expression: { kind: "match", span, scrutineeText: source.slice(scrutineeSpan.start, scrutineeSpan.end), scrutineeSpan, arms }, diagnostics };
};

const parseValueFor = (source: string, span: DslSpan): GeometryArrayExpressionParseResult => {
  let cursor = span.start + 3;
  while (cursor < span.end && whitespace.test(source[cursor]!)) cursor += 1;
  const binderStart = cursor;
  if (!identifierStartAt(source, cursor)) return {
    expression: null,
    diagnostics: [{ code: "geometry-array-value-for-invalid", message: "value-for の binder が不正です。", span: { start: binderStart, end: Math.min(span.end, binderStart + 1) } }]
  };
  cursor += codePointWidthAt(source, cursor);
  while (cursor < span.end && identifierPartAt(source, cursor)) cursor += codePointWidthAt(source, cursor);
  const binderSpan = { start: binderStart, end: cursor };
  const binder = source.slice(binderSpan.start, binderSpan.end);
  const inStart = cursor;
  while (cursor < span.end && whitespace.test(source[cursor]!)) cursor += 1;
  if (source.slice(cursor, cursor + 2) !== "in" || identifierPartAt(source, cursor - 1) || identifierPartAt(source, cursor + 2)) {
    return { expression: null, diagnostics: [{ code: "geometry-array-value-for-invalid", message: "value-for には `in @collection` が必要です。", span: { start: inStart, end: Math.min(span.end, cursor + 2) } }] };
  }
  cursor += 2;
  while (cursor < span.end && whitespace.test(source[cursor]!)) cursor += 1;
  const open = firstUnquotedBrace(source, cursor, span.end);
  if (open < 0) return { expression: null, diagnostics: [{ code: "geometry-array-value-for-invalid", message: "value-for body の `{` がありません。", span: { start: span.end, end: span.end } }] };
  const sourceSpan = trimSpan(source, cursor, open);
  const sourceReference = parseDslSourceReference(source.slice(sourceSpan.start, sourceSpan.end));
  if (sourceReference.kind !== "valid" || sourceReference.reference.property) {
    return { expression: null, diagnostics: [{ code: "geometry-array-value-for-invalid", message: "value-for の source には whole-value collection reference が必要です。", span: sourceSpan }] };
  }
  const close = matchingBraceClose(source, open, span.end);
  if (close < 0) return { expression: null, diagnostics: [{ code: "geometry-array-value-for-invalid", message: "value-for body の `{` が閉じられていません。", span: { start: open, end: open + 1 } }] };
  const trailing = trimSpan(source, close + 1, span.end);
  if (trailing.start !== trailing.end) return { expression: null, diagnostics: [{ code: "geometry-array-value-for-invalid", message: "value-for body の後に余分なトークンがあります。", span: trailing }] };
  return {
    expression: {
      kind: "valueFor",
      span,
      binder,
      binderSpan,
      sourceText: source.slice(sourceSpan.start, sourceSpan.end),
      sourceSpan,
      bodySpan: trimSpan(source, open + 1, close)
    },
    diagnostics: []
  };
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

  const coalesceIndex = topLevelCoalesceOperator(source, span);
  if (coalesceIndex >= 0) {
    const leftSpan = trimSpan(source, span.start, coalesceIndex);
    const rightSpan = trimSpan(source, coalesceIndex + 2, span.end);
    const diagnostics: GeometryArrayExpressionDiagnostic[] = [];
    if (leftSpan.start === leftSpan.end) {
      diagnostics.push({ code: "coalesce-missing-left", message: "?? には左辺の collection 値が必要です。", span: { start: coalesceIndex, end: coalesceIndex + 2 } });
    }
    if (rightSpan.start === rightSpan.end) {
      diagnostics.push({ code: "coalesce-missing-right", message: "?? には右辺の collection 値が必要です。", span: { start: coalesceIndex, end: coalesceIndex + 2 } });
    }
    const left = leftSpan.start === leftSpan.end ? null : parseNested(source, leftSpan);
    const right = rightSpan.start === rightSpan.end ? null : parseNested(source, rightSpan);
    if (left) diagnostics.push(...left.diagnostics);
    if (right) diagnostics.push(...right.diagnostics);
    return left?.expression && right?.expression && diagnostics.length === 0
      ? { expression: { kind: "coalesce", span, left: left.expression, right: right.expression }, diagnostics }
      : { expression: null, diagnostics };
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

  if (source.slice(span.start, span.start + 3) === "for" && !identifierPartAt(source, span.start + 3)) {
    return parseValueFor(source, span);
  }

  if (keywordAt(source, span, "if")) return parseValueIf(source, span);
  if (keywordAt(source, span, "match")) return parseValueMatch(source, span);

  const text = source.slice(span.start, span.end);
  if (text.trim() === "none") return { expression: { kind: "none", span: trimSpan(source, span.start, span.end) }, diagnostics: [] };
  const reference = parseDslSourceReference(text);
  if (reference.kind === "valid") {
    return { expression: { kind: "reference", span, text }, diagnostics: [] };
  }
  return {
    expression: null,
    diagnostics: [{
      code: "geometry-array-invalid-expression",
      message: "collection は array literal、value if/match、value-for、または whole-value @reference で初期化してください。",
      span
    }]
  };
};
