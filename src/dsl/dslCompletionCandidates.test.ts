import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { dslReferenceCompletionOptions } from "./dslCompletionCandidates";

const identities = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  return {
    elements: compiled.document!.elements,
    ids: new Map([...compiled.statementMap!.byElementId].map(([elementId, statement]) => [statement.line, elementId]))
  };
};

describe("dslReferenceCompletionOptions", () => {
  it("uses the live scope and strictly excludes the cursor line and later statements", () => {
    const source = [
      "nui 1",
      "group Outer {",
      "  point A = (0, 0)",
      "  line AB = A -> A",
      "",
      "}",
      "point Later = (10, 0)"
    ].join("\n");
    const { elements, ids } = identities(source);
    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: 5,
      kind: "reference",
      statementElementIds: ids,
      elements
    }).map((option) => option.label);
    expect(options).toContain("A");
    expect(options).toContain("AB.start");
    expect(options).not.toContain("Later");

    const currentLineOptions = dslReferenceCompletionOptions({
      source,
      cursorLine: 3,
      kind: "reference",
      statementElementIds: ids,
      elements
    }).map((option) => option.label);
    expect(currentLineOptions).not.toContain("A");
  });

  it("uses parameter kinds to keep line endpoints and line lists distinct", () => {
    const source = ["nui 1", "point A = (0, 0)", "line AB = A -> A", "point Target = (1, 1)"].join("\n");
    const { elements, ids } = identities(source);
    const endpoints = dslReferenceCompletionOptions({ source, cursorLine: 4, kind: "lineEndpointReference", statementElementIds: ids, elements });
    const lines = dslReferenceCompletionOptions({ source, cursorLine: 4, kind: "lineReferenceList", statementElementIds: ids, elements });
    expect(endpoints.map((option) => option.label)).toEqual(expect.arrayContaining(["AB.start", "AB.end"]));
    expect(endpoints.map((option) => option.label)).not.toContain("AB");
    expect(lines.map((option) => option.label)).toContain("AB");
  });

  it("does not fall back to compiled scope when a live dirty group has no stable identity", () => {
    const committed = identities(["nui 1", "point A = (0, 0)"].join("\n"));
    const aId = committed.ids.get(2)!;
    const liveSource = ["group New {", "point A = (0, 0)", "", "}"].join("\n");
    const options = dslReferenceCompletionOptions({
      source: liveSource,
      cursorLine: 3,
      kind: "reference",
      statementElementIds: new Map([[2, aId]]),
      elements: committed.elements
    });
    expect(options).toEqual([]);
  });

  it("records a loose 1000-element candidate-generation guard", () => {
    const source = ["nui 1", ...Array.from({ length: 1000 }, (_, index) => `point P${index} = (${index}, 0)`)].join("\n");
    const { elements, ids } = identities(source);
    const durations = Array.from({ length: 5 }, () => {
      const started = performance.now();
      dslReferenceCompletionOptions({ source, cursorLine: 1002, kind: "reference", statementElementIds: ids, elements });
      return performance.now() - started;
    }).sort((left, right) => left - right);
    const median = durations[Math.floor(durations.length / 2)];
    console.log(`[Phase 4h perf] 1000 element reference candidates: median=${median.toFixed(2)}ms`);
    expect(Number.isFinite(median)).toBe(true);
    expect(median).toBeLessThan(1000);
  }, 20_000);
});
