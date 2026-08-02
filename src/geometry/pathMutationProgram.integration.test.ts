import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { evaluateElements } from "./evaluate";

const compileAndEvaluate = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.document).not.toBeNull();
  return evaluateElements(compiled.document!.elements, {
    statementInfoByElementId: compiled.statementMap!.byElementId,
    pathMutationProgram: compiled.pathMutationProgram
  });
};

describe("reverse path mutation", () => {
  it("changes an existing line's traversal only after its source statement", () => {
    const result = compileAndEvaluate(`nui 3
point A = coordinate(x: 0 y: 0)
point B = coordinate(x: 10 y: 0)
point C = coordinate(x: 10 y: 10)
line AB = segment(start: A end: B)
line CB = segment(start: C end: B)
reverse CB
line seam = offset(sources: [AB, CB] distance: 1 side: right closed: false)`);
    expect(result.errors).toEqual([]);
    const cb = [...result.computedGeometry.values()].find((geometry) => geometry.name === "CB")!;
    expect(cb).toMatchObject({ kind: "line", start: { x: 10, y: 0 }, end: { x: 10, y: 10 } });
    expect([...result.computedGeometry.values()].find((geometry) => geometry.name === "seam")).toBeDefined();
  });

  it("rejects a non-continuous directed source chain", () => {
    const result = compileAndEvaluate(`nui 3
point A = coordinate(x: 0 y: 0)
point B = coordinate(x: 10 y: 0)
point C = coordinate(x: 10 y: 10)
line AB = segment(start: A end: B)
line CB = segment(start: C end: B)
line seam = offset(sources: [AB, CB] distance: 1 side: right closed: false)`);
    expect(result.errors.map((error) => error.message).join(" ")).toContain("reverse");
  });
});
