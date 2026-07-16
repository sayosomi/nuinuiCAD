import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { dslReferenceCompletionOptions } from "./dslCompletionCandidates";
import { evaluateElements } from "../geometry/evaluate";

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

  it("returns only the stable top eight for a 1000-element document", () => {
    const source = ["nui 1", ...Array.from({ length: 1000 }, (_, index) => `point P${index} = (${index}, 0)`)].join("\n");
    const { elements, ids } = identities(source);
    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: 1002,
      kind: "reference",
      query: "P",
      statementElementIds: ids,
      elements
    });
    expect(options).toHaveLength(8);
    expect(options.map((option) => option.label)).toEqual(
      Array.from({ length: 8 }, (_, index) => `P${index}`)
    );
  }, 20_000);

  it("uses evaluator-owned forGroup rows to aggregate runtime instances to one saved token", () => {
    const source = [
      "nui 1",
      "for Loop i start=0 count=3 step=1 {",
      "  point P = (@i * 10, 0)",
      "  line Target = P -> P",
      "}"
    ].join("\n");
    const { elements, ids } = identities(source);
    const evaluation = evaluateElements(elements);
    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: 4,
      kind: "reference",
      parameterKey: "startPoint",
      statementElementIds: ids,
      elements,
      computedGeometry: evaluation.computedGeometry,
      forGroupGeneratedRows: evaluation.forGroupGeneratedRows,
      effectiveEnabledElementIds: evaluation.effectiveEnabledElementIds,
      errors: evaluation.errors
    });
    expect(options.filter((option) => option.label === "P")).toHaveLength(1);
  });

  it("removes every runtime instance when another line-list token already selects its template", () => {
    const source = [
      "nui 1",
      "for Loop i start=0 count=3 step=1 {",
      "  point P = (@i * 10, 0)",
      "  line L = P -> (@i * 10, 10)",
      "  line M = P -> (@i * 10, 20)",
      "  line O = offset [L,L] distance=4 side=left",
      "}"
    ].join("\n");
    const { elements, ids } = identities(source);
    const evaluation = evaluateElements(elements);
    const lineText = source.split("\n")[5];
    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: 6,
      kind: "lineReferenceList",
      parameterKey: "baseLineIds",
      replacementFrom: lineText.lastIndexOf("L"),
      statementElementIds: ids,
      elements,
      computedGeometry: evaluation.computedGeometry,
      forGroupGeneratedRows: evaluation.forGroupGeneratedRows,
      effectiveEnabledElementIds: evaluation.effectiveEnabledElementIds,
      errors: evaluation.errors
    });

    // `L` is represented by three runtime instances, but one persisted token.
    // It must not be offered for confirmation, so the second slot cannot gain
    // a duplicate `L` token.
    expect(options.map((option) => option.label)).toEqual(["M"]);
  });

  it("keeps the currently edited line-list token replaceable while excluding other selections", () => {
    const source = [
      "nui 1",
      "for Loop i start=0 count=2 step=1 {",
      "  point P = (@i * 10, 0)",
      "  line L = P -> (@i * 10, 10)",
      "  line M = P -> (@i * 10, 20)",
      "  line O = offset [L,M] distance=4 side=left",
      "}"
    ].join("\n");
    const { elements, ids } = identities(source);
    const evaluation = evaluateElements(elements);
    const lineText = source.split("\n")[5];
    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: 6,
      kind: "lineReferenceList",
      parameterKey: "baseLineIds",
      replacementFrom: lineText.indexOf("L"),
      statementElementIds: ids,
      elements,
      computedGeometry: evaluation.computedGeometry,
      forGroupGeneratedRows: evaluation.forGroupGeneratedRows,
      effectiveEnabledElementIds: evaluation.effectiveEnabledElementIds,
      errors: evaluation.errors
    });

    expect(options.map((option) => option.label)).toContain("L");
    expect(options.map((option) => option.label)).not.toContain("M");
  });
});
