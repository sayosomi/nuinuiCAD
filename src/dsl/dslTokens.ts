export const DSL_INDENT = "  ";

export type DslTerm = {
  text: string;
  start: number;
  end: number;
};

export const splitDslTerms = (line: string): DslTerm[] => {
  const terms: DslTerm[] = [];
  let current = "";
  let start = -1;
  let quote: string | null = null;
  let depth = 0;

  const flush = (endIndex: number) => {
    if (current.trim()) terms.push({ text: current, start, end: endIndex });
    current = "";
    start = -1;
  };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      if (start < 0) start = index;
      current += char;
      continue;
    }
    if (!quote && (char === "(" || char === "[")) depth += 1;
    if (!quote && (char === ")" || char === "]")) depth -= 1;
    if (!quote && depth === 0 && (char === "{" || char === "}")) {
      flush(index);
      terms.push({ text: char, start: index, end: index + 1 });
      continue;
    }
    if (!quote && depth === 0 && /\s/.test(char)) {
      flush(index);
      continue;
    }
    if (start < 0) start = index;
    current += char;
  }
  flush(line.length);
  return terms;
};

export const quoteDslString = (value: string) =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, "\\\"")}"`;

export const unquoteDslString = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const quote = trimmed[0];
  if ((quote !== "\"" && quote !== "'") || trimmed.at(-1) !== quote) return trimmed;
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    if (trimmed[index] === quote && trimmed[index - 1] !== "\\") return trimmed;
  }
  const source = trimmed.slice(1, -1);
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== "\\" || index === source.length - 1) {
      result += char;
      continue;
    }
    index += 1;
    const escaped = source[index];
    result +=
      escaped === "n" ? "\n" :
      escaped === "r" ? "\r" :
      escaped === "t" ? "\t" :
      escaped === "\\" || escaped === "\"" || escaped === "'" ? escaped :
      `\\${escaped}`;
  }
  return result;
};

/** A single character allowed in an unquoted bare DSL name/token - anything
 * but whitespace && DSL-structural punctuation. User-authored names
 * (element names, visibility role names, ...) are frequently non-ASCII
 * (Japanese), so this is deliberately not limited to ASCII identifier
 * characters. */
export const isBareDslIdentifierChar = (value: string) => /[^\s"'#=()[\]{},;:]/.test(value);

const bareIdentifierPattern = /^[^\s"'#=()[\]{},;:]+$/;

export const formatDslName = (value: string) =>
  bareIdentifierPattern.test(value) ? value : quoteDslString(value);

export const splitDslList = (value: string) => {
  const trimmed = value.trim();
  const content = trimmed.startsWith("[") &&  trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if ((char === "\"" ||  char === "'") &&  content[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      current += char;
      continue;
    }
    if (!quote &&  (char === "[" ||  char === "(" ||  char === "{")) depth += 1;
    if (!quote &&  (char === "]" ||  char === ")" ||  char === "}")) depth -= 1;
    if (!quote &&  depth === 0 &&  char === ",") {
      if (current.trim()) parts.push(unquoteDslString(current));
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(unquoteDslString(current));
  return parts;
};

export const splitDslRecords = (value: string) => {
  const trimmed = value.trim();
  const content = trimmed.startsWith("[") &&  trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if ((char === "\"" || char === "'") && content[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      current += char;
      continue;
    }
    if (!quote && char === ";") {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

export type DslCommentKind = "line" | "block";

export type DslCommentSegment = {
  kind: DslCommentKind;
  start: number;
  end: number;
  text: string;
};

export type DslCodeSegment = {
  start: number;
  end: number;
  text: string;
};

export type DslLexedLine = {
  text: string;
  /** Source-length-preserving code view; comment characters are spaces. */
  code: string;
  /** Visible code fragments joined for parsing and delimiter accounting. */
  codeText: string;
  codeSegments: readonly DslCodeSegment[];
  comments: readonly DslCommentSegment[];
  startsInBlockComment: boolean;
  endsInBlockComment: boolean;
};

export type DslLexedSource = {
  lines: readonly DslLexedLine[];
  unterminatedBlockComment: { line: number; column: number } | null;
};

export type DslScanOptions = {
  startsInBlockComment?: boolean;
};

const escapedAt = (source: string, index: number) => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

/**
 * The single host-neutral comment lexer for nui source consumers. It removes
 * comments from the returned code while retaining exact physical line-local
 * code/comment ranges for source maps, highlighting, folding, and mutation.
 * `#` is ordinary source text; in particular `#RRGGBB` is never a comment.
 */
export const scanDslSource = (source: string, options: DslScanOptions = {}): DslLexedSource => {
  const lines = source.split("\n");
  const lexedLines: DslLexedLine[] = [];
  let inBlockComment = options.startsInBlockComment ?? false;
  let blockCommentStart: { line: number; column: number } | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const text = lines[lineIndex]!;
    const codeSegments: DslCodeSegment[] = [];
    const comments: DslCommentSegment[] = [];
    const startsInBlockComment = inBlockComment;
    let codeStart = 0;
    let index = 0;
    let quote: string | null = null;

    const pushCode = (end: number) => {
      if (end <= codeStart) return;
      codeSegments.push({ start: codeStart, end, text: text.slice(codeStart, end) });
    };

    while (index < text.length) {
      if (inBlockComment) {
        const close = text.indexOf("*/", index);
        const end = close >= 0 ? close + 2 : text.length;
        comments.push({ kind: "block", start: index, end, text: text.slice(index, end) });
        index = end;
        codeStart = index;
        if (close < 0) break;
        inBlockComment = false;
        blockCommentStart = null;
        continue;
      }

      const char = text[index]!;
      if (quote) {
        if (char === quote && !escapedAt(text, index)) quote = null;
        index += 1;
        continue;
      }
      if ((char === "\"" || char === "'") && !escapedAt(text, index)) {
        quote = char;
        index += 1;
        continue;
      }
      if (text.startsWith("//", index)) {
        pushCode(index);
        comments.push({ kind: "line", start: index, end: text.length, text: text.slice(index) });
        codeStart = text.length;
        index = text.length;
        continue;
      }
      if (text.startsWith("/*", index)) {
        pushCode(index);
        inBlockComment = true;
        blockCommentStart = { line: lineIndex + 1, column: index + 1 };
        const close = text.indexOf("*/", index + 2);
        if (close >= 0) {
          const end = close + 2;
          comments.push({ kind: "block", start: index, end, text: text.slice(index, end) });
          inBlockComment = false;
          blockCommentStart = null;
          index = end;
          codeStart = index;
        } else {
          comments.push({ kind: "block", start: index, end: text.length, text: text.slice(index) });
          index = text.length;
          codeStart = index;
        }
        continue;
      }
      index += 1;
    }
    if (!inBlockComment) pushCode(text.length);
    const codeText = codeSegments.map((segment) => segment.text).join(" ");
    const codeCharacters = text.split("");
    for (const comment of comments) {
      for (let offset = comment.start; offset < comment.end; offset += 1) codeCharacters[offset] = " ";
    }
    lexedLines.push({
      text,
      code: codeCharacters.join(""),
      codeText,
      codeSegments,
      comments,
      startsInBlockComment,
      endsInBlockComment: inBlockComment
    });
  }

  return {
    lines: lexedLines,
    unterminatedBlockComment: blockCommentStart
  };
};

/** Line-local convenience view backed by the shared source lexer. */
export const splitDslComment = (line: string): { code: string; comment: string } => {
  const lexed = scanDslSource(line).lines[0]!;
  if (lexed.comments.length === 0) return { code: lexed.code, comment: "" };
  const comment = lexed.comments.map((segment) => {
    let start = segment.start;
    while (start > 0 && /\s/.test(line[start - 1]!)) start -= 1;
    return line.slice(start, segment.end);
  }).join("");
  return { code: lexed.code, comment };
};

export const lastIndexOfDslOutsideQuotes = (value: string, needle: string) => {
  let quote: string | null = null;
  let lastIndex = -1;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (!quote && char === needle) lastIndex = index;
  }
  return lastIndex;
};
