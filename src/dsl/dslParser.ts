import type {
  DslAttribute,
  DslDiagnostic,
  DslSpan,
  DslStatement,
  DslStatementBase,
  DslModifierProperty,
  ParseDslResult
} from "./dslTypes";
import type {
  DrawingModifierState,
  DrawingModifierStroke,
  DrawingModifierStrokeStyle,
  DrawingModifierThemeRole
} from "../types/geometry";
import { isBareDslIdentifierChar, unquoteDslString } from "./dslTokens";
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
import {
  parseDslModuleStatement,
  type DslModuleParsedStatement,
  type DslModuleParseResult
} from "./dslModuleParser";
import { parseDslExportStatement } from "./dslExportParser";
import { isCompilableDslStatement } from "./dslCompilationGuard";

/**
 * Statement-leading spellings accepted by this parser. Keeping these constants
 * next to the dispatch below makes the parser, rather than an editor-side
 * keyword list, the source of truth for completion.
 */
export const dslStatementKeywords = {
  stop: "stop",
  version: "nui",
  for: "for",
  place: "place",
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
  edge: "edge",
  extend: "extend",
  move: "move",
  mirrorMove: "mirrorMove",
  point: "point",
  line: "line",
  curve: "curve",
  arc: "arc",
  text: "text",
  image: "image",
  group: "group",
  module: "module",
  modifier: "modifier",
  instance: "instance",
  export: "export"
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
  dslStatementKeywords.place
]);

// const/let route to their own focused parser (P5, dslDeclarationParser),
// disjoint from the call-category && settings keyword sets above.
const declarationKeywords = new Set<string>([dslStatementKeywords.constDeclaration, dslStatementKeywords.letDeclaration]);

// set routes to its own focused parser (P7, dslSetParser), independent of
// declarationKeywords - Task 29 must not mix a set branch into
// dslDeclarationParser.ts.
const setKeywords = new Set<string>([dslStatementKeywords.setStatement]);

// Bare mutation-statement keywords (P3/dslCallParser's bare-call branch):
// the construction keyword itself leads the statement, with no
// `<category> <name> =` prefix. See dslConstructions.ts's "mutation" category.
const mutationKeywords = new Set<string>([
  dslStatementKeywords.edge,
  dslStatementKeywords.extend,
  dslStatementKeywords.move,
  dslStatementKeywords.mirrorMove,
  dslStatementKeywords.reverseStatement
]);

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
  "moduleDefinition",
  "modifierDefinition",
  "modifierProperty",
  "moduleInstance",
  "typedDeclaration",
  "set",
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
  modifierNames?: readonly string[];
  modifierNameSpans?: readonly DslSpan[];
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
  physicalSpan: { segments: [], sourceRevision: 0 },
  ...(parsed.modifierNames ? { modifierNames: parsed.modifierNames } : {}),
  ...(parsed.modifierNameSpans ? { modifierNameSpans: parsed.modifierNameSpans } : {})
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

const callStatementToDslStatement = (
  call: DslCallStatement,
  line: number,
  endLine: number,
  exportInfo?: { exportSpan: DslSpan }
): DslStatement => {
  const base = withSyntheticPositionalAttr(call, baseFrom(call, line, endLine));
  if (call.category === "group") {
    return { ...base, kind: "group" };
  }
  return {
    ...base,
    kind: "element",
    type: call.elementType,
    category: call.category,
    construction: call.construction,
    exported: Boolean(exportInfo),
    exportSpan: exportInfo?.exportSpan ?? null
  };
};

const moduleStatementToDslStatement = (
  parsed: DslModuleParsedStatement,
  line: number,
  endLine: number
): DslStatement => {
  const base = baseFrom(parsed, line, endLine);
  if (parsed.kind === "moduleDefinition") {
    return { ...base, kind: "moduleDefinition", parameters: parsed.parameters };
  }
  return {
    ...base,
    kind: "moduleInstance",
    moduleName: parsed.moduleName,
    moduleNameSpan: parsed.moduleNameSpan,
    options: parsed.options,
    arguments: parsed.arguments
  };
};

const settingsStatementToDslStatement = (settings: DslSettingsStatement, line: number, endLine: number): DslStatement => {
  const base = baseFrom(settings, line, endLine);
  switch (settings.kind) {
    case "version":
      return { ...base, kind: "version", value: settings.value ?? "" };
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
  initializer: decl.initializer,
  exported: decl.exported ?? false,
  exportSpan: decl.exportSpan ?? null
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

type ParsedModifierDefinition = StatementCommonFields & {
  state: DrawingModifierState | null;
  stroke: DrawingModifierStroke | null;
};

type ParsedModifierProperty = {
  property: DslModifierProperty;
  keywordSpan: DslSpan;
  name: string;
  nameSpan: DslSpan;
  payloadSpans: Record<string, DslSpan>;
  attrs: DslAttribute[];
  opensBlock: false;
};

const modifierStateValues = new Set<DrawingModifierState>(["visible", "hidden", "disabled"]);
const modifierStrokeStyles = new Set<DrawingModifierStrokeStyle>(["solid", "dashed", "dotted"]);
const modifierThemeRoles = new Set<DrawingModifierThemeRole>([
  "foreground",
  "muted",
  "accent",
  "info",
  "warning",
  "error"
]);
const modifierFixedColorPattern = /^#[0-9a-fA-F]{6}$/;

const parseModifierDefinition = (
  logicalText: string,
  opensOnNextLine: boolean,
  diagnostics: DslDiagnostic[],
  line: number
): ParsedModifierDefinition | null => {
  const keyword = "modifier";
  const keywordSpan = { start: 0, end: keyword.length };
  const restStart = keyword.length;
  const trimmedEnd = logicalText.trimEnd().length;
  const inlineBrace = logicalText[trimmedEnd - 1] === "{";
  const nameEnd = inlineBrace ? trimmedEnd - 1 : logicalText.length;
  const nameSpan = (() => {
    let start = restStart;
    let end = nameEnd;
    while (start < end && /\s/.test(logicalText[start]!)) start += 1;
    while (end > start && /\s/.test(logicalText[end - 1]!)) end -= 1;
    return { start, end };
  })();
  if (nameSpan.start === nameSpan.end) {
    diagnostics.push(diagnostic(line, "modifier には名前が必要です。"));
  } else {
    const rawName = logicalText.slice(nameSpan.start, nameSpan.end);
    const quoted = (rawName.startsWith("\"") && rawName.endsWith("\"")) ||
      (rawName.startsWith("'") && rawName.endsWith("'"));
    if (!quoted && [...rawName].some((character) => !isBareDslIdentifierChar(character))) {
      diagnostics.push(diagnostic(line, "modifier の名前が不正です。空白や構文記号を含める場合は引用符で囲んでください。"));
    }
  }
  if (inlineBrace && trimmedEnd < logicalText.length && logicalText.slice(trimmedEnd).trim()) {
    diagnostics.push(diagnostic(line, "modifier ブロックの「{」の後に余分なトークンがあります。"));
  }
  const opensBlock = inlineBrace || opensOnNextLine;
  if (!opensBlock) diagnostics.push(diagnostic(line, "modifier にはブロックが必要です。"));
  return {
    name: nameSpan.start === nameSpan.end ? "" : unquoteDslString(logicalText.slice(nameSpan.start, nameSpan.end)),
    nameSpan: nameSpan.start === nameSpan.end ? null : nameSpan,
    keywordSpan,
    opensBlock,
    payloadSpans: nameSpan.start === nameSpan.end ? {} : { name: nameSpan },
    attrs: [],
    state: null,
    stroke: null
  };
};

const topLevelComma = (source: string, start: number, end: number) => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && source[index - 1] !== "\\") {
      quote = character;
    } else if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      return index;
    }
  }
  return -1;
};

const parseModifierProperty = (
  logicalText: string,
  diagnostics: DslDiagnostic[],
  line: number
): ParsedModifierProperty | null => {
  const match = logicalText.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
  if (!match) return null;
  const key = match[1]!;
  const keyStart = 0;
  const keyEnd = key.length;
  const colon = logicalText.indexOf(":", keyEnd);
  const codeEnd = logicalText.trimEnd().length;
  const hasTrailingComma = logicalText[codeEnd - 1] === ",";
  if (!hasTrailingComma) diagnostics.push(diagnostic(line, "modifier のプロパティには末尾の「,」が必要です。"));
  const valueEndLimit = hasTrailingComma ? codeEnd - 1 : codeEnd;
  let valueStart = colon + 1;
  while (valueStart < valueEndLimit && /\s/.test(logicalText[valueStart]!)) valueStart += 1;
  let valueEnd = valueEndLimit;
  while (valueEnd > valueStart && /\s/.test(logicalText[valueEnd - 1]!)) valueEnd -= 1;
  const extraComma = topLevelComma(logicalText, valueStart, valueEnd);
  if (extraComma >= 0) {
    diagnostics.push(diagnostic(line, "modifier ブロックでは1行に1つのプロパティだけ指定できます。"));
    valueEnd = extraComma;
    while (valueEnd > valueStart && /\s/.test(logicalText[valueEnd - 1]!)) valueEnd -= 1;
  }
  if (valueStart === valueEnd) diagnostics.push(diagnostic(line, `modifier プロパティ「${key}」の値がありません。`));
  const property: DslModifierProperty = {
    key,
    value: logicalText.slice(valueStart, valueEnd),
    keySpan: { start: keyStart, end: keyEnd },
    valueSpan: { start: valueStart, end: valueEnd },
    hasTrailingComma
  };
  return {
    property,
    keywordSpan: { start: keyStart, end: keyEnd },
    name: key,
    nameSpan: { start: keyStart, end: keyEnd },
    payloadSpans: { value: property.valueSpan },
    attrs: [],
    opensBlock: false
  };
};

const parseModifierStroke = (
  value: string,
  diagnostics: DslDiagnostic[],
  line: number
): DrawingModifierStroke | null => {
  const parts = value.trim().match(/^(\S+)\s+(\S+)\s+(\S+)$/);
  if (!parts) {
    diagnostics.push(diagnostic(line, "modifier の stroke は `<width>px <style> <color>` の形式で指定してください。"));
    return null;
  }
  const [, widthToken, styleToken, colorToken] = parts;
  const widthMatch = widthToken!.match(/^(\d+(?:\.\d*)?|\.\d+)px$/);
  const width = widthMatch ? Number(widthMatch[1]) : NaN;
  if (!widthMatch || !Number.isFinite(width) || width <= 0) {
    diagnostics.push(diagnostic(line, "modifier の stroke 幅は正の有限な10進数で指定してください(例: 1.5px)。"));
    return null;
  }
  if (!modifierStrokeStyles.has(styleToken as DrawingModifierStrokeStyle)) {
    diagnostics.push(diagnostic(line, "modifier の stroke style は solid / dashed / dotted のいずれかで指定してください。"));
    return null;
  }

  const color = colorToken!;
  if (modifierThemeRoles.has(color as DrawingModifierThemeRole)) {
    return {
      widthPx: width,
      style: styleToken as DrawingModifierStrokeStyle,
      color: { kind: "themeRole", role: color as DrawingModifierThemeRole }
    };
  }
  if (color.startsWith("#")) {
    if (!modifierFixedColorPattern.test(color)) {
      diagnostics.push(diagnostic(line, "modifier の stroke 固定色は #RRGGBB の形式で指定してください。"));
      return null;
    }
    return {
      widthPx: width,
      style: styleToken as DrawingModifierStrokeStyle,
      color: { kind: "fixed", hex: color.toLowerCase() }
    };
  }
  diagnostics.push(diagnostic(line, "modifier の stroke 色は foreground / muted / accent / info / warning / error または #RRGGBB で指定してください。"));
  return null;
};

const modifierDefinitionToDslStatement = (
  parsed: ParsedModifierDefinition,
  line: number,
  endLine: number
): DslStatement => ({
  ...baseFrom(parsed, line, endLine),
  kind: "modifierDefinition",
  state: parsed.state,
  stroke: parsed.stroke,
  properties: []
});

const modifierPropertyToDslStatement = (
  parsed: ParsedModifierProperty,
  line: number,
  endLine: number
): DslStatement => ({
  ...baseFrom(parsed, line, endLine),
  kind: "modifierProperty",
  property: parsed.property
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
  project: (span: DslSpan) => DslPhysicalSpan | null,
  exportInfo?: { exportSpan: DslSpan }
): ParsedLine => {
  const diagnostics = result.diagnostics.map((item) =>
    diagnostic(line, item.message, item.code, project(item.span) ?? undefined)
  );
  if (!result.statement) return { diagnostics };
  return { statement: callStatementToDslStatement(result.statement, line, endLine, exportInfo), diagnostics };
};

const fromModule = (
  result: DslModuleParseResult,
  line: number,
  endLine: number,
  project: (span: DslSpan) => DslPhysicalSpan | null
): ParsedLine => {
  const diagnostics = result.diagnostics.map((item) =>
    diagnostic(line, item.message, item.code, project(item.span) ?? undefined)
  );
  if (!result.statement) return { diagnostics };
  return { statement: moduleStatementToDslStatement(result.statement, line, endLine), diagnostics };
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

const leadingIdentifier = /^[A-Za-z_][A-Za-z0-9_]*/;

const parseLine = (
  logicalText: string,
  line: number,
  endLine: number,
  opensOnNextLine: boolean,
  project: (span: DslSpan) => DslPhysicalSpan | null,
): ParsedLine => {
  if (/^stop(?:\s|$)/.test(logicalText)) {
    return fromSettings(parseDslSettingsStatement(logicalText, { opensBlock: opensOnNextLine }), line, endLine);
  }
  const keyword = logicalText.match(leadingIdentifier)?.[0] ?? "";
  if (keyword === dslStatementKeywords.module) {
    return fromModule(parseDslModuleStatement(logicalText, { opensBlock: opensOnNextLine }), line, endLine, project);
  }
  if (keyword === dslStatementKeywords.instance) {
    return fromModule(parseDslModuleStatement(logicalText, { opensBlock: opensOnNextLine }), line, endLine, project);
  }
  if (keyword === dslStatementKeywords.modifier) {
    const modifierDiagnostics: DslDiagnostic[] = [];
    const parsed = parseModifierDefinition(logicalText, opensOnNextLine, modifierDiagnostics, line)!;
    return {
      statement: modifierDefinitionToDslStatement(parsed, line, endLine),
      diagnostics: modifierDiagnostics
    };
  }
  if (keyword === dslStatementKeywords.export) {
    const parsed = parseDslExportStatement(logicalText, { opensBlock: opensOnNextLine });
    if (parsed.kind === "geometry" && parsed.call) {
      return fromCall(parsed.call, line, endLine, project, { exportSpan: parsed.exportSpan });
    }
    if (parsed.kind === "typedDeclaration" && parsed.declaration) {
      return fromDeclaration(parsed.declaration, line, endLine, project);
    }
    return {
      diagnostics: parsed.diagnostics.map((item) =>
        diagnostic(line, item.message, item.code, project(item.span) ?? undefined)
      )
    };
  }
  const propertyCandidate =
    !declarationKeywords.has(keyword) &&
    !setKeywords.has(keyword) &&
    /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(logicalText);
  if (propertyCandidate) {
    const propertyDiagnostics: DslDiagnostic[] = [];
    const parsed = parseModifierProperty(logicalText, propertyDiagnostics, line)!;
    return {
      statement: modifierPropertyToDslStatement(parsed, line, endLine),
      diagnostics: propertyDiagnostics
    };
  }
  if (callCategoryKeywords.has(keyword) || mutationKeywords.has(keyword)) {
    return fromCall(parseDslCallStatement(logicalText, { opensBlock: opensOnNextLine }), line, endLine, project);
  }
  if (settingsKeywords.has(keyword)) {
    return fromSettings(parseDslSettingsStatement(logicalText, { opensBlock: opensOnNextLine }), line, endLine);
  }
  if (declarationKeywords.has(keyword)) {
    return fromDeclaration(parseDslTypedDeclarationStatement(logicalText), line, endLine, project);
  }
  if (setKeywords.has(keyword)) {
    return fromSet(parseDslSetStatement(logicalText), line, endLine, project);
  }
  return {
    diagnostics: [diagnostic(line, keyword ? `未対応のDSLキーワードです: ${keyword}` : "文はキーワードから始めてください。")]
  };
};

type BlockFrame = {
  statementIndex: number;
  kind: "group" | "conditionalGroup" | "forGroup" | "printLayout" | "moduleDefinition" | "modifier";
  branch: "then" | "else";
  line: number;
};

export const blockFrameKind = (statement: DslStatement): BlockFrame["kind"] | null => {
  if (statement.kind === "moduleDefinition") return "moduleDefinition";
  if (statement.kind === "modifierDefinition") return "modifier";
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
    const modifierAncestor = stack.some((frame) => frame.kind === "modifier");
    if (statement.kind === "modifierProperty" && top?.kind !== "modifier") {
      diagnostics.push(diagnostic(statement.line, "modifier プロパティは modifier ブロック内にのみ書けます。"));
    } else if (modifierAncestor && statement.kind === "modifierDefinition") {
      diagnostics.push(diagnostic(statement.line, "modifier 定義を別のブロック内にネストできません。"));
    } else if (modifierAncestor && statement.kind !== "modifierProperty") {
      diagnostics.push(diagnostic(statement.line, "modifier ブロック内には state / stroke プロパティだけを書けます。"));
    }
    if (
      top?.kind === "printLayout" &&
      statement.kind !== "place" &&
      statement.kind !== "typedDeclaration" &&
      statement.kind !== "set"
    ) {
      diagnostics.push(diagnostic(statement.line, "printLayout ブロック内には const / let / set と place のみ書けます。"));
    }
    if (statement.kind === "place" && top?.kind !== "printLayout") {
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

const finalizeModifierStatements = (statements: DslStatement[], diagnostics: DslDiagnostic[]) => {
  const definitions = statements.filter(
    (statement): statement is Extract<DslStatement, { kind: "modifierDefinition" }> =>
      statement.kind === "modifierDefinition"
  );
  const seen = new Map<string, number>();
  for (const definition of definitions) {
    if (definition.enclosing) {
      diagnostics.push(diagnostic(definition.line, "modifier 定義は文書のトップレベルにのみ書けます。"));
    }
    if (definition.name) {
      const previousLine = seen.get(definition.name);
      if (previousLine !== undefined) {
        diagnostics.push(diagnostic(definition.line, `modifier 名が重複しています: ${definition.name} (行 ${previousLine} と重複)`));
      } else {
        seen.set(definition.name, definition.line);
      }
    }
    const properties = statements
      .filter((statement): statement is Extract<DslStatement, { kind: "modifierProperty" }> =>
        statement.kind === "modifierProperty" && statement.enclosing?.statementIndex === statements.indexOf(definition)
      )
      .map((statement) => statement.property);
    definition.properties = properties;
    const propertiesByKey = new Map<string, DslModifierProperty[]>();
    for (const property of properties) {
      const sameKey = propertiesByKey.get(property.key) ?? [];
      sameKey.push(property);
      propertiesByKey.set(property.key, sameKey);
    }
    for (const [key, sameKey] of propertiesByKey) {
      if (sameKey.length > 1) {
        diagnostics.push(diagnostic(definition.line, `modifier の ${key} プロパティは1つだけ指定できます。`));
      }
    }
    if (properties.some((property) => property.key !== "state" && property.key !== "stroke")) {
      for (const property of properties.filter((item) => item.key !== "state" && item.key !== "stroke")) {
        diagnostics.push(diagnostic(definition.line, `modifier に未知のプロパティ「${property.key}」があります。`));
      }
    }
    const stateProperties = propertiesByKey.get("state") ?? [];
    const strokeProperties = propertiesByKey.get("stroke") ?? [];
    if (stateProperties.length === 0 && strokeProperties.length === 0) {
      diagnostics.push(diagnostic(definition.line, "modifier には state または stroke プロパティが1つ以上必要です。"));
    }
    const state = stateProperties[0]?.value;
    if (state !== undefined && !modifierStateValues.has(state as DrawingModifierState)) {
      diagnostics.push(diagnostic(definition.line, "modifier の state は visible / hidden / disabled のいずれかで指定してください。"));
      definition.state = null;
    } else {
      definition.state = state as DrawingModifierState | undefined ?? null;
    }
    definition.stroke = strokeProperties[0]
      ? parseModifierStroke(strokeProperties[0].value, diagnostics, definition.line)
      : null;
  }
};

const reportDuplicateNames = (statements: DslStatement[], diagnostics: DslDiagnostic[]) => {
  const seen = new Map<string, { line: number; hasBareName: boolean; ids: Set<string> }>();
  for (const [statementIndex, statement] of statements.entries()) {
    if (!isCompilableDslStatement(statements, statementIndex)) continue;
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
  // Keep logical spans for parser/serializer compatibility while making
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
  if (statement.kind === "element" || statement.kind === "group") {
    if (statement.kind === "element") statement.exportPhysicalSpan = statement.exportSpan ? project(statement.exportSpan) : null;
    statement.modifierNamePhysicalSpans = (statement.modifierNameSpans ?? []).map((span) => project(span));
  } else if (statement.kind === "moduleDefinition") {
    for (const parameter of statement.parameters) {
      parameter.namePhysicalSpan = parameter.nameSpan ? project(parameter.nameSpan) : null;
      parameter.typePhysicalSpan = parameter.typeSpan ? project(parameter.typeSpan) : null;
      parameter.defaultPhysicalSpan = parameter.defaultSpan ? project(parameter.defaultSpan) : null;
    }
  } else if (statement.kind === "modifierProperty") {
    statement.property.keyPhysicalSpan = project(statement.property.keySpan);
    statement.property.valuePhysicalSpan = project(statement.property.valueSpan);
  } else if (statement.kind === "modifierDefinition") {
    for (const property of statement.properties) {
      property.keyPhysicalSpan = project(property.keySpan);
      property.valuePhysicalSpan = project(property.valueSpan);
    }
  } else if (statement.kind === "typedDeclaration") {
    statement.exportPhysicalSpan = statement.exportSpan ? project(statement.exportSpan) : null;
  } else if (statement.kind === "moduleInstance") {
    statement.moduleNamePhysicalSpan = statement.moduleNameSpan ? project(statement.moduleNameSpan) : null;
    for (const option of statement.options) {
      option.namePhysicalSpan = option.nameSpan ? project(option.nameSpan) : null;
      option.valuePhysicalSpan = project(option.valueSpan);
    }
    for (const argument of statement.arguments) {
      argument.labelPhysicalSpan = argument.labelSpan ? project(argument.labelSpan) : null;
      argument.valuePhysicalSpan = project(argument.valueSpan);
    }
  }
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
  if (sourceMap.unterminatedBlockComment) {
    diagnostics.push({
      ...diagnostic(
        sourceMap.unterminatedBlockComment.line,
        "ブロックコメントが閉じられていません。「*/」で閉じてください。"
      ),
      column: sourceMap.unterminatedBlockComment.column
    });
  }
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
    // blank line, || a structural line ends the continuation search). A
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
    // An inline `{` at the header's own end is
    // recognized by the P3/P4 parsers themselves from the logical text.
    const next = sourceMap.statements[index + 1];
    const opensOnNextLine = next?.structural === "open";
    const project = (span: DslSpan) => physicalSpanForLogicalRange(sourceMap, logical, span);
    const parsed = parseLine(logical.logicalText, logical.range.startLine, logical.range.endLine, opensOnNextLine, project);
    if (parsed.statement) {
      const statement = decorateStatement(parsed.statement, logical, sourceMap);
      if (opensOnNextLine) statement.openBraceLine = next!.range.startLine;
      statements.push(statement);
    }
    diagnostics.push(...parsed.diagnostics);
  }
  applyBlockStructure(statements, diagnostics);
  finalizeModifierStatements(statements, diagnostics);
  reportDuplicateNames(statements, diagnostics);
  for (const extra of statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter(({ statement, statementIndex }) =>
      statement.kind === "atStop" && isCompilableDslStatement(statements, statementIndex)
    )
    .slice(1)
    .map(({ statement }) => statement)) {
    diagnostics.push(diagnostic(extra.line, "stop は文書に1つだけ書けます。"));
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
