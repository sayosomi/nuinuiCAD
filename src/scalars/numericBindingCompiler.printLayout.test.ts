import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { NUMERIC_BINDING_TYPE_MISMATCH_CODE } from "./numericBindingCompiler";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

describe("compileNumericBindings: printLayout/place", () => {
  it("resolves a typed const number reference in printLayout scale", () => {
    const compiled = compile([
      "nui 3",
      "const printScale: number = 120",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @printScale, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const source = compiled.numericBindings?.get("2:scale");
    expect(source).toBeDefined();
    expect(source!.references).toHaveLength(1);
    expect(source!.references[0].name).toBe("printScale");
    expect(source!.references[0].site.elementLocal).toBeUndefined();
  });

  it("resolves a typed let number reference the same way", () => {
    const compiled = compile([
      "nui 3",
      "let overlap: number = 15",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: @overlap, scale: 1, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(compiled.numericBindings?.get("2:overlap")).toBeDefined();
  });

  it("rejects a string-typed binding referenced in a numeric printLayout field", () => {
    const compiled = compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 3),
      [
        "nui 3",
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
      "nui 3",
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
      "nui 3",
      "const ang: number = 45",
      "const offsetX: number = 10",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "  place G (at: (@offsetX, 0), angle: @ang, mirrorX: false)",
      "}"
    ].join("\n"));
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const keys = compiled.numericBindings ? [...compiled.numericBindings.keys()] : [];
    expect(keys.some((key) => key.endsWith(":angle"))).toBe(true);
    expect(keys.some((key) => key.endsWith(":at:x"))).toBe(true);
  });

  it("does not resolve a binding declared inside a group's local scope (not visible at root)", () => {
    const compiled = compile([
      "nui 3",
      "group G {",
      "  let inner: number = 5",
      "  point A = coordinate(x: @inner, y: 0)",
      "}",
      "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: @inner, canvas: (410, 584)) {",
      "}"
    ].join("\n"));
    // Group-inner `inner` is invisible from printLayout's root scope, so this
    // occurrence is never compiled into a typed BindingId reference here -
    // the same "stays in the legacy numeric evaluator, fails at runtime"
    // behavior as an element referencing an out-of-scope name (Task 53).
    expect(compiled.numericBindings?.get("5:scale")).toBeUndefined();
  });
});
