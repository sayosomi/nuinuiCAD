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

  it("uses the exact category/construction spec for argument candidates", () => {
    expect(atEnd("point P = offset(fr")).toMatchObject({ kind: "argument", spec: { category: "point", construction: "offset" } });
    const context = atEnd("point P = intersection(li");
    expect(context).toMatchObject({ kind: "argument", spec: { category: "point", construction: "intersection" } });
    if (!context || context.kind !== "argument") throw new Error("argument context expected");
    expect(argumentCompletionCandidates(context.spec, context.usedArgumentNames).map((candidate) => candidate.label)).toEqual([
      "line1", "line2", "index", "extensions", "state", "color", "steps", "vars"
    ]);
  });

  it("excludes used named arguments and waits for container positional arguments", () => {
    const offset = "point P = offset(from: A, dx: 10 )";
    const offsetContext = dslCallCompletionContextAt(offset, offset.indexOf(")"));
    expect(offsetContext).toMatchObject({ kind: "argument" });
    if (!offsetContext || offsetContext.kind !== "argument") throw new Error("argument context expected");
    expect(argumentCompletionCandidates(offsetContext.spec, offsetContext.usedArgumentNames).map((candidate) => candidate.label)).toEqual([
      "dy", "state", "color", "steps", "vars"
    ]);

    expect(atEnd("if (")).toBeNull();
    expect(atEnd("for i in range(")).toMatchObject({ kind: "argument", spec: { category: "for" } });
    expect(atEnd("for i in range(fr")).toMatchObject({ kind: "argument", spec: { category: "for" } });
    expect(atEnd("group G (")).toMatchObject({ kind: "argument", spec: { category: "group" } });
  });

  it("uses metadata as labels while adding only user-facing common arguments", () => {
    const spec = constructionFor("point", "intersection")!;
    const candidates = argumentCompletionCandidates(spec, new Set());
    expect(candidates.map((candidate) => candidate.apply)).toEqual([
      "line1: ", "line2: ", "index: ", "extensions: ", "state: ", "color: ", "steps: ", "vars: "
    ]);
    expect(candidates.map((candidate) => candidate.label)).not.toEqual(expect.arrayContaining(["id", "varIds", "parent", "branch"]));
  });

  it("offers tangentOffset curveSide through the construction registry", () => {
    const context = atEnd("point P = tangentOffset(line: C, base: A, ");
    expect(context).toMatchObject({ kind: "argument", spec: { construction: "tangentOffset" } });
    if (!context || context.kind !== "argument") throw new Error("argument context expected");
    expect(argumentCompletionCandidates(context.spec, context.usedArgumentNames).map((candidate) => candidate.label)).toEqual([
      "angle", "curveSide", "distance", "state", "color", "steps", "vars"
    ]);
  });

  it("does not offer attribute-key completion when the cursor sits inside an emptied value's raw gap", () => {
    // Matches a real edit: select an existing choice value && delete it,
    // landing the cursor right where the deleted text used to start - not at
    // the far edge of the resulting whitespace gap. dslArgScanner's
    // trimSpan always collapses an empty valueSpan toward the far edge of
    // its raw gap (never toward the cursor), so a test that only probes the
    // far edge would not reproduce the real regression.
    const before = "line Off = offset(sources: [AB], side: right, closed: false)";
    const deleteStart = before.indexOf("right");
    const deleteEnd = deleteStart + "right".length;
    const after = before.slice(0, deleteStart) + before.slice(deleteEnd);
    expect(after).toBe("line Off = offset(sources: [AB], side: , closed: false)");

    // The real-deletion cursor position, one char into the raw gap.
    expect(dslCallCompletionContextAt(after, deleteStart)).toBeNull();
    // The very first character of the raw gap (right after the colon).
    const colonEnd = after.indexOf("side:") + "side:".length;
    expect(dslCallCompletionContextAt(after, colonEnd)).toBeNull();

    // A second, independent attribute value on the same construction -
    // this fix must not be `side`-specific.
    const closedBefore = "line Off = offset(sources: [AB], side: right, closed: false)";
    const closedDeleteStart = closedBefore.indexOf("false");
    const closedDeleteEnd = closedDeleteStart + "false".length;
    const closedAfter = closedBefore.slice(0, closedDeleteStart) + closedBefore.slice(closedDeleteEnd);
    expect(dslCallCompletionContextAt(closedAfter, closedDeleteStart)).toBeNull();
  });

  it("removes the other member of an exclusive argument group", () => {
    const spec = constructionFor("point", "between")!;
    const afterDistance = argumentCompletionCandidates(spec, new Set(["start", "end", "distance"]));
    const afterRatio = argumentCompletionCandidates(spec, new Set(["start", "end", "ratio"]));

    expect(afterDistance.map((candidate) => candidate.label)).not.toContain("ratio");
    expect(afterRatio.map((candidate) => candidate.label)).not.toContain("distance");
  });
});
