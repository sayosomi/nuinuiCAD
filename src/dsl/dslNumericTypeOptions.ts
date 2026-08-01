import type { DslSpan } from "./dslTypes";

/** Source-owned stepping metadata for a typed `number(...)` declaration. */
export type DslNumericTypeOptions = {
  step?: number;
  min?: number;
  max?: number;
};

export type DslNumericTypeOptionDiagnostic = {
  message: string;
  span: DslSpan;
  code: "invalid-number-type-options";
};

export type DslNumericTypeOptionsParseResult = {
  options: DslNumericTypeOptions | null;
  diagnostics: DslNumericTypeOptionDiagnostic[];
};

const numericLiteral = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i;

const trimSpan = (source: string, start: number, end: number): DslSpan => {
  while (start < end && /\s/.test(source[start])) start += 1;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  return { start, end };
};

const matchingClose = (source: string, open: number, to: number) => {
  let depth = 0;
  for (let index = open; index < to; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")" && --depth === 0) return index;
  }
  return -1;
};

const splitCommas = (source: string, span: DslSpan) => {
  const parts: DslSpan[] = [];
  let start = span.start;
  for (let index = span.start; index < span.end; index += 1) {
    if (source[index] !== ",") continue;
    parts.push(trimSpan(source, start, index));
    start = index + 1;
  }
  parts.push(trimSpan(source, start, span.end));
  return parts;
};

const diagnostic = (message: string, span: DslSpan): DslNumericTypeOptionDiagnostic => ({
  message,
  span,
  code: "invalid-number-type-options"
});

/** Parses only the `(...)` portion of a `number(...)` type annotation. */
export const parseDslNumericTypeOptions = (
  source: string,
  typeSpan: DslSpan
): DslNumericTypeOptionsParseResult => {
  const diagnostics: DslNumericTypeOptionDiagnostic[] = [];
  const openAt = source.indexOf("(", typeSpan.start);
  const open = openAt >= typeSpan.end ? -1 : openAt;
  const close = open < 0 ? -1 : matchingClose(source, open, typeSpan.end);
  if (open < 0 || close < 0) {
    return { options: null, diagnostics: [diagnostic("number の「(」が閉じられていません。", typeSpan)] };
  }
  if (close !== typeSpan.end - 1) {
    return {
      options: null,
      diagnostics: [diagnostic("number(...) の後に余分なトークンがあります。", trimSpan(source, close + 1, typeSpan.end))]
    };
  }

  const inner = trimSpan(source, open + 1, close);
  if (inner.start === inner.end) {
    return { options: null, diagnostics: [diagnostic("number(...) には step、min、max のいずれかを指定してください。", { start: open, end: close + 1 })] };
  }

  const options: DslNumericTypeOptions = {};
  const seen = new Set<string>();
  for (const part of splitCommas(source, inner)) {
    const colon = source.indexOf(":", part.start);
    const keySpan = trimSpan(source, part.start, colon < 0 ? part.end : colon);
    const valueSpan = trimSpan(source, colon < 0 ? part.end : colon + 1, part.end);
    const key = source.slice(keySpan.start, keySpan.end);
    if (colon < 0 || keySpan.start === keySpan.end || valueSpan.start === valueSpan.end) {
      diagnostics.push(diagnostic("number の設定は key: 数値 で指定してください。", part));
      continue;
    }
    if (key !== "step" && key !== "min" && key !== "max") {
      diagnostics.push(diagnostic(`number の設定として ${key} は使用できません。`, keySpan));
      continue;
    }
    if (seen.has(key)) {
      diagnostics.push(diagnostic(`number の設定 ${key} が重複しています。`, keySpan));
      continue;
    }
    seen.add(key);
    const valueText = source.slice(valueSpan.start, valueSpan.end);
    const value = numericLiteral.test(valueText) ? Number(valueText) : Number.NaN;
    if (!Number.isFinite(value)) {
      diagnostics.push(diagnostic(`${key} には有限の数値を指定してください。`, valueSpan));
      continue;
    }
    if (key === "step" && value <= 0) {
      diagnostics.push(diagnostic("step には 0 より大きい数値を指定してください。", valueSpan));
      continue;
    }
    options[key] = value;
  }

  if (options.min !== undefined && options.max !== undefined && options.min > options.max) {
    diagnostics.push(diagnostic("min は max 以下にしてください。", typeSpan));
  }
  return { options: diagnostics.length === 0 ? options : null, diagnostics };
};

/** Canonical `number(...)` text. Presence and output order are source-contractual. */
export const serializeDslNumericType = (options?: DslNumericTypeOptions): string => {
  if (!options || (options.step === undefined && options.min === undefined && options.max === undefined)) return "number";
  const fields = [
    options.step === undefined ? null : `step: ${options.step}`,
    options.min === undefined ? null : `min: ${options.min}`,
    options.max === undefined ? null : `max: ${options.max}`
  ].filter((field): field is string => field !== null);
  return `number(${fields.join(", ")})`;
};
