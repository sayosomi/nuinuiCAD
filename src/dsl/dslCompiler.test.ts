import { describe, expect, it } from "vitest";
import { compileDslToElements } from "./dslCompiler";
import { serializeElementsToDsl } from "./dslSerializer";

describe("DSL compiler", () => {
  it("creates basic drafting elements from short DSL syntax", () => {
    const result = compileDslToElements(
      [
        "var bust = 840",
        "point A = (0, 0)",
        "point B = offset A dx=0 dy=-(bust / 4)",
        "line AB = A -> B",
        "arc armhole center=A radius=120 start=0 end=-90",
        "text label = \"前中心\" at=A size=4"
      ].join("\n"),
      { elements: [] }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements.map((element) => element.type)).toEqual([
      "variable",
      "freePoint",
      "offsetPoint",
      "line",
      "arcLine",
      "text"
    ]);
    expect(result.elements[2]).toMatchObject({
      type: "offsetPoint",
      fromPoint: { mode: "reference", pointId: result.elements[1].id }
    });
    expect(result.elements[3]).toMatchObject({
      type: "line",
      startPoint: { mode: "reference", pointId: result.elements[1].id },
      endPoint: { mode: "reference", pointId: result.elements[2].id }
    });
  });

  it("updates existing elements by stable id", () => {
    const initial = compileDslToElements("point A = (0, 0)", { elements: [] });
    const point = initial.elements[0];
    const result = compileDslToElements(`point A = (10, 20) id=${point.id}`, {
      elements: initial.elements
    });

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({
      id: point.id,
      type: "freePoint",
      x: 10,
      y: 20
    });
  });

  it("supports generic element syntax for element types without short syntax", () => {
    const base = compileDslToElements(
      [
        "point A = (0, 0)",
        "point B = (100, 0)",
        "line AB = A -> B"
      ].join("\n"),
      { elements: [] }
    );
    const lineId = base.elements.find((element) => element.name === "AB")?.id;
    const result = compileDslToElements(
      `element offset type=offsetLine baseLineIds=[${lineId}] offset=10 side=left closed=false`,
      { elements: base.elements }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: [lineId],
      offset: 10,
      side: "left",
      closed: false
    });
  });

  it("serializes selected elements into editable DSL with ids", () => {
    const result = compileDslToElements("point A = (0, 0)\npoint B = (10, 0)\nline AB = A -> B", {
      elements: []
    });
    const source = serializeElementsToDsl(result.elements);

    expect(source).toContain(`point A = (0, 0) id=${result.elements[0].id}`);
    expect(source).toContain(`line AB = ${result.elements[0].id} -> ${result.elements[1].id}`);
  });
});
