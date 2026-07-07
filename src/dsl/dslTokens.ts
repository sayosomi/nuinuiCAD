export const quoteDslString = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;

export const unquoteDslString = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const quote = trimmed[0];
  if ((quote !== "\"" && quote !== "'") || trimmed.at(-1) !== quote) return trimmed;
  return trimmed
    .slice(1, -1)
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'");
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
