import type { ScalarType } from "./types";
import type { ModuleGeometryInterfaceType } from "../dsl/moduleGeometryInterfaces";

export type BuiltinFunctionName =
  | "abs"
  | "min"
  | "max"
  | "sqrt"
  | "round"
  | "floor"
  | "ceil"
  | "roundTo"
  | "isClose"
  | "sin"
  | "cos"
  | "tan"
  | "asin"
  | "acos"
  | "atan"
  | "atan2"
  | "spreadAngle"
  | "string"
  | "distance"
  | "angle"
  | "lineDistance"
  | "lineAngle";

/** Builtin-only constraint matching any concrete choice type without weakening ScalarType identity. */
export type BuiltinAnyChoiceParameterType = { readonly kind: "anyChoice" };
export type BuiltinScalarParameterType = ScalarType | BuiltinAnyChoiceParameterType;
export type BuiltinParameterType = BuiltinScalarParameterType | ModuleGeometryInterfaceType;

export type BuiltinFunctionSignature = {
  readonly callingStyle: "positional";
  readonly parameters: readonly { readonly type: BuiltinParameterType }[];
  readonly returnType: ScalarType;
} | {
  readonly callingStyle: "named";
  readonly parameters: readonly { readonly name: string; readonly type: BuiltinParameterType }[];
  readonly returnType: ScalarType;
};

export type BuiltinFunctionDefinition = {
  readonly name: BuiltinFunctionName;
  readonly signatures: readonly BuiltinFunctionSignature[];
};

const builtinParameterTypeDisplayName = (type: BuiltinParameterType): string =>
  typeof type === "string"
    ? type
    : type.kind === "anyChoice"
      ? "choice"
      : type.kind === "choice"
        ? `choice(${type.options.join(", ")})`
        : type.kind;

const NUMBER_TYPE: Extract<ScalarType, { kind: "number" }> = { kind: "number" };
const STRING_TYPE: Extract<ScalarType, { kind: "string" }> = { kind: "string" };
const BOOLEAN_TYPE: Extract<ScalarType, { kind: "boolean" }> = { kind: "boolean" };
const ANY_CHOICE_PARAMETER_TYPE: BuiltinAnyChoiceParameterType = { kind: "anyChoice" };

const numeric = (argumentCount: number): BuiltinFunctionSignature => ({
  callingStyle: "positional",
  parameters: Array.from({ length: argumentCount }, () => ({ type: NUMBER_TYPE })),
  returnType: NUMBER_TYPE
});

const positional = (types: readonly BuiltinParameterType[], returnType: ScalarType): BuiltinFunctionSignature => ({
  callingStyle: "positional",
  parameters: types.map((type) => ({ type })),
  returnType
});

export const BUILTIN_FUNCTION_DEFINITIONS: readonly BuiltinFunctionDefinition[] = [
  { name: "abs", signatures: [numeric(1)] },
  { name: "min", signatures: [numeric(2)] },
  { name: "max", signatures: [numeric(2)] },
  { name: "sqrt", signatures: [numeric(1)] },
  { name: "round", signatures: [numeric(1), numeric(2)] },
  { name: "floor", signatures: [numeric(1), numeric(2)] },
  { name: "ceil", signatures: [numeric(1), numeric(2)] },
  { name: "roundTo", signatures: [numeric(2)] },
  { name: "isClose", signatures: [positional([NUMBER_TYPE, NUMBER_TYPE, NUMBER_TYPE], BOOLEAN_TYPE)] },
  { name: "sin", signatures: [numeric(1)] },
  { name: "cos", signatures: [numeric(1)] },
  { name: "tan", signatures: [numeric(1)] },
  { name: "asin", signatures: [numeric(1)] },
  { name: "acos", signatures: [numeric(1)] },
  { name: "atan", signatures: [numeric(1)] },
  { name: "atan2", signatures: [numeric(2)] },
  {
    name: "spreadAngle",
    signatures: [{
      callingStyle: "named",
      parameters: [{ name: "length", type: NUMBER_TYPE }, { name: "spread", type: NUMBER_TYPE }],
      returnType: NUMBER_TYPE
    }]
  },
  { name: "string", signatures: [positional([ANY_CHOICE_PARAMETER_TYPE], STRING_TYPE)] },
  { name: "distance", signatures: [positional(["point", "point"], NUMBER_TYPE)] },
  { name: "angle", signatures: [positional(["point", "point"], NUMBER_TYPE)] },
  { name: "lineDistance", signatures: [positional(["point", "line"], NUMBER_TYPE)] },
  { name: "lineAngle", signatures: [positional(["line", "line"], NUMBER_TYPE)] }
];

export const BUILTIN_FUNCTIONS: ReadonlyMap<BuiltinFunctionName, BuiltinFunctionDefinition> = new Map(
  BUILTIN_FUNCTION_DEFINITIONS.map((definition) => [definition.name, definition])
);

export const getBuiltinFunctionDefinition = (name: string): BuiltinFunctionDefinition | null =>
  BUILTIN_FUNCTIONS.get(name as BuiltinFunctionName) ?? null;

export const isBuiltinFunctionName = (name: string): name is BuiltinFunctionName =>
  BUILTIN_FUNCTIONS.has(name as BuiltinFunctionName);

export const isScalarBuiltinParameterType = (type: BuiltinParameterType): type is BuiltinScalarParameterType => typeof type !== "string";

/** Formats the editor-facing signature detail directly from the semantic registry. */
export const formatBuiltinFunctionSignatures = (definition: BuiltinFunctionDefinition): string =>
  definition.signatures
    .map((signature) => {
      const parameters = signature.callingStyle === "named"
        ? signature.parameters.map((parameter) => `${parameter.name}: ${builtinParameterTypeDisplayName(parameter.type)}`)
        : signature.parameters.map((parameter) => builtinParameterTypeDisplayName(parameter.type));
      return `${definition.name}(${parameters.join(", ")}) -> ${builtinParameterTypeDisplayName(signature.returnType)}`;
    })
    .join(" | ");

const formatBuiltinArgumentExample = (type: BuiltinParameterType, index: number): string => {
  if (typeof type === "string") return `@${type}`;
  if (type.kind === "number") return index === 0 ? "100" : "20";
  if (type.kind === "boolean") return "true";
  if (type.kind === "string") return '"value"';
  if (type.kind === "anyChoice") return "@choiceValue";
  return type.options[0] ?? "value";
};

/** Formats the repair guidance for a named-only builtin from registry metadata. */
export const formatBuiltinCallingStyleMismatch = (definition: BuiltinFunctionDefinition): string => {
  const namedSignature = definition.signatures.find((signature) => signature.callingStyle === "named");
  if (!namedSignature) return `組み込み関数「${definition.name}」の呼び出し形式が一致しません。`;
  const example = namedSignature.parameters
    .map((parameter, index) => `${parameter.name}: ${formatBuiltinArgumentExample(parameter.type, index)}`)
    .join(", ");
  return `${definition.name} は名前付き引数で呼び出してください。例: ${definition.name}(${example})`;
};
