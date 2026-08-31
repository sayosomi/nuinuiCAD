import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { compileDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslReferences } from "./dslReferencesQuery";
import { moduleCompletionCandidates } from "./moduleCompletionCandidates";

const compileWithIds = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `say12:acceptance:${index}`]))
  });
};

const errorCodes = (compiled: ReturnType<typeof compileWithIds>) =>
  compiled.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code)
    .filter((code): code is string => Boolean(code))
    .sort();

const completionLabels = (source: string) => {
  const compiled = compileWithIds(source);
  const statementIndex = compiled.statements.findIndex((statement) => statement.kind === "moduleInstance");
  const statement = compiled.statements[statementIndex];
  if (statement?.kind !== "moduleInstance") throw new Error("expected module instance");
  const logical = source.slice(statement.documentRange.from, statement.documentRange.to);
  const open = logical.lastIndexOf("(");
  return moduleCompletionCandidates({
    compiled,
    cursorPosition: statement.documentRange.from + open + 1,
    kind: "label",
    statementIndex,
    liveStatementText: logical,
    logicalCursorPosition: open + 1
  }).map((candidate) => candidate.label);
};

describe("Module same-name shorthand acceptance coverage", () => {
  it("uses normal semantic diagnostics for unknown and duplicate shorthand-derived labels", () => {
    const unknown = compileWithIds([
      "nui 1",
      "const other: number = 1",
      "module M(width: number) {",
      "}",
      "instance X = M(@other)"
    ].join("\n"));
    expect(errorCodes(unknown)).toContain("module-unknown-argument");

    const duplicate = compileWithIds([
      "nui 1",
      "const width: number = 1",
      "module M(width: number) {",
      "}",
      "instance X = M(@width, @width)"
    ].join("\n"));
    expect(errorCodes(duplicate)).toContain("module-duplicate-argument");
  });

  it("allows required, defaulted, and optional parameters to be explicitly supplied by shorthand", () => {
    const source = [
      "nui 1",
      "const required: number = 1",
      "const defaulted: number = 2",
      "const optional: number = 3",
      "module M(required: number, defaulted: number = 10, optional?: number) {",
      "}",
      "instance X = M(@required, @defaulted, @optional)"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const instance = compiled.moduleSemanticAnalysis?.instances.find((candidate) =>
      compiled.statements[candidate.statementIndex]?.kind === "moduleInstance"
    );
    expect(instance?.parameterBindings.map((binding) => [binding.parameterName, binding.argumentIndex])).toEqual([
      ["required", 0],
      ["defaulted", 1],
      ["optional", 2]
    ]);
  });

  it("keeps shorthand value type diagnostics equivalent to the explicit named form", () => {
    const prefix = [
      "nui 1",
      'const width: string = "wrong"',
      "module M(width: number) {",
      "}"
    ];
    const shorthand = compileWithIds([...prefix, "instance X = M(@width)"].join("\n"));
    const explicit = compileWithIds([...prefix, "instance X = M(width: @width)"].join("\n"));
    expect(errorCodes(shorthand)).toEqual(errorCodes(explicit));
    expect(errorCodes(shorthand).length).toBeGreaterThan(0);
  });

  it("includes shorthand in caller-value References as well as parameter-oriented References", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "module M(width: number) {",
      "  const copy: number = @width",
      "}",
      "instance X = M(@width)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const declaration = source.indexOf("width", source.indexOf("const width"));
    const shorthand = source.indexOf("@width", source.indexOf("instance X")) + 1;
    const result = queryDslReferences({
      source: { normalizedSource: source, sourceRevision: 0 },
      position: declaration + 1,
      semantic: { sourceRevision: 0, sourceText: source, compiled }
    });
    expect(result?.referenceRanges).toContainEqual({ from: shorthand, to: shorthand + "width".length });
  });

  it("offers shorthand for compatible defaulted scalar and optional geometry parameters, but not unavailable values", () => {
    const available = [
      "nui 1",
      "const width: number = 10",
      "point origin = coordinate(x: 0, y: 0)",
      "module M(width: number = 5, origin?: point) {",
      "}",
      "instance X = M()"
    ].join("\n");
    const labels = completionLabels(available);
    expect(labels).toEqual(expect.arrayContaining(["@width", "@origin", "width", "origin"]));
    expect(labels.indexOf("@width")).toBeLessThan(labels.indexOf("width"));
    expect(labels.indexOf("@origin")).toBeLessThan(labels.indexOf("origin"));

    const unavailable = [
      "nui 1",
      "module M(width: number = 5) {",
      "}",
      "instance X = M()",
      "const width: number = 10"
    ].join("\n");
    const unavailableLabels = completionLabels(unavailable);
    expect(unavailableLabels).not.toContain("@width");
    expect(unavailableLabels).toContain("width");
  });

  it("materializes geometry shorthand identically to the explicit named form", () => {
    const source = [
      "nui 1",
      "point origin = coordinate(x: 4, y: 5)",
      "module Marker(origin: point) {",
      "  point P = coordinate(x: @origin.x, y: @origin.y)",
      "}",
      "instance Shorthand = Marker(@origin)",
      "instance Explicit = Marker(origin: @origin)"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const document = compiled.document;
    const statementMap = compiled.statementMap;
    const majorVersion = compiled.majorVersion;
    if (!document || !statementMap || majorVersion === null) throw new Error("expected compiled document");

    const result = evaluateElements(
      document.elements,
      buildEvaluationOptions({
        compiledDocument: { ...compiled, document, statementMap, majorVersion },
        evaluationLimitIndex: document.evaluationLimitIndex
      })
    );
    expect(result.errors).toEqual([]);
    const points = document.elements.filter((element) => element.name === "P");
    expect(points).toHaveLength(2);
    expect(points.map((point) => result.computedGeometry.get(point.id))).toEqual([
      expect.objectContaining({ kind: "point", x: 4, y: 5 }),
      expect.objectContaining({ kind: "point", x: 4, y: 5 })
    ]);
  });
});
