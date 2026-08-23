import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compileWithIds = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `say12:runtime:${index}`] as const))
  });
};

describe("Module same-name argument shorthand runtime parity", () => {
  it("evaluates shorthand through the same named parameter binding as the explicit form", () => {
    const source = [
      "nui 4",
      "const width: number = 7",
      "module Marker(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance Shorthand = Marker(@width)",
      "instance Explicit = Marker(width: @width)"
    ].join("\n");

    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.bindingIssueDiagnostics ?? []).toEqual([]);

    const document = compiled.document;
    const statementMap = compiled.statementMap;
    const majorVersion = compiled.majorVersion;
    if (!document || !statementMap || majorVersion === null) {
      throw new Error("expected a compiled document");
    }

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
      expect.objectContaining({ kind: "point", x: 7, y: 0 }),
      expect.objectContaining({ kind: "point", x: 7, y: 0 })
    ]);
  });
});
