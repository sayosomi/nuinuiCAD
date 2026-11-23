import { describe, expect, it } from "vitest";
import {
  BUILTIN_FUNCTION_DEFINITIONS,
  formatBuiltinCallingStyleMismatch,
  formatBuiltinFunctionSignatures,
  isBuiltinFunctionName,
  type BuiltinFunctionName
} from "@nuinuicad/nui-language";

const definitionOf = (name: BuiltinFunctionName) =>
  BUILTIN_FUNCTION_DEFINITIONS.find((definition) => definition.name === name);

describe("nui1 builtin function catalog", () => {
  it("uses bare geometry references in named-call diagnostic examples", () => {
    expect(formatBuiltinCallingStyleMismatch(definitionOf("pathDistance")!))
      .toContain("pathDistance(path: path, point1: point, point2: point)");
  });

  it.each([
    ["distance", ["point", "point"]],
    ["angle", ["point", "point"]],
    ["lineDistance", ["point", "line"]],
    ["lineAngle", [{ kind: "geometryEndpoint" }, { kind: "geometryEndpoint" }]]
  ] as const)("defines %s with the geometry parameter contract", (name, argumentTypes) => {
    const definition = definitionOf(name);

    expect(definition).toBeDefined();
    expect(definition?.signatures).toHaveLength(1);
    expect(definition?.signatures[0]).toEqual({
      callingStyle: "positional",
      parameters: argumentTypes.map((type) => ({ type })),
      returnType: { kind: "number" }
    });
    expect(definition?.signatures[0]?.parameters).toHaveLength(2);
  });

  it.each(["distance", "angle", "lineDistance", "lineAngle"] as const)("recognizes %s as a builtin name", (name) => {
    expect(isBuiltinFunctionName(name)).toBe(true);
  });

  it("keeps scalar builtin signatures scalar", () => {
    const definition = definitionOf("isClose");

    expect(definition?.signatures[0]).toEqual({
      callingStyle: "positional",
      parameters: [{ type: { kind: "number" } }, { type: { kind: "number" } }, { type: { kind: "number" } }],
      returnType: { kind: "boolean" }
    });
  });

  it("keeps the exact named-only set and other production signatures positional", () => {
    expect(BUILTIN_FUNCTION_DEFINITIONS.filter(definition => definition.signatures.some(signature => signature.callingStyle === "named"))
      .map(definition => definition.name)).toEqual(["spreadAngle", "pathDistance"]);
    expect(BUILTIN_FUNCTION_DEFINITIONS.every(definition => definition.signatures.every(signature =>
      signature.callingStyle === (["spreadAngle", "pathDistance"].includes(definition.name) ? "named" : "positional")
    ))).toBe(true);
  });

  it("defines pathDistance with its exact named geometry contract", () => {
    expect(definitionOf("pathDistance")).toEqual({
      name: "pathDistance",
      signatures: [{
        callingStyle: "named",
        parameters: [{ name:"path", type:"path" }, { name:"point1", type:"point" }, { name:"point2", type:"point" }],
        returnType: { kind:"number" }
      }]
    });
    expect(isBuiltinFunctionName("pathDistance")).toBe(true);
    expect(formatBuiltinFunctionSignatures(definitionOf("pathDistance")!)).toBe("pathDistance(path: path, point1: point, point2: point) -> number");
  });

  it("defines spreadAngle as the production named-only scalar builtin", () => {
    expect(definitionOf("spreadAngle")).toEqual({
      name: "spreadAngle",
      signatures: [{
        callingStyle: "named",
        parameters: [
          { name: "length", type: { kind: "number" } },
          { name: "spread", type: { kind: "number" } }
        ],
        returnType: { kind: "number" }
      }]
    });
    expect(isBuiltinFunctionName("spreadAngle")).toBe(true);
    expect(formatBuiltinFunctionSignatures(definitionOf("spreadAngle")!)).toBe(
      "spreadAngle(length: number, spread: number) -> number"
    );
  });

  it("defines the trigonometric scalar signatures", () => {
    for (const name of ["sin", "cos", "tan", "asin", "acos", "atan"] as const) {
      expect(definitionOf(name)?.signatures[0]).toEqual({
        callingStyle: "positional",
        parameters: [{ type: { kind: "number" } }],
        returnType: { kind: "number" }
      });
      expect(isBuiltinFunctionName(name)).toBe(true);
    }
    expect(definitionOf("atan2")?.signatures[0]).toEqual({
      callingStyle: "positional",
      parameters: [{ type: { kind: "number" } }, { type: { kind: "number" } }],
      returnType: { kind: "number" }
    });
    expect(isBuiltinFunctionName("atan2")).toBe(true);
  });

  it("keeps positional signature formatting unchanged", () => {
    expect(formatBuiltinFunctionSignatures(definitionOf("atan2")!)).toBe("atan2(number, number) -> number");
  });

  it("formats named signatures from their own parameter metadata", () => {
    const definition = {
      name: "someFunction",
      signatures: [{
        callingStyle: "named",
        parameters: [{ name: "first", type: { kind: "number" } }, { name: "second", type: { kind: "number" } }],
        returnType: { kind: "number" }
      }]
    } as never;
    expect(formatBuiltinFunctionSignatures(definition)).toBe("someFunction(first: number, second: number) -> number");
  });
});
