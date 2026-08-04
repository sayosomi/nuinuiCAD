export type DslNameSelectionDirection = "currentOrNext" | "previous";

export type DslNameSelection = {
  start: number;
  end: number;
};

const nameBearingKeywords = new Set([
  "activeProfile",
  "activeView",
  "arc",
  "curve",
  "element",
  "group",
  "line",
  "point",
  "printLayout",
  "profile",
  "role",
  "text",
  "view"
]);

type TokenRange = {
  text: string;
  start: number;
  end: number;
};

const codeEndIndex = (line: string) => {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && !quote) return index;
  }
  return line.length;
};

const tokenRanges = (line: string) => {
  const ranges: TokenRange[] = [];
  const end = codeEndIndex(line);
  let start: number | null = null;
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < end; index += 1) {
    const char = line[index];
    if (start === null && /\s/.test(char)) continue;
    start ??= index;
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (!quote && (char === "(" || char === "[" || char === "{")) depth += 1;
    if (!quote && (char === ")" || char === "]" || char === "}")) depth -= 1;
    if (!quote && depth === 0 && /\s/.test(char)) {
      ranges.push({ text: line.slice(start, index), start, end: index });
      start = null;
    }
  }
  if (start !== null) ranges.push({ text: line.slice(start, end), start, end });
  return ranges;
};

const selectionInsideQuotes = (token: TokenRange): DslNameSelection => {
  const quote = token.text[0];
  if ((quote === "\"" || quote === "'") && token.text.at(-1) === quote && token.text.length >= 2) {
    return {
      start: token.start + 1,
      end: token.end - 1
    };
  }
  return { start: token.start, end: token.end };
};

export const dslNameSelections = (source: string): DslNameSelection[] => {
  const selections: DslNameSelection[] = [];
  let offset = 0;
  for (const line of source.split(/\r?\n/)) {
    const tokens = tokenRanges(line);
    const keyword = tokens[0]?.text;
    const name = tokens[1];
    if (keyword && name && nameBearingKeywords.has(keyword)) {
      const selection = selectionInsideQuotes(name);
      selections.push({
        start: offset + selection.start,
        end: offset + selection.end
      });
    }
    offset += line.length + 1;
  }
  return selections;
};

export const findDslNameSelection = (
  source: string,
  cursor: number,
  direction: DslNameSelectionDirection
): DslNameSelection | null => {
  const selections = dslNameSelections(source);
  if (selections.length === 0) return null;
  if (direction === "previous") {
    return [...selections].reverse().find((selection) => selection.start < cursor) ?? selections.at(-1) ?? null;
  }
  return selections.find((selection) => selection.start >= cursor) ?? selections[0] ?? null;
};
