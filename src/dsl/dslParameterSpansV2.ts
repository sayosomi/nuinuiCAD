import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { CadElement } from "../types/geometry";
import { argNameForParameter } from "./dslConstructions";
import { parseDslCallStatement, type DslCallStatement } from "./dslCallParser";
import { nonEmptyDslSpans, splitDslTopLevelSpans, trimDslSpan } from "./dslParameterSpanScanner";
import type { DslSpan } from "./dslTypes";
import { unquoteDslString } from "./dslTokens";

/**
 * v2 replacement for `dslParameterSpans.ts`'s `DslParameterValueSpan`. The
 * v1 grammar distinguished `source: "attr" | "payload"`; v2 unifies all
 * arguments into `key: value` calls, so there is only one non-name source.
 */
export type DslParameterValueSpanV2 = DslSpan & {
  source: "name" | "arg";
  key: string;
  parameterKey: string;
};

export type DslParameterSpanContextV2 = {
  /** Last committed text for this statement, used only to prove dirty intermediate identity. */
  committedLineText?: string;
};

const hasText = (span: DslSpan) => span.start < span.end;

const sameSpanText = (leftSource: string, left: DslSpan | undefined, rightSource: string, right: DslSpan | undefined) =>
  left === undefined || right === undefined
    ? left === right
    : leftSource.slice(left.start, left.end) === rightSource.slice(right.start, right.end);

const withParameter = (span: DslSpan, source: DslParameterValueSpanV2["source"], key: string, parameterKey: string): DslParameterValueSpanV2 => ({
  ...span,
  source,
  key,
  parameterKey
});

/** `(x, y)` literal decomposition, shared by top-level anchors and intermediate points. */
const coordinateComponent = (source: string, span: DslSpan, component: "x" | "y") => {
  if (source[span.start] !== "(" || source[span.end - 1] !== ")") return null;
  const parts = splitDslTopLevelSpans(source, { start: span.start + 1, end: span.end - 1 }, ",");
  const target = parts[component === "x" ? 0 : 1];
  return parts.length === 2 && target && hasText(target) ? target : null;
};

const recordSpans = (source: string, span: DslSpan) => {
  if (source[span.start] !== "[" || source[span.end - 1] !== "]") return null;
  return nonEmptyDslSpans(splitDslTopLevelSpans(source, { start: span.start + 1, end: span.end - 1 }, ";"));
};

const recordFields = (source: string, record: DslSpan) => splitDslTopLevelSpans(source, record, ":");

const recordRemainder = (source: string, record: DslSpan, fieldIndex: number) => {
  const field = recordFields(source, record)[fieldIndex];
  if (!field) return null;
  const remainder = trimDslSpan(source, { start: field.start, end: record.end });
  return hasText(remainder) ? remainder : null;
};

const coordinateSuffix = (parameterKey: string) => parameterKey.match(/^(.+):(x|y)$/);

const withOptionalCoordinate = (
  source: string,
  span: DslSpan,
  parameterKey: string,
  argKey: string
): DslParameterValueSpanV2 | null => {
  const suffix = coordinateSuffix(parameterKey);
  if (!suffix) return withParameter(span, "arg", argKey, parameterKey);
  const component = coordinateComponent(source, span, suffix[2] as "x" | "y");
  return component ? withParameter(component, "arg", argKey, parameterKey) : null;
};

const resolveVariableValueSpan = (
  text: string,
  element: CadElement,
  parameterKey: string,
  statement: DslCallStatement
): DslParameterValueSpanV2 | null => {
  const variable = element.numericVariables?.find((item) => parameterKey === `variable:${item.id}:value`);
  const outer = statement.payloadSpans.vars;
  if (!variable || !outer) return null;
  const variables = element.numericVariables ?? [];
  if (variables.filter((item) => item.name === variable.name).length !== 1) return null;
  const records = recordSpans(text, outer);
  if (!records) return null;
  const matchingNames = records
    .map((record) => recordFields(text, record)[0])
    .filter((span): span is DslSpan => Boolean(span && hasText(span)))
    .map((span) => unquoteDslString(text.slice(span.start, span.end)));
  if (matchingNames.filter((name) => name === variable.name).length !== 1) return null;
  const matchIndex = matchingNames.findIndex((name) => name === variable.name);
  const span = recordRemainder(text, records[matchIndex], 1);
  return span ? withParameter(span, "arg", "vars", parameterKey) : null;
};

const intermediateFieldIndex = (field: string) =>
  ({ point: 0, handleAngleDeg: 1, incomingHandleLength: 2, outgoingHandleLength: 3 }[field]);

const resolveIntermediateValueSpan = (
  text: string,
  element: Extract<CadElement, { type: "bezierCurve" }>,
  parameterKey: string,
  statement: DslCallStatement,
  context: DslParameterSpanContextV2
): DslParameterValueSpanV2 | null => {
  const [, id, field] = parameterKey.split(":");
  const expectedIndex = element.intermediatePoints.findIndex((item) => item.id === id);
  const fieldIndex = intermediateFieldIndex(field);
  const outer = statement.payloadSpans.intermediates;
  if (expectedIndex < 0 || fieldIndex === undefined || !outer) return null;
  const liveRecords = recordSpans(text, outer);
  if (!liveRecords) return null;

  const explicitMatches = liveRecords.filter((record) => {
    const recordId = recordFields(text, record)[4];
    return recordId && hasText(recordId) && text.slice(recordId.start, recordId.end) === id;
  });
  let record = explicitMatches.length === 1 ? explicitMatches[0] : null;

  if (!record) {
    const committedLineText = context.committedLineText;
    if (!committedLineText) return null;
    const committedStatement = parseDslCallStatement(committedLineText, { opensBlock: false }).statement;
    const committedOuter = committedStatement?.payloadSpans.intermediates;
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
    const matches = liveRecords.filter((candidate) => sameFingerprint(text, candidate));
    if (matches.length !== 1) return null;
    record = matches[0];
  }

  const base = recordFields(text, record)[fieldIndex];
  if (!base || !hasText(base)) return null;
  const coordinate = parameterKey.match(/:(x|y)$/)?.[1] as "x" | "y" | undefined;
  const span = coordinate ? coordinateComponent(text, base, coordinate) : base;
  return span ? withParameter(span, "arg", "intermediates", parameterKey) : null;
};

const isExclusivePlacementKey = (element: CadElement, parameterKey: string): parameterKey is "distance" | "ratio" =>
  (element.type === "divisionPoint" || element.type === "lineDivisionPoint") &&
  (parameterKey === "distance" || parameterKey === "ratio");

/**
 * Resolves a parameter against the current live logical text (already
 * row-joined by the projection layer). Never serializes or changes text.
 */
export const resolveParameterValueSpanV2 = (
  logicalText: string,
  element: CadElement,
  parameterKey: string,
  context: DslParameterSpanContextV2 = {}
): DslParameterValueSpanV2 | null => {
  const parsed = parseDslCallStatement(logicalText, { opensBlock: element.type === "group" || element.type === "conditionalGroup" || element.type === "forGroup" });
  const statement = parsed.statement;
  if (!statement || statement.elementType !== element.type) return null;

  if (parameterKey === "name") {
    return statement.nameSpan ? withParameter(statement.nameSpan, "name", "name", parameterKey) : null;
  }
  if (parameterKey === "placementMode") return null;
  if (isExclusivePlacementKey(element, parameterKey)) {
    if ((element as { placementMode?: string }).placementMode !== parameterKey) return null;
  }
  if (parameterKey.startsWith("variable:")) {
    if (statement.name !== element.name) return null;
    return resolveVariableValueSpan(logicalText, element, parameterKey, statement);
  }
  if (element.type === "bezierCurve" && parameterKey.startsWith("intermediate:")) {
    if (statement.name !== element.name) return null;
    return resolveIntermediateValueSpan(logicalText, element, parameterKey, statement, context);
  }

  const suffix = coordinateSuffix(parameterKey);
  const baseKey = suffix ? suffix[1] : parameterKey;
  const argName = argNameForParameter(element.type, baseKey);
  if (!argName) return null;
  const span = statement.payloadSpans[argName];
  if (!span) return null;
  return withOptionalCoordinate(logicalText, span, parameterKey, argName);
};

/** Resolves a caret or selection to the most specific proven parameter span. */
export const resolveParameterTargetAtV2 = (
  logicalText: string,
  element: CadElement,
  selection: DslSpan,
  context: DslParameterSpanContextV2 = {}
): DslParameterValueSpanV2 | null => {
  const definitions = getParameterDefinitions(element);
  const parameterKeys = new Set(definitions.map((definition) => definition.key));
  for (const definition of definitions) {
    if (/:(x|y)$/.test(definition.key)) continue;
    for (const component of ["x", "y"] as const) {
      const childKey = `${definition.key}:${component}`;
      if (resolveParameterValueSpanV2(logicalText, element, childKey, context)) parameterKeys.add(childKey);
    }
  }
  const targets = [...parameterKeys].flatMap((parameterKey) => {
    const target = resolveParameterValueSpanV2(logicalText, element, parameterKey, context);
    return target ? [target] : [];
  });
  const exact = targets.filter((target) => target.start === selection.start && target.end === selection.end);
  const collapsed = selection.start === selection.end;
  const containing = collapsed
    ? targets.filter((target) => target.start <= selection.start && selection.start < target.end)
    : targets.filter((target) => target.start <= selection.start && selection.end <= target.end);
  const terminal = collapsed && containing.length === 0
    ? targets.filter((target) => target.end === selection.start)
    : [];
  const candidates = exact.length > 0 ? exact : containing.length > 0 ? containing : terminal;
  if (candidates.length === 0) return null;
  const shortestLength = Math.min(...candidates.map((target) => target.end - target.start));
  const mostSpecific = candidates.filter((target) => target.end - target.start === shortestLength);
  return mostSpecific.length === 1 ? mostSpecific[0] : null;
};

export const resolveParameterKeyForValueSpanV2 = (
  logicalText: string,
  element: CadElement,
  span: DslSpan,
  context: DslParameterSpanContextV2 = {}
) => resolveParameterTargetAtV2(logicalText, element, span, context)?.parameterKey ?? null;
