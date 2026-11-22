import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  parseDslSnapshot,
  propertyBindingOccurrenceKey,
  type CompiledDslDocument
} from "@nuinuicad/nui-language";

const compileWithIds = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `issue-1697-control:${index}`]))
  });
};

const typedBinding = (compiled: CompiledDslDocument, name: string) =>
  compiled.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === name);

describe("Issue #1697 numeric binding source controls", () => {
  it("keeps numeric const identities and exact bare references in geometry numeric arguments", () => {
    const source = [
      "nui 1",
      "const left: number = 50",
      "const width: number = 20",
      "const side: choice(left, right) = @left",
      "const copied: number = left",
      'const text: string = "left width @right"',
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: left + width, y: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

    expect(errors).toEqual([]);
    expect(compiled.document).not.toBeNull();

    const left = typedBinding(compiled, "left");
    const width = typedBinding(compiled, "width");
    const copied = compiled.scalarProgram?.statements.find((statement) =>
      statement.bindingId === typedBinding(compiled, "copied")?.id
    )?.declaration.initializer;
    expect(left).toBeDefined();
    expect(width).toBeDefined();
    expect(copied).toMatchObject({ kind: "reference", name: "left", bindingId: left?.id });

    const pointIndex = compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === "B");
    const numeric = compiled.numericBindings?.get(propertyBindingOccurrenceKey(pointIndex, "x"));
    const expressionStart = source.indexOf("left + width", source.indexOf("point B"));
    expect(numeric?.references.map((reference) => ({ name: reference.name, bindingId: reference.bindingId }))).toEqual([
      { name: "left", bindingId: left?.id },
      { name: "width", bindingId: width?.id }
    ]);
    expect(numeric?.references.map((reference) => reference.physicalNameSpan?.segments)).toEqual([
      [{ from: expressionStart, to: expressionStart + "left".length }],
      [{ from: expressionStart + "left + ".length, to: expressionStart + "left + width".length }]
    ]);
    expect(numeric?.references.map((reference) => reference.expressionStart)).toEqual([0, "left + ".length]);
    expect(numeric?.references.map((reference) => reference.expressionEnd)).toEqual(["left".length, "left + width".length]);
  });

  it("resolves same-named numeric and choice identities in source order without collecting @choice", () => {
    const source = [
      "nui 1",
      "const left: number = 50",
      "const width: number = 20",
      "const side: choice(left, right) = @left",
      "point B = coordinate(x: match side { @left => left @right => width }, y: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

    expect(errors).toEqual([]);
    const left = typedBinding(compiled, "left");
    const width = typedBinding(compiled, "width");
    const side = typedBinding(compiled, "side");
    const pointIndex = compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === "B");
    const numeric = compiled.numericBindings?.get(propertyBindingOccurrenceKey(pointIndex, "x"));
    const matchStart = source.indexOf("match side", source.indexOf("point B"));
    const leftStart = source.indexOf("side", matchStart);
    const branchLeftStart = source.indexOf("=> left", matchStart) + 3;
    const branchWidthStart = source.indexOf("=> width", matchStart) + 3;

    expect(numeric?.references.map((reference) => ({ name: reference.name, bindingId: reference.bindingId }))).toEqual([
      { name: "side", bindingId: side?.id },
      { name: "left", bindingId: left?.id },
      { name: "width", bindingId: width?.id }
    ]);
    expect(numeric?.references.map((reference) => reference.physicalNameSpan?.segments)).toEqual([
      [{ from: leftStart, to: leftStart + "side".length }],
      [{ from: branchLeftStart, to: branchLeftStart + "left".length }],
      [{ from: branchWidthStart, to: branchWidthStart + "width".length }]
    ]);
    expect(numeric?.references.filter((reference) => reference.name === "left")).toHaveLength(1);
    expect(numeric?.references.some((reference) => reference.name === "right")).toBe(false);
    expect(numeric?.typedExpression).toMatchObject({
      kind: "valueMatch",
      scrutinee: { kind: "reference", name: "side", bindingId: side?.id }
    });
    expect(compiled.scalarProgram?.statements.find((statement) => statement.bindingId === side?.id)?.declaration.initializer)
      .toMatchObject({ kind: "choiceLiteral", value: "left" });
  });

  it("does not treat call heads, named labels, booleans, or pi as binding references", () => {
    const source = [
      "nui 1",
      "const left: number = 50",
      "const width: number = 20",
      "point B = coordinate(x: if (true) { spreadAngle(length: width, spread: left) } else { pi }, y: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const pointIndex = compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === "B");
    const numeric = compiled.numericBindings?.get(propertyBindingOccurrenceKey(pointIndex, "x"));
    expect(numeric).toBeDefined();
    expect(numeric?.references.map((reference) => reference.name)).toEqual(["width", "left"]);
    expect(numeric?.typedExpression).toMatchObject({ kind: "valueIf" });
  });

  it("does not reinterpret the removed @width spelling as a numeric binding", () => {
    const source = [
      "nui 1",
      "const width: number = 20",
      "point B = coordinate(x: @width, y: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);

    expect(compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    const pointIndex = compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === "B");
    const numeric = compiled.numericBindings?.get(propertyBindingOccurrenceKey(pointIndex, "x"));
    expect(numeric?.references.some((reference) => reference.name === "width") ?? false).toBe(false);
  });

  it("maps a later bare binding after normalized geometry-reference text", () => {
    const source = [
      "nui 1",
      "const offset: number = 10",
      "point A = coordinate(x: 5, y: 0)",
      "point C = coordinate(x: 15, y: 0)",
      "point D = coordinate(x: distance(A, C) + offset, y: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const pointIndex = compiled.statements.findIndex((statement) => statement.kind === "element" && statement.name === "D");
    const numeric = compiled.numericBindings?.get(propertyBindingOccurrenceKey(pointIndex, "x"));
    const offsetStart = source.indexOf("offset", source.indexOf("point D"));
    expect(numeric?.references.map((reference) => reference.name)).toEqual(["offset"]);
    expect(numeric?.references[0]?.physicalNameSpan?.segments).toEqual([{ from: offsetStart, to: offsetStart + "offset".length }]);
    expect(numeric?.expression.slice(numeric.references[0]!.expressionStart, numeric.references[0]!.expressionEnd))
      .toBe("offset");
  });
});
