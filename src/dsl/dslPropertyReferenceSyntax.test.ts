import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import { BARE_PROPERTY_REFERENCE_CODE } from "./expressionReferenceToken";
import { propertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";

const errorsOf = (source: string) =>
  compileDslDocument(source).diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const assignedStatementIds = (source: string) =>
  new Map(parseDsl(source).statements.map((_, index) => [index, `test:${index}`]));

describe("nui 4 bare element-property reference diagnostic (Task 51)", () => {
  it("accepts the acceptance-critical sigil form in a coordinate() numeric attribute", () => {
    const source = [
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "point C = coordinate(x: @AB.length, y: 0)"
    ].join("\n");
    const result = compileDslDocument(source);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.document).not.toBeNull();
    const point = result.document!.elements.find((element) => element.name === "C" && element.type === "freePoint");
    expect(point).toMatchObject({ x: { kind: "expression", expression: expect.stringContaining("length") } });
  });

  it("flags a bare Element.property reference in a number attribute", () => {
    const source = [
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "point C = coordinate(x: AB.length, y: 0)"
    ].join("\n");
    const errors = errorsOf(source);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(BARE_PROPERTY_REFERENCE_CODE);
    expect(errors[0].message).toContain("@AB.length");
  });

  it("rejects a bare reference in a conditional condition", () => {
    const source = [
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "if (AB.length > 0) {",
      "  point C = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const errors = errorsOf(source);
    expect(errors.some((error) => error.code === BARE_PROPERTY_REFERENCE_CODE)).toBe(true);
  });

  it("accepts the sigil form in a conditional condition", () => {
    const source = [
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "if (@AB.length > 0) {",
      "  point C = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const errors = errorsOf(source);
    expect(errors).toEqual([]);
  });

  it("accepts a geometry property reference in a const number initializer", () => {
    const source = [
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "const x: number = @AB.length"
    ].join("\n");
    const errors = compileDslDocument(source, { assignedStatementIds: new Map([[2, "test:x"]]) }).diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error"
    );
    expect(errors).toEqual([]);
  });

  it("accepts a geometry property reference in a let initializer", () => {
    const source = [
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "let x: number = @AB.length"
    ].join("\n");
    const errors = compileDslDocument(source, { assignedStatementIds: new Map([[2, "test:x"]]) }).diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error"
    );
    expect(errors).toEqual([]);
  });

  it("accepts scoped geometry properties in const and let initializers", () => {
    const oneLevel = [
      "nui 4",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "const x: number = @G::AB.length"
    ].join("\n");
    const nested = [
      "nui 4",
      "group G {",
      "  group H {",
      "    line AB = segment(start: (0, 0), end: (10, 0))",
      "  }",
      "}",
      "let x: number = @G::H::AB.length"
    ].join("\n");

    expect(compileDslDocument(oneLevel, { assignedStatementIds: assignedStatementIds(oneLevel) }).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compileDslDocument(nested, { assignedStatementIds: assignedStatementIds(nested) }).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("accepts a scoped reference without a geometry property at the frontend boundary", () => {
    const source = ["nui 4", "const x: number = @G::AB"].join("\n");
    const errors = compileDslDocument(source, { assignedStatementIds: assignedStatementIds(source) }).diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error"
    );
    expect(errors).toEqual([]);
  });

  it("keeps unresolved scoped paths as precise geometry-property diagnostics", () => {
    const source = ["nui 4", "const x: number = @G::Missing.length"].join("\n");
    const error = compileDslDocument(source, { assignedStatementIds: assignedStatementIds(source) }).diagnostics.find(
      (diagnostic) => diagnostic.severity === "error"
    );
    expect(error).toMatchObject({ code: "geometry-property-invalid", column: source.split("\n")[1].indexOf("G") + 1 });
    const segment = error?.physicalSpan?.segments[0];
    expect(segment && source.slice(segment.from, segment.to)).toBe("G::Missing");
  });

  it("accepts a geometry property reference in a number set RHS", () => {
    const source = [
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "let x: number = 0",
      "set x = @AB.length"
    ].join("\n");
    const errors = compileDslDocument(source, {
      assignedStatementIds: new Map([[2, "test:x"], [3, "test:set-x"]])
    }).diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    expect(errors).toEqual([]);
  });

  it("compiles public choice geometry properties through declarations, equality, and set", () => {
    const source = [
      "nui 4",
      "arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "const direction: choice(counterclockwise, clockwise) = @A.direction",
      "const isClockwise: boolean = @A.direction == clockwise",
      "if (@A.direction == clockwise) {",
      "  point Marker = coordinate(x: 0, y: 0)",
      "}",
      "let copied: choice(counterclockwise, clockwise) = counterclockwise",
      "set copied = @A.direction"
    ].join("\n");
    const result = compileDslDocument(source, { assignedStatementIds: assignedStatementIds(source) });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.scalarProgram).toBeDefined();
  });

  it("carries an exact non-arc choice geometry property into a compatible property binding", () => {
    const source = [
      "nui 4",
      "const _unused: number = 0",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@Base], distance: 10, side: right, closed: false, suppressTrimWarnings: false)",
      "line Off2 = offset(sources: [@Base], distance: 20, side: @Off.side, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const result = compileDslDocument(source, { assignedStatementIds: assignedStatementIds(source) });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.propertyBindings?.get(propertyBindingOccurrenceKey(6, "side"))).toMatchObject({
      kind: "expression",
      type: { kind: "choice", options: ["right", "left"] },
      expression: {
        kind: "geometryProperty",
        property: "side",
        targetSourceOrder: 5,
        type: { kind: "choice", options: ["right", "left"] }
      }
    });
  });

  it("rejects a choice geometry property in a number-only property context", () => {
    const source = [
      "nui 4",
      "arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "point P = coordinate(x: @A.direction, y: 0)"
    ].join("\n");
    const errors = errorsOf(source);
    expect(errors.some((error) => error.message.includes("choice"))).toBe(true);
  });

  it("reports an unknown typed geometry property target at compile time", () => {
    const source = ["nui 4", "const x: number = @Missing.length"].join("\n");
    const errors = compileDslDocument(source, { assignedStatementIds: new Map([[1, "test:x"]]) }).diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error"
    );
    expect(errors).toMatchObject([{ code: "geometry-property-invalid" }]);
  });

  it("reports an unknown typed geometry property at compile time", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "const x: number = @A.notAProperty"
    ].join("\n");
    const errors = compileDslDocument(source, { assignedStatementIds: new Map([[2, "test:x"]]) }).diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error"
    );
    expect(errors).toMatchObject([{ code: "geometry-property-invalid" }]);
  });

  it("does not offer a bare-form diagnostic for a typed initializer (the typed tokenizer's own diagnostic owns it)", () => {
    const source = [
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
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

  it("returns, document: null when the bare-reference diagnostic fires (no silent evaluation)", () => {
    const source = [
      "nui 4",
      "line AB = segment(start: (0, 0), end: (10, 0))",
      "point C = coordinate(x: AB.length, y: 0)"
    ].join("\n");
    expect(compileDslDocument(source).document).toBeNull();
  });
});
