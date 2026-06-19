import type { CadElement, ComputedGeometry, ElementId, NumericValue } from "../types/geometry";

export type LineMeasurementKey = "length" | "startAngleDeg" | "endAngleDeg";

export type NumericExpressionReference = {
  elementId: ElementId;
  property: LineMeasurementKey;
};

export type NumericExpressionError = {
  dependencyId: ElementId;
  dependencyName?: string;
  message: string;
};

const propertyLabels: Record<LineMeasurementKey, string> = {
  length: "長さ",
  startAngleDeg: "始角度",
  endAngleDeg: "終角度"
};

const labelToProperty = new Map<string, LineMeasurementKey>(
  Object.entries(propertyLabels).map(([key, label]) => [label, key as LineMeasurementKey])
);

export const isNumericExpression = (value: NumericValue): value is Exclude<NumericValue, number> =>
  typeof value === "object" && value !== null && value.kind === "expression";

export const numericValueExpression = (value: NumericValue) =>
  isNumericExpression(value) ? value.expression : `${value}`;

export const makeNumericExpression = (expression: string): NumericValue => {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return 0;
  const numeric = Number(trimmed);
  return trimmed.length > 0 && Number.isFinite(numeric)
    ? numeric
    : { kind: "expression", expression: trimmed };
};

const formatExpressionNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(10).replace(/\.?0+$/, "");

const hasSingleOuterParentheses = (expression: string) => {
  if (!expression.startsWith("(") || !expression.endsWith(")")) return false;

  let depth = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && index < expression.length - 1) return false;
    if (depth < 0) return false;
  }

  return depth === 0;
};

const trimRedundantOuterParentheses = (expression: string): string => {
  let trimmed = expression.trim();
  while (hasSingleOuterParentheses(trimmed)) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isSimpleNumericTerm = (expression: string) =>
  /^(\d+(?:\.\d+)?|\.\d+)$/.test(expression) ||
  /^[^\s()+*/.]+\.(length|startAngleDeg|endAngleDeg)$/.test(expression);

const trimSimpleOuterParentheses = (expression: string): string => {
  const fullyTrimmed = trimRedundantOuterParentheses(expression);
  return isSimpleNumericTerm(fullyTrimmed) ? fullyTrimmed : expression.trim();
};

const appendOffsetToExpression = (expression: string, offset: number) => {
  if (offset === 0) return trimRedundantOuterParentheses(expression);
  const baseExpression = trimSimpleOuterParentheses(expression);
  const operator = offset >= 0 ? "+" : "-";
  return `${baseExpression} ${operator} ${formatExpressionNumber(Math.abs(offset))}`;
};

export const addToNumericValue = (value: NumericValue, delta: number): NumericValue => {
  if (delta === 0) return value;
  if (!isNumericExpression(value)) return value + delta;
  const trimmed = trimRedundantOuterParentheses(value.expression);
  const offsetMatch = trimmed.match(/^(.*?)(?:\s+)([+-])\s+(\d+(?:\.\d+)?|\.\d+)$/);
  const baseExpression = offsetMatch?.[1]?.trim();
  if (offsetMatch && baseExpression) {
    const currentOffset = Number(offsetMatch[3]) * (offsetMatch[2] === "-" ? -1 : 1);
    const nextOffset = currentOffset + delta;
    return {
      kind: "expression",
      expression: appendOffsetToExpression(baseExpression, nextOffset)
    };
  }

  return {
    kind: "expression",
    expression: appendOffsetToExpression(`(${trimmed})`, delta)
  };
};

export const lineMeasurementLabel = (property: LineMeasurementKey) => propertyLabels[property];

export const formatNumericExpressionForDisplay = (
  value: NumericValue,
  elements: CadElement[]
) => {
  if (!isNumericExpression(value)) return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, "");
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  return value.expression.replace(
    /([^\s()+*/]+)\.(length|startAngleDeg|endAngleDeg)\b/g,
    (match, elementId: ElementId, property: LineMeasurementKey) => {
      const element = elementsById.get(elementId);
      return element ? `${element.name}.${propertyLabels[property]}` : match;
    }
  );
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeNumericExpressionInput = (input: string, elements: CadElement[]) => {
  let expression = input.trim();
  const lineElements = elements
    .filter((element) => element.type === "line")
    .sort((a, b) => b.name.length - a.name.length);

  for (const element of lineElements) {
    for (const [property, label] of Object.entries(propertyLabels)) {
      expression = expression.replace(
        new RegExp(`${escapeRegExp(element.name)}\\.${escapeRegExp(label)}(?=$|[\\s()+*/-])`, "g"),
        `${element.id}.${property}`
      );
    }
  }

  return expression;
};

type Token =
  | { type: "number"; value: number }
  | { type: "reference"; elementId: ElementId; property: LineMeasurementKey }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "leftParen" }
  | { type: "rightParen" };

const tokenize = (expression: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "leftParen" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rightParen" });
      index += 1;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    const numberMatch = expression.slice(index).match(/^\d+(?:\.\d+)?|^\.\d+/);
    if (numberMatch) {
      tokens.push({ type: "number", value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }

    const referenceMatch = expression
      .slice(index)
      .match(/^([^\s()+*/.]+)\.([^\s()+*/.]+)/);
    if (referenceMatch) {
      const property = labelToProperty.get(referenceMatch[2]) ?? referenceMatch[2];
      if (property !== "length" && property !== "startAngleDeg" && property !== "endAngleDeg") {
        throw new Error(`未対応の参照プロパティです: ${referenceMatch[2]}`);
      }
      tokens.push({
        type: "reference",
        elementId: referenceMatch[1],
        property
      });
      index += referenceMatch[0].length;
      continue;
    }

    throw new Error(`式を解釈できません: ${expression.slice(index)}`);
  }

  return tokens;
};

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly referenceValue: (reference: NumericExpressionReference) => number
  ) {}

  parse() {
    const value = this.parseExpression();
    if (this.index < this.tokens.length) throw new Error("式の末尾を解釈できません。");
    return value;
  }

  private parseExpression() {
    let value = this.parseTerm();
    while (this.peekOperator("+") || this.peekOperator("-")) {
      const operator = this.consumeOperator();
      const right = this.parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  private parseTerm() {
    let value = this.parseFactor();
    while (this.peekOperator("*") || this.peekOperator("/")) {
      const operator = this.consumeOperator();
      const right = this.parseFactor();
      if (operator === "/" && right === 0) throw new Error("0で割ることはできません。");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  private parseFactor(): number {
    const token = this.consume();
    if (!token) throw new Error("式が途中で終わっています。");
    if (token.type === "number") return token.value;
    if (token.type === "reference") return this.referenceValue(token);
    if (token.type === "operator" && token.value === "+") return this.parseFactor();
    if (token.type === "operator" && token.value === "-") return -this.parseFactor();
    if (token.type === "leftParen") {
      const value = this.parseExpression();
      if (this.consume()?.type !== "rightParen") throw new Error("閉じ括弧がありません。");
      return value;
    }
    throw new Error("数値、参照、または括弧が必要です。");
  }

  private peekOperator(value: "+" | "-" | "*" | "/") {
    const token = this.tokens[this.index];
    return token?.type === "operator" && token.value === value;
  }

  private consumeOperator() {
    const token = this.consume();
    if (token?.type !== "operator") throw new Error("演算子が必要です。");
    return token.value;
  }

  private consume() {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }
}

export const extractNumericExpressionReferences = (value: NumericValue): NumericExpressionReference[] => {
  if (!isNumericExpression(value)) return [];
  try {
    return tokenize(value.expression)
      .filter((token): token is Token & { type: "reference" } => token.type === "reference")
      .map((token) => ({ elementId: token.elementId, property: token.property }));
  } catch {
    return [];
  }
};

export const evaluateNumericValue = ({
  value,
  computedGeometry,
  elementsById
}: {
  value: NumericValue;
  computedGeometry: Map<ElementId, ComputedGeometry>;
  elementsById: Map<ElementId, CadElement>;
}): { value?: number; error?: NumericExpressionError } => {
  if (!isNumericExpression(value)) return { value };

  try {
    const parser = new Parser(tokenize(value.expression), (reference) => {
      const geometry = computedGeometry.get(reference.elementId);
      if (geometry?.kind !== "line") {
        const dependencyName = elementsById.get(reference.elementId)?.name;
        throw Object.assign(
          new Error(
            `${dependencyName ?? reference.elementId} はこの要素より後にあるか、存在しません。`
          ),
          { dependencyId: reference.elementId, dependencyName }
        );
      }

      const measuredValue = geometry[reference.property];
      if (measuredValue === null) {
        throw Object.assign(new Error(`${geometry.name}.${propertyLabels[reference.property]} は未定義です。`), {
          dependencyId: reference.elementId,
          dependencyName: geometry.name
        });
      }
      return measuredValue;
    });
    return { value: parser.parse() };
  } catch (error) {
    const typedError = error as Error & { dependencyId?: ElementId; dependencyName?: string };
    return {
      error: {
        dependencyId: typedError.dependencyId ?? value.expression,
        dependencyName: typedError.dependencyName,
        message: typedError.message
      }
    };
  }
};
