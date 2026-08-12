import type { DslArgSpec } from "./dslConstructions";
import { settingsSpecFor, type DslSettingsSpec } from "./dslConstructionsSettings";
import { scanCallArgs, type ScannedArg } from "./dslArgScanner";
import type { DslAttribute, DslSpan } from "./dslTypes";
import { unquoteDslString } from "./dslTokens";

export type DslSettingsDiagnostic = { message: string; span: DslSpan };

export type DslSettingsKind =
  | "version"
  | "color"
  | "role"
  | "view"
  | "activeView"
  | "activePrintLayout"
  | "printLayout"
  | "place"
  | "atStop";

export type DslSettingsStatement = {
  kind: DslSettingsKind;
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  args: ScannedArg[];
  attrs: DslAttribute[];
  payloadSpans: Record<string, DslSpan>;
  opensBlock: boolean;
  value?: string;
};

export type DslSettingsParseResult = {
  statement: DslSettingsStatement | null;
  diagnostics: DslSettingsDiagnostic[];
};

export type ParseDslSettingsOptions = { opensBlock?: boolean; requireArgumentCommas?: boolean };

const identifier = /^[A-Za-z_][A-Za-z0-9_]*/;
const whitespace = /\s/;
const callKeywords = new Set(["color", "role", "view", "printLayout", "place"]);
const namedCallKeywords = new Set(["color", "role", "view", "printLayout"]);

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

const topLevelIndex = (source: string, target: string, from = 0) => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
    } else if (character === target && depth === 0) {
      return index;
    } else if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth -= 1;
    }
  }
  return -1;
};

const matchingClose = (source: string, open: number) => {
  let quote: string | null = null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && !escaped(source, index)) quote = null;
      continue;
    }
    if ((character === "\"" || character === "'") && !escaped(source, index)) {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")" && --depth === 0) {
      return index;
    }
  }
  return -1;
};

const attrsFromArgs = (args: readonly ScannedArg[]): DslAttribute[] =>
  args.flatMap((arg) => arg.key && arg.keySpan ? [{
    key: arg.key,
    value: arg.value,
    keyStart: arg.keySpan.start,
    valueStart: arg.valueSpan.start,
    valueEnd: arg.valueSpan.end,
  }] : []);

const addDiagnostic = (diagnostics: DslSettingsDiagnostic[], message: string, span: DslSpan) =>
  diagnostics.push({ message, span });

const parseName = (source: string, span: DslSpan) =>
  span.start === span.end
    ? { name: "", nameSpan: null }
    : { name: unquoteDslString(source.slice(span.start, span.end)), nameSpan: span };

const validateArgs = (
  keyword: string,
  spec: DslSettingsSpec,
  args: readonly ScannedArg[],
  diagnostics: DslSettingsDiagnostic[],
  payloadSpans: Record<string, DslSpan>,
) => {
  const positional = spec.args.find((arg) => arg.positional);
  const allowed = new Map<string, DslArgSpec>(spec.args.map((arg) => [arg.arg, arg]));
  const seen = new Set<string>();
  for (const arg of args) {
    if (arg.key === null) {
      if (!positional) {
        addDiagnostic(diagnostics, `${keyword}文は位置引数を受け付けません。`, arg.valueSpan);
      } else if (payloadSpans[positional.arg]) {
        addDiagnostic(diagnostics, `位置引数「${positional.arg}」が重複しています。`, arg.valueSpan);
      } else {
        payloadSpans[positional.arg] = arg.valueSpan;
      }
      continue;
    }
    if (arg.key === positional?.arg) {
      addDiagnostic(diagnostics, `位置引数「${arg.key}」は名前付き引数として指定できません。`, arg.keySpan!);
      continue;
    }
    if (!allowed.has(arg.key) && !spec.allowsDynamicArgs) {
      const candidates = [...allowed.keys()].join("、") || "なし";
      addDiagnostic(diagnostics, `${keyword}文に引数「${arg.key}」はありません。候補: ${candidates}。`, arg.keySpan!);
      continue;
    }
    if (seen.has(arg.key)) {
      addDiagnostic(diagnostics, `引数「${arg.key}」が重複しています。`, arg.keySpan!);
      continue;
    }
    seen.add(arg.key);
    payloadSpans[arg.key] = arg.valueSpan;
  }
  if (positional && !payloadSpans[positional.arg]) {
    addDiagnostic(diagnostics, `${keyword}文には必須の位置引数「${positional.arg}」が必要です。`, { start: 0, end: keyword.length });
  }
  for (const required of spec.args.filter((arg) => arg.required && !arg.positional)) {
    if (!payloadSpans[required.arg]) {
      addDiagnostic(diagnostics, `${keyword}文には必須引数「${required.arg}」が必要です。`, { start: 0, end: keyword.length });
    }
  }
};

const simpleStatement = (
  source: string,
  keyword: DslSettingsKind,
  keywordSpan: DslSpan,
  rest: DslSpan,
  diagnostics: DslSettingsDiagnostic[],
): DslSettingsStatement => {
  const name = parseName(source, rest);
  if (!name.nameSpan) addDiagnostic(diagnostics, `${keyword}には名前が必要です。`, keywordSpan);
  return {
    kind: keyword,
    ...name,
    keywordSpan,
    args: [],
    attrs: [],
    payloadSpans: name.nameSpan ? { name: name.nameSpan } : {},
    opensBlock: false,
  };
};

export const parseDslSettingsStatement = (
  logicalText: string,
  options: ParseDslSettingsOptions = {},
): DslSettingsParseResult => {
  const diagnostics: DslSettingsDiagnostic[] = [];
  const keywordMatch = logicalText.match(identifier) ?? (logicalText.startsWith("@stop") ? ["@stop"] : null);
  if (!keywordMatch) return { statement: null, diagnostics };
  const keyword = keywordMatch[0];
  const keywordSpan = { start: 0, end: keyword.length };
  const rest = trimSpan(logicalText, keyword.length, logicalText.length);

  if (keyword === "stop" || keyword === "@stop") {
    if (rest.start !== rest.end || options.opensBlock) addDiagnostic(diagnostics, `${keyword} は単独の行に書いてください。`, rest);
    return { statement: { kind: "atStop", name: "", nameSpan: null, keywordSpan, args: [], attrs: [], payloadSpans: {}, opensBlock: false }, diagnostics };
  }
  if (keyword === "nui") {
    return {
      statement: {
        kind: "version", name: "", nameSpan: null, keywordSpan, args: [], attrs: [],
        payloadSpans: rest.start === rest.end ? {} : { value: rest }, opensBlock: false,
        value: logicalText.slice(rest.start, rest.end),
      },
      diagnostics,
    };
  }
  if (keyword === "activeView" || keyword === "activePrintLayout") {
    return { statement: simpleStatement(logicalText, keyword, keywordSpan, rest, diagnostics), diagnostics };
  }
  if (!callKeywords.has(keyword)) return { statement: null, diagnostics };

  const open = topLevelIndex(logicalText, "(", rest.start);
  const beforeCall = trimSpan(logicalText, rest.start, open >= 0 ? open : rest.end);
  const parsedName = parseName(logicalText, beforeCall);
  const name = keyword === "place"
    ? { name: "", nameSpan: null }
    : parsedName;
  if (namedCallKeywords.has(keyword) && !name.nameSpan) addDiagnostic(diagnostics, `${keyword}には名前が必要です。`, keywordSpan);
  if (open < 0) {
    addDiagnostic(diagnostics, `${keyword}文には「(」が必要です。`, { start: rest.end, end: rest.end });
    return { statement: null, diagnostics };
  }
  const close = matchingClose(logicalText, open);
  if (close < 0) {
    addDiagnostic(diagnostics, "呼び出しの「(」が閉じられていません。", { start: open, end: open + 1 });
    return { statement: null, diagnostics };
  }
  const tail = trimSpan(logicalText, close + 1, logicalText.length);
  const inlineBlock = logicalText.slice(tail.start, tail.end) === "{";
  const opensBlock = keyword === "printLayout" && (inlineBlock || Boolean(options.opensBlock));
  if (tail.start < tail.end && !inlineBlock) addDiagnostic(diagnostics, "呼び出しの「)」の後に余分なトークンがあります。", tail);
  if (inlineBlock && keyword !== "printLayout") addDiagnostic(diagnostics, `${keyword}文はブロックを開けません。`, tail);
  if (keyword === "printLayout" && !opensBlock) addDiagnostic(diagnostics, "printLayout にはブロックが必要です。", keywordSpan);

  const scanned = scanCallArgs(logicalText, { start: open + 1, end: close }, { requireCommas: Boolean(options.requireArgumentCommas) });
  diagnostics.push(...scanned.errors);
  if (keyword === "place" && parsedName.nameSpan) {
    scanned.args.unshift({
      key: null,
      keySpan: null,
      value: logicalText.slice(parsedName.nameSpan.start, parsedName.nameSpan.end),
      valueSpan: parsedName.nameSpan,
    });
  }
  const payloadSpans: Record<string, DslSpan> = {};
  const spec = settingsSpecFor(keyword)!;
  validateArgs(keyword, spec, scanned.args, diagnostics, payloadSpans);
  return {
    statement: {
      kind: keyword as Extract<DslSettingsKind, "color" | "role" | "view" | "printLayout" | "place">,
      ...name,
      keywordSpan,
      args: scanned.args,
      attrs: attrsFromArgs(scanned.args),
      payloadSpans,
      opensBlock,
    },
    diagnostics,
  };
};
