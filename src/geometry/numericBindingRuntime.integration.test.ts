import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { emptyDocument, recordFieldCollectionValueIdFor, recordValueCollectionIdFor } from "@nuinuicad/nui-language";
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
    elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex,
    materializedNumericBindings: compiled.materializedNumericBindings
  }, compiled.document.elements)
});

const point = (compiled: LastGoodDslDocument, name: string) => {
  const element = compiled.document.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing ${name}`);
  return element;
};

describe("general numeric typed binding runtime", () => {
  it.each([
    ["R(x: 7)", 7],
    ["none", 11]
  ] as const)("materializes a root optional record member initialized with %s in numeric geometry input", (initializer, expected) => {
    const compiled = compile([
      "nui 1",
      "record R(x: number)",
      `const value: R? = ${initializer}`,
      "point P = coordinate(x: @value?.x ?? 11, y: 0)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const pointElement = point(compiled, "P");
    const numeric = (compiled.materializedNumericBindings ?? []).find((entry) =>
      entry.elementId === pointElement.id && entry.binding.parameterKey === "x"
    )?.binding;
    expect(numeric?.typedExpression).toMatchObject({
      kind: "binary",
      left: { kind: "optionalMember", target: { kind: "recordField" } }
    });
    if (numeric?.typedExpression?.kind !== "binary" || numeric.typedExpression.left.kind !== "optionalMember") {
      throw new Error("expected a materialized typed optional-member expression");
    }
    const target = numeric.typedExpression.left.target;
    expect(target?.kind).toBe("recordField");
    if (initializer !== "none") {
      const recordValue = compiled.moduleSemanticAnalysis!.rootRecordValuesByStatementId.values().next().value;
      if (!recordValue || target?.kind !== "recordField") throw new Error("expected a compiler-resolved root record-field target");
      expect(target.collectionValueId).toBe(recordFieldCollectionValueIdFor(
        recordValueCollectionIdFor([], recordValue.value.statementId),
        target.field
      ));
      const fieldDefinition = compiled.sourceLexicalNamespace!.recordSemanticAnalysis!.definitionsByStatementId
        .get(target.field.recordStatementId)?.fields.find((field) => field.fieldIndex === target.field.fieldIndex);
      expect(fieldDefinition?.identity).toMatchObject({
        recordStatementId: target.field.recordStatementId,
        fieldIndex: target.field.fieldIndex
      });
      expect(target.targetSourceOrder).toBeGreaterThanOrEqual(0);
    }

    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect((result.computedGeometry.get(pointElement.id) as { x: number }).x).toBe(expected);
  });

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

  it("uses canonical iteration bindings for numeric collection members while keeping generated ordinals", () => {
    const compiled = compile([
      "nui 1",
      "const negative: number = -3",
      "const xs: number[] = [2, 7, @negative]",
      "for x in @xs {",
      "  point Mark = coordinate(x: @x, y: 0)",
      "}"
    ].join("\n"));
    const iterationBinding = compiled.bindingAnalysis?.catalog.bindings.find((binding) =>
      binding.kind === "iteration" && binding.name === "x"
    );
    const numericBinding = [...(compiled.numericBindings?.values() ?? [])].find((binding) =>
      binding.parameterKey === "x"
    );
    expect(iterationBinding?.declaredType).toEqual({ kind: "number" });
    expect(numericBinding?.typedExpression).toBeDefined();
    expect(numericBinding?.references.map((reference) => reference.bindingId)).toEqual([iterationBinding?.id]);

    const pointTemplate = point(compiled, "Mark");
    const runtimeEntries = buildNumericBindingRuntimeEntries({
      numericBindings: compiled.numericBindings ?? new Map(),
      elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex
    }, compiled.document.elements);
    expect(runtimeEntries.find((entry) => entry.elementId === pointTemplate.id && entry.parameterKey === "x")?.references[0]?.bindingId)
      .toBe(iterationBinding?.id);

    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    const rows = (result.forGroupGeneratedRows ?? []).filter((row) => row.elementName.includes("Mark"));
    expect(result.errors).toEqual([]);
    expect(rows.map((row) => row.iterationIndex)).toEqual([0, 1, 2]);
    expect(rows.map((row) => row.variableValue)).toEqual([0, 1, 2]);
    expect(rows.map((row) => row.occurrencePath.map((step) => step.iterationIndex))).toEqual([[0], [1], [2]]);
    expect(rows.map((row) => {
      const geometry = result.computedGeometry.get(row.generatedElementId);
      if (geometry?.kind !== "point") throw new Error("expected generated point geometry");
      return geometry.x;
    })).toEqual([2, 7, -3]);
    expect(rows.map((row) => row.generatedElementId.endsWith(`:${row.iterationIndex}`))).toEqual([true, true, true]);
  });

  it("keeps non-number iteration references and bare iteration names fail-closed", () => {
    const compileAttempt = (source: string) => compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 1),
      source
    );
    const nonNumber = compileAttempt([
      "nui 1",
      'const xs: string[] = ["two"]',
      "for x in @xs {",
      "  point Mark = coordinate(x: @x, y: 0)",
      "}"
    ].join("\n"));
    expect(nonNumber.status).toBe("fatal");
    expect(nonNumber.diagnostics.some((diagnostic) => diagnostic.code === "numeric-binding-type-mismatch")).toBe(true);

    const bare = compileAttempt([
      "nui 1",
      "const xs: number[] = [2]",
      "for x in @xs {",
      "  point Mark = coordinate(x: x, y: 0)",
      "}"
    ].join("\n"));
    expect(bare.status).toBe("fatal");
    expect(bare.diagnostics.some((diagnostic) => diagnostic.code === "numeric-binding-iteration-reference")).toBe(true);
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

  it("keeps numeric collection indexing and length available through the typed materialization boundary", () => {
    const compiled = compile([
      "nui 1",
      "const values: number[] = [3, 8]",
      "const item: number = @values[1]",
      "const count: number = @values.length",
      "point Combined = coordinate(x: @item + @count, y: 0)"
    ].join("\n"));
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    expect((result.computedGeometry.get(point(compiled, "Combined").id) as { x: number }).x).toBe(10);
  });

  it("preserves optional scalar collection-index types, values, aliases, widening, and length", () => {
    const compiled = compile([
      "nui 1",
      "const values: number?[] = [7]",
      "const selected: number? = @values[0]",
      "const noneValues: number?[] = [none]",
      "const selectedNone: number? = @noneValues[0]",
      "const mixed: number?[] = [2, none, 5]",
      "const first: number? = @mixed[0]",
      "const middle: number? = @mixed[1]",
      "const last: number? = @mixed[2]",
      "const alias: number?[] = @mixed",
      "const aliasFirst: number? = @alias[0]",
      "const aliasNone: number? = @alias[1]",
      "const requiredValues: number[] = [3, 8]",
      "const required: number = @requiredValues[1]",
      "const widened: number? = @requiredValues[0]",
      "const count: number = @values.length"
    ].join("\n"));
    const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    expect(errors).toEqual([]);

    const initializerFor = (name: string) => {
      const statement = compiled.scalarProgram?.statements.find((candidate) =>
        compiled.bindingAnalysis?.catalog.bindingsById.get(candidate.bindingId)?.name === name
      );
      return statement?.declaration.initializer;
    };
    const optionalNumber = { kind: "optional", valueType: { kind: "number" } } as const;
    expect(initializerFor("selected")).toMatchObject({ kind: "collectionIndex", type: optionalNumber });
    expect(initializerFor("required")).toMatchObject({ kind: "collectionIndex", type: { kind: "number" } });
    expect(initializerFor("widened")).toMatchObject({ kind: "collectionIndex", type: { kind: "number" } });

    const result = evaluateElements(compiled.document.elements, optionsFor(compiled));
    expect(result.errors).toEqual([]);
    const evaluationFor = (name: string) => {
      const binding = compiled.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.name === name);
      return binding ? result.computedScalarBindings?.get(binding.id) : undefined;
    };
    expect(evaluationFor("selected")).toEqual({
      status: "ok", type: optionalNumber, value: { kind: "number", value: 7 }
    });
    expect(evaluationFor("selectedNone")).toEqual({
      status: "ok", type: optionalNumber, value: { kind: "none" }
    });
    expect(evaluationFor("first")).toEqual({ status: "ok", type: optionalNumber, value: { kind: "number", value: 2 } });
    expect(evaluationFor("middle")).toEqual({ status: "ok", type: optionalNumber, value: { kind: "none" } });
    expect(evaluationFor("last")).toEqual({ status: "ok", type: optionalNumber, value: { kind: "number", value: 5 } });
    expect(evaluationFor("aliasFirst")).toEqual({ status: "ok", type: optionalNumber, value: { kind: "number", value: 2 } });
    expect(evaluationFor("aliasNone")).toEqual({ status: "ok", type: optionalNumber, value: { kind: "none" } });
    expect(evaluationFor("required")).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 8 } });
    expect(evaluationFor("widened")).toEqual({ status: "ok", type: optionalNumber, value: { kind: "number", value: 3 } });
    expect(evaluationFor("count")).toEqual({ status: "ok", type: { kind: "number" }, value: { kind: "number", value: 1 } });
  });

  it.each([
    ["required number", "const invalid: number = @values[0]"],
    ["incompatible optional string", "const invalid: string? = @values[0]"]
  ])("keeps optional collection indexing invalid for a %s target", (_label, declaration) => {
    const result = compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 1),
      ["nui 1", "const values: number?[] = [7]", declaration].join("\n")
    );
    expect(result.status).toBe("fatal");
    const codes = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code);
    expect(codes).toContain("scalar-type-mismatch");
    expect(codes).not.toContain("scalar-namespace-type-mismatch");
  });

  it("uses an immutable binding at each geometry statement", () => {
    const compiled = compile([
      "nui 1",
      "const length: number = 2",
      "point Before = coordinate(x: @length, y: 0)",
      "const afterLength: number = 9",
      "point After = coordinate(x: @afterLength, y: 0)"
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
