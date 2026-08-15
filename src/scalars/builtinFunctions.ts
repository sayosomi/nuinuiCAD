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
  | "distance"
  | "angle"
  | "lineDistance"
  | "lineAngle";

export type BuiltinParameterType = ScalarType | ModuleGeometryInterfaceType;

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
  typeof type === "string" ? type : type.kind === "choice" ? `choice(${type.options.join(", ")})` : type.kind;

const NUMBER_TYPE: Extract<ScalarType, { kind: "number" }> = { kind: "number" };
const BOOLEAN_TYPE: Extract<ScalarType, { kind: "boolean" }> = { kind: "boolean" };

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

export const isScalarBuiltinParameterType = (type: BuiltinParameterType): type is ScalarType => typeof type !== "string";

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
