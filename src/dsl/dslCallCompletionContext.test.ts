import { describe, expect, it } from "vitest";
import { argumentCompletionCandidates } from "./dslCallCompletionCandidates";
import { dslCallCompletionContextAt } from "./dslCallCompletionContext";
import { constructionFor } from "./dslConstructions";

const atEnd = (source: string) => dslCallCompletionContextAt(source, source.length);

describe("dslCallCompletionContextAt", () => {
  it("recognizes a construction token only after an element equals sign", () => {
    expect(atEnd("point P = co")).toMatchObject({ kind: "construction", category: "point", from: 10, to: 12 });
    const context = atEnd("point P = co");
    expect(context?.kind === "construction" && context.category).toBe("point");
    expect(atEnd("point P = unknown")).toBeNull();
  });

  it("does not mistake a short variable expression for a construction", () => {
    expect(atEnd("var Width = ")).toBeNull();
    expect(atEnd("var Width = 10")).toBeNull();
    expect(atEnd("var Width = @Wi")).toBeNull();
    expect(atEnd("var Width = pointD")).toMatchObject({ kind: "construction", category: "var" });
  });

  it("uses the exact category/construction spec for argument candidates", () => {
    expect(atEnd("point P = offset(fr")).toMatchObject({ kind: "argument", spec: { category: "point", construction: "offset" } });
    const context = atEnd("var Width = pointDistance(po");
    expect(context).toMatchObject({ kind: "argument", spec: { category: "var", construction: "pointDistance" } });
    if (!context || context.kind !== "argument") throw new Error("argument context expected");
    expect(argumentCompletionCandidates(context.spec, context.usedArgumentNames).map((candidate) => candidate.label)).toEqual([
      "point1", "point2", "visible", "enabled", "color", "steps", "vars"
    ]);
  });

  it("excludes used named arguments and waits for container positional arguments", () => {
    const offset = "point P = offset(from: A dx: 10 )";
    const offsetContext = dslCallCompletionContextAt(offset, offset.indexOf(")"));
    expect(offsetContext).toMatchObject({ kind: "argument" });
    if (!offsetContext || offsetContext.kind !== "argument") throw new Error("argument context expected");
    expect(argumentCompletionCandidates(offsetContext.spec, offsetContext.usedArgumentNames).map((candidate) => candidate.label)).toEqual([
      "dy", "visible", "enabled", "color", "steps", "vars"
    ]);

    expect(atEnd("if Branch (")).toBeNull();
    expect(atEnd("for Repeat (i ")).toBeNull();
    expect(atEnd("for Repeat (i fr")).toMatchObject({ kind: "argument", spec: { category: "for" } });
    expect(atEnd("group G (")).toMatchObject({ kind: "argument", spec: { category: "group" } });
  });

  it("uses metadata as labels while adding only user-facing common arguments", () => {
    const spec = constructionFor("var", "pointDistance")!;
    const candidates = argumentCompletionCandidates(spec, new Set());
    expect(candidates.map((candidate) => candidate.apply)).toEqual([
      "point1: ", "point2: ", "visible: ", "enabled: ", "color: ", "steps: ", "vars: "
    ]);
    expect(candidates.map((candidate) => candidate.label)).not.toEqual(expect.arrayContaining(["id", "varIds", "parent", "branch"]));
  });

  it("removes the other member of an exclusive argument group", () => {
    const spec = constructionFor("point", "between")!;
    const afterDistance = argumentCompletionCandidates(spec, new Set(["start", "end", "distance"]));
    const afterRatio = argumentCompletionCandidates(spec, new Set(["start", "end", "ratio"]));

    expect(afterDistance.map((candidate) => candidate.label)).not.toContain("ratio");
    expect(afterRatio.map((candidate) => candidate.label)).not.toContain("distance");
  });
});
