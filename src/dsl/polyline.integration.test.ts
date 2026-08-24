import { describe, expect, it } from "vitest";

import { evaluateElements } from "../geometry/evaluate";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compile = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `polyline:${index}`]))
  });
};

describe("polyline DSL integration", () => {
  it("lowers a typed point[] in authored order without introducing a ParameterValueKind", () => {
    const result = compile([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point C = coordinate(x: 10, y: 10)",
      "const vertices: point[] = [@A, @B, @C, @B]",
      "line Outline = polyline(points: @vertices, closed: false)"
    ].join("\n"));

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const outline = result.document?.elements.find((element) => element.name === "Outline");
    expect(outline).toMatchObject({ type: "polyline", closed: false, points: [
      { mode: "reference" }, { mode: "reference" }, { mode: "reference" }, { mode: "reference" }
    ] });
    expect(outline).toBeDefined();
    const evaluation = evaluateElements(result.document!.elements);
    expect(evaluation.computedGeometry.get(outline!.id)).toMatchObject({
      kind: "polyline",
      segments: [
        { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        { start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
        { start: { x: 10, y: 10 }, end: { x: 10, y: 0 } }
      ]
    });
  });

  it("rejects a polyline from strict line[] while allowing it in path[]", () => {
    const result = compile([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Outline = polyline(points: [@A, @B], closed: false)",
      "const paths: path[] = [@Outline]",
      "const lines: line[] = [@Outline]"
    ].join("\n"));

    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("line[]"))).toBe(true);

    const valid = compile([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Outline = polyline(points: [@A, @B], closed: false)",
      "const paths: path[] = [@Outline]"
    ].join("\n"));
    expect(valid.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(valid.document?.elements.some((element) => element.name === "Outline")).toBe(true);
  });

  it("lowers inline coordinate members without dropping coincident segments", () => {
    const result = compile([
      "nui 4",
      "line Outline = polyline(points: [(0, 0), (0, 0), (3, 4)], closed: false)"
    ].join("\n"));

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const outline = result.document?.elements.find((element) => element.name === "Outline");
    expect(outline?.type).toBe("polyline");
    const evaluation = evaluateElements(result.document!.elements);
    expect(evaluation.computedGeometry.get(outline!.id)).toMatchObject({
      kind: "polyline",
      segments: [{ length: 0 }, { length: 5 }],
      length: 5
    });
  });
});
