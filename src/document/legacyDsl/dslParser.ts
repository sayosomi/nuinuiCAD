// 凍結コピー。編集禁止。削除条件は docs/dsl2/tasks/f4-legacy-removal.md 参照。

import type { CadElementType } from "../../types/geometry";
import type {
  DslAttribute,
  DslDiagnostic,
  DslSpan,
  DslStatement,
  DslStatementBase,
  ParseDslResult
} from "./dslTypes";
import { splitDslComment, splitDslTerms, unquoteDslString, type DslTerm } from "./dslTokens";
import {
  createLogicalStatementSourceMap,
  physicalSpanForLogicalRange,
  physicalSpanForStatement,
  type LogicalStatement,
  type SourceSnapshot
} from "./logicalStatementSourceMap";

const elementTypes = new Set<CadElementType>([
  "group",
  "conditionalGroup",
  "forGroup",
  "variable",
  "freePoint",
  "offsetPoint",
  "polarOffsetPoint",
  "divisionPoint",
  "lineDivisionPoint",
  "intersectionPoint",
  "lineTangentOffsetPoint",
  "line",
  "angleLengthLine",
  "arcLine",
  "threePointArcLine",
  "cornerRadiusArcLine",
  "edge",
  "extendTrim",
  "bezierCurve",
  "offsetLine",
  "splitLine",
  "copyLine",
  "symmetricCopyLine",
  "move",
  "symmetricMove",
  "image",
  "text"
]);

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
  profile: "profile",
  activeView: "activeView",
  activeProfile: "activeProfile",
  activePrintLayout: "activePrintLayout",
  printLayout: "printLayout",
  color: "color",
  conditional: "if",
  point: "point",
  line: "line",
  curve: "curve",
  arc: "arc",
  text: "text",
  group: "group",
  genericElement: "element"
} as const;

export const dslStatementKeywordCompletions = Object.values(dslStatementKeywords);

const nameRequiredStatementKeywords = new Set<string>([
  dslStatementKeywords.role,
  dslStatementKeywords.view,
  dslStatementKeywords.profile,
  dslStatementKeywords.activeView,
  dslStatementKeywords.activeProfile,
  dslStatementKeywords.activePrintLayout,
  dslStatementKeywords.color,
  dslStatementKeywords.layoutVariable
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
  "layoutVar",
  "blockEnd",
  "blockElse"
]);

export const isElementDslStatement = (statement: DslStatement) =>
  !nonElementKinds.has(statement.kind);

const termSpan = (term: DslTerm): DslSpan => ({ start: term.start, end: term.end });

const isAttrTerm = (term: DslTerm) => {
  const first = term.text[0];
  if (first === "\"" || first === "'") return false;
  return term.text.indexOf("=") > 0;
};

const attrsFromTerms = (terms: DslTerm[]) =>
  terms.flatMap((term): DslAttribute[] => {
    const equalsIndex = term.text.indexOf("=");
    if (equalsIndex <= 0) return [];
    return [{
      key: term.text.slice(0, equalsIndex).trim(),
      value: unquoteDslString(term.text.slice(equalsIndex + 1)),
      keyStart: term.start,
      valueStart: term.start + equalsIndex + 1,
      valueEnd: term.end
    }];
  });

const attrValue = (attrs: DslAttribute[], key: string) =>
  attrs.find((attr) => attr.key === key)?.value;

const syntheticAttr = (key: string, value: string, span: DslSpan): DslAttribute => ({
  key,
  value,
  keyStart: span.start,
  valueStart: span.start,
  valueEnd: span.end
});

const termAttr = (key: string, term: DslTerm): DslAttribute =>
  syntheticAttr(key, term.text, termSpan(term));

const statementBase = (
  line: number,
  endLine: number,
  keyword: DslTerm,
  name: DslTerm | null,
  opensBlock: boolean
): DslStatementBase => ({
  line,
  endLine,
  name: name ? unquoteDslString(name.text) : "",
  nameSpan: name ? termSpan(name) : null,
  keywordSpan: termSpan(keyword),
  opensBlock,
  payloadSpans: {},
  enclosing: null,
  attrs: [],
  // parseLine is deliberately source-map agnostic. parseDslSnapshot decorates
  // this temporary shape before exposing it to callers.
  sourceRevision: 0,
  documentRange: { from: 0, to: 0, startLine: line, endLine, sourceRevision: 0 },
  physicalSpan: { segments: [], sourceRevision: 0 }
});

const elementStatement = (
  base: DslStatementBase,
  type: CadElementType,
  attrs: DslAttribute[]
): DslStatement => ({
  ...base,
  kind: "element",
  type,
  attrs: [syntheticAttr("type", type, base.keywordSpan), ...attrs]
});

// 式の打ち切り判定: `key=値` 形の属性トークン(`==` などの比較演算子は除外)。
const expressionAttrPattern = /^[A-Za-z_][A-Za-z0-9_]*=(?!=)/;

const diagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

export const parseCoordinate = (term: DslTerm) => {
  const match = term.text.match(/^\((.*),(.*)\)$/);
  if (!match) return null;
  const xRaw = match[1];
  const yRaw = match[2];
  const x = xRaw.trim();
  const y = yRaw.trim();
  const xStart = term.start + 1 + (xRaw.length - xRaw.trimStart().length);
  const yStart = term.start + 2 + xRaw.length + (yRaw.length - yRaw.trimStart().length);
  return {
    x,
    y,
    xSpan: { start: xStart, end: xStart + x.length },
    ySpan: { start: yStart, end: yStart + y.length }
  };
};

const expressionAfterEquals = (
  terms: DslTerm[],
  code: string
): { expression: string; span: DslSpan } | null => {
  const equalsIndex = terms.findIndex((term) => term.text === "=");
  const after = equalsIndex >= 0 ? terms.slice(equalsIndex + 1) : [];
  const attrStart = after.findIndex((term) => expressionAttrPattern.test(term.text));
  const expressionTerms = attrStart >= 0 ? after.slice(0, attrStart) : after;
  if (expressionTerms.length === 0) return null;
  const span = { start: expressionTerms[0].start, end: expressionTerms.at(-1)!.end };
  return { expression: code.slice(span.start, span.end), span };
};

type ParsedLine = { statement?: DslStatement; diagnostics: DslDiagnostic[] };

const parseLine = (rawLine: string, line: number, endLine = line): ParsedLine => {
  const code = splitDslComment(rawLine).code;
  const allTerms = splitDslTerms(code);
  if (allTerms.length === 0) return { diagnostics: [] };

  if (allTerms[0].text === "}") {
    if (allTerms.length === 1) {
      return { statement: { ...statementBase(line, endLine, allTerms[0], null, false), kind: "blockEnd" }, diagnostics: [] };
    }
    if (allTerms.length === 3 && allTerms[1].text === "else" && allTerms[2].text === "{") {
      return { statement: { ...statementBase(line, endLine, allTerms[0], null, true), kind: "blockElse" }, diagnostics: [] };
    }
    return { diagnostics: [diagnostic(line, "「}」の行は「}」単独か「} else {」の形で書いてください。")] };
  }
  if (allTerms[0].text === "{") {
    return { diagnostics: [diagnostic(line, "「{」はブロックを開く文の行末に書いてください。")] };
  }
  if (allTerms[0].text === "else") {
    return { diagnostics: [diagnostic(line, "「} else {」は1行で書いてください。")] };
  }

  let opensBlock = false;
  let body = allTerms;
  if (body.at(-1)?.text === "{") {
    opensBlock = true;
    body = body.slice(0, -1);
  }
  if (body.length === 0) {
    return { diagnostics: [diagnostic(line, "「{」はブロックを開く文の行末に書いてください。")] };
  }
  if (body.some((term) => term.text === "{" || term.text === "}")) {
    return { diagnostics: [diagnostic(line, "「{」「}」は行頭・行末以外に書けません。")] };
  }

  const keyword = body[0];

  if (keyword.text === dslStatementKeywords.atStop) {
    if (opensBlock || body.length > 1) {
      return { diagnostics: [diagnostic(line, "@stop は単独の行に書いてください。")] };
    }
    return { statement: { ...statementBase(line, endLine, keyword, null, false), kind: "atStop" }, diagnostics: [] };
  }

  if (keyword.text === dslStatementKeywords.version) {
    const rest = body.slice(1);
    const base = statementBase(line, endLine, keyword, null, opensBlock);
    if (rest.length > 0) {
      base.payloadSpans.value = { start: rest[0].start, end: rest.at(-1)!.end };
    }
    return {
      statement: { ...base, kind: "version", value: rest.map((term) => term.text).join(" ") },
      diagnostics: []
    };
  }

  if (keyword.text === dslStatementKeywords.for) {
    const positional: DslTerm[] = [];
    let restIndex = 1;
    while (restIndex < body.length && positional.length < 2) {
      const term = body[restIndex];
      if (term.text === "=" || isAttrTerm(term)) break;
      positional.push(term);
      restIndex += 1;
    }
    if (positional.length === 0) {
      return { diagnostics: [diagnostic(line, "for には変数名が必要です: for 名前 i start=0 count=5 step=1 {")] };
    }
    if (!opensBlock) {
      return { diagnostics: [diagnostic(line, "for にはブロックが必要です(行末に「{」)。")] };
    }
    const nameTerm = positional.length === 2 ? positional[0] : null;
    const variableTerm = positional.at(-1)!;
    const base = statementBase(line, endLine, keyword, nameTerm, opensBlock);
    base.payloadSpans.variableName = termSpan(variableTerm);
    return {
      statement: elementStatement(base, "forGroup", [
        syntheticAttr("variableName", unquoteDslString(variableTerm.text), termSpan(variableTerm)),
        ...attrsFromTerms(body.slice(restIndex))
      ]),
      diagnostics: []
    };
  }

  if (keyword.text === dslStatementKeywords.place) {
    const groupTerm = body[1];
    if (!groupTerm || groupTerm.text === "=" || isAttrTerm(groupTerm)) {
      return { diagnostics: [diagnostic(line, "place には配置するグループの参照が必要です。")] };
    }
    const base = statementBase(line, endLine, keyword, null, opensBlock);
    base.payloadSpans.group = termSpan(groupTerm);
    return {
      statement: { ...base, kind: "place", group: groupTerm.text, attrs: attrsFromTerms(body.slice(2)) },
      diagnostics: []
    };
  }

  const nameCandidate = body[1];
  const nameTerm =
    nameCandidate && nameCandidate.text !== "=" && !isAttrTerm(nameCandidate) ? nameCandidate : null;
  const rest = nameTerm ? body.slice(2) : body.slice(1);
  const base = statementBase(line, endLine, keyword, nameTerm, opensBlock);

  if (!nameTerm && nameRequiredStatementKeywords.has(keyword.text)) {
    return { diagnostics: [diagnostic(line, "文はキーワードと名前から始めてください。")] };
  }

  if (keyword.text === dslStatementKeywords.variable) {
    const parsed = expressionAfterEquals(rest, code);
    if (!parsed) {
      return { diagnostics: [diagnostic(line, "変数には `=` の後に式が必要です。")] };
    }
    base.payloadSpans.expression = parsed.span;
    return {
      statement: { ...base, kind: "variable", expression: parsed.expression, attrs: attrsFromTerms(rest) },
      diagnostics: []
    };
  }

  if (keyword.text === dslStatementKeywords.layoutVariable) {
    const equalsIndex = rest.findIndex((term) => term.text === "=");
    const after = equalsIndex >= 0 ? rest.slice(equalsIndex + 1) : [];
    if (after.length === 0) {
      return { diagnostics: [diagnostic(line, "layoutVar には `=` の後に式が必要です。")] };
    }
    const span = { start: after[0].start, end: after.at(-1)!.end };
    base.payloadSpans.expression = span;
    return {
      statement: { ...base, kind: "layoutVar", expression: code.slice(span.start, span.end), attrs: [] },
      diagnostics: []
    };
  }

  if (keyword.text === dslStatementKeywords.role) {
    return { statement: { ...base, kind: "role", attrs: attrsFromTerms(rest) }, diagnostics: [] };
  }

  if (keyword.text === dslStatementKeywords.view || keyword.text === dslStatementKeywords.profile) {
    return { statement: { ...base, kind: "view", attrs: attrsFromTerms(rest) }, diagnostics: [] };
  }

  if (keyword.text === dslStatementKeywords.activeView || keyword.text === dslStatementKeywords.activeProfile) {
    return { statement: { ...base, kind: "activeView", attrs: attrsFromTerms(rest) }, diagnostics: [] };
  }

  if (keyword.text === dslStatementKeywords.activePrintLayout) {
    return { statement: { ...base, kind: "activePrintLayout", attrs: attrsFromTerms(rest) }, diagnostics: [] };
  }

  if (keyword.text === dslStatementKeywords.printLayout) {
    return { statement: { ...base, kind: "printLayout", attrs: attrsFromTerms(rest) }, diagnostics: [] };
  }

  if (keyword.text === dslStatementKeywords.color) {
    let hexTerm: DslTerm | null = null;
    let unknownTerm: DslTerm | null = null;
    let isDefault = false;
    const attrTerms: DslTerm[] = [];
    for (const term of rest) {
      if (term.text === "default") {
        isDefault = true;
        continue;
      }
      if (isAttrTerm(term)) {
        attrTerms.push(term);
        continue;
      }
      if (!hexTerm) {
        hexTerm = term;
        continue;
      }
      unknownTerm = term;
    }
    const hex = hexTerm ? unquoteDslString(hexTerm.text) : "";
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
      return { diagnostics: [diagnostic(line, "色は `color <ID> \"#rrggbb\"` の形式で指定してください。")] };
    }
    if (unknownTerm) {
      return { diagnostics: [diagnostic(line, `color文に不明なトークンがあります: ${unknownTerm.text}`)] };
    }
    base.payloadSpans.hex = termSpan(hexTerm!);
    return {
      statement: { ...base, kind: "color", hex, isDefault, attrs: attrsFromTerms(attrTerms) },
      diagnostics: []
    };
  }

  if (keyword.text === dslStatementKeywords.conditional) {
    if (!opensBlock) {
      return { diagnostics: [diagnostic(line, "if にはブロックが必要です(行末に「{」)。")] };
    }
    const attrs = attrsFromTerms(rest);
    if (!attrValue(attrs, "condition")) {
      return { diagnostics: [diagnostic(line, "if には `condition=式` が必要です。")] };
    }
    return { statement: elementStatement(base, "conditionalGroup", attrs), diagnostics: [] };
  }

  if (keyword.text === dslStatementKeywords.point) {
    const equalsIndex = rest.findIndex((term) => term.text === "=");
    const right = equalsIndex >= 0 ? rest.slice(equalsIndex + 1) : rest;
    const attrs = attrsFromTerms(right);
    const coordinate = right[0] ? parseCoordinate(right[0]) : null;
    if (coordinate) {
      base.payloadSpans.x = coordinate.xSpan;
      base.payloadSpans.y = coordinate.ySpan;
      return {
        statement: { ...base, kind: "freePoint", x: coordinate.x, y: coordinate.y, attrs },
        diagnostics: []
      };
    }
    if (right[0]?.text === "offset" && right[1]) {
      base.payloadSpans.from = termSpan(right[1]);
      return { statement: { ...base, kind: "offsetPoint", from: right[1].text, attrs }, diagnostics: [] };
    }
    if (right[0]?.text === "polar" && right[1]) {
      base.payloadSpans.from = termSpan(right[1]);
      return { statement: { ...base, kind: "polarOffsetPoint", from: right[1].text, attrs }, diagnostics: [] };
    }
    if (right[0]?.text === "between" && right[1] && right[2]) {
      return {
        statement: elementStatement(base, "divisionPoint", [
          termAttr("startPoint", right[1]),
          termAttr("endPoint", right[2]),
          ...attrs
        ]),
        diagnostics: []
      };
    }
    if (right[0]?.text === "on" && right[1]) {
      return {
        statement: elementStatement(base, "lineDivisionPoint", [
          termAttr("endpoint", right[1]),
          ...attrs
        ]),
        diagnostics: []
      };
    }
    if (right[0]?.text === "intersection" && right[1] && right[2]) {
      return {
        statement: elementStatement(base, "intersectionPoint", [
          termAttr("line1Id", right[1]),
          termAttr("line2Id", right[2]),
          ...attrs
        ]),
        diagnostics: []
      };
    }
    if (right[0]?.text === "tangentOffset" && right[1]) {
      const baseAttr = attrs.find((attr) => attr.key === "base") ?? attrs.find((attr) => attr.key === "basePoint");
      return {
        statement: elementStatement(base, "lineTangentOffsetPoint", [
          termAttr("baseLineId", right[1]),
          ...(baseAttr ? [{ ...baseAttr, key: "basePoint" }] : []),
          ...attrs.filter((attr) => attr.key !== "base")
        ]),
        diagnostics: []
      };
    }
    return { diagnostics: [diagnostic(line, "点は `(x, y)`, `offset 基準点`, `polar 基準点` のいずれかで指定してください。")] };
  }

  if (keyword.text === dslStatementKeywords.line) {
    const attrs = attrsFromTerms(rest);
    const equalsIndex = rest.findIndex((term) => term.text === "=");
    const right = equalsIndex >= 0 ? rest.slice(equalsIndex + 1) : rest;
    const rightAttrs = attrsFromTerms(right);
    const arrowIndex = right.findIndex((term) => term.text === "->");
    if (arrowIndex >= 1 && right[arrowIndex + 1]) {
      base.payloadSpans.start = termSpan(right[arrowIndex - 1]);
      base.payloadSpans.end = termSpan(right[arrowIndex + 1]);
      return {
        statement: {
          ...base,
          kind: "line",
          start: right[arrowIndex - 1].text,
          end: right[arrowIndex + 1].text,
          attrs
        },
        diagnostics: []
      };
    }
    const fromIndex = right.findIndex((term) => term.text === "from");
    if (fromIndex >= 0 && right[fromIndex + 1]) {
      base.payloadSpans.start = termSpan(right[fromIndex + 1]);
      return {
        statement: { ...base, kind: "angleLengthLine", start: right[fromIndex + 1].text, attrs },
        diagnostics: []
      };
    }
    if (right[0]?.text === "split" && right[1]) {
      const atAttr = rightAttrs.find((attr) => attr.key === "at") ?? rightAttrs.find((attr) => attr.key === "point");
      const splitPoint = atAttr
        ? { ...atAttr, key: "splitPoint" }
        : right[2]
          ? termAttr("splitPoint", right[2])
          : null;
      if (!splitPoint) return { diagnostics: [diagnostic(line, "分割線には `at=点` が必要です。")] };
      return {
        statement: elementStatement(base, "splitLine", [
          termAttr("baseLineId", right[1]),
          splitPoint,
          ...rightAttrs.filter((attr) => attr.key !== "at" && attr.key !== "point")
        ]),
        diagnostics: []
      };
    }
    if (right[0]?.text === "extend" && right[1]) {
      const toAttr = rightAttrs.find((attr) => attr.key === "to") ?? rightAttrs.find((attr) => attr.key === "point");
      const point = toAttr
        ? { ...toAttr, key: "point" }
        : right[2]
          ? termAttr("point", right[2])
          : null;
      if (!point) return { diagnostics: [diagnostic(line, "延長短縮線には `to=点` が必要です。")] };
      return {
        statement: elementStatement(base, "extendTrim", [
          termAttr("endpoint", right[1]),
          point,
          ...rightAttrs.filter((attr) => attr.key !== "to" && attr.key !== "point")
        ]),
        diagnostics: []
      };
    }
    if (right[0]?.text === "offset" && right[1]) {
      const distanceAttr =
        rightAttrs.find((attr) => attr.key === "distance") ?? rightAttrs.find((attr) => attr.key === "offset");
      return {
        statement: elementStatement(base, "offsetLine", [
          termAttr("baseLineIds", right[1]),
          distanceAttr
            ? { ...distanceAttr, key: "offset" }
            : syntheticAttr("offset", "0", termSpan(right[1])),
          ...rightAttrs.filter((attr) => attr.key !== "distance" && attr.key !== "offset")
        ]),
        diagnostics: []
      };
    }
    return { diagnostics: [diagnostic(line, "線は `line L = A -> B` または `line L = from A angle=... length=...` で指定してください。")] };
  }

  if (keyword.text === dslStatementKeywords.curve) {
    const attrs = attrsFromTerms(rest);
    const equalsIndex = rest.findIndex((term) => term.text === "=");
    const right = equalsIndex >= 0 ? rest.slice(equalsIndex + 1) : rest;
    const arrowIndex = right.findIndex((term) => term.text === "->");
    if (arrowIndex >= 1 && right[arrowIndex + 1]) {
      return {
        statement: elementStatement(base, "bezierCurve", [
          termAttr("startPoint", right[arrowIndex - 1]),
          termAttr("endPoint", right[arrowIndex + 1]),
          ...attrs
        ]),
        diagnostics: []
      };
    }
    return { diagnostics: [diagnostic(line, "曲線は `curve C = A -> B ...` で指定してください。")] };
  }

  if (keyword.text === dslStatementKeywords.arc) {
    const attrs = attrsFromTerms(rest);
    const equalsIndex = rest.findIndex((term) => term.text === "=");
    const right = equalsIndex >= 0 ? rest.slice(equalsIndex + 1) : rest;
    const rightAttrs = attrsFromTerms(right);
    if (right[0]?.text === "through" && right[1] && right[2] && right[3]) {
      return {
        statement: elementStatement(base, "threePointArcLine", [
          termAttr("point1", right[1]),
          termAttr("point2", right[2]),
          termAttr("point3", right[3]),
          ...rightAttrs
        ]),
        diagnostics: []
      };
    }
    if (right[0]?.text === "corner" && right[1] && right[2]) {
      return {
        statement: elementStatement(base, "cornerRadiusArcLine", [
          termAttr("endpoint1", right[1]),
          termAttr("endpoint2", right[2]),
          ...rightAttrs
        ]),
        diagnostics: []
      };
    }
    const centerAttr = attrs.find((attr) => attr.key === "center");
    if (!centerAttr) return { diagnostics: [diagnostic(line, "円弧には `center=点` が必要です。")] };
    base.payloadSpans.center = { start: centerAttr.valueStart, end: centerAttr.valueEnd };
    return { statement: { ...base, kind: "arcLine", center: centerAttr.value, attrs }, diagnostics: [] };
  }

  if (keyword.text === dslStatementKeywords.text) {
    const equalsIndex = rest.findIndex((term) => term.text === "=");
    const literal = equalsIndex >= 0 ? rest[equalsIndex + 1] : undefined;
    if (!literal || (literal.text[0] !== "\"" && literal.text[0] !== "'")) {
      return { diagnostics: [diagnostic(line, "テキストは `text label = \"文字\" at 点` で指定してください。")] };
    }
    base.payloadSpans.text = termSpan(literal);
    return {
      statement: {
        ...base,
        kind: "text",
        text: unquoteDslString(literal.text),
        attrs: attrsFromTerms(rest.slice(equalsIndex + 2))
      },
      diagnostics: []
    };
  }

  if (keyword.text === dslStatementKeywords.group) {
    return { statement: { ...base, kind: "group", attrs: attrsFromTerms(rest) }, diagnostics: [] };
  }

  if (keyword.text === dslStatementKeywords.genericElement) {
    const attrs = attrsFromTerms(rest);
    const type = attrValue(attrs, "type");
    const valid = Boolean(type && elementTypes.has(type as CadElementType));
    return {
      statement: {
        ...base,
        kind: "element",
        type: valid ? type as CadElementType : null,
        attrs
      },
      diagnostics: valid ? [] : [diagnostic(line, "element文には有効な `type=` が必要です。")]
    };
  }

  return { diagnostics: [diagnostic(line, `未対応のDSLキーワードです: ${keyword.text}`)] };
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
    if (statement.type === "group") return "group";
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
  const logical = sourceMap.statements.find((statement) => statement.range.startLine === item.line);
  return { ...item, sourceRevision: sourceMap.sourceRevision, ...(logical ? { physicalSpan: physicalSpanForStatement(logical) } : {}) };
};

export const parseDslSnapshot = (snapshot: SourceSnapshot): ParseDslResult => {
  const statements: DslStatement[] = [];
  const diagnostics: DslDiagnostic[] = [];
  const sourceMap = createLogicalStatementSourceMap(snapshot);
  for (const line of sourceMap.invalidContinuationLines) {
    diagnostics.push(diagnostic(line, "継続印「\\」の次には空でない通常の文の行が必要です。"));
  }
  for (let index = 0; index < sourceMap.statements.length; index += 1) {
    const logical = sourceMap.statements[index];
    // A multi-line block header is followed by its own structural opening line.
    // Legacy inline `{` remains readable while documents transition to this form.
    const next = sourceMap.statements[index + 1];
    const opensOnNextLine = logical.structural === null && next?.structural === "open";
    if (logical.structural === "open") continue;
    const parsed = parseLine(
      opensOnNextLine ? `${logical.logicalText} {` : logical.logicalText,
      logical.range.startLine,
      logical.range.endLine
    );
    if (parsed.statement) {
      const statement = decorateStatement(parsed.statement, logical, sourceMap);
      if (opensOnNextLine) statement.openBraceLine = next.range.startLine;
      statements.push(statement);
    }
    diagnostics.push(...parsed.diagnostics);
  }
  applyBlockStructure(statements, diagnostics);
  reportDuplicateNames(statements, diagnostics);
  for (const extra of statements.filter((statement) => statement.kind === "atStop").slice(1)) {
    diagnostics.push(diagnostic(extra.line, "@stop は文書に1つだけ書けます。"));
  }
  return { statements, diagnostics: diagnostics.map((item) => decorateDiagnostic(item, sourceMap)), sourceRevision: snapshot.sourceRevision, sourceMap };
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
