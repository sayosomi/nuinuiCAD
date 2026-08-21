import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import {
  outputPreviewCandidatesFor,
  selectOutputPreviewCandidate
} from "./outputPreviewSelection";

const source = [
  "nui 4",
  "group G {",
  "  line AB = segment(start: (0, 0), end: (10, 0))",
  "}",
  "layout L {",
  "  place @G(at: (0, 0))",
  "}",
  "svg Vector(layout: @L, margin: 2)",
  "print Paper(layout: @L, paper: a4, margin: 10, overlap: 5)"
].join("\n");

const compiledForSource = () => {
  const result = compileFreshCanonicalText(source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.currentCompiled;
};

describe("Output Preview output selection", () => {
  it("combines print and svg declarations in source order", () => {
    const candidates = outputPreviewCandidatesFor(source, compiledForSource());

    expect(candidates.map((candidate) => candidate.kind)).toEqual(["svg", "print"]);
  });

  it("prioritizes a print declaration over an svg declaration at the cursor", () => {
    const candidates = outputPreviewCandidatesFor(source, compiledForSource());
    const printCursor = source.indexOf("print Paper");

    expect(selectOutputPreviewCandidate({
      candidates,
      cursorOffset: printCursor,
      existingKey: candidates[0].key
    })?.kind).toBe("print");
  });

  it("preserves a valid existing selection when the cursor is elsewhere", () => {
    const candidates = outputPreviewCandidatesFor(source, compiledForSource());

    expect(selectOutputPreviewCandidate({
      candidates,
      cursorOffset: 0,
      existingKey: candidates[1].key
    })?.kind).toBe("print");
  });

  it("falls back to the first source-order output and supports an empty state", () => {
    const candidates = outputPreviewCandidatesFor(source, compiledForSource());

    expect(selectOutputPreviewCandidate({
      candidates,
      cursorOffset: 0,
      existingKey: "missing"
    })?.kind).toBe("svg");
    expect(selectOutputPreviewCandidate({ candidates: [], cursorOffset: 0, existingKey: null })).toBeNull();
  });
});
