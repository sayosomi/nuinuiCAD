import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { dslVariableCompletionOptions } from "./dslVariableCompletionCandidates";
import type { ComputedVariable, ElementId } from "../types/geometry";

const identities = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  return {
    elements: compiled.document!.elements,
    ids: new Map([...compiled.statementMap!.byElementId].map(([elementId, statement]) => [statement.line, elementId]))
  };
};

const computed = (...ids: ElementId[]): Map<ElementId, ComputedVariable> =>
  new Map(ids.map((id) => [id, { kind: "variable", elementId: id, name: id, value: 1 }]));

describe("dslVariableCompletionOptions", () => {
  it("excludes a var statement on or after the cursor line (forward reference)", () => {
    const source = ["nui 1", "var Width = 10", "var Later = 20"].join("\n");
    const { elements, ids } = identities(source);
    const labels = dslVariableCompletionOptions({ source, cursorLine: 3, statementElementIds: ids, elements })
      .map((option) => option.label);
    expect(labels).toContain("@Width");
    expect(labels).not.toContain("@Later");

    const atDeclarationLine = dslVariableCompletionOptions({ source, cursorLine: 2, statementElementIds: ids, elements })
      .map((option) => option.label);
    expect(atDeclarationLine).not.toContain("@Width");
  });

  it("excludes a var statement after the document's @stop marker even when cursorLine is further down", () => {
    const source = ["nui 1", "var Width = 10", "@stop", "var AfterStop = 20", "point P = (0, 0)"].join("\n");
    const { elements, ids } = identities(source);
    const labels = dslVariableCompletionOptions({ source, cursorLine: 5, statementElementIds: ids, elements })
      .map((option) => option.label);
    expect(labels).toContain("@Width");
    expect(labels).not.toContain("@AfterStop");
  });

  it("excludes a disabled (enabled=false) var statement", () => {
    const source = ["nui 1", "var Width = 10 enabled=false", "var Height = 20", "point P = (0, 0)"].join("\n");
    const { elements, ids } = identities(source);
    const labels = dslVariableCompletionOptions({ source, cursorLine: 4, statementElementIds: ids, elements })
      .map((option) => option.label);
    expect(labels).not.toContain("@Width");
    expect(labels).toContain("@Height");
  });

  it("excludes a var statement with a syntactically unparseable expression, live, without evaluating it", () => {
    const source = ["nui 1", "var Broken = )))", "var Height = 20", "point P = (0, 0)"].join("\n");
    const { elements, ids } = identities(source);
    const labels = dslVariableCompletionOptions({ source, cursorLine: 4, statementElementIds: ids, elements })
      .map((option) => option.label);
    expect(labels).not.toContain("@Broken");
    expect(labels).toContain("@Height");
  });

  it("excludes a group-scoped var outside the cursor's live group scope", () => {
    const source = [
      "nui 1",
      "group Outer {",
      "  var Inner = 10 scope=group",
      "}",
      "point Target = (0, 0)"
    ].join("\n");
    const { elements, ids } = identities(source);
    const outsideLabels = dslVariableCompletionOptions({ source, cursorLine: 5, statementElementIds: ids, elements })
      .map((option) => option.label);
    expect(outsideLabels).not.toContain("@Inner");

    const insideLabels = dslVariableCompletionOptions({
      source: [...source.split("\n").slice(0, 3), "  point Target = (0, 0)", "}"].join("\n"),
      cursorLine: 4,
      statementElementIds: ids,
      elements
    }).map((option) => option.label);
    expect(insideLabels).toContain("@Inner");
  });

  it("falls back to @id insertion text when two compiled candidates share a name", () => {
    // Distinct explicit ids avoid the parser's same-scope duplicate-bare-name diagnostic
    // (reportDuplicateNames), which would otherwise fail compilation entirely.
    const duplicateSource = [
      "nui 1",
      "var Width = 10 id=width-a",
      "var Width = 20 id=width-b",
      "point Target = (0, 0)"
    ].join("\n");
    const { elements, ids } = identities(duplicateSource);
    const options = dslVariableCompletionOptions({ source: duplicateSource, cursorLine: 4, statementElementIds: ids, elements });
    expect(options).toHaveLength(2);
    expect(options.every((option) => option.displayExpression === "@Width")).toBe(true);
    expect(options.every((option) => option.expression.startsWith("@") && option.expression !== "@Width")).toBe(true);
  });

  it("Tier A: offers a brand-new, never-compiled var statement even without a matching computedVariables entry", () => {
    const compiledSource = ["nui 1", "point Target = (0, 0)"].join("\n");
    const { elements, ids } = identities(compiledSource);
    // "var Width" only exists in the live source, never compiled — statementElementIds has no entry for its line.
    const liveSource = ["nui 1", "var Width = 10", "point Target = (0, 0)"].join("\n");
    const labels = dslVariableCompletionOptions({
      source: liveSource,
      cursorLine: 3,
      statementElementIds: ids,
      elements,
      computedVariables: computed() // empty: nothing has ever been evaluated
    }).map((option) => option.label);
    expect(labels).toContain("@Width");
  });

  it("Tier B: excludes a compiled var statement missing from computedVariables (evaluator-invalid/uncomputed)", () => {
    const source = ["nui 1", "var Width = 10", "point Target = (0, 0)"].join("\n");
    const { elements, ids } = identities(source);
    const widthId = ids.get(2)!;
    const excluded = dslVariableCompletionOptions({
      source,
      cursorLine: 3,
      statementElementIds: ids,
      elements,
      computedVariables: computed() // widthId is not present
    }).map((option) => option.label);
    expect(excluded).not.toContain("@Width");

    const included = dslVariableCompletionOptions({
      source,
      cursorLine: 3,
      statementElementIds: ids,
      elements,
      computedVariables: computed(widthId)
    }).map((option) => option.label);
    expect(included).toContain("@Width");
  });
});
