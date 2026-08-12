import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { evaluateElements } from "./evaluate";

const compileAndEvaluate = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.document).not.toBeNull();
  return evaluateElements(compiled.document!.elements, {
    statementInfoByElementId: compiled.statementMap!.byElementId
  });
};

describe("reverse statement (end to end via DSL)", () => {
  it("changes an existing line's traversal only after its source statement", () => {
    const result = compileAndEvaluate(`nui 3
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
point C = coordinate(x: 10, y: 10)
line AB = segment(start: @A, end: @B)
line CB = segment(start: @C, end: @B)
reverse(target: @CB)
line seam = offset(sources: [@AB, @CB], distance: 1, side: right, closed: false)`);
    expect(result.errors).toEqual([]);
    const cb = [...result.computedGeometry.values()].find((geometry) => geometry.name === "CB")!;
    expect(cb).toMatchObject({ kind: "line", start: { x: 10, y: 0 }, end: { x: 10, y: 10 } });
    expect([...result.computedGeometry.values()].find((geometry) => geometry.name === "seam")).toBeDefined();
  });

  it("rejects a non-continuous directed source chain", () => {
    const result = compileAndEvaluate(`nui 3
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
point C = coordinate(x: 10, y: 10)
line AB = segment(start: @A, end: @B)
line CB = segment(start: @C, end: @B)
line seam = offset(sources: [@AB, @CB], distance: 1, side: right, closed: false)`);
    expect(result.errors.map((error) => error.message).join(" ")).toContain("reverse");
  });
});

describe("reverse statement forGroup ancestor validation", () => {
  it("allows a reverse targeting a line declared in the same for loop", () => {
    const result = compileAndEvaluate(`nui 3
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
for Loop (i, from: 0, count: 2, step: 1) {
  line AB = segment(start: @A, end: @B)
  reverse(target: @AB)
}`);
    expect(result.errors).toEqual([]);
  });

  it("rejects a reverse inside a for loop targeting a line declared outside it", () => {
    const result = compileAndEvaluate(`nui 3
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
line AB = segment(start: @A, end: @B)
for Loop (i, from: 0, count: 2, step: 1) {
  reverse(target: @AB)
}`);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.message.includes("for の外側"))).toBe(true);
    // The rejection must prevent the mutation, not just report it alongside it.
    const ab = [...result.computedGeometry.values()].find((geometry) => geometry.name === "AB")!;
    expect(ab).toMatchObject({ start: { x: 0, y: 0 } });
  });

  it("rejects a nested inner-loop reverse targeting an element owned only by the outer loop", () => {
    const result = compileAndEvaluate(`nui 3
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
for Outer (i, from: 0, count: 1, step: 1) {
  line AB = segment(start: @A, end: @B)
  for Inner (j, from: 0, count: 1, step: 1) {
    reverse(target: @AB)
  }
}`);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.message.includes("for の外側"))).toBe(true);
  });

  it("allows a nested inner-loop reverse targeting an element declared in the same inner loop", () => {
    const result = compileAndEvaluate(`nui 3
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 10, y: 0)
for Outer (i, from: 0, count: 1, step: 1) {
  for Inner (j, from: 0, count: 1, step: 1) {
    line AB = segment(start: @A, end: @B)
    reverse(target: @AB)
  }
}`);
    expect(result.errors).toEqual([]);
  });
});
