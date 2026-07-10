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

const bareIdentifierPattern = /^[^\s"'#=()[\]{},;:]+$/;

export const formatDslName = (value: string) =>
  bareIdentifierPattern.test(value) ? value : quoteDslString(value);

export const splitDslList = (value: string) => {
  const trimmed = value.trim();
  const content = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if ((char === "\"" || char === "'") && content[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      current += char;
      continue;
    }
    if (!quote && (char === "[" || char === "(" || char === "{")) depth += 1;
    if (!quote && (char === "]" || char === ")" || char === "}")) depth -= 1;
    if (!quote && depth === 0 && char === ",") {
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
  const content = trimmed.startsWith("[") && trimmed.endsWith("]")
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

// 行をコード部と行末コメント部に分割する(引用符内の `#` はコメント扱いしない)。
// comment は `#` 以降と直前の空白を含む生文字列。コメントが無ければ ""。
// 常に code + comment === line が成り立つ(コード部の文字オフセットは不変)。
export const splitDslComment = (line: string): { code: string; comment: string } => {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && !quote) {
      let codeEnd = index;
      while (codeEnd > 0 && /\s/.test(line[codeEnd - 1])) codeEnd -= 1;
      return { code: line.slice(0, codeEnd), comment: line.slice(codeEnd) };
    }
  }
  return { code: line, comment: "" };
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
