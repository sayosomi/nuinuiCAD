import type { DslSpan } from "./dslTypes";
import { unquoteDslString } from "./dslTokens";

export type DslReverseStatement = {
  kind: "reverse";
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  payloadSpans: Record<string, DslSpan>;
  args: [];
  attrs: [];
  opensBlock: false;
};

export type DslReverseParseResult = {
  statement: DslReverseStatement | null;
  diagnostics: { message: string; span: DslSpan; code?: string }[];
};

export const parseDslReverseStatement = (source: string): DslReverseParseResult => {
  const keyword = /^\s*reverse\b/.exec(source);
  if (!keyword) return { statement: null, diagnostics: [] };
  const keywordSpan = { start: keyword[0].indexOf("reverse") + (keyword.index ?? 0), end: (keyword.index ?? 0) + keyword[0].length };
  const rawStart = keywordSpan.end;
  let start = rawStart;
  let end = source.length;
  while (start < end && /\s/.test(source[start]!)) start += 1;
  while (end > start && /\s/.test(source[end - 1]!)) end -= 1;
  const diagnostics: DslReverseParseResult["diagnostics"] = [];
  if (start === end) diagnostics.push({ message: "reverse には対象の線名が必要です。", span: keywordSpan });
  const nameSpan = start === end ? null : { start, end };
  const name = nameSpan ? unquoteDslString(source.slice(start, end)) : "";
  return {
    statement: {
      kind: "reverse",
      name,
      nameSpan,
      keywordSpan,
      payloadSpans: nameSpan ? { target: nameSpan } : {},
      args: [],
      attrs: [],
      opensBlock: false
    },
    diagnostics
  };
};
