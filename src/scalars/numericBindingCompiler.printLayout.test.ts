import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { NUMERIC_BINDING_TYPE_MISMATCH_CODE, NUMERIC_BINDING_UNRESOLVED_CODE } from "./numericBindingCompiler";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 4), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

describe("compileNumericBindings: printLayout/place", () => {
  it("resolves a typed const number reference in printLayout scale", () => {
    const compiled = compile([
      "nui 4",
      "const printScale: number = 120",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @printScale, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const source = compiled.numericBindings?.get("2:scale");
    expect(source).toBeDefined();
    expect(source!.references).toHaveLength(1);
    expect(source!.references[0].name).toBe("printScale");
  });

  it("resolves a typed let number reference the same way", () => {
    const compiled = compile([
      "nui 4",
      "let overlap: number = 15",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: @overlap, scale: 1, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.numericBindings?.get("2:overlap")).toBeDefined();
  });

  it("compiles a ref-free printLayout arithmetic expression as typed", () => {
    const compiled = compile([
      "nui 4",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 2 ^ -2, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    const binding = compiled.numericBindings?.get("1:scale");
    expect(binding).toBeDefined();
    expect(binding?.references).toHaveLength(0);
    expect(binding?.typedExpression).toBeDefined();
  });

  it("compiles ref-free place arithmetic fields as typed", () => {
    const compiled = compile([
      "nui 4",
      "point Origin = coordinate(x: 0, y: 0)",
      "group G (printEnabled: true, printAnchor: @Origin) {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "  place @G(x: 2 ^ 3, y: 5 % 3, angle: 0, mirrorX: false)",
      "}"
    ].join("\n"));
    const bindings = [...(compiled.numericBindings?.values() ?? [])];
    expect(bindings.find((binding) => binding.parameterKey === "x")).toMatchObject({ references: [], typedExpression: expect.any(Object) });
    expect(bindings.find((binding) => binding.parameterKey === "y")).toMatchObject({ references: [], typedExpression: expect.any(Object) });
  });

  it("rejects a string-typed binding referenced in a numeric printLayout field", () => {
    const compiled = compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 4),
      [
        "nui 4",
        'const label: string = "x"',
        "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @label, canvas: (410, 584)) {",
        "}"
      ].join("\n")
    );
    expect(compiled.status).toBe("fatal");
    if (compiled.status !== "fatal") throw new Error("expected fatal");
    expect(compiled.diagnostics.some((item) => item.code === NUMERIC_BINDING_TYPE_MISMATCH_CODE)).toBe(true);
  });

  it("resolves coordinate-decomposed canvas x/y separately", () => {
    const compiled = compile([
      "nui 4",
      "const w: number = 500",
      "const h: number = 700",
      "printLayout Main (output: svg, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (@w, @h)) {",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.numericBindings?.get("3:canvas:x")?.references[0].name).toBe("w");
    expect(compiled.numericBindings?.get("3:canvas:y")?.references[0].name).toBe("h");
  });

  it("resolves place's angle and at:x/at:y attributes", () => {
    const compiled = compile([
      "nui 4",
      "const ang: number = 45",
      "const offsetX: number = 10",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "  place @G(at: (@offsetX, 0), angle: @ang, mirrorX: false)",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const keys = compiled.numericBindings ? [...compiled.numericBindings.keys()] : [];
    expect(keys.some((key) => key.endsWith(":angle"))).toBe(true);
    expect(keys.some((key) => key.endsWith(":at:x"))).toBe(true);
  });

  it("diagnoses an out-of-scope reference to a binding declared inside a group's local scope (not visible at root)", () => {
    const compiled = compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 4),
      [
        "nui 4",
        "group G {",
        "  let inner: number = 5",
        "  point A = coordinate(x: @inner, y: 0)",
        "}",
        "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @inner, canvas: (410, 584)) {",
        "}"
      ].join("\n")
    );
    // Group-inner `inner` is invisible from printLayout's root scope. This
    // must be a compile-time diagnostic, not a silent "stays in the legacy
    // numeric evaluator, fails at runtime with a default value" fallback.
    expect(compiled.status).toBe("fatal");
    if (compiled.status !== "fatal") throw new Error("expected fatal");
    expect(compiled.diagnostics.some((item) => item.code === NUMERIC_BINDING_UNRESOLVED_CODE)).toBe(true);
  });

  it("diagnoses a fully unresolved @name in printLayout's scale (undeclared, not just out of scope)", () => {
    const compiled = compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 4),
      [
        "nui 4",
        "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @nope, canvas: (410, 584)) {",
        "}"
      ].join("\n")
    );
    expect(compiled.status).toBe("fatal");
    if (compiled.status !== "fatal") throw new Error("expected fatal");
    expect(compiled.diagnostics.some((item) => item.code === NUMERIC_BINDING_UNRESOLVED_CODE)).toBe(true);
  });

  it("diagnoses a fully unresolved @name in place's angle", () => {
    const compiled = compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 4),
      [
        "nui 4",
        "group G {",
        "  point A = coordinate(x: 0, y: 0)",
        "}",
        "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
        "  place @G(at: (0, 0), angle: @nope, mirrorX: false)",
        "}"
      ].join("\n")
    );
    expect(compiled.status).toBe("fatal");
    if (compiled.status !== "fatal") throw new Error("expected fatal");
    expect(compiled.diagnostics.some((item) => item.code === NUMERIC_BINDING_UNRESOLVED_CODE)).toBe(true);
  });

  it("lowers a bare @Element.property reference in printLayout's scale to typed geometry", () => {
    const compiled = compile([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @AB.length, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const binding = compiled.numericBindings?.get("4:scale");
    expect(binding).toBeDefined();
    expect(binding?.references).toHaveLength(0);
    expect(binding?.typedExpression).toMatchObject({ kind: "geometryProperty", elementId: expect.any(String), property: "length" });
  });

  it("lowers a scoped geometry property in printLayout's scale to a stable typed target", () => {
    const compiled = compile([
      "nui 4",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @G::AB.length, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const binding = [...(compiled.numericBindings?.values() ?? [])].find((candidate) => candidate.parameterKey === "scale");
    expect(binding).toBeDefined();
    expect(binding?.references).toHaveLength(0);
    expect(binding?.typedExpression).toMatchObject({ kind: "geometryProperty", elementId: expect.any(String), property: "length" });
  });

  it("does not resolve a qualified path as a typed binding before namespace semantics", () => {
    const compiled = compile([
      "nui 4",
      "const keep: number = 1",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @G::AB, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.some((item) => item.code === NUMERIC_BINDING_UNRESOLVED_CODE)).toBe(false);
    expect(compiled.numericBindings?.size ?? 0).toBe(0);
  });

  it("resolves the typed reference and does not diagnose when @Element.property and @typedNumber are mixed", () => {
    const compiled = compile([
      "nui 4",
      "const printScale: number = 2",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @AB.length+@printScale, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const source = compiled.numericBindings?.get("5:scale");
    expect(source).toBeDefined();
    expect(source!.references.map((reference) => reference.name)).toEqual(["printScale"]);
    expect(source!.typedExpression).toBeDefined();
  });

  it("diagnoses the unresolved reference specifically when an unresolved and a valid typed reference are mixed", () => {
    const compiled = compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 4),
      [
        "nui 4",
        "const validTyped: number = 3",
        "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @nope+@validTyped, canvas: (410, 584)) {",
        "}"
      ].join("\n")
    );
    expect(compiled.status).toBe("fatal");
    if (compiled.status !== "fatal") throw new Error("expected fatal");
    const unresolved = compiled.diagnostics.filter((item) => item.code === NUMERIC_BINDING_UNRESOLVED_CODE);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].message).toContain("nope");
  });

  it("also diagnoses a fully unresolved @name in an ordinary element numeric field (shared compiler, not printLayout-specific)", () => {
    const compiled = compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 4),
      // A typed declaration must exist somewhere in the document for scalar
      // analysis to run at all (a document with zero typedDeclaration/set/
      // reverse/printLayout statements never builds a binding catalog in the
      // first place - out of scope for this fix, which targets the reported
      // printLayout/place regression specifically).
      ["nui 4", "const irrelevant: number = 1", "point A = coordinate(x: @nope, y: 0)"].join("\n")
    );
    expect(compiled.status).toBe("fatal");
    if (compiled.status !== "fatal") throw new Error("expected fatal");
    expect(compiled.diagnostics.some((item) => item.code === NUMERIC_BINDING_UNRESOLVED_CODE)).toBe(true);
  });
});
