import { describe, expect, it } from "vitest";
import { compileDslToElements } from "@nuinuicad/nui-language";
import { parseDslCallStatement } from "@nuinuicad/nui-language";
import { compileDslDocument, serializeDocumentToDsl } from "@nuinuicad/nui-language";
import { serializeTransformationRecipeLines } from "@nuinuicad/nui-language";

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
    expect(errors(result).find((diagnostic) => diagnostic.code === "duplicate-transformation-stage")?.presentation).toEqual({
      key: "diagnostic.duplicate-transformation-stage",
      parameters: { stage: "moved" }
    });
    expect(errors(result).find((diagnostic) => diagnostic.code === "transformation-stage-property-collision")?.presentation).toEqual({
      key: "diagnostic.transformation-stage-property-collision",
      parameters: { stage: "length" }
    });
    expect(errors(result).find((diagnostic) => diagnostic.code === "reserved-transformation-stage-name")?.presentation).toEqual({
      key: "diagnostic.reserved-transformation-stage-name",
      parameters: { stage: "base" }
    });
  });

  it("rejects removed mutation syntax and occurrence-after-stage spelling", () => {
    const oldSyntax = parseDslCallStatement("move(targets: [A], from: @P1, to: @P2)");
    expect(oldSyntax.diagnostics.find((diagnostic) => diagnostic.code === "malformed-transformation-target")?.presentation).toEqual({
      key: "diagnostic.malformed-transformation-target"
    });
    const malformed = compile([
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A as shifted (from: (0, 0), to: (1, 0))",
      "reverse A.shifted[2] ()"
    ].join("\n"));
    expect(errors(malformed).find((diagnostic) => diagnostic.code === "malformed-transformation-target")?.presentation).toEqual({
      key: "diagnostic.malformed-transformation-target",
      parameters: { target: "A.shifted[2]" }
    });
  });

  it("preserves transformation target, operation, occurrence, and stage facts in diagnostic parameters", () => {
    const unresolvedSource = "line A = segment(start: (0, 0), end: (10, 0))\nreverse Missing ()";
    const unresolvedLegacy = errors(compile(unresolvedSource)).find(
      (diagnostic) => diagnostic.code === "unresolved-transformation-target"
    );
    expect(unresolvedLegacy?.presentation).toEqual({
      key: "diagnostic.unresolved-transformation-target",
      parameters: { target: "@Missing" }
    });

    const unresolvedLexical = compileDslDocument(`nui 1\n${unresolvedSource}`).diagnostics.find(
      (diagnostic) => diagnostic.code === "unresolved-transformation-target"
    );
    expect(unresolvedLexical?.presentation).toEqual({
      key: "diagnostic.unresolved-transformation-target",
      parameters: { target: "@Missing" }
    });

    const incompatible = compile([
      "line A = segment(start: (0, 0), end: (10, 0))",
      "move A.start as endpoint (from: (0, 0), to: (1, 0))",
      "edge [A.start] (index: 0)"
    ].join("\n"));
    expect(errors(incompatible).find((diagnostic) =>
      diagnostic.code === "transformation-target-kind-incompatible" && diagnostic.presentation?.parameters?.target === "A.start"
    )?.presentation).toEqual({
      key: "diagnostic.transformation-target-kind-incompatible",
      parameters: { operation: "move", target: "A.start" }
    });
    expect(errors(incompatible).find((diagnostic) =>
      diagnostic.code === "transformation-target-kind-incompatible" && diagnostic.presentation?.parameters?.operation === "edge"
    )?.presentation).toEqual({
      key: "diagnostic.transformation-target-kind-incompatible",
      parameters: { operation: "edge" }
    });

    const selectorDiagnostics = errors(compile([
      "line A = segment(start: (0, 0), end: (10, 0))",
      "reverse A[2] ()",
      "reverse A.missing ()"
    ].join("\n")));
    expect(selectorDiagnostics.find((diagnostic) => diagnostic.code === "generated-occurrence-unavailable")?.presentation).toEqual({
      key: "diagnostic.generated-occurrence-unavailable",
      parameters: { target: "A[2]" }
    });
    expect(selectorDiagnostics.find((diagnostic) => diagnostic.code === "unresolved-transformation-stage")?.presentation).toEqual({
      key: "diagnostic.unresolved-transformation-stage",
      parameters: { stage: "missing", target: "A.missing" }
    });
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
