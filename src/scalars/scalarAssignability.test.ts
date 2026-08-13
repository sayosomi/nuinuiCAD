import { describe, expect, it } from "vitest";
import { isChoiceOptionMember, isScalarTypeAssignable } from "./scalarAssignability";
import type { ChoiceScalarType, ScalarType } from "./types";

describe("isScalarTypeAssignable", () => {
  it("allows only exact structural matches", () => {
    const choice: ScalarType = { kind: "choice", options: ["right", "left"] };
    const widerChoice: ScalarType = { kind: "choice", options: ["right", "left", "center"] };

    expect(isScalarTypeAssignable({ kind: "number" }, { kind: "number" })).toBe(true);
    expect(isScalarTypeAssignable({ kind: "number" }, { kind: "string" })).toBe(false);
    expect(isScalarTypeAssignable(choice, choice)).toBe(true);
    expect(isScalarTypeAssignable(choice, widerChoice)).toBe(false);
    expect(isScalarTypeAssignable(widerChoice, choice)).toBe(false);
  });
});

describe("isChoiceOptionMember", () => {
  it("checks literal membership in declared options", () => {
    const type: ChoiceScalarType = { kind: "choice", options: ["right", "left"] };
    expect(isChoiceOptionMember(type, "right")).toBe(true);
    expect(isChoiceOptionMember(type, "center")).toBe(false);
  });
});
