import type { DslHighlightLine, DslHighlightToken, DslTokenKind } from "./dslTypes";

const keywords = new Set([
  "activePrintLayout",
  "activeProfile",
  "activeView",
  "arc",
  "between",
  "color",
  "corner",
  "curve",
  "default",
  "element",
  "else",
  "extend",
  "for",
  "from",
  "group",
  "if",
  "intersection",
  "layoutVar",
  "line",
  "nui",
  "offset",
  "on",
  "place",
  "point",
  "polar",
  "printLayout",
  "profile",
  "role",
  "split",
  "tangentOffset",
  "text",
  "through",
  "var"
]);

const stopKeyword = "@stop";

const elementTypes = new Set([
  "angleLengthLine",
  "arcLine",
  "bezierCurve",
  "conditionalGroup",
  "copyLine",
  "cornerRadiusArcLine",
  "divisionPoint",
  "edge",
  "extendTrim",
  "forGroup",
  "freePoint",
  "group",
  "image",
  "intersectionPoint",
  "line",
  "lineDivisionPoint",
  "lineTangentOffsetPoint",
  "move",
  "offsetLine",
  "offsetPoint",
  "polarOffsetPoint",
  "splitLine",
  "symmetricCopyLine",
  "symmetricMove",
  "text",
  "threePointArcLine",
  "variable"
]);

const tokenPattern =
  /("[^"]*(?:"|$)|'[^']*(?:'|$)|[A-Za-z_][\w:-]*(?==)|-?\d+(?:\.\d+)?|->|==|!=|>=|<=|[={}()[\],*/+-]|@[A-Za-z_][\w:-]*|[A-Za-z_][\w:-]*(?:\.[A-Za-z_][\w:-]*)?)/g;

const commentIndex = (line: string) => {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && !quote) return index;
  }
  return -1;
};

const classify = (text: string): DslTokenKind => {
  if (text.startsWith("\"") || text.startsWith("'")) return "string";
  if (text === stopKeyword) return "keyword";
  if (/^[A-Za-z_][\w:-]*(?=$)/.test(text) && keywords.has(text)) return "keyword";
  if (/^[A-Za-z_][\w:-]*(?=$)/.test(text) && elementTypes.has(text)) return "elementType";
  if (/^[A-Za-z_][\w:-]*$/.test(text)) return "reference";
  if (/^[A-Za-z_][\w:-]*\.[A-Za-z_][\w:-]*$/.test(text)) return "reference";
  if (/^@[A-Za-z_][\w:-]*$/.test(text)) return "reference";
  if (/^-?\d+(\.\d+)?$/.test(text)) return "number";
  if (/^[A-Za-z_][\w:-]*$/.test(text)) return "reference";
  return "operator";
};

const pushText = (tokens: DslHighlightToken[], kind: DslTokenKind, text: string) => {
  if (!text) return;
  const last = tokens.at(-1);
  if (last?.kind === kind) {
    last.text += text;
    return;
  }
  tokens.push({ kind, text });
};

export const highlightDslLine = (line: string): DslHighlightToken[] => {
  const tokens: DslHighlightToken[] = [];
  const index = commentIndex(line);
  const code = index >= 0 ? line.slice(0, index) : line;
  let cursor = 0;

  for (const match of code.matchAll(tokenPattern)) {
    const text = match[0];
    const start = match.index ?? cursor;
    pushText(tokens, "plain", code.slice(cursor, start));
    const kind =
      /^[A-Za-z_][\w:-]*$/.test(text) && code[start + text.length] === "="
        ? "attributeKey"
        : classify(text);
    pushText(tokens, kind, text);
    cursor = start + text.length;
  }
  pushText(tokens, "plain", code.slice(cursor));
  if (index >= 0) pushText(tokens, "comment", line.slice(index));
  return tokens.length > 0 ? tokens : [{ kind: "plain", text: "" }];
};

export const highlightDslSource = (source: string): DslHighlightLine[] =>
  source.split(/\r?\n/).map((line, index) => ({
    lineNumber: index + 1,
    tokens: highlightDslLine(line)
  }));
