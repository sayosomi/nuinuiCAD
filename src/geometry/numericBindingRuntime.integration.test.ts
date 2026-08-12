import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { buildNumericBindingRuntimeEntries } from "./numericBindingRuntime";
import { evaluateElements, type EvaluateElementsOptions } from "./evaluate";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

const optionsFor = (compiled: LastGoodDslDocument): EvaluateElementsOptions => ({
  scalarProgram: compiled.scalarProgram,
  bindingVersions: compiled.bindingVersions,
  statementInfoByElementId: compiled.statementMap.byElementId,
  statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
  numericBindingEntries: buildNumericBindingRuntimeEntries({
    numericBindings: compiled.numericBindings ?? new Map(),
    elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex
  }, compiled.document.elements)
});

const point = (compiled: LastGoodDslDocument, name: string) => {
  const element = compiled.document.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing ${name}`);
  return element;
};

describe("general numeric typed binding runtime", () => {
  it("evaluates a BindingId-compiled typed number in coordinate x", () => {
    const compiled = compile(["nui 3", "const length: number = 12.3456", "point B = coordinate(x: @length, y: 0)"].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const geometry = result.computedGeometry.get(point(compiled, "B").id) as { x: number };
    expect(result.errors).toEqual([]);
    expect(geometry.x).toBe(12.3456);
  });

  it("uses the current version at each geometry statement", () => {
    const compiled = compile([
      "nui 3",
      "let length: number = 2",
      "point Before = coordinate(x: @length, y: 0)",
      "set length = 9",
      "point After = coordinate(x: @length, y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect((result.computedGeometry.get(point(compiled, "Before").id) as { x: number }).x).toBe(2);
    expect((result.computedGeometry.get(point(compiled, "After").id) as { x: number }).x).toBe(9);
  });

  it("gives an element-local numeric variable precedence over a same-named document typed binding (Task 52 B1/B2)", () => {
    const compiled = compile([
      "nui 3",
      "const 幅: number = 100",
      "point P = coordinate(x: @幅, y: 0, vars: [幅: 5])"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect((result.computedGeometry.get(point(compiled, "P").id) as { x: number }).x).toBe(5);
    // The x expression stays an untouched raw numeric expression (never
    // typed-materialized): the local binding shadows the document typed
    // binding at the compile-time classification layer, not at runtime.
    expect(compiled.numericBindings?.size ?? 0).toBe(0);
  });

  it("keeps legacy measurement tokens in the existing numeric evaluator (nui 3 sigil form, Task 51)", () => {
    const compiled = compile([
      "nui 3",
      "const offset: number = 2",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "line AB = segment(start: @A, end: @B)",
      "point C = coordinate(x: @offset + @AB.length, y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect((result.computedGeometry.get(point(compiled, "C").id) as { x: number }).x).toBe(7);
  });

  describe("Rule R self-reference fall-through (review fix: no more `continue` on self-name)", () => {
    it("compiles @A.length (no local variable at all) to sigil-free self-referencing IR and fails at evaluation, not normalize", () => {
      const compiled = compile(["nui 3", "point A = coordinate(x: 0, y: @A.length)"].join("\n"));
      const a = point(compiled, "A");
      const yValue = a.type === "freePoint" ? a.y : undefined;
      expect(yValue).toEqual({ kind: "expression", expression: `${a.id}.length` });

      const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(result.errors).toEqual([
        expect.objectContaining({
          elementId: a.id,
          message: `A の数値式を評価できません。A はこの要素より後にあるか、存在しません。`
        })
      ]);
    });

    it("compiles @A.w (two local variables both named w) to sigil-free self-referencing IR and fails at evaluation the same way", () => {
      const compiled = compile([
        "nui 3",
        "point A = coordinate(x: 0, y: @A.w, vars: [w: 1; w: 2])"
      ].join("\n"));
      const a = point(compiled, "A");
      const yValue = a.type === "freePoint" ? a.y : undefined;
      expect(yValue).toEqual({ kind: "expression", expression: `${a.id}.w` });

      const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(result.errors).toEqual([
        expect.objectContaining({
          elementId: a.id,
          message: `A の数値式を評価できません。A はこの要素より後にあるか、存在しません。`
        })
      ]);
    });

    it("still resolves to the local variable when exactly one matches (unchanged by the review fix)", () => {
      // A field of the *same* statement (x:/y:) is normalized before vars:
      // is applied (dslApplyArgs.ts processes vars: in a later phase
      // regardless of source order - a pre-existing, unrelated ordering
      // constraint), so self-qualification only ever resolves within
      // vars: itself: the second entry can reference the first by @Self.name
      // exactly as nui3-element-local-variable-collision.nui's parity
      // fixture already relies on. This is what proves Rule R(1) still
      // wins when exactly one local variable matches.
      const compiled = compile([
        "nui 3",
        "point A = coordinate(x: 0, y: 0, vars: [w: 42; doubled: @A.w * 2])"
      ].join("\n"));
      const a = point(compiled, "A");
      const doubled = a.type === "freePoint" ? a.numericVariables?.[1] : undefined;
      // Rule R(1) still converts the self-qualified reference to the local
      // variable's own id (not an element-property IR) when exactly one
      // "w" exists - proving the review fix did not disturb the success case.
      expect(doubled?.value).toEqual({ kind: "expression", expression: "@local-variable-1 * 2" });
      const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(result.errors).toEqual([]);
    });
  });
});
