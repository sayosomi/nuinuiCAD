import { scanCallArgs, type ScannedArg } from "./dslArgScanner";
import { parseDslScalarType } from "./dslTypeParser";
import type {
  DslAttribute,
  DslModuleArgument,
  DslModuleParameter,
  DslSpan
} from "./dslTypes";
import { unquoteDslString } from "./dslTokens";

export type DslModuleDiagnostic = { message: string; span: DslSpan; code?: string };

type DslModuleStatementCommon = {
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  opensBlock: boolean;
  payloadSpans: Record<string, DslSpan>;
  attrs: DslAttribute[];
};

export type DslModuleParsedStatement =
  | (DslModuleStatementCommon & {
      kind: "moduleDefinition";
      parameters: readonly DslModuleParameter[];
    })
  | (DslModuleStatementCommon & {
      kind: "moduleInstance";
      moduleName: string;
      moduleNameSpan: DslSpan | null;
      arguments: readonly DslModuleArgument[];
    });

export type DslModuleParseResult = {
  statement: DslModuleParsedStatement | null;
  diagnostics: DslModuleDiagnostic[];
};

export type ParseDslModuleOptions = {
  opensBlock?: boolean;
};

const identifier = /^[A-Za-z_][A-Za-z0-9_]*/;
const whitespace = /\s/;

const trimSpan = (source: string, start: number, end: number): DslSpan => {
  while (start < end && whitespace.test(source[start])) start += 1;
  while (end > start && whitespace.test(source[end - 1])) end -= 1;
  return { start, end };
};

const escaped = (source: string, index: number) => {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
};

const topLevelIndex = (source: string, target: string, from: number, to = source.length) => {
  let quote: string | null = null;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let index = from; index < to; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
    } else if (character === "(") {
      if (parenDepth === 0 && bracketDepth === 0 && target === "(") return index;
      parenDepth += 1;
    } else if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (character === target && parenDepth === 0 && bracketDepth === 0) {
      return index;
    }
  }
  return -1;
};

const matchingClose = (source: string, open: number, to: number) => {
  let quote: string | null = null;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let index = open; index < to; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
    } else if (character === "(") {
      parenDepth += 1;
    } else if (character === ")" && bracketDepth === 0) {
      parenDepth -= 1;
      if (parenDepth === 0) return index;
    } else if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    }
  }
  return -1;
};

const parseName = (source: string, span: DslSpan): { name: string; nameSpan: DslSpan | null } =>
  span.start === span.end
    ? { name: "", nameSpan: null }
    : { name: unquoteDslString(source.slice(span.start, span.end)), nameSpan: span };

const diagnostic = (diagnostics: DslModuleDiagnostic[], message: string, span: DslSpan, code?: string) => {
  diagnostics.push(code ? { message, span, code } : { message, span });
};

const moduleParameterType = (
  source: string,
  typeSpan: DslSpan,
  diagnostics: DslModuleDiagnostic[]
): Pick<DslModuleParameter, "type" | "choiceOptionSpans" | "numericTypeOptions"> => {
  const text = source.slice(typeSpan.start, typeSpan.end);
  if (text === "point" || text === "line") {
    return { type: { kind: text }, choiceOptionSpans: [] };
  }
  const parsedDiagnostics: DslModuleDiagnostic[] = [];
  const parsed = parseDslScalarType(source, typeSpan, parsedDiagnostics, {
    acceptedTypeDescription: "number/string/boolean/choice(...)/point/line"
  });
  diagnostics.push(...parsedDiagnostics);
  return {
    type: parsed.declaredType,
    choiceOptionSpans: parsed.choiceOptionSpans,
    ...(parsed.numericTypeOptions ? { numericTypeOptions: parsed.numericTypeOptions } : {})
  };
};

const parameterFromArg = (source: string, arg: ScannedArg, diagnostics: DslModuleDiagnostic[]): DslModuleParameter => {
  const name = arg.key === null
    ? { name: "", nameSpan: null }
    : { name: arg.key, nameSpan: arg.keySpan };
  if (arg.key === null) {
    diagnostic(diagnostics, "module parameter は `名前: 型` の形式で指定してください。", arg.valueSpan);
  }

  const equals = topLevelIndex(source, "=", arg.valueSpan.start, arg.valueSpan.end);
  const typeSpan = trimSpan(source, arg.valueSpan.start, equals >= 0 ? equals : arg.valueSpan.end);
  const defaultSpan = equals >= 0
    ? trimSpan(source, equals + 1, arg.valueSpan.end)
    : null;
  if (arg.key !== null && typeSpan.start === typeSpan.end) {
    diagnostic(diagnostics, "module parameter には型注釈が必要です。", arg.valueSpan);
  }
  if (defaultSpan && defaultSpan.start === defaultSpan.end) {
    diagnostic(diagnostics, "module parameter の default には `=` の後に値が必要です。", defaultSpan);
  }

  const parsedType = typeSpan.start === typeSpan.end
    ? { type: null, choiceOptionSpans: [] as DslSpan[] }
    : moduleParameterType(source, typeSpan, diagnostics);
  return {
    kind: "moduleParameter",
    ...name,
    type: parsedType.type,
    typeSpan: typeSpan.start === typeSpan.end ? null : typeSpan,
    choiceOptionSpans: parsedType.choiceOptionSpans,
    ...(parsedType.numericTypeOptions ? { numericTypeOptions: parsedType.numericTypeOptions } : {}),
    defaultValue: defaultSpan ? source.slice(defaultSpan.start, defaultSpan.end) : null,
    defaultSpan
  };
};

const argumentFromArg = (arg: ScannedArg, diagnostics: DslModuleDiagnostic[]): DslModuleArgument => {
  if (arg.key === null) {
    diagnostic(diagnostics, "module argument は名前付き引数で指定してください。", arg.valueSpan);
  }
  return {
    kind: "moduleArgument",
    label: arg.key,
    labelSpan: arg.keySpan,
    value: arg.value,
    valueSpan: arg.valueSpan,
    ...(arg.rawValueSpan ? { rawValueSpan: arg.rawValueSpan } : {})
  };
};

const parseList = (
  source: string,
  span: DslSpan,
  requireArgumentCommas: boolean,
  map: (arg: ScannedArg, diagnostics: DslModuleDiagnostic[]) => DslModuleParameter | DslModuleArgument
): { values: Array<DslModuleParameter | DslModuleArgument>; diagnostics: DslModuleDiagnostic[] } => {
  const scanned = scanCallArgs(source, span, { requireCommas: requireArgumentCommas });
  const diagnostics = scanned.errors.map((error) => ({ message: error.message, span: error.span, ...(error.code ? { code: error.code } : {}) }));
  const values = scanned.args.map((arg) => map(arg, diagnostics));
  return { values, diagnostics };
};

const definition = (logicalText: string, options: ParseDslModuleOptions): DslModuleParseResult => {
  const diagnostics: DslModuleDiagnostic[] = [];
  const keywordSpan = { start: 0, end: "module".length };
  const afterKeyword = trimSpan(logicalText, keywordSpan.end, logicalText.length);
  const brace = topLevelIndex(logicalText, "{", afterKeyword.start);
  const headerEnd = brace >= 0 ? brace : logicalText.length;
  const inlineBlock = brace >= 0 && trimSpan(logicalText, brace + 1, logicalText.length).start === logicalText.length;
  if (brace >= 0 && !inlineBlock) diagnostic(diagnostics, "「{」の後に余分なトークンがあります。", trimSpan(logicalText, brace + 1, logicalText.length));
  const open = topLevelIndex(logicalText, "(", afterKeyword.start, headerEnd);
  const nameSpan = trimSpan(logicalText, afterKeyword.start, open >= 0 ? open : headerEnd);
  const name = parseName(logicalText, nameSpan);
  if (!name.nameSpan) diagnostic(diagnostics, "module definition には名前が必要です。", keywordSpan);
  if (open < 0) {
    diagnostic(diagnostics, "module definition には parameter list の「(」が必要です。", { start: headerEnd, end: headerEnd });
  }
  const close = open >= 0 ? matchingClose(logicalText, open, headerEnd) : -1;
  if (open >= 0 && close < 0) diagnostic(diagnostics, "module parameter list の「(」が閉じられていません。", { start: open, end: open + 1 });
  const parameterSpan = {
    start: open >= 0 ? open + 1 : headerEnd,
    end: close >= 0 ? close : headerEnd
  };
  const parsed = parseList(
    logicalText,
    parameterSpan,
    true,
    (arg, listDiagnostics) => parameterFromArg(logicalText, arg, listDiagnostics)
  );
  diagnostics.push(...parsed.diagnostics);
  const opensBlock = Boolean(options.opensBlock || inlineBlock);
  if (!opensBlock) diagnostic(diagnostics, "module definition にはブロックが必要です。", keywordSpan);
  return {
    statement: {
      kind: "moduleDefinition",
      ...name,
      keywordSpan,
      opensBlock,
      payloadSpans: {
        ...(name.nameSpan ? { name: name.nameSpan } : {}),
        ...(open >= 0 && close >= 0 ? { parameters: parameterSpan } : {})
      },
      attrs: [],
      parameters: parsed.values as DslModuleParameter[]
    },
    diagnostics
  };
};

const instance = (logicalText: string): DslModuleParseResult => {
  const diagnostics: DslModuleDiagnostic[] = [];
  const keywordSpan = { start: 0, end: "module".length };
  const afterKeyword = trimSpan(logicalText, keywordSpan.end, logicalText.length);
  const open = topLevelIndex(logicalText, "(", afterKeyword.start);
  const equals = topLevelIndex(logicalText, "=", afterKeyword.start, open >= 0 ? open : logicalText.length);
  const instanceNameSpan = trimSpan(logicalText, afterKeyword.start, equals >= 0 ? equals : open >= 0 ? open : logicalText.length);
  const instanceName = parseName(logicalText, instanceNameSpan);
  if (!instanceName.nameSpan) diagnostic(diagnostics, "module instance にはインスタンス名が必要です。", keywordSpan);
  if (equals < 0) diagnostic(diagnostics, "module instance には「=」が必要です。", keywordSpan);

  const moduleNameSpan = trimSpan(logicalText, equals >= 0 ? equals + 1 : afterKeyword.end, open >= 0 ? open : logicalText.length);
  const moduleName = parseName(logicalText, moduleNameSpan);
  if (!moduleName.nameSpan) diagnostic(diagnostics, "module instance には呼び出すmodule名が必要です。", { start: equals >= 0 ? equals + 1 : afterKeyword.end, end: equals >= 0 ? equals + 1 : afterKeyword.end });
  if (open < 0) diagnostic(diagnostics, "module instance には argument list の「(」が必要です。", { start: logicalText.length, end: logicalText.length });
  const close = open >= 0 ? matchingClose(logicalText, open, logicalText.length) : -1;
  if (open >= 0 && close < 0) diagnostic(diagnostics, "module argument list の「(」が閉じられていません。", { start: open, end: open + 1 });
  if (close >= 0) {
    const tail = trimSpan(logicalText, close + 1, logicalText.length);
    if (tail.start < tail.end) diagnostic(diagnostics, "module instance の「)」の後に余分なトークンがあります。", tail);
  }
  const argumentSpan = { start: open >= 0 ? open + 1 : logicalText.length, end: close >= 0 ? close : logicalText.length };
  const parsed = parseList(logicalText, argumentSpan, true, argumentFromArg);
  diagnostics.push(...parsed.diagnostics);
  return {
    statement: {
      kind: "moduleInstance",
      ...instanceName,
      keywordSpan,
      opensBlock: false,
      payloadSpans: {
        ...(instanceName.nameSpan ? { name: instanceName.nameSpan } : {}),
        ...(moduleName.nameSpan ? { moduleName: moduleName.nameSpan } : {}),
        ...(open >= 0 && close >= 0 ? { arguments: argumentSpan } : {})
      },
      attrs: [],
      moduleName: moduleName.name,
      moduleNameSpan: moduleName.nameSpan,
      arguments: parsed.values as DslModuleArgument[]
    },
    diagnostics
  };
};

export const parseDslModuleStatement = (
  logicalText: string,
  options: ParseDslModuleOptions = {}
): DslModuleParseResult => {
  const keyword = logicalText.match(identifier)?.[0];
  if (keyword !== "module") return { statement: null, diagnostics: [] };
  const afterKeyword = trimSpan(logicalText, keyword.length, logicalText.length);
  const open = topLevelIndex(logicalText, "(", afterKeyword.start);
  const equals = topLevelIndex(logicalText, "=", afterKeyword.start, open >= 0 ? open : logicalText.length);
  return equals >= 0 ? instance(logicalText) : definition(logicalText, options);
};
