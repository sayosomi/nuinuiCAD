import type { ScalarType } from "./types";

export type BuiltinConstantName = "pi";

export type BuiltinConstantDefinition = {
  readonly name: BuiltinConstantName;
  readonly type: Extract<ScalarType, { kind: "number" }>;
  readonly value: number;
};

const NUMBER_TYPE: Extract<ScalarType, { kind: "number" }> = { kind: "number" };

/** Canonical scalar builtin constants. Keep spelling, type, and value here. */
export const BUILTIN_CONSTANT_DEFINITIONS: readonly BuiltinConstantDefinition[] = [
  { name: "pi", type: NUMBER_TYPE, value: Math.PI }
];

export const BUILTIN_CONSTANTS: ReadonlyMap<BuiltinConstantName, BuiltinConstantDefinition> = new Map(
  BUILTIN_CONSTANT_DEFINITIONS.map((definition) => [definition.name, definition])
);

export function getBuiltinConstantDefinition(name: BuiltinConstantName): BuiltinConstantDefinition;
export function getBuiltinConstantDefinition(name: string): BuiltinConstantDefinition | null;
export function getBuiltinConstantDefinition(name: string): BuiltinConstantDefinition | null {
  return BUILTIN_CONSTANTS.get(name as BuiltinConstantName) ?? null;
}

export const isBuiltinConstantName = (name: string): name is BuiltinConstantName =>
  BUILTIN_CONSTANTS.has(name as BuiltinConstantName);
