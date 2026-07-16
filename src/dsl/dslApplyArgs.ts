import { makeNumericExpression, normalizeNumericExpressionInput } from "../geometry/numericExpressions";
import { createCadElementId } from "../model/cadIds";
import type { ElementNameContext } from "../model/elementNames";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { setParameterValue } from "../parameters/parameterAccess";
import type { CadElement, ElementId, NumericValue, NumericVariable, VisibilityRole } from "../types/geometry";
import {
  resolveAnchor as resolveAnchorFromDsl,
  resolveEndpoint as resolveEndpointFromDsl,
  resolveId as resolveIdFromDsl,
  type NameIndex,
} from "./dslReferences";
import { splitDslList, splitDslRecords, unquoteDslString } from "./dslTokens";
import type { DslDiagnostic } from "./dslTypes";
import type { ScannedArg } from "./dslArgScanner";
import { commonArgSpecs, type DslArgSpec, type DslConstructionSpec } from "./dslConstructions";

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

/** Dependencies supplied by the compiler skeleton when it connects P6 in C1. */
export type DslApplyArgsResolvers = {
  index: NameIndex;
  line: number;
  elementsForExpressions: CadElement[];
  nameContext: ElementNameContext;
  visibilityRoles?: readonly VisibilityRole[];
  createIntermediateId: () => ElementId;
  normalizeNumeric?: (source: string, currentElement: CadElement) => NumericValue;
  resolveId?: typeof resolveIdFromDsl;
  resolveAnchor?: typeof resolveAnchorFromDsl;
  resolveEndpoint?: typeof resolveEndpointFromDsl;
};

const diagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message,
});

const warning = (line: number, message: string): DslDiagnostic => ({
  severity: "warning",
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

const remapLocalVariableReferences = (value: NumericValue, ids: ReadonlyMap<string, string>): NumericValue =>
  typeof value === "object" && value !== null && value.kind === "expression"
    ? {
        ...value,
        expression: value.expression.replace(/@([^\s()+*/.<>!=&|]+)/g, (match, id: string) =>
          ids.has(id) ? `@${ids.get(id)}` : match),
      }
    : value;

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

/**
 * Applies already-scanned v2 arguments without parsing statements or assigning
 * document ownership. `metadata` is deliberately returned for the C1 compiler
 * skeleton to handle IDs and explicit parent/branch fallback rules.
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
        next.numericVariables ?? [],
        next,
        resolvers.nameContext,
      ),
    );
  const anchor = (source: string) =>
    resolveAnchor(source, resolvers.index, resolvers.line, diagnostics, numeric, next);
  const id = (source: string) =>
    resolveId(source, resolvers.index, resolvers.line, diagnostics, next);

  for (const [argName, scanned] of byName) {
    const definition = definitions.get(argName);
    if (!definition || definition.special) continue;
    const parameterKey = definition.parameterKey ?? definition.arg;
    const parameter = findParameterDefinition(next, parameterKey);
    if (!parameter) continue;
    const value = scanned.value;
    switch (parameter.kind) {
      case "boolean": {
        const parsed = booleanValue(value);
        if (parsed === null) diagnostics.push(diagnostic(resolvers.line, `${parameterKey} は true/false で指定してください。`));
        next = setParameterValue(next, parameterKey, parsed ?? false);
        break;
      }
      case "number":
        next = setParameterValue(next, parameterKey, numeric(value));
        break;
      case "reference":
        next = setParameterValue(next, parameterKey, value === "none" ? null : anchor(value));
        break;
      case "lineEndpointReference":
        next = setParameterValue(next, parameterKey, resolveEndpoint(value, resolvers.index, resolvers.line, diagnostics, next));
        break;
      case "lineReference":
        next = setParameterValue(next, parameterKey, id(value));
        break;
      case "lineReferenceList":
        next = setParameterValue(next, parameterKey, splitDslList(value).map(id));
        break;
      case "text":
      case "choice":
      case "color":
        next = setParameterValue(next, parameterKey, unquoteDslString(value));
        break;
    }
  }

  const vars = byName.get("vars");
  if (vars) {
    const variables: NumericVariable[] = [];
    for (const record of splitDslRecords(vars.value)) {
      const [name = "", ...expression] = splitRecordFields(record);
      const variable: NumericVariable = {
        id: `local-variable-${variables.length + 1}`,
        name: unquoteDslString(name),
        value: 0,
      };
      next = { ...next, numericVariables: [...variables, variable] };
      variable.value = numeric(expression.join(":") || "0");
      variables.push(variable);
      next = { ...next, numericVariables: [...variables] };
    }
  }

  const varIds = byName.get("varIds");
  if (varIds) {
    const ids = splitDslList(varIds.value);
    const variables = next.numericVariables ?? [];
    if (ids.length !== variables.length || ids.some((value) => !value.trim())) {
      diagnostics.push(warning(resolvers.line, "varIds は vars と同じ数の空でないIDを指定してください。"));
    } else {
      const remappedIds = new Map(variables.map((variable, index) => [variable.id, ids[index]]));
      next = {
        ...next,
        numericVariables: variables.map((variable, index) => ({
          ...variable,
          id: ids[index],
          value: remapLocalVariableReferences(variable.value, remappedIds),
        })),
      };
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

  const metadata: DslApplyArgsMetadata = {
    ...(byName.get("id") ? { id: unquoteDslString(byName.get("id")!.value) } : {}),
    ...(byName.get("parent") ? { parent: byName.get("parent")!.value } : {}),
    ...(byName.get("branch") ? { branch: byName.get("branch")!.value === "else" ? "else" : "then" } : {}),
  };
  for (const group of spec.exclusiveGroups ?? []) {
    const selected = group.find((arg) => byName.has(arg));
    if (selected && (next.type === "divisionPoint" || next.type === "lineDivisionPoint")) {
      next = { ...next, placementMode: selected as "distance" | "ratio" };
    }
  }
  return { element: next, diagnostics, metadata };
};

/** Default C1 resolver for intermediate records; exposed to keep test injection deterministic. */
export const createDefaultIntermediateId = () => createCadElementId("bezierCurve");
