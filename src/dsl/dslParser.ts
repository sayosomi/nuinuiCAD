import type { CadElementType } from "../types/geometry";
import type { DslAttribute, DslDiagnostic, DslStatement, ParseDslResult } from "./dslTypes";

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

const stripComment = (line: string) => {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && !quote) return line.slice(0, index);
  }
  return line;
};

const unquote = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"").replace(/\\'/g, "'");
  }
  return trimmed;
};

const splitTerms = (line: string) => {
  const terms: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      current += char;
      continue;
    }
    if (!quote && (char === "(" || char === "[" || char === "{")) depth += 1;
    if (!quote && (char === ")" || char === "]" || char === "}")) depth -= 1;
    if (!quote && depth === 0 && /\s/.test(char)) {
      if (current.trim()) terms.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) terms.push(current.trim());
  return terms;
};

const attrsFromTerms = (terms: string[]) =>
  terms.flatMap((term): DslAttribute[] => {
    const equalsIndex = term.indexOf("=");
    if (equalsIndex <= 0) return [];
    return [{
      key: term.slice(0, equalsIndex).trim(),
      value: unquote(term.slice(equalsIndex + 1))
    }];
  });

const attrValue = (attrs: DslAttribute[], key: string) =>
  attrs.find((attr) => attr.key === key)?.value;

const attrItem = (key: string, value: string): DslAttribute => ({ key, value });

const elementStatement = (
  line: number,
  name: string,
  type: CadElementType,
  attrs: DslAttribute[]
): DslStatement => ({
  kind: "element",
  line,
  name,
  type,
  attrs: [attrItem("type", type), ...attrs]
});

const commonAttrPattern = /^(id|name|visible|enabled|color|parent|branch|roles)=/;

const expressionAndAttrs = (source: string) => {
  const terms = splitTerms(source);
  const attrStart = terms.findIndex((term) => commonAttrPattern.test(term));
  if (attrStart < 0) return { expression: source.trim(), attrs: [] };
  return {
    expression: terms.slice(0, attrStart).join(" ").trim(),
    attrs: attrsFromTerms(terms.slice(attrStart))
  };
};

const diagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

const expressionAfterEquals = (raw: string) => {
  const equalsIndex = raw.indexOf("=");
  return equalsIndex < 0 ? "" : raw.slice(equalsIndex + 1).trim();
};

const parseCoordinate = (value: string) => {
  const match = value.trim().match(/^\((.*),(.*)\)$/);
  return match ? { x: match[1].trim(), y: match[2].trim() } : null;
};

const parseLine = (rawLine: string, line: number): { statement?: DslStatement; diagnostics: DslDiagnostic[] } => {
  const raw = stripComment(rawLine).trim();
  if (!raw) return { diagnostics: [] };
  const terms = splitTerms(raw);
  const [keyword, name] = terms;
  if (!keyword || !name) return { diagnostics: [diagnostic(line, "文はキーワードと名前から始めてください。")] };

  if (keyword === "var") {
    const parsedExpression = expressionAndAttrs(expressionAfterEquals(raw));
    const expression = parsedExpression.expression;
    if (!expression) return { diagnostics: [diagnostic(line, "変数には `=` の後に式が必要です。")] };
    return { statement: { kind: "variable", line, name, expression, attrs: [...attrsFromTerms(terms.slice(2)), ...parsedExpression.attrs] }, diagnostics: [] };
  }

  if (keyword === "role") {
    return { statement: { kind: "role", line, name, attrs: attrsFromTerms(terms.slice(2)) }, diagnostics: [] };
  }

  if (keyword === "view" || keyword === "profile") {
    return { statement: { kind: "view", line, name, attrs: attrsFromTerms(terms.slice(2)) }, diagnostics: [] };
  }

  if (keyword === "activeView" || keyword === "activeProfile") {
    return { statement: { kind: "activeView", line, name, attrs: attrsFromTerms(terms.slice(2)) }, diagnostics: [] };
  }

  if (keyword === "printLayout") {
    return { statement: { kind: "printLayout", line, name, attrs: attrsFromTerms(terms.slice(2)) }, diagnostics: [] };
  }

  if (keyword === "point") {
    const equalsIndex = terms.indexOf("=");
    const right = equalsIndex >= 0 ? terms.slice(equalsIndex + 1) : terms.slice(2);
    const attrs = attrsFromTerms(right);
    const coordinate = right[0] ? parseCoordinate(right[0]) : null;
    if (coordinate) {
      return { statement: { kind: "freePoint", line, name, x: coordinate.x, y: coordinate.y, attrs }, diagnostics: [] };
    }
    if (right[0] === "offset" && right[1]) {
      return { statement: { kind: "offsetPoint", line, name, from: right[1], attrs }, diagnostics: [] };
    }
    if (right[0] === "polar" && right[1]) {
      return { statement: { kind: "polarOffsetPoint", line, name, from: right[1], attrs }, diagnostics: [] };
    }
    if (right[0] === "between" && right[1] && right[2]) {
      return {
        statement: elementStatement(line, name, "divisionPoint", [
          attrItem("startPoint", right[1]),
          attrItem("endPoint", right[2]),
          ...attrs
        ]),
        diagnostics: []
      };
    }
    if (right[0] === "on" && right[1]) {
      return {
        statement: elementStatement(line, name, "lineDivisionPoint", [
          attrItem("endpoint", right[1]),
          ...attrs
        ]),
        diagnostics: []
      };
    }
    if (right[0] === "intersection" && right[1] && right[2]) {
      return {
        statement: elementStatement(line, name, "intersectionPoint", [
          attrItem("line1Id", right[1]),
          attrItem("line2Id", right[2]),
          ...attrs
        ]),
        diagnostics: []
      };
    }
    if (right[0] === "tangentOffset" && right[1]) {
      const base = attrValue(attrs, "base") ?? attrValue(attrs, "basePoint");
      return {
        statement: elementStatement(line, name, "lineTangentOffsetPoint", [
          attrItem("baseLineId", right[1]),
          ...(base ? [attrItem("basePoint", base)] : []),
          ...attrs.filter((attr) => attr.key !== "base")
        ]),
        diagnostics: []
      };
    }
    return { diagnostics: [diagnostic(line, "点は `(x, y)`, `offset 基準点`, `polar 基準点` のいずれかで指定してください。")] };
  }

  if (keyword === "line") {
    const arrowIndex = terms.indexOf("->");
    const attrs = attrsFromTerms(terms.slice(2));
    const equalsIndex = terms.indexOf("=");
    const right = equalsIndex >= 0 ? terms.slice(equalsIndex + 1) : terms.slice(2);
    const rightAttrs = attrsFromTerms(right);
    if (arrowIndex > 2 && terms[arrowIndex + 1]) {
      return {
        statement: { kind: "line", line, name, start: terms[arrowIndex - 1], end: terms[arrowIndex + 1], attrs },
        diagnostics: []
      };
    }
    const fromIndex = terms.indexOf("from");
    if (fromIndex >= 0 && terms[fromIndex + 1]) {
      return {
        statement: { kind: "angleLengthLine", line, name, start: terms[fromIndex + 1], attrs },
        diagnostics: []
      };
    }
    if (right[0] === "split" && right[1]) {
      const at = attrValue(rightAttrs, "at") ?? attrValue(rightAttrs, "point") ?? right[2];
      if (!at) return { diagnostics: [diagnostic(line, "分割線には `at=点` が必要です。")] };
      return {
        statement: elementStatement(line, name, "splitLine", [
          attrItem("baseLineId", right[1]),
          attrItem("splitPoint", at),
          ...rightAttrs.filter((attr) => attr.key !== "at" && attr.key !== "point")
        ]),
        diagnostics: []
      };
    }
    if (right[0] === "extend" && right[1]) {
      const point = attrValue(rightAttrs, "to") ?? attrValue(rightAttrs, "point") ?? right[2];
      if (!point) return { diagnostics: [diagnostic(line, "延長短縮線には `to=点` が必要です。")] };
      return {
        statement: elementStatement(line, name, "extendTrim", [
          attrItem("endpoint", right[1]),
          attrItem("point", point),
          ...rightAttrs.filter((attr) => attr.key !== "to" && attr.key !== "point")
        ]),
        diagnostics: []
      };
    }
    if (right[0] === "offset" && right[1]) {
      const distance = attrValue(rightAttrs, "distance") ?? attrValue(rightAttrs, "offset") ?? "0";
      return {
        statement: elementStatement(line, name, "offsetLine", [
          attrItem("baseLineIds", right[1]),
          attrItem("offset", distance),
          ...rightAttrs.filter((attr) => attr.key !== "distance" && attr.key !== "offset")
        ]),
        diagnostics: []
      };
    }
    return { diagnostics: [diagnostic(line, "線は `line L = A -> B` または `line L = from A angle=... length=...` で指定してください。")] };
  }

  if (keyword === "curve") {
    const arrowIndex = terms.indexOf("->");
    const attrs = attrsFromTerms(terms.slice(2));
    if (arrowIndex > 2 && terms[arrowIndex + 1]) {
      return {
        statement: elementStatement(line, name, "bezierCurve", [
          attrItem("startPoint", terms[arrowIndex - 1]),
          attrItem("endPoint", terms[arrowIndex + 1]),
          ...attrs
        ]),
        diagnostics: []
      };
    }
    return { diagnostics: [diagnostic(line, "曲線は `curve C = A -> B ...` で指定してください。")] };
  }

  if (keyword === "arc") {
    const attrs = attrsFromTerms(terms.slice(2));
    const equalsIndex = terms.indexOf("=");
    const right = equalsIndex >= 0 ? terms.slice(equalsIndex + 1) : terms.slice(2);
    const rightAttrs = attrsFromTerms(right);
    if (right[0] === "through" && right[1] && right[2] && right[3]) {
      return {
        statement: elementStatement(line, name, "threePointArcLine", [
          attrItem("point1", right[1]),
          attrItem("point2", right[2]),
          attrItem("point3", right[3]),
          ...rightAttrs
        ]),
        diagnostics: []
      };
    }
    if (right[0] === "corner" && right[1] && right[2]) {
      return {
        statement: elementStatement(line, name, "cornerRadiusArcLine", [
          attrItem("endpoint1", right[1]),
          attrItem("endpoint2", right[2]),
          ...rightAttrs
        ]),
        diagnostics: []
      };
    }
    const center = attrValue(attrs, "center");
    if (!center) return { diagnostics: [diagnostic(line, "円弧には `center=点` が必要です。")] };
    return { statement: { kind: "arcLine", line, name, center, attrs }, diagnostics: [] };
  }

  if (keyword === "text") {
    const equalsIndex = raw.indexOf("=");
    const afterEquals = equalsIndex >= 0 ? raw.slice(equalsIndex + 1).trim() : "";
    const textMatch = afterEquals.match(/^("[^"]*"|'[^']*')/);
    if (!textMatch) return { diagnostics: [diagnostic(line, "テキストは `text label = \"文字\" at 点` で指定してください。")] };
    const rest = splitTerms(afterEquals.slice(textMatch[0].length).trim());
    return {
      statement: { kind: "text", line, name, text: unquote(textMatch[0]), attrs: attrsFromTerms(rest) },
      diagnostics: []
    };
  }

  if (keyword === "group") {
    return { statement: { kind: "group", line, name, attrs: attrsFromTerms(terms.slice(2)) }, diagnostics: [] };
  }

  if (keyword === "element") {
    const attrs = attrsFromTerms(terms.slice(2));
    const type = attrValue(attrs, "type");
    return {
      statement: {
        kind: "element",
        line,
        name,
        type: type && elementTypes.has(type as CadElementType) ? type as CadElementType : null,
        attrs
      },
      diagnostics: type && elementTypes.has(type as CadElementType)
        ? []
        : [diagnostic(line, "element文には有効な `type=` が必要です。")]
    };
  }

  return { diagnostics: [diagnostic(line, `未対応のDSLキーワードです: ${keyword}`)] };
};

export const parseDsl = (source: string): ParseDslResult => {
  const statements: DslStatement[] = [];
  const diagnostics: DslDiagnostic[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const parsed = parseLine(line, index + 1);
    if (parsed.statement) statements.push(parsed.statement);
    diagnostics.push(...parsed.diagnostics);
  });
  return { statements, diagnostics };
};
