import type { DslDiagnostic, DslSpan, DslStatement, ParseDslResult } from "./dslTypes";
import {
  physicalSpanForLogicalRange,
  physicalSpanForStatement,
  type DslPhysicalSpan,
  type LogicalStatement,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
import {
  parseDslRecordDefinitionStatement,
  type DslRecordDefinitionStatement,
  type DslRecordParseResult
} from "./dslRecordParser";
import * as core from "./dslParserCore";

export {
  blockFrameKind,
  dslScopeBeforeParsedLine,
  dslStatementKeywordCompletions,
  dslStatementKeywords
} from "./dslParserCore";

const recordHead = /^record(?:\s|$)/;

const recordStatementToDslStatement = (
  parsed: DslRecordDefinitionStatement,
  logical: LogicalStatement,
  sourceRevision: number,
  project: (span: DslSpan) => DslPhysicalSpan | null
): Extract<DslStatement, { kind: "recordDefinition" }> => ({
  line: logical.range.startLine,
  endLine: logical.range.endLine,
  name: parsed.name,
  nameSpan: parsed.nameSpan,
  keywordSpan: parsed.keywordSpan,
  opensBlock: false,
  payloadSpans: parsed.payloadSpans,
  enclosing: null,
  attrs: [],
  sourceRevision,
  documentRange: logical.range,
  physicalSpan: physicalSpanForStatement(logical),
  namePhysicalSpan: parsed.nameSpan ? project(parsed.nameSpan) : null,
  keywordPhysicalSpan: project(parsed.keywordSpan),
  payloadPhysicalSpans: Object.fromEntries(
    Object.entries(parsed.payloadSpans).map(([key, span]) => [key, project(span)])
  ),
  kind: "recordDefinition",
  fields: parsed.fields.map((field) => ({
    ...field,
    namePhysicalSpan: project(field.nameSpan),
    typePhysicalSpan: field.typeSpan ? project(field.typeSpan) : null
  }))
});

const recordDiagnostics = (
  parsed: DslRecordParseResult,
  logical: LogicalStatement,
  sourceRevision: number,
  project: (span: DslSpan) => DslPhysicalSpan | null
): DslDiagnostic[] => parsed.diagnostics.map((item) => ({
  severity: "error",
  line: logical.range.startLine,
  column: item.span.start + 1,
  message: item.message,
  sourceRevision,
  ...(item.code ? { code: item.code } : {}),
  ...(project(item.span) ? { physicalSpan: project(item.span)! } : {})
}));

type RecordEntry = {
  logical: LogicalStatement;
  statement: Extract<DslStatement, { kind: "recordDefinition" }>;
  diagnostics: readonly DslDiagnostic[];
  enclosingBeforeInsert: ReturnType<typeof core.dslScopeBeforeParsedLine>;
};

const parseRecordEntries = (base: ParseDslResult): RecordEntry[] => {
  const entries: RecordEntry[] = [];
  for (const logical of base.sourceMap.statements) {
    if (logical.structural !== null || !recordHead.test(logical.logicalText)) continue;
    const project = (span: DslSpan) => physicalSpanForLogicalRange(base.sourceMap, logical, span);
    const parsed = parseDslRecordDefinitionStatement(logical.logicalText);
    if (!parsed.statement) continue;
    entries.push({
      logical,
      statement: recordStatementToDslStatement(parsed.statement, logical, base.sourceRevision, project),
      diagnostics: recordDiagnostics(parsed, logical, base.sourceRevision, project),
      enclosingBeforeInsert: core.dslScopeBeforeParsedLine(base, logical.range.startLine)
    });
  }
  return entries;
};

const mergeRecordStatements = (
  base: ParseDslResult,
  records: readonly RecordEntry[]
): DslStatement[] => {
  const merged = [
    ...base.statements.map((statement, oldIndex) => ({ statement, oldIndex, record: null as RecordEntry | null })),
    ...records.map((record) => ({ statement: record.statement as DslStatement, oldIndex: null, record }))
  ].sort((left, right) => left.statement.documentRange.from - right.statement.documentRange.from);

  const newIndexByOldIndex = new Map<number, number>();
  for (const [newIndex, entry] of merged.entries()) {
    if (entry.oldIndex !== null) newIndexByOldIndex.set(entry.oldIndex, newIndex);
  }

  for (const entry of merged) {
    if (entry.oldIndex !== null) {
      const enclosing = entry.statement.enclosing;
      if (!enclosing) continue;
      const remapped = newIndexByOldIndex.get(enclosing.statementIndex);
      entry.statement.enclosing = remapped === undefined ? null : { ...enclosing, statementIndex: remapped };
      continue;
    }
    const enclosing = entry.record?.enclosingBeforeInsert;
    if (!enclosing) continue;
    const remapped = newIndexByOldIndex.get(enclosing.statementIndex);
    entry.statement.enclosing = remapped === undefined ? null : { ...enclosing, statementIndex: remapped };
  }

  return merged.map((entry) => entry.statement);
};

const withoutCoreRecordUnknownDiagnostics = (
  diagnostics: readonly DslDiagnostic[],
  recordLines: ReadonlySet<number>
) => diagnostics.filter((item) => !(
  item.code === "unknown-dsl-keyword" &&
  recordLines.has(item.line) &&
  item.message.includes("record")
));

export const parseDslSnapshot = (snapshot: SourceSnapshot): ParseDslResult => {
  const base = core.parseDslSnapshot(snapshot);
  const records = parseRecordEntries(base);
  if (records.length === 0) return base;
  const recordLines = new Set(records.map((entry) => entry.logical.range.startLine));
  return {
    ...base,
    statements: mergeRecordStatements(base, records),
    diagnostics: [
      ...withoutCoreRecordUnknownDiagnostics(base.diagnostics, recordLines),
      ...records.flatMap((entry) => entry.diagnostics)
    ]
  };
};

/** Compatibility/test wrapper. Product callers must provide their source snapshot. */
export const parseDsl = (source: string): ParseDslResult =>
  parseDslSnapshot({ normalizedSource: source.replace(/\r\n/g, "\n"), sourceRevision: 0 });

export const isElementDslStatement = (statement: DslStatement) =>
  statement.kind === "recordDefinition" ? false : core.isElementDslStatement(statement);

export const dslScopeBeforeLine = (source: string, line: number) =>
  core.dslScopeBeforeParsedLine(parseDsl(source), line);
