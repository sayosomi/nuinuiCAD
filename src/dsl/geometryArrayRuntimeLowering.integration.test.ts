import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compile = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `array-runtime:${index}`]))
  });
};

describe("geometry array runtime lowering", () => {
  it("lowers named line[] and path[] values only at existing line-list consumers", () => {
    const result = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line BA = segment(start: @B, end: @A)",
      "const straight: line[] = [@BA, @AB, @BA]",
      "const paths: path[] = @straight",
      "line Offset = offset(sources: @paths, distance: 1, side: left, closed: false)"
    ].join("\n"));

    expect(result.diagnostics).toEqual([]);
    expect(result.document).not.toBeNull();
    const byName = new Map(result.document!.elements.map((element) => [element.name, element] as const));
    const ab = byName.get("AB")!;
    const ba = byName.get("BA")!;
    expect(byName.get("Offset")).toMatchObject({
      type: "offsetLine",
      baseLineIds: [ba.id, ab.id, ba.id]
    });
  });

  it("keeps point[] out of broad line-list consumers", () => {
    const result = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "const points: point[] = [@A]",
      "line Offset = offset(sources: @points, distance: 1, side: left, closed: false)"
    ].join("\n"));

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error" || diagnostic.code === "invalid-source-reference")).toBe(true);
  });
});
