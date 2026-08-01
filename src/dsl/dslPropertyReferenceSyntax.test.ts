import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { BARE_PROPERTY_REFERENCE_CODE } from "./expressionReferenceToken";

const errorsOf = (source: string) =>
  compileDslDocument(source).diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("nui 3 bare element-property reference diagnostic (Task 51)", () => {
  it("accepts the acceptance-critical sigil form in a coordinate() numeric attribute", () => {
    const source = [
      "nui 3",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "point C = coordinate(x: @AB.length y: 0)"
    ].join("\n");
    const result = compileDslDocument(source);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.document).not.toBeNull();
    const point = result.document!.elements.find((element) => element.name === "C" && element.type === "freePoint");
    expect(point).toMatchObject({ x: { kind: "expression", expression: expect.stringContaining("length") } });
  });

  it("flags a bare Element.property reference in a number attribute", () => {
    const source = [
      "nui 3",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "point C = coordinate(x: AB.length y: 0)"
    ].join("\n");
    const errors = errorsOf(source);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(BARE_PROPERTY_REFERENCE_CODE);
    expect(errors[0].message).toContain("@AB.length");
  });

  it("flags a bare reference in var NAME = expr", () => {
    const source = ["nui 3", "line AB = segment(start: (0, 0) end: (10, 0))", "var v = expression(value: AB.length)"].join("\n");
    const errors = errorsOf(source);
    expect(errors.some((error) => error.code === BARE_PROPERTY_REFERENCE_CODE)).toBe(true);
  });

  it("flags a bare reference inside a vars=[...] record", () => {
    const source = [
      "nui 3",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "point C = coordinate(x: 0 y: 0 vars: [w: AB.length])"
    ].join("\n");
    const errors = errorsOf(source);
    expect(errors.some((error) => error.code === BARE_PROPERTY_REFERENCE_CODE)).toBe(true);
  });

  it("flags a bare reference in a legacy conditionalGroup condition", () => {
    const source = [
      "nui 3",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "if 条件 (AB.length > 0) {",
      "  point C = coordinate(x: 0 y: 0)",
      "}"
    ].join("\n");
    const errors = errorsOf(source);
    expect(errors.some((error) => error.code === BARE_PROPERTY_REFERENCE_CODE)).toBe(true);
  });

  it("accepts the sigil form in a legacy conditionalGroup condition", () => {
    const source = [
      "nui 3",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "if 条件 (@AB.length > 0) {",
      "  point C = coordinate(x: 0 y: 0)",
      "}"
    ].join("\n");
    const errors = errorsOf(source);
    expect(errors).toEqual([]);
  });

  it("does not flag anything in a nui 2 document (nui 2 is unaffected)", () => {
    const source = [
      "nui 2",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "point C = coordinate(x: AB.length y: 0)"
    ].join("\n");
    const errors = errorsOf(source);
    expect(errors).toEqual([]);
  });

  it("rejects a geometry property reference in a const initializer with a dedicated phase diagnostic, not the generic lexer error (Task 51 / D2)", () => {
    const source = [
      "nui 3",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "const x: number = @AB.length"
    ].join("\n");
    const errors = compileDslDocument(source, { assignedStatementIds: new Map([[2, "test:x"]]) }).diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error"
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("geometry-property-in-typed-expression");
    expect(errors[0].message).not.toContain("unexpected character");
  });

  it("rejects a geometry property reference in a let initializer the same way", () => {
    const source = [
      "nui 3",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "let x: number = @AB.length"
    ].join("\n");
    const errors = compileDslDocument(source, { assignedStatementIds: new Map([[2, "test:x"]]) }).diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error"
    );
    expect(errors.some((error) => error.code === "geometry-property-in-typed-expression")).toBe(true);
  });

  it("rejects a geometry property reference in a set RHS the same way", () => {
    const source = [
      "nui 3",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "let x: number = 0",
      "set x = @AB.length"
    ].join("\n");
    const errors = compileDslDocument(source, {
      assignedStatementIds: new Map([[2, "test:x"], [3, "test:set-x"]])
    }).diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    expect(errors.some((error) => error.code === "geometry-property-in-typed-expression")).toBe(true);
  });

  it("does not offer a bare-form diagnostic for a typed initializer (the typed tokenizer's own diagnostic owns it)", () => {
    const source = [
      "nui 3",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "const x: number = AB.length"
    ].join("\n");
    const errors = compileDslDocument(source, { assignedStatementIds: new Map([[2, "test:x"]]) }).diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error"
    );
    // Bare `AB.length` in a typed initializer is not valid scalar-expression
    // syntax at all (the typed tokenizer rejects the bare identifier form
    // the same way it always has - a `.` after a bare word is not part of
    // this grammar); this must not be double-reported by the property
    // reference syntax pass, which only walks numeric (legacy) expression
    // parameter values, never typed declaration initializers.
    expect(errors.filter((error) => error.code === "property-reference-requires-sigil")).toEqual([]);
  });

  it("returns document: null when the bare-reference diagnostic fires (no silent evaluation)", () => {
    const source = [
      "nui 3",
      "line AB = segment(start: (0, 0) end: (10, 0))",
      "point C = coordinate(x: AB.length y: 0)"
    ].join("\n");
    expect(compileDslDocument(source).document).toBeNull();
  });
});
