import { describe, expect, it } from "vitest";
import {
  BUILTIN_FUNCTION_DEFINITIONS,
  isBuiltinFunctionName,
  type BuiltinFunctionName
} from "./builtinFunctions";

const definitionOf = (name: BuiltinFunctionName) =>
  BUILTIN_FUNCTION_DEFINITIONS.find((definition) => definition.name === name);

describe("nui4 builtin function catalog", () => {
  it.each([
    ["distance", ["point", "point"]],
    ["angle", ["point", "point"]],
    ["lineDistance", ["point", "line"]]
  ] as const)("defines %s with the geometry parameter contract", (name, argumentTypes) => {
    const definition = definitionOf(name);

    expect(definition).toBeDefined();
    expect(definition?.signatures).toHaveLength(1);
    expect(definition?.signatures[0]).toEqual({
      argumentTypes,
      returnType: { kind: "number" }
    });
    expect(definition?.signatures[0]?.argumentTypes).toHaveLength(2);
  });

  it.each(["distance", "angle", "lineDistance"] as const)("recognizes %s as a builtin name", (name) => {
    expect(isBuiltinFunctionName(name)).toBe(true);
  });

  it("keeps scalar builtin signatures scalar", () => {
    const definition = definitionOf("isClose");

    expect(definition?.signatures[0]).toEqual({
      argumentTypes: [{ kind: "number" }, { kind: "number" }, { kind: "number" }],
      returnType: { kind: "boolean" }
    });
  });
});
