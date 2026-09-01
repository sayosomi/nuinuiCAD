import type {
  CadElement,
  ComputedGeometry,
  ComputedLine,
  ComputedPoint,
  ComputedBezierSegment,
  ComputedOffsetLineSegment,
  ElementId,
  NumericValue
} from "../types/geometry";
import type { PointAnchor } from "../types/geometry";
import { derivedPointLabel, resolveDerivedPoint } from "../model/pointAnchors";
import { elementNameTokensForContext, elementQualifiedName } from "../model/elementNames";
import type { ElementNameContext } from "../model/elementNames";
import { getParameterValue } from "../parameters/parameterAccess";
import { Parser, tokenize } from "./numericExpressionParser";
import type { NumericExpressionMeasurementFunctionName } from "./numericExpressionParser";
import { propertyLabels } from "./numericExpressionProperties";
import {
  NUMERIC_GEOMETRY_PROPERTY_INPUT_ALIASES,
  numericGeometryPropertyInputAlias
} from "./numericExpressionInputAliases";
import type {
  NumericExpressionError,
  NumericExpressionReference,
  NumericMeasurementKey
} from "./numericExpressionTypes";
import {
  isKnownNumericComputedGeometryProperty,
  isNumericComputedGeometryProperty,
  numericGeometryPropertiesForStaticTarget,
  numericGeometryPropertySupportedByStaticTarget,
  numericGeometryStaticTargetForComputedGeometry,
  numericGeometryStaticTargetForElementInDocument,
  type NumericComputedGeometryProperty,
  type NumericGeometryStaticTarget
} from "./numericGeometryProperties";
export { lineMeasurementLabel } from "./numericExpressionProperties";
export type {
  LineMeasurementKey,
  NumericExpressionError,
  NumericExpressionReference,
  NumericMeasurementKey
} from "./numericExpressionTypes";
export {
  isKnownNumericComputedGeometryProperty,
  isNumericComputedGeometryProperty,
  numericGeometryPropertiesForStaticTarget,
  numericGeometryPropertySupportedByStaticTarget,
  numericGeometryStaticTargetForComputedGeometry,
  NUMERIC_COMPUTED_GEOMETRY_PROPERTIES,
  NUMERIC_COMPUTED_GEOMETRY_MEASUREMENT_PROPERTIES
} from "./numericGeometryProperties";
export type { NumericComputedGeometryProperty, NumericGeometryStaticTarget } from "./numericGeometryProperties";

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
  currentElement?: CadElement,
  majorVersion: 2 | 3 = 3
) => {
  const propertyReferenceSigil = majorVersion >= 3 ? "@" : "";
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
  return value.expression
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
      /([^\s()+*/<>!=&|,@.]+)\.([^\s()+*/<>!=&|,@]+)/g,
      (match, elementId: ElementId, property: string) => {
        const element = elementsById.get(elementId);
        const label = propertyLabels[property as NumericMeasurementKey] ?? property;
        return element ? `${propertyReferenceSigil}${displayName(element)}.${label}` : match;
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

const quotedNamePattern = (name: string, suffix = "(?=$|[\\s()+*/<>=!&|,-])", prefix = "") =>
  cachedRegExp(`${prefix}(["'])${escapeRegExp(name)}\\1${suffix}`);

// Element names are normalized to stable IDs here. The small, explicit alias
// boundary below restores only unaffected legacy input spellings; presentation
// labels are never used as a source of aliases.

type NumericExpressionCurrentElement = Pick<CadElement, "parentGroupId"> &
  Partial<Pick<CadElement, "name">>;

const numericGeometryPropertyAliasPattern = new RegExp(
  `\\.(${Object.keys(NUMERIC_GEOMETRY_PROPERTY_INPUT_ALIASES).map(escapeRegExp).join("|")})(?=$|[\\s()+*/<>=!&|,])`,
  "g"
);

export const normalizeNumericExpressionInput = (
  input: string,
  elements: CadElement[],
  currentElement?: NumericExpressionCurrentElement,
  context?: ElementNameContext
) => {
  let expression = input.trim();
  const nameTokens = elementNameTokensForContext({ elements, currentElement, context });

  // nui1 sigil form: `@ElementName.property` lowers to the same stable-ID IR
  // as bare `ElementName.property`. Property labels are presentation-only and
  // are intentionally not accepted here as source aliases.
  for (const { token, element } of nameTokens) {
    if (!expression.includes(`@${token}.`)) continue;
    expression = expression.replace(cachedRegExp(`@${escapeRegExp(token)}\\.`), `${element.id}.`);
    expression = expression.replace(quotedNamePattern(token, "\\.", "@"), `${element.id}.`);
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

  return expression.replace(numericGeometryPropertyAliasPattern, (_match, property: string) =>
    `.${numericGeometryPropertyInputAlias(property)}`
  );
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

const normalizeDirectionDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

const directionAngle = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.hypot(dx, dy) <= EPSILON
    ? undefined
    : normalizeDirectionDegrees((Math.atan2(dy, dx) * 180) / Math.PI);
};

const reverseDirection = (angle: number | undefined) =>
  angle === undefined ? undefined : normalizeDirectionDegrees(angle + 180);

const bezierStartForwardDirection = (segment: ComputedBezierSegment | Extract<ComputedOffsetLineSegment, { kind: "bezier" }>) =>
  directionAngle(segment.start, segment.control1) ??
  directionAngle(segment.start, segment.control2) ??
  directionAngle(segment.start, segment.end);

const bezierEndForwardDirection = (segment: ComputedBezierSegment | Extract<ComputedOffsetLineSegment, { kind: "bezier" }>) =>
  directionAngle(segment.control2, segment.end) ??
  directionAngle(segment.control1, segment.end) ??
  directionAngle(segment.start, segment.end);

const firstDirection = <T>(segments: readonly T[], direction: (segment: T) => number | undefined) => {
  for (const segment of segments) {
    const angle = direction(segment);
    if (angle !== undefined) return angle;
  }
  return undefined;
};

const lastInteriorDirection = <T>(
  segments: readonly T[],
  forwardDirection: (segment: T) => number | undefined
) => {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const angle = forwardDirection(segments[index]);
    if (angle !== undefined) return reverseDirection(angle);
  }
  return undefined;
};

const offsetSegmentStartDirection = (segment: ComputedOffsetLineSegment) => {
  if (segment.kind === "line") return directionAngle(segment.start, segment.end);
  if (segment.kind === "bezier") return bezierStartForwardDirection(segment);
  if (Math.abs(segment.radius) <= EPSILON || Math.abs(segment.sweepAngleDeg) <= EPSILON) return undefined;
  const radial = directionAngle(segment.center, segment.start);
  if (radial === undefined) return undefined;
  return normalizeDirectionDegrees(
    radial + (segment.sweepAngleDeg >= 0 ? 90 : -90)
  );
};

const offsetSegmentEndForwardDirection = (segment: ComputedOffsetLineSegment) => {
  if (segment.kind === "line") return directionAngle(segment.start, segment.end);
  if (segment.kind === "bezier") return bezierEndForwardDirection(segment);
  if (Math.abs(segment.radius) <= EPSILON || Math.abs(segment.sweepAngleDeg) <= EPSILON) return undefined;
  const radial = directionAngle(segment.center, segment.end);
  if (radial === undefined) return undefined;
  return normalizeDirectionDegrees(
    radial + (segment.sweepAngleDeg >= 0 ? 90 : -90)
  );
};

const pathEndpointDirections = <T>(
  segments: readonly T[],
  startDirection: (segment: T) => number | undefined,
  endDirection: (segment: T) => number | undefined
) => ({
  start: firstDirection(segments, startDirection),
  end: lastInteriorDirection(segments, endDirection)
});

const arcEndpointDirections = (geometry: {
  radius: number;
  center: { x: number; y: number };
  start: { x: number; y: number };
  end: { x: number; y: number };
  sweepAngleDeg: number;
}) => {
  if (Math.abs(geometry.radius) <= EPSILON || Math.abs(geometry.sweepAngleDeg) <= EPSILON) {
    return { start: undefined, end: undefined };
  }
  const offset = geometry.sweepAngleDeg >= 0 ? 90 : -90;
  const startRadial = directionAngle(geometry.center, geometry.start);
  const endRadial = directionAngle(geometry.center, geometry.end);
  return {
    start: startRadial === undefined ? undefined : normalizeDirectionDegrees(startRadial + offset),
    end: endRadial === undefined ? undefined : normalizeDirectionDegrees(endRadial + offset + 180)
  };
};

const computedPathEndpointPoints = (geometry: ComputedGeometry) => {
  if (geometry.kind === "line" || geometry.kind === "polyline") {
    return { start: geometry.start, end: geometry.end };
  }
  if (geometry.kind === "offsetLine") return { start: geometry.start, end: geometry.end };
  if (geometry.kind === "bezierCurve") {
    return { start: geometry.segments[0]?.start, end: geometry.segments.at(-1)?.end };
  }
  if (geometry.kind === "arcLine") return { start: geometry.start, end: geometry.end };
  return { start: undefined, end: undefined };
};

/** Canonical computed-geometry property accessor shared by numeric and typed scalar evaluation. */
export const computedReferencePathValue = (geometry: ComputedGeometry | undefined, property: string) => {
  if (!isKnownNumericComputedGeometryProperty(property) || !geometry) return undefined;

  if (geometry.kind === "point") {
    if (property === "x") return geometry.x;
    if (property === "y") return geometry.y;
    return undefined;
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
    return undefined;
  }

  if (geometry.kind === "text") {
    if (property === "anchorPoint.x") return geometry.anchor?.x;
    if (property === "anchorPoint.y") return geometry.anchor?.y;
    if (property === "fontSize") return geometry.fontSize;
    return undefined;
  }

  const endpoints = computedPathEndpointPoints(geometry);
  if (property === "startPoint.x") return endpoints.start?.x;
  if (property === "startPoint.y") return endpoints.start?.y;
  if (property === "endPoint.x") return endpoints.end?.x;
  if (property === "endPoint.y") return endpoints.end?.y;

  if (geometry.kind === "line") {
    const directions = {
      start: directionAngle(geometry.start, geometry.end),
      end: reverseDirection(directionAngle(geometry.start, geometry.end))
    };
    if (property === "length") return geometry.length;
    if (property === "startAngleDeg") return directions.start;
    if (property === "endAngleDeg") return directions.end;
    return undefined;
  }

  if (geometry.kind === "arcLine") {
    const directions = arcEndpointDirections(geometry);
    if (property === "length") return geometry.length;
    if (property === "radius") return geometry.radius;
    if (property === "sweepAngleDeg") return geometry.sweepAngleDeg;
    if (property === "startAngleDeg") return directions.start;
    if (property === "endAngleDeg") return directions.end;
    if (property === "startRadiusAngleDeg") return directionAngle(geometry.center, geometry.start);
    if (property === "endRadiusAngleDeg") return directionAngle(geometry.center, geometry.end);
    if (property === "centerPoint.x") return geometry.center.x;
    if (property === "centerPoint.y") return geometry.center.y;
    return undefined;
  }

  if (geometry.kind === "bezierCurve") {
    const directions = pathEndpointDirections(
      geometry.segments,
      bezierStartForwardDirection,
      bezierEndForwardDirection
    );
    const first = geometry.segments[0];
    const last = geometry.segments.at(-1);
    const intermediateMatch = property.match(/^intermediatePoints\[(\d+)\]\.(x|y)$/);
    if (property === "length") return geometry.length;
    if (property === "startAngleDeg") return directions.start;
    if (property === "endAngleDeg") return directions.end;
    if (property === "startHandleLength") {
      return first ? Math.hypot(first.control1.x - first.start.x, first.control1.y - first.start.y) : undefined;
    }
    if (property === "startHandleAngleDeg") {
      return first ? directionAngle(first.start, first.control1) : undefined;
    }
    if (property === "endHandleLength") {
      return last ? Math.hypot(last.end.x - last.control2.x, last.end.y - last.control2.y) : undefined;
    }
    if (property === "endHandleAngleDeg") {
      return last ? directionAngle(last.control2, last.end) : undefined;
    }
    if (intermediateMatch) {
      return geometry.segments[Number(intermediateMatch[1]) - 1]?.end[intermediateMatch[2] as "x" | "y"];
    }
    return undefined;
  }

  if (geometry.kind === "offsetLine") {
    const directions = pathEndpointDirections(
      geometry.segments,
      offsetSegmentStartDirection,
      offsetSegmentEndForwardDirection
    );
    if (property === "length") return geometry.length;
    if (property === "startAngleDeg") return directions.start;
    if (property === "endAngleDeg") return directions.end;
    return undefined;
  }

  const directions = pathEndpointDirections(
    geometry.segments,
    (segment) => directionAngle(segment.start, segment.end),
    (segment) => directionAngle(segment.start, segment.end)
  );
  if (property === "length") return geometry.length;
  if (property === "startAngleDeg") return directions.start;
  if (property === "endAngleDeg") return directions.end;
  return undefined;
};

export const numericComputedGeometryPropertiesFor = (
  geometry: ComputedGeometry | undefined,
  staticTarget?: NumericGeometryStaticTarget | null
): readonly NumericComputedGeometryProperty[] =>
  numericGeometryPropertiesForStaticTarget(
    staticTarget === undefined ? numericGeometryStaticTargetForComputedGeometry(geometry) : staticTarget
  );

export const numericComputedGeometrySupportsProperty = (
  geometry: ComputedGeometry | undefined,
  property: unknown,
  staticTarget?: NumericGeometryStaticTarget | null
): property is NumericComputedGeometryProperty =>
  isNumericComputedGeometryProperty(property) &&
  numericGeometryPropertySupportedByStaticTarget(
    staticTarget === undefined ? numericGeometryStaticTargetForComputedGeometry(geometry) : staticTarget,
    property
  );

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
  currentElement,
  elements
}: {
  value: NumericValue;
  computedGeometry: Map<ElementId, ComputedGeometry>;
  elementsById: Map<ElementId, CadElement>;
  localVariables?: Map<string, number>;
  localVariableNames?: Map<string, string>;
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
    // elementId is ambiguous by construction: it may be a plain (possibly
    // forGroup-generated) element id, || a derived-point reference
    // "<elementId>:<pointKey>" built by pointAnchorExpression - && a
    // forGroup-generated id itself contains a colon
    // ("<templateId>@<forGroupId>:<index>"), so a naive first-colon split
    // mistakes the generated id's own colon for the derived-point-key
    // separator. Trying a direct, whole-id computedGeometry lookup first -
    // rather than guessing from the string shape - sidesteps the ambiguity:
    // a complete generated id (with no derived-point suffix) is always a
    // hit here, since forGroup expansion stores geometry under exactly that
    // key. Only when the direct lookup misses does this fall back to
    // treating the text after the *last* colon as a derived-point key.
    const pointValue = (elementId: ElementId): ComputedPoint => {
      const direct = computedGeometry.get(elementId);
      if (direct) {
        if (direct.kind !== "point") throw dependencyError(elementId);
        return direct;
      }
      const separatorIndex = elementId.lastIndexOf(":");
      if (separatorIndex < 0) throw dependencyError(elementId);
      const sourceId = elementId.slice(0, separatorIndex);
      const pointKey = elementId.slice(separatorIndex + 1);
      const geometry = computedGeometry.get(sourceId);
      const point = resolveDerivedPoint(geometry, pointKey, elementsById);
      if (!point) throw dependencyError(sourceId);
      return point;
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

      const sourceElement = elementsById.get(reference.elementId);
      if (
        sourceElement &&
        elements &&
        !numericGeometryPropertySupportedByStaticTarget(
          numericGeometryStaticTargetForElementInDocument(sourceElement, elements),
          reference.property
        )
      ) {
        throw Object.assign(
          new Error(`${sourceElement.name || reference.elementId}.${reference.property} はこのgeometry targetでは公開されていません。`),
          { dependencyId: reference.elementId, dependencyName: sourceElement.name }
        );
      }

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
  currentElement?: CadElement;
  elements?: CadElement[];
};

/** Exported for Task 27's textTemplateRuntime.ts, which reuses this exact
 * formatting for typed number holes && re-injects it for legacy holes -
 * keep both paths on one formatting rule. */
export const textNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(3).replace(/\.?0+$/, "");

export const resolveTextReferences = ({
  text,
  computedGeometry,
  elementsById,
  localVariables,
  localVariableNames,
  currentElement,
  elements
}: ResolveTextReferencesArgs): { text?: string; error?: NumericExpressionError } => {
  let firstError: NumericExpressionError | undefined;
  const evaluateInlineExpression = (expression: string) => {
    const normalizedExpression = normalizeNumericExpressionInput(
      expression,
      elements ?? Array.from(elementsById.values()),
      currentElement
    );
    const result = evaluateNumericValue({
      value: { kind: "expression", expression: normalizedExpression },
      computedGeometry,
      elementsById,
      localVariables,
      localVariableNames,
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
