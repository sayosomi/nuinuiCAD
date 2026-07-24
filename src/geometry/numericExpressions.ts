import type {
  CadElement,
  ComputedGeometry,
  ComputedLine,
  ComputedPoint,
  ComputedVariable,
  ElementId,
  NumericVariable,
  NumericValue
} from "../types/geometry";
import type { PointAnchor } from "../types/geometry";
import { derivedPointLabel, resolveDerivedPoint } from "../model/pointAnchors";
import { elementNameTokensForContext, elementQualifiedName } from "../model/elementNames";
import type { ElementNameContext, ElementNameToken } from "../model/elementNames";
import { getParameterValue } from "../parameters/parameterAccess";
import { Parser, tokenize } from "./numericExpressionParser";
import type { NumericExpressionMeasurementFunctionName } from "./numericExpressionParser";
import { propertyLabels } from "./numericExpressionProperties";
import type {
  NumericExpressionError,
  NumericExpressionReference,
  NumericMeasurementKey
} from "./numericExpressionTypes";
import { resolveVariableReference } from "./variableScope";
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

export const pointAnchorExpression = (anchor: PointAnchor) => {
  if (anchor.mode === "reference") return anchor.pointId;
  if (anchor.mode === "derived") return `${anchor.elementId}:${anchor.pointKey}`;
  return "";
};

const pointExpressionSourceId = (expressionId: ElementId) => {
  const separatorIndex = expressionId.indexOf(":");
  return separatorIndex < 0 ? expressionId : expressionId.slice(0, separatorIndex);
};

const pointExpressionKey = (expressionId: ElementId) => {
  const separatorIndex = expressionId.indexOf(":");
  return separatorIndex < 0 ? null : expressionId.slice(separatorIndex + 1);
};

const pointExpressionLabel = (
  expressionId: ElementId,
  elementsById: Map<ElementId, CadElement>
) => {
  const pointKey = pointExpressionKey(expressionId);
  if (!pointKey) return elementsById.get(expressionId)?.name ?? expressionId;
  const elementId = pointExpressionSourceId(expressionId);
  return derivedPointLabel(elementId, pointKey, elementsById);
};

const EPSILON = 1e-9;

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
  /^@[^\s()+*/.<>!=&|]+$/.test(expression) ||
    /^[^\s()+*/.<>!=&|]+\.[^\s()+*/<>!=&|]+$/.test(expression);

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
  localVariables: NumericVariable[] = [],
  currentElement?: CadElement
) => {
  if (!isNumericExpression(value)) return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, "");
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const elementNameCounts = new Map<string, number>();
  for (const element of elements) {
    if (!element.name.trim()) continue;
    elementNameCounts.set(element.name, (elementNameCounts.get(element.name) ?? 0) + 1);
  }
  const displayName = (element: CadElement) =>
    (elementNameCounts.get(element.name) ?? 0) > 1
      ? elementQualifiedName(element, elements)
      : element.name;
  const localVariableNameCounts = new Map<string, number>();
  for (const variable of localVariables) {
    localVariableNameCounts.set(variable.name, (localVariableNameCounts.get(variable.name) ?? 0) + 1);
  }
  const variablesById = new Map(
    localVariables.map((variable) => {
      const ambiguousName = currentElement && (localVariableNameCounts.get(variable.name) ?? 0) > 1;
      const name = currentElement && !ambiguousName
        ? `${currentElement.name}.${variable.name}`
        : ambiguousName
          ? variable.id
          : variable.name;
      return [variable.id, name];
    })
  );
  return value.expression
    .replace(/@([^\s()+*/.<>!=&|]+)/g, (match, variableId: string) => {
      const variableName = variablesById.get(variableId);
      if (variableName) return `@${variableName}`;
      const variableElement = elementsById.get(variableId);
      return variableElement?.type === "variable" ? `@${displayName(variableElement)}` : match;
    })
    .replace(
      /(distance|angle|lineDistance|距離|角度|点線距離)\(\s*([^)]*?)\s*\)/g,
      (match, name: string, rawArgs: string) => {
        const args = rawArgs
          .split(",")
          .map((arg) => arg.trim())
          .map((arg) => pointExpressionLabel(arg, elementsById))
          .join(", ");
        return `${name}(${args})`;
      }
    )
    .replace(
      /([^\s()+*/<>!=&|]+)\.([^\s()+*/<>!=&|]+)\b/g,
      (match, elementId: ElementId, property: string) => {
      const element = elementsById.get(elementId);
      const label = propertyLabels[property as NumericMeasurementKey] ?? property;
      return element ? `${displayName(element)}.${label}` : match;
      }
    );
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// パターン文字列→コンパイル済みRegExpのプロセス内キャッシュ。normalizeNumericExpressionInput
// はトークン(要素名・変数名)毎に正規表現を組み立てるため、文書内で繰り返し出現する
// トークンほど再構築コストが効いてくる。globalフラグ付き正規表現は String.replace が
// 呼び出し毎に内部でlastIndexを0にリセットしてから走査するため(仕様上の挙動)、
// 同一RegExpインスタンスを複数回のreplaceに使い回しても副作用は無い(test/execの
// ような手動lastIndex管理をここでは一切行わない)。
const regexCache = new Map<string, RegExp>();
const cachedRegExp = (pattern: string, flags = "g"): RegExp => {
  const key = `${flags} ${pattern}`;
  const existing = regexCache.get(key);
  if (existing) return existing;
  const regex = new RegExp(pattern, flags);
  regexCache.set(key, regex);
  return regex;
};

const quotedNamePattern = (name: string, suffix = "(?=$|[\\s()+*/<>=!&|,-])") =>
  cachedRegExp(`(["'])${escapeRegExp(name)}\\1${suffix}`);

const MEASURABLE_ELEMENT_TYPES = new Set<CadElement["type"]>([
  "line",
  "angleLengthLine",
  "arcLine",
  "threePointArcLine",
  "cornerRadiusArcLine",
  "bezierCurve",
  "offsetLine",
  "copyLine",
  "symmetricCopyLine"
]);

// ==== context単位キャッシュ(Phase 1c-3後の性能退行対応) ====
//
// normalizeNumericExpressionInput は1要素につき数値フィールドの数だけ
// 呼ばれる(1文書で数千回)。measurableElementIds・トークン絞り込みは
// 呼び出し毎の入力(elements/context)が同一文書内では不変なので、
// ElementNameContext単位・elementNameTokensForContextの返す配列単位で
// キャッシュする。contextなし呼び出し(互換経路)は毎回新規contextが
// 作られるためキャッシュは効かず、従来どおりの結果を返す(挙動不変)。

const measurableIdsCache = new WeakMap<ElementNameContext, Set<ElementId>>();

const measurableElementIdsFor = (elements: CadElement[], context?: ElementNameContext): Set<ElementId> => {
  const compute = (source: CadElement[]) =>
    new Set(
      source.filter((element) => MEASURABLE_ELEMENT_TYPES.has(element.type)).map((element) => element.id)
    );
  if (!context) return compute(elements);
  const cached = measurableIdsCache.get(context);
  if (cached) return cached;
  // elementNameTokensForContext と同様、context指定時はcontext.elementsを
  // 権威データとして使う(呼び出し元のelements引数は互換経路専用)。
  const computed = compute(context.elements);
  measurableIdsCache.set(context, computed);
  return computed;
};

type FilteredNameTokens = {
  variableElementTokens: ElementNameToken[];
  measurableElementTokens: ElementNameToken[];
};

// elementNameTokensForContext はnamespace毎に同一配列インスタンスを返すため
// (ElementNameContext.tokensByNamespaceKeyでキャッシュ済み)、その配列参照を
// キーにすれば絞り込み結果も自然にnamespace単位でキャッシュされる。
const filteredNameTokensCache = new WeakMap<readonly ElementNameToken[], FilteredNameTokens>();

const filteredNameTokensFor = (
  nameTokens: readonly ElementNameToken[],
  measurableElementIds: Set<ElementId>
): FilteredNameTokens => {
  const cached = filteredNameTokensCache.get(nameTokens);
  if (cached) return cached;
  const computed: FilteredNameTokens = {
    variableElementTokens: nameTokens.filter(({ element }) => element.type === "variable"),
    measurableElementTokens: nameTokens.filter(({ element }) => measurableElementIds.has(element.id))
  };
  filteredNameTokensCache.set(nameTokens, computed);
  return computed;
};

export const normalizeNumericExpressionInput = (
  input: string,
  elements: CadElement[],
  localVariables: NumericVariable[] = [],
  currentElement?: CadElement,
  context?: ElementNameContext
) => {
  let expression = input.trim();
  const variables = [...localVariables].sort((a, b) => b.name.length - a.name.length);
  const localVariableNameCounts = new Map<string, number>();
  for (const variable of localVariables) {
    localVariableNameCounts.set(variable.name, (localVariableNameCounts.get(variable.name) ?? 0) + 1);
  }
  const measurableElementIds = measurableElementIdsFor(elements, context);
  const nameTokens = elementNameTokensForContext({ elements, currentElement, context });
  const { variableElementTokens, measurableElementTokens } = filteredNameTokensFor(
    nameTokens,
    measurableElementIds
  );

  if (currentElement) {
    const qualifiedVariables = [...variables].sort(
      (a, b) =>
        `${currentElement.name}.${b.name}`.length - `${currentElement.name}.${a.name}`.length
    );
    for (const variable of qualifiedVariables) {
      if (currentElement && (localVariableNameCounts.get(variable.name) ?? 0) > 1) continue;
      const token = `${currentElement.name}.${variable.name}`;
      if (!expression.includes(token)) continue;
      expression = expression.replace(
        cachedRegExp(`@${escapeRegExp(token)}(?=$|[\\s()+*/<>=!&|-])`),
        `@${variable.id}`
      );
    }
  }

  for (const variable of variables) {
    if (currentElement && (localVariableNameCounts.get(variable.name) ?? 0) > 1) continue;
    if (!expression.includes(variable.name)) continue;
    expression = expression.replace(
      cachedRegExp(`@${escapeRegExp(variable.name)}(?=$|[\\s()+*/<>=!&|-])`),
      `@${variable.id}`
    );
  }

  for (const { token, element: variable } of variableElementTokens) {
    if (!expression.includes(token)) continue;
    expression = expression.replace(
      cachedRegExp(`@${escapeRegExp(token)}(?=$|[\\s()+*/<>=!&|-])`),
      `@${variable.id}`
    );
  }

  for (const { token, element } of measurableElementTokens) {
    if (!expression.includes(token)) continue;
    for (const [property, label] of Object.entries(propertyLabels)) {
      if (!expression.includes(label)) continue;
      if (
        (element.type === "line" ||
          element.type === "angleLengthLine" ||
          element.type === "arcLine" ||
          element.type === "threePointArcLine" ||
          element.type === "cornerRadiusArcLine") &&
        property !== "length" &&
        property !== "startAngleDeg" &&
        property !== "endAngleDeg" &&
        property !== "startTangentAngleDeg" &&
        property !== "endTangentAngleDeg"
      ) {
        continue;
      }
      if (
        (element.type === "offsetLine" ||
          element.type === "copyLine" ||
          element.type === "symmetricCopyLine") &&
        property !== "length" &&
        property !== "startTangentAngleDeg" &&
        property !== "endTangentAngleDeg"
      ) continue;
      expression = expression.replace(
        cachedRegExp(`${escapeRegExp(token)}\\.${escapeRegExp(label)}(?=$|[\\s()+*/<>=!&|-])`),
        `${element.id}.${property}`
      );
      expression = expression.replace(
        quotedNamePattern(token, `\\.${escapeRegExp(label)}(?=$|[\\s()+*/<>=!&|-])`),
        `${element.id}.${property}`
      );
    }
  }

  for (const { token, element } of nameTokens) {
    if (!expression.includes(token)) continue;
    expression = expression.replace(
      cachedRegExp(`(^|[^@])${escapeRegExp(token)}\\.`),
      `$1${element.id}.`
    );
    expression = expression.replace(quotedNamePattern(token, "\\."), `${element.id}.`);
    expression = expression.replace(
      cachedRegExp(`(^|[^@])${escapeRegExp(token)}:(?=\\w)`),
      `$1${element.id}:`
    );
    expression = expression.replace(quotedNamePattern(token, ":"), `${element.id}:`);
    expression = expression.replace(quotedNamePattern(token), element.id);
    expression = expression.replace(
      cachedRegExp(`(^|[(,]\\s*)${escapeRegExp(token)}(?=\\s*[,)])`),
      `$1${element.id}`
    );
  }

  return expression;
};

const pointValueFromAnchor = ({
  anchor,
  axis,
  computedGeometry,
  elementsById,
  dependencyError
}: {
  anchor: PointAnchor | null;
  axis: "x" | "y";
  computedGeometry: Map<ElementId, ComputedGeometry>;
  elementsById: Map<ElementId, CadElement>;
  dependencyError: (elementId: ElementId) => Error & { dependencyId: ElementId; dependencyName?: string };
}) => {
  if (!anchor) return undefined;
  if (anchor.mode === "coordinate") return anchor[axis];
  const sourceId = anchor.mode === "reference" ? anchor.pointId : anchor.elementId;
  const geometry = computedGeometry.get(sourceId);
  if (anchor.mode === "reference") {
    if (geometry?.kind !== "point") throw dependencyError(sourceId);
    return geometry[axis];
  }
  const point = resolveDerivedPoint(geometry, anchor.pointKey, elementsById);
  if (!point) throw dependencyError(sourceId);
  return point[axis];
};

const computedReferencePathValue = (geometry: ComputedGeometry | undefined, property: string) => {
  if (!geometry) return undefined;
  if (geometry.kind === "point") {
    if (property === "x") return geometry.x;
    if (property === "y") return geometry.y;
    return undefined;
  }
  if (geometry.kind === "line") {
    if (property === "length") return geometry.length;
    if (property === "startAngleDeg") return geometry.startAngleDeg;
    if (property === "endAngleDeg") return geometry.endAngleDeg;
    if (property === "startTangentAngleDeg") return geometry.startTangentAngleDeg;
    if (property === "endTangentAngleDeg") return geometry.endTangentAngleDeg;
    if (property === "startPoint.x") return geometry.start.x;
    if (property === "startPoint.y") return geometry.start.y;
    if (property === "endPoint.x") return geometry.end.x;
    if (property === "endPoint.y") return geometry.end.y;
  }
  if (geometry.kind === "arcLine") {
    if (property === "length") return geometry.length;
    if (property === "radius") return geometry.radius;
    if (property === "startAngleDeg") return geometry.startAngleDeg;
    if (property === "endAngleDeg") return geometry.endAngleDeg;
    if (property === "sweepAngleDeg") return geometry.sweepAngleDeg;
    if (property === "startTangentAngleDeg") return geometry.startTangentAngleDeg;
    if (property === "endTangentAngleDeg") return geometry.endTangentAngleDeg;
    if (property === "centerPoint.x") return geometry.center.x;
    if (property === "centerPoint.y") return geometry.center.y;
    if (property === "startPoint.x") return geometry.start.x;
    if (property === "startPoint.y") return geometry.start.y;
    if (property === "endPoint.x") return geometry.end.x;
    if (property === "endPoint.y") return geometry.end.y;
  }
  if (geometry.kind === "bezierCurve") {
    const start = geometry.segments[0]?.start;
    const end = geometry.segments.at(-1)?.end;
    if (property === "length") return geometry.length;
    if (property === "startTangentAngleDeg") return geometry.startTangentAngleDeg;
    if (property === "endTangentAngleDeg") return geometry.endTangentAngleDeg;
    if (property === "startHandleAngleDeg") return geometry.startHandleAngleDeg;
    if (property === "startHandleLength") return geometry.startHandleLength;
    if (property === "endHandleAngleDeg") return geometry.endHandleAngleDeg;
    if (property === "endHandleLength") return geometry.endHandleLength;
    if (property === "startPoint.x") return start?.x;
    if (property === "startPoint.y") return start?.y;
    if (property === "endPoint.x") return end?.x;
    if (property === "endPoint.y") return end?.y;
    const intermediateMatch = property.match(/^intermediatePoints\[(\d+)\]\.(x|y)$/);
    if (intermediateMatch) return geometry.segments[Number(intermediateMatch[1]) - 1]?.end[intermediateMatch[2] as "x" | "y"];
  }
  if (geometry.kind === "offsetLine") {
    if (property === "length") return geometry.length;
    if (property === "startTangentAngleDeg") return geometry.startTangentAngleDeg;
    if (property === "endTangentAngleDeg") return geometry.endTangentAngleDeg;
    if (property === "startPoint.x") return geometry.start?.x;
    if (property === "startPoint.y") return geometry.start?.y;
    if (property === "endPoint.x") return geometry.end?.x;
    if (property === "endPoint.y") return geometry.end?.y;
  }
  if (geometry.kind === "image") {
    if (property === "originPoint.x") return geometry.origin.x;
    if (property === "originPoint.y") return geometry.origin.y;
    if (property === "widthMm") return geometry.widthMm;
    if (property === "heightMm") return geometry.heightMm;
    if (property === "scale") return geometry.scale;
    if (property === "angleDeg") return geometry.angleDeg;
    if (property === "naturalWidthPx") return geometry.naturalWidthPx;
    if (property === "naturalHeightPx") return geometry.naturalHeightPx;
    if (property === "sourceDpi") return geometry.sourceDpi;
    if (property === "targetPixelsPerMm") return geometry.targetPixelsPerMm;
  }
  if (geometry.kind === "text") {
    if (property === "anchorPoint.x") return geometry.anchor?.x;
    if (property === "anchorPoint.y") return geometry.anchor?.y;
    if (property === "fontSize") return geometry.fontSize;
  }
  return undefined;
};

export const extractNumericExpressionReferences = (value: NumericValue): NumericExpressionReference[] => {
  if (!isNumericExpression(value)) return [];
  try {
    return tokenize(value.expression)
      .filter((token) => token.type === "reference" || token.type === "element")
      .map((token) =>
        token.type === "reference"
          ? { elementId: token.elementId, property: token.property }
          : { elementId: pointExpressionSourceId(token.elementId) }
      );
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
  localVariableNames,
  computedVariables,
  currentElement,
  elements
}: {
  value: NumericValue;
  computedGeometry: Map<ElementId, ComputedGeometry>;
  elementsById: Map<ElementId, CadElement>;
  localVariables?: Map<string, number>;
  localVariableNames?: Map<string, string>;
  computedVariables?: Map<ElementId, ComputedVariable>;
  currentElement?: CadElement;
  elements?: CadElement[];
}): { value?: number; error?: NumericExpressionError } => {
  if (!isNumericExpression(value)) return { value };

  try {
    const dependencyError = (elementId: ElementId) => {
      const dependencyName = elementsById.get(elementId)?.name;
      return Object.assign(
        new Error(`${dependencyName ?? elementId} はこの要素より後にあるか、存在しません。`),
        { dependencyId: elementId, dependencyName }
      );
    };
    const pointValue = (elementId: ElementId): ComputedPoint => {
      const pointKey = pointExpressionKey(elementId);
      const sourceId = pointExpressionSourceId(elementId);
      const geometry = computedGeometry.get(sourceId);
      if (pointKey) {
        const point = resolveDerivedPoint(geometry, pointKey, elementsById);
        if (!point) throw dependencyError(sourceId);
        return point;
      }
      if (geometry?.kind !== "point") throw dependencyError(sourceId);
      return geometry;
    };
    const lineValue = (elementId: ElementId): ComputedLine => {
      const geometry = computedGeometry.get(elementId);
      if (geometry?.kind !== "line") throw dependencyError(elementId);
      return geometry;
    };
    const requireArgs = (
      name: NumericExpressionMeasurementFunctionName,
      args: ElementId[],
      count: number
    ) => {
      if (args.length !== count) {
        throw new Error(`${name} の引数は ${count} 個必要です。`);
      }
    };
    const parser = new Parser(tokenize(value.expression), (reference) => {
      const geometry = computedGeometry.get(reference.elementId);
      if (!reference.property) {
        const dependencyName = elementsById.get(reference.elementId)?.name;
        throw Object.assign(
          new Error(
            `${dependencyName ?? reference.elementId} はこの要素より後にあるか、存在しません。`
          ),
          { dependencyId: reference.elementId, dependencyName }
        );
      }

      if (reference.property.startsWith("params.")) {
        const element = elementsById.get(reference.elementId);
        const parameterPath = reference.property.slice("params.".length);
        const pointMatch = parameterPath.match(/^(.+)\.(x|y)$/);
        if (pointMatch) {
          const anchor = element ? getParameterValue(element, pointMatch[1]) as PointAnchor | null : null;
          const anchorValue = pointValueFromAnchor({
            anchor,
            axis: pointMatch[2] as "x" | "y",
            computedGeometry,
            elementsById,
            dependencyError
          });
          if (typeof anchorValue === "number") return anchorValue;
          if (anchorValue && typeof anchorValue === "object") {
            const evaluated = evaluateNumericValue({
              value: anchorValue,
              computedGeometry,
              elementsById,
              localVariables,
              localVariableNames,
              computedVariables,
              currentElement,
              elements
            });
            if (evaluated.value !== undefined) return evaluated.value;
            throw Object.assign(new Error(evaluated.error?.message ?? "設定値を評価できません。"), {
              dependencyId: evaluated.error?.dependencyId ?? reference.elementId,
              dependencyName: evaluated.error?.dependencyName
            });
          }
        }
        const parameterValue = element ? getParameterValue(element, parameterPath) : undefined;
        if (typeof parameterValue === "number") return parameterValue;
        if (isNumericExpression(parameterValue as NumericValue)) {
          const evaluated = evaluateNumericValue({
            value: parameterValue as NumericValue,
            computedGeometry,
            elementsById,
            localVariables,
            localVariableNames,
            computedVariables,
            currentElement,
            elements
          });
          if (evaluated.value !== undefined) return evaluated.value;
          throw Object.assign(new Error(evaluated.error?.message ?? "設定値を評価できません。"), {
            dependencyId: evaluated.error?.dependencyId ?? reference.elementId,
            dependencyName: evaluated.error?.dependencyName
          });
        }
      }

      const variableValue = computedVariables?.get(reference.elementId);
      if (reference.property === "value" && variableValue) return variableValue.value;

      if (!geometry) {
        const dependencyName = elementsById.get(reference.elementId)?.name;
        throw Object.assign(
          new Error(
            `${dependencyName ?? reference.elementId} はこの要素より後にあるか、存在しません。`
          ),
          { dependencyId: reference.elementId, dependencyName }
        );
      }

      const measuredValue = computedReferencePathValue(geometry, reference.property);
      if (measuredValue === null) {
        throw Object.assign(new Error(`${geometry?.name ?? reference.elementId}.${reference.property} は未定義です。`), {
          dependencyId: reference.elementId,
          dependencyName: geometry?.name
        });
      }
      if (typeof measuredValue !== "number") {
        throw Object.assign(new Error(`${geometry?.name ?? reference.elementId}.${reference.property} は数値ではありません。`), {
          dependencyId: reference.elementId,
          dependencyName: geometry?.name
        });
      }
      return measuredValue;
    }, (variableId) => {
      const variableValue = localVariables?.get(variableId);
      if (variableValue !== undefined) return variableValue;

      if (currentElement && elements && computedVariables) {
        const variable = resolveVariableReference({
          variableIdOrName: variableId,
          consumer: currentElement,
          elements,
          elementsById,
          computedVariables
        });
        if (variable?.computed) return variable.computed.value;
        if (variable?.element) {
          throw Object.assign(
            new Error(`${variable.element.name} はこの要素より後にあるか、評価できません。`),
            { dependencyId: variable.element.id, dependencyName: variable.element.name }
          );
        }
      }

      throw Object.assign(
        new Error(`${localVariableNames?.get(variableId) ?? variableId} はこの要素内に存在しません。または参照可能な変数に存在しません。`),
        { dependencyId: variableId, dependencyName: localVariableNames?.get(variableId) }
      );
    }, (name, args) => {
      if (name === "distance") {
        requireArgs(name, args, 2);
        const point1 = pointValue(args[0]);
        const point2 = pointValue(args[1]);
        return Math.hypot(point2.x - point1.x, point2.y - point1.y);
      }

      if (name === "angle") {
        requireArgs(name, args, 2);
        const point1 = pointValue(args[0]);
        const point2 = pointValue(args[1]);
        return (Math.atan2(point2.y - point1.y, point2.x - point1.x) * 180 / Math.PI + 360) % 360;
      }

      requireArgs(name, args, 2);
      const point = pointValue(args[0]);
      const line = lineValue(args[1]);
      const dx = line.end.x - line.start.x;
      const dy = line.end.y - line.start.y;
      const length = Math.hypot(dx, dy);
      if (length <= EPSILON) throw new Error(`${line.name} は長さ0のため点線距離を計算できません。`);
      return Math.abs(dx * (line.start.y - point.y) - (line.start.x - point.x) * dy) / length;
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

type ResolveTextReferencesArgs = {
  text: string;
  computedGeometry: Map<ElementId, ComputedGeometry>;
  elementsById: Map<ElementId, CadElement>;
  localVariables?: Map<string, number>;
  localVariableNames?: Map<string, string>;
  computedVariables?: Map<ElementId, ComputedVariable>;
  currentElement?: CadElement;
  elements?: CadElement[];
};

/** Exported for Task 27's textTemplateRuntime.ts, which reuses this exact
 * formatting for typed number holes and re-injects it for legacy holes -
 * keep both paths on one formatting rule. */
export const textNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(3).replace(/\.?0+$/, "");

export const resolveTextReferences = ({
  text,
  computedGeometry,
  elementsById,
  localVariables,
  localVariableNames,
  computedVariables,
  currentElement,
  elements
}: ResolveTextReferencesArgs): { text?: string; error?: NumericExpressionError } => {
  let firstError: NumericExpressionError | undefined;
  const evaluateInlineExpression = (expression: string) => {
    const normalizedExpression = normalizeNumericExpressionInput(
      expression,
      elements ?? Array.from(elementsById.values()),
      currentElement?.numericVariables ?? [],
      currentElement
    );
    const result = evaluateNumericValue({
      value: { kind: "expression", expression: normalizedExpression },
      computedGeometry,
      elementsById,
      localVariables,
      localVariableNames,
      computedVariables,
      currentElement,
      elements
    });
    if (result.error) {
      firstError = result.error;
      return expression;
    }
    return textNumber(result.value ?? 0);
  };

  const resolved = text.replace(/\{([^{}]+)\}/g, (match, expression: string) => {
    const value = evaluateInlineExpression(expression.trim());
    return firstError ? match : value;
  });

  if (firstError) return { error: firstError };
  return { text: resolved };
};

export const extractTextReferences = (text: string): NumericExpressionReference[] => {
  const references: NumericExpressionReference[] = [];
  for (const match of text.matchAll(/\{([^{}]+)\}/g)) {
    const expression = match[1].trim();
    references.push(...extractNumericExpressionReferences({ kind: "expression", expression }));
    for (const variableMatch of expression.matchAll(/@([^\s()+*/.<>!=&|、。！？「」（）【】［］{}]+)/g)) {
      references.push({ elementId: variableMatch[1] });
    }
  }
  return references;
};
