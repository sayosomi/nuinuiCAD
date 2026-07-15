import type { CadElement } from "../types/geometry";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { DslSpan, DslStatement } from "./dslTypes";
import {
  dslLineElementStatement,
  dslLineLabeledValueSpans,
  type DslLabeledValueSpan
} from "./dslValueSpans";
import { nonEmptyDslSpans, splitDslTopLevelSpans, trimDslSpan } from "./dslParameterSpanScanner";
import { unquoteDslString } from "./dslTokens";

/** A parameter target may additionally be an element name, which is deliberately
 * excluded from the click/Tab value-span API. */
export type DslParameterValueSpan = DslSpan & {
  source: "name" | "payload" | "attr";
  key: string;
  parameterKey: string;
};

export type DslParameterSpanContext = {
  /** Last committed text for this statement, used only to prove dirty intermediate identity. */
  committedLineText?: string;
};

const hasText = (span: DslSpan) => span.start < span.end;

const sameSpanText = (leftSource: string, left: DslSpan | undefined, rightSource: string, right: DslSpan | undefined) =>
  left === undefined || right === undefined
    ? left === right
    : leftSource.slice(left.start, left.end) === rightSource.slice(right.start, right.end);

/** Exported for reuse by @variable completion (dslCompletionContext.ts) which needs
 * the same coordinate-literal x/y sub-span detection directly against live text. */
export const coordinateComponent = (source: string, span: DslSpan, component: "x" | "y") => {
  if (source[span.start] !== "(" || source[span.end - 1] !== ")") return null;
  const parts = splitDslTopLevelSpans(source, { start: span.start + 1, end: span.end - 1 }, ",");
  const target = parts[component === "x" ? 0 : 1];
  return parts.length === 2 && target && hasText(target) ? target : null;
};

/** Exported for reuse by @variable completion, which needs the same live
 * `vars=[name:expr;...]` record splitting to locate the cursor's own record. */
export const recordSpans = (source: string, span: DslSpan) => {
  if (source[span.start] !== "[" || source[span.end - 1] !== "]") return null;
  return nonEmptyDslSpans(splitDslTopLevelSpans(source, { start: span.start + 1, end: span.end - 1 }, ";"));
};

export const recordFields = (source: string, record: DslSpan) => splitDslTopLevelSpans(source, record, ":");

/** Exported for reuse by @variable completion: a single trimmed field span, for
 * records with more than 2 fields (e.g. `intermediates=`'s
 * `point:angle:incoming:outgoing:id`) where recordRemainder's "rest of record"
 * would wrongly span multiple fields together. */
export const recordField = (source: string, record: DslSpan, fieldIndex: number): DslSpan | null => {
  const field = recordFields(source, record)[fieldIndex];
  if (!field) return null;
  const trimmed = trimDslSpan(source, field);
  return hasText(trimmed) ? trimmed : null;
};

export const recordRemainder = (source: string, record: DslSpan, fieldIndex: number) => {
  const field = recordFields(source, record)[fieldIndex];
  if (!field) return null;
  const remainder = trimDslSpan(source, { start: field.start, end: record.end });
  return hasText(remainder) ? remainder : null;
};

const withParameter = (span: DslSpan, source: DslParameterValueSpan["source"], key: string, parameterKey: string): DslParameterValueSpan => ({
  ...span,
  source,
  key,
  parameterKey
});

const labeledByKey = (spans: readonly DslLabeledValueSpan[], key: string) => {
  const matches = spans.filter((span) => span.key === key);
  return matches.length === 1 ? matches[0] : null;
};

const labeledByExclusiveKeys = (
  spans: readonly DslLabeledValueSpan[],
  activeKey: "distance" | "ratio"
) => {
  const distance = spans.filter((span) => span.key === "distance");
  const ratio = spans.filter((span) => span.key === "ratio");
  if (distance.length === 1 && ratio.length === 0) return activeKey === "distance" ? distance[0] : null;
  if (ratio.length === 1 && distance.length === 0) return activeKey === "ratio" ? ratio[0] : null;
  return null;
};

const exclusiveModeParameterSpan = (
  spans: readonly DslLabeledValueSpan[],
  parameterKey: string
) => {
  if (parameterKey !== "distance" && parameterKey !== "ratio") return null;
  const span = labeledByExclusiveKeys(spans, parameterKey);
  return span ? withParameter(span, span.source, span.key, parameterKey) : null;
};

const pointAnchorSpan = (lineText: string, parameterKey: string, key: string) => {
  const parent = labeledByKey(dslLineLabeledValueSpans(lineText), key);
  if (!parent) return null;
  const coordinate = parameterKey.match(/:(x|y)$/)?.[1] as "x" | "y" | undefined;
  const span = coordinate ? coordinateComponent(lineText, parent, coordinate) : parent;
  return span ? withParameter(span, parent.source, parent.key, parameterKey) : null;
};

const commonDslKey = (parameterKey: string) => ({ colorId: "color", visible: "visible", enabled: "enabled", locked: "locked" }[parameterKey]);

const statementElementType = (statement: DslStatement): CadElement["type"] | null => {
  if (statement.kind === "element") return statement.type;
  return statement.kind as CadElement["type"];
};

const resolveVariableValueSpan = (
  lineText: string,
  element: CadElement,
  parameterKey: string,
  spans: readonly DslLabeledValueSpan[]
) => {
  const variable = element.numericVariables?.find((item) => parameterKey === `variable:${item.id}:value`);
  const outer = labeledByKey(spans, "vars");
  if (!variable || !outer) return null;
  const variables = element.numericVariables ?? [];
  if (variables.filter((item) => item.name === variable.name).length !== 1) return null;
  const records = recordSpans(lineText, outer);
  if (!records) return null;
  const matching = records.filter((record) => {
    const name = recordFields(lineText, record)[0];
    return name && hasText(name) && unquoteDslString(lineText.slice(name.start, name.end)) === variable.name;
  });
  if (matching.length !== 1) return null;
  const matchingNames = records.map((record) => recordFields(lineText, record)[0]).filter((span): span is DslSpan => Boolean(span && hasText(span)))
    .map((span) => unquoteDslString(lineText.slice(span.start, span.end)));
  if (matchingNames.filter((name) => name === variable.name).length !== 1) return null;
  const span = recordRemainder(lineText, matching[0], 1);
  return span ? withParameter(span, outer.source, outer.key, parameterKey) : null;
};

const intermediateFieldIndex = (field: string) =>
  ({ point: 0, handleAngleDeg: 1, incomingHandleLength: 2, outgoingHandleLength: 3 }[field]);

const resolveIntermediateValueSpan = (
  lineText: string,
  element: Extract<CadElement, { type: "bezierCurve" }>,
  parameterKey: string,
  spans: readonly DslLabeledValueSpan[],
  context: DslParameterSpanContext
) => {
  const [, id, field] = parameterKey.split(":");
  const expectedIndex = element.intermediatePoints.findIndex((item) => item.id === id);
  const fieldIndex = intermediateFieldIndex(field);
  const outer = labeledByKey(spans, "intermediates");
  if (expectedIndex < 0 || fieldIndex === undefined || !outer) return null;
  const liveRecords = recordSpans(lineText, outer);
  if (!liveRecords) return null;

  const explicitMatches = liveRecords.filter((record) => {
    const recordId = recordFields(lineText, record)[4];
    return recordId && hasText(recordId) && lineText.slice(recordId.start, recordId.end) === id;
  });
  let record = explicitMatches.length === 1 ? explicitMatches[0] : null;

  if (!record) {
    const committedLineText = context.committedLineText;
    if (!committedLineText) return null;
    const committedOuter = labeledByKey(dslLineLabeledValueSpans(committedLineText), "intermediates");
    const committedRecords = committedOuter ? recordSpans(committedLineText, committedOuter) : null;
    const committedRecord = committedRecords?.[expectedIndex];
    if (!committedRecords || committedRecords.length !== element.intermediatePoints.length || !committedRecord) return null;
    const committedFields = recordFields(committedLineText, committedRecord);
    const sameFingerprint = (candidateSource: string, candidate: DslSpan) => {
      const candidateFields = recordFields(candidateSource, candidate);
      return [0, 1, 2, 3, 4].every((index) =>
        index === fieldIndex || sameSpanText(committedLineText, committedFields[index], candidateSource, candidateFields[index])
      );
    };
    if (committedRecords.filter((candidate) => sameFingerprint(committedLineText, candidate)).length !== 1) return null;
    const matches = liveRecords.filter((candidate) => {
      return sameFingerprint(lineText, candidate);
    });
    if (matches.length !== 1) return null;
    record = matches[0];
  }

  const base = recordFields(lineText, record)[fieldIndex];
  if (!base || !hasText(base)) return null;
  const coordinate = parameterKey.match(/:(x|y)$/)?.[1] as "x" | "y" | undefined;
  const span = coordinate ? coordinateComponent(lineText, base, coordinate) : base;
  return span ? withParameter(span, outer.source, outer.key, parameterKey) : null;
};

/** Resolves a parameter against the current live line. It never serializes or changes text. */
export const resolveParameterValueSpan = (
  lineText: string,
  element: CadElement,
  parameterKey: string,
  context: DslParameterSpanContext = {}
): DslParameterValueSpan | null => {
  const statement = dslLineElementStatement(lineText);
  if (!statement || statementElementType(statement) !== element.type) return null;
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
    // Dynamic records belong to the committed element, not merely to any live
    // statement of the same type at the old line. A renamed/replaced statement
    // cannot prove that relationship, so it must not inherit this element's IDs.
    if (statement.name !== element.name) return null;
    return resolveVariableValueSpan(lineText, element, parameterKey, spans);
  }
  if (element.type === "bezierCurve" && parameterKey.startsWith("intermediate:")) {
    if (statement.name !== element.name) return null;
    return resolveIntermediateValueSpan(lineText, element, parameterKey, spans, context);
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
    case "divisionPoint": {
      return parameterKey.startsWith("startPoint") ? anchor("startPoint") : parameterKey.startsWith("endPoint") ? anchor("endPoint") :
        parameterKey === "placementMode" ? null : exclusiveModeParameterSpan(spans, parameterKey);
    }
    case "lineDivisionPoint": {
      return parameterKey === "endpoint" ? payloadOrAttr("endpoint") : parameterKey === "placementMode" ? null :
        exclusiveModeParameterSpan(spans, parameterKey);
    }
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

/** Resolves a caret or selection to the most specific proven parameter span. */
export const resolveParameterTargetAt = (
  lineText: string,
  element: CadElement,
  selection: DslSpan,
  context: DslParameterSpanContext = {}
) => {
  const definitions = getParameterDefinitions(element);
  const parameterKeys = new Set(definitions.map((definition) => definition.key));
  for (const definition of definitions) {
    if (/:(x|y)$/.test(definition.key)) continue;
    for (const component of ["x", "y"] as const) {
      const childKey = `${definition.key}:${component}`;
      if (resolveParameterValueSpan(lineText, element, childKey, context)) parameterKeys.add(childKey);
    }
  }
  const targets = [...parameterKeys].flatMap((parameterKey) => {
    const target = resolveParameterValueSpan(lineText, element, parameterKey, context);
    return target ? [target] : [];
  });
  const exact = targets.filter((target) => target.start === selection.start && target.end === selection.end);
  const collapsed = selection.start === selection.end;
  const containing = collapsed
    ? targets.filter((target) => target.start <= selection.start && selection.start < target.end)
    : targets.filter((target) => target.start <= selection.start && selection.end <= target.end);
  // A caret immediately after a value is a useful editing position, but it must
  // never steal precedence from another target that normally contains that same
  // position (for example, at a following value's start).
  const terminal = collapsed && containing.length === 0
    ? targets.filter((target) => target.end === selection.start)
    : [];
  const candidates = exact.length > 0 ? exact : containing.length > 0 ? containing : terminal;
  if (candidates.length === 0) return null;
  const shortestLength = Math.min(...candidates.map((target) => target.end - target.start));
  const mostSpecific = candidates.filter((target) => target.end - target.start === shortestLength);
  return mostSpecific.length === 1 ? mostSpecific[0] : null;
};

/** Backwards-compatible reverse lookup for future editor-native commands. */
export const resolveParameterKeyForValueSpan = (
  lineText: string,
  element: CadElement,
  span: DslSpan,
  context: DslParameterSpanContext = {}
) => resolveParameterTargetAt(lineText, element, span, context)?.parameterKey ?? null;
