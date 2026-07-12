import type { CadElement } from "../types/geometry";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { DslSpan } from "./dslTypes";
import {
  dslLineElementStatement,
  dslLineLabeledValueSpans,
  type DslLabeledValueSpan
} from "./dslValueSpans";

/** A parameter target may additionally be an element name, which is deliberately
 * excluded from the click/Tab value-span API. */
export type DslParameterValueSpan = DslSpan & {
  source: "name" | "payload" | "attr";
  key: string;
  parameterKey: string;
};

const trimSpan = (source: string, span: DslSpan): DslSpan | null => {
  let { start, end } = span;
  while (start < end && /\s/.test(source[start])) start += 1;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  return start < end ? { start, end } : null;
};

const splitTopLevel = (source: string, span: DslSpan, separator: string): DslSpan[] => {
  const parts: DslSpan[] = [];
  let start = span.start;
  let quote: string | null = null;
  let depth = 0;
  for (let index = span.start; index < span.end; index += 1) {
    const char = source[index];
    if ((char === "\"" || char === "'") && source[index - 1] !== "\\") quote = quote === char ? null : quote ?? char;
    else if (!quote && (char === "(" || char === "[" || char === "{")) depth += 1;
    else if (!quote && (char === ")" || char === "]" || char === "}")) depth -= 1;
    else if (!quote && depth === 0 && char === separator) {
      const part = trimSpan(source, { start, end: index });
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  const finalPart = trimSpan(source, { start, end: span.end });
  if (finalPart) parts.push(finalPart);
  return parts;
};

const coordinateComponent = (source: string, span: DslSpan, component: "x" | "y") => {
  if (source[span.start] !== "(" || source[span.end - 1] !== ")") return null;
  const parts = splitTopLevel(source, { start: span.start + 1, end: span.end - 1 }, ",");
  return parts.length === 2 ? parts[component === "x" ? 0 : 1] : null;
};

const recordField = (
  source: string,
  span: DslSpan,
  recordIndex: number,
  fieldIndex: number,
  remainder = false
) => {
  if (source[span.start] !== "[" || source[span.end - 1] !== "]") return null;
  const record = splitTopLevel(source, { start: span.start + 1, end: span.end - 1 }, ";")[recordIndex];
  if (!record) return null;
  const fields = splitTopLevel(source, record, ":");
  if (remainder) {
    const field = fields[fieldIndex];
    return field ? { start: field.start, end: record.end } : null;
  }
  return fields[fieldIndex] ?? null;
};

const withParameter = (span: DslSpan, source: DslParameterValueSpan["source"], key: string, parameterKey: string): DslParameterValueSpan => ({
  ...span,
  source,
  key,
  parameterKey
});

const labeledByKey = (spans: readonly DslLabeledValueSpan[], key: string) =>
  spans.find((span) => span.key === key) ?? null;

const pointAnchorSpan = (lineText: string, parameterKey: string, key: string) => {
  const parent = labeledByKey(dslLineLabeledValueSpans(lineText), key);
  if (!parent) return null;
  const coordinate = parameterKey.match(/:(x|y)$/)?.[1] as "x" | "y" | undefined;
  const span = coordinate ? coordinateComponent(lineText, parent, coordinate) : parent;
  return span ? withParameter(span, parent.source, parent.key, parameterKey) : null;
};

const commonDslKey = (parameterKey: string) => ({ colorId: "color", visible: "visible", enabled: "enabled", locked: "locked" }[parameterKey]);

/** Resolves a parameter against the current live line. It never serializes or changes text. */
export const resolveParameterValueSpan = (
  lineText: string,
  element: CadElement,
  parameterKey: string
): DslParameterValueSpan | null => {
  const statement = dslLineElementStatement(lineText);
  if (!statement) return null;
  if (parameterKey === "name") {
    return statement.nameSpan ? withParameter(statement.nameSpan, "name", "name", parameterKey) : null;
  }
  const common = commonDslKey(parameterKey);
  const spans = dslLineLabeledValueSpans(lineText);
  if (common) {
    const span = labeledByKey(spans, common);
    return span ? withParameter(span, span.source, span.key, parameterKey) : null;
  }
  if (parameterKey.startsWith("variable:")) {
    const index = element.numericVariables?.findIndex((item) => parameterKey === `variable:${item.id}:value`) ?? -1;
    const outer = labeledByKey(spans, "vars");
    const span = index >= 0 && outer ? recordField(lineText, outer, index, 1, true) : null;
    return span && outer ? withParameter(span, outer.source, outer.key, parameterKey) : null;
  }
  if (element.type === "bezierCurve" && parameterKey.startsWith("intermediate:")) {
    const [, id, field] = parameterKey.split(":");
    const index = element.intermediatePoints.findIndex((item) => item.id === id);
    const outer = labeledByKey(spans, "intermediates");
    const fieldIndex = { point: 0, handleAngleDeg: 1, incomingHandleLength: 2, outgoingHandleLength: 3 }[field];
    const base = index >= 0 && outer && fieldIndex !== undefined ? recordField(lineText, outer, index, fieldIndex) : null;
    const coordinate = parameterKey.match(/:(x|y)$/)?.[1] as "x" | "y" | undefined;
    const span = base && coordinate ? coordinateComponent(lineText, base, coordinate) : base;
    return span && outer ? withParameter(span, outer.source, outer.key, parameterKey) : null;
  }

  const payloadOrAttr = (key: string) => {
    const span = labeledByKey(spans, key);
    return span ? withParameter(span, span.source, span.key, parameterKey) : null;
  };
  const anchor = (key: string) => pointAnchorSpan(lineText, parameterKey, key);

  switch (element.type) {
    case "group": return parameterKey === "printEnabled" ? payloadOrAttr("printEnabled") : parameterKey.startsWith("printAnchor") ? anchor("printAnchor") : null;
    case "conditionalGroup": return parameterKey === "condition" ? payloadOrAttr("condition") : null;
    case "forGroup": return ["variableName", "start", "count", "step", "showGenerated"].includes(parameterKey) ? payloadOrAttr(parameterKey) : null;
    case "variable": return parameterKey === "expression" ? payloadOrAttr("expression") : parameterKey === "scope" ? payloadOrAttr("scope") : null;
    case "text": return parameterKey === "text" ? payloadOrAttr("text") : parameterKey.startsWith("anchor") ? anchor("at") : parameterKey === "fontSize" ? payloadOrAttr("size") : null;
    case "freePoint": return parameterKey === "x" || parameterKey === "y" ? payloadOrAttr(parameterKey) : null;
    case "offsetPoint": return parameterKey === "fromPoint" ? payloadOrAttr("from") : ["dx", "dy"].includes(parameterKey) ? payloadOrAttr(parameterKey) : null;
    case "polarOffsetPoint": return parameterKey === "fromPoint" ? payloadOrAttr("from") : parameterKey === "angleDeg" ? payloadOrAttr("angle") : parameterKey === "distance" ? payloadOrAttr("distance") : null;
    case "divisionPoint": return parameterKey.startsWith("startPoint") ? anchor("startPoint") : parameterKey.startsWith("endPoint") ? anchor("endPoint") : parameterKey === "placementMode" ? null : parameterKey === element.placementMode ? payloadOrAttr(parameterKey) : null;
    case "lineDivisionPoint": return parameterKey === "endpoint" ? payloadOrAttr("endpoint") : parameterKey === "placementMode" ? null : parameterKey === element.placementMode ? payloadOrAttr(parameterKey) : null;
    case "intersectionPoint": return ["line1Id", "line2Id"].includes(parameterKey) ? payloadOrAttr(parameterKey) : parameterKey === "intersectionIndex" ? payloadOrAttr("index") : parameterKey === "useExtensions" ? payloadOrAttr("extensions") : null;
    case "lineTangentOffsetPoint": return parameterKey === "baseLineId" ? payloadOrAttr("baseLineId") : parameterKey.startsWith("basePoint") ? anchor("basePoint") : parameterKey === "tangentAngleDeg" ? payloadOrAttr("angle") : parameterKey === "distance" ? payloadOrAttr("distance") : null;
    case "splitLine": return parameterKey === "baseLineId" ? payloadOrAttr("baseLineId") : parameterKey.startsWith("splitPoint") ? anchor("splitPoint") : null;
    case "line": return parameterKey.startsWith("startPoint") ? anchor("start") : parameterKey.startsWith("endPoint") ? anchor("end") : null;
    case "angleLengthLine": return parameterKey.startsWith("startPoint") ? anchor("start") : parameterKey === "angleDeg" ? payloadOrAttr("angle") : parameterKey === "length" ? payloadOrAttr("length") : null;
    case "arcLine": return parameterKey.startsWith("centerPoint") ? anchor("center") : parameterKey === "radius" ? payloadOrAttr("radius") : parameterKey === "startAngleDeg" ? payloadOrAttr("start") : parameterKey === "endAngleDeg" ? payloadOrAttr("end") : null;
    case "threePointArcLine": return ["point1", "point2", "point3"].some((key) => parameterKey.startsWith(key)) ? anchor(parameterKey.split(":")[0]) : parameterKey === "startAngleDeg" ? payloadOrAttr("start") : parameterKey === "endAngleDeg" ? payloadOrAttr("end") : null;
    case "cornerRadiusArcLine": return ["endpoint1", "endpoint2", "radius"].includes(parameterKey) ? payloadOrAttr(parameterKey) : parameterKey === "intersectionIndex" ? payloadOrAttr("index") : null;
    case "edge": return ["endpoint1", "endpoint2", "intersectionIndex"].includes(parameterKey) ? payloadOrAttr(parameterKey) : null;
    case "extendTrim": return parameterKey === "endpoint" ? payloadOrAttr("endpoint") : parameterKey.startsWith("point") ? anchor("point") : null;
    case "bezierCurve": return parameterKey.startsWith("startPoint") ? anchor("startPoint") : parameterKey.startsWith("endPoint") ? anchor("endPoint") : ({ startHandleAngleDeg: "startAngle", startHandleLength: "startLength", endHandleAngleDeg: "endAngle", endHandleLength: "endLength" }[parameterKey] ? payloadOrAttr(({ startHandleAngleDeg: "startAngle", startHandleLength: "startLength", endHandleAngleDeg: "endAngle", endHandleLength: "endLength" } as Record<string, string>)[parameterKey]) : null);
    case "offsetLine": return parameterKey === "baseLineIds" ? payloadOrAttr("baseLineIds") : parameterKey === "offset" ? payloadOrAttr("offset") : ["side", "closed", "suppressTrimWarnings"].includes(parameterKey) ? payloadOrAttr(parameterKey) : null;
    case "copyLine":
    case "move": return parameterKey.startsWith("startPoint") ? anchor("startPoint") : parameterKey.startsWith("endPoint") ? anchor("endPoint") : ["scale", "angleDeg", "mirrorX", "baseLineIds"].includes(parameterKey) ? payloadOrAttr(parameterKey) : null;
    case "symmetricCopyLine":
    case "symmetricMove": return parameterKey.startsWith("axisPoint1") ? anchor("axisPoint1") : parameterKey.startsWith("axisPoint2") ? anchor("axisPoint2") : parameterKey === "baseLineIds" ? payloadOrAttr("baseLineIds") : null;
    case "image": return parameterKey.startsWith("originPoint") ? anchor("originPoint") : ["scale", "angleDeg", "mirrorX"].includes(parameterKey) ? payloadOrAttr(parameterKey) : null;
  }
};

/** Reverse lookup for future editor-native commands. Exact range equality avoids guessing. */
export const resolveParameterKeyForValueSpan = (lineText: string, element: CadElement, span: DslSpan) => {
  const definitions = getParameterDefinitions(element);
  return definitions.find((definition) => {
    const target = resolveParameterValueSpan(lineText, element, definition.key);
    return target?.start === span.start && target.end === span.end;
  })?.key ?? null;
};
