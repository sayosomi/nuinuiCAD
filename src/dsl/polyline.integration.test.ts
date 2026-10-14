import { describe, expect, it } from "vitest";

import { evaluateElements } from "../geometry/evaluate";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { parseDsl } from "@nuinuicad/nui-language";

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
      "nui 1",
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
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Outline = polyline(points: [@A, @B], closed: false)",
      "const paths: path[] = [@Outline]",
      "const lines: line[] = [@Outline]"
    ].join("\n"));

    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("line[]"))).toBe(true);

    const valid = compile([
      "nui 1",
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
      "nui 1",
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

  it("preserves selected-stage anchors from direct, aliased, and geometry-value point arrays", () => {
    const result = compile([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "move L as tilted (from: (0, 0), to: (4, 6), angleDeg: 0)",
      "move L as turned (from: (4, 6), to: (9, 9), angleDeg: 0)",
      "const Base: path = @L.base",
      "const Tilted: path = @L.tilted",
      "const Final: path = @L.final",
      "const selected: point[] = [@L.base.start, @L.tilted.end, @L.final.start]",
      "const aliased: point[] = @selected",
      "const valuePoints: point[] = [@Base.start, @Tilted.end, @Final.start]",
      "line Direct = polyline(points: @selected, closed: false)",
      "line Alias = polyline(points: @aliased, closed: false)",
      "line GeometryValues = polyline(points: @valuePoints, closed: false)"
    ].join("\n"));

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const elements = result.document!.elements;
    const line = elements.find((element) => element.name === "L")!;
    const expectedDerived = [
      { mode: "derived", elementId: line.id, pointKey: "start", stagePath: ["base"] },
      { mode: "derived", elementId: line.id, pointKey: "end", stagePath: ["tilted"] },
      { mode: "derived", elementId: line.id, pointKey: "start", stagePath: ["final"] }
    ];
    const expectedValue = [
      { mode: "geometryValue", pointKey: "start", stagePath: ["final"] },
      { mode: "geometryValue", pointKey: "end", stagePath: ["final"] },
      { mode: "geometryValue", pointKey: "start", stagePath: ["final"] }
    ];
    const direct = elements.find((element) => element.name === "Direct")!;
    const alias = elements.find((element) => element.name === "Alias")!;
    const geometryValues = elements.find((element) => element.name === "GeometryValues")!;
    expect([direct.type, alias.type, geometryValues.type]).toEqual(["polyline", "polyline", "polyline"]);
    if (direct.type !== "polyline" || alias.type !== "polyline" || geometryValues.type !== "polyline") {
      throw new Error("expected the selected point arrays to lower into polylines");
    }
    expect(direct.points).toMatchObject(expectedDerived);
    expect(alias.points).toMatchObject(expectedDerived);
    expect(geometryValues.points).toMatchObject(expectedValue);
  });
});
