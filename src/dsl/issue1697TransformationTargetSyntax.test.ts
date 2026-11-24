import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot, queryDslReferencePickTarget } from "@nuinuicad/nui-language";

const compile = (source: string, sourceRevision = 41) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `issue1697-${index}`]))
  });
};

const errors = (compiled: ReturnType<typeof compile>) => [
  ...compiled.diagnostics,
  ...(compiled.bindingIssueDiagnostics ?? [])
].filter((diagnostic) => diagnostic.severity === "error");

const lines = `nui 1
line A = segment(start: (0, 0), end: (20, 0))
line B = segment(start: (30, 0), end: (50, 0))
point P = coordinate(x: 5, y: 5)`;

describe("Issue #1697 transformation target source syntax", () => {
  it("compiles canonical single, list, endpoint, and qualified owner targets by identity", () => {
    const source = `${lines}
group front {
  line seam = segment(start: (0, 20), end: (20, 20))
}
reverse A()
move [A, B](from: (0, 0), to: (1, 0))
edge [A.end, B.start](index: 0)
extend A.end(to: (30, 0))
reverse front::seam()
reverse ::front::seam()`;
    const compiled = compile(source);
    expect(errors(compiled)).toEqual([]);

    const recipes = compiled.transformationRecipes ?? [];
    expect(recipes.map((recipe) => recipe.construction)).toEqual([
      "reverse", "move", "edge", "extend", "reverse", "reverse"
    ]);
    expect(recipes.map((recipe) => recipe.sourceStatementIndex)).toEqual(
      [...recipes.map((recipe) => recipe.sourceStatementIndex)].sort((left, right) => left - right)
    );

    const elementIdByName = new Map(
      [...compiled.sourceElementsByStatementIndex.values()].map((element) => [element.name, element.id])
    );
    const [reverse, move, edge, extend, relative, absolute] = recipes;
    expect(reverse?.targets[0]).toMatchObject({ source: "A", canonical: "A", ownerId: elementIdByName.get("A") });
    expect(move?.targets.map((target) => target.canonical)).toEqual(["A", "B"]);
    expect(edge?.targets.map((target) => ({ canonical: target.canonical, endpointKey: target.endpointKey }))).toEqual([
      { canonical: "A.end", endpointKey: "end" },
      { canonical: "B.start", endpointKey: "start" }
    ]);
    expect(extend?.targets[0]).toMatchObject({ canonical: "A.end", endpointKey: "end", ownerId: elementIdByName.get("A") });
    expect(relative?.targets[0]).toMatchObject({ canonical: "front::seam", ownerId: elementIdByName.get("seam") });
    expect(absolute?.targets[0]).toMatchObject({ canonical: "::front::seam", ownerId: elementIdByName.get("seam") });

    const reverseIndex = compiled.statements.findIndex((statement) => statement.kind === "transformation" && statement.construction === "reverse");
    expect(compiled.transformationRecipes?.find((recipe) => recipe.sourceStatementIndex === reverseIndex)?.sourceStatementId)
      .toBe(compiled.statementMap?.statementIdByStatementIndex?.get(reverseIndex));
  });

  it("keeps generated occurrence selectors on the original loop owner", () => {
    const source = `nui 1
for i in range(min: 0, max: 2, step: 1) {
  line Mark = segment(start: (0, 0), end: (10, 0))
  reverse Mark[1]()
}`;
    const compiled = compile(source);
    expect(errors(compiled)).toEqual([]);
    const recipe = compiled.transformationRecipes?.find((item) => item.construction === "reverse");
    const owner = [...compiled.sourceElementsByStatementIndex.values()].find((element) => element.name === "Mark");
    expect(recipe?.targets[0]).toMatchObject({
      source: "Mark[1]",
      canonical: "Mark[1]",
      occurrenceIndex: "1",
      ownerId: owner?.id
    });
  });

  it("routes absolute qualified transformations without changing style property parsing", () => {
    const source = `${lines}\ngroup front {\n  line seam = segment(start: (0, 20), end: (20, 20))\n}\nstyle Guide {\n  color: accent,\n}\nreverse ::front::seam()`;
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 41 });
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      sourceRevision: 41,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `issue1697-${index}`]))
    });
    expect(errors(compiled)).toEqual([]);

    const transformation = compiled.statements.find(statement =>
      statement.kind === "transformation" && statement.construction === "reverse" &&
      statement.targets[0]?.source === "::front::seam"
    );
    expect(transformation?.kind).toBe("transformation");
    expect(compiled.transformationRecipes?.some(recipe => recipe.targets[0]?.canonical === "::front::seam")).toBe(true);

    const color = parsed.statements.find(statement =>
      statement.kind === "modifierProperty" && statement.property.key === "color"
    );
    expect(color?.kind).toBe("modifierProperty");
    expect(color?.kind === "modifierProperty" ? color.property.value : null).toBe("accent");
    expect(color?.kind === "modifierProperty" ? color.property.hasTrailingComma : null).toBe(true);
  });

  it.each([
    ["reverse @A()", "malformed-transformation-target", "@"],
    ["reverse [@A, @B]()", "malformed-transformation-target", "@"],
    ["reverse @left()", "malformed-transformation-target", "@"],
    ["reverse \"A\"()", "malformed-transformation-target", "\"A\""],
    ["reverse A::()", "malformed-transformation-target", ":"],
    ["reverse A.end()", "transformation-target-kind-incompatible", "A.end"],
    ["reverse P()", "transformation-target-kind-incompatible", "P"]
  ])("rejects incompatible or noncanonical target syntax %s", (operation, code, sourceFragment) => {
    const source = `${lines}\n${operation}`;
    const compiled = compile(source);
    const diagnostic = errors(compiled).find((item) => item.code === code);
    expect(diagnostic).toBeDefined();
    const segment = diagnostic?.physicalSpan?.segments[0];
    expect(segment && source.slice(segment.from, segment.to)).toBe(sourceFragment);
  });

  it("rejects edge cardinality at the owning operation statement without requiring a target span", () => {
    const source = `${lines}\nedge [A.end]()`;
    const compiled = compile(source);
    const operationIndex = compiled.statements.findIndex(statement =>
      statement.kind === "transformation" && statement.construction === "edge"
    );
    const operation = compiled.statements[operationIndex];
    const diagnostic = errors(compiled).find(item =>
      item.code === "transformation-target-kind-incompatible" &&
      item.presentation?.parameters?.operation === "edge"
    );
    expect(operation?.kind).toBe("transformation");
    expect(operation?.kind === "transformation" ? operation.construction : null).toBe("edge");
    expect(diagnostic).toMatchObject({
      line: operation?.line,
      presentation: { parameters: { operation: "edge" } }
    });
    expect(source.split("\n")[diagnostic!.line - 1]).toBe("edge [A.end]()");
    expect(diagnostic?.physicalSpan).toBeUndefined();
    expect(compiled.transformationRecipes?.some(recipe => recipe.sourceStatementIndex === operationIndex)).toBe(false);
  });

  it("reports malformed lists and preserves an explicit empty target hole", () => {
    const malformed = `${lines}\nmove [A, , B](from: (0, 0), to: (1, 0))`;
    const malformedCompiled = compile(malformed);
    const malformedListDiagnostic = errors(malformedCompiled).find(item => item.code === "empty-argument");
    expect(malformedListDiagnostic).toBeDefined();
    expect(malformed.split("\n")[malformedListDiagnostic!.line - 1]).toBe("move [A, , B](from: (0, 0), to: (1, 0))");

    const source = `${lines}\nreverse ()`;
    const compiled = compile(source);
    expect(errors(compiled).some((item) => item.code === "malformed-transformation-target")).toBe(true);
    const position = source.indexOf("reverse ") + "reverse ".length;
    const target = queryDslReferencePickTarget({
      source: { normalizedSource: source, sourceRevision: 41 },
      position,
      semantic: { sourceText: source, sourceRevision: 41, compiled }
    });
    expect(target).toMatchObject({ syntax: "transformationTarget", range: { from: position, to: position } });
  });

  it("keeps removed stage compatibility and stage restrictions rejected", () => {
    const oldAsStage = compile(`${lines}\nreverse A as base()`);
    expect(errors(oldAsStage).some((item) => item.code === "malformed-transformation-target")).toBe(true);

    const unavailableStage = compile(`${lines}\nreverse A.shifted()`);
    expect(errors(unavailableStage).some((item) => item.code === "unresolved-transformation-stage")).toBe(true);
  });
});
