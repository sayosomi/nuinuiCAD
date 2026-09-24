import type { DslArgSpec } from "./dslConstructions";
import { settingsSpecFor, type DslSettingsSpec } from "./dslConstructionsSettings";
import { scanCallArgs, type ScannedArg } from "./dslArgScanner";
import type { DslAttribute, DslDiagnosticPresentation, DslSpan } from "./dslTypes";
import { unquoteDslString } from "./dslTokens";

export type DslSettingsDiagnostic = {
  message: string;
  span: DslSpan;
  code?: string;
  presentation?: DslDiagnosticPresentation;
};

export type DslSettingsKind =
  | "version"
  | "role"
  | "view"
  | "activeView"
  | "layout"
  | "print"
  | "svg"
  | "place";

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

export type ParseDslSettingsOptions = { opensBlock?: boolean };

const identifier = /^[A-Za-z_][A-Za-z0-9_]*/;
const whitespace = /\s/;
const callKeywords = new Set(["role", "view", "layout", "print", "svg", "place"]);
const namedCallKeywords = new Set(["role", "view", "layout", "print", "svg"]);

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

const addDiagnostic = (
  diagnostics: DslSettingsDiagnostic[],
  message: string,
  span: DslSpan,
  code: string,
  parameters?: Readonly<Record<string, string | number | boolean>>,
) => diagnostics.push({
  message,
  span,
  code,
  presentation: {
    key: `diagnostic.${code}`,
    ...(parameters ? { parameters } : {}),
  },
});

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
        addDiagnostic(
          diagnostics,
          `${keyword}文は位置引数を受け付けません。`,
          arg.valueSpan,
          "settings-positional-argument-not-accepted",
          { keyword },
        );
      } else if (payloadSpans[positional.arg]) {
        addDiagnostic(
          diagnostics,
          `位置引数「${positional.arg}」が重複しています。`,
          arg.valueSpan,
          "settings-duplicate-positional-argument",
          { keyword, parameter: positional.arg },
        );
      } else {
        payloadSpans[positional.arg] = arg.valueSpan;
      }
      continue;
    }
    if (arg.key === positional?.arg) {
      addDiagnostic(
        diagnostics,
        `位置引数「${arg.key}」は名前付き引数として指定できません。`,
        arg.keySpan!,
        "settings-positional-argument-named",
        { keyword, parameter: arg.key },
      );
      continue;
    }
    if (!allowed.has(arg.key) && !spec.allowsDynamicArgs) {
      const candidates = [...allowed.keys()].join("、") || "なし";
      addDiagnostic(
        diagnostics,
        `${keyword}文に引数「${arg.key}」はありません。候補: ${candidates}。`,
        arg.keySpan!,
        "settings-unknown-argument",
        { keyword, argument: arg.key, candidates: [...allowed.keys()].join(", ") || "none" },
      );
      continue;
    }
    if (seen.has(arg.key)) {
      addDiagnostic(
        diagnostics,
        `引数「${arg.key}」が重複しています。`,
        arg.keySpan!,
        "settings-duplicate-argument",
        { keyword, argument: arg.key },
      );
      continue;
    }
    seen.add(arg.key);
    payloadSpans[arg.key] = arg.valueSpan;
  }
  if (positional && !payloadSpans[positional.arg]) {
    addDiagnostic(
      diagnostics,
      `${keyword}文には必須の位置引数「${positional.arg}」が必要です。`,
      { start: 0, end: keyword.length },
      "settings-missing-positional-argument",
      { keyword, parameter: positional.arg },
    );
  }
  for (const required of spec.args.filter((arg) => arg.required && !arg.positional)) {
    if (!payloadSpans[required.arg]) {
      addDiagnostic(
        diagnostics,
        `${keyword}文には必須引数「${required.arg}」が必要です。`,
        { start: 0, end: keyword.length },
        "settings-missing-named-argument",
        { keyword, parameter: required.arg },
      );
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
  if (!name.nameSpan) {
    addDiagnostic(diagnostics, `${keyword}には名前が必要です。`, keywordSpan, "settings-missing-statement-name", { keyword });
  }
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
  if (logicalText.trimStart().startsWith("@stop")) {
    const start = logicalText.indexOf("@stop");
    addDiagnostic(
      diagnostics,
      "`@stop` は nui1 の有効な構文ではありません。",
      { start, end: start + 5 },
      "settings-invalid-stop",
      { token: "@stop" },
    );
    return { statement: null, diagnostics };
  }
  const keywordMatch = logicalText.match(identifier);
  if (!keywordMatch) return { statement: null, diagnostics };
  const keyword = keywordMatch[0];
  const keywordSpan = { start: 0, end: keyword.length };
  const rest = trimSpan(logicalText, keyword.length, logicalText.length);

  if (keyword === "stop") {
    addDiagnostic(diagnostics, "stop は nui1 の有効な構文ではありません。", keywordSpan, "settings-invalid-stop", { token: "stop" });
    return { statement: null, diagnostics };
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
  if (keyword === "activeView") {
    return { statement: simpleStatement(logicalText, keyword, keywordSpan, rest, diagnostics), diagnostics };
  }
  if (!callKeywords.has(keyword)) return { statement: null, diagnostics };

  const trimmedEnd = logicalText.trimEnd().length;
  const inlineBlock = logicalText[trimmedEnd - 1] === "{";
  const bodyEnd = inlineBlock ? trimmedEnd - 1 : logicalText.length;
  const open = topLevelIndex(logicalText, "(", rest.start);
  const beforeCall = trimSpan(logicalText, rest.start, open >= 0 ? open : bodyEnd);
  const parsedName = parseName(logicalText, beforeCall);
  const name = keyword === "place"
    ? { name: "", nameSpan: null }
    : parsedName;
  if (namedCallKeywords.has(keyword) && !name.nameSpan) {
    addDiagnostic(diagnostics, `${keyword}には名前が必要です。`, keywordSpan, "settings-missing-statement-name", { keyword });
  }
  if (open < 0 && keyword === "layout" && (inlineBlock || options.opensBlock)) {
    const payloadSpans: Record<string, DslSpan> = {};
    const spec = settingsSpecFor(keyword)!;
    validateArgs(keyword, spec, [], diagnostics, payloadSpans);
    return {
      statement: {
        kind: keyword,
        ...name,
        keywordSpan,
        args: [],
        attrs: [],
        payloadSpans,
        opensBlock: true
      },
      diagnostics
    };
  }
  if (open < 0) {
    addDiagnostic(
      diagnostics,
      `${keyword}文には「(」が必要です。`,
      { start: rest.end, end: rest.end },
      "settings-missing-call-open",
      { keyword },
    );
    return { statement: null, diagnostics };
  }
  const close = matchingClose(logicalText, open);
  if (close < 0) {
    addDiagnostic(
      diagnostics,
      "呼び出しの「(」が閉じられていません。",
      { start: open, end: open + 1 },
      "unclosed-call",
    );
    return { statement: null, diagnostics };
  }
  const tail = trimSpan(logicalText, close + 1, logicalText.length);
  const hasInlineBlock = logicalText.slice(tail.start, tail.end) === "{";
  const opensBlock = keyword === "layout" && (hasInlineBlock || Boolean(options.opensBlock));
  if (tail.start < tail.end && !hasInlineBlock) {
    addDiagnostic(
      diagnostics,
      "呼び出しの「)」の後に余分なトークンがあります。",
      tail,
      "settings-trailing-token-after-call",
      { keyword },
    );
  }
  if (hasInlineBlock && keyword !== "layout") {
    addDiagnostic(diagnostics, `${keyword}文はブロックを開けません。`, tail, "settings-block-not-allowed", { keyword });
  }
  if (keyword === "layout" && !opensBlock) {
    addDiagnostic(diagnostics, "layout にはブロックが必要です。", keywordSpan, "settings-layout-block-required", { keyword });
  }

  const scanned = scanCallArgs(logicalText, { start: open + 1, end: close });
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
      kind: keyword as Extract<DslSettingsKind, "role" | "view" | "layout" | "print" | "svg" | "place">,
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
