import { makeNumericExpression, normalizeNumericExpressionInput } from "../geometry/numericExpressions";
import {
  containsScalarNamedCall,
  isScalarExpressionCandidateSource,
  isScalarNamedCallCandidateSource
} from "../scalars/expressionParser";
import { parseScalarExpression } from "../scalars/expressionParser";
import { typecheckScalarExpression } from "../scalars/expressionTypecheck";
import { createCadElementId } from "../model/cadIds";
import { elementTypeSupportsHiddenActivity } from "../model/elementActivity";
import { isLineLikeElement, referenceAnchor } from "../model/pointAnchors";
import type { ElementNameContext } from "../model/elementNames";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { setParameterValue } from "../parameters/parameterAccess";
import type { CadElement, ElementId, NumericValue, VisibilityRole } from "../types/geometry";
import {
  resolveAnchor as resolveAnchorFromDsl,
  resolveEndpoint as resolveEndpointFromDsl,
  resolveId as resolveIdFromDsl,
  type NameIndex,
} from "./dslReferences";
import type { RuntimeGeometryInputTarget } from "./moduleGeometryRuntimeLowering";
import { splitDslList, splitDslRecords, unquoteDslString } from "./dslTokens";
import type { DslDiagnostic, DslSpan } from "./dslTypes";
import type { ScannedArg } from "./dslArgScanner";
import { commonArgSpecs, type DslArgSpec, type DslConstructionSpec } from "./dslConstructions";
import type { DslMajorVersion } from "./dslVersion";
import { invalidElementActivityMessage, parseElementActivityLiteral } from "./dslActivity";
import { lowerSourceGeometryArrayLineReferenceList, lowerSourceGeometryArrayPointReferenceList } from "./geometryArrayRuntimeLowering";
import { parseGeometryArrayExpression } from "./geometryArrayExpression";

export type DslApplyArgsMetadata = {
  id?: string;
  parent?: string;
  branch?: "then" | "else";
};

export type DslApplyArgsResult = {
  element: CadElement;
  diagnostics: DslDiagnostic[];
  metadata: DslApplyArgsMetadata;
};

export type DslIdResolver = (
  token: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  currentElement?: CadElement,
  sourceSpan?: DslSpan
) => ElementId;

export type DslAnchorResolver = (
  token: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  numeric: (source: string) => NumericValue,
  currentElement?: CadElement,
  sourceSpan?: DslSpan
) => NonNullable<ReturnType<typeof resolveAnchorFromDsl>> | RuntimeGeometryInputTarget;

export type DslEndpointResolver = (
  token: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  currentElement?: CadElement,
  sourceSpan?: DslSpan
) => NonNullable<ReturnType<typeof resolveEndpointFromDsl>>;

/**
 * Consumer-boundary lowering hook for a whole immutable geometry-array value.
 * Returning `null` delegates to the existing source-array/ordinary list path,
 * so Module runtime overrides can handle only instance-local values.
 */
export type DslLineReferenceListResolver = (
  token: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  currentElement?: CadElement,
  sourceSpan?: DslSpan
) => readonly ElementId[] | null;

/** Compiler/runtime sidecar target for a read-only line consumer. */
export type DslLineReferenceTargetResolver = (
  token: string,
  parameterKey: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  currentElement?: CadElement,
  sourceSpan?: DslSpan
) => RuntimeGeometryInputTarget | null;

/** Resolves a line endpoint's backing geometry input at the consumer boundary. */
export type DslLineEndpointTargetResolver = (
  token: string,
  parameterKey: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  currentElement?: CadElement,
  sourceSpan?: DslSpan
) => RuntimeGeometryInputTarget | null;

export type DslGeometryInputTargetRecorder = (
  elementId: ElementId,
  parameterKey: string,
  target: RuntimeGeometryInputTarget | readonly RuntimeGeometryInputTarget[]
) => void;

export type DslPointReferenceListResolver = (
  token: string,
  index: NameIndex,
  line: number,
  diagnostics: DslDiagnostic[],
  currentElement?: CadElement,
  sourceSpan?: DslSpan
) => readonly NonNullable<ReturnType<typeof resolveAnchorFromDsl>>[] | null;

export type DslGeometryResolverOverrides = {
  resolveId?: DslIdResolver;
  resolveAnchor?: DslAnchorResolver;
  resolveEndpoint?: DslEndpointResolver;
  resolveLineReferenceTarget?: DslLineReferenceTargetResolver;
  resolveLineEndpointTarget?: DslLineEndpointTargetResolver;
  recordGeometryInputTarget?: DslGeometryInputTargetRecorder;
  resolveLineReferenceList?: DslLineReferenceListResolver;
  resolvePointReferenceList?: DslPointReferenceListResolver;
};

const isDeferredGeometryInputTarget = (value: unknown): value is RuntimeGeometryInputTarget =>
  Boolean(value && typeof value === "object" && "kind" in value);

/** Dependencies supplied by the compiler skeleton when it connects P6 in C1. */
export type DslApplyArgsResolvers = DslGeometryResolverOverrides & {
  index: NameIndex;
  line: number;
  elementsForExpressions: CadElement[];
  nameContext: ElementNameContext;
  visibilityRoles?: readonly VisibilityRole[];
  createIntermediateId: () => ElementId;
  normalizeNumeric?: (source: string, currentElement: CadElement) => NumericValue;
  majorVersion?: DslMajorVersion;
};

const diagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message,
});

const booleanValue = (value: string) =>
  ["true", "1", "yes", "on"].includes(value.toLowerCase())
    ? true
    : ["false", "0", "no", "off"].includes(value.toLowerCase())
      ? false
      : null;

const splitRecordFields = (value: string) => {
  const fields: string[] = [];
  let field = "";
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === '"' || character === "'") && value[index - 1] !== "\\") {
      quote = quote === character ? null : quote ?? character;
    } else if (!quote && character === ":") {
      fields.push(field);
      field = "";
      continue;
    }
    field += character;
  }
  fields.push(field);
  return fields.map((item) => item.trim());
};

const referenceListItems = (value: string): Array<{ text: string; offset: number }> => {
  const trimmedStart = value.search(/\S|$/);
  const trimmedEnd = value.length - value.split("").reverse().join("").search(/\S|$/);
  const bracketed = value.trim().startsWith("[") && value.trim().endsWith("]");
  const contentStart = bracketed ? value.indexOf("[") + 1 : trimmedStart;
  const contentEnd = bracketed ? value.lastIndexOf("]") : trimmedEnd;
  const items: Array<{ text: string; offset: number }> = [];
  let itemStart = contentStart;
  let quote: string | null = null;
  let depth = 0;
  const push = (end: number) => {
    let start = itemStart;
    while (start < end && /\s/.test(value[start])) start += 1;
    let trimmedEnd = end;
    while (trimmedEnd > start && /\s/.test(value[trimmedEnd - 1])) trimmedEnd -= 1;
    if (start < trimmedEnd) items.push({ text: value.slice(start, trimmedEnd), offset: start });
  };
  for (let index = contentStart; index < contentEnd; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") quote = quote === char ? null : quote ?? char;
    else if (!quote && (char === "[" || char === "(")) depth += 1;
    else if (!quote && (char === "]" || char === ")")) depth -= 1;
    else if (!quote && depth === 0 && char === ",") {
      push(index);
      itemStart = index + 1;
    }
  }
  push(contentEnd);
  return items;
};

const normalArgs = (spec: DslConstructionSpec, args: readonly ScannedArg[]) => {
  const byName = new Map<string, ScannedArg>();
  let positionalIndex = 0;
  const positional = spec.args.filter((arg) => arg.positional);
  for (const item of args) {
    if (item.key === null) {
      const target = positional[positionalIndex++];
      if (target) byName.set(target.arg, item);
    } else {
      byName.set(item.key, item);
    }
  }
  return byName;
};

const roleIdFor = (roles: readonly VisibilityRole[], token: string) => {
  const value = unquoteDslString(token);
  return roles.find((role) => role.id === value || role.name === value)?.id ?? value;
};

export type GeometryLineConsumerPolicy = "readOnly" | "identityMutation";

/**
 * The parameter schema owns which inputs are line references. This finite
 * policy only classifies the current consumers that give those references
 * their runtime identity semantics; it is not a second parameter vocabulary.
 */
const geometryLineConsumerPolicies: ReadonlyMap<string, GeometryLineConsumerPolicy> = new Map([
  ["intersectionPoint.line1Id", "readOnly"],
  ["intersectionPoint.line2Id", "readOnly"],
  ["lineTangentOffsetPoint.baseLineId", "readOnly"],
  ["bezierExtremePoint.baseLineId", "readOnly"],
  ["bezierBulgePoint.baseLineId", "readOnly"],
  ["splitLine.baseLineId", "identityMutation"],
  ["commonTangentLine.firstLineId", "readOnly"],
  ["commonTangentLine.secondLineId", "readOnly"],
  ["pathReverse.targetLineId", "identityMutation"],
  ["offsetLine.baseLineIds", "readOnly"],
  ["copyLine.baseLineIds", "readOnly"],
  ["symmetricCopyLine.baseLineIds", "readOnly"],
  ["move.baseLineIds", "identityMutation"],
  ["symmetricMove.baseLineIds", "identityMutation"],
  ["lineDivisionPoint.endpoint", "readOnly"],
  ["cornerRadiusArcLine.endpoint1", "identityMutation"],
  ["cornerRadiusArcLine.endpoint2", "identityMutation"],
  ["edge.endpoint1", "identityMutation"],
  ["edge.endpoint2", "identityMutation"],
  ["extendTrim.endpoint", "identityMutation"]
]);

export const geometryLineConsumerPolicyFor = (
  elementType: CadElement["type"] | string | undefined,
  parameterKey: string
): GeometryLineConsumerPolicy | undefined =>
  elementType ? geometryLineConsumerPolicies.get(`${elementType}.${parameterKey}`) : undefined;

/**
 * Applies already-scanned nui 1 arguments without parsing statements || assigning
 * document ownership. `metadata` is deliberately returned for the C1 compiler
 * skeleton to handle IDs && explicit parent/branch fallback rules.
 */
export const applyArgs = (
  element: CadElement,
  spec: DslConstructionSpec,
  args: readonly ScannedArg[],
  resolvers: DslApplyArgsResolvers,
): DslApplyArgsResult => {
  const diagnostics: DslDiagnostic[] = [];
  const byName = normalArgs(spec, args);
  const definitions = new Map<string, DslArgSpec>(
    [...spec.args, ...commonArgSpecs].map((arg) => [arg.arg, arg]),
  );
  const resolveId = resolvers.resolveId ?? resolveIdFromDsl;
  const resolveAnchor = resolvers.resolveAnchor ?? resolveAnchorFromDsl;
  const resolveEndpoint = resolvers.resolveEndpoint ?? resolveEndpointFromDsl;
  let next = { ...element, ...spec.preset } as CadElement;

  const numeric = (source: string) =>
    resolvers.normalizeNumeric?.(source, next) ?? makeNumericExpression(
      normalizeNumericExpressionInput(
        source,
        resolvers.elementsForExpressions,
        next,
        resolvers.nameContext,
      ),
    );
  const anchor = (source: string, parameterKeyOrSpan?: string | DslSpan, sourceSpan?: DslSpan) => {
    const parameterKey = typeof parameterKeyOrSpan === "string" ? parameterKeyOrSpan : undefined;
    const actualSpan = typeof parameterKeyOrSpan === "string" ? sourceSpan : parameterKeyOrSpan;
    const resolved = resolveAnchor(source, resolvers.index, resolvers.line, diagnostics, numeric, next, actualSpan);
    if (isDeferredGeometryInputTarget(resolved)) {
      resolvers.recordGeometryInputTarget?.(next.id, parameterKey ?? "", resolved);
      return referenceAnchor(source.trim());
    }
    return resolved;
  };
  const lineConsumerPolicy = (parameterKey: string) =>
    geometryLineConsumerPolicyFor(next.type, parameterKey);
  const rejectImmutableMutationTarget = (target: RuntimeGeometryInputTarget, parameterKey: string, sourceSpan?: DslSpan) => {
    if (target.kind === "collectionIndex") return false;
    if (target.kind !== "geometryValue" || lineConsumerPolicy(parameterKey) !== "identityMutation") return false;
    diagnostics.push({
      severity: "error",
      line: resolvers.line,
      column: (sourceSpan?.start ?? 0) + 1,
      code: "geometry-value-mutation-target-unsupported",
      message: "immutable geometry value は mutation target にできません。",
      presentation: { key: "diagnostic.geometry-value-mutation-target-unsupported" },
      ...(sourceSpan ? { logicalSpan: sourceSpan } : {})
    });
    return true;
  };
  // `lineReference` && `lineReferenceList` are path-only roles. Endpoint &&
  // derived-point roles use the dedicated resolvers below, where the shared
  // source-reference parser's property is meaningful.
  const lineReferenceId = (source: string, parameterKey: string, sourceSpan?: DslSpan) =>
    (() => {
      const lowered = resolvers.resolveLineReferenceTarget?.(
        source,
        parameterKey,
        resolvers.index,
        resolvers.line,
        diagnostics,
        next,
        sourceSpan
      );
      if (lowered) {
        if (rejectImmutableMutationTarget(lowered, parameterKey, sourceSpan)) return source.trim();
        if (lineConsumerPolicy(parameterKey) === "readOnly") {
          resolvers.recordGeometryInputTarget?.(next.id, parameterKey, lowered);
        }
        if (lowered.kind === "drawable") return lowered.elementId;
        // Preserve authored source text only as compiler data. The runtime
        // sidecar above is authoritative and prevents this token from being
        // interpreted as an ElementId.
        return source.trim();
      }
      const resolvedId = resolveId(source, resolvers.index, resolvers.line, diagnostics, next, sourceSpan);
      const target = resolvers.index.elementsById.get(resolvedId);
      if (target && !isLineLikeElement(target)) {
        diagnostics.push({
          severity: "error",
          line: resolvers.line,
          column: (sourceSpan?.start ?? 0) + 1,
          code: "geometry-reference-type-mismatch",
          message: "参照先「" + target.name + "」は線・曲線ではありません。",
          presentation: {
            key: "diagnostic.geometry-reference-type-mismatch",
            parameters: { target: target.name }
          },
          ...(sourceSpan ? { logicalSpan: sourceSpan } : {})
        });
      }
      return resolvedId;
    })();
  const rejectUntypedNumericExpression = (source: string, sourceSpan: DslSpan): boolean => {
    // Named/geometry references are resolved by the later numeric binding
    // compiler. Keep incomplete && unresolved reference text available to
    // the normal source-editing path; only reference-free ASTs are safe to
    // classify at this point.
    if (source.includes("@") || !isScalarExpressionCandidateSource(source)) return false;
    // Named calls remain owned by the legacy numeric expression path until
    // the follow-up task supplies call resolution and typing. This also
    // preserves legacy call arguments that are not scalar-expression syntax,
    // such as `line:start` endpoint spellings.
    if (isScalarNamedCallCandidateSource(source)) return false;
    const span = { start: 0, end: source.length };
    const parsed = parseScalarExpression(source, span);
    if (!parsed.ast) {
      const issue = parsed.diagnostics[0];
      if (issue) diagnostics.push({
        severity: "error",
        line: resolvers.line,
        column: sourceSpan.start + issue.span.start + 1,
        code: issue.code,
        message: issue.message,
        presentation: { key: `diagnostic.${issue.code}` },
        logicalSpan: { start: sourceSpan.start + issue.span.start, end: sourceSpan.start + issue.span.end }
      });
      return true;
    }
    if (containsScalarNamedCall(parsed.ast)) return false;
    const checked = typecheckScalarExpression(parsed.ast, {
      expectedType: { kind: "number" },
      references: []
    });
    for (const issue of checked.diagnostics) diagnostics.push({
      severity: "error",
      line: resolvers.line,
      column: sourceSpan.start + issue.span.start + 1,
      code: issue.code,
      message: issue.message,
      presentation: issue.presentation ?? { key: `diagnostic.${issue.code}` },
      logicalSpan: { start: sourceSpan.start + issue.span.start, end: sourceSpan.start + issue.span.end }
    });
    return checked.diagnostics.length > 0 || checked.type === null;
  };

  for (const [argName, scanned] of byName) {
    const definition = definitions.get(argName);
    if (!definition || definition.special) continue;
    const parameterKey = definition.parameterKey ?? definition.arg;
    const parameter = findParameterDefinition(next, parameterKey);
    const value = scanned.value;
    if (parameterKey === "state") {
      const activity = parseElementActivityLiteral(value);
      if (activity === null) {
        // Fail-closed: an invalid literal must not fall back to any activity value —
        // lowering to the ElementActivity converter only happens for a valid one.
        diagnostics.push(diagnostic(resolvers.line, invalidElementActivityMessage));
        continue;
      }
      // Defence in depth: dslCallParser.ts's validateArgs already rejects this
      // at parse time with a spanned diagnostic (state-hidden-unsupported);
      // this guard only matters for a caller that skips that parse-time gate.
      if (activity === "hidden" && !elementTypeSupportsHiddenActivity(next.type)) continue;
      next = { ...next, activity } as CadElement;
      continue;
    }
    if (!parameter) continue;
    switch (parameter.kind) {
      case "boolean": {
        const parsed = booleanValue(value);
        // A `@name` value is a Task 22 property binding attempt, not a
        // malformed literal - src/scalars/propertyBindingCompiler.ts owns
        // its diagnostics (not-supported/unresolved/invalid/type-mismatch);
        // this stays silent here so a valid binding doesn't also get a
        // spurious "must be true/false" error. Any other unparseable value
        // still gets this diagnostic exactly as before.
        if (parsed === null && !isScalarExpressionCandidateSource(value)) {
          diagnostics.push(diagnostic(resolvers.line, `${parameterKey} は true/false で指定してください。`));
        }
        next = setParameterValue(next, parameterKey, parsed ?? false);
        break;
      }
      case "number":
        // distance/ratio on divisionPoint/lineDivisionPoint are resolved together below
        // (exclusiveGroups), not written per-arg here, so that "distance wins when both
        // are given" doesn't depend on which of the two args was scanned last.
        if (
          (parameterKey === "distance" || parameterKey === "ratio") &&
          (next.type === "divisionPoint" || next.type === "lineDivisionPoint")
        ) {
          break;
        }
        if (parameterKey !== "condition" && rejectUntypedNumericExpression(value, scanned.valueSpan)) break;
        next = setParameterValue(next, parameterKey, numeric(value));
        break;
      case "reference":
        next = setParameterValue(next, parameterKey, value === "none" ? null : anchor(value, parameterKey, scanned.valueSpan));
        break;
      case "lineEndpointReference":
        {
          const lowered = resolvers.resolveLineEndpointTarget?.(
            value,
            parameterKey,
            resolvers.index,
            resolvers.line,
            diagnostics,
            next,
            scanned.valueSpan
          );
          if (lowered) {
            if (rejectImmutableMutationTarget(lowered, parameterKey, scanned.valueSpan)) {
              next = setParameterValue(next, parameterKey, resolveEndpoint(value, resolvers.index, resolvers.line, diagnostics, next, scanned.valueSpan));
              break;
            }
            if (lineConsumerPolicy(parameterKey) === "readOnly") {
              resolvers.recordGeometryInputTarget?.(next.id, parameterKey, lowered);
            }
          }
          next = setParameterValue(next, parameterKey, resolveEndpoint(value, resolvers.index, resolvers.line, diagnostics, next, scanned.valueSpan));
        }
        break;
      case "lineReference":
        next = setParameterValue(next, parameterKey, lineReferenceId(value, parameterKey, scanned.valueSpan));
        break;
      case "lineReferenceList":
        {
          const moduleLowered = resolvers.resolveLineReferenceList?.(
            value,
            resolvers.index,
            resolvers.line,
            diagnostics,
            next,
            scanned.valueSpan
          ) ?? null;
          const sourceLowered = moduleLowered ?? lowerSourceGeometryArrayLineReferenceList(value, resolvers.index, next);
          const refs = sourceLowered ?? referenceListItems(value).map((item) => {
            const itemSpan = { start: scanned.valueSpan.start + item.offset, end: scanned.valueSpan.start + item.offset + item.text.length };
            return lineReferenceId(item.text, parameterKey, itemSpan);
          });
          next = setParameterValue(next, parameterKey, [...refs]);
        }
        break;
      case "pointReferenceList":
        {
          const sourceLowered = lowerSourceGeometryArrayPointReferenceList(value, resolvers.index, next);
          const refs = sourceLowered ?? referenceListItems(value).map((item) => {
            const itemSpan = { start: scanned.valueSpan.start + item.offset, end: scanned.valueSpan.start + item.offset + item.text.length };
            return anchor(item.text, parameterKey, itemSpan);
          });
          next = setParameterValue(next, parameterKey, [...refs]);
        }
        break;
      case "text":
      case "choice":
        next = setParameterValue(next, parameterKey, unquoteDslString(value));
        break;
    }
  }

  const steps = byName.get("steps");
  if (steps) {
    const numericParameterSteps: Record<string, number> = {};
    for (const record of splitDslRecords(steps.value)) {
      const [key, rawStep] = splitRecordFields(record);
      const value = Number(rawStep);
      if (key && Number.isFinite(value) && value > 0) numericParameterSteps[key] = value;
      else diagnostics.push(diagnostic(resolvers.line, "steps は parameter:positiveNumber の一覧で指定してください。"));
    }
    next = { ...next, numericParameterSteps };
  }

  const roles = byName.get("roles");
  if (roles && next.type === "group") {
    next = {
      ...next,
      visibilityRoleIds: splitDslList(roles.value).map((token) => roleIdFor(resolvers.visibilityRoles ?? [], token)),
    };
  }

  const intermediates = byName.get("intermediates");
  if (intermediates && next.type === "bezierCurve") {
    next = {
      ...next,
      intermediatePoints: splitDslRecords(intermediates.value).map((record) => {
        const [point = "none", angle = "0", incoming = "30", outgoing = "30", pointId] = splitRecordFields(record);
        return {
          id: pointId || resolvers.createIntermediateId(),
          point: anchor(point),
          handleAngleDeg: numeric(angle),
          incomingHandleLength: numeric(incoming),
          outgoingHandleLength: numeric(outgoing),
        };
      }),
    };
  }

  const pointsArg = byName.get("points");
  if (pointsArg && next.type === "polyline") {
    if (pointsArg.value.trim() === "") {
      next = { ...next, points: [] };
    } else {
      const moduleLowered = resolvers.resolvePointReferenceList?.(
        pointsArg.value,
        resolvers.index,
        resolvers.line,
        diagnostics,
        next,
        pointsArg.valueSpan
      ) ?? null;
      const sourceLowered = moduleLowered ?? lowerSourceGeometryArrayPointReferenceList(pointsArg.value, resolvers.index, next);
      if (sourceLowered) {
        next = { ...next, points: [...sourceLowered] };
      } else {
        const parsed = parseGeometryArrayExpression(pointsArg.value);
        for (const issue of parsed.diagnostics) {
          diagnostics.push({
            severity: "error",
            line: resolvers.line,
            column: pointsArg.valueSpan.start + issue.span.start + 1,
            code: issue.code,
            message: issue.message,
            presentation: { key: `diagnostic.${issue.code}` },
            logicalSpan: {
              start: pointsArg.valueSpan.start + issue.span.start,
              end: pointsArg.valueSpan.start + issue.span.end
            }
          });
        }
        if (parsed.expression?.kind === "literal" && parsed.diagnostics.length === 0) {
          next = {
            ...next,
            points: parsed.expression.members.map((member) => {
              const span = {
                start: pointsArg.valueSpan.start + member.span.start,
                end: pointsArg.valueSpan.start + member.span.end
              };
              return anchor(member.text, span);
            })
          };
        }
      }
    }
  }

  const metadata: DslApplyArgsMetadata = {
    ...(byName.get("id") ? { id: unquoteDslString(byName.get("id")!.value) } : {}),
    ...(byName.get("parent") ? { parent: byName.get("parent")!.value } : {}),
    ...(byName.get("branch") ? { branch: byName.get("branch")!.value === "else" ? "else" : "then" } : {}),
  };
  for (const group of spec.exclusiveGroups ?? []) {
    const selected = group.find((arg) => byName.has(arg));
    if (selected && (next.type === "divisionPoint" || next.type === "lineDivisionPoint")) {
      next = {
        ...next,
        placement: { kind: selected as "distance" | "ratio", value: numeric(byName.get(selected)!.value) },
      };
    }
  }
  return { element: next, diagnostics, metadata };
};

/** Default C1 resolver for intermediate records; exposed to keep test injection deterministic. */
export const createDefaultIntermediateId = () => createCadElementId("bezierCurve");
