import type { DslCallParseResult, DslCallStatement, ParseDslCallOptions } from "./dslCallParser";
import { parseDslCallStatement } from "./dslCallParser";
import { isGeometryDeclarationCategory } from "./dslConstructions";
import {
  parseDslTypedDeclarationStatement,
  type DslDeclarationParseResult,
  type DslTypedDeclarationStatement
} from "./dslDeclarationParser";
import {
  parseDslModuleStatement,
  type DslModuleParseResult,
  type DslModuleParsedStatement
} from "./dslModuleParser";
import type { DslDiagnosticPresentation, DslSpan } from "./dslTypes";

export type DslExportedGeometryParseResult = {
  exportSpan: DslSpan;
  call: DslCallParseResult;
};

export type DslExportDiagnostic = {
  message: string;
  span: DslSpan;
  code?: string;
  presentation?: DslDiagnosticPresentation;
};

export type DslExportParseResult = {
  exportSpan: DslSpan;
  kind: "geometry" | "typedDeclaration" | "module" | null;
  call: DslCallParseResult | null;
  declaration: DslDeclarationParseResult | null;
  module: DslModuleParseResult | null;
  diagnostics: DslExportDiagnostic[];
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

const shiftedDeclaration = (
  statement: DslTypedDeclarationStatement,
  offset: number,
  exportSpan: DslSpan
): DslTypedDeclarationStatement => ({
  ...statement,
  keywordSpan: { start: statement.keywordSpan.start + offset, end: statement.keywordSpan.end + offset },
  nameSpan: shiftedSpan(statement.nameSpan, offset),
  choiceOptionSpans: statement.choiceOptionSpans.map((span) => ({ start: span.start + offset, end: span.end + offset })),
  payloadSpans: Object.fromEntries(
    Object.entries(statement.payloadSpans).map(([key, span]) => [key, { start: span.start + offset, end: span.end + offset }])
  ),
  exported: true,
  exportSpan
});

const shiftedDeclarationResult = (
  result: DslDeclarationParseResult,
  offset: number,
  exportSpan: DslSpan
): DslDeclarationParseResult => ({
  statement: result.statement ? shiftedDeclaration(result.statement, offset, exportSpan) : null,
  diagnostics: result.diagnostics.map((item) => ({
    ...item,
    span: { start: item.span.start + offset, end: item.span.end + offset }
  }))
});

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

const shiftedModuleStatement = (
  statement: DslModuleParsedStatement,
  offset: number,
  exportSpan: DslSpan
): DslModuleParsedStatement => ({
  ...statement,
  keywordSpan: { start: statement.keywordSpan.start + offset, end: statement.keywordSpan.end + offset },
  nameSpan: shiftedSpan(statement.nameSpan, offset),
  payloadSpans: Object.fromEntries(
    Object.entries(statement.payloadSpans).map(([key, span]) => [key, { start: span.start + offset, end: span.end + offset }])
  ),
  ...(statement.kind === "moduleDefinition"
    ? {
        exported: true,
        exportSpan,
        parameters: statement.parameters.map((parameter) => ({
          ...parameter,
          nameSpan: shiftedSpan(parameter.nameSpan, offset),
          optionalSpan: shiftedSpan(parameter.optionalSpan, offset),
          typeSpan: shiftedSpan(parameter.typeSpan, offset),
          defaultSpan: shiftedSpan(parameter.defaultSpan, offset),
          choiceOptionSpans: parameter.choiceOptionSpans.map((span) => ({ start: span.start + offset, end: span.end + offset }))
        }))
      }
    : {})
});

const shiftedModuleResult = (
  result: DslModuleParseResult,
  offset: number,
  exportSpan: DslSpan
): DslModuleParseResult => ({
  statement: result.statement ? shiftedModuleStatement(result.statement, offset, exportSpan) : null,
  diagnostics: result.diagnostics.map((item) => ({
    ...item,
    span: { start: item.span.start + offset, end: item.span.end + offset }
  }))
});

export const parseDslExportedGeometryStatement = (
  logicalText: string,
  options: ParseDslCallOptions = {}
): DslExportedGeometryParseResult => {
  const parsed = parseDslExportStatement(logicalText, options);
  if (parsed.kind === "geometry" && parsed.call) return { exportSpan: parsed.exportSpan, call: parsed.call };
  return {
    exportSpan: parsed.exportSpan,
    call: {
      statement: null,
      diagnostics: parsed.diagnostics.map((item) => ({
        ...item,
        message: "export の後には geometry declaration が必要です。"
      }))
    }
  };
};

/**
 * Parse the existing `export` surface for both declaration families that may
 * carry the modifier. The returned geometry/declaration parser result remains
 * the source of truth for each family; this function only owns the modifier
 * prefix && source-span shift.
 */
export const parseDslExportStatement = (
  logicalText: string,
  options: ParseDslCallOptions = {}
): DslExportParseResult => {
  const exportSpan = { start: 0, end: "export".length };
  const afterExport = trimSpan(logicalText, exportSpan.end, logicalText.length);
  const category = logicalText.slice(afterExport.start).match(identifier)?.[0] ?? "";
  if (isGeometryDeclarationCategory(category)) {
    const parsed = parseDslCallStatement(logicalText.slice(afterExport.start), options);
    return {
      exportSpan,
      kind: "geometry",
      call: {
        statement: parsed.statement ? shiftCallStatement(parsed.statement, afterExport.start) : null,
        diagnostics: parsed.diagnostics.map((item) => ({
          ...item,
          span: { start: item.span.start + afterExport.start, end: item.span.end + afterExport.start }
        }))
      },
      declaration: null,
      module: null,
      diagnostics: []
    };
  }
  if (category === "const" || category === "let") {
    return {
      exportSpan,
      kind: "typedDeclaration",
      call: null,
      declaration: shiftedDeclarationResult(
        parseDslTypedDeclarationStatement(logicalText.slice(afterExport.start)),
        afterExport.start,
        exportSpan
      ),
      module: null,
      diagnostics: []
    };
  }
  if (category === "module") {
    return {
      exportSpan,
      kind: "module",
      call: null,
      declaration: null,
      module: shiftedModuleResult(
        parseDslModuleStatement(logicalText.slice(afterExport.start), { opensBlock: options.opensBlock }),
        afterExport.start,
        exportSpan
      ),
      diagnostics: []
    };
  }
  return {
    exportSpan,
    kind: null,
    call: null,
    declaration: null,
    module: null,
    diagnostics: [{ message: "export の後には geometry または typed scalar declaration が必要です。", span: afterExport }]
  };
};
