import { parseDslTypedDeclarationStatement } from "./dslDeclarationParser";

const numericTypeOptionKeys = ["step", "min", "max"] as const;

export type DslNumericTypeOptionCompletionContext = {
  from: number;
  to: number;
  options: readonly (typeof numericTypeOptionKeys)[number][];
};

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const optionWithValue = /^\s*(step|min|max)\s*:/;

const closingParen = (source: string, open: number, end: number) => {
  let depth = 0;
  for (let index = open; index < end; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")" && --depth === 0) return index;
  }
  return end;
};

const usedKeysBefore = (source: string, start: number, end: number) => new Set(
  source.slice(start, end).split(",")
    .map((part) => optionWithValue.exec(part)?.[1])
    .filter((key): key is (typeof numericTypeOptionKeys)[number] => key === "step" || key === "min" || key === "max")
);

/**
 * Detects a key-position inside an incomplete `number(...)` type annotation.
 * It deliberately accepts declarations that the full parser still diagnoses
 * as incomplete, while delegating declaration/type boundaries to that parser.
 */
export const numericTypeOptionCompletionContextAt = (
  logicalText: string,
  pos: number
): DslNumericTypeOptionCompletionContext | null => {
  const { statement } = parseDslTypedDeclarationStatement(logicalText);
  const typeSpan = statement?.payloadSpans.type;
  if (!statement || !typeSpan) return null;

  // Declaration payload spans trim trailing whitespace. While an opening
  // parenthesis is still unmatched, that whitespace remains an editable key
  // position rather than the end of the type annotation.
  const typeEnd = pos >= typeSpan.end && /^\s*$/.test(logicalText.slice(typeSpan.end, pos)) ? pos : typeSpan.end;
  const typeText = logicalText.slice(typeSpan.start, typeEnd);
  const openOffset = typeText.search(/^number\s*\(/);
  if (openOffset !== 0) return null;
  const open = typeSpan.start + typeText.indexOf("(");
  const close = closingParen(logicalText, open, typeEnd);
  if (pos < open + 1 || pos > close) return null;

  const lastComma = logicalText.lastIndexOf(",", pos - 1);
  const fieldStart = lastComma < open ? open + 1 : lastComma + 1;
  const fieldEnd = logicalText.indexOf(",", fieldStart);
  const boundedFieldEnd = fieldEnd < 0 || fieldEnd > close ? close : fieldEnd;
  const field = logicalText.slice(fieldStart, boundedFieldEnd);
  if (field.includes(":")) return null;

  const leadingWhitespace = field.match(/^\s*/)?.[0].length ?? 0;
  const keyStart = fieldStart + leadingWhitespace;
  const key = logicalText.slice(keyStart, boundedFieldEnd).trimEnd();
  if (key && !identifier.test(key)) return null;
  if (pos < keyStart || pos > boundedFieldEnd) return null;

  const used = usedKeysBefore(logicalText, open + 1, close);
  const options = numericTypeOptionKeys.filter((candidate) => !used.has(candidate));
  if (options.length === 0) return null;
  return { from: key ? keyStart : pos, to: key ? keyStart + key.length : pos, options };
};
