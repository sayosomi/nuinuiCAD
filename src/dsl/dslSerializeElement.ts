import { getParameterValue } from "../parameters/parameterAccess";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import type { CadElement, LineEndpointReference, NumericValue, PointAnchor } from "../types/geometry";
import {
  commonArgSpecs,
  constructionForElementType,
  type DslArgSpec,
  type DslConstructionSpec,
} from "./dslConstructions";
import type { DslSerializerRefs } from "./dslSerializer";
import { formatDslName, quoteDslString } from "./dslTokens";

export type SerializedStatement = {
  header: string;
  args: Array<{ key: string; text: string }>;
  close: ")" | null;
  /** Set for call-style argument output. */
  argumentSeparator?: "comma";
};

const defaultGroupAnchor = (value: PointAnchor | null | undefined) =>
  !value || (value.mode === "coordinate" && value.x === 0 && value.y === 0);

const constructionForElement = (element: CadElement): DslConstructionSpec =>
  constructionForElementType(element.type);

const specialArgText = (element: CadElement, arg: DslArgSpec, refs: DslSerializerRefs): string | null => {
  switch (arg.special) {
    case "steps": {
      const entries = Object.entries(element.numericParameterSteps ?? {});
      return entries.length
        ? `[${entries.map(([key, value]) => `${formatDslName(key)}: ${value}`).join("; ")}]`
        : null;
    }
    case "vars": {
      const variables = element.numericVariables ?? [];
      return variables.length
        ? `[${variables.map((variable) =>
          `${formatDslName(variable.name)}: ${refs.numeric(variable.value, element)}`).join("; ")}]`
        : null;
    }
    case "varIds": {
      const variables = element.numericVariables ?? [];
      return refs.includeRecordIds && variables.length
        ? `[${variables.map((variable) => formatDslName(variable.id)).join(", ")}]`
        : null;
    }
    case "intermediates": {
      if (element.type !== "bezierCurve" || element.intermediatePoints.length === 0) return null;
      return `[${element.intermediatePoints.map((point) => [
        refs.anchor(point.point, element),
        refs.numeric(point.handleAngleDeg, element),
        refs.numeric(point.incomingHandleLength, element),
        refs.numeric(point.outgoingHandleLength, element),
        ...(refs.includeRecordIds ? [formatDslName(point.id)] : []),
      ].join(":")).join("; ")}]`;
    }
    case "id":
      return refs.includeRecordIds ? formatDslName(element.id) : null;
    case "roles":
      return element.type === "group" && element.visibilityRoleIds?.length
        ? `[${element.visibilityRoleIds.map(formatDslName).join(", ")}]`
        : null;
    case "parent":
      return refs.includeRecordIds && element.parentGroupId
        ? refs.token(element.parentGroupId, element)
        : null;
    case "branch":
      return refs.includeRecordIds && element.conditionalBranch
        ? element.conditionalBranch
        : null;
    default:
      return null;
  }
};

const ordinaryArgText = (element: CadElement, parameterKey: string, refs: DslSerializerRefs): string => {
  const value = getParameterValue(element, parameterKey);
  if (parameterKey === "colorId") return formatDslName((value as string | undefined) ?? "");

  const definition = findParameterDefinition(element, parameterKey);
  if (!definition) throw new Error(`Missing parameter definition for ${element.type}.${parameterKey}`);

  switch (definition.kind) {
    case "number":
      return refs.numeric(value as NumericValue, element);
    case "reference":
      return refs.anchor(value as PointAnchor | null, element);
    case "lineEndpointReference":
      return refs.endpoint(value as unknown as LineEndpointReference, element);
    case "lineReference":
      return refs.token(value as string, element);
    case "lineReferenceList":
      return `[${(value as unknown as string[]).map((id) => refs.token(id, element)).join(", ")}]`;
    case "text":
      return quoteDslString(value as string);
    case "boolean":
      // 未設定(undefined)は偽として書き出す。CadElementの真偽値フィールドは
      // 型上optionalな場合があり、生の`${value}`は"undefined"という不正な
      // トークンを書いてしまう(再パース不能)。
      return `${Boolean(value)}`;
    case "choice":
      return formatDslName(value as string);
    case "color":
      return formatDslName(value as string);
  }
};

const shouldSerializeConstructionArg = (element: CadElement, arg: DslArgSpec) => {
  if (arg.special) return true;
  const key = arg.parameterKey ?? arg.arg;
  if (element.type === "group" && key === "printEnabled") return element.printEnabled === true;
  if (element.type === "group" && key === "printAnchor") return !defaultGroupAnchor(element.printAnchor);
  if ((element.type === "divisionPoint" || element.type === "lineDivisionPoint") &&
      (arg.arg === "distance" || arg.arg === "ratio")) {
    return element.placement.kind === arg.arg;
  }
  return true;
};

const serializeArg = (element: CadElement, arg: DslArgSpec, refs: DslSerializerRefs) => {
  const value = arg.special
    ? specialArgText(element, arg, refs)
    : ordinaryArgText(element, arg.parameterKey ?? arg.arg, refs);
  return value === null ? null : { key: arg.arg, text: `${arg.arg}: ${value}` };
};

const constructionArgs = (element: CadElement, spec: DslConstructionSpec, refs: DslSerializerRefs) =>
  spec.args
    .filter((arg) => !arg.positional && shouldSerializeConstructionArg(element, arg))
    .map((arg) => serializeArg(element, arg, refs))
    .filter((arg): arg is { key: string; text: string } => arg !== null);

const commonArgs = (
  element: CadElement,
  refs: DslSerializerRefs,
  constructionArgNames: ReadonlySet<string> = new Set()
) => {
  const activity = element.activity;
  return commonArgSpecs
    .filter((arg) => {
      if (constructionArgNames.has(arg.arg)) return false;
      if (arg.special) return specialArgText(element, arg, refs) !== null;
      const key = arg.parameterKey ?? arg.arg;
      if (key === "state") return activity !== "visible";
      return key === "colorId" && Boolean(element.colorId);
    })
    // `state` is model activity rather than an editable parameter.
    .map((arg) => (arg.arg === "state" ? { key: "state", text: `state: ${activity}` } : serializeArg(element, arg, refs)))
    .filter((arg): arg is { key: string; text: string } => arg !== null);
};

const positionalText = (element: CadElement, arg: DslArgSpec, refs: DslSerializerRefs) => {
  const key = arg.parameterKey ?? arg.arg;
  const definition = findParameterDefinition(element, key);
  return definition?.kind === "text"
    ? formatDslName(getParameterValue(element, key) as string)
    : ordinaryArgText(element, key, refs);
};

const containerStatement = (element: CadElement, spec: DslConstructionSpec, refs: DslSerializerRefs): SerializedStatement => {
  const name = refs.name(element);
  const prefix = [spec.category, name].filter(Boolean).join(" ");
  const positional = spec.args
    .filter((arg) => arg.positional)
    .map((arg) => positionalText(element, arg, refs));
  const args = [
    ...constructionArgs(element, spec, refs),
    ...commonArgs(element, refs, new Set(spec.args.map((arg) => arg.arg))),
  ];
  const contents = [...positional, ...args.map((arg) => arg.text)];
  const usesCommas = refs.majorVersion >= 3;
  const header = spec.category === "group" && contents.length === 0
    ? prefix
    : `${prefix} (${contents.join(usesCommas ? ", " : " ")})`;
  return { header, args: [], close: null, ...(usesCommas ? { argumentSeparator: "comma" as const } : {}) };
};

export const serializeElementStatementBlock = (
  element: CadElement,
  refs: DslSerializerRefs,
): SerializedStatement => {
  const spec = constructionForElement(element);
  if (spec.category === "group" || spec.category === "if" || spec.category === "for") {
    return containerStatement(element, spec, refs);
  }

  const common = commonArgs(element, refs, new Set(spec.args.map((arg) => arg.arg)));

  const name = refs.name(element);
  const header = [spec.category, name, "=", `${spec.construction}(`].filter(Boolean).join(" ");
  return {
    header,
    args: [...constructionArgs(element, spec, refs), ...common],
    close: ")",
    ...(refs.majorVersion >= 3 ? { argumentSeparator: "comma" as const } : {}),
  };
};

export const serializeElementStatementLogical = (element: CadElement, refs: DslSerializerRefs): string => {
  const statement = serializeElementStatementBlock(element, refs);
  if (!statement.close) return statement.header;
  const [first, ...rest] = statement.args;
  const separator = statement.argumentSeparator === "comma" ? ", " : " ";
  return `${statement.header}${[first?.text, ...rest.map((arg) => arg.text)].filter(Boolean).join(separator)})`;
};
