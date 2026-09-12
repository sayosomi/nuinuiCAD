import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../../packages/nui-language/src/dsl/dslCompiler";
import { parseDslCallStatement } from "../../packages/nui-language/src/dsl/dslCallParser";
import { compileDslDocument, serializeDocumentToDsl } from "../../packages/nui-language/src/dsl/dslDocument";
import { serializeTransformationRecipeLines } from "../../packages/nui-language/src/dsl/dslSerializer";

const compile = (source: string) => compileDslToElements(source, { elements: [], mode: "document" });
const errors = (result: ReturnType<typeof compile>) => result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("nui1 declarative transformation recipes", () => {
  it("parses canonical targets, lists, endpoints, stages, and omitted as", () => {
    const single = parseDslCallStatement("move A as shifted (from: @P1, to: @P2)");
    expect(single.diagnostics).toEqual([]);
    expect(single.statement).toMatchObject({
      category: "transformation",
      construction: "move",
      transformationTargets: [{ source: "A" }],
      stageName: "shifted"
    });

    const list = parseDslCallStatement("edge [A.end, B.start] (index: 0)");
    expect(list.diagnostics).toEqual([]);
    expect(list.statement?.transformationTargets?.map((target) => target.source)).toEqual(["A.end", "B.start"]);
    expect(parseDslCallStatement("reverse A ()").statement?.stageName).toBeNull();
  });

  it("compiles explicit recipe ownership without materializing stage elements", () => {
    const result = compile([
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as moved (from: (0, 0), to: (10, 0))",
      "reverse A ()",
      "extend A.moved.end as extended (to: (30, 0))"
    ].join("\n"));

    expect(errors(result)).toEqual([]);
    expect(result.elements).toHaveLength(1);
    expect(result.transformationRecipes).toMatchObject([
      { construction: "move", recipeOwnerPath: [], stageName: "moved" },
      { construction: "reverse", recipeOwnerPath: [], stageName: null },
      { construction: "extend", recipeOwnerPath: ["moved"], stageName: "extended" }
    ]);
    expect(result.transformationRecipes?.[2]?.targets[0]).toMatchObject({
      canonical: "@A.moved.end",
      stagePath: ["moved"],
      endpointKey: "end"
    });
  });

  it("resolves qualified owners without changing the target value-reference grammar", () => {
    const result = compile([
      "group front {",
      "  line A = segment(start: (0, 0), end: (10, 0))",
      "}",
      "move front::A as shifted (from: (0, 0), to: (1, 0))"
    ].join("\n"));
    expect(errors(result)).toEqual([]);
    expect(result.transformationRecipes?.[0]?.targets[0]).toMatchObject({
      canonical: "@front::A",
      stagePath: []
    });
  });

  it("reports final targets, reserved/property collisions, and duplicate sibling stages", () => {
    const result = compile([
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as moved (from: (0, 0), to: (1, 0))",
      "move A as moved (from: (0, 0), to: (2, 0))",
      "reverse A.final ()",
      "reverse A as length ()",
      "reverse A as base ()"
    ].join("\n"));
    const codes = errors(result).map((diagnostic) => diagnostic.code);
    expect(codes).toContain("duplicate-transformation-stage");
    expect(codes).toContain("invalid-final-transformation-target");
    expect(codes).toContain("transformation-stage-property-collision");
    expect(codes).toContain("reserved-transformation-stage-name");
  });

  it("rejects removed mutation syntax and occurrence-after-stage spelling", () => {
    const oldSyntax = parseDslCallStatement("move(targets: [A], from: @P1, to: @P2)");
    expect(oldSyntax.diagnostics.some((diagnostic) => diagnostic.code === "malformed-transformation-target")).toBe(true);
    const malformed = compile([
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as shifted (from: (0, 0), to: (1, 0))",
      "reverse A.shifted[2] ()"
    ].join("\n"));
    expect(errors(malformed).map((diagnostic) => diagnostic.code)).toContain("malformed-transformation-target");
  });

  it("serializes selectors in the header and preserves enabled false", () => {
    const result = compile("line A = segment(start: (0, 0), end: (10, 0))\nmove A as shifted (from: (0, 0), to: (1, 0), enabled: false)");
    expect(errors(result)).toEqual([]);
    const recipe = result.transformationRecipes![0]!;
    const serialized = serializeTransformationRecipeLines(recipe).join("\n");
    expect(serialized).toContain("move A as shifted (");
    expect(serialized).toContain("enabled: false");
    expect(serialized).not.toContain("targets:");
  });

  it("keeps occurrence selectors occurrence-first", () => {
    const parsed = parseDslCallStatement("reverse Mark[2].shifted ()");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statement?.transformationTargets?.[0]?.source).toBe("Mark[2].shifted");
    const malformed = parseDslCallStatement("reverse Mark.shifted[2] ()");
    expect(malformed.statement?.transformationTargets?.[0]?.source).toBe("Mark.shifted[2]");
  });

  it("round-trips canonical recipe headers through document serialization", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as shifted (from: (0, 0), to: (1, 0), enabled: false)"
    ].join("\n");
    const compiled = compileDslDocument(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const serialized = serializeDocumentToDsl(compiled.document!, 1);
    expect(serialized).toContain("move A as shifted (");
    expect(serialized).not.toContain("targets:");

    const reparsed = compileDslDocument(serialized);
    expect(reparsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(reparsed.document?.transformationRecipes).toMatchObject([
      { construction: "move", stageName: "shifted", enabled: false }
    ]);
  });
});
