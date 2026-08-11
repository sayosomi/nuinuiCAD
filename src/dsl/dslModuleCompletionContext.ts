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

const topLevelComma = (source: string, from: number, to: number) => {
  let depth = 0;
  for (let index = from; index < to; index += 1) {
    if (source[index] === "(" || source[index] === "[") depth += 1;
    else if (source[index] === ")" || source[index] === "]") depth -= 1;
    else if (source[index] === "," && depth === 0) return index;
  }
  return -1;
};

/** Module calls use the ordinary module parser's spelling. This classifier is
 * only a cursor-shape adapter; semantic visibility and types stay in the
 * compiled ModuleSemanticAnalysis completion adapter. */
export const dslModuleCompletionContextAt = (code: string, pos: number): DslCompletionContext => {
  let cursor = 0;
  while (/\s/.test(code[cursor] ?? "")) cursor += 1;
  if (code.slice(cursor, cursor + 6) !== "module" || identifierPart(code[cursor - 1]) || identifierPart(code[cursor + 6])) return null;
  cursor += 6;
  while (/\s/.test(code[cursor] ?? "")) cursor += 1;
  const instanceStart = cursor;
  while (identifierPart(code[cursor])) cursor += 1;
  if (cursor === instanceStart) return null;
  while (/\s/.test(code[cursor] ?? "")) cursor += 1;
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
    return pos >= (argument.keySpan?.start ?? span.start) && pos <= Math.max(span.end, argument.keySpan?.end ?? span.end);
  });
  if (containing?.keySpan) {
    if (pos <= containing.keySpan.end) return { kind: "moduleArgumentLabel", from: containing.keySpan.start, to: pos, argumentIndex: scanned.indexOf(containing) };
    const valueFrom = containing.valueSpan.start === containing.valueSpan.end ? pos : containing.valueSpan.start;
    return { kind: "moduleArgumentValue", from: valueFrom, to: pos, argumentIndex: scanned.indexOf(containing) };
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
    from: valueStart,
    to: pos,
    argumentIndex: Math.max(0, scanned.length - 1)
  };
};
