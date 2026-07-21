import { describe, expect, it } from "vitest";
import {
  isBooleanScalarType,
  isChoiceScalarType,
  isNumberScalarType,
  isStringScalarType,
  scalarTypesEqual,
  scalarValueMatchesType,
  type ScalarType
} from "./types";

describe("scalar type guards", () => {
  it("narrows each kind independently", () => {
    const number: ScalarType = { kind: "number" };
    const string: ScalarType = { kind: "string" };
    const boolean: ScalarType = { kind: "boolean" };
    const choice: ScalarType = { kind: "choice", options: ["right", "left"] };

    expect(isNumberScalarType(number)).toBe(true);
    expect(isNumberScalarType(string)).toBe(false);
    expect(isStringScalarType(string)).toBe(true);
    expect(isStringScalarType(boolean)).toBe(false);
    expect(isBooleanScalarType(boolean)).toBe(true);
    expect(isBooleanScalarType(choice)).toBe(false);
    expect(isChoiceScalarType(choice)).toBe(true);
    expect(isChoiceScalarType(number)).toBe(false);
  });
});

describe("scalarTypesEqual", () => {
  it("treats same-kind primitives as equal", () => {
    expect(scalarTypesEqual({ kind: "number" }, { kind: "number" })).toBe(true);
    expect(scalarTypesEqual({ kind: "string" }, { kind: "string" })).toBe(true);
    expect(scalarTypesEqual({ kind: "boolean" }, { kind: "boolean" })).toBe(true);
  });

  it("rejects mismatched kinds", () => {
    expect(scalarTypesEqual({ kind: "number" }, { kind: "string" })).toBe(false);
    expect(scalarTypesEqual({ kind: "boolean" }, { kind: "choice", options: ["a"] })).toBe(false);
  });

  it("requires identical choice options and order", () => {
    const right = { kind: "choice", options: ["right", "left"] } as const;
    const sameOrder = { kind: "choice", options: ["right", "left"] } as const;
    const reordered = { kind: "choice", options: ["left", "right"] } as const;
    const superset = { kind: "choice", options: ["right", "left", "center"] } as const;

    expect(scalarTypesEqual(right, sameOrder)).toBe(true);
    expect(scalarTypesEqual(right, reordered)).toBe(false);
    expect(scalarTypesEqual(right, superset)).toBe(false);
  });
});

describe("scalarValueMatchesType", () => {
  it("matches primitive kinds regardless of value contents", () => {
    expect(scalarValueMatchesType({ kind: "number" }, { kind: "number", value: 12 })).toBe(true);
    expect(scalarValueMatchesType({ kind: "string" }, { kind: "string", value: "" })).toBe(true);
    expect(scalarValueMatchesType({ kind: "boolean" }, { kind: "boolean", value: false })).toBe(true);
  });

  it("rejects a value whose kind differs from the declared type", () => {
    expect(scalarValueMatchesType({ kind: "number" }, { kind: "string", value: "12" })).toBe(false);
  });

  it("requires the choice value to be a declared option with matching option identity", () => {
    const type: ScalarType = { kind: "choice", options: ["right", "left"] };
    expect(scalarValueMatchesType(type, { kind: "choice", value: "right", options: ["right", "left"] })).toBe(true);
    expect(scalarValueMatchesType(type, { kind: "choice", value: "center", options: ["right", "left"] })).toBe(false);
    expect(scalarValueMatchesType(type, { kind: "choice", value: "right", options: ["left", "right"] })).toBe(false);
  });
});
