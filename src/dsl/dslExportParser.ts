import type { DslCallParseResult, DslCallStatement, ParseDslCallOptions } from "./dslCallParser";
import { parseDslCallStatement } from "./dslCallParser";
import { isGeometryDeclarationCategory } from "./dslConstructions";
import type { DslSpan } from "./dslTypes";

export type DslExportedGeometryParseResult = {
  exportSpan: DslSpan;
  call: DslCallParseResult;
};

const identifier = /^[A-Za-z_][A-Za-z0-9_]*/;
const whitespace = /\s/;

const trimSpan = (source: string, start: number, end: number): DslSpan => {
  while (start < end && whitespace.test(source[start])) start += 1;
  while (end > start && whitespace.test(source[end - 1])) end -= 1;
  return { start, end };
};

const shiftedSpan = (span: DslSpan | null, offset: number): DslSpan | null =>
  span ? { start: span.start + offset, end: span.end + offset } : null;

const shiftCallStatement = (statement: DslCallStatement, offset: number): DslCallStatement => ({
  ...statement,
  keywordSpan: { start: statement.keywordSpan.start + offset, end: statement.keywordSpan.end + offset },
  nameSpan: shiftedSpan(statement.nameSpan, offset),
  constructionSpan: shiftedSpan(statement.constructionSpan, offset),
  args: statement.args.map((arg) => ({
    ...arg,
    keySpan: shiftedSpan(arg.keySpan, offset),
    valueSpan: { start: arg.valueSpan.start + offset, end: arg.valueSpan.end + offset },
    ...(arg.rawValueSpan ? { rawValueSpan: { start: arg.rawValueSpan.start + offset, end: arg.rawValueSpan.end + offset } } : {})
  })),
  attrs: statement.attrs.map((attr) => ({
    ...attr,
    keyStart: attr.keyStart + offset,
    valueStart: attr.valueStart + offset,
    valueEnd: attr.valueEnd + offset,
    ...(attr.rawValueSpan ? { rawValueSpan: { start: attr.rawValueSpan.start + offset, end: attr.rawValueSpan.end + offset } } : {})
  })),
  payloadSpans: Object.fromEntries(Object.entries(statement.payloadSpans).map(([key, span]) => [key, { start: span.start + offset, end: span.end + offset }]))
});

export const parseDslExportedGeometryStatement = (
  logicalText: string,
  options: ParseDslCallOptions = {}
): DslExportedGeometryParseResult => {
  const exportSpan = { start: 0, end: "export".length };
  const afterExport = trimSpan(logicalText, exportSpan.end, logicalText.length);
  const category = logicalText.slice(afterExport.start).match(identifier)?.[0] ?? "";
  if (!isGeometryDeclarationCategory(category)) {
    return {
      exportSpan,
      call: {
        statement: null,
        diagnostics: [{ message: "export の後には geometry declaration が必要です。", span: afterExport }]
      }
    };
  }
  const parsed = parseDslCallStatement(logicalText.slice(afterExport.start), options);
  return {
    exportSpan,
    call: {
      statement: parsed.statement ? shiftCallStatement(parsed.statement, afterExport.start) : null,
      diagnostics: parsed.diagnostics.map((item) => ({
        ...item,
        span: { start: item.span.start + afterExport.start, end: item.span.end + afterExport.start }
      }))
    }
  };
};
