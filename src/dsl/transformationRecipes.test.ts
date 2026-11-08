import { describe, expect, it } from "vitest";
import {
  compileDslToElements, parseDslCallStatement, compileDslDocument,
  serializeDocumentToDsl, serializeTransformationRecipeLines
} from "@nuinuicad/nui-language";

const compile = (source: string) => compileDslToElements(source, { elements: [], mode: "document" });
const errors = (result: ReturnType<typeof compile>) => result.diagnostics.filter(diagnostic => diagnostic.severity === "error");
const line = "line A = segment(start: (0, 0), end: (10, 0))";

describe("nui1 declarative transformation recipes", () => {
  it("parses owner selectors, coupled lists, endpoints and omitted names", () => {
    const single = parseDslCallStatement("move @A(from: @P1, to: @P2)");
    expect(single.diagnostics).toEqual([]);
    expect(single.statement).toMatchObject({ category: "transformation", construction: "move", transformationTargets: [{ source: "@A" }], stageName: null });
    const list = parseDslCallStatement("edge [@A.end, @B.start](index: 0)");
    expect(list.diagnostics).toEqual([]);
    expect(list.statement?.transformationTargets?.map(target => target.source)).toEqual(["@A.end", "@B.start"]);
  });

  it("retains sequential recipes without creating drawable checkpoints", () => {
    const result = compile(`${line}\nmove @A(from: (0, 0), to: (10, 0))\nreverse @A()\nextend @A.end(to: (30, 0))`);
    expect(errors(result)).toEqual([]);
    expect(result.elements).toHaveLength(1);
    expect(result.transformationRecipes?.map(recipe => [recipe.construction, recipe.recipeOwnerPath, recipe.stageName])).toEqual([
      ["move", [], "$prefix:1"], ["reverse", [], "$prefix:2"], ["extend", [], "$prefix:3"]
    ]);
    expect(result.transformationRecipes?.[2]?.targets[0]).toMatchObject({ canonical: "@A.end", stagePath: [], endpointKey: "end" });
  });

  it("resolves qualified mutation owners through the ordinary lexical namespace", () => {
    const result = compile(`group front {\n${line}\n}\nmove @front::A(from: (0, 0), to: (1, 0))`);
    expect(errors(result)).toEqual([]);
    expect(result.transformationRecipes?.[0]?.targets[0]).toMatchObject({ canonical: "@front::A", stagePath: [] });
  });

  it.each([
    "move @A as moved(from: (0, 0), to: (1, 0))",
    "reverse @A as base()", "reverse @A as final()", "reverse @A as length()",
    "reverse @A.base()", "reverse @A.final()", "reverse @A.moved()",
    "extend @A.moved.end(to: (30, 0))", "reverse @A.shifted[2]()"
  ])("rejects removed stages without compatibility: %s", statement => {
    expect(errors(compile(`${line}\n${statement}`))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "malformed-transformation-target" })
    ]));
  });

  it("rejects removed call-shaped mutations", () => {
    expect(parseDslCallStatement("move(targets: [A], from: @P1, to: @P2)").diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "malformed-transformation-target", presentation: { key: "diagnostic.malformed-transformation-target" } })
    ]));
  });

  it("preserves operation and target facts in diagnostics", () => {
    expect(errors(compile(`${line}\nreverse @Missing()`))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unresolved-transformation-target", presentation: { key: "diagnostic.unresolved-transformation-target", parameters: { target: "@Missing" } } })
    ]));
    const incompatible = errors(compile(`${line}\nmove @A.start(from: (0, 0), to: (1, 0))\nedge [@A.start](index: 0)`));
    expect(incompatible).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "transformation-target-kind-incompatible", presentation: { key: "diagnostic.transformation-target-kind-incompatible", parameters: { operation: "move", target: "@A.start" } } }),
      expect.objectContaining({ code: "transformation-target-kind-incompatible", presentation: { key: "diagnostic.transformation-target-kind-incompatible", parameters: { operation: "edge" } } })
    ]));
    expect(errors(compile(`${line}\nreverse @A[2]()`))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "generated-occurrence-unavailable", presentation: { key: "diagnostic.generated-occurrence-unavailable", parameters: { target: "@A[2]" } } })
    ]));
  });

  it("serializes only authored selectors and preserves disabled recipes", () => {
    const result = compile(`${line}\nmove @A(from: (0, 0), to: (1, 0), enabled: false)`);
    expect(errors(result)).toEqual([]);
    const serialized = serializeTransformationRecipeLines(result.transformationRecipes![0]!).join("\n");
    expect(serialized).toContain("move @A (");
    expect(serialized).toContain("enabled: false");
    expect(serialized).not.toMatch(/as |\$prefix|targets:/);
  });

  it("keeps generated selectors occurrence-first", () => {
    const result = compile("for i in range(min: 0, max: 2, step: 1) {\nline Mark = segment(start: (0, 0), end: (10, 0))\nreverse @Mark[2]()\n}");
    expect(errors(result)).toEqual([]);
    expect(result.transformationRecipes?.[0]?.targets[0]).toMatchObject({ canonical: "@Mark[2]", occurrenceIndex: "2", stagePath: [] });
  });

  it("round-trips canonical headers without exposing anonymous prefixes", () => {
    const compiled = compileDslDocument(`nui 1\n${line}\nmove @A(from: (0, 0), to: (1, 0), enabled: false)`);
    expect(compiled.diagnostics).toEqual([]);
    const serialized = serializeDocumentToDsl(compiled.document!, 1);
    expect(serialized).toContain("move @A (");
    expect(serialized).not.toMatch(/as |\$prefix|targets:/);
    const reparsed = compileDslDocument(serialized);
    expect(reparsed.diagnostics).toEqual([]);
    expect(reparsed.document?.transformationRecipes).toMatchObject([{ construction: "move", enabled: false }]);
  });
});
