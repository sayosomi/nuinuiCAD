// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compileCanonicalText, compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { queryDslCompletion, queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import { bezierKnotAuthoringAt } from "./dslBezierKnots";

const call = (point: string) => `bezier(start: @A, end: @D, intermediates: [
    knot(point: ${point}, angle: 90, incoming: 2, outgoing: 4)
  ])`;
const sourceFor = (form: "if" | "match", first = "@B", second = "@C") => `nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 4, y: 3)
point C = coordinate(x: 7, y: 6)
point D = coordinate(x: 10, y: 0)
const side: choice(left, right) = left
const Path: path = ${form === "if" ? `if (true) {
  ${call(first)}
} else {
  ${call(second)}
}` : `match @side {
  left => ${call(first)}
  right => ${call(second)}
}`}`;
const queryInput = (sourceText: string) => {
  const state = compileFreshCanonicalText(sourceText);
  const sourceRevision = state.currentCompiled.spans.sourceMap.sourceRevision;
  return {
    state,
    source: { normalizedSource: sourceText, sourceRevision },
    semantic: { compiled: state.currentCompiled, sourceRevision }
  };
};

describe("Bezier knot authoring in value branches (#1537 MEDIUM-01)", () => {
  for (const form of ["if", "match"] as const) {
    it.each([0, 1])(`completes and picks the independent point in ${form} branch %i`, branch => {
      const text = sourceFor(form);
      const input = queryInput(text);
      expect(input.state.diagnostics).toEqual([]);
      const value = branch === 0 ? "@B" : "@C";
      const from = text.indexOf(`point: ${value}`) + "point: ".length;
      const position = from + value.length;
      const completion = queryDslCompletion({ ...input, position });
      expect(completion?.category).toBe("parameter");
      expect(completion?.candidates.map(candidate => candidate.label)).toEqual(["A", "B", "C", "D"]);
      expect(completion?.replacementRange).toEqual({ from: from + 1, to: position });

      const target = queryDslReferencePickTarget({ ...input, position });
      expect(target).toMatchObject({ expectedGeometryInterface: "point", multiplicity: "single", range: { from, to: position } });
      const replacement = text.slice(0, target!.range.from) + "@A" + text.slice(target!.range.to);
      expect(replacement).toBe(text.replace(`point: ${value}`, "point: @A"));
      expect(compileCanonicalText(input.state, replacement).diagnostics).toEqual([]);
      expect(queryDslReferencePickTarget({ ...input, source: { ...input.source, sourceRevision: input.source.sourceRevision + 1 }, position })).toBeNull();
    });

    it.each([0, 1])(`keeps empty point authoring local to ${form} branch %i`, branch => {
      const text = sourceFor(form, branch === 0 ? "" : "@B", branch === 1 ? "" : "@C");
      const input = queryInput(text);
      const position = text.indexOf("point: ,") + "point: ".length;
      const completion = queryDslCompletion({ ...input, position });
      expect(completion?.category).toBe("parameter");
      expect(completion?.candidates.map(candidate => candidate.label)).toEqual(["A", "B", "C", "D"]);
      expect(completion?.replacementRange).toEqual({ from: position, to: position });
      const target = queryDslReferencePickTarget({ ...input, position });
      expect(target).toMatchObject({ expectedGeometryInterface: "point", range: { from: position, to: position } });
      const replacement = text.slice(0, target!.range.from) + "@A" + text.slice(target!.range.to);
      expect(replacement).toBe(text.replace("point: ,", "point: @A,"));
      expect(compileCanonicalText(input.state, replacement).diagnostics).toEqual([]);
      // A query does not mutate the source; cancellation retains both branch fields.
      expect(input.state.sourceText).toBe(text);
      const other = branch === 0 ? "@C" : "@B";
      const otherPosition = text.indexOf(`point: ${other}`) + "point: ".length + other.length;
      expect(queryDslReferencePickTarget({ ...input, position: otherPosition })?.range).toEqual({ from: otherPosition - other.length, to: otherPosition });
      expect(queryDslReferencePickTarget({ ...input, source: { ...input.source, sourceRevision: input.source.sourceRevision + 1 }, position })).toBeNull();
    });

    it.each([0, 1])(`completes knot constructors and fields in ${form} branch %i`, branch => {
      const original = sourceFor(form);
      const value = branch === 0 ? "@B" : "@C";
      const entry = `knot(point: ${value}, angle: 90, incoming: 2, outgoing: 4)`;
      for (const [replacement, needle, labels] of [
        ["kn", "kn", ["knot"]],
        ["knot()", "knot(", ["point", "angle", "incoming", "outgoing"]]
      ] as const) {
        const start = original.indexOf(entry);
        const text = original.slice(0, start) + replacement + original.slice(start + entry.length);
        const result = queryDslCompletion({ ...queryInput(text), position: start + needle.length });
        expect(result?.candidates.map(candidate => candidate.label)).toEqual([...labels]);
        expect(result?.replacementRange).toEqual({ from: start + (replacement === "kn" ? 0 : needle.length), to: start + needle.length });
      }
    });
  }

  it("retains unmatched single-call authoring and excludes positions outside its array", () => {
    const text = "bezier(start: @A, end: @D, intermediates: [knot(point:";
    expect(bezierKnotAuthoringAt(text, text.length)).toMatchObject({ kind: "value", field: "point" });
    const closed = call("@B");
    expect(bezierKnotAuthoringAt(closed, closed.length)).toBeNull();
    expect(bezierKnotAuthoringAt(closed, closed.indexOf("@A") + 2)).toBeNull();
  });

  it("fails closed when malformed nested calls both claim the cursor", () => {
    const text = `bezier(intermediates: [knot(point: ${call("@B")}, angle: 0, incoming: 1, outgoing: 1)])`;
    expect(bezierKnotAuthoringAt(text, text.indexOf("point: @B") + "point: @B".length)).toBeNull();
  });
});
