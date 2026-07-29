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
    const compiled = compile(["nui 3", "const length: number = 12.3456", "point B = coordinate(x: @length y: 0)"].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const geometry = result.computedGeometry.get(point(compiled, "B").id) as { x: number };
    expect(result.errors).toEqual([]);
    expect(geometry.x).toBe(12.3456);
  });

  it("uses the current version at each geometry statement", () => {
    const compiled = compile([
      "nui 3",
      "let length: number = 2",
      "point Before = coordinate(x: @length y: 0)",
      "set length = 9",
      "point After = coordinate(x: @length y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect((result.computedGeometry.get(point(compiled, "Before").id) as { x: number }).x).toBe(2);
    expect((result.computedGeometry.get(point(compiled, "After").id) as { x: number }).x).toBe(9);
  });

  it("keeps legacy measurement tokens in the existing numeric evaluator", () => {
    const compiled = compile([
      "nui 3",
      "const offset: number = 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 3 y: 4)",
      "line AB = segment(start: A end: B)",
      "point C = coordinate(x: @offset + AB.length y: 0)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect((result.computedGeometry.get(point(compiled, "C").id) as { x: number }).x).toBe(7);
  });
});
