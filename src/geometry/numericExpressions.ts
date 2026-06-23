import type {
  CadElement,
  ComputedGeometry,
  ElementId,
  NumericVariable,
  NumericValue
} from "../types/geometry";
import { Parser, tokenize } from "./numericExpressionParser";
import { propertyLabels } from "./numericExpressionProperties";
import type {
  NumericExpressionError,
  NumericExpressionReference,
  NumericMeasurementKey
} from "./numericExpressionTypes";
export { lineMeasurementLabel } from "./numericExpressionProperties";
export type {
  LineMeasurementKey,
  NumericExpressionError,
  NumericExpressionReference,
  NumericMeasurementKey
} from "./numericExpressionTypes";

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
  /^@[^\s()+*/.]+$/.test(expression) ||
    /^[^\s()+*/.]+\.(length|startAngleDeg|endAngleDeg|startHandleAngleDeg|startHandleLength|endHandleAngleDeg|endHandleLength)$/.test(expression);

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

export const formatNumericExpressionForDisplay = (
  value: NumericValue,
  elements: CadElement[],
  localVariables: NumericVariable[] = []
) => {
  if (!isNumericExpression(value)) return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, "");
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const variablesById = new Map(localVariables.map((variable) => [variable.id, variable]));
  return value.expression
    .replace(/@([^\s()+*/.]+)/g, (match, variableId: string) => {
      const variable = variablesById.get(variableId);
      return variable ? `@${variable.name}` : match;
    })
    .replace(
      /([^\s()+*/]+)\.(length|startAngleDeg|endAngleDeg|startHandleAngleDeg|startHandleLength|endHandleAngleDeg|endHandleLength)\b/g,
      (match, elementId: ElementId, property: NumericMeasurementKey) => {
      const element = elementsById.get(elementId);
      return element ? `${element.name}.${propertyLabels[property]}` : match;
      }
    );
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeNumericExpressionInput = (
  input: string,
  elements: CadElement[],
  localVariables: NumericVariable[] = []
) => {
  let expression = input.trim();
  const variables = [...localVariables].sort((a, b) => b.name.length - a.name.length);
  const measurableElements = elements
    .filter(
      (element) =>
        element.type === "line" ||
        element.type === "arcLine" ||
        element.type === "threePointArcLine" ||
        element.type === "cornerRadiusArcLine" ||
        element.type === "bezierCurve" ||
        element.type === "offsetLine" ||
        element.type === "copyLine" ||
        element.type === "symmetricCopyLine"
    )
    .sort((a, b) => b.name.length - a.name.length);

  for (const variable of variables) {
    expression = expression.replace(
      new RegExp(`@${escapeRegExp(variable.name)}(?=$|[\\s()+*/-])`, "g"),
      `@${variable.id}`
    );
  }

  for (const element of measurableElements) {
    for (const [property, label] of Object.entries(propertyLabels)) {
      if (
        (element.type === "line" ||
          element.type === "arcLine" ||
          element.type === "threePointArcLine" ||
          element.type === "cornerRadiusArcLine") &&
        property !== "length" &&
        property !== "startAngleDeg" &&
        property !== "endAngleDeg"
      ) {
        continue;
      }
      if (
        (element.type === "offsetLine" ||
          element.type === "copyLine" ||
          element.type === "symmetricCopyLine") &&
        property !== "length"
      ) continue;
      expression = expression.replace(
        new RegExp(`${escapeRegExp(element.name)}\\.${escapeRegExp(label)}(?=$|[\\s()+*/-])`, "g"),
        `${element.id}.${property}`
      );
    }
  }

  return expression;
};

export const extractNumericExpressionReferences = (value: NumericValue): NumericExpressionReference[] => {
  if (!isNumericExpression(value)) return [];
  try {
    return tokenize(value.expression)
      .filter((token) => token.type === "reference")
      .map((token) => ({ elementId: token.elementId, property: token.property }));
  } catch {
    return [];
  }
};

export const singleLocalVariableReference = (value: NumericValue): string | null => {
  if (!isNumericExpression(value)) return null;
  try {
    const tokens = tokenize(value.expression);
    return tokens.length === 1 && tokens[0].type === "localVariable" ? tokens[0].variableId : null;
  } catch {
    return null;
  }
};

export const evaluateNumericValue = ({
  value,
  computedGeometry,
  elementsById,
  localVariables,
  localVariableNames
}: {
  value: NumericValue;
  computedGeometry: Map<ElementId, ComputedGeometry>;
  elementsById: Map<ElementId, CadElement>;
  localVariables?: Map<string, number>;
  localVariableNames?: Map<string, string>;
}): { value?: number; error?: NumericExpressionError } => {
  if (!isNumericExpression(value)) return { value };

  try {
    const parser = new Parser(tokenize(value.expression), (reference) => {
      const geometry = computedGeometry.get(reference.elementId);
      if (
        !geometry ||
        (
          geometry.kind !== "line" &&
          geometry.kind !== "arcLine" &&
          geometry.kind !== "bezierCurve" &&
          geometry.kind !== "offsetLine"
        ) ||
        ((geometry.kind === "line" || geometry.kind === "arcLine") &&
          reference.property !== "length" &&
          reference.property !== "startAngleDeg" &&
          reference.property !== "endAngleDeg") ||
        (geometry.kind === "offsetLine" && reference.property !== "length")
      ) {
        const dependencyName = elementsById.get(reference.elementId)?.name;
        throw Object.assign(
          new Error(
            `${dependencyName ?? reference.elementId} はこの要素より後にあるか、存在しません。`
          ),
          { dependencyId: reference.elementId, dependencyName }
        );
      }

      const measuredValue = geometry[reference.property as keyof typeof geometry];
      if (measuredValue === null) {
        throw Object.assign(new Error(`${geometry.name}.${propertyLabels[reference.property]} は未定義です。`), {
          dependencyId: reference.elementId,
          dependencyName: geometry.name
        });
      }
      if (typeof measuredValue !== "number") {
        throw Object.assign(new Error(`${geometry.name}.${propertyLabels[reference.property]} は数値ではありません。`), {
          dependencyId: reference.elementId,
          dependencyName: geometry.name
        });
      }
      return measuredValue;
    }, (variableId) => {
      const variableValue = localVariables?.get(variableId);
      if (variableValue === undefined) {
        throw Object.assign(
          new Error(`${localVariableNames?.get(variableId) ?? variableId} はこの要素内に存在しません。`),
          { dependencyId: variableId, dependencyName: localVariableNames?.get(variableId) }
        );
      }
      return variableValue;
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
