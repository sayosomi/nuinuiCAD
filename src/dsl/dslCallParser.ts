import type { CadElementType } from "../types/geometry";
import {
  categoriesForConstruction,
  commonArgSpecs,
  constructionCandidatesFor,
  constructionFor,
  type DslArgSpec,
} from "./dslConstructions";
import { scanCallArgs, type ScannedArg } from "./dslArgScanner";
import type { DslAttribute, DslSpan } from "./dslTypes";
import { unquoteDslString } from "./dslTokens";

export type DslCallDiagnostic = { message: string; span: DslSpan; code?: string };

/** v3-only `state` conflicting with legacy `visible`/`enabled` in the same statement. */
export const ELEMENT_STATE_CONFLICT_CODE = "element-state-conflict";

export type DslCallStatement = {
  category: string;
  construction: string;
  elementType: CadElementType | null;
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  constructionSpan: DslSpan | null;
  args: ScannedArg[];
  attrs: DslAttribute[];
  payloadSpans: Record<string, DslSpan>;
  opensBlock: boolean;
  shortVariable: boolean;
};

export type DslCallParseResult = {
  statement: DslCallStatement | null;
  diagnostics: DslCallDiagnostic[];
};

export type ParseDslCallOptions = { opensBlock?: boolean; requireArgumentCommas?: boolean };

const identifier = /^[A-Za-z_][A-Za-z0-9_]*/;
const containerCategories = new Set(["group", "if", "for"]);
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
    ...(arg.rawValueSpan ? { rawValueSpan: arg.rawValueSpan } : {}),
  }] : []);

const diagnostic = (diagnostics: DslCallDiagnostic[], message: string, span: DslSpan, code?: string) =>
  diagnostics.push(code ? { message, span, code } : { message, span });

/** state/visible/enabled live in commonArgSpecs, not any single construction's `args`, so
 * this conflict can't be expressed via `DslConstructionSpec.exclusiveGroups`. Exported so
 * Task 41's Quick Fix module can re-derive which side of a conflict is the legacy one
 * (always the second/last entry of a group) without duplicating this table. */
export const commonExclusiveGroups: readonly (readonly [string, string])[] = [
  ["state", "visible"],
  ["state", "enabled"],
];

/** A call whose `(` never finds its matching `)` (mid-edit, e.g. an unterminated
 * string swallowing the rest of the line). The statement returned alongside this
 * code is a best-effort/degraded one - its call span runs to end of text - kept
 * only so single-line probe parses (dslLineElementStatement) can still resolve
 * already-typed argument spans for completion. Full-document compilation is
 * unaffected: every compile gate rejects on `severity: "error"` regardless of
 * this code, the same as any other diagnostic here. */
export const UNCLOSED_CALL_CODE = "unclosed-call";

const isCallConstruction = (source: string, start: number) => {
  const match = source.slice(start).match(identifier);
  if (!match) return false;
  let cursor = start + match[0].length;
  while (whitespace.test(source[cursor] ?? "")) cursor += 1;
  return source[cursor] === "(";
};

const parseName = (source: string, span: DslSpan) => {
  if (span.start === span.end) return { name: "", nameSpan: null };
  return { name: unquoteDslString(source.slice(span.start, span.end)), nameSpan: span };
};

const validateArgs = (
  category: string,
  construction: string,
  categorySpan: DslSpan,
  constructionSpan: DslSpan | null,
  args: ScannedArg[],
  diagnostics: DslCallDiagnostic[],
  payloadSpans: Record<string, DslSpan>,
) => {
  if (category === "use") return null;
  const spec = constructionFor(category, construction);
  const categoryCandidates = constructionCandidatesFor(category);
  if (categoryCandidates.length === 0) {
    diagnostic(diagnostics, `未知の category「${category}」です。`, categorySpan);
    return null;
  }
  if (!spec) {
    const categories = categoriesForConstruction(construction);
    const candidates = categoryCandidates.map((candidate) => candidate.construction).filter(Boolean).join("、") || "なし";
    const message = categories.length > 0
      ? `category「${category}」と construction「${construction}」の組み合わせは不一致です。使用できる category: ${categories.join("、")}。${category} の候補: ${candidates}。`
      : `category「${category}」に construction「${construction}」はありません。候補: ${candidates}。`;
    diagnostic(diagnostics, message, constructionSpan ?? categorySpan);
    return null;
  }

  const positional = spec.args.find((arg) => arg.positional);
  const allowed = new Map<string, DslArgSpec>([...spec.args, ...commonArgSpecs].map((arg) => [arg.arg, arg]));
  const seen = new Set<string>();
  for (const arg of args) {
    if (arg.key === null) {
      if (!positional) {
        diagnostic(diagnostics, `category「${category}」の construction「${construction}」は位置引数を受け付けません。`, arg.valueSpan);
      } else {
        payloadSpans[positional.arg] = arg.valueSpan;
      }
      continue;
    }
    if (!allowed.has(arg.key)) {
      diagnostic(diagnostics, `construction「${construction}」に引数「${arg.key}」はありません。候補: ${[...allowed.keys()].join("、")}。`, arg.keySpan!);
      continue;
    }
    if (arg.key === positional?.arg) {
      const message = args.some((item) => item.key === null)
        ? `位置引数「${arg.key}」が重複しています。`
        : `位置引数「${arg.key}」は名前付き引数として指定できません。`;
      diagnostic(diagnostics, message, arg.keySpan!);
      continue;
    }
    if (seen.has(arg.key)) {
      diagnostic(diagnostics, `引数「${arg.key}」が重複しています。`, arg.keySpan!);
      continue;
    }
    seen.add(arg.key);
    payloadSpans[arg.key] = arg.valueSpan;
  }
  for (const required of spec.args.filter((arg) => arg.required)) {
    const supplied = required.positional
      ? args.some((arg) => arg.key === null)
      : args.some((arg) => arg.key === required.arg);
    if (!supplied) diagnostic(diagnostics, `construction「${construction}」には必須引数「${required.arg}」が必要です。`, constructionSpan ?? categorySpan);
  }
  for (const group of spec.exclusiveGroups ?? []) {
    if (group.every((key) => args.some((arg) => arg.key === key))) {
      const span = args.find((arg) => arg.key === group.at(-1))?.keySpan ?? constructionSpan ?? categorySpan;
      diagnostic(diagnostics, `引数「${group.join("」と「")}」は同時に指定できません。`, span);
    }
  }
  for (const group of commonExclusiveGroups) {
    if (group.every((key) => args.some((arg) => arg.key === key))) {
      const span = args.find((arg) => arg.key === group.at(-1))?.keySpan ?? constructionSpan ?? categorySpan;
      diagnostic(
        diagnostics,
        `引数「${group.join("」と「")}」は同時に指定できません。`,
        span,
        ELEMENT_STATE_CONFLICT_CODE,
      );
    }
  }
  return spec;
};

const callStatement = (
  source: string,
  category: string,
  keywordSpan: DslSpan,
  name: ReturnType<typeof parseName>,
  construction: string,
  constructionSpan: DslSpan | null,
  callSpan: DslSpan,
  opensBlock: boolean,
  diagnostics: DslCallDiagnostic[],
  requireArgumentCommas: boolean,
) => {
  const scanned = scanCallArgs(source, callSpan, { requireCommas: requireArgumentCommas });
  diagnostics.push(...scanned.errors);
  const payloadSpans: Record<string, DslSpan> = {};
  const spec = validateArgs(category, construction, keywordSpan, constructionSpan, scanned.args, diagnostics, payloadSpans);
  return {
    category,
    construction,
    elementType: spec?.elementType ?? null,
    ...name,
    keywordSpan,
    constructionSpan,
    args: scanned.args,
    attrs: attrsFromArgs(scanned.args),
    payloadSpans,
    opensBlock,
    shortVariable: false,
  } satisfies DslCallStatement;
};

export const parseDslCallStatement = (
  logicalText: string,
  options: ParseDslCallOptions = {},
): DslCallParseResult => {
  const diagnostics: DslCallDiagnostic[] = [];
  const categoryMatch = logicalText.match(identifier);
  if (!categoryMatch) {
    diagnostic(diagnostics, "文は category から始めてください。", { start: 0, end: 0 });
    return { statement: null, diagnostics };
  }
  const category = categoryMatch[0];
  const keywordSpan = { start: 0, end: category.length };
  const afterCategory = trimSpan(logicalText, category.length, logicalText.length);
  const isContainer = containerCategories.has(category);
  const equals = topLevelIndex(logicalText, "=", afterCategory.start);

  if (category === "var" && equals >= 0) {
    const name = parseName(logicalText, trimSpan(logicalText, afterCategory.start, equals));
    const right = trimSpan(logicalText, equals + 1, logicalText.length);
    if (!isCallConstruction(logicalText, right.start)) {
      if (!name.nameSpan) diagnostic(diagnostics, "var には名前が必要です。", keywordSpan);
      if (right.start === right.end) diagnostic(diagnostics, "var には「=」の後に式が必要です。", right);
      return {
        statement: {
          category,
          construction: "expression",
          elementType: constructionFor("var", "expression")?.elementType ?? null,
          ...name,
          keywordSpan,
          constructionSpan: null,
          args: [{ key: "value", keySpan: null, value: logicalText.slice(right.start, right.end), valueSpan: right }],
          attrs: [],
          payloadSpans: { value: right, expression: right },
          opensBlock: false,
          shortVariable: true,
        },
        diagnostics,
      };
    }
  }

  if (isContainer) {
    const brace = topLevelIndex(logicalText, "{", afterCategory.start);
    const headerEnd = brace >= 0 ? brace : logicalText.length;
    const afterBrace = brace >= 0 ? trimSpan(logicalText, brace + 1, logicalText.length) : null;
    const inlineBlock = brace >= 0 && afterBrace!.start === afterBrace!.end;
    if (brace >= 0 && !inlineBlock) diagnostic(diagnostics, "「{」の後に余分なトークンがあります。", afterBrace!);
    const openCandidate = topLevelIndex(logicalText, "(", afterCategory.start);
    const open = openCandidate >= 0 && openCandidate < headerEnd ? openCandidate : -1;
    const headerEquals = topLevelIndex(logicalText, "=", afterCategory.start);
    if (headerEquals >= 0 && (open < 0 || headerEquals < open)) {
      diagnostic(diagnostics, `${category} ヘッダでは「=」を使えません。`, { start: headerEquals, end: headerEquals + 1 });
    }
    const beforeCall = trimSpan(logicalText, afterCategory.start, open >= 0 ? open : headerEnd);
    const name = parseName(logicalText, beforeCall);
    const close = open >= 0 ? matchingClose(logicalText, open) : -1;
    const tail = close >= 0 ? trimSpan(logicalText, close + 1, headerEnd) : { start: headerEnd, end: headerEnd };
    if (close >= headerEnd && close >= 0) diagnostic(diagnostics, "呼び出しの「)」の後に余分なトークンがあります。", { start: headerEnd, end: close + 1 });
    if (tail.start < tail.end) diagnostic(diagnostics, "呼び出しの「)」の後に余分なトークンがあります。", tail);
    const opensBlock = Boolean(options.opensBlock || inlineBlock);
    if (!opensBlock) diagnostic(diagnostics, `${category} にはブロックが必要です。`, keywordSpan);
    if ((category === "if" || category === "for") && open < 0) diagnostic(diagnostics, `${category} には括弧内の引数が必要です。`, keywordSpan);
    if (open >= 0 && close < 0) diagnostic(diagnostics, "呼び出しの「(」が閉じられていません。", { start: open, end: open + 1 });
    const callSpan = { start: open >= 0 ? open + 1 : logicalText.length, end: close >= 0 ? close : logicalText.length };
    return { statement: callStatement(logicalText, category, keywordSpan, name, "", null, callSpan, opensBlock, diagnostics, Boolean(options.requireArgumentCommas)), diagnostics };
  }

  if (equals < 0) {
    diagnostic(diagnostics, "要素文には「=」が必要です。", keywordSpan);
    return { statement: null, diagnostics };
  }
  const name = parseName(logicalText, trimSpan(logicalText, afterCategory.start, equals));
  const constructionStart = trimSpan(logicalText, equals + 1, logicalText.length).start;
  const constructionMatch = logicalText.slice(constructionStart).match(identifier);
  if (!constructionMatch) {
    diagnostic(diagnostics, "「=」の後に construction が必要です。", { start: constructionStart, end: constructionStart });
    return { statement: null, diagnostics };
  }
  const construction = constructionMatch[0];
  const constructionSpan = { start: constructionStart, end: constructionStart + construction.length };
  let open = constructionSpan.end;
  while (whitespace.test(logicalText[open] ?? "")) open += 1;
  if (logicalText[open] !== "(") {
    diagnostic(diagnostics, "construction の後には「(」が必要です。", { start: open, end: open });
    return { statement: null, diagnostics };
  }
  const close = matchingClose(logicalText, open);
  if (close < 0) {
    diagnostic(diagnostics, "呼び出しの「(」が閉じられていません。", { start: open, end: open + 1 }, UNCLOSED_CALL_CODE);
    // Degraded statement, mirroring the container branch above: the call span
    // runs to end of text so already-typed argument spans (e.g. a `text:`
    // value mid-template-hole) are still resolvable for completion, even
    // though this line can never compile (severity is still "error").
    const statement = callStatement(
      logicalText, category, keywordSpan, name, construction, constructionSpan,
      { start: open + 1, end: logicalText.length }, false, diagnostics, Boolean(options.requireArgumentCommas)
    );
    return { statement, diagnostics };
  }
  const tail = trimSpan(logicalText, close + 1, logicalText.length);
  const inlineBlock = tail.start < tail.end && logicalText.slice(tail.start, tail.end) === "{";
  if (tail.start < tail.end && !inlineBlock) diagnostic(diagnostics, "呼び出しの「)」の後に余分なトークンがあります。", tail);
  if (inlineBlock || options.opensBlock) diagnostic(diagnostics, `category「${category}」の呼び出しはブロックを開けません。`, inlineBlock ? tail : keywordSpan);
  const statement = callStatement(logicalText, category, keywordSpan, name, construction, constructionSpan, { start: open + 1, end: close }, false, diagnostics, Boolean(options.requireArgumentCommas));
  if (category === "use") diagnostic(diagnostics, "use は予約済みですが、まだ実装されていません。", keywordSpan);
  return { statement, diagnostics };
};
