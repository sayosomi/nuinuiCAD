import { scanCallArgs } from "./dslArgScanner";
import { isBareDslIdentifierChar } from "./dslTokens";
import type { DslCompletionContext } from "./dslCompletionContext";

const identifierPart = (value: string | undefined) => Boolean(value && isBareDslIdentifierChar(value));

const tokenStart = (source: string, pos: number, floor: number) => {
  let start = pos;
  while (start > floor && identifierPart(source[start - 1])) start -= 1;
  return start;
};

const topLevelOpenParen = (source: string, from: number) => {
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === "(") {
      if (depth === 0) return index;
      depth += 1;
    } else if (source[index] === ")" && depth > 0) depth -= 1;
  }
  return -1;
};

const matchingCloseParen = (source: string, open: number) => {
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")" && --depth === 0) {
      return index;
    }
  }
  return -1;
};

const topLevelComma = (source: string, from: number, to: number) => {
  let depth = 0;
  for (let index = from; index < to; index += 1) {
    if (source[index] === "(" || source[index] === "[") depth += 1;
    else if (source[index] === ")" || source[index] === "]") depth -= 1;
    else if (source[index] === "," && depth === 0) return index;
  }
  return -1;
};

export type DslModuleParameterTypeCompletionContext = {
  kind: "moduleParameterType";
  from: number;
  to: number;
};

/** Type-name completion is limited to Module definition parameter headers. */
export const dslModuleParameterTypeCompletionContextAt = (
  code: string,
  pos: number
): DslModuleParameterTypeCompletionContext | null => {
  const moduleMatch = /^\s*module\s+[^\s(=]+\s*\(/.exec(code);
  if (!moduleMatch) return null;
  const open = moduleMatch[0].lastIndexOf("(");
  if (open < 0 || pos < open + 1) return null;
  const prefix = code.slice(open + 1, pos);
  let depth = 0;
  let segmentStart = 0;
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] === "(") depth += 1;
    else if (prefix[index] === ")") depth = Math.max(0, depth - 1);
    else if (prefix[index] === "," && depth === 0) segmentStart = index + 1;
  }
  const segment = prefix.slice(segmentStart);
  const colon = segment.indexOf(":");
  if (colon < 0) return null;
  const typeStart = open + 1 + segmentStart + colon + 1;
  const equals = segment.indexOf("=");
  const typeEnd = equals >= 0 ? open + 1 + segmentStart + equals : pos;
  if (pos > typeEnd) return null;
  let from = typeStart;
  while (from < typeEnd && /\s/.test(code[from] ?? "")) from += 1;
  let to = from;
  while (to < typeEnd && /[A-Za-z0-9_]/.test(code[to] ?? "")) to += 1;
  if (pos < from || pos > to) return null;
  return { kind: "moduleParameterType", from, to: pos };
};

const qualifiedMemberContextAt = (source: string, from: number, pos: number, argumentIndex: number): DslCompletionContext | null => {
  const qualified = source.slice(from, pos).match(new RegExp(`[^\\s"'#=()[\\]{},;:.]+::[^\\s"'#=()[\\]{},;:.]*$`));
  if (!qualified) return null;
  const separator = qualified[0].indexOf("::");
  return {
    kind: "moduleQualifiedMember",
    from: from + (qualified.index ?? 0) + separator + 2,
    to: pos,
    qualifiedInstanceName: qualified[0].slice(0, separator).replace(/^@/, ""),
    argumentIndex
  };
};


const currentInlineListMemberStart = (source: string, valueStart: number, pos: number) => {
  let first = valueStart;
  while (first < pos && /\s/.test(source[first] ?? "")) first += 1;
  if (source[first] !== "[") return valueStart;
  let start = first + 1;
  let quote: string | null = null;
  let depth = 0;
  for (let index = first + 1; index < pos; index += 1) {
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
  while (start < pos && /\s/.test(source[start] ?? "")) start += 1;
  return start;
};

/** Module calls use the ordinary module parser's spelling. This classifier is
 * only a cursor-shape adapter; semantic visibility && types stay in the
 * compiled ModuleSemanticAnalysis completion adapter. */
export const dslModuleCompletionContextAt = (code: string, pos: number): DslCompletionContext => {
  let cursor = 0;
  while (/\s/.test(code[cursor] ?? "")) cursor += 1;
  const keyword = (["module", "instance"] as const).find((candidate) =>
    code.slice(cursor, cursor + candidate.length) === candidate &&
    !identifierPart(code[cursor - 1]) &&
    !identifierPart(code[cursor + candidate.length])
  );
  if (!keyword) return null;
  cursor += keyword.length;
  while (/\s/.test(code[cursor] ?? "")) cursor += 1;
  const instanceStart = cursor;
  while (identifierPart(code[cursor])) cursor += 1;
  if (cursor === instanceStart) return null;
  while (/\s/.test(code[cursor] ?? "")) cursor += 1;
  if (code[cursor] === "(") {
    const optionClose = matchingCloseParen(code, cursor);
    if (optionClose < 0) return null;
    cursor = optionClose + 1;
    while (/\s/.test(code[cursor] ?? "")) cursor += 1;
  }
  if (code[cursor] !== "=") return null;
  cursor += 1;
  while (/\s/.test(code[cursor] ?? "")) cursor += 1;
  const calleeStart = cursor;
  const open = topLevelOpenParen(code, calleeStart);
  if (open < 0 || pos <= open) {
    const from = tokenStart(code, pos, calleeStart);
    if (from < calleeStart || pos < from) return null;
    return { kind: "moduleCallee", from, to: pos };
  }
  const contentStart = open + 1;
  const scanned = scanCallArgs(code, { start: contentStart, end: pos }).args;
  const containing = [...scanned].reverse().find((argument) => {
    const span = argument.valueSpan.start === argument.valueSpan.end && argument.rawValueSpan ? argument.rawValueSpan : argument.valueSpan;
    const argumentStart = argument.keySpan?.start ?? span.start;
    const isCurrentUnterminatedValue = argument === scanned[scanned.length - 1] && topLevelComma(code, argumentStart, pos) < 0;
    return pos >= argumentStart && (pos <= Math.max(span.end, argument.keySpan?.end ?? span.end) || isCurrentUnterminatedValue);
  });
  if (containing?.keySpan) {
    if (pos <= containing.keySpan.end) return { kind: "moduleArgumentLabel", from: containing.keySpan.start, to: pos, argumentIndex: scanned.indexOf(containing) };
    const valueFrom = containing.valueSpan.start === containing.valueSpan.end ? pos : containing.valueSpan.start;
    const memberFrom = currentInlineListMemberStart(code, valueFrom, pos);
    const qualifiedMember = qualifiedMemberContextAt(code, memberFrom, pos, scanned.indexOf(containing));
    if (qualifiedMember) return qualifiedMember;
    return { kind: "moduleArgumentValue", from: memberFrom, to: pos, argumentIndex: scanned.indexOf(containing) };
  }
  const segmentStart = (() => {
    let start = contentStart;
    let comma = topLevelComma(code, contentStart, Math.min(pos, code.length));
    while (comma >= 0) {
      start = comma + 1;
      const next = topLevelComma(code, start, Math.min(pos, code.length));
      if (next < 0) break;
      comma = next;
    }
    return start;
  })();
  const segment = code.slice(segmentStart, pos);
  const colon = segment.indexOf(":");
  if (colon < 0) {
    const from = tokenStart(code, pos, segmentStart);
    return { kind: "moduleArgumentLabel", from, to: pos, argumentIndex: scanned.length };
  }
  let valueStart = segmentStart + colon + 1;
  if (/\s$/.test(code.slice(valueStart, pos)) && code.slice(valueStart, pos).trim()) {
    return { kind: "moduleArgumentLabel", from: pos, to: pos, argumentIndex: scanned.length };
  }
  while (valueStart < pos && /\s/.test(code[valueStart])) valueStart += 1;
  return {
    kind: "moduleArgumentValue",
    from: currentInlineListMemberStart(code, valueStart, pos),
    to: pos,
    argumentIndex: Math.max(0, scanned.length - 1)
  };
};
