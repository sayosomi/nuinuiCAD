import type {
  DslAttribute,
  DslDiagnostic,
  DslSpan,
  DslStatement,
  DslStatementBase,
  ParseDslResult
} from "./dslTypes";
import { unquoteDslString } from "./dslTokens";
import {
  createLogicalStatementSourceMap,
  physicalSpanForLogicalRange,
  physicalSpanForStatement,
  type DslPhysicalSpan,
  type LogicalStatement,
  type SourceSnapshot
} from "./logicalStatementSourceMap";
import { parseDslCallStatement, UNCLOSED_CALL_CODE, type DslCallParseResult, type DslCallStatement } from "./dslCallParser";
import { parseDslSettingsStatement, type DslSettingsParseResult, type DslSettingsStatement } from "./dslSettingsParser";
import {
  parseDslTypedDeclarationStatement,
  type DslDeclarationParseResult,
  type DslTypedDeclarationStatement
} from "./dslDeclarationParser";
import { parseDslSetStatement, type DslSetParseResult, type DslSetStatement } from "./dslSetParser";
import { parseDslReverseStatement, type DslReverseParseResult, type DslReverseStatement } from "./dslReverseParser";

/**
 * Statement-leading spellings accepted by this parser. Keeping these constants
 * next to the dispatch below makes the parser, rather than an editor-side
 * keyword list, the source of truth for completion.
 */
export const dslStatementKeywords = {
  atStop: "@stop",
  version: "nui",
  for: "for",
  place: "place",
  variable: "var",
  layoutVariable: "layoutVar",
  role: "role",
  view: "view",
  activeView: "activeView",
  activePrintLayout: "activePrintLayout",
  printLayout: "printLayout",
  color: "color",
  conditional: "if",
  constDeclaration: "const",
  letDeclaration: "let",
  setStatement: "set",
  reverseStatement: "reverse",
  point: "point",
  line: "line",
  curve: "curve",
  arc: "arc",
  text: "text",
  image: "image",
  group: "group"
} as const;

export const dslStatementKeywordCompletions = Object.values(dslStatementKeywords);

// category キーワードは P3(dslCallParser)へ、設定文キーワードは P4(dslSettingsParser)へ。
// 集合は互いに素(重複キーワードなし)。
const callCategoryKeywords = new Set<string>([
  dslStatementKeywords.point,
  dslStatementKeywords.line,
  dslStatementKeywords.curve,
  dslStatementKeywords.arc,
  dslStatementKeywords.text,
  dslStatementKeywords.image,
  dslStatementKeywords.variable,
  dslStatementKeywords.group,
  dslStatementKeywords.conditional,
  dslStatementKeywords.for
]);

const settingsKeywords = new Set<string>([
  dslStatementKeywords.version,
  dslStatementKeywords.color,
  dslStatementKeywords.role,
  dslStatementKeywords.view,
  dslStatementKeywords.activeView,
  dslStatementKeywords.activePrintLayout,
  dslStatementKeywords.printLayout,
  dslStatementKeywords.layoutVariable,
  dslStatementKeywords.place
]);

// const/let route to their own focused parser (P5, dslDeclarationParser),
// disjoint from the call-category and settings keyword sets above.
const declarationKeywords = new Set<string>([dslStatementKeywords.constDeclaration, dslStatementKeywords.letDeclaration]);

// set routes to its own focused parser (P7, dslSetParser), independent of
// declarationKeywords - Task 29 must not mix a set branch into
// dslDeclarationParser.ts.
const setKeywords = new Set<string>([dslStatementKeywords.setStatement]);
const reverseKeywords = new Set<string>([dslStatementKeywords.reverseStatement]);

const nonElementKinds = new Set<DslStatement["kind"]>([
  "role",
  "view",
  "activeView",
  "printLayout",
  "version",
  "color",
  "atStop",
  "activePrintLayout",
  "place",
  "layoutVar",
  "typedDeclaration",
  "set",
  "reverse",
  "blockEnd",
  "blockElse"
]);

export const isElementDslStatement = (statement: DslStatement) =>
  !nonElementKinds.has(statement.kind);

const attrValue = (attrs: DslAttribute[], key: string) =>
  attrs.find((attr) => attr.key === key)?.value;

const diagnostic = (
  line: number,
  message: string,
  code?: string,
  physicalSpan?: DslPhysicalSpan
): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message,
  ...(code ? { code } : {}),
  ...(physicalSpan ? { physicalSpan } : {})
});

type ParsedLine = { statement?: DslStatement; diagnostics: DslDiagnostic[] };

type StatementCommonFields = {
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  opensBlock: boolean;
  payloadSpans: Record<string, DslSpan>;
  attrs: DslAttribute[];
};

const baseFrom = (parsed: StatementCommonFields, line: number, endLine: number): DslStatementBase => ({
  line,
  endLine,
  name: parsed.name,
  nameSpan: parsed.nameSpan,
  keywordSpan: parsed.keywordSpan,
  opensBlock: parsed.opensBlock,
  payloadSpans: parsed.payloadSpans,
  enclosing: null,
  attrs: parsed.attrs,
  // parseLine is deliberately source-map agnostic. parseDslSnapshot decorates
  // this temporary shape before exposing it to callers.
  sourceRevision: 0,
  documentRange: { from: 0, to: 0, startLine: line, endLine, sourceRevision: 0 },
  physicalSpan: { segments: [], sourceRevision: 0 }
});

// if/for のヘッダ位置引数(condition/variable)は registry 上 positional
// (`key: null`)で scanned されるため P3 の attrsFromArgs には現れない。
// P6 applyArgs はこれらを構文名(condition/variable)で byName 参照するため、
// 同じ構文名をキーにした合成 DslAttribute として attrs へ差し戻す。
const positionalArgNameByCategory: Record<string, string> = {
  if: "condition",
  for: "variable"
};

const withSyntheticPositionalAttr = (call: DslCallStatement, base: DslStatementBase): DslStatementBase => {
  const argName = positionalArgNameByCategory[call.category];
  const positional = argName ? call.args.find((item) => item.key === null) : undefined;
  if (!argName || !positional) return base;
  const synthetic: DslAttribute = {
    key: argName,
    value: positional.value,
    keyStart: positional.valueSpan.start,
    valueStart: positional.valueSpan.start,
    valueEnd: positional.valueSpan.end
  };
  return { ...base, attrs: [synthetic, ...base.attrs] };
};

const callStatementToDslStatement = (call: DslCallStatement, line: number, endLine: number): DslStatement => {
  const base = withSyntheticPositionalAttr(call, baseFrom(call, line, endLine));
  if (call.shortVariable) {
    return { ...base, kind: "variable", expression: call.args[0]?.value ?? "" };
  }
  if (call.category === "group") {
    return { ...base, kind: "group" };
  }
  return { ...base, kind: "element", type: call.elementType, category: call.category, construction: call.construction };
};

const settingsStatementToDslStatement = (settings: DslSettingsStatement, line: number, endLine: number): DslStatement => {
  const base = baseFrom(settings, line, endLine);
  switch (settings.kind) {
    case "version":
      return { ...base, kind: "version", value: settings.value ?? "" };
    case "layoutVar":
      return { ...base, kind: "layoutVar", expression: settings.expression ?? "" };
    case "place": {
      const group = settings.args.find((arg) => arg.key === null)?.value ?? "";
      return { ...base, kind: "place", group };
    }
    case "color": {
      const hex = unquoteDslString(settings.args.find((arg) => arg.key === null)?.value ?? "");
      const isDefault = attrValue(settings.attrs, "default") === "true";
      return { ...base, kind: "color", hex, isDefault };
    }
    case "role":
      return { ...base, kind: "role" };
    case "view":
      return { ...base, kind: "view" };
    case "activeView":
      return { ...base, kind: "activeView" };
    case "activePrintLayout":
      return { ...base, kind: "activePrintLayout" };
    case "printLayout":
      return { ...base, kind: "printLayout" };
    case "atStop":
      return { ...base, kind: "atStop" };
  }
};

const declarationStatementToDslStatement = (
  decl: DslTypedDeclarationStatement,
  line: number,
  endLine: number
): DslStatement => ({
  ...baseFrom(decl, line, endLine),
  kind: "typedDeclaration",
  bindingKind: decl.bindingKind,
  declaredType: decl.declaredType,
  choiceOptionSpans: decl.choiceOptionSpans,
  ...(decl.numericTypeOptions ? { numericTypeOptions: decl.numericTypeOptions } : {}),
  initializer: decl.initializer
});

const setStatementToDslStatement = (
  set: DslSetStatement,
  line: number,
  endLine: number
): DslStatement => ({
  ...baseFrom(set, line, endLine),
  kind: "set",
  expression: set.expression
});

const structuralStatement = (logical: LogicalStatement, kind: "blockEnd" | "blockElse"): DslStatement => ({
  line: logical.range.startLine,
  endLine: logical.range.endLine,
  name: "",
  nameSpan: null,
  keywordSpan: { start: 0, end: logical.logicalText.length },
  opensBlock: kind === "blockElse",
  payloadSpans: {},
  enclosing: null,
  attrs: [],
  sourceRevision: 0,
  documentRange: { from: 0, to: 0, startLine: logical.range.startLine, endLine: logical.range.endLine, sourceRevision: 0 },
  physicalSpan: { segments: [], sourceRevision: 0 },
  kind
});

const fromCall = (
  result: DslCallParseResult,
  line: number,
  endLine: number,
  project: (span: DslSpan) => DslPhysicalSpan | null
): ParsedLine => {
  const diagnostics = result.diagnostics.map((item) =>
    diagnostic(line, item.message, item.code, project(item.span) ?? undefined)
  );
  if (!result.statement) return { diagnostics };
  return { statement: callStatementToDslStatement(result.statement, line, endLine), diagnostics };
};

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

const fromSettings = (result: DslSettingsParseResult, line: number, endLine: number): ParsedLine => {
  const diagnostics = result.diagnostics.map((item) => diagnostic(line, item.message));
  if (!result.statement) return { diagnostics };
  if (result.statement.kind === "color") {
    const hex = unquoteDslString(result.statement.args.find((arg) => arg.key === null)?.value ?? "");
    if (!hexColorPattern.test(hex)) {
      return { diagnostics: [...diagnostics, diagnostic(line, "色は `color <ID> (\"#rrggbb\" …)` の形式で指定してください。")] };
    }
  }
  return { statement: settingsStatementToDslStatement(result.statement, line, endLine), diagnostics };
};

const fromDeclaration = (
  result: DslDeclarationParseResult,
  line: number,
  endLine: number,
  project: (span: DslSpan) => DslPhysicalSpan | null
): ParsedLine => {
  const diagnostics = result.diagnostics.map((item) =>
    diagnostic(line, item.message, item.code, project(item.span) ?? undefined)
  );
  if (!result.statement) return { diagnostics };
  return { statement: declarationStatementToDslStatement(result.statement, line, endLine), diagnostics };
};

const fromSet = (
  result: DslSetParseResult,
  line: number,
  endLine: number,
  project: (span: DslSpan) => DslPhysicalSpan | null
): ParsedLine => {
  const diagnostics = result.diagnostics.map((item) =>
    diagnostic(line, item.message, item.code, project(item.span) ?? undefined)
  );
  if (!result.statement) return { diagnostics };
  return { statement: setStatementToDslStatement(result.statement, line, endLine), diagnostics };
};

const reverseStatementToDslStatement = (reverse: DslReverseStatement, line: number, endLine: number): DslStatement => ({
  ...baseFrom(reverse, line, endLine),
  kind: "reverse"
});

const fromReverse = (
  result: DslReverseParseResult,
  line: number,
  endLine: number,
  project: (span: DslSpan) => DslPhysicalSpan | null
): ParsedLine => {
  const diagnostics = result.diagnostics.map((item) => diagnostic(line, item.message, item.code, project(item.span) ?? undefined));
  return result.statement ? { statement: reverseStatementToDslStatement(result.statement, line, endLine), diagnostics } : { diagnostics };
};

const leadingIdentifier = /^[A-Za-z_][A-Za-z0-9_]*/;

const parseLine = (
  logicalText: string,
  line: number,
  endLine: number,
  opensOnNextLine: boolean,
  project: (span: DslSpan) => DslPhysicalSpan | null,
  requireArgumentCommas: boolean,
): ParsedLine => {
  if (logicalText.startsWith(dslStatementKeywords.atStop)) {
    return fromSettings(parseDslSettingsStatement(logicalText, { opensBlock: opensOnNextLine, requireArgumentCommas }), line, endLine);
  }
  const keyword = logicalText.match(leadingIdentifier)?.[0] ?? "";
  if (callCategoryKeywords.has(keyword)) {
    return fromCall(parseDslCallStatement(logicalText, { opensBlock: opensOnNextLine, requireArgumentCommas }), line, endLine, project);
  }
  if (settingsKeywords.has(keyword)) {
    return fromSettings(parseDslSettingsStatement(logicalText, { opensBlock: opensOnNextLine, requireArgumentCommas }), line, endLine);
  }
  if (declarationKeywords.has(keyword)) {
    return fromDeclaration(parseDslTypedDeclarationStatement(logicalText), line, endLine, project);
  }
  if (setKeywords.has(keyword)) {
    return fromSet(parseDslSetStatement(logicalText), line, endLine, project);
  }
  if (reverseKeywords.has(keyword)) {
    return fromReverse(parseDslReverseStatement(logicalText), line, endLine, project);
  }
  return {
    diagnostics: [diagnostic(line, keyword ? `未対応のDSLキーワードです: ${keyword}` : "文はキーワードから始めてください。")]
  };
};

/** Parse-time grammar choice is determined only by an unambiguous first header. */
const nui3RequiresArgumentCommas = (logicalStatements: readonly LogicalStatement[]) => {
  const first = logicalStatements.find((statement) => !statement.structural && statement.logicalText.trim());
  return first ? /^nui\s+3\s*$/.test(first.logicalText.trim()) : false;
};

type BlockFrame = {
  statementIndex: number;
  kind: "group" | "conditionalGroup" | "forGroup" | "printLayout";
  branch: "then" | "else";
  line: number;
};

const blockFrameKind = (statement: DslStatement): BlockFrame["kind"] | null => {
  if (statement.kind === "group") return "group";
  if (statement.kind === "printLayout") return "printLayout";
  if (statement.kind === "element") {
    if (statement.type === "conditionalGroup") return "conditionalGroup";
    if (statement.type === "forGroup") return "forGroup";
  }
  return null;
};

const applyBlockStructure = (statements: DslStatement[], diagnostics: DslDiagnostic[]) => {
  const stack: BlockFrame[] = [];
  const enclosingOf = () => {
    const top = stack.at(-1);
    return top ? { statementIndex: top.statementIndex, branch: top.branch } : null;
  };

  statements.forEach((statement, index) => {
    statement.enclosing = enclosingOf();
    if (statement.kind === "blockElse") {
      const top = stack.at(-1);
      if (!top || top.kind !== "conditionalGroup" || top.branch !== "then") {
        diagnostics.push(diagnostic(statement.line, "「} else {」は if ブロックの then 部の直後にのみ書けます。"));
        return;
      }
      top.branch = "else";
      return;
    }
    if (statement.kind === "blockEnd") {
      if (stack.length === 0) {
        diagnostics.push(diagnostic(statement.line, "対応するブロックの開きがない「}」です。"));
        return;
      }
      stack.pop();
      return;
    }
    const top = stack.at(-1);
    if (top?.kind === "printLayout" && statement.kind !== "place" && statement.kind !== "layoutVar") {
      diagnostics.push(diagnostic(statement.line, "printLayout ブロック内には place と layoutVar のみ書けます。"));
    }
    if ((statement.kind === "place" || statement.kind === "layoutVar") && top?.kind !== "printLayout") {
      diagnostics.push(diagnostic(statement.line, `${statement.kind} は printLayout ブロック内にのみ書けます。`));
    }
    if (statement.opensBlock) {
      const frameKind = blockFrameKind(statement);
      if (!frameKind) {
        diagnostics.push(diagnostic(statement.line, "この文はブロックを開けません。"));
        return;
      }
      stack.push({ statementIndex: index, kind: frameKind, branch: "then", line: statement.line });
    }
  });

  for (const frame of stack) {
    diagnostics.push(diagnostic(frame.line, "ブロックが閉じられていません。「}」で閉じてください。"));
  }
};

const reportDuplicateNames = (statements: DslStatement[], diagnostics: DslDiagnostic[]) => {
  const seen = new Map<string, { line: number; hasBareName: boolean; ids: Set<string> }>();
  for (const statement of statements) {
    if (!isElementDslStatement(statement) || !statement.name) continue;
    const scope = statement.enclosing
      ? `block:${statement.enclosing.statementIndex}`
      : `parent:${attrValue(statement.attrs, "parent") ?? ""}`;
    const key = `${scope}\0${statement.name}`;
    const id = attrValue(statement.attrs, "id");
    const entry = seen.get(key);
    if (!entry) {
      seen.set(key, { line: statement.line, hasBareName: !id, ids: new Set(id ? [id] : []) });
      continue;
    }
    if (!id || entry.hasBareName) {
      diagnostics.push(
        diagnostic(statement.line, `同名の要素が同じスコープにあります: ${statement.name}(行 ${entry.line} と重複)`)
      );
    }
    entry.hasBareName ||= !id;
    if (id) entry.ids.add(id);
  }
};

const decorateStatement = (statement: DslStatement, logical: LogicalStatement, sourceMap: ReturnType<typeof createLogicalStatementSourceMap>) => {
  statement.sourceRevision = sourceMap.sourceRevision;
  statement.documentRange = logical.range;
  statement.physicalSpan = physicalSpanForStatement(logical);
  const project = (span: DslSpan) => physicalSpanForLogicalRange(sourceMap, logical, span);
  // Keep legacy logical spans for parser/serializer compatibility while making
  // all source projections use the map-owned physical spans.
  for (const attr of statement.attrs) {
    const physical = project({ start: attr.valueStart, end: attr.valueEnd });
    if (physical) Object.assign(attr, { physicalSpan: physical });
  }
  Object.assign(statement, {
    namePhysicalSpan: statement.nameSpan ? project(statement.nameSpan) : null,
    keywordPhysicalSpan: project(statement.keywordSpan),
    payloadPhysicalSpans: Object.fromEntries(Object.entries(statement.payloadSpans).map(([key, span]) => [key, project(span)]))
  });
  return statement;
};

const decorateDiagnostic = (
  item: DslDiagnostic,
  sourceMap: ReturnType<typeof createLogicalStatementSourceMap>
): DslDiagnostic => {
  // An already-set physicalSpan (e.g. an exact arg-token span attached at the
  // raw-arg validation stage) is more precise than the whole-statement span
  // this function otherwise falls back to; never overwrite it.
  if (item.physicalSpan) return { ...item, sourceRevision: sourceMap.sourceRevision };
  const logical = sourceMap.statements.find((statement) => statement.range.startLine === item.line);
  return { ...item, sourceRevision: sourceMap.sourceRevision, ...(logical ? { physicalSpan: physicalSpanForStatement(logical) } : {}) };
};

export const parseDslSnapshot = (snapshot: SourceSnapshot): ParseDslResult => {
  const statements: DslStatement[] = [];
  const diagnostics: DslDiagnostic[] = [];
  const sourceMap = createLogicalStatementSourceMap(snapshot);
  const requireArgumentCommas = nui3RequiresArgumentCommas(sourceMap.statements);
  // Built once per parse, from the same loop that already visits every
  // LogicalStatement - never re-scanned per diagnostic. This is the only
  // lookup a later exact-span diagnostic projection needs: statement's own
  // documentRange.from -> the LogicalStatement physicalSpanForLogicalRange
  // requires, with no `sourceMap.statements.find(...)` per issue.
  const logicalStatementByRangeFrom = new Map<number, LogicalStatement>();
  for (const line of sourceMap.invalidContinuationLines) {
    // Same UNCLOSED_CALL_CODE as dslCallParser.ts's own "closing `)` not
    // found" diagnostic - this is the multi-line-join layer's version of the
    // identical condition (a call's depth never returns to 0 before EOF, a
    // blank line, or a structural line ends the continuation search). A
    // single-line probe parse (dslLineElementStatement) reaches this branch
    // whenever the probed text's own call is unclosed at end-of-text, which
    // is exactly the mid-edit shape its carve-out already tolerates for this
    // code; full-document severity is unaffected either way.
    diagnostics.push(diagnostic(line, "呼び出しの「(」が閉じられていません。空行やブロック区切りより前に「)」で閉じてください。", UNCLOSED_CALL_CODE));
  }
  for (let index = 0; index < sourceMap.statements.length; index += 1) {
    const logical = sourceMap.statements[index];
    logicalStatementByRangeFrom.set(logical.range.from, logical);
    if (logical.structural === "open") continue;
    if (logical.structural === "close") {
      statements.push(decorateStatement(structuralStatement(logical, "blockEnd"), logical, sourceMap));
      continue;
    }
    if (logical.structural === "else") {
      statements.push(decorateStatement(structuralStatement(logical, "blockElse"), logical, sourceMap));
      continue;
    }
    if (!logical.logicalText.trim()) continue;
    // A multi-line block header is followed by its own structural opening line.
    // An inline `{` at the header's own end (the v2 canonical form) is
    // recognized by the P3/P4 parsers themselves from the logical text.
    const next = sourceMap.statements[index + 1];
    const opensOnNextLine = next?.structural === "open";
    const project = (span: DslSpan) => physicalSpanForLogicalRange(sourceMap, logical, span);
    const parsed = parseLine(logical.logicalText, logical.range.startLine, logical.range.endLine, opensOnNextLine, project, requireArgumentCommas);
    if (parsed.statement) {
      const statement = decorateStatement(parsed.statement, logical, sourceMap);
      if (opensOnNextLine) statement.openBraceLine = next!.range.startLine;
      statements.push(statement);
    }
    diagnostics.push(...parsed.diagnostics);
  }
  applyBlockStructure(statements, diagnostics);
  reportDuplicateNames(statements, diagnostics);
  for (const extra of statements.filter((statement) => statement.kind === "atStop").slice(1)) {
    diagnostics.push(diagnostic(extra.line, "@stop は文書に1つだけ書けます。"));
  }
  return {
    statements,
    diagnostics: diagnostics.map((item) => decorateDiagnostic(item, sourceMap)),
    sourceRevision: snapshot.sourceRevision,
    sourceMap,
    logicalStatementByRangeFrom
  };
};

/** Compatibility/test wrapper. Product callers must provide their source snapshot. */
export const parseDsl = (source: string): ParseDslResult =>
  parseDslSnapshot({ normalizedSource: source.replace(/\r\n/g, "\n"), sourceRevision: 0 });

/**
 * Returns the parser-owned lexical group scope immediately before `line`.
 * Completion uses this against the live editor buffer, including blank lines,
 * instead of projecting scope from a previous compiled document.
 */
export const dslScopeBeforeParsedLine = (parsed: ParseDslResult, line: number) => {
  const stack: BlockFrame[] = [];
  for (const [statementIndex, statement] of parsed.statements.entries()) {
    if (statement.line >= line) break;
    if (statement.kind === "blockElse") {
      const top = stack.at(-1);
      if (top?.kind === "conditionalGroup" && top.branch === "then") top.branch = "else";
      continue;
    }
    if (statement.kind === "blockEnd") {
      stack.pop();
      continue;
    }
    if (!statement.opensBlock) continue;
    const kind = blockFrameKind(statement);
    if (kind) stack.push({ statementIndex, kind, branch: "then", line: statement.line });
  }
  const top = stack.at(-1);
  return top ? { statementIndex: top.statementIndex, branch: top.branch } : null;
};

export const dslScopeBeforeLine = (source: string, line: number) =>
  dslScopeBeforeParsedLine(parseDsl(source), line);
