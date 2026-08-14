import type { ScalarType } from "./types";

export type BuiltinFunctionName =
  | "abs"
  | "min"
  | "max"
  | "sqrt"
  | "round"
  | "floor"
  | "ceil"
  | "roundTo"
  | "isClose";

export type BuiltinFunctionSignature = {
  readonly argumentTypes: readonly ScalarType[];
  readonly returnType: ScalarType;
};

export type BuiltinFunctionDefinition = {
  readonly name: BuiltinFunctionName;
  readonly signatures: readonly BuiltinFunctionSignature[];
};

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
  { name: "isClose", signatures: [{ argumentTypes: [NUMBER_TYPE, NUMBER_TYPE, NUMBER_TYPE], returnType: BOOLEAN_TYPE }] }
];

export const BUILTIN_FUNCTIONS: ReadonlyMap<BuiltinFunctionName, BuiltinFunctionDefinition> = new Map(
  BUILTIN_FUNCTION_DEFINITIONS.map((definition) => [definition.name, definition])
);

export const getBuiltinFunctionDefinition = (name: string): BuiltinFunctionDefinition | null =>
  BUILTIN_FUNCTIONS.get(name as BuiltinFunctionName) ?? null;
