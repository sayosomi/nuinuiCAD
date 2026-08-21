import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "../document/canonicalDocument";
import {
  outputPreviewCandidatesFor,
  selectOutputPreviewCandidate
} from "./outputPreviewSelection";
import { outputPreviewManualE2eSource } from "./outputPreviewManualFixture";

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

const multilineOutputSource = [
  "nui 4",
  "group G {",
  "  line AB = segment(start: (0, 0), end: (10, 0))",
  "}",
  "layout L {",
  "  place @G(at: (0, 0))",
  "}",
  "print Paper(",
  "  layout: @L,",
  "  paper: a4,",
  "  margin: 10,",
  "  overlap: 5,",
  ")",
  "svg Vector(",
  "  layout: @L,",
  "  margin: 2,",
  ")"
].join("\n");

const compiledForSource = () => {
  const result = compileFreshCanonicalText(source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.currentCompiled;
};

const compiledForMultilineOutputSource = () => {
  const result = compileFreshCanonicalText(multilineOutputSource);
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

  it("owns the complete physical range for multi-line print and svg declarations", () => {
    const compiled = compiledForMultilineOutputSource();
    const candidates = outputPreviewCandidatesFor(multilineOutputSource, compiled);
    const printStart = multilineOutputSource.indexOf("print Paper(");
    const printEnd = multilineOutputSource.indexOf(")\nsvg Vector") + 1;
    const svgStart = multilineOutputSource.indexOf("svg Vector(");
    const svgEnd = multilineOutputSource.length;

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.sourceRange).toEqual({ from: printStart, to: printEnd });
    expect(candidates[1]?.sourceRange).toEqual({ from: svgStart, to: svgEnd });

    for (const offset of [
      multilineOutputSource.indexOf("print Paper("),
      multilineOutputSource.indexOf("layout: @L", printStart),
      multilineOutputSource.indexOf("overlap: 5", printStart),
      multilineOutputSource.indexOf(")\nsvg Vector")
    ]) {
      expect(selectOutputPreviewCandidate({
        candidates,
        cursorOffset: offset,
        existingKey: null
      })?.key).toBe(candidates[0]?.key);
    }

    const svgFinalLine = multilineOutputSource.lastIndexOf(")");
    expect(selectOutputPreviewCandidate({
      candidates,
      cursorOffset: svgFinalLine,
      existingKey: null
    })?.key).toBe(candidates[1]?.key);
  });

  it("uses the complete declaration range for selected-output source navigation", () => {
    const candidates = outputPreviewCandidatesFor(multilineOutputSource, compiledForMultilineOutputSource());
    const selected = candidates[1]!;

    expect(selected.sourceRange).toEqual({
      from: multilineOutputSource.indexOf("svg Vector("),
      to: multilineOutputSource.length
    });
  });

  it("keeps both current Manual E2E outputs connected to their complete source declarations", () => {
    const compiled = compileFreshCanonicalText(outputPreviewManualE2eSource);
    expect(compiled.status).toBe("valid");
    expect(compiled.doc.document.printOutputs.map((output) => output.name)).toEqual(["家庭用A4"]);
    expect(compiled.doc.document.svgOutputs.map((output) => output.name)).toEqual(["型紙SVG"]);

    const candidates = outputPreviewCandidatesFor(outputPreviewManualE2eSource, compiled.currentCompiled);
    const printStart = outputPreviewManualE2eSource.indexOf("print 家庭用A4(");
    const printEnd = outputPreviewManualE2eSource.indexOf(")\n\nsvg 型紙SVG") + 1;
    const svgStart = outputPreviewManualE2eSource.indexOf("svg 型紙SVG(");

    expect(candidates.map((candidate) => `${candidate.kind}:${candidate.output.name}`)).toEqual([
      "print:家庭用A4",
      "svg:型紙SVG"
    ]);
    expect(candidates[0]?.sourceRange).toEqual({ from: printStart, to: printEnd });
    expect(candidates[1]?.sourceRange).toEqual({ from: svgStart, to: outputPreviewManualE2eSource.length });
    expect(selectOutputPreviewCandidate({
      candidates,
      cursorOffset: outputPreviewManualE2eSource.indexOf("profile: @印刷用"),
      existingKey: null
    })?.key).toBe(candidates[0]?.key);
    expect(selectOutputPreviewCandidate({
      candidates,
      cursorOffset: outputPreviewManualE2eSource.indexOf("profile: @SVG用"),
      existingKey: null
    })?.key).toBe(candidates[1]?.key);
  });
});
