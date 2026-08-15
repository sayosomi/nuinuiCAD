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
  | "distance"
  | "angle"
  | "lineDistance";

export type BuiltinParameterType = ScalarType | ModuleGeometryInterfaceType;

export type BuiltinFunctionSignature = {
  readonly argumentTypes: readonly BuiltinParameterType[];
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
  argumentTypes: Array.from({ length: argumentCount }, () => NUMBER_TYPE),
  returnType: NUMBER_TYPE
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
  { name: "isClose", signatures: [{ argumentTypes: [NUMBER_TYPE, NUMBER_TYPE, NUMBER_TYPE], returnType: BOOLEAN_TYPE }] },
  { name: "sin", signatures: [numeric(1)] },
  { name: "cos", signatures: [numeric(1)] },
  { name: "tan", signatures: [numeric(1)] },
  { name: "asin", signatures: [numeric(1)] },
  { name: "acos", signatures: [numeric(1)] },
  { name: "atan", signatures: [numeric(1)] },
  { name: "atan2", signatures: [numeric(2)] },
  { name: "distance", signatures: [{ argumentTypes: ["point", "point"], returnType: NUMBER_TYPE }] },
  { name: "angle", signatures: [{ argumentTypes: ["point", "point"], returnType: NUMBER_TYPE }] },
  { name: "lineDistance", signatures: [{ argumentTypes: ["point", "line"], returnType: NUMBER_TYPE }] }
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
    .map((signature) => `${definition.name}(${signature.argumentTypes.map(builtinParameterTypeDisplayName).join(", ")}) -> ${builtinParameterTypeDisplayName(signature.returnType)}`)
    .join(" | ");
