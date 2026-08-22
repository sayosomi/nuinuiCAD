import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { queryDslDefinition } from "./dslDefinitionQuery";
import { parseDslModuleStatement } from "./dslModuleParser";
import { parseDslSnapshot } from "./dslParser";
import { queryDslReferences } from "./dslReferencesQuery";
import { createDslSemanticOccurrenceIndex } from "./dslSemanticOccurrenceIndex";
import { moduleCompletionCandidates } from "./moduleCompletionCandidates";
import { moduleSemanticStableFingerprint } from "../document/moduleSemanticRenameAnalysis";
import { planDslRenameEditsResult } from "./dslRenameQuery";

const compileWithIds = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]))
  });
};

const semanticSnapshot = (source: string, compiled: ReturnType<typeof compileWithIds>) => ({
  source: { normalizedSource: source, sourceRevision: 0 },
  semantic: { sourceRevision: 0, sourceText: source, compiled }
});

const applyEdits = (source: string, edits: readonly { from: number; to: number; newText: string }[]) =>
  [...edits]
    .sort((left, right) => right.from - left.from || right.to - left.to)
    .reduce((text, edit) => `${text.slice(0, edit.from)}${edit.newText}${text.slice(edit.to)}`, source);

describe("nui4 Module same-name argument shorthand", () => {
  it("parses only a simple relative source reference as an implicit named argument", () => {
    const source = 'instance X = M(@width, @縫い代幅, @"name with spaces")';
    const parsed = parseDslModuleStatement(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statement?.kind).toBe("moduleInstance");
    if (parsed.statement?.kind !== "moduleInstance") return;

    expect(parsed.statement.arguments.map((argument) => argument.label)).toEqual([
      "width",
      "縫い代幅",
      "name with spaces"
    ]);
    expect(parsed.statement.arguments.map((argument) =>
      argument.labelSpan ? source.slice(argument.labelSpan.start, argument.labelSpan.end) : null
    )).toEqual(["width", "縫い代幅", '"name with spaces"']);
    expect(parsed.statement.arguments.map((argument) => argument.value)).toEqual([
      "@width",
      "@縫い代幅",
      '@"name with spaces"'
    ]);
  });

  it.each([
    "@settings.width",
    "@front::width",
    "@::width",
    "@front::part.width",
    "1",
    "@width + 1"
  ])("rejects %s as shorthand rather than introducing positional semantics", (argument) => {
    const parsed = parseDslModuleStatement(`instance X = M(${argument})`);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.message.includes("shorthand"))).toBe(true);
    expect(parsed.statement?.kind).toBe("moduleInstance");
    if (parsed.statement?.kind !== "moduleInstance") return;
    expect(parsed.statement.arguments[0]?.label).toBeNull();
  });

  const shorthandSource = [
    "nui 4",
    "const width: number = 10",
    "const height: number = 20",
    "module Pocket(width: number, height: number) {",
    "  point P = coordinate(x: @width, y: @height)",
    "}",
    "instance pocket = Pocket(@width, height: @height)"
  ].join("\n");

  it("lowers shorthand through the existing named Module semantic binding", () => {
    const compiled = compileWithIds(shorthandSource);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const statementIndex = compiled.statements.findIndex((statement) => statement.kind === "moduleInstance");
    const statement = compiled.statements[statementIndex];
    expect(statement?.kind).toBe("moduleInstance");
    if (statement?.kind !== "moduleInstance") return;

    expect(statement.arguments.map((argument) => argument.label)).toEqual(["width", "height"]);
    expect(statement.arguments.map((argument) => argument.value)).toEqual(["@width", "@height"]);
    expect(statement.arguments[0]?.labelPhysicalSpan?.segments).toHaveLength(1);
    expect(statement.arguments[0]?.valuePhysicalSpan?.segments).toHaveLength(1);
    const labelSpan = statement.arguments[0]!.labelPhysicalSpan!.segments[0]!;
    const valueSpan = statement.arguments[0]!.valuePhysicalSpan!.segments[0]!;
    expect(shorthandSource.slice(labelSpan.from, labelSpan.to)).toBe("width");
    expect(shorthandSource.slice(valueSpan.from, valueSpan.to)).toBe("@width");

    const instance = compiled.moduleSemanticAnalysis?.instances.find((candidate) => candidate.statementIndex === statementIndex);
    expect(instance?.parameterBindings.map((binding) => [binding.parameterName, binding.argumentIndex])).toEqual([
      ["width", 0],
      ["height", 1]
    ]);
  });

  it("preserves both the implicit parameter-label occurrence and caller-value occurrence", () => {
    const compiled = compileWithIds(shorthandSource);
    const shorthandStart = shorthandSource.indexOf("@width", shorthandSource.indexOf("instance pocket")) + 1;
    const occurrences = createDslSemanticOccurrenceIndex(compiled).occurrences.filter((occurrence) =>
      occurrence.from === shorthandStart && occurrence.to === shorthandStart + "width".length
    );

    expect(occurrences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "reference",
        identity: expect.objectContaining({ kind: "typed" })
      }),
      expect.objectContaining({
        kind: "reference",
        identity: {
          kind: "module",
          target: expect.objectContaining({ kind: "moduleParameter" })
        }
      })
    ]));
  });

  it("goes to the caller value declaration from the shared shorthand token", () => {
    const compiled = compileWithIds(shorthandSource);
    const shorthandStart = shorthandSource.indexOf("@width", shorthandSource.indexOf("instance pocket")) + 1;
    const result = queryDslDefinition({
      ...semanticSnapshot(shorthandSource, compiled),
      position: shorthandStart + 1
    });

    expect(result).not.toBeNull();
    expect(shorthandSource.slice(result!.referenceRange.from, result!.referenceRange.to)).toBe("width");
    expect(shorthandSource.slice(result!.declarationRange.from, result!.declarationRange.to)).toBe("width");
    expect(result!.declarationRange.from).toBe(shorthandSource.indexOf("width", shorthandSource.indexOf("const width")));
  });

  it("includes shorthand in Module parameter references without losing body references", () => {
    const compiled = compileWithIds(shorthandSource);
    const parameterStart = shorthandSource.indexOf("width", shorthandSource.indexOf("module Pocket"));
    const shorthandStart = shorthandSource.indexOf("@width", shorthandSource.indexOf("instance pocket")) + 1;
    const bodyStart = shorthandSource.indexOf("@width", shorthandSource.indexOf("coordinate")) + 1;
    const result = queryDslReferences({
      ...semanticSnapshot(shorthandSource, compiled),
      position: parameterStart + 1
    });

    expect(result).not.toBeNull();
    expect(result!.referenceRanges).toEqual(expect.arrayContaining([
      { from: bodyStart, to: bodyStart + "width".length },
      { from: shorthandStart, to: shorthandStart + "width".length }
    ]));
  });

  it("offers compatible shorthand before the explicit named form and suppresses a consumed shorthand", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const height: number = 20",
      "module Pocket(width: number, height: number) {",
      "}",
      "instance pocket = Pocket()"
    ].join("\n");
    const compiled = compileWithIds(source);
    const statementIndex = compiled.statements.findIndex((statement) => statement.kind === "moduleInstance");
    const logical = "instance pocket = Pocket()";
    const candidates = moduleCompletionCandidates({
      compiled,
      cursorPosition: source.indexOf("Pocket()") + "Pocket(".length,
      kind: "label",
      statementIndex,
      liveStatementText: logical,
      logicalCursorPosition: logical.indexOf("(") + 1
    });
    const labels = candidates.map((candidate) => candidate.label);
    expect(labels).toEqual(["@width", "@height", "width", "height"]);

    const consumed = moduleCompletionCandidates({
      compiled,
      cursorPosition: source.indexOf("Pocket()") + "Pocket(".length,
      kind: "label",
      statementIndex,
      liveStatementText: "instance pocket = Pocket(@width, )",
      logicalCursorPosition: "instance pocket = Pocket(@width, ".length
    }).map((candidate) => candidate.label);
    expect(consumed).not.toContain("@width");
    expect(consumed).not.toContain("width");
  });

  it("offers shorthand only when the same-name caller value is type compatible", () => {
    const source = [
      "nui 4",
      'const width: string = "10"',
      "module Pocket(width: number) {",
      "}",
      "instance pocket = Pocket()"
    ].join("\n");
    const compiled = compileWithIds(source);
    const statementIndex = compiled.statements.findIndex((statement) => statement.kind === "moduleInstance");
    const candidates = moduleCompletionCandidates({
      compiled,
      cursorPosition: source.indexOf("Pocket()") + "Pocket(".length,
      kind: "label",
      statementIndex,
      liveStatementText: "instance pocket = Pocket()",
      logicalCursorPosition: "instance pocket = Pocket(".length
    }).map((candidate) => candidate.label);
    expect(candidates).not.toContain("@width");
    expect(candidates).toContain("width");
  });

  it("detects duplicate arguments after shorthand label derivation", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "module Pocket(width: number) {",
      "}",
      "instance pocket = Pocket(@width, width: 1)"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "module-duplicate-argument" })
    ]));
  });

  it("keeps shorthand and explicit calls runtime-semantically equivalent", () => {
    const explicitSource = shorthandSource.replace(
      "Pocket(@width, height: @height)",
      "Pocket(width: @width, height: @height)"
    );
    const shorthand = compileWithIds(shorthandSource);
    const explicit = compileWithIds(explicitSource);
    expect(shorthand.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(explicit.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(moduleSemanticStableFingerprint(shorthand)).toBe(moduleSemanticStableFingerprint(explicit));
  });

  it("expands shorthand when renaming the Module parameter but preserves the caller value", () => {
    const compiled = compileWithIds(shorthandSource);
    const parameterStart = shorthandSource.indexOf("width", shorthandSource.indexOf("module Pocket"));
    const result = planDslRenameEditsResult(
      semanticSnapshot(shorthandSource, compiled),
      parameterStart + 1,
      "size"
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const renamed = applyEdits(shorthandSource, result.plan.edits);
    expect(renamed).toContain("module Pocket(size: number, height: number)");
    expect(renamed).toContain("Pocket(size: @width, height: @height)");
  });

  it("expands shorthand when renaming the caller binding but preserves the Module parameter", () => {
    const compiled = compileWithIds(shorthandSource);
    const declarationStart = shorthandSource.indexOf("width", shorthandSource.indexOf("const width"));
    const result = planDslRenameEditsResult(
      semanticSnapshot(shorthandSource, compiled),
      declarationStart + 1,
      "outerWidth"
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const renamed = applyEdits(shorthandSource, result.plan.edits);
    expect(renamed).toContain("const outerWidth: number = 10");
    expect(renamed).toContain("Pocket(width: @outerWidth, height: @height)");
  });
});