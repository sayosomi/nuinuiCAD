import { describe, expect, it } from "vitest";
import {
  isAssignableToPropertyCapability,
  isChoiceOptionMember,
  isScalarTypeAssignable,
  scalarValueSatisfiesPropertyCapability,
  type PropertyBindingCapability
} from "./scalarAssignability";
import type { ChoiceScalarType, ScalarType, ScalarValue } from "./types";

describe("isScalarTypeAssignable", () => {
  it("allows only exact-match assignment between bindings, with no widening", () => {
    const right: ScalarType = { kind: "choice", options: ["right", "left"] };
    const rightSuperset: ScalarType = { kind: "choice", options: ["right", "left", "center"] };

    expect(isScalarTypeAssignable({ kind: "number" }, { kind: "number" })).toBe(true);
    expect(isScalarTypeAssignable({ kind: "number" }, { kind: "string" })).toBe(false);
    expect(isScalarTypeAssignable(right, right)).toBe(true);
    // Subset assignment is a property-only rule; normal binding assignment
    // never allows it, even though `right`'s options are a subset of
    // `rightSuperset`'s.
    expect(isScalarTypeAssignable(right, rightSuperset)).toBe(false);
    expect(isScalarTypeAssignable(rightSuperset, right)).toBe(false);
  });
});

describe("isChoiceOptionMember", () => {
  it("checks literal membership in declared options", () => {
    const type: ChoiceScalarType = { kind: "choice", options: ["right", "left"] };
    expect(isChoiceOptionMember(type, "right")).toBe(true);
    expect(isChoiceOptionMember(type, "center")).toBe(false);
  });
});

describe("isAssignableToPropertyCapability", () => {
  it("requires exact kind match for non-choice properties", () => {
    const numberCapability: PropertyBindingCapability = { propertyType: { kind: "number" } };
    expect(isAssignableToPropertyCapability({ kind: "number" }, numberCapability)).toBe(true);
    expect(isAssignableToPropertyCapability({ kind: "string" }, numberCapability)).toBe(false);
  });

  it("allows a choice binding whose options are a subset of the property's options", () => {
    const sideCapability: PropertyBindingCapability = {
      propertyType: { kind: "choice", options: ["right", "left", "center"] }
    };
    const bindingSubset: ScalarType = { kind: "choice", options: ["right", "left"] };
    // Subset assignment does not require matching order (D07).
    const bindingSubsetReordered: ScalarType = { kind: "choice", options: ["left", "right"] };

    expect(isAssignableToPropertyCapability(bindingSubset, sideCapability)).toBe(true);
    expect(isAssignableToPropertyCapability(bindingSubsetReordered, sideCapability)).toBe(true);
  });

  it("rejects a choice binding with an option the property does not declare", () => {
    const sideCapability: PropertyBindingCapability = {
      propertyType: { kind: "choice", options: ["right", "left"] }
    };
    const bindingSuperset: ScalarType = { kind: "choice", options: ["right", "left", "center"] };
    const bindingDisjoint: ScalarType = { kind: "choice", options: ["up", "down"] };

    expect(isAssignableToPropertyCapability(bindingSuperset, sideCapability)).toBe(false);
    expect(isAssignableToPropertyCapability(bindingDisjoint, sideCapability)).toBe(false);
  });

  it("rejects mismatched kinds even when one side is choice", () => {
    const sideCapability: PropertyBindingCapability = {
      propertyType: { kind: "choice", options: ["right", "left"] }
    };
    expect(isAssignableToPropertyCapability({ kind: "string" }, sideCapability)).toBe(false);
  });
});

describe("scalarValueSatisfiesPropertyCapability", () => {
  it("requires exact kind match for non-choice properties", () => {
    const booleanCapability: PropertyBindingCapability = { propertyType: { kind: "boolean" } };
    expect(scalarValueSatisfiesPropertyCapability({ kind: "boolean", value: true }, booleanCapability)).toBe(true);
    expect(scalarValueSatisfiesPropertyCapability({ kind: "number", value: 1 }, booleanCapability)).toBe(false);
  });

  it("accepts a runtime choice value from a binding whose declared type is a narrower subset than the property", () => {
    const sideCapability: PropertyBindingCapability = {
      propertyType: { kind: "choice", options: ["right", "left"] }
    };
    // The binding's own declared type only ever has "right" as an option -
    // scalarValueMatchesType would reject this (option lists differ), but
    // this function only checks the runtime literal against the property's
    // own accepted options (D07's subset-assignment rule).
    const narrowBindingValue: ScalarValue = { kind: "choice", value: "right", options: ["right"] };
    expect(scalarValueSatisfiesPropertyCapability(narrowBindingValue, sideCapability)).toBe(true);
  });

  it("rejects a choice value not in the property's own option set", () => {
    const sideCapability: PropertyBindingCapability = {
      propertyType: { kind: "choice", options: ["right", "left"] }
    };
    const outOfRangeValue: ScalarValue = { kind: "choice", value: "center", options: ["right", "left", "center"] };
    expect(scalarValueSatisfiesPropertyCapability(outOfRangeValue, sideCapability)).toBe(false);
  });
});
