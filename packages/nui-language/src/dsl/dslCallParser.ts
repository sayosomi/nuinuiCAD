import type { CadElementType } from "../types/geometry";
import { elementTypeSupportsHiddenActivity } from "../model/elementActivity";
import {
  bareConstructionFor,
  categoriesForConstruction,
  commonArgSpecs,
  constructionCandidatesFor,
  constructionFor,
  MUTATION_CATEGORY,
  type DslArgSpec,
} from "./dslConstructions";
import { scanCallArgs, type ScannedArg } from "./dslArgScanner";
import type { DslAttribute, DslDiagnosticPresentation, DslSpan } from "./dslTypes";
import { unquoteDslString } from "./dslTokens";

export type DslCallDiagnostic = { message: string; span: DslSpan; code?: string; presentation?: DslDiagnosticPresentation };

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
  modifierNames: string[];
  modifierNameSpans: DslSpan[];
  opensBlock: boolean;
};

export type DslCallParseResult = {
  statement: DslCallStatement | null;
  diagnostics: DslCallDiagnostic[];
};

export type ParseDslCallOptions = { opensBlock?: boolean };

export const CONSTRUCTION_CATEGORY_MISMATCH_CODE = "construction-category-mismatch";

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

const diagnostic = (
  diagnostics: DslCallDiagnostic[],
  message: string,
  span: DslSpan,
  code?: string,
  presentation?: DslDiagnosticPresentation
) =>
  diagnostics.push(code
    ? { message, span, code, presentation: presentation ?? { key: `diagnostic.${code}` } }
    : { message, span });

/** A call whose `(` never finds its matching `)` (mid-edit, e.g. an unterminated
 * string swallowing the rest of the line). The statement returned alongside this
 * code is a best-effort/degraded one - its call span runs to end of text - kept
 * only so single-line probe parses (dslLineElementStatement) can still resolve
 * already-typed argument spans for completion. Full-document compilation is
 * unaffected: every compile gate rejects on `severity: "error"` regardless of
 * this code, the same as any other diagnostic here. */
export const UNCLOSED_CALL_CODE = "unclosed-call";

const parseName = (source: string, span: DslSpan) => {
  if (span.start === span.end) return { name: "", nameSpan: null };
  return { name: unquoteDslString(source.slice(span.start, span.end)), nameSpan: span };
};

const matchingSquareClose = (source: string, open: number) => {
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
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]" && --depth === 0) {
      return index;
    }
  }
  return -1;
};

type ParsedNameWithModifiers = ReturnType<typeof parseName> & {
  modifierNames: string[];
  modifierNameSpans: DslSpan[];
};

const parseNameWithModifiers = (
  source: string,
  span: DslSpan,
  diagnostics: DslCallDiagnostic[]
): ParsedNameWithModifiers => {
  const listOpen = topLevelIndex(source, "[", span.start);
  if (listOpen < 0 || listOpen >= span.end) {
    return { ...parseName(source, span), modifierNames: [], modifierNameSpans: [] };
  }

  const nameSpan = trimSpan(source, span.start, listOpen);
  if (nameSpan.start === nameSpan.end) {
    diagnostic(diagnostics, "modifier参照は名前付きのgeometry / groupにのみ指定できます。", { start: listOpen, end: listOpen + 1 });
  }
  const close = matchingSquareClose(source, listOpen);
  if (close < 0 || close > span.end) {
    diagnostic(diagnostics, "modifier参照リストの「[」が閉じられていません。", { start: listOpen, end: listOpen + 1 });
    return { ...parseName(source, nameSpan), modifierNames: [], modifierNameSpans: [] };
  }
  const tail = trimSpan(source, close + 1, span.end);
  if (tail.start < tail.end) {
    diagnostic(diagnostics, "modifier参照リストの後に余分なトークンがあります。", tail);
  }

  const scanned = scanCallArgs(source, { start: listOpen + 1, end: close });
  diagnostics.push(...scanned.errors);
  const modifierNames: string[] = [];
  const modifierNameSpans: DslSpan[] = [];
  for (const arg of scanned.args) {
    if (arg.key !== null) {
      diagnostic(diagnostics, "modifier参照リストには名前だけを書いてください。", arg.keySpan ?? arg.valueSpan);
      continue;
    }
    const raw = source.slice(arg.valueSpan.start, arg.valueSpan.end);
    const name = unquoteDslString(arg.value).trim();
    if (!name || name.startsWith("@")) {
      diagnostic(diagnostics, "modifier参照名が空、または不正です。", arg.valueSpan);
      continue;
    }
    if (!raw.startsWith("\"") && /\s/.test(raw)) {
      diagnostic(diagnostics, "modifier参照名に空白を含める場合は引用符で囲んでください。", arg.valueSpan);
      continue;
    }
    modifierNames.push(name);
    modifierNameSpans.push(arg.valueSpan);
  }
  return { ...parseName(source, nameSpan), modifierNames, modifierNameSpans };
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
    const bare = bareConstructionFor(construction);
    if (bare) {
      diagnostic(
        diagnostics,
        `「${construction}」は名前なしの単独文になりました。「${category} ${construction} = ...」ではなく「${construction}(…)」と書いてください。`,
        constructionSpan ?? categorySpan
      );
      return null;
    }
    const categories = categoriesForConstruction(construction);
    const candidates = categoryCandidates.map((candidate) => candidate.construction).filter(Boolean).join("、") || "なし";
    const message = categories.length > 0
      ? `category「${category}」と construction「${construction}」の組み合わせは不一致です。使用できる category: ${categories.join("、")}。${category} の候補: ${candidates}。`
      : `category「${category}」に construction「${construction}」はありません。候補: ${candidates}。`;
      diagnostic(
        diagnostics,
        message,
        constructionSpan ?? categorySpan,
        constructionSpan
          ? categories.length > 0
            ? CONSTRUCTION_CATEGORY_MISMATCH_CODE
            : "unknown-construction"
          : undefined,
        constructionSpan
          ? {
              key: `diagnostic.${categories.length > 0 ? CONSTRUCTION_CATEGORY_MISMATCH_CODE : "unknown-construction"}`,
              parameters: {
                category,
                construction,
                ...(categories.length > 0 ? { categories: categories.join(", ") } : {}),
                candidates
              }
            }
          : undefined
      );
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
      diagnostic(
        diagnostics,
        `construction「${construction}」に引数「${arg.key}」はありません。候補: ${[...allowed.keys()].join("、")}。`,
        arg.keySpan!,
        "unknown-construction-argument",
        {
          key: "diagnostic.unknown-construction-argument",
          parameters: {
            construction,
            argument: arg.key,
            candidates: [...allowed.keys()].join(", ")
          }
        }
      );
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
    if (arg.key === "state" && !elementTypeSupportsHiddenActivity(spec.elementType) && unquoteDslString(arg.value) === "hidden") {
      diagnostic(
        diagnostics,
        `${construction} は自身の図形を持たないため state: hidden を指定できません。visible か disabled を使ってください。`,
        arg.valueSpan,
        "state-hidden-unsupported",
        { key: "diagnostic.state-hidden-unsupported", parameters: { construction } }
      );
      continue;
    }
    if (arg.key === "color" && category === MUTATION_CATEGORY) {
      diagnostic(
        diagnostics,
        `${construction} は自身の図形を持たないため color を指定できません。`,
        arg.valueSpan,
        "color-unsupported",
        { key: "diagnostic.color-unsupported", parameters: { construction } }
      );
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
  return spec;
};

const callStatement = (
  source: string,
  category: string,
  keywordSpan: DslSpan,
  name: ParsedNameWithModifiers,
  construction: string,
  constructionSpan: DslSpan | null,
  callSpan: DslSpan,
  opensBlock: boolean,
  diagnostics: DslCallDiagnostic[],
) => {
  const scanned = scanCallArgs(source, callSpan);
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
    modifierNames: name.modifierNames,
    modifierNameSpans: name.modifierNameSpans,
    opensBlock,
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

  if (isContainer) {
    // nui1's for header is deliberately normalized into the existing `for`
    // construction representation: the iterator remains the construction's
    // positional `variable` argument, while range(...) contributes the same
    // named from/count/step arguments used by the existing forGroup runtime.
    // This is a syntax lowering only; it does not introduce another loop AST
    // || runtime.
    if (category === "for") {
      const forHeader = logicalText.slice(afterCategory.start).match(/^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+range\s*\(/);
      if (forHeader) {
        const variableStart = afterCategory.start + forHeader[0].indexOf(forHeader[1]);
        const rangeOpen = afterCategory.start + forHeader[0].lastIndexOf("(");
        const brace = topLevelIndex(logicalText, "{", rangeOpen);
        const headerEnd = brace >= 0 ? brace : logicalText.length;
        const afterBrace = brace >= 0 ? trimSpan(logicalText, brace + 1, logicalText.length) : null;
        const inlineBlock = brace >= 0 && afterBrace!.start === afterBrace!.end;
        if (brace >= 0 && !inlineBlock) diagnostic(diagnostics, "「{」の後に余分なトークンがあります。", afterBrace!);
        const close = matchingClose(logicalText, rangeOpen);
        if (close < 0) diagnostic(diagnostics, "range 呼び出しの「(」が閉じられていません。", { start: rangeOpen, end: rangeOpen + 1 });
        const tail = close >= 0 ? trimSpan(logicalText, close + 1, headerEnd) : { start: headerEnd, end: headerEnd };
        if (tail.start < tail.end) diagnostic(diagnostics, "range 呼び出しの「)」の後に余分なトークンがあります。", tail);
        const opensBlock = Boolean(options.opensBlock || inlineBlock);
        if (!opensBlock) diagnostic(diagnostics, "for にはブロックが必要です。", keywordSpan);
        const scanned = scanCallArgs(
          logicalText,
          { start: rangeOpen + 1, end: close >= 0 ? close : logicalText.length }
        );
        diagnostics.push(...scanned.errors);
        const variableSpan = { start: variableStart, end: variableStart + forHeader[1].length };
        scanned.args.unshift({
          key: null,
          keySpan: null,
          value: forHeader[1],
          valueSpan: variableSpan
        });
        const payloadSpans: Record<string, DslSpan> = {};
        const spec = validateArgs("for", "", keywordSpan, null, scanned.args, diagnostics, payloadSpans);
        const statement = {
          category: "for",
          construction: "",
          elementType: spec?.elementType ?? null,
          name: "",
          nameSpan: null,
          keywordSpan,
          constructionSpan: null,
          args: scanned.args,
          attrs: attrsFromArgs(scanned.args),
          payloadSpans,
          modifierNames: [],
          modifierNameSpans: [],
          opensBlock
        } satisfies DslCallStatement;
        return { statement, diagnostics };
      }
    }
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
    if (category === "if" && beforeCall.start < beforeCall.end) {
      diagnostic(diagnostics, "if は `if (@condition) { ... }` の形式で書いてください。", beforeCall);
    }
    if (category === "for") {
      diagnostic(diagnostics, "for は `for i in range(...) { ... }` の形式で書いてください。", beforeCall.start < beforeCall.end ? beforeCall : keywordSpan);
    }
    const name = category === "if"
      ? { ...parseName(logicalText, beforeCall), modifierNames: [], modifierNameSpans: [] }
      : parseNameWithModifiers(logicalText, beforeCall, diagnostics);
    const close = open >= 0 ? matchingClose(logicalText, open) : -1;
    const tail = close >= 0 ? trimSpan(logicalText, close + 1, headerEnd) : { start: headerEnd, end: headerEnd };
    if (close >= headerEnd && close >= 0) diagnostic(diagnostics, "呼び出しの「)」の後に余分なトークンがあります。", { start: headerEnd, end: close + 1 });
    if (tail.start < tail.end) diagnostic(diagnostics, "呼び出しの「)」の後に余分なトークンがあります。", tail);
    const opensBlock = Boolean(options.opensBlock || inlineBlock);
    if (!opensBlock) diagnostic(diagnostics, `${category} にはブロックが必要です。`, keywordSpan);
    if ((category === "if" || category === "for") && open < 0) diagnostic(diagnostics, `${category} には括弧内の引数が必要です。`, keywordSpan);
    if (open >= 0 && close < 0) diagnostic(diagnostics, "呼び出しの「(」が閉じられていません。", { start: open, end: open + 1 });
    const callSpan = { start: open >= 0 ? open + 1 : logicalText.length, end: close >= 0 ? close : logicalText.length };
    return { statement: callStatement(logicalText, category, keywordSpan, name, "", null, callSpan, opensBlock, diagnostics), diagnostics };
  }

  // A mutation statement (edge/extend/move/mirrorMove/reverse) rewrites an
  // already-declared element's geometry in place instead of declaring its
  // own, so it has no `<category> <name> =` head: the construction keyword
  // itself leads the statement && doubles as its own construction token.
  const bareSpec = bareConstructionFor(category);
  if (bareSpec) {
    const bareName = { name: "", nameSpan: null, modifierNames: [], modifierNameSpans: [] };
    let open = keywordSpan.end;
    while (whitespace.test(logicalText[open] ?? "")) open += 1;
    if (logicalText[open] !== "(") {
      diagnostic(diagnostics, `${category} は「${category}(引数…)」の形式で書いてください。`, { start: open, end: open });
      return { statement: null, diagnostics };
    }
    const close = matchingClose(logicalText, open);
    if (close < 0) {
      diagnostic(diagnostics, "呼び出しの「(」が閉じられていません。", { start: open, end: open + 1 }, UNCLOSED_CALL_CODE);
      const statement = callStatement(
        logicalText, MUTATION_CATEGORY, keywordSpan, bareName, category, keywordSpan,
        { start: open + 1, end: logicalText.length }, false, diagnostics
      );
      return { statement, diagnostics };
    }
    const tail = trimSpan(logicalText, close + 1, logicalText.length);
    if (tail.start < tail.end) diagnostic(diagnostics, "呼び出しの「)」の後に余分なトークンがあります。", tail);
    if (options.opensBlock) diagnostic(diagnostics, `${category} の呼び出しはブロックを開けません。`, keywordSpan);
    const statement = callStatement(
      logicalText, MUTATION_CATEGORY, keywordSpan, bareName, category, keywordSpan,
      { start: open + 1, end: close }, false, diagnostics
    );
    return { statement, diagnostics };
  }

  if (equals < 0) {
    diagnostic(diagnostics, "要素文には「=」が必要です。", keywordSpan);
    return { statement: null, diagnostics };
  }
  const name = parseNameWithModifiers(
    logicalText,
    trimSpan(logicalText, afterCategory.start, equals),
    diagnostics
  );
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
      { start: open + 1, end: logicalText.length }, false, diagnostics
    );
    return { statement, diagnostics };
  }
  const tail = trimSpan(logicalText, close + 1, logicalText.length);
  const inlineBlock = tail.start < tail.end && logicalText.slice(tail.start, tail.end) === "{";
  if (tail.start < tail.end && !inlineBlock) diagnostic(diagnostics, "呼び出しの「)」の後に余分なトークンがあります。", tail);
  if (inlineBlock || options.opensBlock) diagnostic(diagnostics, `category「${category}」の呼び出しはブロックを開けません。`, inlineBlock ? tail : keywordSpan);
  const statement = callStatement(logicalText, category, keywordSpan, name, construction, constructionSpan, { start: open + 1, end: close }, false, diagnostics);
  if (category === "use") diagnostic(diagnostics, "use は予約済みですが、まだ実装されていません。", keywordSpan);
  return { statement, diagnostics };
};
