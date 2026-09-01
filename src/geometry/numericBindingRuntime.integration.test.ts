import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { buildNumericBindingRuntimeEntries } from "./numericBindingRuntime";
import { evaluateElements, type EvaluateElementsOptions } from "./evaluate";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
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
  it.each([
    ["2 ^ 3", 8],
    ["5 % 3", 2],
    ["2 ^ 3 ^ 2", 512],
    ["-2 ^ 2", -4],
    ["2 ^ -2", 0.25]
  ])("keeps ref-free typed arithmetic in the runtime for %s", (expression, expected) => {
    const compiled = compile(["nui 1", `point P = coordinate(x: ${expression}, y: 0)`].join("\n"));
    const binding = [...(compiled.numericBindings?.values() ?? [])].find((candidate) => candidate.parameterKey === "x");
    expect(binding?.typedExpression).toBeDefined();
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect((result.computedGeometry.get(point(compiled, "P").id) as { x: number }).x).toBe(expected);
  });

  it("keeps remainder by zero on the typed runtime failure path", () => {
    const compiled = compile(["nui 1", "point P = coordinate(x: 5 % 0, y: 0)"].join("\n"));
    const binding = [...(compiled.numericBindings?.values() ?? [])].find((candidate) => candidate.parameterKey === "x");
    expect(binding?.typedExpression).toBeDefined();
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([expect.objectContaining({ elementId: point(compiled, "P").id })]);
  });

  it("evaluates a BindingId-compiled typed number in coordinate x", () => {
    const compiled = compile(["nui 1", "const length: number = 12.3456", "point B = coordinate(x: @length, y: 0)"].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const geometry = result.computedGeometry.get(point(compiled, "B").id) as { x: number };
    expect(result.errors).toEqual([]);
    expect(geometry.x).toBe(12.3456);
  });

  it("keeps arithmetic typed-number construction arguments numeric", () => {
    const compiled = compile([
      "nui 1",
      "const offset: number = 3",
      "point B = coordinate(x: @offset + 2, y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const geometry = result.computedGeometry.get(point(compiled, "B").id) as { x: number };
    expect(result.errors).toEqual([]);
    expect(geometry.x).toBe(5);
  });

  it("uses the current version at each geometry statement", () => {
    const compiled = compile([
      "nui 1",
      "let length: number = 2",
      "point Before = coordinate(x: @length, y: 0)",
      "set length = 9",
      "point After = coordinate(x: @length, y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect((result.computedGeometry.get(point(compiled, "Before").id) as { x: number }).x).toBe(2);
    expect((result.computedGeometry.get(point(compiled, "After").id) as { x: number }).x).toBe(9);
  });

  it("keeps legacy measurement tokens in the existing numeric evaluator (nui 1 sigil form, Task 51)", () => {
    const compiled = compile([
      "nui 1",
      "const offset: number = 2",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "line AB = segment(start: @A, end: @B)",
      "point C = coordinate(x: @offset + @AB.length, y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect((result.computedGeometry.get(point(compiled, "C").id) as { x: number }).x).toBe(7);
    const binding = [...(compiled.numericBindings?.values() ?? [])].find((candidate) => candidate.parameterKey === "x");
    expect(binding?.typedExpression).toBeDefined();
  });

  describe("Rule R self-reference fall-through (review fix: no more `continue` on self-name)", () => {
    it("compiles @A.length (no typed binding) to sigil-free self-referencing IR and fails at evaluation, not normalize", () => {
      const compiled = compile(["nui 1", "point A = coordinate(x: 0, y: @A.length)"].join("\n"));
      const a = point(compiled, "A");
      const yValue = a.type === "freePoint" ? a.y : undefined;
      expect(yValue).toEqual({ kind: "expression", expression: `${a.id}.length` });

      const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
      expect(result.errors).toEqual([
        expect.objectContaining({
          elementId: a.id,
          message: "A の数値式を評価できません。A.length はこのgeometry targetでは公開されていません。"
        })
      ]);
    });

  });
});
